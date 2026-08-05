(() => {
  'use strict';

  const detectButton = document.getElementById('detect');
  const heading = document.querySelector('header h1');
  const subtitle = document.querySelector('header p');
  if (heading) heading.innerHTML = 'Exam Cleaner v2.1 Alpha.2.1 <span class="badge">OpenCV</span>';
  if (subtitle) subtitle.textContent = '多候選評分偵測＋手動微調＋透視校正';
  if (!detectButton) return;

  let sensitivityIndex = 0;
  const sensitivityModes = [
    { name: '標準', canny1: 45, canny2: 145, close: 7, epsilon: 0.018 },
    { name: '低對比', canny1: 25, canny2: 100, close: 9, epsilon: 0.022 },
    { name: '強邊緣', canny1: 70, canny2: 190, close: 5, epsilon: 0.016 }
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
    const dot = abx * cbx + aby * cby;
    const den = Math.hypot(abx, aby) * Math.hypot(cbx, cby) || 1;
    return Math.abs(dot / den);
  }

  function candidateScore(ordered, width, height, areaRatio) {
    const imageCenter = { x: width / 2, y: height / 2 };
    const center = ordered.reduce((acc, p) => ({ x: acc.x + p.x / 4, y: acc.y + p.y / 4 }), { x: 0, y: 0 });
    const centerDistance = Math.hypot(center.x - imageCenter.x, center.y - imageCenter.y) / Math.hypot(width / 2, height / 2);

    const top = dist(ordered[0], ordered[1]);
    const right = dist(ordered[1], ordered[2]);
    const bottom = dist(ordered[2], ordered[3]);
    const left = dist(ordered[3], ordered[0]);
    const longSide = Math.max((left + right) / 2, (top + bottom) / 2);
    const shortSide = Math.max(1, Math.min((left + right) / 2, (top + bottom) / 2));
    const ratio = longSide / shortSide;
    const a4Ratio = Math.SQRT2;
    const ratioPenalty = Math.min(1, Math.abs(ratio - a4Ratio) / 1.2);

    const anglePenalty = (
      angleCos(ordered[3], ordered[0], ordered[1]) +
      angleCos(ordered[0], ordered[1], ordered[2]) +
      angleCos(ordered[1], ordered[2], ordered[3]) +
      angleCos(ordered[2], ordered[3], ordered[0])
    ) / 4;

    const margin = Math.min(...ordered.map(p => Math.min(p.x, p.y, width - p.x, height - p.y))) / Math.min(width, height);
    const edgeBonus = margin < 0.08 ? 0.06 : 0;

    return areaRatio * 6.2 - centerDistance * 1.1 - ratioPenalty * 0.85 - anglePenalty * 0.7 + edgeBonus;
  }

  function collectCandidates(contours, width, height, scale, mode) {
    const candidates = [];
    const imageArea = width * height;
    const minArea = imageArea * 0.10;

    for (let i = 0; i < contours.size(); i++) {
      const cnt = contours.get(i);
      const peri = cv.arcLength(cnt, true);
      const approx = new cv.Mat();
      cv.approxPolyDP(cnt, approx, mode.epsilon * peri, true);
      const area = Math.abs(cv.contourArea(approx));

      if (approx.rows === 4 && area > minArea && cv.isContourConvex(approx)) {
        const raw = [];
        for (let j = 0; j < 4; j++) {
          raw.push({
            x: approx.data32S[j * 2] / scale,
            y: approx.data32S[j * 2 + 1] / scale
          });
        }
        const ordered = orderPoints(raw);
        const actualArea = polygonArea(raw) / (scale * scale);
        const areaRatio = actualArea / (src.width * src.height);
        if (areaRatio >= 0.10 && areaRatio <= 0.995) {
          candidates.push({
            points: ordered,
            areaRatio,
            score: candidateScore(ordered, src.width, src.height, areaRatio)
          });
        }
      }
      approx.delete();
      cnt.delete();
    }
    return candidates;
  }

  function improvedDetectDocument() {
    if (!window.cvReady || !base) return;
    detectButton.disabled = true;
    const mode = sensitivityModes[sensitivityIndex % sensitivityModes.length];
    setStatus(`正在以「${mode.name}」模式分析紙張邊界……`);

    setTimeout(() => {
      let original, small, gray, blur, edges, adaptive, combined, kernel, contours, hierarchy;
      try {
        sctx.putImageData(base, 0, 0);
        original = cv.imread(src);
        const maxSide = 1100;
        const scale = Math.min(1, maxSide / Math.max(original.cols, original.rows));
        small = new cv.Mat();
        cv.resize(original, small, new cv.Size(Math.round(original.cols * scale), Math.round(original.rows * scale)), 0, 0, cv.INTER_AREA);

        gray = new cv.Mat();
        blur = new cv.Mat();
        edges = new cv.Mat();
        adaptive = new cv.Mat();
        combined = new cv.Mat();
        cv.cvtColor(small, gray, cv.COLOR_RGBA2GRAY);
        cv.GaussianBlur(gray, blur, new cv.Size(5, 5), 0);
        cv.Canny(blur, edges, mode.canny1, mode.canny2);
        cv.adaptiveThreshold(blur, adaptive, 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY_INV, 31, 9);
        cv.bitwise_or(edges, adaptive, combined);

        kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(mode.close, mode.close));
        cv.morphologyEx(combined, combined, cv.MORPH_CLOSE, kernel);
        contours = new cv.MatVector();
        hierarchy = new cv.Mat();
        cv.findContours(combined, contours, hierarchy, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE);

        const candidates = collectCandidates(contours, small.cols, small.rows, scale, mode)
          .sort((a, b) => b.score - a.score);

        if (!candidates.length) throw new Error('找不到可信度足夠的紙張外框');

        const best = candidates[0];
        points = best.points;
        draw();
        sensitivityIndex = (sensitivityIndex + 1) % sensitivityModes.length;
        setStatus(
          `已選出最佳紙張候選（占畫面 ${Math.round(best.areaRatio * 100)}%，模式：${mode.name}）。` +
          `若角點仍不準，可再按一次切換偵測模式，或直接拖曳微調。`,
          'ready'
        );
      } catch (error) {
        sensitivityIndex = (sensitivityIndex + 1) % sensitivityModes.length;
        setStatus(`本次「${mode.name}」模式未成功：${error.message}。請再按一次嘗試其他模式，或手動拖曳角點。`, 'warn');
      } finally {
        [original, small, gray, blur, edges, adaptive, combined, kernel, contours, hierarchy].forEach(mat => {
          try { if (mat) mat.delete(); } catch (_) {}
        });
        detectButton.disabled = false;
      }
    }, 50);
  }

  detectButton.textContent = '重新偵測四角';
  detectButton.onclick = improvedDetectDocument;
})();
