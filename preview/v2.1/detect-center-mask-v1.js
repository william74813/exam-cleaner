(() => {
  'use strict';

  const detectButton = document.getElementById('detect');
  if (!detectButton || typeof detectButton.onclick !== 'function') return;

  const fallbackDetect = detectButton.onclick;
  const heading = document.querySelector('header h1');
  const subtitle = document.querySelector('header p');
  if (heading) heading.innerHTML = 'Exam Cleaner v2.1 <span class="badge">RC2.8</span>';
  if (subtitle) subtitle.textContent = '中央紙張遮罩偵測＋灰階增強＋多頁 PDF';

  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

  function polygonArea(candidate) {
    return Math.abs(candidate.reduce((sum, point, index) => {
      const next = candidate[(index + 1) % candidate.length];
      return sum + point.x * next.y - next.x * point.y;
    }, 0)) / 2;
  }

  function orderCorners(raw) {
    const candidate = raw.map(point => ({ x: point.x, y: point.y }));
    const sums = candidate.map(point => point.x + point.y);
    const diffs = candidate.map(point => point.y - point.x);
    return [
      candidate[sums.indexOf(Math.min(...sums))],
      candidate[diffs.indexOf(Math.min(...diffs))],
      candidate[sums.indexOf(Math.max(...sums))],
      candidate[diffs.indexOf(Math.max(...diffs))]
    ];
  }

  function uniqueCorners(candidate) {
    const minGap = Math.min(src.width, src.height) * 0.08;
    for (let i = 0; i < candidate.length; i++) {
      for (let j = i + 1; j < candidate.length; j++) {
        if (distance(candidate[i], candidate[j]) < minGap) return false;
      }
    }
    return true;
  }

  function validCandidate(candidate) {
    if (!candidate || candidate.length !== 4 || !uniqueCorners(candidate)) return false;
    if (!candidate.every(point => Number.isFinite(point.x) && Number.isFinite(point.y) &&
      point.x >= 0 && point.x <= src.width && point.y >= 0 && point.y <= src.height)) return false;

    const areaRatio = polygonArea(candidate) / (src.width * src.height);
    if (areaRatio < 0.28 || areaRatio > 0.90) return false;

    const top = distance(candidate[0], candidate[1]);
    const right = distance(candidate[1], candidate[2]);
    const bottom = distance(candidate[2], candidate[3]);
    const left = distance(candidate[3], candidate[0]);
    if (Math.min(top, bottom) < src.width * 0.42) return false;
    if (Math.min(left, right) < src.height * 0.48) return false;

    const longSide = Math.max((top + bottom) / 2, (left + right) / 2);
    const shortSide = Math.max(1, Math.min((top + bottom) / 2, (left + right) / 2));
    const ratio = longSide / shortSide;
    if (ratio < 1.08 || ratio > 2.05) return false;

    const minSide = Math.min(src.width, src.height);
    const borderLimit = minSide * 0.018;
    const touching = candidate.filter(point =>
      Math.min(point.x, point.y, src.width - point.x, src.height - point.y) < borderLimit
    ).length;
    return touching <= 1;
  }

  function contourCorners(contour, scale) {
    let hull, approx;
    try {
      hull = new cv.Mat();
      cv.convexHull(contour, hull, false, true);
      const perimeter = cv.arcLength(hull, true);
      const epsilonRatios = [0.012, 0.018, 0.025, 0.032, 0.042, 0.055];

      for (const epsilonRatio of epsilonRatios) {
        if (approx) approx.delete();
        approx = new cv.Mat();
        cv.approxPolyDP(hull, approx, perimeter * epsilonRatio, true);
        if (approx.rows === 4) {
          const result = [];
          for (let index = 0; index < 4; index++) {
            result.push({
              x: approx.data32S[index * 2] / scale,
              y: approx.data32S[index * 2 + 1] / scale
            });
          }
          return orderCorners(result);
        }
      }

      const data = hull.data32S;
      if (!data || data.length < 8) return null;
      let tl, tr, br, bl;
      let minSum = Infinity, maxSum = -Infinity, minDiff = Infinity, maxDiff = -Infinity;
      for (let index = 0; index < data.length; index += 2) {
        const point = { x: data[index] / scale, y: data[index + 1] / scale };
        const sum = point.x + point.y;
        const diff = point.y - point.x;
        if (sum < minSum) { minSum = sum; tl = point; }
        if (sum > maxSum) { maxSum = sum; br = point; }
        if (diff < minDiff) { minDiff = diff; tr = point; }
        if (diff > maxDiff) { maxDiff = diff; bl = point; }
      }
      return [tl, tr, br, bl];
    } finally {
      try { if (hull) hull.delete(); } catch (_) {}
      try { if (approx) approx.delete(); } catch (_) {}
    }
  }

  function candidateScore(candidate, contourAreaRatio, rect, smallWidth, smallHeight) {
    const centerX = candidate.reduce((sum, point) => sum + point.x, 0) / 4;
    const centerY = candidate.reduce((sum, point) => sum + point.y, 0) / 4;
    const centerPenalty = Math.hypot(centerX - src.width / 2, centerY - src.height / 2) /
      Math.hypot(src.width / 2, src.height / 2);
    const borderPenalty = [
      rect.x / smallWidth,
      rect.y / smallHeight,
      (smallWidth - rect.x - rect.width) / smallWidth,
      (smallHeight - rect.y - rect.height) / smallHeight
    ].filter(value => value < 0.012).length * 1.4;
    return contourAreaRatio * 9 - centerPenalty * 1.3 - borderPenalty;
  }

  function detectFromCentralMask() {
    let original, small, gray, blur, centerRoi;
    const candidates = [];
    try {
      sctx.putImageData(base, 0, 0);
      original = cv.imread(src);
      const scale = Math.min(1, 1100 / Math.max(original.cols, original.rows));
      small = new cv.Mat();
      cv.resize(original, small, new cv.Size(
        Math.max(1, Math.round(original.cols * scale)),
        Math.max(1, Math.round(original.rows * scale))
      ), 0, 0, cv.INTER_AREA);

      gray = new cv.Mat();
      blur = new cv.Mat();
      cv.cvtColor(small, gray, cv.COLOR_RGBA2GRAY);
      cv.GaussianBlur(gray, blur, new cv.Size(7, 7), 0);

      const roiWidth = Math.max(20, Math.round(small.cols * 0.20));
      const roiHeight = Math.max(20, Math.round(small.rows * 0.20));
      const roiX = Math.round((small.cols - roiWidth) / 2);
      const roiY = Math.round((small.rows - roiHeight) / 2);
      centerRoi = gray.roi(new cv.Rect(roiX, roiY, roiWidth, roiHeight));
      const centerMean = cv.mean(centerRoi)[0];

      const thresholds = [
        clamp(Math.round(centerMean - 78), 78, 175),
        clamp(Math.round(centerMean - 58), 92, 190),
        clamp(Math.round(centerMean - 40), 108, 205),
        0
      ];

      for (const thresholdValue of thresholds) {
        let mask, closeKernel, openKernel, contours, hierarchy;
        try {
          mask = new cv.Mat();
          if (thresholdValue === 0) {
            cv.threshold(blur, mask, 0, 255, cv.THRESH_BINARY + cv.THRESH_OTSU);
          } else {
            cv.threshold(blur, mask, thresholdValue, 255, cv.THRESH_BINARY);
          }

          let closeSize = Math.max(15, Math.round(Math.min(small.cols, small.rows) / 24));
          if (closeSize % 2 === 0) closeSize++;
          closeSize = Math.min(closeSize, 61);
          closeKernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(closeSize, closeSize));
          openKernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(5, 5));
          cv.morphologyEx(mask, mask, cv.MORPH_CLOSE, closeKernel);
          cv.morphologyEx(mask, mask, cv.MORPH_OPEN, openKernel);

          contours = new cv.MatVector();
          hierarchy = new cv.Mat();
          cv.findContours(mask, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

          const centerPoint = new cv.Point(small.cols / 2, small.rows / 2);
          for (let index = 0; index < contours.size(); index++) {
            const contour = contours.get(index);
            try {
              const areaRatio = Math.abs(cv.contourArea(contour)) / (small.cols * small.rows);
              if (areaRatio < 0.24 || areaRatio > 0.92) continue;
              if (cv.pointPolygonTest(contour, centerPoint, false) < 0) continue;

              const rect = cv.boundingRect(contour);
              if (rect.width < small.cols * 0.48 || rect.height < small.rows * 0.52) continue;
              if (rect.width > small.cols * 0.985 && rect.height > small.rows * 0.985) continue;

              const candidate = contourCorners(contour, scale);
              if (!validCandidate(candidate)) continue;
              candidates.push({
                points: candidate,
                score: candidateScore(candidate, areaRatio, rect, small.cols, small.rows),
                threshold: thresholdValue === 0 ? 'Otsu' : thresholdValue,
                areaRatio
              });
            } finally {
              contour.delete();
            }
          }
        } finally {
          [mask, closeKernel, openKernel, contours, hierarchy].forEach(item => {
            try { if (item) item.delete(); } catch (_) {}
          });
        }
      }

      candidates.sort((first, second) => second.score - first.score);
      return candidates[0] || null;
    } finally {
      [original, small, gray, blur, centerRoi].forEach(item => {
        try { if (item) item.delete(); } catch (_) {}
      });
    }
  }

  detectButton.onclick = () => {
    if (!window.cvReady || !base) return;
    detectButton.disabled = true;
    setStatus('正在以中央紙張亮度建立文件遮罩……');

    setTimeout(() => {
      let result = null;
      try {
        result = detectFromCentralMask();
        if (!result) throw new Error('中央遮罩未找到可信紙張輪廓');
        points = result.points.map(point => ({
          x: clamp(point.x, 0, src.width),
          y: clamp(point.y, 0, src.height)
        }));
        draw();
        setStatus(`已由中央紙張遮罩偵測考卷（面積約 ${Math.round(result.areaRatio * 100)}%，門檻 ${result.threshold}）。請確認四角，必要時拖曳微調。`, 'ready');
      } catch (error) {
        console.warn('Central paper mask failed:', error);
      } finally {
        detectButton.disabled = false;
      }

      if (!result) {
        setStatus('中央紙張遮罩未取得可信結果，正在改用雙引擎外緣偵測……');
        fallbackDetect.call(detectButton);
      }
    }, 60);
  };
})();
