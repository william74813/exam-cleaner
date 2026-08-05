(() => {
  'use strict';

  const correctButton = document.getElementById('correct');
  const downloadButton = document.getElementById('download');
  const outputCanvas = document.getElementById('result');
  if (!correctButton || !outputCanvas) return;

  const heading = document.querySelector('header h1');
  const subtitle = document.querySelector('header p');
  if (heading) heading.innerHTML = 'Exam Cleaner v2.1 Alpha.3 <span class="badge">Enhance</span>';
  if (subtitle) subtitle.textContent = '準確四角偵測＋去陰影＋紙張白化＋文字增強';

  let correctedSnapshot = null;
  let currentMode = 'original';
  let enhancementRunning = false;

  const panel = document.createElement('div');
  panel.id = 'enhancePanel';
  panel.style.display = 'none';
  panel.innerHTML = `
    <p class="small" style="margin:14px 0 5px"><b>4. 選擇掃描效果</b></p>
    <div class="row" id="enhanceModes">
      <button type="button" data-mode="original">原色掃描</button>
      <button type="button" data-mode="gray">灰階增強</button>
      <button type="button" data-mode="bw">黑白文件</button>
    </div>
    <p class="small" id="enhanceHelp" style="margin:7px 0 0">原色掃描：保留圖片與彩色印刷內容。</p>`;

  const status = document.getElementById('status');
  if (status && status.parentElement) status.parentElement.insertBefore(panel, status);

  const modeButtons = [...panel.querySelectorAll('[data-mode]')];
  const help = panel.querySelector('#enhanceHelp');

  function deleteAll(items) {
    items.forEach(item => {
      try { if (item) item.delete(); } catch (_) {}
    });
  }

  function cacheCorrectedImage() {
    if (!outputCanvas.width || !outputCanvas.height) return false;
    const context = outputCanvas.getContext('2d', { willReadFrequently: true });
    correctedSnapshot = context.getImageData(0, 0, outputCanvas.width, outputCanvas.height);
    return true;
  }

  function restoreCorrectedImage() {
    if (!correctedSnapshot) return;
    outputCanvas.width = correctedSnapshot.width;
    outputCanvas.height = correctedSnapshot.height;
    outputCanvas.getContext('2d').putImageData(correctedSnapshot, 0, 0);
  }

  function setActive(mode) {
    currentMode = mode;
    modeButtons.forEach(button => {
      const active = button.dataset.mode === mode;
      button.style.background = active ? '#1d4ed8' : '#e5e7eb';
      button.style.color = active ? '#fff' : '#172033';
    });
  }

  function normalizeShadow(gray) {
    let background, normalized;
    try {
      background = new cv.Mat();
      normalized = new cv.Mat();
      const shortSide = Math.min(gray.cols, gray.rows);
      let kernelSize = Math.max(31, Math.round(shortSide / 18));
      if (kernelSize % 2 === 0) kernelSize += 1;
      kernelSize = Math.min(kernelSize, 101);
      cv.GaussianBlur(gray, background, new cv.Size(kernelSize, kernelSize), 0, 0, cv.BORDER_REPLICATE);
      cv.divide(gray, background, normalized, 255);
      return normalized.clone();
    } finally {
      deleteAll([background, normalized]);
    }
  }

  function renderGray() {
    let input, gray, shadowless, clahe, enhanced, rgba;
    try {
      restoreCorrectedImage();
      input = cv.imread(outputCanvas);
      gray = new cv.Mat();
      enhanced = new cv.Mat();
      rgba = new cv.Mat();
      cv.cvtColor(input, gray, cv.COLOR_RGBA2GRAY);
      shadowless = normalizeShadow(gray);
      clahe = new cv.CLAHE(2.1, new cv.Size(8, 8));
      clahe.apply(shadowless, enhanced);
      cv.cvtColor(enhanced, rgba, cv.COLOR_GRAY2RGBA);
      cv.imshow(outputCanvas, rgba);
    } finally {
      deleteAll([input, gray, shadowless, clahe, enhanced, rgba]);
    }
  }

  function renderBlackWhite() {
    let input, gray, shadowless, filtered, binary, rgba;
    try {
      restoreCorrectedImage();
      input = cv.imread(outputCanvas);
      gray = new cv.Mat();
      filtered = new cv.Mat();
      binary = new cv.Mat();
      rgba = new cv.Mat();
      cv.cvtColor(input, gray, cv.COLOR_RGBA2GRAY);
      shadowless = normalizeShadow(gray);
      cv.bilateralFilter(shadowless, filtered, 5, 38, 38, cv.BORDER_DEFAULT);
      let blockSize = Math.max(25, Math.round(Math.min(filtered.cols, filtered.rows) / 32));
      if (blockSize % 2 === 0) blockSize += 1;
      blockSize = Math.min(blockSize, 61);
      cv.adaptiveThreshold(filtered, binary, 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY, blockSize, 12);
      cv.cvtColor(binary, rgba, cv.COLOR_GRAY2RGBA);
      cv.imshow(outputCanvas, rgba);
    } finally {
      deleteAll([input, gray, shadowless, filtered, binary, rgba]);
    }
  }

  function renderOriginalColor() {
    let input, rgb, lab, channels, clahe, merged, restored, rgba;
    try {
      restoreCorrectedImage();
      input = cv.imread(outputCanvas);
      rgb = new cv.Mat();
      lab = new cv.Mat();
      channels = new cv.MatVector();
      merged = new cv.Mat();
      restored = new cv.Mat();
      rgba = new cv.Mat();
      cv.cvtColor(input, rgb, cv.COLOR_RGBA2RGB);
      cv.cvtColor(rgb, lab, cv.COLOR_RGB2Lab);
      cv.split(lab, channels);
      clahe = new cv.CLAHE(1.55, new cv.Size(8, 8));
      const lightness = channels.get(0);
      const improvedLightness = new cv.Mat();
      clahe.apply(lightness, improvedLightness);
      channels.set(0, improvedLightness);
      cv.merge(channels, merged);
      cv.cvtColor(merged, restored, cv.COLOR_Lab2RGB);
      cv.cvtColor(restored, rgba, cv.COLOR_RGB2RGBA);
      cv.imshow(outputCanvas, rgba);
      lightness.delete();
      improvedLightness.delete();
    } finally {
      deleteAll([input, rgb, lab, channels, clahe, merged, restored, rgba]);
    }
  }

  function applyMode(mode) {
    if (!correctedSnapshot || enhancementRunning || !window.cvReady) return;
    enhancementRunning = true;
    modeButtons.forEach(button => button.disabled = true);
    setStatus('正在套用掃描效果，請稍候……');
    setTimeout(() => {
      try {
        if (mode === 'gray') {
          renderGray();
          help.textContent = '灰階增強：降低陰影並強化淡色印刷文字。';
        } else if (mode === 'bw') {
          renderBlackWhite();
          help.textContent = '黑白文件：最適合純文字考卷列印；彩色圖片會轉成黑白。';
        } else {
          renderOriginalColor();
          help.textContent = '原色掃描：保留圖片與彩色印刷內容，並改善亮度與對比。';
        }
        setActive(mode);
        setStatus(`已完成「${mode === 'gray' ? '灰階增強' : mode === 'bw' ? '黑白文件' : '原色掃描'}」。可切換其他效果比較。`, 'ready');
      } catch (error) {
        restoreCorrectedImage();
        setStatus('影像增強失敗，已恢復校正原圖：' + error.message, 'warn');
      } finally {
        enhancementRunning = false;
        modeButtons.forEach(button => button.disabled = false);
      }
    }, 40);
  }

  modeButtons.forEach(button => button.addEventListener('click', () => applyMode(button.dataset.mode)));

  correctButton.addEventListener('click', () => {
    const started = Date.now();
    const waitForResult = () => {
      if (outputCanvas.width > 0 && !document.getElementById('resultBox').hidden && Date.now() - started > 80) {
        if (cacheCorrectedImage()) {
          panel.style.display = 'block';
          setActive('original');
          applyMode('original');
        }
        return;
      }
      if (Date.now() - started < 7000) requestAnimationFrame(waitForResult);
    };
    requestAnimationFrame(waitForResult);
  });

  if (downloadButton) {
    downloadButton.textContent = '下載目前效果';
    downloadButton.addEventListener('click', () => {
      const modeName = currentMode === 'gray' ? 'gray-enhanced' : currentMode === 'bw' ? 'black-white' : 'color-enhanced';
      setTimeout(() => {
        const links = document.querySelectorAll('a[download]');
        const latest = links[links.length - 1];
        if (latest) latest.download = `exam-${modeName}.png`;
      }, 0);
    }, true);
  }
})();