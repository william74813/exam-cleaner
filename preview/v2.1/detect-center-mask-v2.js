(() => {
  'use strict';

  const detectButton = document.getElementById('detect');
  if (!detectButton || typeof detectButton.onclick !== 'function') return;

  const fallbackDetect = detectButton.onclick;
  const heading = document.querySelector('header h1');
  const subtitle = document.querySelector('header p');
  if (heading) heading.innerHTML = 'Exam Cleaner v2.1 <span class="badge">RC2.9</span>';
  if (subtitle) subtitle.textContent = '中央紙張遮罩＋四邊輪廓迴歸＋灰階增強＋多頁 PDF';

  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

  function median(values) {
    if (!values.length) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  }

  function polygonArea(candidate) {
    return Math.abs(candidate.reduce((sum, point, index) => {
      const next = candidate[(index + 1) % candidate.length];
      return sum + point.x * next.y - next.x * point.y;
    }, 0)) / 2;
  }

  function regression(samples, dependentKey, independentKey) {
    if (!samples || samples.length < 7) return null;

    const fitOnce = values => {
      let sx = 0, sy = 0, sxx = 0, sxy = 0;
      for (const point of values) {
        const x = point[independentKey];
        const y = point[dependentKey];
        sx += x; sy += y; sxx += x * x; sxy += x * y;
      }
      const n = values.length;
      const denominator = n * sxx - sx * sx;
      if (Math.abs(denominator) < 1e-6) return null;
      const a = (n * sxy - sx * sy) / denominator;
      const b = (sy - a * sx) / n;
      return { a, b };
    };

    const first = fitOnce(samples);
    if (!first) return null;
    const residuals = samples.map(point =>
      Math.abs(point[dependentKey] - (first.a * point[independentKey] + first.b))
    );
    const mad = Math.max(1, median(residuals));
    const limit = Math.max(5, mad * 2.7);
    const inliers = samples.filter((point, index) => residuals[index] <= limit);
    if (inliers.length < 6) return null;
    const second = fitOnce(inliers);
    if (!second) return null;
    const finalResidual = inliers.reduce((sum, point) =>
      sum + Math.abs(point[dependentKey] - (second.a * point[independentKey] + second.b)), 0
    ) / inliers.length;
    return { ...second, inliers, meanResidual: finalResidual };
  }

  function contourPoints(contour, scale) {
    const data = contour.data32S;
    const result = [];
    if (!data) return result;
    for (let index = 0; index < data.length; index += 2) {
      result.push({ x: data[index] / scale, y: data[index + 1] / scale });
    }
    return result;
  }

  function horizontalExtrema(points, rect, side) {
    const samples = [];
    const bins = 32;
    const startX = rect.x + rect.width * 0.035;
    const endX = rect.x + rect.width * 0.965;
    const binWidth = (endX - startX) / bins;

    for (let bin = 0; bin < bins; bin++) {
      const minX = startX + bin * binWidth;
      const maxX = minX + binWidth;
      const group = points.filter(point => point.x >= minX && point.x < maxX);
      if (!group.length) continue;
      const chosen = group.reduce((best, point) => {
        if (!best) return point;
        return side === 'top'
          ? (point.y < best.y ? point : best)
          : (point.y > best.y ? point : best);
      }, null);
      if (side === 'top' && chosen.y > rect.y + rect.height * 0.39) continue;
      if (side === 'bottom' && chosen.y < rect.y + rect.height * 0.64) continue;
      samples.push(chosen);
    }
    return samples;
  }

  function verticalExtrema(points, rect, side) {
    const samples = [];
    const bins = 34;
    const startY = rect.y + rect.height * 0.035;
    const endY = rect.y + rect.height * 0.965;
    const binHeight = (endY - startY) / bins;

    for (let bin = 0; bin < bins; bin++) {
      const minY = startY + bin * binHeight;
      const maxY = minY + binHeight;
      const group = points.filter(point => point.y >= minY && point.y < maxY);
      if (!group.length) continue;
      const chosen = group.reduce((best, point) => {
        if (!best) return point;
        return side === 'left'
          ? (point.x < best.x ? point : best)
          : (point.x > best.x ? point : best);
      }, null);
      if (side === 'left' && chosen.x > rect.x + rect.width * 0.39) continue;
      if (side === 'right' && chosen.x < rect.x + rect.width * 0.61) continue;
      samples.push(chosen);
    }
    return samples;
  }

  function lineFromHorizontal(fit) {
    // y = a*x + b  ->  a*x - y + b = 0
    const normal = Math.hypot(fit.a, -1) || 1;
    return { A: fit.a / normal, B: -1 / normal, C: fit.b / normal };
  }

  function lineFromVertical(fit) {
    // x = a*y + b  ->  x - a*y - b = 0
    const normal = Math.hypot(1, -fit.a) || 1;
    return { A: 1 / normal, B: -fit.a / normal, C: -fit.b / normal };
  }

  function intersection(first, second) {
    const determinant = first.A * second.B - second.A * first.B;
    if (Math.abs(determinant) < 1e-6) return null;
    return {
      x: (first.B * second.C - second.B * first.C) / determinant,
      y: (first.C * second.A - second.C * first.A) / determinant
    };
  }

  function fitContourEdges(contour, rectSmall, scale) {
    const points = contourPoints(contour, scale);
    if (points.length < 20) return null;
    const rect = {
      x: rectSmall.x / scale,
      y: rectSmall.y / scale,
      width: rectSmall.width / scale,
      height: rectSmall.height / scale
    };

    const topSamples = horizontalExtrema(points, rect, 'top');
    const bottomSamples = horizontalExtrema(points, rect, 'bottom');
    const leftSamples = verticalExtrema(points, rect, 'left');
    const rightSamples = verticalExtrema(points, rect, 'right');

    const topFit = regression(topSamples, 'y', 'x');
    const bottomFit = regression(bottomSamples, 'y', 'x');
    const leftFit = regression(leftSamples, 'x', 'y');
    const rightFit = regression(rightSamples, 'x', 'y');
    if (!topFit || !bottomFit || !leftFit || !rightFit) return null;

    // Reject implausibly steep paper edges and poorly supported lower edges.
    if (Math.abs(topFit.a) > 0.38 || Math.abs(bottomFit.a) > 0.38 ||
        Math.abs(leftFit.a) > 0.38 || Math.abs(rightFit.a) > 0.38) return null;
    if (bottomFit.inliers.length < 10 || bottomFit.meanResidual > Math.min(src.width, src.height) * 0.018) return null;

    const topLine = lineFromHorizontal(topFit);
    const bottomLine = lineFromHorizontal(bottomFit);
    const leftLine = lineFromVertical(leftFit);
    const rightLine = lineFromVertical(rightFit);
    const candidate = [
      intersection(topLine, leftLine),
      intersection(topLine, rightLine),
      intersection(bottomLine, rightLine),
      intersection(bottomLine, leftLine)
    ];
    if (candidate.some(point => !point)) return null;

    return {
      points: candidate,
      support: {
        top: topFit.inliers.length,
        right: rightFit.inliers.length,
        bottom: bottomFit.inliers.length,
        left: leftFit.inliers.length
      },
      residual: topFit.meanResidual + rightFit.meanResidual + bottomFit.meanResidual + leftFit.meanResidual
    };
  }

  function validCandidate(candidate) {
    if (!candidate || candidate.length !== 4) return false;
    if (!candidate.every(point => Number.isFinite(point.x) && Number.isFinite(point.y) &&
      point.x >= 0 && point.x <= src.width && point.y >= 0 && point.y <= src.height)) return false;

    const areaRatio = polygonArea(candidate) / (src.width * src.height);
    if (areaRatio < 0.27 || areaRatio > 0.88) return false;

    const top = distance(candidate[0], candidate[1]);
    const right = distance(candidate[1], candidate[2]);
    const bottom = distance(candidate[2], candidate[3]);
    const left = distance(candidate[3], candidate[0]);
    if (Math.min(top, bottom) < src.width * 0.40 || Math.min(left, right) < src.height * 0.47) return false;
    if (Math.max(top, bottom) / Math.max(1, Math.min(top, bottom)) > 1.24) return false;
    if (Math.max(left, right) / Math.max(1, Math.min(left, right)) > 1.24) return false;

    const longSide = Math.max((top + bottom) / 2, (left + right) / 2);
    const shortSide = Math.max(1, Math.min((top + bottom) / 2, (left + right) / 2));
    const ratio = longSide / shortSide;
    if (ratio < 1.08 || ratio > 1.90) return false;

    const centerX = candidate.reduce((sum, point) => sum + point.x, 0) / 4;
    const centerY = candidate.reduce((sum, point) => sum + point.y, 0) / 4;
    if (Math.abs(centerX - src.width / 2) > src.width * 0.18 ||
        Math.abs(centerY - src.height / 2) > src.height * 0.18) return false;

    // The lower edge must remain in the lower half and must not cut through the page body.
    if ((candidate[2].y + candidate[3].y) / 2 < src.height * 0.67) return false;

    const minSide = Math.min(src.width, src.height);
    const borderLimit = minSide * 0.018;
    const touching = candidate.filter(point =>
      Math.min(point.x, point.y, src.width - point.x, src.height - point.y) < borderLimit
    ).length;
    return touching === 0;
  }

  function candidateScore(candidate, areaRatio, support, residual) {
    const supportTotal = support.top + support.right + support.bottom + support.left;
    const residualPenalty = residual / Math.max(1, Math.min(src.width, src.height));
    const centerX = candidate.reduce((sum, point) => sum + point.x, 0) / 4;
    const centerY = candidate.reduce((sum, point) => sum + point.y, 0) / 4;
    const centerPenalty = Math.hypot(centerX - src.width / 2, centerY - src.height / 2) /
      Math.hypot(src.width / 2, src.height / 2);
    return areaRatio * 9 + supportTotal * 0.025 - residualPenalty * 5 - centerPenalty;
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
      cv.GaussianBlur(gray, blur, new cv.Size(9, 9), 0);

      const roiWidth = Math.max(20, Math.round(small.cols * 0.18));
      const roiHeight = Math.max(20, Math.round(small.rows * 0.18));
      centerRoi = gray.roi(new cv.Rect(
        Math.round((small.cols - roiWidth) / 2),
        Math.round((small.rows - roiHeight) / 2),
        roiWidth,
        roiHeight
      ));
      const centerMean = cv.mean(centerRoi)[0];
      const thresholds = [
        clamp(Math.round(centerMean - 76), 75, 174),
        clamp(Math.round(centerMean - 58), 90, 190),
        clamp(Math.round(centerMean - 42), 105, 204),
        clamp(Math.round(centerMean - 27), 120, 218),
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

          let closeSize = Math.max(17, Math.round(Math.min(small.cols, small.rows) / 22));
          if (closeSize % 2 === 0) closeSize++;
          closeSize = Math.min(closeSize, 67);
          closeKernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(closeSize, closeSize));
          openKernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(5, 5));
          cv.morphologyEx(mask, mask, cv.MORPH_CLOSE, closeKernel);
          cv.morphologyEx(mask, mask, cv.MORPH_OPEN, openKernel);

          contours = new cv.MatVector();
          hierarchy = new cv.Mat();
          cv.findContours(mask, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_NONE);
          const centerPoint = new cv.Point(small.cols / 2, small.rows / 2);

          for (let index = 0; index < contours.size(); index++) {
            const contour = contours.get(index);
            try {
              const areaRatio = Math.abs(cv.contourArea(contour)) / (small.cols * small.rows);
              if (areaRatio < 0.23 || areaRatio > 0.90) continue;
              if (cv.pointPolygonTest(contour, centerPoint, false) < 0) continue;
              const rect = cv.boundingRect(contour);
              if (rect.width < small.cols * 0.47 || rect.height < small.rows * 0.52) continue;
              if (rect.width > small.cols * 0.97 && rect.height > small.rows * 0.97) continue;

              const fitted = fitContourEdges(contour, rect, scale);
              if (!fitted || !validCandidate(fitted.points)) continue;
              candidates.push({
                points: fitted.points,
                support: fitted.support,
                residual: fitted.residual,
                areaRatio,
                threshold: thresholdValue === 0 ? 'Otsu' : thresholdValue,
                score: candidateScore(fitted.points, areaRatio, fitted.support, fitted.residual)
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
    setStatus('正在建立中央紙張遮罩，並以輪廓四邊迴歸計算角點……');

    setTimeout(() => {
      let result = null;
      try {
        result = detectFromCentralMask();
        if (!result) throw new Error('遮罩四邊資料不足');
        points = result.points.map(point => ({
          x: clamp(point.x, 0, src.width),
          y: clamp(point.y, 0, src.height)
        }));
        draw();
        const support = result.support;
        setStatus(`已由紙張輪廓四邊重新計算角點（上${support.top}、右${support.right}、下${support.bottom}、左${support.left}個有效區段）。請確認藍框。`, 'ready');
      } catch (error) {
        console.warn('Central mask edge regression failed:', error);
      } finally {
        detectButton.disabled = false;
      }

      if (!result) {
        setStatus('中央遮罩四邊資料不足，正在改用雙引擎外緣偵測……');
        fallbackDetect.call(detectButton);
      }
    }, 60);
  };
})();
