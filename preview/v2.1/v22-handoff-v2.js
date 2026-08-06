(() => {
  'use strict';

  const resultCanvas = document.getElementById('result');
  const resultBox = document.getElementById('resultBox');
  if (!resultCanvas || !resultBox) return;

  const button = document.createElement('button');
  button.id = 'sendToV22';
  button.className = 'green';
  button.textContent = '送往 v2.2 OpenAI 去筆跡';
  button.disabled = true;
  button.style.marginTop = '10px';
  button.style.width = '100%';
  resultBox.appendChild(button);

  const help = document.createElement('p');
  help.className = 'small';
  help.textContent = '只傳送目前校正結果；圖片保留在同一個瀏覽器分頁工作階段，進入 OpenAI 模式前仍須通過安全 Proxy 驗證。';
  resultBox.appendChild(help);

  function update() {
    button.disabled = resultBox.hidden || resultCanvas.width < 10 || resultCanvas.height < 10;
  }

  button.addEventListener('click', () => {
    try {
      const dataUrl = resultCanvas.toDataURL('image/png');
      if (!dataUrl.startsWith('data:image/')) throw new Error('無法建立校正圖片');
      sessionStorage.setItem('examCleanerHandoffImage', dataUrl);
      sessionStorage.setItem('examCleanerHandoffMeta', JSON.stringify({
        source: 'v2.1-scanner',
        provider: 'openai',
        width: resultCanvas.width,
        height: resultCanvas.height,
        createdAt: new Date().toISOString()
      }));
      const target = new URL('../v2.2/alpha5.html', window.location.href).href;
      window.top.location.href = target;
    } catch (error) {
      if (typeof setStatus === 'function') {
        setStatus(`無法送往 v2.2：${error.message}`, 'warn');
      } else {
        alert(`無法送往 v2.2：${error.message}`);
      }
    }
  });

  const observer = new MutationObserver(update);
  observer.observe(resultBox, { attributes: true, attributeFilter: ['hidden'] });
  const timer = setInterval(update, 350);
  window.addEventListener('pagehide', () => {
    clearInterval(timer);
    observer.disconnect();
  }, { once: true });
  update();
})();
