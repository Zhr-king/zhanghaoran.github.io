/* ============================================================
   ForgeOS // fx.js
   交互特效引擎：自定义光标 / 聚光跟随 / 粒子星网 / 视差 / 点击涟漪
   ============================================================ */
(() => {
  'use strict';

  const root = document.documentElement;
  const FINE = window.matchMedia('(pointer: fine)').matches;
  const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const lerp = (a, b, t) => a + (b - a) * t;

  const dot = document.querySelector('.cursor-dot');
  const ring = document.querySelector('.cursor-ring');
  const spot = document.getElementById('spotlight');
  const canvas = document.getElementById('bg-canvas');
  const ctx = canvas ? canvas.getContext('2d') : null;

  /* ----------------------------------------------------------
     一、鼠标状态
     ---------------------------------------------------------- */
  let mx = window.innerWidth / 2;
  let my = window.innerHeight / 2;
  let mouseOn = false;

  let dotX = mx, dotY = my;       // 光标实心点（快）
  let ringX = mx, ringY = my;     // 光标外环（慢，带滞后感）
  let spotX = mx, spotY = my;     // 聚光灯（更慢）
  let parX = 0, parY = 0;         // 视差归一化值 -1..1

  const useCursor = FINE && !REDUCED && dot && ring;
  if (useCursor) document.body.classList.add('has-fine-pointer');

  window.addEventListener('mousemove', (e) => {
    mx = e.clientX;
    my = e.clientY;
    if (!mouseOn) {
      mouseOn = true;
      if (useCursor) document.body.classList.add('cursor-on');
      if (spot) spot.style.opacity = '1';
    }
  }, { passive: true });

  document.addEventListener('mouseleave', () => {
    mouseOn = false;
    if (useCursor) document.body.classList.remove('cursor-on');
    if (spot) spot.style.opacity = '0';
  });

  /* 悬停可交互元素时外环放大 */
  const HOT = 'a, button, .card, [data-hover]';
  document.addEventListener('mouseover', (e) => {
    if (ring && e.target.closest && e.target.closest(HOT)) ring.classList.add('hot');
  });
  document.addEventListener('mouseout', (e) => {
    if (ring && e.target.closest && e.target.closest(HOT)) ring.classList.remove('hot');
  });
  document.addEventListener('mousedown', () => ring && ring.classList.add('down'));
  document.addEventListener('mouseup', () => ring && ring.classList.remove('down'));

  /* ----------------------------------------------------------
     二、粒子星网
     ---------------------------------------------------------- */
  let W = 0, H = 0, DPR = 1;
  let parts = [];
  const ripples = [];

  function seed() {
    const target = Math.round(Math.min(120, Math.max(26, (W * H) / 15000)));
    parts = Array.from({ length: target }, () => ({
      x: Math.random() * W,
      y: Math.random() * H,
      vx: (Math.random() - 0.5) * 0.42,
      vy: (Math.random() - 0.5) * 0.42,
      r: Math.random() * 1.6 + 0.6,
      c: Math.random() < 0.22 ? '34,211,238' : '96,165,250'
    }));
  }

  function resize() {
    if (!canvas || !ctx) return;
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = Math.round(W * DPR);
    canvas.height = Math.round(H * DPR);
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    seed();
    if (REDUCED) drawFrame(1); // 静态降级：只画一帧
  }

  /* 点击涟漪：像机甲雷达脉冲 */
  window.addEventListener('pointerdown', (e) => {
    if (REDUCED) return;
    ripples.push({ x: e.clientX, y: e.clientY, r: 6, a: 0.55 });
  }, { passive: true });

  const LINK_D = 120;   // 粒子连线距离
  const MOUSE_D = 190;  // 鼠标连线距离
  const REPEL_D = 140;  // 鼠标排斥半径

  function drawFrame(dt) {
    ctx.clearRect(0, 0, W, H);

    /* --- 粒子运动 --- */
    for (const p of parts) {
      if (!REDUCED) {
        p.x += p.vx * dt;
        p.y += p.vy * dt;

        if (mouseOn) {
          const dx = p.x - mx, dy = p.y - my;
          const d2 = dx * dx + dy * dy;
          if (d2 > 0.01 && d2 < REPEL_D * REPEL_D) {
            const d = Math.sqrt(d2);
            const f = (1 - d / REPEL_D) * 0.06;
            p.vx += (dx / d) * f * dt;
            p.vy += (dy / d) * f * dt;
          }
        }
        /* 阻尼 + 限速，保持漂浮感 */
        const damp = Math.pow(0.995, dt);
        p.vx *= damp;
        p.vy *= damp;
        const sp = Math.hypot(p.vx, p.vy);
        if (sp > 0.9) { p.vx = (p.vx / sp) * 0.9; p.vy = (p.vy / sp) * 0.9; }
        if (sp < 0.06) { p.vx += (Math.random() - 0.5) * 0.02; p.vy += (Math.random() - 0.5) * 0.02; }
      }

      if (p.x < -24) p.x = W + 24;
      if (p.x > W + 24) p.x = -24;
      if (p.y < -24) p.y = H + 24;
      if (p.y > H + 24) p.y = -24;
    }

    /* --- 粒子间连线 --- */
    ctx.lineWidth = 1;
    for (let i = 0; i < parts.length; i++) {
      const a = parts[i];
      for (let j = i + 1; j < parts.length; j++) {
        const b = parts[j];
        const dx = a.x - b.x, dy = a.y - b.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < LINK_D * LINK_D) {
          const alpha = (1 - Math.sqrt(d2) / LINK_D) * 0.2;
          ctx.strokeStyle = 'rgba(96,165,250,' + alpha.toFixed(3) + ')';
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
        }
      }
    }

    /* --- 鼠标连线（青色高亮） --- */
    if (mouseOn && !REDUCED) {
      for (const p of parts) {
        const dx = p.x - mx, dy = p.y - my;
        const d = Math.hypot(dx, dy);
        if (d < MOUSE_D) {
          const alpha = (1 - d / MOUSE_D) * 0.4;
          ctx.strokeStyle = 'rgba(34,211,238,' + alpha.toFixed(3) + ')';
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(mx, my);
          ctx.stroke();
        }
      }
    }

    /* --- 粒子本体 --- */
    for (const p of parts) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(' + p.c + ',0.6)';
      ctx.fill();
    }

    /* --- 涟漪 --- */
    for (let i = ripples.length - 1; i >= 0; i--) {
      const rp = ripples[i];
      rp.r += 3.4 * dt;
      rp.a *= Math.pow(0.972, dt);
      if (rp.r > 230 || rp.a < 0.02) { ripples.splice(i, 1); continue; }
      ctx.strokeStyle = 'rgba(34,211,238,' + rp.a.toFixed(3) + ')';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(rp.x, rp.y, rp.r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(96,165,250,' + (rp.a * 0.5).toFixed(3) + ')';
      ctx.beginPath();
      ctx.arc(rp.x, rp.y, rp.r * 0.62, 0, Math.PI * 2);
      ctx.stroke();
      ctx.lineWidth = 1;
    }
  }

  /* ----------------------------------------------------------
     三、主循环：光标缓动 + 聚光 + 视差 + 粒子
     ---------------------------------------------------------- */
  let last = performance.now();

  function frame(now) {
    const dt = Math.min(2.6, (now - last) / 16.667);
    last = now;

    /* 缓动插值 */
    dotX = lerp(dotX, mx, 0.6);
    dotY = lerp(dotY, my, 0.6);
    ringX = lerp(ringX, mx, 0.16);
    ringY = lerp(ringY, my, 0.16);
    spotX = lerp(spotX, mx, 0.1);
    spotY = lerp(spotY, my, 0.1);
    parX = lerp(parX, (mx / window.innerWidth - 0.5) * 2, 0.06);
    parY = lerp(parY, (my / window.innerHeight - 0.5) * 2, 0.06);

    if (useCursor) {
      dot.style.transform = 'translate3d(' + dotX + 'px,' + dotY + 'px,0) translate(-50%,-50%)';
      ring.style.transform = 'translate3d(' + ringX + 'px,' + ringY + 'px,0) translate(-50%,-50%)';
    }
    if (spot) spot.style.transform = 'translate3d(' + spotX + 'px,' + spotY + 'px,0) translate(-50%,-50%)';

    /* 视差变量供 CSS 使用 */
    root.style.setProperty('--px', parX.toFixed(4));
    root.style.setProperty('--py', parY.toFixed(4));

    if (ctx) drawFrame(dt);

    requestAnimationFrame(frame);
  }

  /* ----------------------------------------------------------
     四、启动
     ---------------------------------------------------------- */
  let rt = null;
  window.addEventListener('resize', () => {
    clearTimeout(rt);
    rt = setTimeout(resize, 150);
  });

  resize();

  if (!REDUCED) {
    requestAnimationFrame(frame);
  } else if (spot) {
    spot.style.display = 'none';
  }
})();
