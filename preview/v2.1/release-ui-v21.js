(() => {
  'use strict';

  document.title = 'Exam Cleaner v2.1｜考卷掃描與校正';

  const heading = document.querySelector('header h1');
  const subtitle = document.querySelector('header p');
  if (heading) heading.innerHTML = 'Exam Cleaner v2.1 <span class="badge">正式版</span>';
  if (subtitle) subtitle.textContent = '自動框選、浮動角點微調、透視校正、灰階增強與多頁 PDF';

  const backButton = [...document.querySelectorAll('button')]
    .find(button => button.textContent.includes('返回正式版'));
  if (backButton) backButton.textContent = '返回首頁';

  const focus = [...document.querySelectorAll('p.small')]
    .find(element => element.textContent.includes('本版驗收重點'));
  if (focus) {
    focus.innerHTML = '<b>使用提示：</b><br>① 先按「自動偵測四角」<br>② 拖曳大型藍色圓環微調<br>③ 按「透視校正」<br>④ 預設使用灰階增強<br>⑤ 多頁可加入佇列後合併下載 PDF';
  }

  const status = document.getElementById('status');
  if (status && !window.cvReady) {
    status.textContent = '正式版模組載入中，首次開啟需要網路連線。';
  }
})();
