(() => {
  'use strict';

  const canvas = document.getElementById('source');
  if (!canvas) return;

  const heading = document.querySelector('header h1');
  const subtitle = document.querySelector('header p');
  if (heading) heading.innerHTML = 'Exam Cleaner v2.1 <span class="badge">RC3.1</span>';
  if (subtitle) subtitle.textContent = 'GrabCut 紙張分割＋手機角點微調＋灰階增強＋多頁 PDF';

  canvas.style.touchAction = 'none';
  canvas.style.userSelect = 'none';
  canvas.style.webkitUserSelect = 'none';
  canvas.style.webkitTouchCallout = 'none';

  // Replace the original inline pointer handlers. Safari can lose those handlers
  // after a long OpenCV task inside an iframe, especially near canvas edges.
  canvas.onpointerdown = null;
  canvas.onpointermove = null;
  canvas.onpointerup = null;
  canvas.onpointercancel = null;

  let activeIndex = -1;
  let activePointerId = null;

  function canvasPosition(event) {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    return {
      x: (event.clientX - rect.left) * canvas.width / rect.width,
      y: (event.clientY - rect.top) * canvas.height / rect.height,
      scaleX: canvas.width / rect.width,
      scaleY: canvas.height / rect.height
    };
  }

  function hitRadius(position) {
    // Apple's recommended minimum target is about 44 CSS px. Convert that
    // visual size to canvas coordinates and keep a generous lower bound.
    const visualRadius = 48 * Math.max(position.scaleX, position.scaleY);
    return Math.max(visualRadius, Math.min(canvas.width, canvas.height) * 0.055);
  }

  function nearestCorner(position) {
    if (!Array.isArray(points) || points.length !== 4) return -1;
    const radius = hitRadius(position);
    let bestIndex = -1;
    let bestDistance = Infinity;
    points.forEach((point, index) => {
      const value = Math.hypot(point.x - position.x, point.y - position.y);
      if (value <= radius && value < bestDistance) {
        bestDistance = value;
        bestIndex = index;
      }
    });
    return bestIndex;
  }

  function moveCorner(position) {
    if (activeIndex < 0 || !position || !Array.isArray(points)) return;
    points[activeIndex] = {
      x: Math.max(0, Math.min(canvas.width, position.x)),
      y: Math.max(0, Math.min(canvas.height, position.y))
    };
    draw();
  }

  function beginDrag(event) {
    if (!base || !Array.isArray(points) || points.length !== 4) return;
    const position = canvasPosition(event);
    if (!position) return;
    const index = nearestCorner(position);
    if (index < 0) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    activeIndex = index;
    activePointerId = event.pointerId;
    try { canvas.setPointerCapture(event.pointerId); } catch (_) {}
    canvas.style.cursor = 'grabbing';
    moveCorner(position);
    setStatus(`正在微調角點 ${index + 1}；移到紙張實際角落後放開手指。`, 'ready');
  }

  function continueDrag(event) {
    if (activeIndex < 0 || event.pointerId !== activePointerId) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    moveCorner(canvasPosition(event));
  }

  function endDrag(event) {
    if (activeIndex < 0 || (activePointerId !== null && event.pointerId !== activePointerId)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const adjusted = activeIndex + 1;
    try {
      if (activePointerId !== null && canvas.hasPointerCapture(activePointerId)) {
        canvas.releasePointerCapture(activePointerId);
      }
    } catch (_) {}
    activeIndex = -1;
    activePointerId = null;
    canvas.style.cursor = 'grab';
    setStatus(`角點 ${adjusted} 已完成微調。請確認四邊後按「透視校正」。`, 'ready');
  }

  canvas.style.cursor = 'grab';
  canvas.addEventListener('pointerdown', beginDrag, { capture: true, passive: false });
  canvas.addEventListener('pointermove', continueDrag, { capture: true, passive: false });
  canvas.addEventListener('pointerup', endDrag, { capture: true, passive: false });
  canvas.addEventListener('pointercancel', endDrag, { capture: true, passive: false });
  canvas.addEventListener('lostpointercapture', () => {
    activeIndex = -1;
    activePointerId = null;
    canvas.style.cursor = 'grab';
  });

  // Prevent Safari from opening the image callout during a long press.
  canvas.addEventListener('contextmenu', event => event.preventDefault());
})();
