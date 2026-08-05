(() => {
  'use strict';

  const detectButton = document.getElementById('detect');
  if (!detectButton || typeof detectButton.onclick !== 'function') return;

  const originalDetect = detectButton.onclick;
  const heading = document.querySelector('header h1');
  const subtitle = document.querySelector('header p');
  if (heading) heading.innerHTML = 'Exam Cleaner v2.1 <span class="badge">RC2.7</span>';
  if (subtitle) subtitle.textContent = '雙引擎偵測＋下方區域一致性校驗＋灰階增強＋多頁 PDF';

  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

  function grayAt(image, x, y) {
    const px = clamp(Math.round(x), 0, image.width - 1);
    const py = clamp(Math.round(y), 0, image.height - 1);
    const offset = (py * image.width + px) * 4;
    return image.data[offset] * 0.299 + image.data[offset + 1] * 0.587 + image.data[offset + 2] * 0.114;
  }

  function stripMean(image, x, y, halfWidth, halfHeight) {
    const minX = clamp(Math.floor(x - halfWidth), 0, image.width - 1);
    const maxX = clamp(Math.ceil(x + halfWidth), 0, image.width - 1);
    const minY = clamp(Math.floor(y - halfHeight), 0, image.height - 1);
    const maxY = clamp(Math.ceil(y + halfHeight), 0, image.height - 1);
    const xStep = Math.max(1, Math.round((maxX - minX + 1) / 12));
    const yStep = Math.max(1, Math.round((maxY - minY + 1) / 5));
    let total = 0, count = 0;
    for (let py = minY; py <= maxY; py += yStep) {
      for (let px = minX; px <= maxX; px += xStep) {
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
    if (samples.length < 10) return null;
    const slopes = [];
    for (let i = 0; i < samples.length; i++) {
      for (let j = i + 1; j < samples.length; j++) {
        const dx = samples[j].x - samples[i].x;
        if (Math.abs(dx) > src.width * 0.06) slopes.push((samples[j].y - samples[i].y) / dx);
      }
    }
    if (!slopes.length) return null;

    const slope = median(slopes);
    const intercept = median(samples.map(point => point.y - slope * point.x));
    const residuals = samples.map(point => Math.abs(point.y - (slope * point.x + intercept)));
    const mad = Math.max(1, median(residuals));
    const residualLimit = Math.max(src.height * 0.008, mad * 2.5);
    const inliers = samples.filter((point, index) => residuals[index] <= residualLimit);
    if (inliers.length < 10) return null;

    let sx = 0, sy = 0, sxx = 0, sxy = 0, sw = 0;
    for (const point of inliers) {
      const weight = clamp(point.contrast / 14, 0.7, 2.6);
      sx += point.x * weight;
      sy += point.y * weight;
      sxx += point.x * point.x * weight;
      sxy += point.x * point.y * weight;
      sw += weight;
    }
    const denominator = sw * sxx - sx * sx;
    const a = Math.abs(denominator) > 1e-6 ? (sw * sxy - sx * sy) / denominator : slope;
    const b = (sy - a * sx) / sw;
    const meanContrast = inliers.reduce((sum, point) => sum + point.contrast, 0) / inliers.length;
    const medianY = median(inliers.map(point => point.y));
    return { a, b, inliers, meanContrast, medianY };
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

  function supportByThird(samples) {
    const left = samples.filter(p => p.x < src.width * 0.40).length;
    const middle = samples.filter(p => p.x >= src.width * 0.40 && p.x <= src.width * 0.60).length;
    const right = samples.filter(p => p.x > src.width * 0.60).length;
    return left >= 3 && middle >= 2 && right >= 3;
  }

  function validateBottomContrast(image, line) {
    const gap = Math.max(12, src.height * 0.018);
    const halfWidth = Math.max(10, src.width * 0.018);
    const halfHeight = Math.max(3, src.height * 0.0045);
    const contrasts = [];
    for (let i = 0; i < 13; i++) {
      const x = src.width * (0.20 + i * 0.60 / 12);
      const y = line.a * x + line.b;
      if (y < src.height * 0.72 || y > src.height * 0.975) continue;
      const inside = stripMean(image, x, y - gap, halfWidth, halfHeight);
      const outside = stripMean(image, x, y + gap, halfWidth, halfHeight);
      contrasts.push(inside - outside);
    }
    return contrasts.length >= 9 && median(contrasts) > 7;
  }

  function estimateBottom(candidate) {
    if (!base || !candidate || candidate.length !== 4) return null;
    const [tl, tr, br, bl] = candidate;
    const image = base;
    const minSide = Math.min(src.width, src.height);
    const gap = Math.max(13, src.height * 0.018);
    const halfWidth = Math.max(12, src.width * 0.022);
    const halfHeight = Math.max(3, src.height * 0.0045);
    const yStep = Math.max(2, Math.round(minSide / 420));
    const samples = [];

    const sampleCount = 31;
    for (let index = 0; index < sampleCount; index++) {
      const x = src.width * (0.18 + index * 0.64 / (sampleCount - 1));
      const startY = Math.round(src.height * 0.70);
      const endY = Math.round(src.height * 0.965);
      let best = null;

      for (let y = startY; y <= endY; y += yStep) {
        const insideFar = stripMean(image, x, y - gap, halfWidth, halfHeight);
        const outsideFar = stripMean(image, x, y + gap, halfWidth, halfHeight);
        const insideNear = stripMean(image, x, y - gap * 0.48, halfWidth, halfHeight);
        const outsideNear = stripMean(image, x, y + gap * 0.48, halfWidth, halfHeight);
        const contrast = (insideFar - outsideFar) + (insideNear - outsideNear) * 0.68;
        const lowerPreference = (y - startY) / Math.max(1, endY - startY) * 4.2;
        const score = contrast + lowerPreference;

        if ((!best || score > best.score) && insideFar > 70 && insideFar - outsideFar > 3.5) {
          best = { x, y, contrast, score };
        }
      }

      if (best && best.contrast > 8.5) samples.push(best);
    }

    const fit = robustLine(samples);
    if (!fit || !supportByThird(fit.inliers)) return null;
    if (fit.meanContrast < 10 || fit.medianY < src.height * 0.78) return null;
    if (Math.abs(fit.a) > 0.16) return null;
    if (!validateBottomContrast(image, fit)) return null;

    const leftLine = lineThrough(tl, bl);
    const rightLine = lineThrough(tr, br);
    const newBL = intersectBottom(leftLine, fit);
    const newBR = intersectBottom(rightLine, fit);
    if (!newBL || !newBR) return null;

    if (![newBL, newBR].every(point => Number.isFinite(point.x) && Number.isFinite(point.y))) return null;
    if (newBL.x < 0 || newBR.x > src.width || newBL.y > src.height || newBR.y > src.height) return null;
    if (newBL.y < src.height * 0.76 || newBR.y < src.height * 0.76) return null;

    const maxMove = minSide * 0.20;
    if (distance(newBL, bl) > maxMove || distance(newBR, br) > maxMove) return null;
    if (newBL.y < bl.y - src.height * 0.025 || newBR.y < br.y - src.height * 0.025) return null;

    const oldBottom = distance(bl, br);
    const newBottom = distance(newBL, newBR);
    if (newBottom < oldBottom * 0.80 || newBottom > oldBottom * 1.20) return null;

    const averageMove = (distance(newBL, bl) + distance(newBR, br)) / 2;
    if (averageMove < minSide * 0.008) return null;

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
              setStatus(`已保留角點 1、2，並由照片下方 ${refined.samples} 個一致邊界點補正角點 3、4。請確認藍框。`, 'ready');
            } else {
              setStatus('自動偵測完成；照片下方未取得足夠一致的紙張底邊，已保留基礎結果，請拖曳角點微調。', 'ready');
            }
          } catch (error) {
            console.warn('Bottom-region refinement skipped:', error);
          }
        }, 180);
        return;
      }
      if (Date.now() - startedAt < 12000) requestAnimationFrame(watch);
    };
    requestAnimationFrame(watch);
  }

  detectButton.onclick = function bottomRegionDetect(event) {
    originalDetect.call(this, event);
    refineAfterDetection();
  };
})();
