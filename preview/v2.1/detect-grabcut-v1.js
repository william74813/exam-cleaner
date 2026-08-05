(() => {
  'use strict';

  const detectButton = document.getElementById('detect');
  if (!detectButton) return;

  const heading = document.querySelector('header h1');
  const subtitle = document.querySelector('header p');
  if (heading) heading.innerHTML = 'Exam Cleaner v2.1 <span class="badge">RC3.0</span>';
  if (subtitle) subtitle.textContent = 'GrabCut 紙張分割＋穩定四角＋灰階增強＋多頁 PDF';

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

  function rotatedRectCorners(rect, scale) {
    const center = rect.center;
    const width = rect.size.width;
    const height = rect.size.height;
    const angle = rect.angle * Math.PI / 180;
    const ux = { x: Math.cos(angle), y: Math.sin(angle) };
    const uy = { x: -Math.sin(angle), y: Math.cos(angle) };
    const halfWidth = width / 2;
    const halfHeight = height / 2;

    const corners = [
      { x: center.x - ux.x * halfWidth - uy.x * halfHeight, y: center.y - ux.y * halfWidth - uy.y * halfHeight },
      { x: center.x + ux.x * halfWidth - uy.x * halfHeight, y: center.y + ux.y * halfWidth - uy.y * halfHeight },
      { x: center.x + ux.x * halfWidth + uy.x * halfHeight, y: center.y + ux.y * halfWidth + uy.y * halfHeight },
      { x: center.x - ux.x * halfWidth + uy.x * halfHeight, y: center.y - ux.y * halfWidth + uy.y * halfHeight }
    ].map(point => ({ x: point.x / scale, y: point.y / scale }));

    return orderCorners(corners);
  }

  function validateCandidate(candidate, contourArea, rectArea) {
    if (!candidate || candidate.length !== 4) return false;
    if (!candidate.every(point => Number.isFinite(point.x) && Number.isFinite(point.y))) return false;

    const minSide = Math.min(src.width, src.height);
    const outsideTolerance = minSide * 0.018;
    if (!candidate.every(point =>
      point.x >= -outsideTolerance && point.x <= src.width + outsideTolerance &&
      point.y >= -outsideTolerance && point.y <= src.height + outsideTolerance
    )) return false;

    const areaRatio = polygonArea(candidate) / (src.width * src.height);
    if (areaRatio < 0.28 || areaRatio > 0.90) return false;

    const top = distance(candidate[0], candidate[1]);
    const right = distance(candidate[1], candidate[2]);
    const bottom = distance(candidate[2], candidate[3]);
    const left = distance(candidate[3], candidate[0]);
    if (Math.min(top, bottom) < src.width * 0.43) return false;
    if (Math.min(left, right) < src.height * 0.48) return false;

    const averageWidth = (top + bottom) / 2;
    const averageHeight = (left + right) / 2;
    const ratio = Math.max(averageWidth, averageHeight) / Math.max(1, Math.min(averageWidth, averageHeight));
    if (ratio < 1.08 || ratio > 1.92) return false;

    if (rectArea <= 0 || contourArea / rectArea < 0.62) return false;

    const centerX = candidate.reduce((sum, point) => sum + point.x, 0) / 4;
    const centerY = candidate.reduce((sum, point) => sum + point.y, 0) / 4;
    const centerOffset = Math.hypot(centerX - src.width / 2, centerY - src.height / 2) /
      Math.hypot(src.width / 2, src.height / 2);
    if (centerOffset > 0.30) return false;

    const borderLimit = minSide * 0.018;
    const touching = candidate.filter(point =>
      Math.min(point.x, point.y, src.width - point.x, src.height - point.y) < borderLimit
    ).length;
    return touching <= 1;
  }

  function detectWithGrabCut() {
    let original, rgb, small, mask, bgModel, fgModel, closeKernel, openKernel;
    let contours, hierarchy, bestContour, hull;

    try {
      sctx.putImageData(base, 0, 0);
      original = cv.imread(src);
      rgb = new cv.Mat();
      cv.cvtColor(original, rgb, cv.COLOR_RGBA2RGB);

      const scale = Math.min(1, 920 / Math.max(rgb.cols, rgb.rows));
      small = new cv.Mat();
      cv.resize(rgb, small, new cv.Size(
        Math.max(1, Math.round(rgb.cols * scale)),
        Math.max(1, Math.round(rgb.rows * scale))
      ), 0, 0, cv.INTER_AREA);

      mask = cv.Mat.zeros(small.rows, small.cols, cv.CV_8UC1);
      bgModel = cv.Mat.zeros(1, 65, cv.CV_64FC1);
      fgModel = cv.Mat.zeros(1, 65, cv.CV_64FC1);

      const marginX = Math.max(3, Math.round(small.cols * 0.035));
      const marginY = Math.max(3, Math.round(small.rows * 0.035));
      const rect = new cv.Rect(
        marginX,
        marginY,
        Math.max(2, small.cols - marginX * 2),
        Math.max(2, small.rows - marginY * 2)
      );

      cv.grabCut(small, mask, rect, bgModel, fgModel, 4, cv.GC_INIT_WITH_RECT);

      const data = mask.data;
      for (let index = 0; index < data.length; index++) {
        const value = data[index];
        data[index] = (value === cv.GC_FGD || value === cv.GC_PR_FGD) ? 255 : 0;
      }

      let closeSize = Math.max(9, Math.round(Math.min(small.cols, small.rows) / 48));
      if (closeSize % 2 === 0) closeSize++;
      closeSize = Math.min(closeSize, 25);
      closeKernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(closeSize, closeSize));
      openKernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(5, 5));
      cv.morphologyEx(mask, mask, cv.MORPH_CLOSE, closeKernel);
      cv.morphologyEx(mask, mask, cv.MORPH_OPEN, openKernel);

      contours = new cv.MatVector();
      hierarchy = new cv.Mat();
      cv.findContours(mask, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

      const centerX = small.cols / 2;
      const centerY = small.rows / 2;
      let bestArea = 0;

      for (let index = 0; index < contours.size(); index++) {
        const contour = contours.get(index);
        const area = Math.abs(cv.contourArea(contour));
        const areaRatio = area / (small.cols * small.rows);
        const bounds = cv.boundingRect(contour);
        const containsCenter = centerX >= bounds.x && centerX <= bounds.x + bounds.width &&
          centerY >= bounds.y && centerY <= bounds.y + bounds.height;

        if (containsCenter && areaRatio >= 0.20 && areaRatio <= 0.92 && area > bestArea) {
          if (bestContour) bestContour.delete();
          bestContour = contour.clone();
          bestArea = area;
        }
        contour.delete();
      }

      if (!bestContour) throw new Error('未找到包含畫面中央的完整紙張區域');

      hull = new cv.Mat();
      cv.convexHull(bestContour, hull, false, true);
      const rotated = cv.minAreaRect(hull);
      const rectArea = Math.max(1, rotated.size.width * rotated.size.height);
      const candidate = rotatedRectCorners(rotated, scale);

      if (!validateCandidate(candidate, bestArea, rectArea)) {
        throw new Error('前景區域不像完整考卷');
      }

      return {
        points: candidate.map(point => ({
          x: clamp(point.x, 0, src.width),
          y: clamp(point.y, 0, src.height)
        })),
        areaRatio: bestArea / (small.cols * small.rows),
        rectangularity: bestArea / rectArea
      };
    } finally {
      [original, rgb, small, mask, bgModel, fgModel, closeKernel, openKernel,
        contours, hierarchy, bestContour, hull].forEach(item => {
        try { if (item) item.delete(); } catch (_) {}
      });
    }
  }

  detectButton.textContent = '自動偵測四角';
  detectButton.onclick = () => {
    if (!window.cvReady || !base) return;

    const previousPoints = Array.isArray(points) ? points.map(point => ({ ...point })) : [];
    detectButton.disabled = true;
    setStatus('正在以 GrabCut 分離中央考卷與四周背景，請稍候……');

    setTimeout(() => {
      try {
        const result = detectWithGrabCut();
        points = result.points;
        draw();
        setStatus(
          `已分離中央考卷（前景約 ${Math.round(result.areaRatio * 100)}%，矩形完整度 ${Math.round(result.rectangularity * 100)}%）。請確認角點，必要時可拖曳微調。`,
          'ready'
        );
      } catch (error) {
        if (previousPoints.length === 4) points = previousPoints;
        draw();
        setStatus(`自動偵測未取得可信結果，已保留目前角點，請手動微調：${error.message}`, 'warn');
      } finally {
        detectButton.disabled = false;
      }
    }, 80);
  };
})();
