import {
  aspectRatioDifference,
  resolutionRatio,
  analyzeRgbaPair,
  assessIntegrity
} from './integrity.js';

const $ = id => document.getElementById(id);
const state = {
  before: null,
  after: null,
  beforeInfo: null,
  afterInfo: null,
  analysis: null,
  assessment: null,
  blocked: false,
  requestId: null
};

$('endpoint').value = sessionStorage.getItem('examCleanerProxy') || '';
$('token').value = sessionStorage.getItem('examCleanerProxyToken') || '';

function setStatus(message, type = 'warn') {
  $('status').textContent = message;
  $('status').className = `notice ${type}`;
}

function setWarnings(items) {
  if (!items?.length) {
    $('warnings').textContent = '未發現自動警示；仍需人工逐區比較。';
    return;
  }
  $('warnings').innerHTML = items.map(item => `• ${escapeHtml(item)}`).join('<br>');
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  })[character]);
}

function updateControls() {
  const proxyReady = $('mode').value === 'demo' || $('endpoint').value.trim();
  $('process').disabled = !(state.before && proxyReady);
  $('approved').disabled = !state.after || state.blocked;
  $('download').disabled = !(state.after && $('approved').checked && !state.blocked);
  $('showHeatmap').disabled = !state.analysis;
  ['beforeOnly', 'afterOnly', 'compareMode'].forEach(id => { $(id).disabled = !state.after; });
}

function resetResult() {
  state.after = null;
  state.afterInfo = null;
  state.analysis = null;
  state.assessment = null;
  state.blocked = false;
  state.requestId = null;
  $('approved').checked = false;
  $('showHeatmap').checked = false;
  $('heatmap').hidden = true;
  $('heatmap').innerHTML = '';
  ['score', 'edge', 'changed', 'ratio', 'resolution'].forEach(id => { $(id).textContent = '—'; });
  $('score').className = '';
  setWarnings(null);
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('無法讀取圖片'));
    image.src = url;
  });
}

async function optimizeFile(file) {
  const raw = URL.createObjectURL(file);
  try {
    const image = await loadImage(raw);
    return imageToData(image, 2200, 'image/jpeg', 0.94);
  } finally {
    URL.revokeObjectURL(raw);
  }
}

function imageToData(image, maxSide = 2200, mimeType = 'image/jpeg', quality = 0.94) {
  const scale = Math.min(1, maxSide / Math.max(image.width, image.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(image.width * scale));
  canvas.height = Math.max(1, Math.round(image.height * scale));
  const context = canvas.getContext('2d', { willReadFrequently: true });
  context.fillStyle = '#fff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return {
    url: canvas.toDataURL(mimeType, quality),
    width: canvas.width,
    height: canvas.height,
    mimeType
  };
}

function showComparison() {
  $('empty').hidden = true;
  $('frame').hidden = false;
  $('before').src = state.before;
  $('after').src = state.after || state.before;
  $('slider').disabled = !state.after;
  setView('compare');
}

function syncSlider() {
  const value = Number($('slider').value);
  $('afterLayer').style.width = `${value}%`;
  $('divider').style.left = `${value}%`;
  $('handle').style.left = `${value}%`;
}

function setView(mode) {
  if (!state.after && mode !== 'before') return;
  if (mode === 'before') {
    $('afterLayer').style.width = '0%';
    $('divider').style.display = 'none';
    $('handle').style.display = 'none';
    $('slider').disabled = true;
  } else if (mode === 'after') {
    $('afterLayer').style.width = '100%';
    $('divider').style.display = 'none';
    $('handle').style.display = 'none';
    $('slider').disabled = true;
  } else {
    $('divider').style.display = '';
    $('handle').style.display = '';
    $('slider').disabled = !state.after;
    syncSlider();
  }
}

function hueFromRgb(red, green, blue) {
  const r = red / 255, g = green / 255, b = blue / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), delta = max - min;
  let hue = 0;
  if (delta) {
    if (max === r) hue = 60 * (((g - b) / delta) % 6);
    else if (max === g) hue = 60 * ((b - r) / delta + 2);
    else hue = 60 * ((r - g) / delta + 4);
  }
  if (hue < 0) hue += 360;
  return { hue, saturation: max ? delta / max : 0, value: max };
}

async function createOfflineDemo(beforeUrl) {
  const image = await loadImage(beforeUrl);
  const canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  context.drawImage(image, 0, 0);
  const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;

  for (let offset = 0; offset < data.length; offset += 4) {
    const red = data[offset], green = data[offset + 1], blue = data[offset + 2];
    const gray = red * 0.299 + green * 0.587 + blue * 0.114;
    const { hue, saturation, value } = hueFromRgb(red, green, blue);
    const coloredMark = saturation > 0.18 && value > 0.28 &&
      (hue < 38 || hue > 325 || (hue > 175 && hue < 325));

    if (coloredMark) {
      const strength = Math.min(0.92, 0.48 + saturation * 0.55);
      const paper = Math.max(235, gray);
      data[offset] = Math.round(red + (paper - red) * strength);
      data[offset + 1] = Math.round(green + (paper - green) * strength);
      data[offset + 2] = Math.round(blue + (paper - blue) * strength);
    }
  }

  context.putImageData(imageData, 0, 0);
  return {
    url: canvas.toDataURL('image/png'),
    width: canvas.width,
    height: canvas.height,
    mimeType: 'image/png'
  };
}

async function callProxy(endpoint, token, attempt = 0) {
  const [header, data] = state.before.split(',');
  const mimeType = /data:([^;]+)/.exec(header)?.[1] || 'image/jpeg';
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 130000);
  const clientRequestId = crypto.randomUUID?.() || `web-${Date.now()}-${Math.random().toString(16).slice(2)}`;

  try {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['X-Exam-Cleaner-Token'] = token;
    const response = await fetch(endpoint, {
      method: 'POST',
      signal: controller.signal,
      headers,
      body: JSON.stringify({
        version: 'exam-clean-v2',
        clientRequestId,
        image: {
          mimeType,
          data,
          width: state.beforeInfo.width,
          height: state.beforeInfo.height
        },
        options: {
          removeAllAddedMarks: true,
          preservePrintedContent: true,
          preserveLayout: true,
          outputMimeType: 'image/png'
        }
      })
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const retryable = [429, 500, 502, 503, 504].includes(response.status);
      if (retryable && attempt < 1) {
        await new Promise(resolve => setTimeout(resolve, 900));
        return callProxy(endpoint, token, attempt + 1);
      }
      throw new Error(payload.error || `Proxy 錯誤 ${response.status}`);
    }
    if (!payload?.image?.data) throw new Error('Proxy 沒有回傳圖片');

    const url = `data:${payload.image.mimeType || 'image/png'};base64,${payload.image.data}`;
    const image = await loadImage(url);
    return {
      url,
      width: payload.image.width || image.width,
      height: payload.image.height || image.height,
      mimeType: payload.image.mimeType || 'image/png',
      requestId: payload.requestId || clientRequestId,
      warnings: payload.warnings || []
    };
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error('AI 處理超過 130 秒，已取消');
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function rgbaAtAnalysisSize(url, width, height) {
  const image = await loadImage(url);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  context.fillStyle = '#fff';
  context.fillRect(0, 0, width, height);
  context.drawImage(image, 0, 0, width, height);
  return context.getImageData(0, 0, width, height).data;
}

async function analyzeResult(extraWarnings = []) {
  const analysisWidth = 320;
  const analysisHeight = Math.max(160, Math.round(analysisWidth * state.beforeInfo.height / state.beforeInfo.width));
  const [beforeRgba, afterRgba] = await Promise.all([
    rgbaAtAnalysisSize(state.before, analysisWidth, analysisHeight),
    rgbaAtAnalysisSize(state.after, analysisWidth, analysisHeight)
  ]);

  const pair = analyzeRgbaPair(beforeRgba, afterRgba, analysisWidth, analysisHeight);
  const metrics = {
    ...pair,
    aspectRatioDifference: aspectRatioDifference(
      state.beforeInfo.width, state.beforeInfo.height,
      state.afterInfo.width, state.afterInfo.height
    ),
    resolutionRatio: resolutionRatio(
      state.beforeInfo.width, state.beforeInfo.height,
      state.afterInfo.width, state.afterInfo.height
    )
  };
  const assessment = assessIntegrity(metrics);
  state.analysis = metrics;
  state.assessment = assessment;

  // Hard blocks indicate a result that should not be accepted even with a casual checkbox.
  state.blocked = metrics.aspectRatioDifference > 0.055 || metrics.edgeRetention < 0.48 || metrics.resolutionRatio < 0.22;

  $('score').textContent = `${assessment.score}`;
  $('score').className = assessment.risk === 'low' ? 'riskLow' : assessment.risk === 'medium' ? 'riskMedium' : 'riskHigh';
  $('edge').textContent = `${Math.round(metrics.edgeRetention * 100)}%`;
  $('changed').textContent = `${Math.round(metrics.changedRatio * 100)}%`;
  $('ratio').textContent = `${(metrics.aspectRatioDifference * 100).toFixed(1)}%`;
  $('resolution').textContent = `${state.afterInfo.width}×${state.afterInfo.height}`;

  const warnings = [...new Set([...(extraWarnings || []), ...assessment.warnings])];
  if (state.blocked) warnings.unshift('自動檢查判定為高風險，已禁止下載；請重新處理或改用原圖');
  setWarnings(warnings);
  drawHeatmap();

  if (state.blocked) {
    setStatus('處理完成，但完整性檢查未通過，已禁止核准與下載。', 'danger');
  } else if (assessment.risk === 'high') {
    setStatus('處理完成，但風險偏高。請開啟高變動區塊並逐區檢查。', 'warn');
  } else {
    const suffix = state.requestId ? `（Request ID：${state.requestId}）` : '';
    setStatus(`處理完成。請拖曳滑桿並逐區人工覆核。${suffix}`, 'success');
  }
  updateControls();
}

function drawHeatmap() {
  const layer = $('heatmap');
  layer.innerHTML = '';
  if (!state.analysis) return;
  const cells = state.analysis.cells.filter(cell => cell.hotspot);
  const columns = 8, rows = 12;
  cells.forEach(cell => {
    const element = document.createElement('div');
    element.className = 'heatCell';
    element.style.left = `${cell.column / columns * 100}%`;
    element.style.top = `${cell.row / rows * 100}%`;
    element.style.width = `${100 / columns}%`;
    element.style.height = `${100 / rows}%`;
    element.title = `此區約 ${Math.round(cell.changedRatio * 100)}% 像素變動`;
    layer.appendChild(element);
  });
}

async function importDataUrl(url, name = '掃描結果') {
  const image = await loadImage(url);
  const optimized = imageToData(image, 2200, 'image/jpeg', 0.94);
  state.before = optimized.url;
  state.beforeInfo = { width: optimized.width, height: optimized.height, mimeType: optimized.mimeType, name };
  resetResult();
  showComparison();
  setStatus('圖片已載入，可以開始離線流程測試或設定安全 Proxy。', 'success');
  updateControls();
}

$('file').addEventListener('change', async event => {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    const result = await optimizeFile(file);
    state.before = result.url;
    state.beforeInfo = { width: result.width, height: result.height, mimeType: result.mimeType, name: file.name };
    resetResult();
    showComparison();
    setStatus('圖片已載入，可以開始處理。', 'success');
  } catch (error) {
    setStatus(error.message, 'danger');
  }
  updateControls();
});

$('mode').addEventListener('change', () => {
  const proxy = $('mode').value === 'proxy';
  $('proxyFields').hidden = !proxy;
  $('modeHelp').textContent = proxy
    ? '圖片會送至你設定的安全 Proxy；前端不保存 Gemini API Key。'
    : '離線模式不會上傳圖片，只模擬淡化彩色筆跡，用來驗證比較、警示與覆核流程。';
  updateControls();
});

$('endpoint').addEventListener('input', () => {
  sessionStorage.setItem('examCleanerProxy', $('endpoint').value.trim());
  updateControls();
});
$('token').addEventListener('input', () => {
  sessionStorage.setItem('examCleanerProxyToken', $('token').value);
});
$('slider').addEventListener('input', syncSlider);
$('approved').addEventListener('change', updateControls);
$('showHeatmap').addEventListener('change', () => { $('heatmap').hidden = !$('showHeatmap').checked; });
$('beforeOnly').addEventListener('click', () => setView('before'));
$('afterOnly').addEventListener('click', () => setView('after'));
$('compareMode').addEventListener('click', () => setView('compare'));

$('process').addEventListener('click', async () => {
  if (!state.before) return;
  $('process').disabled = true;
  resetResult();
  setStatus(
    $('mode').value === 'demo'
      ? '正在執行離線彩色筆跡淡化與完整性分析……'
      : 'AI 正在移除所有後加筆跡，請保持頁面開啟……',
    'warn'
  );

  try {
    let result;
    if ($('mode').value === 'demo') {
      result = await createOfflineDemo(state.before);
    } else {
      const endpoint = $('endpoint').value.trim();
      if (!endpoint) throw new Error('請先設定 Proxy URL');
      result = await callProxy(endpoint, $('token').value);
    }

    state.after = result.url;
    state.afterInfo = { width: result.width, height: result.height, mimeType: result.mimeType };
    state.requestId = result.requestId || null;
    $('after').src = state.after;
    showComparison();
    await analyzeResult(result.warnings || []);
  } catch (error) {
    setStatus(error.message || '處理失敗', 'danger');
  } finally {
    updateControls();
  }
});

$('download').addEventListener('click', () => {
  if (!state.after || !$('approved').checked || state.blocked) return;
  const anchor = document.createElement('a');
  anchor.href = state.after;
  anchor.download = `exam-cleaner-v2.2-${Date.now()}.png`;
  anchor.click();
});

// Future v2.1 handoff: scanner can place a data URL here before navigation.
const handoff = sessionStorage.getItem('examCleanerHandoffImage');
if (handoff?.startsWith('data:image/')) {
  sessionStorage.removeItem('examCleanerHandoffImage');
  importDataUrl(handoff).catch(error => setStatus(error.message, 'danger'));
}

setWarnings(null);
updateControls();
