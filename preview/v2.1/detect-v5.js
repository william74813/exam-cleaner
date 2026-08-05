(() => {
  'use strict';
  const btn=document.getElementById('detect');
  if(!btn)return;
  const heading=document.querySelector('header h1');
  const subtitle=document.querySelector('header p');
  if(heading)heading.innerHTML='Exam Cleaner v2.1 Alpha.2.5 <span class="badge">OpenCV</span>';
  if(subtitle)subtitle.textContent='外圍邊線限制＋排除考卷內部分隔線＋手動微調';

  function lineFromSegment(x1,y1,x2,y2,scale){
    x1/=scale;y1/=scale;x2/=scale;y2/=scale;
    const A=y1-y2,B=x2-x1,C=x1*y2-x2*y1,n=Math.hypot(A,B)||1;
    return{A:A/n,B:B/n,C:C/n,x1,y1,x2,y2,len:Math.hypot(x2-x1,y2-y1),mx:(x1+x2)/2,my:(y1+y2)/2};
  }
  function intersection(a,b){const d=a.A*b.B-b.A*a.B;if(Math.abs(d)<1e-6)return null;return{x:(a.B*b.C-b.B*a.C)/d,y:(a.C*b.A-b.C*a.A)/d}}
  function valid(p,w,h){return p&&p.x>=-w*.05&&p.x<=w*1.05&&p.y>=-h*.05&&p.y<=h*1.05}
  function polygonArea(pts){return Math.abs(pts.reduce((s,p,i)=>{const q=pts[(i+1)%4];return s+p.x*q.y-q.x*p.y},0))/2}

  function bestLine(lines,side,w,h){
    const horizontal=side==='top'||side==='bottom';
    const candidates=lines.filter(l=>{
      const dx=Math.abs(l.x2-l.x1),dy=Math.abs(l.y2-l.y1);
      if(horizontal && dx<=dy*2.2)return false;
      if(!horizontal && dy<=dx*2.2)return false;
      if(horizontal && l.len<w*.28)return false;
      if(!horizontal && l.len<h*.28)return false;
      if(side==='top' && l.my>h*.34)return false;
      if(side==='bottom' && l.my<h*.66)return false;
      if(side==='left' && l.mx>w*.30)return false;
      if(side==='right' && l.mx<w*.70)return false;
      return true;
    });
    if(!candidates.length)return null;
    const target=side==='top'?h*.06:side==='bottom'?h*.94:side==='left'?w*.06:w*.94;
    return candidates.sort((a,b)=>{
      const ca=horizontal?a.my:a.mx,cb=horizontal?b.my:b.mx;
      const sa=a.len*1.3-Math.abs(ca-target)*.55;
      const sb=b.len*1.3-Math.abs(cb-target)*.55;
      return sb-sa;
    })[0];
  }

  btn.textContent='自動偵測四角';
  btn.onclick=()=>{
    if(!window.cvReady||!base)return;
    btn.disabled=true;setStatus('正在搜尋紙張外圍四條邊，並排除中央分隔線……');
    setTimeout(()=>{
      let original,small,gray,blur,edges,lines,kernel;
      try{
        sctx.putImageData(base,0,0);original=cv.imread(src);
        const scale=Math.min(1,1200/Math.max(original.cols,original.rows));
        small=new cv.Mat();cv.resize(original,small,new cv.Size(Math.round(original.cols*scale),Math.round(original.rows*scale)),0,0,cv.INTER_AREA);
        gray=new cv.Mat();blur=new cv.Mat();edges=new cv.Mat();lines=new cv.Mat();
        cv.cvtColor(small,gray,cv.COLOR_RGBA2GRAY);cv.GaussianBlur(gray,blur,new cv.Size(5,5),0);cv.Canny(blur,edges,24,95);
        kernel=cv.getStructuringElement(cv.MORPH_RECT,new cv.Size(3,3));cv.dilate(edges,edges,kernel);
        cv.HoughLinesP(edges,lines,1,Math.PI/180,38,Math.round(Math.min(small.cols,small.rows)*.16),22);
        const all=[];for(let i=0;i<lines.rows;i++){const j=i*4;all.push(lineFromSegment(lines.data32S[j],lines.data32S[j+1],lines.data32S[j+2],lines.data32S[j+3],scale))}
        const top=bestLine(all,'top',src.width,src.height),bottom=bestLine(all,'bottom',src.width,src.height),left=bestLine(all,'left',src.width,src.height),right=bestLine(all,'right',src.width,src.height);
        if(!top||!bottom||!left||!right)throw new Error('外圍四條邊不足');
        const candidate=[intersection(top,left),intersection(top,right),intersection(bottom,right),intersection(bottom,left)];
        if(!candidate.every(p=>valid(p,src.width,src.height)))throw new Error('交點超出合理範圍');
        const area=polygonArea(candidate)/(src.width*src.height);
        const widthTop=Math.hypot(candidate[1].x-candidate[0].x,candidate[1].y-candidate[0].y);
        const widthBottom=Math.hypot(candidate[2].x-candidate[3].x,candidate[2].y-candidate[3].y);
        if(area<.42||area>.92||Math.min(widthTop,widthBottom)<src.width*.48)throw new Error('候選範圍不像完整紙張');
        points=candidate.map(p=>({x:Math.max(0,Math.min(src.width,p.x)),y:Math.max(0,Math.min(src.height,p.y))}));draw();
        setStatus(`已偵測外圍紙張邊界（約占畫面 ${Math.round(area*100)}%）。中央分隔線已排除，請確認角點。`,'ready');
      }catch(err){
        defaultPoints();setStatus('未找到可信的外圍紙張邊界，已保留原始手動角點：'+err.message,'warn');
      }finally{[original,small,gray,blur,edges,lines,kernel].forEach(m=>{try{if(m)m.delete()}catch(_){}});btn.disabled=false}
    },60);
  };
})();