(() => {
  'use strict';

  const detectButton = document.getElementById('detect');
  const heading = document.querySelector('header h1');
  const subtitle = document.querySelector('header p');
  if (heading) heading.innerHTML = 'Exam Cleaner v2.1 Alpha.2.2 <span class="badge">OpenCV</span>';
  if (subtitle) subtitle.textContent = '多參數自動偵測＋亮紙區域備援＋手動微調';
  if (!detectButton) return;

  const modes = [
    { name: '標準', canny1: 40, canny2: 135, close: 7, epsilon: 0.020, adaptiveBlock: 31, adaptiveC: 9 },
    { name: '低對比', canny1: 20, canny2: 90, close: 11, epsilon: 0.026, adaptiveBlock: 41, adaptiveC: 7 },
    { name: '強邊緣', canny1: 65, canny2: 185, close: 5, epsilon: 0.016, adaptiveBlock: 25, adaptiveC: 11 }
  ];

  function polygonArea(pts) {
    let sum = 0;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      sum += a.x * b.y - b.x * a.y;
    }
    return Math.abs(sum) / 2;
  }

  function angleCos(a, b, c) {
    const abx = a.x - b.x, aby = a.y - b.y;
    const cbx = c.x - b.x, cby = c.y - b.y;
    const den = Math.hypot(abx, aby) * Math.hypot(cbx, cby) || 1;
    return Math.abs((abx * cbx + aby * cby) / den);
  }

  function scoreCandidate(ordered, areaRatio) {
    const center = ordered.reduce((acc, p) => ({ x: acc.x + p.x / 4, y: acc.y + p.y / 4 }), { x: 0, y: 0 });
    const centerDistance = Math.hypot(center.x - src.width / 2, center.y - src.height / 2) / Math.hypot(src.width / 2, src.height / 2);
    const top = dist(ordered[0], ordered[1]);
    const right = dist(ordered[1], ordered[2]);
    const bottom = dist(ordered[2], ordered[3]);
    const left = dist(ordered[3], ordered[0]);
    const longSide = Math.max((left + right) / 2, (top + bottom) / 2);
    const shortSide = Math.max(1, Math.min((left + right) / 2, (top + bottom) / 2));
    const ratio = longSide / shortSide;
    const ratioPenalty = Math.min(1.5, Math.abs(ratio - Math.SQRT2));
    const anglePenalty = (
      angleCos(ordered[3], ordered[0], ordered[1]) +
      angleCos(ordered[0], ordered[1], ordered[2]) +
      angleCos(ordered[1], ordered[2], ordered[3]) +
      angleCos(ordered[2], ordered[3], ordered[0])
    ) / 4;
    return areaRatio * 7 - centerDistance * 1.2 - ratioPenalty * 0.9 - anglePenalty * 0.8;
  }

  function collectQuadrilaterals(binary, scale, label) {
    const contours = new cv.MatVector();
    const hierarchy = new cv.Mat();
    const found = [];
    try {
      cv.findContours(binary, contours, hierarchy, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE);
      const minArea = binary.cols * binary.rows * 0.07;
      for (let i = 0; i < contours.size(); i++) {
        const cnt = contours.get(i);
        const peri = cv.arcLength(cnt, true);
        for (const eps of [0.012, 0.018, 0.024, 0.032]) {
          const approx = new cv.Mat();
          cv.approxPolyDP(cnt, approx, eps * peri, true);
          const area = Math.abs(cv.contourArea(approx));
          if (approx.rows === 4 && area > minArea && cv.isContourConvex(approx)) {
            const raw = [];
            for (let j = 0; j < 4; j++) raw.push({ x: approx.data32S[j * 2] / scale, y: approx.data32S[j * 2 + 1] / scale });
            const ordered = orderPoints(raw);
            const areaRatio = polygonArea(ordered) / (src.width * src.height);
            if (areaRatio >= 0.07 && areaRatio <= 0.995) found.push({ points: ordered, areaRatio, score: scoreCandidate(ordered, areaRatio), label });
          }
          approx.delete();
        }
        cnt.delete();
      }
    } finally {
      contours.delete();
      hierarchy.delete();
    }
    return found;
  }

  function brightPaperFallback(gray, scale) {
    const thresholded = new cv.Mat();
    const kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(13, 13));
    try {
      cv.threshold(gray, thresholded, 0, 255, cv.THRESH_BINARY + cv.THRESH_OTSU);
      cv.morphologyEx(thresholded, thresholded, cv.MORPH_CLOSE, kernel);
      const contours = new cv.MatVector();
      const hierarchy = new cv.Mat();
      let best = null;
      try {
        cv.findContours(thresholded, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
        const minArea = gray.cols * gray.rows * 0.12;
        for (let i = 0; i < contours.size(); i++) {
          const cnt = contours.get(i);
          const area = Math.abs(cv.contourArea(cnt));
          if (area < minArea) { cnt.delete(); continue; }
          const rect = cv.minAreaRect(cnt);
          const vertices = cv.RotatedRect.points(rect);
          const ordered = orderPoints(vertices.map(p => ({ x: p.x / scale, y: p.y / scale })));
          const areaRatio = polygonArea(ordered) / (src.width * src.height);
          const candidate = { points: ordered, areaRatio, score: scoreCandidate(ordered, areaRatio) - 0.25, label: '亮紙備援' };
          if (!best || candidate.score > best.score) best = candidate;
          cnt.delete();
        }
      } finally {
        contours.delete(); hierarchy.delete();
      }
      return best;
    } finally {
      thresholded.delete(); kernel.delete();
    }
  }

  function autoDetect() {
    if (!window.cvReady || !base) return;
    detectButton.disabled = true;
    setStatus('正在同時執行多組偵測參數，請稍候……');

    setTimeout(() => {
      let original, small, gray, blur;
      try {
        sctx.putImageData(base, 0, 0);
        original = cv.imread(src);
        const maxSide = 1100;
        const scale = Math.min(1, maxSide / Math.max(original.cols, original.rows));
        small = new cv.Mat();
        cv.resize(original, small, new cv.Size(Math.round(original.cols * scale), Math.round(original.rows * scale)), 0, 0, cv.INTER_AREA);
        gray = new cv.Mat();
        blur = new cv.Mat();
        cv.cvtColor(small, gray, cv.COLOR_RGBA2GRAY);
        cv.GaussianBlur(gray, blur, new cv.Size(5, 5), 0);

        let candidates = [];
        for (const mode of modes) {
          const edges = new cv.Mat();
          const adaptive = new cv.Mat();
          const combined = new cv.Mat();
          const kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(mode.close, mode.close));
          try {
            cv.Canny(blur, edges, mode.canny1, mode.canny2);
            cv.adaptiveThreshold(blur, adaptive, 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY_INV, mode.adaptiveBlock, mode.adaptiveC);
            cv.bitwise_or(edges, adaptive, combined);
            cv.morphologyEx(combined, combined, cv.MORPH_CLOSE, kernel);
            candidates.push(...collectQuadrilaterals(combined, scale, mode.name));
          } finally {
            edges.delete(); adaptive.delete(); combined.delete(); kernel.delete();
          }
        }

        candidates.sort((a, b) => b.score - a.score);
        let best = candidates[0] || brightPaperFallback(gray, scale);
        if (!best) throw new Error('找不到可信的紙張外框');

        points = best.points;
        draw();
        setStatus(`已完成自動偵測（${best.label}，約占畫面 ${Math.round(best.areaRatio * 100)}%）。請確認藍框，必要時拖曳微調。`, 'ready');
      } catch (error) {
        defaultPoints();
        setStatus(`自動偵測仍未成功：${error.message}。已切回手動角點，請拖曳四點後校正。`, 'warn');
      } finally {
        [original, small, gray, blur].forEach(mat => { try { if (mat) mat.delete(); } catch (_) {} });
        detectButton.disabled = false;
      }
    }, 50);
  }

  detectButton.textContent = '自動偵測四角';
  detectButton.onclick = autoDetect;
})();
