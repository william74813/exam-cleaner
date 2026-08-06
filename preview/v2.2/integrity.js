export function aspectRatioDifference(beforeWidth, beforeHeight, afterWidth, afterHeight) {
  const before = beforeWidth / Math.max(1, beforeHeight);
  const after = afterWidth / Math.max(1, afterHeight);
  return Math.abs(after - before) / Math.max(0.000001, before);
}

export function resolutionRatio(beforeWidth, beforeHeight, afterWidth, afterHeight) {
  return (afterWidth * afterHeight) / Math.max(1, beforeWidth * beforeHeight);
}

function luminance(data, offset) {
  return data[offset] * 0.299 + data[offset + 1] * 0.587 + data[offset + 2] * 0.114;
}

export function grayscaleFromRgba(data, width, height) {
  const gray = new Uint8Array(width * height);
  for (let pixel = 0, offset = 0; pixel < gray.length; pixel++, offset += 4) {
    gray[pixel] = Math.round(luminance(data, offset));
  }
  return gray;
}

export function sobelEdges(gray, width, height) {
  const edges = new Uint8Array(width * height);
  if (width < 3 || height < 3) return edges;

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      const tl = gray[i - width - 1], tc = gray[i - width], tr = gray[i - width + 1];
      const ml = gray[i - 1], mr = gray[i + 1];
      const bl = gray[i + width - 1], bc = gray[i + width], br = gray[i + width + 1];
      const gx = -tl + tr - 2 * ml + 2 * mr - bl + br;
      const gy = -tl - 2 * tc - tr + bl + 2 * bc + br;
      edges[i] = Math.min(255, Math.round(Math.hypot(gx, gy)));
    }
  }
  return edges;
}

function hasNearbyEdge(edges, width, height, x, y, threshold) {
  for (let dy = -1; dy <= 1; dy++) {
    const py = y + dy;
    if (py < 0 || py >= height) continue;
    for (let dx = -1; dx <= 1; dx++) {
      const px = x + dx;
      if (px < 0 || px >= width) continue;
      if (edges[py * width + px] >= threshold) return true;
    }
  }
  return false;
}

export function analyzeRgbaPair(beforeRgba, afterRgba, width, height, options = {}) {
  if (!beforeRgba || !afterRgba || beforeRgba.length !== afterRgba.length) {
    throw new Error('完整性分析需要相同尺寸的兩張 RGBA 影像');
  }
  if (beforeRgba.length !== width * height * 4) {
    throw new Error('RGBA 資料長度與影像尺寸不符');
  }

  const changeThreshold = options.changeThreshold ?? 24;
  const edgeThreshold = options.edgeThreshold ?? 62;
  const gridColumns = options.gridColumns ?? 8;
  const gridRows = options.gridRows ?? 12;
  const hotspotThreshold = options.hotspotThreshold ?? 0.34;

  const beforeGray = grayscaleFromRgba(beforeRgba, width, height);
  const afterGray = grayscaleFromRgba(afterRgba, width, height);
  const beforeEdges = sobelEdges(beforeGray, width, height);
  const afterEdges = sobelEdges(afterGray, width, height);

  const changedMask = new Uint8Array(width * height);
  let changedPixels = 0;
  let totalDifference = 0;
  let signedBrightnessDifference = 0;
  let originalEdgePixels = 0;
  let retainedEdgePixels = 0;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = y * width + x;
      const difference = Math.abs(beforeGray[index] - afterGray[index]);
      totalDifference += difference;
      signedBrightnessDifference += afterGray[index] - beforeGray[index];
      if (difference >= changeThreshold) {
        changedMask[index] = 1;
        changedPixels++;
      }
      if (beforeEdges[index] >= edgeThreshold) {
        originalEdgePixels++;
        if (hasNearbyEdge(afterEdges, width, height, x, y, Math.round(edgeThreshold * 0.72))) {
          retainedEdgePixels++;
        }
      }
    }
  }

  const cells = [];
  let hotspotCells = 0;
  for (let row = 0; row < gridRows; row++) {
    const y0 = Math.floor(row * height / gridRows);
    const y1 = Math.max(y0 + 1, Math.floor((row + 1) * height / gridRows));
    for (let column = 0; column < gridColumns; column++) {
      const x0 = Math.floor(column * width / gridColumns);
      const x1 = Math.max(x0 + 1, Math.floor((column + 1) * width / gridColumns));
      let changed = 0;
      const pixels = (x1 - x0) * (y1 - y0);
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) changed += changedMask[y * width + x];
      }
      const ratio = changed / Math.max(1, pixels);
      const hotspot = ratio >= hotspotThreshold;
      if (hotspot) hotspotCells++;
      cells.push({ row, column, x0, y0, x1, y1, changedRatio: ratio, hotspot });
    }
  }

  const pixelCount = width * height;
  return {
    changedRatio: changedPixels / Math.max(1, pixelCount),
    meanAbsoluteDifference: totalDifference / Math.max(1, pixelCount),
    meanBrightnessShift: signedBrightnessDifference / Math.max(1, pixelCount),
    edgeRetention: originalEdgePixels ? retainedEdgePixels / originalEdgePixels : 1,
    originalEdgePixels,
    hotspotRatio: hotspotCells / Math.max(1, cells.length),
    cells,
    changedMask
  };
}

export function assessIntegrity(metrics) {
  const warnings = [];
  let score = 100;

  if (metrics.aspectRatioDifference > 0.02) {
    warnings.push('輸出長寬比改變超過 2%，可能發生裁切或重排');
    score -= 28;
  } else if (metrics.aspectRatioDifference > 0.008) {
    warnings.push('輸出長寬比略有改變，請檢查四邊');
    score -= 10;
  }

  if (metrics.resolutionRatio < 0.45) {
    warnings.push('輸出解析度低於原圖 45%');
    score -= 24;
  } else if (metrics.resolutionRatio < 0.72) {
    warnings.push('輸出解析度有所降低');
    score -= 9;
  }

  if (metrics.edgeRetention < 0.72) {
    warnings.push('印刷線條／文字邊緣保留率偏低');
    score -= 34;
  } else if (metrics.edgeRetention < 0.86) {
    warnings.push('部分印刷邊緣可能被改動');
    score -= 15;
  }

  if (metrics.changedRatio > 0.42) {
    warnings.push('全頁大範圍像素被改動');
    score -= 24;
  } else if (metrics.changedRatio > 0.28) {
    warnings.push('像素變動範圍較大');
    score -= 10;
  }

  if (metrics.hotspotRatio > 0.28) {
    warnings.push('多個區塊出現集中改動，請逐區覆核');
    score -= 18;
  } else if (metrics.hotspotRatio > 0.12) {
    warnings.push('偵測到數個高變動區塊');
    score -= 7;
  }

  score = Math.max(0, Math.min(100, Math.round(score)));
  const risk = score >= 85 ? 'low' : score >= 62 ? 'medium' : 'high';
  return { score, risk, warnings };
}
