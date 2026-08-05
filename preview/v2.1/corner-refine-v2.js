(() => {
  'use strict';

  const detectButton = document.getElementById('detect');
  if (!detectButton || typeof detectButton.onclick !== 'function') return;

  const originalDetect = detectButton.onclick;
  const heading = document.querySelector('header h1');
  const subtitle = document.querySelector('header p');
  if (heading) heading.innerHTML = 'Exam Cleaner v2.1 <span class="badge">RC2.2</span>';
  if (subtitle) subtitle.textContent = '雙引擎偵測＋四角異常校驗＋灰階增強＋多頁 PDF';

  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const names = ['左上角', '右上角', '右下角', '左下角'];

  function validPoint(point) {
    return point && Number.isFinite(point.x) && Number.isFinite(point.y) &&
      point.x >= 0 && point.x <= src.width && point.y >= 0 && point.y <= src.height;
  }

  function polygonArea(candidate) {
    return Math.abs(candidate.reduce((sum, point, index) => {
      const next = candidate[(index + 1) % candidate.length];
      return sum + point.x * next.y - next.x * point.y;
    }, 0)) / 2;
  }

  function repairLowerCorner(candidate) {
    if (!candidate || candidate.length !== 4) return null;
    const [tl, tr, br, bl] = candidate.map(point => ({ ...point }));
    const top = distance(tl, tr), right = distance(tr, br);
    const bottom = distance(br, bl), left = distance(bl, tl);
    const h = src.height, w = src.width;
    const topSlope = tr.y - tl.y;

    const leftGap = br.y - bl.y;
    const leftRayY = bl.y - tl.y;
    if (leftGap > h * 0.055 && left < right * 0.94 && leftRayY > h * 0.34) {
      const targetY = br.y + clamp(topSlope, -h * 0.025, h * 0.025);
      const factor = (targetY - tl.y) / leftRayY;
      if (factor > 1.015 && factor < 1.48) {
        const newBL = { x: tl.x + (bl.x - tl.x) * factor, y: targetY };
        const proposed = [tl, tr, br, newBL];
        const ratio = polygonArea(proposed) / (w * h);
        const proposedBottom = distance(br, newBL);
        if (validPoint(newBL) && proposedBottom >= top * 0.82 && proposedBottom <= top * 1.35 && ratio >= 0.30 && ratio <= 0.94) {
          return { points: proposed, index: 3 };
        }
      }
    }

    const rightGap = bl.y - br.y;
    const rightRayY = br.y - tr.y;
    if (rightGap > h * 0.055 && right < left * 0.94 && rightRayY > h * 0.34) {
      const targetY = bl.y + clamp(topSlope, -h * 0.025, h * 0.025);
      const factor = (targetY - tr.y) / rightRayY;
      if (factor > 1.015 && factor < 1.48) {
        const newBR = { x: tr.x + (br.x - tr.x) * factor, y: targetY };
        const proposed = [tl, tr, newBR, bl];
        const ratio = polygonArea(proposed) / (w * h);
        const proposedBottom = distance(newBR, bl);
        if (validPoint(newBR) && proposedBottom >= top * 0.82 && proposedBottom <= top * 1.35 && ratio >= 0.30 && ratio <= 0.94) {
          return { points: proposed, index: 2 };
        }
      }
    }
    return null;
  }

  function borderDistance(point) {
    return Math.min(point.x, point.y, src.width - point.x, src.height - point.y);
  }

  function predictedCorner(candidate, index) {
    const previous = candidate[(index + 3) % 4];
    const next = candidate[(index + 1) % 4];
    const opposite = candidate[(index + 2) % 4];
    return {
      x: previous.x + next.x - opposite.x,
      y: previous.y + next.y - opposite.y
    };
  }

  function patchMean(image, x, y, radius) {
    const width = image.width, height = image.height, data = image.data;
    const minX = Math.max(0, Math.floor(x - radius));
    const maxX = Math.min(width - 1, Math.ceil(x + radius));
    const minY = Math.max(0, Math.floor(y - radius));
    const maxY = Math.min(height - 1, Math.ceil(y + radius));
    let total = 0, count = 0;
    for (let py = minY; py <= maxY; py++) {
      for (let px = minX; px <= maxX; px++) {
        const offset = (py * width + px) * 4;
        total += data[offset] * 0.299 + data[offset + 1] * 0.587 + data[offset + 2] * 0.114;
        count++;
      }
    }
    return count ? total / count : 0;
  }

  function contrastSnap(predicted, index) {
    if (!base || !predicted) return null;
    const minSide = Math.min(src.width, src.height);
    const searchRadius = Math.max(28, minSide * 0.105);
    const step = Math.max(3, Math.round(minSide / 230));
    const sampleDistance = Math.max(10, minSide * 0.019);
    const patchRadius = Math.max(2, Math.round(minSide / 330));
    const sx = (index === 0 || index === 3) ? 1 : -1;
    const sy = (index === 0 || index === 1) ? 1 : -1;
    let best = null;

    const startX = clamp(predicted.x - searchRadius, 1, src.width - 2);
    const endX = clamp(predicted.x + searchRadius, 1, src.width - 2);
    const startY = clamp(predicted.y - searchRadius, 1, src.height - 2);
    const endY = clamp(predicted.y + searchRadius, 1, src.height - 2);

    for (let y = startY; y <= endY; y += step) {
      for (let x = startX; x <= endX; x += step) {
        const inX = patchMean(base, x + sx * sampleDistance, y + sy * sampleDistance * 0.18, patchRadius);
        const outX = patchMean(base, x - sx * sampleDistance, y - sy * sampleDistance * 0.18, patchRadius);
        const inY = patchMean(base, x + sx * sampleDistance * 0.18, y + sy * sampleDistance, patchRadius);
        const outY = patchMean(base, x - sx * sampleDistance * 0.18, y - sy * sampleDistance, patchRadius);
        const inside = patchMean(base, x + sx * sampleDistance * 0.72, y + sy * sampleDistance * 0.72, patchRadius);
        const outside = patchMean(base, x - sx * sampleDistance * 0.72, y - sy * sampleDistance * 0.72, patchRadius);
        const contrast = (inX - outX) + (inY - outY) + (inside - outside) * 0.8;
        const distancePenalty = Math.hypot(x - predicted.x, y - predicted.y) / searchRadius * 10;
        const score = contrast - distancePenalty;
        if ((!best || score > best.score) && inside > 105) best = { x, y, score, contrast };
      }
    }
    return best && best.contrast > 17 ? { x: best.x, y: best.y } : null;
  }

  function repairBorderSnappedCorner(candidate) {
    if (!candidate || candidate.length !== 4) return null;
    const minSide = Math.min(src.width, src.height);
    const snapLimit = minSide * 0.022;
    const expectedInset = minSide * 0.032;
    const minMove = minSide * 0.026;

    for (let index = 0; index < 4; index++) {
      const point = candidate[index];
      if (borderDistance(point) > snapLimit) continue;
      const predicted = predictedCorner(candidate, index);
      if (!validPoint(predicted) || borderDistance(predicted) < expectedInset) continue;
      if (distance(point, predicted) < minMove) continue;

      const snapped = contrastSnap(predicted, index) || predicted;
      const proposed = candidate.map(item => ({ ...item }));
      proposed[index] = {
        x: clamp(snapped.x, 0, src.width),
        y: clamp(snapped.y, 0, src.height)
      };
      const areaRatio = polygonArea(proposed) / (src.width * src.height);
      const top = distance(proposed[0], proposed[1]);
      const right = distance(proposed[1], proposed[2]);
      const bottom = distance(proposed[2], proposed[3]);
      const left = distance(proposed[3], proposed[0]);
      if (areaRatio >= 0.28 && areaRatio <= 0.94 &&
          Math.min(top, bottom) > src.width * 0.38 &&
          Math.min(left, right) > src.height * 0.43) {
        return { points: proposed, index };
      }
    }
    return null;
  }

  function refineAfterDetection() {
    let startedBusy = false;
    const startedAt = Date.now();
    const watch = () => {
      if (detectButton.disabled) startedBusy = true;
      if (startedBusy && !detectButton.disabled) {
        try {
          let current = Array.isArray(points) ? points.map(point => ({ ...point })) : null;
          const repaired = repairLowerCorner(current);
          if (repaired) current = repaired.points;
          const borderRepair = repairBorderSnappedCorner(current);
          const finalRepair = borderRepair || repaired;
          if (finalRepair) {
            points = finalRepair.points;
            draw();
            setStatus(`已偵測紙張，並自動補正${names[finalRepair.index]}。請確認藍框後再進行透視校正。`, 'ready');
          }
        } catch (error) {
          console.warn('Corner refinement skipped:', error);
        }
        return;
      }
      if (Date.now() - startedAt < 12000) requestAnimationFrame(watch);
    };
    requestAnimationFrame(watch);
  }

  detectButton.onclick = function refinedDetect(event) {
    originalDetect.call(this, event);
    refineAfterDetection();
  };
})();
