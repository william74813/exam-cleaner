(() => {
  'use strict';

  const btn = document.getElementById('detect');
  if (!btn) return;

  const heading = document.querySelector('header h1');
  const subtitle = document.querySelector('header p');
  if (heading) heading.innerHTML = 'Exam Cleaner v2.1 <span class="badge">RC2</span>';
  if (subtitle) subtitle.textContent = '雙引擎紙張偵測＋灰階去陰影＋多頁 PDF';

  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

  function polygonArea(pts) {
    return Math.abs(pts.reduce((sum, point, index) => {
      const next = pts[(index + 1) % pts.length];
      return sum + point.x * next.y - next.x * point.y;
    }, 0)) / 2;
  }

  function lineFromSegment(x1, y1, x2, y2, scale) {
    x1 /= scale; y1 /= scale; x2 /= scale; y2 /= scale;
    const A = y1 - y2, B = x2 - x1, C = x1 * y2 - x2 * y1;
    const normal = Math.hypot(A, B) || 1;
    return {
      A: A / normal, B: B / normal, C: C / normal,
      x1, y1, x2, y2,
      len: Math.hypot(x2 - x1, y2 - y1),
      mx: (x1 + x2) / 2, my: (y1 + y2) / 2
    };
  }

  function intersection(first, second) {
    const determinant = first.A * second.B - second.A * first.B;
    if (Math.abs(determinant) < 1e-6) return null;
    return {
      x: (first.B * second.C - second.B * first.C) / determinant,
      y: (first.C * second.A - second.C * first.A) / determinant
    };
  }

  function validCandidate(candidate, width, height) {
    if (!candidate || candidate.length !== 4) return false;
    if (!candidate.every(point => point &&
      point.x >= -width * 0.06 && point.x <= width * 1.06 &&
      point.y >= -height * 0.06 && point.y <= height * 1.06)) return false;

    const areaRatio = polygonArea(candidate) / (width * height);
    if (areaRatio < 0.30 || areaRatio > 0.94) return false;

    const top = dist(candidate[0], candidate[1]);
    const right = dist(candidate[1], candidate[2]);
    const bottom = dist(candidate[2], candidate[3]);
    const left = dist(candidate[3], candidate[0]);
    const longSide = Math.max((top + bottom) / 2, (left + right) / 2);
    const shortSide = Math.max(1, Math.min((top + bottom) / 2, (left + right) / 2));
    const ratio = longSide / shortSide;

    return ratio >= 1.06 && ratio <= 2.05 &&
      Math.min(top, bottom) >= width * 0.40 &&
      Math.min(left, right) >= height * 0.46;
  }

  function candidateScore(candidate, width, height, contrast = 0) {
    const areaRatio = polygonArea(candidate) / (width * height);
    const centerX = candidate.reduce((sum, point) => sum + point.x, 0) / 4;
    const centerY = candidate.reduce((sum, point) => sum + point.y, 0) / 4;
    const centerPenalty = Math.hypot(centerX - width / 2, centerY - height / 2) /
      Math.hypot(width / 2, height / 2);

    const top = dist(candidate[0], candidate[1]);
    const right = dist(candidate[1], candidate[2]);
    const bottom = dist(candidate[2], candidate[3]);
    const left = dist(candidate[3], candidate[0]);
    const ratio = Math.max((top + bottom) / 2, (left + right) / 2) /
      Math.max(1, Math.min((top + bottom) / 2, (left + right) / 2));

    return areaRatio * 8 - centerPenalty * 1.15 - Math.abs(ratio - Math.SQRT2) * 1.25 +
      Math.max(-0.4, Math.min(1.1, contrast / 35));
  }

  function bestLine(lines, side, width, height) {
    const horizontal = side === 'top' || side === 'bottom';
    const candidates = lines.filter(line => {
      const dx = Math.abs(line.x2 - line.x1), dy = Math.abs(line.y2 - line.y1);
      if (horizontal && dx <= dy * 1.8) return false;
      if (!horizontal && dy <= dx * 1.8) return false;
      if (horizontal && line.len < width * 0.24) return false;
      if (!horizontal && line.len < height * 0.24) return false;
      if (side === 'top' && line.my > height * 0.38) return false;
      if (side === 'bottom' && line.my < height * 0.62) return false;
      if (side === 'left' && line.mx > width * 0.34) return false;
      if (side === 'right' && line.mx < width * 0.66) return false;
      return true;
    });
    if (!candidates.length) return null;

    const target = side === 'top' ? height * 0.08 :
      side === 'bottom' ? height * 0.92 :
      side === 'left' ? width * 0.08 : width * 0.92;

    return candidates.sort((first, second) => {
      const firstCoord = horizontal ? first.my : first.mx;
      const secondCoord = horizontal ? second.my : second.mx;
      const firstScore = first.len * 1.25 - Math.abs(firstCoord - target) * 0.42;
      const secondScore = second.len * 1.25 - Math.abs(secondCoord - target) * 0.42;
      return secondScore - firstScore;
    })[0];
  }

  function detectWithLines(original) {
    let small, gray, blur, edges, lines, kernel;
    try {
      const scale = Math.min(1, 1200 / Math.max(original.cols, original.rows));
      small = new cv.Mat();
      cv.resize(original, small, new cv.Size(
        Math.max(1, Math.round(original.cols * scale)),
        Math.max(1, Math.round(original.rows * scale))
      ), 0, 0, cv.INTER_AREA);

      gray = new cv.Mat(); blur = new cv.Mat(); edges = new cv.Mat(); lines = new cv.Mat();
      cv.cvtColor(small, gray, cv.COLOR_RGBA2GRAY);
      cv.GaussianBlur(gray, blur, new cv.Size(5, 5), 0);
      cv.Canny(blur, edges, 20, 88);
      kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(3, 3));
      cv.dilate(edges, edges, kernel);
      cv.HoughLinesP(edges, lines, 1, Math.PI / 180, 34,
        Math.round(Math.min(small.cols, small.rows) * 0.14), 28);

      const all = [];
      for (let index = 0; index < lines.rows; index++) {
        const offset = index * 4;
        all.push(lineFromSegment(
          lines.data32S[offset], lines.data32S[offset + 1],
          lines.data32S[offset + 2], lines.data32S[offset + 3], scale
        ));
      }

      const top = bestLine(all, 'top', src.width, src.height);
      const bottom = bestLine(all, 'bottom', src.width, src.height);
      const left = bestLine(all, 'left', src.width, src.height);
      const right = bestLine(all, 'right', src.width, src.height);
      if (!top || !bottom || !left || !right) return null;

      const candidate = [
        intersection(top, left), intersection(top, right),
        intersection(bottom, right), intersection(bottom, left)
      ];
      if (!validCandidate(candidate, src.width, src.height)) return null;
      return { points: candidate, score: candidateScore(candidate, src.width, src.height), method: '外緣線段' };
    } finally {
      [small, gray, blur, edges, lines, kernel].forEach(item => {
        try { if (item) item.delete(); } catch (_) {}
      });
    }
  }

  function contourCorners(contour, scale) {
    if (!contour?.data32S || contour.data32S.length < 8) return null;
    let topLeft, topRight, bottomRight, bottomLeft;
    let minSum = Infinity, maxSum = -Infinity, minDiff = Infinity, maxDiff = -Infinity;

    for (let index = 0; index < contour.data32S.length; index += 2) {
      const x = contour.data32S[index] / scale;
      const y = contour.data32S[index + 1] / scale;
      const sum = x + y, diff = y - x;
      if (sum < minSum) { minSum = sum; topLeft = { x, y }; }
      if (sum > maxSum) { maxSum = sum; bottomRight = { x, y }; }
      if (diff < minDiff) { minDiff = diff; topRight = { x, y }; }
      if (diff > maxDiff) { maxDiff = diff; bottomLeft = { x, y }; }
    }
    return [topLeft, topRight, bottomRight, bottomLeft];
  }

  function meanBorder(gray) {
    const step = Math.max(4, Math.round(Math.min(gray.cols, gray.rows) / 100));
    const bandX = Math.max(1, Math.round(gray.cols * 0.055));
    const bandY = Math.max(1, Math.round(gray.rows * 0.055));
    let total = 0, count = 0;
    for (let y = 0; y < gray.rows; y += step) {
      for (let x = 0; x < gray.cols; x += step) {
        if (x < bandX || x >= gray.cols - bandX || y < bandY || y >= gray.rows - bandY) {
          total += gray.data[y * gray.cols + x];
          count++;
        }
      }
    }
    return count ? total / count : 0;
  }

  function meanInside(gray, candidate) {
    const minX = Math.max(0, Math.floor(Math.min(...candidate.map(point => point.x))));
    const maxX = Math.min(gray.cols - 1, Math.ceil(Math.max(...candidate.map(point => point.x))));
    const minY = Math.max(0, Math.floor(Math.min(...candidate.map(point => point.y))));
    const maxY = Math.min(gray.rows - 1, Math.ceil(Math.max(...candidate.map(point => point.y))));
    const step = Math.max(4, Math.round(Math.min(gray.cols, gray.rows) / 100));
    let total = 0, count = 0;

    function inside(point) {
      let value = false;
      for (let i = 0, j = candidate.length - 1; i < candidate.length; j = i++) {
        const a = candidate[i], b = candidate[j];
        const crosses = ((a.y > point.y) !== (b.y > point.y)) &&
          (point.x < (b.x - a.x) * (point.y - a.y) / ((b.y - a.y) || 1e-6) + a.x);
        if (crosses) value = !value;
      }
      return value;
    }

    for (let y = minY; y <= maxY; y += step) {
      for (let x = minX; x <= maxX; x += step) {
        if (inside({ x, y })) {
          total += gray.data[y * gray.cols + x];
          count++;
        }
      }
    }
    return count ? total / count : 0;
  }

  function detectWithPaperMask(original) {
    let small, gray, blur;
    const results = [];
    try {
      const scale = Math.min(1, 1100 / Math.max(original.cols, original.rows));
      small = new cv.Mat();
      cv.resize(original, small, new cv.Size(
        Math.max(1, Math.round(original.cols * scale)),
        Math.max(1, Math.round(original.rows * scale))
      ), 0, 0, cv.INTER_AREA);
      gray = new cv.Mat(); blur = new cv.Mat();
      cv.cvtColor(small, gray, cv.COLOR_RGBA2GRAY);
      cv.GaussianBlur(gray, blur, new cv.Size(9, 9), 0);
      const borderMean = meanBorder(gray);

      const passes = [
        { name: '亮紙區域', threshold: 0, otsu: true },
        { name: '中亮度紙張', threshold: 145 },
        { name: '高亮度紙張', threshold: 170 }
      ];

      for (const pass of passes) {
        let binary, closeKernel, openKernel, contours, hierarchy;
        try {
          binary = new cv.Mat();
          if (pass.otsu) {
            cv.threshold(blur, binary, 0, 255, cv.THRESH_BINARY + cv.THRESH_OTSU);
          } else {
            cv.threshold(blur, binary, pass.threshold, 255, cv.THRESH_BINARY);
          }

          let closeSize = Math.max(9, Math.round(Math.min(small.cols, small.rows) / 42));
          if (closeSize % 2 === 0) closeSize++;
          closeKernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(closeSize, closeSize));
          openKernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(5, 5));
          cv.morphologyEx(binary, binary, cv.MORPH_CLOSE, closeKernel);
          cv.morphologyEx(binary, binary, cv.MORPH_OPEN, openKernel);

          contours = new cv.MatVector(); hierarchy = new cv.Mat();
          cv.findContours(binary, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

          for (let index = 0; index < contours.size(); index++) {
            const contour = contours.get(index);
            try {
              const areaRatio = Math.abs(cv.contourArea(contour)) / (small.cols * small.rows);
              if (areaRatio < 0.25 || areaRatio > 0.95) continue;
              const rect = cv.boundingRect(contour);
              if (rect.width < small.cols * 0.46 || rect.height < small.rows * 0.50) continue;
              if (rect.width > small.cols * 0.985 && rect.height > small.rows * 0.985) continue;

              const candidate = contourCorners(contour, scale);
              if (!validCandidate(candidate, src.width, src.height)) continue;
              const smallCandidate = candidate.map(point => ({ x: point.x * scale, y: point.y * scale }));
              const contrast = meanInside(gray, smallCandidate) - borderMean;
              if (!pass.otsu && contrast < 4) continue;

              results.push({
                points: candidate,
                score: candidateScore(candidate, src.width, src.height, contrast) + 0.35,
                method: pass.name,
                contrast
              });
            } finally {
              contour.delete();
            }
          }
        } finally {
          [binary, closeKernel, openKernel, contours, hierarchy].forEach(item => {
            try { if (item) item.delete(); } catch (_) {}
          });
        }
      }
    } finally {
      [small, gray, blur].forEach(item => {
        try { if (item) item.delete(); } catch (_) {}
      });
    }
    return results;
  }

  btn.textContent = '自動偵測四角';
  btn.onclick = () => {
    if (!window.cvReady || !base) return;
    const previousPoints = points.map(point => ({ x: point.x, y: point.y }));
    btn.disabled = true;
    setStatus('正在以外緣線段與亮紙區域雙引擎偵測考卷……');

    setTimeout(() => {
      let original;
      try {
        sctx.putImageData(base, 0, 0);
        original = cv.imread(src);
        const candidates = [];
        const lineCandidate = detectWithLines(original);
        if (lineCandidate) candidates.push(lineCandidate);
        candidates.push(...detectWithPaperMask(original));
        candidates.sort((first, second) => second.score - first.score);
        if (!candidates.length) throw new Error('沒有找到可信的紙張候選');

        const best = candidates[0];
        points = best.points.map(point => ({
          x: clamp(point.x, 0, src.width), y: clamp(point.y, 0, src.height)
        }));
        draw();
        const areaRatio = polygonArea(points) / (src.width * src.height);
        const contrastText = Number.isFinite(best.contrast) ?
          `，亮度差 ${Math.round(best.contrast)}` : '';
        setStatus(`已用「${best.method}」偵測紙張，約占畫面 ${Math.round(areaRatio * 100)}%${contrastText}。請確認四角。`, 'ready');
      } catch (error) {
        points = previousPoints;
        draw();
        setStatus('自動偵測未取得更可信的結果，已保留目前角點：' + error.message, 'warn');
      } finally {
        try { if (original) original.delete(); } catch (_) {}
        btn.disabled = false;
      }
    }, 60);
  };
})();