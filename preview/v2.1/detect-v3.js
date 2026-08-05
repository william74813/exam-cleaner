(() => {
  'use strict';
  const btn=document.getElementById('detect');
  if(!btn)return;
  const heading=document.querySelector('header h1');
  const subtitle=document.querySelector('header p');
  if(heading)heading.innerHTML='Exam Cleaner v2.1 Alpha.2.3 <span class="badge">OpenCV</span>';
  if(subtitle)subtitle.textContent='排除全畫面誤判＋紙張邊界評分＋手動備援';

  function polyArea(pts){let s=0;for(let i=0;i<pts.length;i++){const a=pts[i],b=pts[(i+1)%pts.length];s+=a.x*b.y-b.x*a.y}return Math.abs(s)/2}
  function edgeDistanceRatio(pts,w,h){return Math.min(...pts.map(p=>Math.min(p.x/w,p.y/h,(w-p.x)/w,(h-p.y)/h)))}
  function rightAnglePenalty(pts){let total=0;for(let i=0;i<4;i++){const a=pts[(i+3)%4],b=pts[i],c=pts[(i+1)%4];const ux=a.x-b.x,uy=a.y-b.y,vx=c.x-b.x,vy=c.y-b.y;total+=Math.abs((ux*vx+uy*vy)/((Math.hypot(ux,uy)*Math.hypot(vx,vy))||1))}return total/4}
  function score(pts,w,h){
    const area=polyArea(pts),areaRatio=area/(w*h),margin=edgeDistanceRatio(pts,w,h);
    const top=dist(pts[0],pts[1]),bottom=dist(pts[3],pts[2]),left=dist(pts[0],pts[3]),right=dist(pts[1],pts[2]);
    const long=Math.max((top+bottom)/2,(left+right)/2),short=Math.max(1,Math.min((top+bottom)/2,(left+right)/2));
    const ratio=long/short,ratioPenalty=Math.min(1.5,Math.abs(ratio-Math.SQRT2));
    const cx=pts.reduce((s,p)=>s+p.x,0)/4,cy=pts.reduce((s,p)=>s+p.y,0)/4;
    const centerPenalty=Math.hypot(cx-w/2,cy-h/2)/Math.hypot(w/2,h/2);
    const fullFrame=(areaRatio>0.90&&margin<0.018)||(areaRatio>0.965);
    if(fullFrame)return -999;
    if(areaRatio<0.18||areaRatio>0.94)return -999;
    return areaRatio*7.5 + Math.min(margin,0.08)*3 - ratioPenalty*1.15 - rightAnglePenalty(pts)*0.9 - centerPenalty*0.8;
  }

  function runPass(original,scale,kind){
    let small,gray,blur,binary,kernel,contours,hierarchy;const found=[];
    try{
      small=new cv.Mat();cv.resize(original,small,new cv.Size(Math.round(original.cols*scale),Math.round(original.rows*scale)),0,0,cv.INTER_AREA);
      gray=new cv.Mat();blur=new cv.Mat();binary=new cv.Mat();cv.cvtColor(small,gray,cv.COLOR_RGBA2GRAY);
      cv.GaussianBlur(gray,blur,new cv.Size(7,7),0);
      if(kind==='adaptive')cv.adaptiveThreshold(blur,binary,255,cv.ADAPTIVE_THRESH_GAUSSIAN_C,cv.THRESH_BINARY_INV,41,11);
      else if(kind==='bright')cv.threshold(blur,binary,0,255,cv.THRESH_BINARY+cv.THRESH_OTSU);
      else cv.Canny(blur,binary,35,130);
      kernel=cv.getStructuringElement(cv.MORPH_RECT,new cv.Size(kind==='edge'?7:11,kind==='edge'?7:11));
      cv.morphologyEx(binary,binary,cv.MORPH_CLOSE,kernel);
      contours=new cv.MatVector();hierarchy=new cv.Mat();cv.findContours(binary,contours,hierarchy,cv.RETR_EXTERNAL,cv.CHAIN_APPROX_SIMPLE);
      for(let i=0;i<contours.size();i++){
        const cnt=contours.get(i),peri=cv.arcLength(cnt,true);
        for(const eps of [0.012,0.018,0.024,0.032]){
          const approx=new cv.Mat();cv.approxPolyDP(cnt,approx,eps*peri,true);
          if(approx.rows===4&&cv.isContourConvex(approx)){
            const raw=[];for(let j=0;j<4;j++)raw.push({x:approx.data32S[j*2]/scale,y:approx.data32S[j*2+1]/scale});
            const ordered=orderPoints(raw),s=score(ordered,src.width,src.height);
            if(s>-900)found.push({points:ordered,score:s,kind,area:polyArea(ordered)/(src.width*src.height)});
          }
          approx.delete();
        }
        cnt.delete();
      }
    }finally{[small,gray,blur,binary,kernel,contours,hierarchy].forEach(m=>{try{if(m)m.delete()}catch(_){}})}
    return found;
  }

  btn.textContent='自動偵測四角';
  btn.onclick=()=>{
    if(!window.cvReady||!base)return;
    btn.disabled=true;setStatus('正在分析紙張外緣並排除全畫面誤判……');
    setTimeout(()=>{let original;try{
      sctx.putImageData(base,0,0);original=cv.imread(src);const scale=Math.min(1,1000/Math.max(original.cols,original.rows));
      const candidates=[...runPass(original,scale,'edge'),...runPass(original,scale,'adaptive'),...runPass(original,scale,'bright')].sort((a,b)=>b.score-a.score);
      if(!candidates.length)throw new Error('未找到可信的紙張外框');
      const best=candidates[0];
      points=best.points;draw();
      setStatus(`已偵測紙張外框（${best.kind}，占畫面 ${Math.round(best.area*100)}%）。請確認藍框；必要時可手動微調。`,'ready');
    }catch(err){
      defaultPoints();setStatus('自動偵測未取得可信結果，已保留手動四角：'+err.message,'warn');
    }finally{try{if(original)original.delete()}catch(_){}btn.disabled=false}},60);
  };
})();
