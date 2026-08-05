(() => {
'use strict';
const $=id=>document.getElementById(id);
const canvas=$('canvas'),ctx=canvas.getContext('2d',{willReadFrequently:true});
const shell=$('shell'),cropBox=$('cropBox');
let pages=[],current=-1,zoom=1,deferredInstall=null;
let drawing=false,last=null,cropping=false,cropStart=null,cropCurrent=null;

const controls=['applyBtn','applyAllBtn','rotateL','rotateR','autoTrim','cropBtn','undoBtn','redoBtn','resetBtn','pngBtn','pdfBtn','printBtn','saveProject','prevBtn','nextBtn','zoomOut','zoomIn','fitBtn','moveUp','moveDown','deletePage'];
function toast(t){const e=$('toast');e.textContent=t;e.classList.add('show');setTimeout(()=>e.classList.remove('show'),1800)}
function setStatus(t){$('status').textContent=t}
function uid(){return Date.now().toString(36)+Math.random().toString(36).slice(2,7)}
function updateRanges(){['color','pencil','black','white','contrast','eraser'].forEach(id=>$(id+'V').textContent=$(id).value)}
document.querySelectorAll('input[type=range]').forEach(x=>x.addEventListener('input',updateRanges));updateRanges();

function updateControls(){
 const has=pages.length>0;
 controls.forEach(id=>$(id).disabled=!has);
 $('prevBtn').disabled=!has||current<=0;$('nextBtn').disabled=!has||current>=pages.length-1;
 $('moveUp').disabled=!has||current<=0;$('moveDown').disabled=!has||current>=pages.length-1;
 $('undoBtn').disabled=!has||pages[current].history.length<=1;
 $('redoBtn').disabled=!has||pages[current].future.length===0;
}
function dataURLFromCanvas(c=canvas,q=.92){return c.toDataURL('image/jpeg',q)}
function cloneCanvasData(){return canvas.toDataURL('image/png')}
function pushHistory(){
 if(current<0)return;
 const p=pages[current],u=cloneCanvasData();
 if(p.history[p.history.length-1]!==u)p.history.push(u);
 if(p.history.length>15)p.history.shift();
 p.future=[];p.processed=u;renderThumbs();updateControls();
}
function loadDataURL(url,cb){
 const im=new Image();im.onload=()=>cb(im);im.src=url;
}
function displayPage(i){
 if(i<0||i>=pages.length)return;
 current=i;const p=pages[i];
 loadDataURL(p.processed||p.original,im=>{
  canvas.width=im.naturalWidth;canvas.height=im.naturalHeight;ctx.drawImage(im,0,0);
  zoom=1;fitCanvas();renderThumbs();updateControls();setStatus(`第 ${current+1} / ${pages.length} 頁`);
 });
}
async function filesToPages(fileList){
 const imgs=[...fileList].filter(f=>f.type.startsWith('image/'));
 for(const f of imgs){
  const url=await new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(r.result);r.onerror=rej;r.readAsDataURL(f)});
  const optimized=await optimize(url);
  pages.push({id:uid(),name:f.name,original:optimized,processed:optimized,history:[optimized],future:[]});
 }
 if(current<0&&pages.length)displayPage(0);else renderThumbs();
 updateControls();toast(`已匯入 ${imgs.length} 頁`);
}
function optimize(url){
 return new Promise(res=>loadDataURL(url,im=>{
  const max=8_000_000,s=Math.min(1,Math.sqrt(max/(im.width*im.height)));
  const c=document.createElement('canvas');c.width=Math.max(1,Math.round(im.width*s));c.height=Math.max(1,Math.round(im.height*s));
  const x=c.getContext('2d');x.fillStyle='white';x.fillRect(0,0,c.width,c.height);x.drawImage(im,0,0,c.width,c.height);res(c.toDataURL('image/jpeg',.94));
 }));
}
$('fileInput').onchange=e=>filesToPages(e.target.files);
$('addBtn').onclick=()=>$('fileInput').click();
$('clearBtn').onclick=()=>{if(confirm('確定清空全部頁面？')){pages=[];current=-1;ctx.clearRect(0,0,canvas.width,canvas.height);renderThumbs();updateControls();setStatus('尚未匯入考卷')}};

function renderThumbs(){
 const box=$('pageList');box.innerHTML='';
 if(!pages.length){box.innerHTML='<p class="small">匯入後會在這裡顯示縮圖。</p>';return}
 pages.forEach((p,i)=>{
  const d=document.createElement('div');d.className='thumb'+(i===current?' active':'');
  const c=document.createElement('canvas'),m=document.createElement('div');m.className='thumb-meta';m.innerHTML=`<span>第 ${i+1} 頁</span><span>${p.name.slice(0,12)}</span>`;
  d.append(c,m);d.onclick=()=>displayPage(i);box.appendChild(d);
  loadDataURL(p.processed,im=>{c.width=180;c.height=Math.round(180*im.height/im.width);c.getContext('2d').drawImage(im,0,0,c.width,c.height)});
 });
}
function hsv(r,g,b){r/=255;g/=255;b/=255;const mx=Math.max(r,g,b),mn=Math.min(r,g,b),d=mx-mn;let h=0;if(d){if(mx===r)h=((g-b)/d)%6;else if(mx===g)h=(b-r)/d+2;else h=(r-g)/d+4;h*=60;if(h<0)h+=360}return[h,mx?d/mx:0,mx]}
function processCanvas(){
 const img=ctx.getImageData(0,0,canvas.width,canvas.height),d=img.data;
 const cs=+$('color').value/100,ps=+$('pencil').value/100,bt=+$('black').value,wb=+$('white').value,ct=+$('contrast').value;
 const rr=$('red').checked,bb=$('blue').checked,gg=$('green').checked,hl=$('highlight').checked,bw=$('bw').checked;
 const factor=(259*(ct+255))/(255*(259-ct));
 for(let i=0;i<d.length;i+=4){
  let r=d[i],g=d[i+1],b=d[i+2];const [h,s,v]=hsv(r,g,b);let rm=false;
  if(rr&&s>.15&&(h<35||h>330)&&v>.22)rm=true;
  if(bb&&s>.14&&h>175&&h<325&&v>.18)rm=true;
  if(gg&&s>.14&&h>65&&h<175&&v>.18)rm=true;
  if(rm){r+=(255-r)*cs;g+=(255-g)*cs;b+=(255-b)*cs}
  if(hl&&s>.18&&v>.68){const k=.58*cs;r+=(255-r)*k;g+=(255-g)*k;b+=(255-b)*k}
  let lum=.299*r+.587*g+.114*b,spread=Math.max(r,g,b)-Math.min(r,g,b);
  if(spread<28&&lum>bt&&lum<242){let k=ps*Math.max(0,(lum-bt)/(242-bt));r+=(255-r)*k;g+=(255-g)*k;b+=(255-b)*k}
  r=Math.min(255,r+wb*(r/255));g=Math.min(255,g+wb*(g/255));b=Math.min(255,b+wb*(b/255));
  r=factor*(r-128)+128;g=factor*(g-128)+128;b=factor*(b-128)+128;
  if(bw){lum=.299*r+.587*g+.114*b;const o=lum<bt+35?0:255;r=g=b=o}
  d[i]=Math.max(0,Math.min(255,r));d[i+1]=Math.max(0,Math.min(255,g));d[i+2]=Math.max(0,Math.min(255,b));
 }
 ctx.putImageData(img,0,0);pushHistory();
}
$('applyBtn').onclick=()=>{processCanvas();toast('本頁處理完成')};
$('applyAllBtn').onclick=async()=>{
 if(!pages.length)return;const old=current;
 for(let i=0;i<pages.length;i++){await new Promise(res=>{displayPage(i);setTimeout(()=>{processCanvas();res()},60)})}
 displayPage(old);toast('全部頁面處理完成');
};
document.querySelectorAll('[data-preset]').forEach(b=>b.onclick=()=>{
 const p=b.dataset.preset;
 if(p==='teacher'){color.value=92;pencil.value=12;white.value=24;contrast.value=15;red.checked=blue.checked=true;highlight.checked=true;bw.checked=false}
 if(p==='pencil'){color.value=55;pencil.value=62;white.value=32;contrast.value=20;bw.checked=false}
 if(p==='bw'){color.value=90;pencil.value=50;white.value=35;contrast.value=30;bw.checked=true}
 if(p==='photo'){color.value=45;pencil.value=15;white.value=52;contrast.value=10;bw.checked=false}
 updateRanges();toast('已套用參數，請按「套用」');
});
function rotate(dir){
 const t=document.createElement('canvas');t.width=canvas.height;t.height=canvas.width;const x=t.getContext('2d');
 x.translate(t.width/2,t.height/2);x.rotate(dir*Math.PI/2);x.drawImage(canvas,-canvas.width/2,-canvas.height/2);
 canvas.width=t.width;canvas.height=t.height;ctx.drawImage(t,0,0);pushHistory();fitCanvas();
}
$('rotateL').onclick=()=>rotate(-1);$('rotateR').onclick=()=>rotate(1);
$('resetBtn').onclick=()=>{const p=pages[current];p.processed=p.original;p.history=[p.original];p.future=[];displayPage(current);toast('已還原原圖')};
$('undoBtn').onclick=()=>{const p=pages[current];if(p.history.length<=1)return;p.future.push(p.history.pop());p.processed=p.history[p.history.length-1];displayPage(current)};
$('redoBtn').onclick=()=>{const p=pages[current];if(!p.future.length)return;const u=p.future.pop();p.history.push(u);p.processed=u;displayPage(current)};

function autoTrim(){
 const d=ctx.getImageData(0,0,canvas.width,canvas.height).data,w=canvas.width,h=canvas.height;let minX=w,minY=h,maxX=0,maxY=0,found=false;
 for(let y=0;y<h;y+=2)for(let x=0;x<w;x+=2){const i=(y*w+x)*4,lum=.299*d[i]+.587*d[i+1]+.114*d[i+2];if(lum<238){minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);found=true}}
 if(!found)return toast('找不到可裁切內容');
 const pad=Math.round(Math.min(w,h)*.015);cropTo(Math.max(0,minX-pad),Math.max(0,minY-pad),Math.min(w,maxX-minX+pad*2),Math.min(h,maxY-minY+pad*2));
}
function cropTo(x,y,w,h){
 if(w<20||h<20)return;const t=document.createElement('canvas');t.width=w;t.height=h;t.getContext('2d').drawImage(canvas,x,y,w,h,0,0,w,h);canvas.width=w;canvas.height=h;ctx.drawImage(t,0,0);pushHistory();fitCanvas();
}
$('autoTrim').onclick=autoTrim;
$('cropBtn').onclick=()=>{cropping=!cropping;$('eraserMode').checked=false;cropBox.style.display=cropping?'block':'none';toast(cropping?'拖曳框選裁切範圍':'已取消裁切')};

function pos(e){const r=canvas.getBoundingClientRect();return{x:(e.clientX-r.left)*canvas.width/r.width,y:(e.clientY-r.top)*canvas.height/r.height,cx:e.clientX-r.left,cy:e.clientY-r.top}}
canvas.onpointerdown=e=>{
 const p=pos(e);
 if(cropping){cropStart=p;cropCurrent=p;canvas.setPointerCapture(e.pointerId);return}
 if(!$('eraserMode').checked)return;drawing=true;last=p;canvas.setPointerCapture(e.pointerId)
};
canvas.onpointermove=e=>{
 const p=pos(e);
 if(cropping&&cropStart){cropCurrent=p;const x=Math.min(cropStart.cx,p.cx),y=Math.min(cropStart.cy,p.cy),w=Math.abs(p.cx-cropStart.cx),h=Math.abs(p.cy-cropStart.cy);Object.assign(cropBox.style,{display:'block',left:x+'px',top:y+'px',width:w+'px',height:h+'px'});return}
 if(!drawing)return;const size=+$('eraser').value*canvas.width/canvas.getBoundingClientRect().width;ctx.save();ctx.strokeStyle='white';ctx.lineCap='round';ctx.lineJoin='round';ctx.lineWidth=size;ctx.beginPath();ctx.moveTo(last.x,last.y);ctx.lineTo(p.x,p.y);ctx.stroke();ctx.restore();last=p
};
canvas.onpointerup=e=>{
 if(cropping&&cropStart&&cropCurrent){const x=Math.round(Math.min(cropStart.x,cropCurrent.x)),y=Math.round(Math.min(cropStart.y,cropCurrent.y)),w=Math.round(Math.abs(cropCurrent.x-cropStart.x)),h=Math.round(Math.abs(cropCurrent.y-cropStart.y));cropping=false;cropStart=cropCurrent=null;cropBox.style.display='none';cropTo(x,y,w,h);toast('裁切完成');return}
 if(drawing){drawing=false;pushHistory()}
};
function fitCanvas(){const sw=$('stage').clientWidth-48;zoom=Math.min(1,sw/canvas.width);applyZoom()}
function applyZoom(){canvas.style.width=Math.round(canvas.width*zoom)+'px';canvas.style.height=Math.round(canvas.height*zoom)+'px';shell.style.width=canvas.style.width;shell.style.height=canvas.style.height}
$('zoomIn').onclick=()=>{zoom=Math.min(3,zoom*1.2);applyZoom()};$('zoomOut').onclick=()=>{zoom=Math.max(.15,zoom/1.2);applyZoom()};$('fitBtn').onclick=fitCanvas;
$('prevBtn').onclick=()=>displayPage(current-1);$('nextBtn').onclick=()=>displayPage(current+1);
$('moveUp').onclick=()=>{if(current>0){[pages[current-1],pages[current]]=[pages[current],pages[current-1]];current--;displayPage(current)}};
$('moveDown').onclick=()=>{if(current<pages.length-1){[pages[current+1],pages[current]]=[pages[current],pages[current+1]];current++;displayPage(current)}};
$('deletePage').onclick=()=>{if(!confirm('刪除此頁？'))return;pages.splice(current,1);current=Math.min(current,pages.length-1);if(current>=0)displayPage(current);else{ctx.clearRect(0,0,canvas.width,canvas.height);renderThumbs();updateControls()}};

$('pngBtn').onclick=()=>{const a=document.createElement('a');a.href=canvas.toDataURL('image/png');a.download=`考卷_第${current+1}頁.png`;a.click()};
$('printBtn').onclick=()=>window.print();

function makePdf(){
 if(!pages.length)return;
 Promise.all(pages.map(p=>new Promise(res=>loadDataURL(p.processed,im=>{
  const c=document.createElement('canvas'),max=1800,s=Math.min(1,max/im.width);c.width=Math.round(im.width*s);c.height=Math.round(im.height*s);c.getContext('2d').drawImage(im,0,0,c.width,c.height);
  const bin=atob(c.toDataURL('image/jpeg',.88).split(',')[1]),arr=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)arr[i]=bin.charCodeAt(i);res({bytes:arr,w:c.width,h:c.height});
 })))).then(images=>{
  const parts=[],offsets=[0];let len=0;const add=s=>{const b=typeof s==='string'?new TextEncoder().encode(s):s;parts.push(b);len+=b.length};
  add('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
  const objCount=2+images.length*3;const pageIds=[];
  function obj(id,body){offsets[id]=len;add(`${id} 0 obj\n${body}\nendobj\n`)}
  obj(1,'<< /Type /Catalog /Pages 2 0 R >>');
  images.forEach((_,i)=>pageIds.push(3+i*3));
  obj(2,`<< /Type /Pages /Kids [${pageIds.map(id=>id+' 0 R').join(' ')}] /Count ${images.length} >>`);
  images.forEach((im,i)=>{
   const page=3+i*3,imgId=page+1,content=page+2;const pw=595.28,ph=841.89,scale=Math.min(pw/im.w,ph/im.h),dw=im.w*scale,dh=im.h*scale,x=(pw-dw)/2,y=(ph-dh)/2;
   obj(page,`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pw} ${ph}] /Resources << /XObject << /Im0 ${imgId} 0 R >> >> /Contents ${content} 0 R >>`);
   offsets[imgId]=len;add(`${imgId} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${im.w} /Height ${im.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${im.bytes.length} >>\nstream\n`);add(im.bytes);add('\nendstream\nendobj\n');
   const stream=`q\n${dw.toFixed(2)} 0 0 ${dh.toFixed(2)} ${x.toFixed(2)} ${y.toFixed(2)} cm\n/Im0 Do\nQ\n`;obj(content,`<< /Length ${stream.length} >>\nstream\n${stream}endstream`);
  });
  const xref=len;add(`xref\n0 ${objCount+1}\n0000000000 65535 f \n`);for(let i=1;i<=objCount;i++)add(String(offsets[i]).padStart(10,'0')+' 00000 n \n');
  add(`trailer\n<< /Size ${objCount+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`);
  const blob=new Blob(parts,{type:'application/pdf'}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='考卷去筆跡_練習版.pdf';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),2000);toast('PDF 已產生');
 });
}
$('pdfBtn').onclick=makePdf;

function dbOpen(){return new Promise((res,rej)=>{const r=indexedDB.open('examCleanerDB',1);r.onupgradeneeded=()=>r.result.createObjectStore('projects',{keyPath:'id'});r.onsuccess=()=>res(r.result);r.onerror=rej})}
$('saveProject').onclick=async()=>{const name=prompt('專案名稱：',new Date().toLocaleDateString()+' 考卷');if(!name)return;const db=await dbOpen(),tx=db.transaction('projects','readwrite');tx.objectStore('projects').put({id:uid(),name,date:Date.now(),pages});tx.oncomplete=()=>toast('專案已儲存於此裝置')};
$('loadProject').onclick=async()=>{const db=await dbOpen(),tx=db.transaction('projects','readonly'),r=tx.objectStore('projects').getAll();r.onsuccess=()=>{const box=$('projectList');box.innerHTML='';if(!r.result.length)box.textContent='尚無已儲存專案';r.result.sort((a,b)=>b.date-a.date).forEach(p=>{const d=document.createElement('div');d.style.cssText='padding:10px 0;border-bottom:1px solid #ddd';d.innerHTML=`<b>${p.name}</b><br>${new Date(p.date).toLocaleString()}・${p.pages.length} 頁`;const b=document.createElement('button');b.textContent='載入';b.style.float='right';b.onclick=()=>{pages=p.pages;current=0;displayPage(0);projectDialog.close();toast('專案已載入')};d.prepend(b);box.appendChild(d)});projectDialog.showModal()}};

$('helpBtn').onclick=()=>helpDialog.showModal();
window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();deferredInstall=e;$('installBtn').hidden=false});
$('installBtn').onclick=async()=>{if(deferredInstall){deferredInstall.prompt();await deferredInstall.userChoice;deferredInstall=null;$('installBtn').hidden=true}};
if('serviceWorker'in navigator)window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js').catch(()=>{}));
window.addEventListener('resize',()=>{if(current>=0)fitCanvas()});
renderThumbs();updateControls();
})();