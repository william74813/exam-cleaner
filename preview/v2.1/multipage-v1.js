(() => {
  'use strict';

  const result = document.getElementById('result');
  const resultBox = document.getElementById('resultBox');
  const fileInput = document.getElementById('file');
  const controlCard = fileInput?.closest('.card');
  const status = document.getElementById('status');
  if (!result || !resultBox || !controlCard) return;

  const MAX_PAGES = 20;
  const pages = [];

  const panel = document.createElement('section');
  panel.id = 'multiPagePanel';
  panel.style.marginTop = '12px';
  panel.innerHTML = `
    <p class="small" style="margin:0 0 5px"><b>5. 多頁文件</b></p>
    <div class="row">
      <button id="addPage" type="button" class="primary" disabled>加入本頁並掃描下一張</button>
      <button id="downloadPdf" type="button" class="green" disabled>下載多頁 PDF</button>
    </div>
    <div class="row">
      <button id="clearPages" type="button" disabled>清除全部頁面</button>
      <span id="pageCount" class="small" style="display:flex;align-items:center;justify-content:center">尚未加入頁面</span>
    </div>
    <div id="pageQueue" style="display:grid;gap:8px;margin-top:9px"></div>
    <p class="small" style="margin:7px 0 0">最多 ${MAX_PAGES} 頁。每頁校正並確認灰階效果後，請先加入頁面佇列。</p>`;

  controlCard.insertBefore(panel, status);

  const addPageButton = panel.querySelector('#addPage');
  const downloadPdfButton = panel.querySelector('#downloadPdf');
  const clearPagesButton = panel.querySelector('#clearPages');
  const pageCount = panel.querySelector('#pageCount');
  const queue = panel.querySelector('#pageQueue');

  function showStatus(message, type = '') {
    if (typeof setStatus === 'function') {
      setStatus(message, type);
    } else if (status) {
      status.textContent = message;
      status.className = 'status' + (type ? ' ' + type : '');
    }
  }

  function updateButtons() {
    const hasResult = !resultBox.hidden && result.width > 10 && result.height > 10;
    addPageButton.disabled = !hasResult || pages.length >= MAX_PAGES;
    downloadPdfButton.disabled = pages.length === 0;
    clearPagesButton.disabled = pages.length === 0;
    pageCount.textContent = pages.length ? `已加入 ${pages.length}／${MAX_PAGES} 頁` : '尚未加入頁面';
  }

  function renderQueue() {
    queue.innerHTML = '';
    pages.forEach((page, index) => {
      const item = document.createElement('div');
      item.style.cssText = 'display:grid;grid-template-columns:54px 1fr auto;gap:8px;align-items:center;padding:7px;border:1px solid #dbe2ea;border-radius:10px;background:#f8fafc';
      item.innerHTML = `
        <img src="${page.dataUrl}" alt="第 ${index + 1} 頁" style="width:54px;height:70px;object-fit:cover;border-radius:6px;background:#fff">
        <div class="small"><b>第 ${index + 1} 頁</b><br>${page.width} × ${page.height}</div>
        <div style="display:grid;grid-template-columns:repeat(2,34px);gap:4px">
          <button type="button" data-action="up" data-index="${index}" aria-label="上移" style="padding:6px">↑</button>
          <button type="button" data-action="down" data-index="${index}" aria-label="下移" style="padding:6px">↓</button>
          <button type="button" data-action="delete" data-index="${index}" aria-label="刪除" style="grid-column:1/3;padding:6px">刪除</button>
        </div>`;
      queue.appendChild(item);
    });
    updateButtons();
  }

  queue.addEventListener('click', event => {
    const button = event.target.closest('button[data-action]');
    if (!button) return;
    const index = Number(button.dataset.index);
    const action = button.dataset.action;
    if (!Number.isInteger(index) || !pages[index]) return;

    if (action === 'delete') {
      pages.splice(index, 1);
    } else if (action === 'up' && index > 0) {
      [pages[index - 1], pages[index]] = [pages[index], pages[index - 1]];
    } else if (action === 'down' && index < pages.length - 1) {
      [pages[index + 1], pages[index]] = [pages[index], pages[index + 1]];
    }
    renderQueue();
  });

  addPageButton.addEventListener('click', () => {
    if (result.width <= 10 || result.height <= 10 || pages.length >= MAX_PAGES) return;
    addPageButton.disabled = true;
    try {
      const dataUrl = result.toDataURL('image/jpeg', 0.90);
      pages.push({ dataUrl, width: result.width, height: result.height });
      renderQueue();
      const addedNumber = pages.length;
      const newScan = document.getElementById('newScan');
      if (newScan) newScan.click();
      setTimeout(() => showStatus(`第 ${addedNumber} 頁已加入。請匯入下一張；全部完成後下載多頁 PDF。`, 'ready'), 30);
    } catch (error) {
      showStatus('無法加入此頁：' + error.message, 'warn');
      updateButtons();
    }
  });

  clearPagesButton.addEventListener('click', () => {
    pages.length = 0;
    renderQueue();
    showStatus('多頁佇列已清除。', 'ready');
  });

  downloadPdfButton.addEventListener('click', () => {
    if (!pages.length) return;
    if (!window.jspdf?.jsPDF) {
      showStatus('PDF 模組尚未載入，請確認網路後重新整理。', 'warn');
      return;
    }

    downloadPdfButton.disabled = true;
    showStatus(`正在合併 ${pages.length} 頁 PDF，請稍候……`);

    setTimeout(() => {
      try {
        const { jsPDF } = window.jspdf;
        const firstOrientation = pages[0].width > pages[0].height ? 'landscape' : 'portrait';
        const pdf = new jsPDF({ orientation: firstOrientation, unit: 'mm', format: 'a4', compress: true });

        pages.forEach((page, index) => {
          const orientation = page.width > page.height ? 'landscape' : 'portrait';
          if (index > 0) pdf.addPage('a4', orientation);
          const pageWidth = pdf.internal.pageSize.getWidth();
          const pageHeight = pdf.internal.pageSize.getHeight();
          const margin = 6;
          const scale = Math.min(
            (pageWidth - margin * 2) / page.width,
            (pageHeight - margin * 2) / page.height
          );
          const width = page.width * scale;
          const height = page.height * scale;
          const x = (pageWidth - width) / 2;
          const y = (pageHeight - height) / 2;
          pdf.addImage(page.dataUrl, 'JPEG', x, y, width, height, undefined, 'FAST');
        });

        pdf.save(`exam-cleaner-${pages.length}-pages.pdf`);
        showStatus(`已產生 ${pages.length} 頁 PDF。`, 'ready');
      } catch (error) {
        showStatus('多頁 PDF 產生失敗：' + error.message, 'warn');
      } finally {
        updateButtons();
      }
    }, 60);
  });

  const resultObserver = new MutationObserver(updateButtons);
  resultObserver.observe(resultBox, { attributes: true, attributeFilter: ['hidden'] });

  window.addEventListener('pagehide', () => {
    try { resultObserver.disconnect(); } catch (_) {}
    pages.length = 0;
    queue.innerHTML = '';
  });

  updateButtons();
})();