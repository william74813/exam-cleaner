(() => {
  'use strict';

  const detectButton = document.getElementById('detect');
  if (!detectButton || typeof detectButton.onclick !== 'function') return;

  const originalDetect = detectButton.onclick;
  const heading = document.querySelector('header h1');
  const subtitle = document.querySelector('header p');
  if (heading) heading.innerHTML = 'Exam Cleaner v2.1 <span class="badge">RC2.1</span>';
  if (subtitle) subtitle.textContent = '雙引擎偵測＋異常角點補正＋灰階增強＋多頁 PDF';

  const clampValue = (value, min, max) => Math.max(min, Math.min(max, value));
  const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

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

    const [topLeft, topRight, bottomRight, bottomLeft] = candidate.map(point => ({ ...point }));
    const topLength = distance(topLeft, topRight);
    const rightLength = distance(topRight, bottomRight);
    const bottomLength = distance(bottomRight, bottomLeft);
    const leftLength = distance(bottomLeft, topLeft);
    const height = src.height;
    const width = src.width;
    const topSlope = topRight.y - topLeft.y;

    let repaired = null;
    let repairedName = '';

    const leftGap = bottomRight.y - bottomLeft.y;
    const leftRayY = bottomLeft.y - topLeft.y;
    if (
      leftGap > height * 0.055 &&
      leftLength < rightLength * 0.94 &&
      leftRayY > height * 0.34
    ) {
      const targetY = bottomRight.y + clampValue(topSlope, -height * 0.025, height * 0.025);
      const factor = (targetY - topLeft.y) / leftRayY;
      if (factor > 1.015 && factor < 1.48) {
        const newBottomLeft = {
          x: topLeft.x + (bottomLeft.x - topLeft.x) * factor,
          y: targetY
        };
        const proposed = [topLeft, topRight, bottomRight, newBottomLeft];
        const proposedBottom = distance(bottomRight, newBottomLeft);
        const areaRatio = polygonArea(proposed) / (width * height);
        if (
          validPoint(newBottomLeft) &&
          proposedBottom >= topLength * 0.82 && proposedBottom <= topLength * 1.35 &&
          areaRatio >= 0.30 && areaRatio <= 0.94
        ) {
          repaired = proposed;
          repairedName = '左下角';
        }
      }
    }

    if (!repaired) {
      const rightGap = bottomLeft.y - bottomRight.y;
      const rightRayY = bottomRight.y - topRight.y;
      if (
        rightGap > height * 0.055 &&
        rightLength < leftLength * 0.94 &&
        rightRayY > height * 0.34
      ) {
        const targetY = bottomLeft.y + clampValue(topSlope, -height * 0.025, height * 0.025);
        const factor = (targetY - topRight.y) / rightRayY;
        if (factor > 1.015 && factor < 1.48) {
          const newBottomRight = {
            x: topRight.x + (bottomRight.x - topRight.x) * factor,
            y: targetY
          };
          const proposed = [topLeft, topRight, newBottomRight, bottomLeft];
          const proposedBottom = distance(newBottomRight, bottomLeft);
          const areaRatio = polygonArea(proposed) / (width * height);
          if (
            validPoint(newBottomRight) &&
            proposedBottom >= topLength * 0.82 && proposedBottom <= topLength * 1.35 &&
            areaRatio >= 0.30 && areaRatio <= 0.94
          ) {
            repaired = proposed;
            repairedName = '右下角';
          }
        }
      }
    }

    return repaired ? { points: repaired, name: repairedName } : null;
  }

  function refineAfterDetection() {
    let startedBusy = false;
    const startedAt = Date.now();

    const watch = () => {
      if (detectButton.disabled) startedBusy = true;

      if (startedBusy && !detectButton.disabled) {
        try {
          const current = Array.isArray(points) ? points.map(point => ({ ...point })) : null;
          const result = repairLowerCorner(current);
          if (result) {
            points = result.points;
            draw();
            setStatus(`已偵測紙張，並自動補正${result.name}。請確認藍框後再進行透視校正。`, 'ready');
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
