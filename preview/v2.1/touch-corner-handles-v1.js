(() => {
  'use strict';

  const canvas = document.getElementById('source');
  const wrap = canvas?.parentElement;
  if (!canvas || !wrap) return;

  const heading = document.querySelector('header h1');
  const subtitle = document.querySelector('header p');
  if (heading) heading.innerHTML = 'Exam Cleaner v2.1 <span class="badge">RC3.2</span>';
  if (subtitle) subtitle.textContent = 'GrabCut 自動框選＋浮動角點微調＋灰階增強＋多頁 PDF';

  wrap.style.position = 'relative';
  wrap.style.overflow = 'visible';
  canvas.style.touchAction = 'none';
  canvas.style.webkitTouchCallout = 'none';
  canvas.style.userSelect = 'none';
  canvas.style.webkitUserSelect = 'none';

  const layer = document.createElement('div');
  layer.id = 'cornerHandleLayer';
  Object.assign(layer.style, {
    position: 'absolute',
    inset: '0',
    zIndex: '30',
    pointerEvents: 'none',
    overflow: 'visible'
  });
  wrap.appendChild(layer);

  const handles = Array.from({ length: 4 }, (_, index) => {
    const handle = document.createElement('div');
    handle.setAttribute('role', 'button');
    handle.setAttribute('aria-label', `拖曳角點 ${index + 1}`);
    handle.dataset.cornerIndex = String(index);
    handle.textContent = String(index + 1);
    Object.assign(handle.style, {
      position: 'absolute',
      width: '54px',
      height: '54px',
      transform: 'translate(-50%, -50%)',
      borderRadius: '50%',
      border: '3px solid rgba(37,99,235,.92)',
      background: 'rgba(37,99,235,.16)',
      boxShadow: '0 0 0 3px rgba(255,255,255,.75), 0 3px 12px rgba(0,0,0,.28)',
      color: '#fff',
      font: '700 15px -apple-system, BlinkMacSystemFont, sans-serif',
      lineHeight: '48px',
      textAlign: 'center',
      textShadow: '0 1px 3px rgba(0,0,0,.75)',
      touchAction: 'none',
      WebkitUserSelect: 'none',
      userSelect: 'none',
      WebkitTouchCallout: 'none',
      pointerEvents: 'auto',
      cursor: 'grab'
    });
    layer.appendChild(handle);
    return handle;
  });

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function syncHandles() {
    if (!Array.isArray(points) || points.length !== 4 || !base) {
      handles.forEach(handle => { handle.style.display = 'none'; });
      return;
    }

    const displayWidth = canvas.clientWidth;
    const displayHeight = canvas.clientHeight;
    if (!displayWidth || !displayHeight || !canvas.width || !canvas.height) return;

    const offsetLeft = canvas.offsetLeft;
    const offsetTop = canvas.offsetTop;
    handles.forEach((handle, index) => {
      const point = points[index];
      handle.style.display = 'block';
      handle.style.left = `${offsetLeft + point.x / canvas.width * displayWidth}px`;
      handle.style.top = `${offsetTop + point.y / canvas.height * displayHeight}px`;
    });
  }

  function updateCorner(index, clientX, clientY) {
    if (!Array.isArray(points) || points.length !== 4) return;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;

    points[index] = {
      x: clamp((clientX - rect.left) * canvas.width / rect.width, 0, canvas.width),
      y: clamp((clientY - rect.top) * canvas.height / rect.height, 0, canvas.height)
    };
    draw();
    syncHandles();
  }

  let activeTouch = null;
  let activeMouse = null;
  let previousOverflow = '';

  function beginTouch(event, index) {
    const touch = event.changedTouches?.[0];
    if (!touch || !base) return;
    event.preventDefault();
    event.stopPropagation();
    activeTouch = { index, identifier: touch.identifier };
    previousOverflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = 'hidden';
    handles[index].style.cursor = 'grabbing';
    handles[index].style.transform = 'translate(-50%, -50%) scale(1.12)';
    updateCorner(index, touch.clientX, touch.clientY);
    setStatus(`正在微調角點 ${index + 1}，移到紙張實際角落後放開手指。`, 'ready');
  }

  function moveTouch(event) {
    if (!activeTouch) return;
    const touch = Array.from(event.touches || []).find(item => item.identifier === activeTouch.identifier);
    if (!touch) return;
    event.preventDefault();
    event.stopPropagation();
    updateCorner(activeTouch.index, touch.clientX, touch.clientY);
  }

  function endTouch(event) {
    if (!activeTouch) return;
    const ended = Array.from(event.changedTouches || []).some(item => item.identifier === activeTouch.identifier);
    if (!ended && event.type !== 'touchcancel') return;
    event.preventDefault();
    event.stopPropagation();
    const index = activeTouch.index;
    activeTouch = null;
    document.documentElement.style.overflow = previousOverflow;
    handles[index].style.cursor = 'grab';
    handles[index].style.transform = 'translate(-50%, -50%)';
    syncHandles();
    setStatus(`角點 ${index + 1} 已完成微調。可繼續調整其他角點，或按「透視校正」。`, 'ready');
  }

  function beginMouse(event, index) {
    if (event.button !== 0 || !base) return;
    event.preventDefault();
    event.stopPropagation();
    activeMouse = index;
    handles[index].style.cursor = 'grabbing';
    updateCorner(index, event.clientX, event.clientY);
  }

  function moveMouse(event) {
    if (activeMouse === null) return;
    event.preventDefault();
    updateCorner(activeMouse, event.clientX, event.clientY);
  }

  function endMouse() {
    if (activeMouse === null) return;
    const index = activeMouse;
    activeMouse = null;
    handles[index].style.cursor = 'grab';
    setStatus(`角點 ${index + 1} 已完成微調。`, 'ready');
  }

  handles.forEach((handle, index) => {
    handle.addEventListener('touchstart', event => beginTouch(event, index), { passive: false });
    handle.addEventListener('mousedown', event => beginMouse(event, index));
    handle.addEventListener('contextmenu', event => event.preventDefault());
  });

  document.addEventListener('touchmove', moveTouch, { capture: true, passive: false });
  document.addEventListener('touchend', endTouch, { capture: true, passive: false });
  document.addEventListener('touchcancel', endTouch, { capture: true, passive: false });
  document.addEventListener('mousemove', moveMouse, { capture: true });
  document.addEventListener('mouseup', endMouse, { capture: true });

  window.addEventListener('resize', syncHandles);
  window.addEventListener('orientationchange', () => setTimeout(syncHandles, 250));
  document.addEventListener('scroll', syncHandles, true);

  // Detection and image loading redraw the canvas without changing the DOM.
  // A lightweight timer keeps the HTML handles aligned with the latest points.
  const syncTimer = setInterval(syncHandles, 120);
  window.addEventListener('pagehide', () => clearInterval(syncTimer), { once: true });

  syncHandles();
})();
