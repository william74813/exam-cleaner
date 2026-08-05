(() => {
  'use strict';

  const detectButton = document.getElementById('detect');
  if (!detectButton || typeof detectButton.onclick !== 'function') return;

  const originalDetect = detectButton.onclick;
  const heading = document.querySelector('header h1');
  const subtitle = document.querySelector('header p');
  if (heading) heading.innerHTML = 'Exam Cleaner v2.1 <span class="badge">RC2.5</span>';
  if (subtitle) subtitle.textContent = '雙引擎偵測＋四邊共同擬合＋灰階增強＋多頁 PDF';

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
    let total = 0;
    let count = 0;
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

  function robustOffsetFit(samples) {
    if (samples.length < 7) return null;
    const slopes = [];
    for (let i = 0; i < samples.length; i++) {
      for (let j = i + 1; j < samples.length; j++) {
        const dt = samples[j].t - samples[i].t;
        if (Math.abs(dt) > 0.02) slopes.push((samples[j].offset - samples[i].offset) / dt);
      }
    }
    if (!slopes.length) return null;

    const slope = median(slopes);
    const intercept = median(samples.map(sample => sample.offset - slope * sample.t));
    const residuals = samples.map(sample => Math.abs(sample.offset - (slope * sample.t + intercept)));
    const mad = Math.max(1, median(residuals));
    const limit = Math.max(4, mad * 2.8);
    const inliers = samples.filter((sample, index) => residuals[index] <= limit);
    if (inliers.length < 6) return null;

    let sumT = 0, sumO = 0, sumTT = 0, sumTO = 0, sumWeight = 0;
    for (const sample of inliers) {
      const weight = clamp(sample.contrast / 18, 0.7, 2.4);
      sumT += sample.t * weight;
      sumO += sample.offset * weight;
      sumTT += sample.t * sample.t * weight;
      sumTO += sample.t * sample.offset * weight;
      sumWeight += weight;
    }
    const denominator = sumWeight * sumTT - sumT * sumT;
    const refinedSlope = Math.abs(denominator) > 1e-6
      ? (sumWeight * sumTO - sumT * sumO) / denominator
      : slope;
    const refinedIntercept = (sumO - refinedSlope * sumT) / sumWeight;
    const meanContrast = inliers.reduce((sum, sample) => sum + sample.contrast, 0) / inliers.length;

    return {
      slope: refinedSlope,
      intercept: refinedIntercept,
      inliers,
      meanContrast
    };
  }

  function fitEdge(image, first, second, label) {
    const dx = second.x - first.x;
    const dy = second.y - first.y;
    const length = Math.hypot(dx, dy);
    if (length < Math.min(src.width, src.height) * 0.28) return null;

    // Points are ordered clockwise. This normal points toward the paper interior.
    const nx = -dy / length;
    const ny = dx / length;
    const minSide = Math.min(src.width, src.height);
    const searchRadius = Math.max(34, minSide * 0.09);
    const sampleGap = Math.max(10, minSide * 0.016);
    const patchRadius = Math.max(2, Math.round(minSide / 430));
    const searchStep = Math.max(2, Math.round(minSide / 390));
    const sampleCount = 31;
    const samples = [];

    for (let index = 0; index < sampleCount; index++) {
      const t = 0.06 + (0.88 * index) / (sampleCount - 1);
      const expectedX = first.x + dx * t;
      const expectedY = first.y + dy * t;
      let best = null;

      for (let offset = -searchRadius; offset <= searchRadius; offset += searchStep) {
        const x = expectedX + nx * offset;
        const y = expectedY + ny * offset;
        if (x < 3 || x >= src.width - 3 || y < 3 || y >= src.height - 3) continue;

        const inside1 = patchMean(image, x + nx * sampleGap, y + ny * sampleGap, patchRadius);
        const outside1 = patchMean(image, x - nx * sampleGap, y - ny * sampleGap, patchRadius);
        const inside2 = patchMean(image, x + nx * sampleGap * 0.48, y + ny * sampleGap * 0.48, patchRadius);
        const outside2 = patchMean(image, x - nx * sampleGap * 0.48, y - ny * sampleGap * 0.48, patchRadius);
        const contrast = (inside1 - outside1) + (inside2 - outside2) * 0.72;
        const brightnessBonus = clamp((inside1 - 105) / 25, -2, 3);
        const distancePenalty = Math.abs(offset) / searchRadius * 7.5;
        const score = contrast + brightnessBonus - distancePenalty;

        if ((!best || score > best.score) && inside1 > 82) {
          best = { t, offset, contrast, score, x, y };
        }
      }

      if (best && best.contrast > 7.5) samples.push(best);
    }

    const fit = robustOffsetFit(samples);
    if (!fit || fit.inliers.length < 7 || fit.meanContrast < 8) return null;

    const startOffset = fit.intercept;
    const endOffset = fit.slope + fit.intercept;
    const maxEndpointShift = minSide * 0.105;
    if (Math.abs(startOffset) > maxEndpointShift || Math.abs(endOffset) > maxEndpointShift) return null;

    const p1 = { x: first.x + nx * startOffset, y: first.y + ny * startOffset };
    const p2 = { x: second.x + nx * endOffset, y: second.y + ny * endOffset };
    return {
      label,
      p1,
      p2,
      inliers: fit.inliers.length,
      meanContrast: fit.meanContrast
    };
  }

  function lineThrough(first, second) {
    const A = first.y - second.y;
    const B = second.x - first.x;
    const C = first.x * second.y - second.x * first.y;
    const normal = Math.hypot(A, B) || 1;
    return { A: A / normal, B: B / normal, C: C / normal };
  }

  function intersection(first, second) {
    const determinant = first.A * second.B - second.A * first.B;
    if (Math.abs(determinant) < 1e-6) return null;
    return {
      x: (first.B * second.C - second.B * first.C) / determinant,
      y: (first.C * second.A - second.C * first.A) / determinant
    };
  }

  function polygonArea(candidate) {
    return Math.abs(candidate.reduce((sum, point, index) => {
      const next = candidate[(index + 1) % candidate.length];
      return sum + point.x * next.y - next.x * point.y;
    }, 0)) / 2;
  }

  function validCandidate(candidate, original) {
    if (!candidate || candidate.length !== 4) return false;
    if (!candidate.every(point => point && Number.isFinite(point.x) && Number.isFinite(point.y) &&
      point.x >= 0 && point.x <= src.width && point.y >= 0 && point.y <= src.height)) return false;

    const areaRatio = polygonArea(candidate) / (src.width * src.height);
    if (areaRatio < 0.28 || areaRatio > 0.94) return false;

    const top = distance(candidate[0], candidate[1]);
    const right = distance(candidate[1], candidate[2]);
    const bottom = distance(candidate[2], candidate[3]);
    const left = distance(candidate[3], candidate[0]);
    if (Math.min(top, bottom) < src.width * 0.38 || Math.min(left, right) < src.height * 0.42) return false;
    if (Math.max(top, bottom) / Math.max(1, Math.min(top, bottom)) > 1.28) return false;
    if (Math.max(left, right) / Math.max(1, Math.min(left, right)) > 1.28) return false;

    const minSide = Math.min(src.width, src.height);
    const maxCornerMove = minSide * 0.125;
    if (candidate.some((point, index) => distance(point, original[index]) > maxCornerMove)) return false;

    // Keep clockwise order and reject folded/self-crossing shapes.
    const crossSigns = [];
    for (let index = 0; index < 4; index++) {
      const a = candidate[index];
      const b = candidate[(index + 1) % 4];
      const c = candidate[(index + 2) % 4];
      crossSigns.push((b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x));
    }
    return crossSigns.every(value => value > 0) || crossSigns.every(value => value < 0);
  }

  function alignAllEdges(candidate) {
    if (!base || !candidate || candidate.length !== 4) return null;
    const original = candidate.map(point => ({ ...point }));
    const edges = [
      fitEdge(base, original[0], original[1], '上'),
      fitEdge(base, original[1], original[2], '右'),
      fitEdge(base, original[2], original[3], '下'),
      fitEdge(base, original[3], original[0], '左')
    ];
    if (edges.some(edge => !edge)) return null;

    const lines = edges.map(edge => lineThrough(edge.p1, edge.p2));
    const refined = [
      intersection(lines[3], lines[0]),
      intersection(lines[0], lines[1]),
      intersection(lines[1], lines[2]),
      intersection(lines[2], lines[3])
    ];
    if (!validCandidate(refined, original)) return null;

    const totalMove = refined.reduce((sum, point, index) => sum + distance(point, original[index]), 0);
    const minSide = Math.min(src.width, src.height);
    if (totalMove < minSide * 0.008) return null;

    return {
      points: refined.map(point => ({
        x: clamp(point.x, 0, src.width),
        y: clamp(point.y, 0, src.height)
      })),
      edges
    };
  }

  function alignAfterDetection() {
    let startedBusy = false;
    const startedAt = Date.now();

    const watch = () => {
      if (detectButton.disabled) startedBusy = true;
      if (startedBusy && !detectButton.disabled) {
        setTimeout(() => {
          try {
            const current = Array.isArray(points) ? points.map(point => ({ ...point })) : null;
            const aligned = alignAllEdges(current);
            if (aligned) {
              points = aligned.points;
              draw();
              const detail = aligned.edges.map(edge => `${edge.label}${edge.inliers}`).join('、');
              setStatus(`已以四邊共同擬合重新計算四角（有效邊界點：${detail}）。請確認藍框。`, 'ready');
            } else {
              setStatus('自動偵測完成；四邊共同擬合資料不足，已保留原始結果，可拖曳微調。', 'ready');
            }
          } catch (error) {
            console.warn('Four-edge alignment skipped:', error);
          }
        }, 180);
        return;
      }
      if (Date.now() - startedAt < 12000) requestAnimationFrame(watch);
    };

    requestAnimationFrame(watch);
  }

  detectButton.onclick = function fourEdgeDetect(event) {
    originalDetect.call(this, event);
    alignAfterDetection();
  };
})();
