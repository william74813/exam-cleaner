(() => {
  'use strict';
  const btn=document.getElementById('detect');
  if(!btn)return;
  const heading=document.querySelector('header h1');
  const subtitle=document.querySelector('header p');
  if(heading)heading.innerHTML='Exam Cleaner v2.1 Alpha.2.4 <span class="badge">OpenCV</span>';
  if(subtitle)subtitle.textContent='四條邊分別搜尋＋交點計算＋手動微調';

  function lineFromSegment(x1,y1,x2,y2,scale){
    x1/=scale;y1/=scale;x2/=scale;y2/=scale;
    const A=y1-y2,B=x2-x1,C=x1*y2-x2*y1;
    const n=Math.hypot(A,B)||1;
    return{A:A/n,B:B/n,C:C/n,x1,y1,x2,y2,len:Math.hypot(x2-x1,y2-y1),mx:(x1+x2)/2,my:(y1+y2)/2};
  }
  function intersection(l1,l2){
    const d=l1.A*l2.B-l2.A*l1.B;
    if(Math.abs(d)<1e-6)return null;
    return{x:(l1.B*l2.C-l2.B*l1.C)/d,y:(l1.C*l2.A-l2.C*l1.A)/d};
  }
  function validPoint(p,w,h){return p&&p.x>-w*.12&&p.x<w*1.12&&p.y>-h*.12&&p.y<h*1.12}
  function choose(lines,type,w,h){
    const filtered=lines.filter(l=>{
      const dx=Math.abs(l.x2-l.x1),dy=Math.abs(l.y2-l.y1);
      return type==='h'?dx>dy*1.8:dy>dx*1.8;
    });
    if(filtered.length<2)return null;
    const center=type==='h'?h/2:w/2;
    const coord=l=>type==='h'?l.my:l.mx;
    const neg=filtered.filter(l=>coord(l)<center).sort((a,b)=>(b.len-a.len)+((center-coord(a))-(center-coord(b)))*.18);
    const pos=filtered.filter(l=>coord(l)>=center).sort((a,b)=>(b.len-a.len)+((coord(a)-center)-(coord(b)-center))*.18);
    if(!neg.length||!pos.length)return null;
    let first=neg[0],second=pos[0];
    const sep=Math.abs(coord(second)-coord(first));
    const minSep=(type==='h'?h:w)*.45;
    if(sep<minSep){
      const pairs=[];
      for(const a of neg.slice(0,12))for(const b of pos.slice(0,12)){
        const s=Math.abs(coord(b)-coord(a));
        if(s>=minSep)pairs.push({a,b,score:a.len+b.len+s*.35});
      }
      pairs.sort((a,b)=>b.score-a.score);
      if(!pairs.length)return null;
      first=pairs[0].a;second=pairs[0].b;
    }
    return[first,second];
  }

  btn.textContent='自動偵測四角';
  btn.onclick=()=>{
    if(!window.cvReady||!base)return;
    btn.disabled=true;setStatus('正在分別搜尋考卷上、下、左、右四條邊……');
    setTimeout(()=>{
      let original,small,gray,blur,edges,lines;
      try{
        sctx.putImageData(base,0,0);
        original=cv.imread(src);
        const scale=Math.min(1,1100/Math.max(original.cols,original.rows));
        small=new cv.Mat();cv.resize(original,small,new cv.Size(Math.round(original.cols*scale),Math.round(original.rows*scale)),0,0,cv.INTER_AREA);
        gray=new cv.Mat();blur=new cv.Mat();edges=new cv.Mat();lines=new cv.Mat();
        cv.cvtColor(small,gray,cv.COLOR_RGBA2GRAY);
        cv.GaussianBlur(gray,blur,new cv.Size(5,5),0);
        cv.Canny(blur,edges,28,105);
        const kernel=cv.getStructuringElement(cv.MORPH_RECT,new cv.Size(3,3));
        cv.dilate(edges,edges,kernel);
        cv.HoughLinesP(edges,lines,1,Math.PI/180,45,Math.round(Math.min(small.cols,small.rows)*.20),18);
        kernel.delete();
        const all=[];
        for(let i=0;i<lines.rows;i++){
          const j=i*4;all.push(lineFromSegment(lines.data32S[j],lines.data32S[j+1],lines.data32S[j+2],lines.data32S[j+3],scale));
        }
        const hs=choose(all,'h',src.width,src.height),vs=choose(all,'v',src.width,src.height);
        if(!hs||!vs)throw new Error('無法同時確認四條紙張邊線');
        let [top,bottom]=hs,[left,right]=vs;
        if(top.my>bottom.my)[top,bottom]=[bottom,top];
        if(left.mx>right.mx)[left,right]=[right,left];
        const tl=intersection(top,left),tr=intersection(top,right),br=intersection(bottom,right),bl=intersection(bottom,left);
        const candidate=[tl,tr,br,bl];
        if(!candidate.every(p=>validPoint(p,src.width,src.height)))throw new Error('邊線交點超出合理範圍');
        const area=Math.abs(candidate.reduce((s,p,i)=>{const q=candidate[(i+1)%4];return s+p.x*q.y-q.x*p.y},0))/2/(src.width*src.height);
        if(area<.28||area>.92)throw new Error('估算紙張範圍不合理');
        points=candidate.map(p=>({x:Math.max(0,Math.min(src.width,p.x)),y:Math.max(0,Math.min(src.height,p.y))}));
        draw();
        setStatus(`已由四條邊線估算紙張範圍（約占畫面 ${Math.round(area*100)}%）。請檢查藍框，必要時拖曳微調。`,'ready');
      }catch(err){
        defaultPoints();setStatus('線段偵測仍無法取得可信結果，已切回手動角點：'+err.message,'warn');
      }finally{
        [original,small,gray,blur,edges,lines].forEach(m=>{try{if(m)m.delete()}catch(_){}});
        btn.disabled=false;
      }
    },60);
  };
})();
