(() => {
  'use strict';

  const detectButton = document.getElementById('detect');
  if (!detectButton || typeof detectButton.onclick !== 'function') return;

  const originalDetect = detectButton.onclick;
  const heading = document.querySelector('header h1');
  const subtitle = document.querySelector('header p');
  if (heading) heading.innerHTML = 'Exam Cleaner v2.1 <span class="badge">RC2.3</span>';
  if (subtitle) subtitle.textContent = '雙引擎偵測＋左側整邊擬合＋灰階增強＋多頁 PDF';

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

  function robustFit(samples) {
    if (samples.length < 6) return null;
    const slopes = [];
    for (let i = 0; i < samples.length; i++) {
      for (let j = i + 1; j < samples.length; j++) {
        const dy = samples[j].y - samples[i].y;
        if (Math.abs(dy) > 1) slopes.push((samples[j].x - samples[i].x) / dy);
      }
    }
    if (!slopes.length) return null;
    const slope = median(slopes);
    const intercept = median(samples.map(point => point.x - slope * point.y));
    const residuals = samples.map(point => Math.abs(point.x - (slope * point.y + intercept)));
    const mad = Math.max(1, median(residuals));
    const inliers = samples.filter((point, index) => residuals[index] <= Math.max(5, mad * 2.8));
    if (inliers.length < 5) return null;

    let sumY = 0, sumX = 0, sumYY = 0, sumYX = 0;
    for (const point of inliers) {
      sumY += point.y; sumX += point.x;
      sumYY += point.y * point.y; sumYX += point.y * point.x;
    }
    const n = inliers.length;
    const denominator = n * sumYY - sumY * sumY;
    const refinedSlope = Math.abs(denominator) > 1e-6 ? (n * sumYX - sumY * sumX) / denominator : slope;
    const refinedIntercept = (sumX - refinedSlope * sumY) / n;
    return { slope: refinedSlope, intercept: refinedIntercept, inliers };
  }

  function lineThrough(first, second) {
    const A = first.y - second.y;
    const B = second.x - first.x;
    const C = first.x * second.y - second.x * first.y;
    return { A, B, C };
  }

  function intersectWithFittedEdge(line, fit) {
    // Fitted edge: x - slope*y - intercept = 0.
    const A2 = 1, B2 = -fit.slope, C2 = -fit.intercept;
    const determinant = line.A * B2 - A2 * line.B;
    if (Math.abs(determinant) < 1e-6) return null;
    return {
      x: (line.B * C2 - B2 * line.C) / determinant,
      y: (line.C * A2 - C2 * line.A) / determinant
    };
  }

  function fitLeftPaperEdge(candidate) {
    if (!base || !candidate || candidate.length !== 4) return null;
    const [tl, tr, br, bl] = candidate;
    const image = base;
    const minSide = Math.min(src.width, src.height);
    const yStart = tl.y + (bl.y - tl.y) * 0.06;
    const yEnd = tl.y + (bl.y - tl.y) * 0.94;
    if (yEnd - yStart < src.height * 0.34) return null;

    const rowCount = 25;
    const searchRadius = Math.max(22, src.width * 0.055);
    const sampleGap = Math.max(8, minSide * 0.014);
    const patchRadius = Math.max(2, Math.round(minSide / 420));
    const xStep = Math.max(2, Math.round(minSide / 360));
    const samples = [];

    for (let row = 0; row < rowCount; row++) {
      const t = row / (rowCount - 1);
      const y = yStart + (yEnd - yStart) * t;
      const expectedX = tl.x + (bl.x - tl.x) * ((y - tl.y) / Math.max(1, bl.y - tl.y));
      let best = null;
      const startX = clamp(expectedX - searchRadius, 2, src.width - 3);
      const endX = clamp(expectedX + searchRadius, 2, src.width - 3);

      for (let x = startX; x <= endX; x += xStep) {
        const outside = patchMean(image, x - sampleGap, y, patchRadius);
        const inside = patchMean(image, x + sampleGap, y, patchRadius);
        const nearOutside = patchMean(image, x - sampleGap * 0.45, y, patchRadius);
        const nearInside = patchMean(image, x + sampleGap * 0.45, y, patchRadius);
        const contrast = (inside - outside) + (nearInside - nearOutside) * 0.75;
        const distancePenalty = Math.abs(x - expectedX) / searchRadius * 7;
        const score = contrast - distancePenalty;
        if ((!best || score > best.score) && inside > 100) best = { x, y, score, contrast };
      }
      if (best && best.contrast > 11) samples.push(best);
    }

    const fit = robustFit(samples);
    if (!fit || fit.inliers.length < 7) return null;

    const topLine = lineThrough(tl, tr);
    const bottomLine = lineThrough(bl, br);
    const newTL = intersectWithFittedEdge(topLine, fit);
    const newBL = intersectWithFittedEdge(bottomLine, fit);
    if (!newTL || !newBL) return null;

    newTL.x = clamp(newTL.x, 0, src.width); newTL.y = clamp(newTL.y, 0, src.height);
    newBL.x = clamp(newBL.x, 0, src.width); newBL.y = clamp(newBL.y, 0, src.height);

    const maxMove = minSide * 0.075;
    if (distance(newTL, tl) > maxMove || distance(newBL, bl) > maxMove) return null;
    if (newBL.y - newTL.y < src.height * 0.42) return null;

    const proposed = [newTL, { ...tr }, { ...br }, newBL];
    const oldLeft = distance(tl, bl);
    const newLeft = distance(newTL, newBL);
    const right = distance(tr, br);
    if (newLeft < right * 0.78 || newLeft > right * 1.22) return null;

    const totalMove = distance(newTL, tl) + distance(newBL, bl);
    if (totalMove < minSide * 0.006) return null;
    return { points: proposed, samples: fit.inliers.length };
  }

  function alignAfterDetection() {
    let startedBusy = false;
    const startedAt = Date.now();
    const watch = () => {
      if (detectButton.disabled) startedBusy = true;
      if (startedBusy && !detectButton.disabled) {
        // Let the existing four-corner refinement finish first.
        setTimeout(() => {
          try {
            const current = Array.isArray(points) ? points.map(point => ({ ...point })) : null;
            const aligned = fitLeftPaperEdge(current);
            if (aligned) {
              points = aligned.points;
              draw();
              setStatus(`已偵測紙張，並以 ${aligned.samples} 個邊界點共同對齊左上與左下角。請確認藍框。`, 'ready');
            }
          } catch (error) {
            console.warn('Left-edge alignment skipped:', error);
          }
        }, 220);
        return;
      }
      if (Date.now() - startedAt < 12000) requestAnimationFrame(watch);
    };
    requestAnimationFrame(watch);
  }

  detectButton.onclick = function alignedDetect(event) {
    originalDetect.call(this, event);
    alignAfterDetection();
  };
})();
