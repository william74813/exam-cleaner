(() => {
  'use strict';

  const $ = id => document.getElementById(id);
  const mode = $('mode');
  const endpoint = $('endpoint');
  const token = $('token');
  const processButton = $('process');
  const proxyFields = $('proxyFields');
  if (!mode || !endpoint || !token || !processButton || !proxyFields) return;

  const heading = document.querySelector('header h1');
  const badge = document.querySelector('header .badge');
  if (heading) heading.textContent = 'Exam Cleaner v2.2 Alpha.4';
  if (badge) badge.textContent = 'Proxy 連線驗證';

  const proxyOption = mode.querySelector('option[value="proxy"]');
  if (proxyOption) proxyOption.textContent = '安全 AI Proxy（需先測試連線）';

  const testButton = document.createElement('button');
  testButton.id = 'testProxyConnection';
  testButton.type = 'button';
  testButton.className = 'orange';
  testButton.textContent = '測試 Proxy 與權杖';
  testButton.style.marginTop = '9px';

  const connectionStatus = document.createElement('div');
  connectionStatus.id = 'proxyConnectionStatus';
  connectionStatus.className = 'notice warn';
  connectionStatus.style.marginTop = '9px';
  connectionStatus.textContent = '尚未驗證。測試不會上傳圖片，也不會消耗 Gemini 額度。';

  proxyFields.appendChild(testButton);
  proxyFields.appendChild(connectionStatus);

  let verifiedKey = '';
  let testing = false;

  function normalizedEndpoint() {
    const value = endpoint.value.trim();
    if (!value) throw new Error('請先輸入 Proxy URL');
    const url = new URL(value);
    if (url.protocol !== 'https:') throw new Error('Proxy 必須使用 HTTPS');
    if (url.pathname === '/' || !url.pathname) url.pathname = '/api/clean';
    if (!url.pathname.endsWith('/api/clean')) {
      throw new Error('Proxy URL 應以 /api/clean 結尾');
    }
    url.search = '';
    url.hash = '';
    return url;
  }

  function currentKey() {
    return `${endpoint.value.trim()}\n${token.value}`;
  }

  function setConnectionStatus(message, type = 'warn') {
    connectionStatus.textContent = message;
    connectionStatus.className = `notice ${type}`;
  }

  function invalidate(message = '設定已變更，請重新測試 Proxy 與權杖。') {
    verifiedKey = '';
    if (!testing) setConnectionStatus(message, 'warn');
    enforce();
  }

  function verified() {
    return Boolean(verifiedKey && verifiedKey === currentKey());
  }

  function enforce() {
    if (mode.value === 'proxy' && !verified()) {
      processButton.disabled = true;
      processButton.textContent = '請先測試 Proxy 連線';
    } else if (mode.value === 'proxy') {
      processButton.textContent = '開始 AI 去筆跡';
    }
  }

  async function fetchJson(url, options = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(url, { ...options, signal: controller.signal, cache: 'no-store' });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || `連線錯誤 ${response.status}`);
      return payload;
    } catch (error) {
      if (error?.name === 'AbortError') throw new Error('Proxy 連線測試逾時');
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  testButton.addEventListener('click', async () => {
    if (testing) return;
    testing = true;
    verifiedKey = '';
    testButton.disabled = true;
    setConnectionStatus('正在檢查 Worker、Secrets 與存取權杖……', 'warn');
    enforce();

    try {
      const cleanUrl = normalizedEndpoint();
      endpoint.value = cleanUrl.href;
      sessionStorage.setItem('examCleanerProxy', endpoint.value);
      if (!token.value) throw new Error('請輸入存取權杖');

      const healthUrl = new URL('/health', cleanUrl);
      const authUrl = new URL('/auth-check', cleanUrl);
      const health = await fetchJson(healthUrl.href);
      if (health.service !== 'exam-cleaner-proxy') throw new Error('這個網址不是 Exam Cleaner Proxy');
      if (health.apiVersion !== 'exam-clean-v2') throw new Error('Proxy API 版本不相容');
      if (!health.ready) throw new Error('Worker 尚未設定完整的 Gemini API Key 與存取權杖');

      const auth = await fetchJson(authUrl.href, {
        headers: { 'X-Exam-Cleaner-Token': token.value }
      });
      if (!auth.authorized) throw new Error('存取權杖驗證失敗');

      verifiedKey = currentKey();
      sessionStorage.setItem('examCleanerProxy', endpoint.value);
      sessionStorage.setItem('examCleanerProxyToken', token.value);
      setConnectionStatus(`✓ 連線與權杖驗證成功；模型：${auth.model || health.model || '已設定'}。`, 'success');
    } catch (error) {
      verifiedKey = '';
      setConnectionStatus(`驗證失敗：${error.message}`, 'danger');
    } finally {
      testing = false;
      testButton.disabled = false;
      enforce();
    }
  });

  endpoint.addEventListener('input', () => invalidate());
  token.addEventListener('input', () => invalidate());
  mode.addEventListener('change', () => {
    if (mode.value === 'proxy' && !verified()) {
      setConnectionStatus('請先輸入 Proxy URL 與存取權杖，再執行連線測試。', 'warn');
    }
    setTimeout(enforce, 0);
  });

  processButton.addEventListener('click', event => {
    if (mode.value !== 'proxy' || verified()) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    setConnectionStatus('尚未通過 Proxy 與權杖驗證，不能上傳考卷。', 'danger');
    enforce();
  }, true);

  const observer = new MutationObserver(enforce);
  observer.observe(processButton, { attributes: true, attributeFilter: ['disabled'], childList: true });

  enforce();
})();
