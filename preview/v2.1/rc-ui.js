(() => {
  'use strict';
  const fileInput=document.getElementById('file');
  const source=document.getElementById('source');
  const result=document.getElementById('result');
  const resultBox=document.getElementById('resultBox');
  const status=document.getElementById('status');
  const controlCard=fileInput?.closest('.card');
  const heading=document.querySelector('header h1');
  const subtitle=document.querySelector('header p');
  if(heading)heading.innerHTML='Exam Cleaner v2.1 <span class="badge">Release Candidate</span>';
  if(subtitle)subtitle.textContent='自動校正、灰階去陰影、下載與列印';
  if(!controlCard||!fileInput||!source||!result)return;

  const actionRow=document.createElement('div');
  actionRow.className='row';
  actionRow.innerHTML='<button id="newScan" type="button">重新掃描</button><button id="printResult" type="button" class="green" disabled>直接列印</button>';
  const existingStatus=document.getElementById('status');
  controlCard.insertBefore(actionRow,existingStatus);
  const newScan=document.getElementById('newScan');
  const printResult=document.getElementById('printResult');

  function clearCanvas(canvas){
    const ctx=canvas.getContext('2d');
    ctx.clearRect(0,0,canvas.width,canvas.height);
    canvas.width=1;canvas.height=1;
  }

  function resetApp(){
    try{fileInput.value='';}catch(_){}
    try{base=null;points=[];drag=-1;}catch(_){}
    clearCanvas(source);clearCanvas(result);
    if(resultBox)resultBox.hidden=true;
    document.getElementById('download').disabled=true;
    document.getElementById('correct').disabled=true;
    document.getElementById('reset').disabled=true;
    document.getElementById('detect').disabled=true;
    const panel=document.getElementById('enhancePanel');
    if(panel)panel.style.display='none';
    printResult.disabled=true;
    if(status){status.textContent='已清除上一張考卷，請拍照或選擇新圖片。';status.className='status ready';}
    if(typeof window.gc==='function'){try{window.gc();}catch(_){}}
    fileInput.scrollIntoView({behavior:'smooth',block:'center'});
  }

  newScan.addEventListener('click',resetApp);

  const observer=new MutationObserver(()=>{
    if(resultBox&&!resultBox.hidden&&result.width>10&&result.height>10)printResult.disabled=false;
  });
  if(resultBox)observer.observe(resultBox,{attributes:true,attributeFilter:['hidden']});

  printResult.addEventListener('click',()=>{
    if(!result.width||!result.height)return;
    const data=result.toDataURL('image/png');
    const win=window.open('','_blank');
    if(!win){
      if(status){status.textContent='Safari 阻擋列印視窗，請允許彈出式視窗後再試。';status.className='status warn';}
      return;
    }
    win.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>列印考卷</title><style>@page{size:A4;margin:8mm}html,body{margin:0;background:#fff}body{display:flex;justify-content:center;align-items:flex-start}img{display:block;max-width:100%;max-height:calc(100vh - 16mm);object-fit:contain}@media print{img{width:100%;height:auto;max-height:none}}</style></head><body><img src="${data}" alt="校正後考卷" onload="setTimeout(()=>window.print(),250)"></body></html>`);
    win.document.close();
  });

  window.addEventListener('pagehide',()=>{
    try{observer.disconnect();}catch(_){}
    try{base=null;points=[];}catch(_){}
    clearCanvas(source);clearCanvas(result);
  });
})();