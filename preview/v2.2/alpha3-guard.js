(() => {
  'use strict';

  const $ = id => document.getElementById(id);
  const mode = $('mode');
  const processButton = $('process');
  const status = $('status');
  const changed = $('changed');
  const score = $('score');
  const edge = $('edge');
  const approved = $('approved');
  const download = $('download');
  const warnings = $('warnings');
  const showHeatmap = $('showHeatmap');
  const file = $('file');
  const frame = $('frame');
  const modeHelp = $('modeHelp');

  if (!mode || !processButton || !status || !changed || !score || !approved || !download) return;

  const heading = document.querySelector('header h1');
  const badge = document.querySelector('header .badge');
  if (heading) heading.textContent = 'Exam Cleaner v2.2 Alpha.3';
  if (badge) badge.textContent = '流程驗證';

  const demoOption = mode.querySelector('option[value="demo"]');
  if (demoOption) demoOption.textContent = '介面流程測試（非正式 AI；灰階通常不會改變）';

  const importNotice = document.createElement('div');
  importNotice.id = 'importSourceNotice';
  importNotice.className = 'notice success';
  importNotice.style.marginTop = '9px';
  importNotice.hidden = true;
  file?.parentElement?.appendChild(importNotice);

  let guardActive = false;
  const noChangeMessage = '離線流程測試未修改圖片。灰階考卷需使用安全 AI Proxy 才能執行真正去筆跡。';

  function updateModeText() {
    if (mode.value === 'demo') {
      processButton.textContent = '測試比較與覆核流程';
      if (modeHelp) {
        modeHelp.textContent = '此模式不是真實 AI 去筆跡，只測試比較、警示與覆核介面。灰階考卷通常不會產生任何變化。';
      }
    } else {
      processButton.textContent = '開始 AI 去筆跡';
    }
  }

  function updateImportNotice() {
    if (!frame || frame.hidden) {
      importNotice.hidden = true;
      return;
    }
    importNotice.hidden = false;
    if (file?.files?.length) {
      importNotice.textContent = '✓ 已載入你選擇的圖片。';
    } else {
      importNotice.textContent = '✓ 已從 v2.1 匯入校正結果，不需要重新拍照或重新選檔。';
    }
  }

  function applyNoChangeGuard() {
    const completed = /處理完成|完整性/.test(status.textContent || '');
    const noChange = mode.value === 'demo' && changed.textContent.trim() === '0%' && completed;
    if (!noChange) return;

    guardActive = true;
    score.textContent = '未評估';
    score.className = 'riskMedium';
    if (edge) edge.textContent = '—';
    approved.checked = false;
    approved.disabled = true;
    download.disabled = true;
    if (showHeatmap) showHeatmap.disabled = true;
    if (warnings) {
      warnings.innerHTML = '• 離線模式未偵測到可淡化的彩色筆跡。<br>• 灰階影像不會辨識黑色鉛筆、黑筆答案或批改痕跡。<br>• 此結果與原圖相同，不代表去筆跡完成。';
    }
    if (status.textContent !== noChangeMessage) {
      status.textContent = noChangeMessage;
      status.className = 'notice warn';
    }
  }

  function enforceGuard() {
    if (!guardActive) return;
    approved.checked = false;
    approved.disabled = true;
    download.disabled = true;
    if (showHeatmap) showHeatmap.disabled = true;
  }

  mode.addEventListener('change', () => {
    guardActive = false;
    updateModeText();
  });
  processButton.addEventListener('click', () => { guardActive = false; }, true);
  approved.addEventListener('click', event => {
    if (!guardActive) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    enforceGuard();
  }, true);
  download.addEventListener('click', event => {
    if (!guardActive) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);

  const observer = new MutationObserver(() => {
    updateImportNotice();
    applyNoChangeGuard();
    enforceGuard();
  });
  observer.observe(document.body, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: ['hidden', 'disabled', 'class']
  });

  updateModeText();
  updateImportNotice();
  setTimeout(() => {
    updateImportNotice();
    applyNoChangeGuard();
  }, 500);
})();
