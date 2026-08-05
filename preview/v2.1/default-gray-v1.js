(() => {
  'use strict';
  const heading=document.querySelector('header h1');
  const subtitle=document.querySelector('header p');
  if(heading)heading.innerHTML='Exam Cleaner v2.1 Alpha.3.1 <span class="badge">Gray Default</span>';
  if(subtitle)subtitle.textContent='準確四角偵測＋灰階增強預設輸出＋原色／黑白切換';

  const correct=document.getElementById('correct');
  if(!correct)return;

  correct.addEventListener('click',()=>{
    const started=Date.now();
    const selectGray=()=>{
      const gray=document.querySelector('[data-mode="gray"]');
      const panel=document.getElementById('enhancePanel');
      if(gray&&panel&&panel.style.display!=='none'&&!gray.disabled){
        gray.click();
        return;
      }
      if(Date.now()-started<9000)requestAnimationFrame(selectGray);
    };
    requestAnimationFrame(selectGray);
  });
})();