(() => {
  'use strict';

  const detectButton = document.getElementById('detect');
  if (!detectButton || typeof detectButton.onclick !== 'function') return;

  const originalDetect = detectButton.onclick;
  const heading = document.querySelector('header h1');
  const subtitle = document.querySelector('header p');
  if (heading) heading.innerHTML = 'Exam Cleaner v2.1 <span class="badge">RC2.6</span>';
  if (subtitle) subtitle.textContent = '雙引擎偵測＋保守下緣補正＋灰階增強＋多頁 PDF';

  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

  function grayAt(image, x, y) {
    const px = clamp(Math.round(x), 0, image.width - 1);
    const py = clamp(Math.round(y), 0, image.height - 1);
    const offset = (py * image.width + px) * 4;
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

  function robustLine(samples) {
    if (samples.length < 8) return null;
    const slopes = [];
    for (let i = 0; i < samples.length; i++) {
      for (let j = i + 1; j < samples.length; j++) {
        const dx = samples[j].x - samples[i].x;
        if (Math.abs(dx) > 8) slopes.push((samples[j].y - samples[i].y) / dx);
      }
    }
    if (!slopes.length) return null;
    const slope = median(slopes);
    const intercept = median(samples.map(point => point.y - slope * point.x));
    const residuals = samples.map(point => Math.abs(point.y - (slope * point.x + intercept)));
    const mad = Math.max(1, median(residuals));
    const inliers = samples.filter((point, index) => residuals[index] <= Math.max(5, mad * 2.6));
    if (inliers.length < 7) return null;

    let sx = 0, sy = 0, sxx = 0, sxy = 0;
    for (const point of inliers) {
      sx += point.x; sy += point.y; sxx += point.x * point.x; sxy += point.x * point.y;
    }
    const n = inliers.length;
    const denominator = n * sxx - sx * sx;
    const a = Math.abs(denominator) > 1e-6 ? (n * sxy - sx * sy) / denominator : slope;
    const b = (sy - a * sx) / n;
    const meanContrast = inliers.reduce((sum, point) => sum + point.contrast, 0) / n;
    return { a, b, inliers, meanContrast };
  }

  function lineThrough(first, second) {
    const A = first.y - second.y;
    const B = second.x - first.x;
    const C = first.x * second.y - second.x * first.y;
    return { A, B, C };
  }

  function intersectBottom(side, bottom) {
    const A2 = bottom.a, B2 = -1, C2 = bottom.b;
    const determinant = side.A * B2 - A2 * side.B;
    if (Math.abs(determinant) < 1e-6) return null;
    return {
      x: (side.B * C2 - B2 * side.C) / determinant,
      y: (side.C * A2 - C2 * side.A) / determinant
    };
  }

  function estimateBottom(candidate) {
    if (!base || !candidate || candidate.length !== 4) return null;
    const [tl, tr, br, bl] = candidate;
    const image = base;
    const minSide = Math.min(src.width, src.height);
    const gap = Math.max(10, minSide * 0.018);
    const patchRadius = Math.max(2, Math.round(minSide / 420));
    const yStep = Math.max(2, Math.round(minSide / 380));
    const sampleCount = 27;
    const samples = [];

    for (let index = 0; index < sampleCount; index++) {
      const t = 0.07 + (0.86 * index) / (sampleCount - 1);
      const expectedX = bl.x + (br.x - bl.x) * t;
      const expectedY = bl.y + (br.y - bl.y) * t;
      const topAtX = tl.y + (tr.y - tl.y) * t;
      const pageHeight = Math.max(1, expectedY - topAtX);
      const startY = clamp(expectedY - pageHeight * 0.07, topAtX + pageHeight * 0.66, src.height - 4);
      const endY = clamp(expectedY + pageHeight * 0.24, startY + 2, src.height - 4);
      let best = null;

      for (let y = startY; y <= endY; y += yStep) {
        const insideFar = patchMean(image, expectedX, y - gap, patchRadius);
        const outsideFar = patchMean(image, expectedX, y + gap, patchRadius);
        const insideNear = patchMean(image, expectedX, y - gap * 0.45, patchRadius);
        const outsideNear = patchMean(image, expectedX, y + gap * 0.45, patchRadius);
        const contrast = (insideFar - outsideFar) + (insideNear - outsideNear) * 0.72;
        const distancePenalty = Math.abs(y - expectedY) / Math.max(1, pageHeight * 0.24) * 4.5;
        const lowerPreference = (y - startY) / Math.max(1, endY - startY) * 1.8;
        const score = contrast - distancePenalty + lowerPreference;
        if ((!best || score > best.score) && insideFar > 72) {
          best = { x: expectedX, y, contrast, score };
        }
      }

      if (best && best.contrast > 9) samples.push(best);
    }

    const fit = robustLine(samples);
    if (!fit || fit.inliers.length < 8 || fit.meanContrast < 10) return null;

    const leftLine = lineThrough(tl, bl);
    const rightLine = lineThrough(tr, br);
    const newBL = intersectBottom(leftLine, fit);
    const newBR = intersectBottom(rightLine, fit);
    if (!newBL || !newBR) return null;

    const maxMove = minSide * 0.16;
    if (distance(newBL, bl) > maxMove || distance(newBR, br) > maxMove) return null;
    if (newBL.y < tl.y + src.height * 0.48 || newBR.y < tr.y + src.height * 0.48) return null;
    if (newBL.y > src.height || newBR.y > src.height || newBL.x < 0 || newBR.x > src.width) return null;

    const oldBottom = distance(bl, br);
    const newBottom = distance(newBL, newBR);
    if (newBottom < oldBottom * 0.78 || newBottom > oldBottom * 1.22) return null;

    const averageMoveDown = ((newBL.y - bl.y) + (newBR.y - br.y)) / 2;
    if (averageMoveDown < minSide * 0.01) return null;

    return {
      points: [{ ...tl }, { ...tr }, newBR, newBL],
      samples: fit.inliers.length,
      contrast: fit.meanContrast
    };
  }

  function refineAfterDetection() {
    let startedBusy = false;
    const startedAt = Date.now();
    const watch = () => {
      if (detectButton.disabled) startedBusy = true;
      if (startedBusy && !detectButton.disabled) {
        setTimeout(() => {
          try {
            const current = Array.isArray(points) ? points.map(point => ({ ...point })) : null;
            const refined = estimateBottom(current);
            if (refined) {
              points = refined.points;
              draw();
              setStatus(`已保留上方角點，並以 ${refined.samples} 個紙張下緣點補正角點 3、4。請確認後再校正。`, 'ready');
            } else {
              setStatus('自動偵測完成；下緣資料不足，已保留基礎結果，必要時請拖曳角點微調。', 'ready');
            }
          } catch (error) {
            console.warn('Safe bottom refinement skipped:', error);
          }
        }, 180);
        return;
      }
      if (Date.now() - startedAt < 12000) requestAnimationFrame(watch);
    };
    requestAnimationFrame(watch);
  }

  detectButton.onclick = function safeBottomDetect(event) {
    originalDetect.call(this, event);
    refineAfterDetection();
  };
})();
