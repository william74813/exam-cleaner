(() => {
  'use strict';

  const detectButton = document.getElementById('detect');
  if (!detectButton || typeof detectButton.onclick !== 'function') return;

  const originalDetect = detectButton.onclick;
  const heading = document.querySelector('header h1');
  const subtitle = document.querySelector('header p');
  if (heading) heading.innerHTML = 'Exam Cleaner v2.1 <span class="badge">RC2.4</span>';
  if (subtitle) subtitle.textContent = '雙引擎偵測＋左側／上緣整邊擬合＋灰階增強＋多頁 PDF';

  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

  function grayAt(image, x, y) {
    x = clamp(Math.round(x), 0, image.width - 1);
    y = clamp(Math.round(y), 0, image.height - 1);
    const offset = (y * image.width + x) * 4;
    return image.data[offset] * 0.299 + image.data[offset + 1] * 0.587 + image.data[offset + 2] * 0.114;
  }

  function patchMean(image, x, y, radius) {
    const minX = clamp(Math.floor(x - radius), 0, image.width - 1);
    const maxX = clamp(Math.ceil(x + radius), 0, image.width - 1);
    const minY = clamp(Math.floor(y - radius), 0, image.height - 1);
    const maxY = clamp(Math.ceil(y + radius), 0, image.height - 1);
    let total = 0, count = 0;
    for (let py = minY; py <= maxY; py++) {
      for (let px = minX; px <= maxX; px++) {
        total += grayAt(image, px, py);
        count++;
      }
    }
    return count ? total / count : 0;
  }

  function median(values) {
    if (!values.length) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  }

  // Robustly fit y = slope*x + intercept.
  function robustFit(samples) {
    if (samples.length < 6) return null;
    const slopes = [];
    for (let i = 0; i < samples.length; i++) {
      for (let j = i + 1; j < samples.length; j++) {
        const dx = samples[j].x - samples[i].x;
        if (Math.abs(dx) > 1) slopes.push((samples[j].y - samples[i].y) / dx);
      }
    }
    if (!slopes.length) return null;
    const slope = median(slopes);
    const intercept = median(samples.map(point => point.y - slope * point.x));
    const residuals = samples.map(point => Math.abs(point.y - (slope * point.x + intercept)));
    const mad = Math.max(1, median(residuals));
    const inliers = samples.filter((point, index) => residuals[index] <= Math.max(5, mad * 2.8));
    if (inliers.length < 6) return null;

    let sumX = 0, sumY = 0, sumXX = 0, sumXY = 0;
    for (const point of inliers) {
      sumX += point.x; sumY += point.y;
      sumXX += point.x * point.x; sumXY += point.x * point.y;
    }
    const n = inliers.length;
    const denominator = n * sumXX - sumX * sumX;
    const refinedSlope = Math.abs(denominator) > 1e-6 ? (n * sumXY - sumX * sumY) / denominator : slope;
    const refinedIntercept = (sumY - refinedSlope * sumX) / n;
    return { slope: refinedSlope, intercept: refinedIntercept, inliers };
  }

  function lineThrough(first, second) {
    return {
      A: first.y - second.y,
      B: second.x - first.x,
      C: first.x * second.y - second.x * first.y
    };
  }

  function intersectWithFittedTop(line, fit) {
    // Fitted top: -slope*x + y - intercept = 0.
    const A2 = -fit.slope, B2 = 1, C2 = -fit.intercept;
    const determinant = line.A * B2 - A2 * line.B;
    if (Math.abs(determinant) < 1e-6) return null;
    return {
      x: (line.B * C2 - B2 * line.C) / determinant,
      y: (line.C * A2 - C2 * line.A) / determinant
    };
  }

  function polygonArea(candidate) {
    return Math.abs(candidate.reduce((sum, point, index) => {
      const next = candidate[(index + 1) % candidate.length];
      return sum + point.x * next.y - next.x * point.y;
    }, 0)) / 2;
  }

  function fitTopPaperEdge(candidate) {
    if (!base || !candidate || candidate.length !== 4) return null;
    const [tl, tr, br, bl] = candidate;
    const minSide = Math.min(src.width, src.height);
    const xStart = tl.x + (tr.x - tl.x) * 0.08;
    const xEnd = tl.x + (tr.x - tl.x) * 0.92;
    if (xEnd - xStart < src.width * 0.34) return null;

    const columnCount = 29;
    const searchRadius = Math.max(24, src.height * 0.06);
    const sampleGap = Math.max(8, minSide * 0.014);
    const patchRadius = Math.max(2, Math.round(minSide / 420));
    const yStep = Math.max(2, Math.round(minSide / 360));
    const samples = [];

    for (let column = 0; column < columnCount; column++) {
      const t = column / (columnCount - 1);
      const x = xStart + (xEnd - xStart) * t;
      const expectedY = tl.y + (tr.y - tl.y) * ((x - tl.x) / Math.max(1, tr.x - tl.x));
      let best = null;
      const startY = clamp(expectedY - searchRadius, 2, src.height - 3);
      const endY = clamp(expectedY + searchRadius, 2, src.height - 3);

      for (let y = startY; y <= endY; y += yStep) {
        const outside = patchMean(base, x, y - sampleGap, patchRadius);
        const inside = patchMean(base, x, y + sampleGap, patchRadius);
        const nearOutside = patchMean(base, x, y - sampleGap * 0.45, patchRadius);
        const nearInside = patchMean(base, x, y + sampleGap * 0.45, patchRadius);
        const contrast = (inside - outside) + (nearInside - nearOutside) * 0.75;
        const distancePenalty = Math.abs(y - expectedY) / searchRadius * 7;
        const score = contrast - distancePenalty;
        if ((!best || score > best.score) && inside > 100) best = { x, y, score, contrast };
      }
      if (best && best.contrast > 11) samples.push(best);
    }

    const fit = robustFit(samples);
    if (!fit || fit.inliers.length < 8) return null;

    const rightLine = lineThrough(tr, br);
    const newTR = intersectWithFittedTop(rightLine, fit);
    if (!newTR) return null;
    newTR.x = clamp(newTR.x, 0, src.width);
    newTR.y = clamp(newTR.y, 0, src.height);

    const move = distance(newTR, tr);
    const minMove = minSide * 0.007;
    const maxMove = minSide * 0.10;
    if (move < minMove || move > maxMove) return null;

    const proposed = [{ ...tl }, newTR, { ...br }, { ...bl }];
    const areaRatio = polygonArea(proposed) / (src.width * src.height);
    const topLength = distance(tl, newTR);
    const bottomLength = distance(bl, br);
    const rightLength = distance(newTR, br);
    const leftLength = distance(tl, bl);
    if (areaRatio < 0.28 || areaRatio > 0.94) return null;
    if (topLength < bottomLength * 0.78 || topLength > bottomLength * 1.25) return null;
    if (rightLength < leftLength * 0.76 || rightLength > leftLength * 1.25) return null;

    // Reject an adjustment that moves the corner farther toward the photo frame.
    const oldFrameDistance = Math.min(src.width - tr.x, tr.y);
    const newFrameDistance = Math.min(src.width - newTR.x, newTR.y);
    if (newFrameDistance + minSide * 0.004 < oldFrameDistance && move > minSide * 0.02) return null;

    return { points: proposed, samples: fit.inliers.length, move };
  }

  function alignAfterDetection() {
    let startedBusy = false;
    const startedAt = Date.now();
    const watch = () => {
      if (detectButton.disabled) startedBusy = true;
      if (startedBusy && !detectButton.disabled) {
        // Wait for four-corner and left-edge refinement to finish.
        setTimeout(() => {
          try {
            const current = Array.isArray(points) ? points.map(point => ({ ...point })) : null;
            const aligned = fitTopPaperEdge(current);
            if (aligned) {
              points = aligned.points;
              draw();
              setStatus(`已偵測紙張，並以 ${aligned.samples} 個上緣點重新對齊角點 2。請確認藍框。`, 'ready');
            }
          } catch (error) {
            console.warn('Top-edge alignment skipped:', error);
          }
        }, 520);
        return;
      }
      if (Date.now() - startedAt < 12000) requestAnimationFrame(watch);
    };
    requestAnimationFrame(watch);
  }

  detectButton.onclick = function topAlignedDetect(event) {
    originalDetect.call(this, event);
    alignAfterDetection();
  };
})();
