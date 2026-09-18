/* ============================================================
   ForgeOS // fx.js
   交互特效引擎
   夜色主题：光标 / 聚光 / 粒子星网 / 视差 / 涟漪
   蓝白主题：光标 / 色散玻璃聚光 / 六边形 HUD 网格（无星星）/ 视差 / 涟漪
   ============================================================ */
(() => {
  'use strict';

  const root = document.documentElement;
  const FINE = window.matchMedia('(pointer: fine)').matches;
  const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const lerp = (a, b, t) => a + (b - a) * t;

  /* ----------------------------------------------------------
     主题
     ---------------------------------------------------------- */
  const PALETTE = {
    dark: {
      a: '96,165,250', b: '34,211,238', c: '167,139,250',
      link: '96,165,250', linkA: 0.22,
      mlink: '34,211,238', mlinkA: 0.42,
      r1: '34,211,238', r2: '96,165,250',
      trail: '34,211,238', core: '255,255,255', trailK: 1      // 流星拖尾：光带 / 内芯 / 亮度系数
    },
    light: {
      a: '37,99,235', b: '13,148,136', c: '124,58,237',
      link: '59,130,246', linkA: 0.24,
      mlink: '13,148,136', mlinkA: 0.4,
      r1: '37,99,235', r2: '13,148,136',
      trail: '37,99,235', core: '8,145,178', trailK: 1.45
    }
  };
  let pal = PALETTE.dark;
  let light = false;
  function syncTheme() {
    light = root.getAttribute('data-theme') === 'light';
    pal = light ? PALETTE.light : PALETTE.dark;
  }
  syncTheme();

  const dot = document.querySelector('.cursor-dot');
  const ring = document.querySelector('.cursor-ring');
  const spot = null;   /* 鼠标大光晕已移除（原 #spotlight），保留空引用让下方分支自然跳过 */
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
     二、画布资源
     夜色 = 粒子星网；蓝白 = 六边形玻璃网格
     ---------------------------------------------------------- */
  let W = 0, H = 0, DPR = 1;
  let parts = [];
  let hexes = [];
  const ripples = [];

  function seed() {
    /* 分层均匀撒点：避免纯随机聚簇导致的“一侧密一侧疏” */
    const target = Math.round(Math.min(200, Math.max(34, (W * H) / 11000)));
    parts = [];
    const cols = Math.max(1, Math.round(Math.sqrt(target * (W / Math.max(1, H)))));
    const rows = Math.ceil(target / cols);
    const cw = W / cols, ch = H / rows;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (parts.length >= target) break;
        const t = Math.random();
        parts.push({
          x: (c + 0.12 + Math.random() * 0.76) * cw,
          y: (r + 0.12 + Math.random() * 0.76) * ch,
          vx: (Math.random() - 0.5) * 0.42,
          vy: (Math.random() - 0.5) * 0.42,
          r: Math.random() * 1.6 + 0.6,
          c: t < 0.62 ? 'a' : (t < 0.84 ? 'b' : 'c')
        });
      }
    }
  }

  /* 六边形蜂窝网格（pointy-top），浅色主题的玻璃 HUD */
  const HEX_SIZE = 46;   // 六边形半径
  const HEX_R = 190;     // 鼠标感应半径

  function seedHex() {
    hexes = [];
    const w = Math.sqrt(3) * HEX_SIZE;
    const h = 1.5 * HEX_SIZE;
    const cols = Math.ceil(W / w) + 2;
    const rows = Math.ceil(H / h) + 2;
    for (let r = -1; r < rows; r++) {
      for (let c = -1; c < cols; c++) {
        hexes.push({
          x: c * w + ((r & 1) ? w / 2 : 0) + w / 2,
          y: r * h + HEX_SIZE,
          s: HEX_SIZE * 0.94
        });
      }
    }
  }

  function hexPath(cx, cy, s) {
    for (let i = 0; i < 6; i++) {
      const a = Math.PI * (60 * i - 90) / 180;
      const x = cx + s * Math.cos(a);
      const y = cy + s * Math.sin(a);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
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
    seedHex();
    if (REDUCED) drawFrame(1); // 静态降级：只画一帧
  }

  /* ----------------------------------------------------------
     三、涟漪系统：单击脉冲 + 长按水面波纹（按住拖动画出涟漪轨迹）
     ---------------------------------------------------------- */
  let hold = null;
  const HOLD_EVERY = 24;   // 长按出波间隔（帧）≈ 0.4s，慢速水面

  function spawnRipple(x, y, o) {
    if (REDUCED) return;
    ripples.push(Object.assign({
      x: x, y: y, r: 5, a: 0.55, spd: 3.4, dec: 0.972,
      lw: 1.5, ring2: true, c: 'r1'
    }, o || {}));
  }

  /* 流星拖尾：长按划动时记录的采样点 */
  const trail = [];          // { x, y, t }
  const TRAIL_LIFE = 620;    // 拖尾存活时间（毫秒）
  const TRAIL_MAX = 96;      // 最大采样点数
  let trailLastX = 0, trailLastY = 0;

  window.addEventListener('pointerdown', (e) => {
    if (REDUCED) return;
    spawnRipple(e.clientX, e.clientY);
    hold = { x: e.clientX, y: e.clientY, acc: 0, alt: false };
    trail.length = 0;
    trailLastX = e.clientX;
    trailLastY = e.clientY;
  }, { passive: true });

  window.addEventListener('pointermove', (e) => {
    if (hold) {
      hold.x = e.clientX;
      hold.y = e.clientY;
      /* 每移动超过 4px 采样一个拖尾点 */
      const dx = e.clientX - trailLastX;
      const dy = e.clientY - trailLastY;
      if (dx * dx + dy * dy > 16) {
        trail.push({ x: e.clientX, y: e.clientY, t: performance.now() });
        if (trail.length > TRAIL_MAX) trail.shift();
        trailLastX = e.clientX;
        trailLastY = e.clientY;
      }
    }
  }, { passive: true });

  const endHold = () => { hold = null; };
  window.addEventListener('pointerup', endHold, { passive: true });
  window.addEventListener('pointercancel', endHold, { passive: true });
  window.addEventListener('blur', endHold);

  /* ----------------------------------------------------------
     四、绘制：夜色粒子星网
     ---------------------------------------------------------- */
  const LINK_D = 128;   // 粒子连线距离
  const MOUSE_D = 190;  // 鼠标连线距离
  const REPEL_D = 140;  // 鼠标排斥半径

  function drawStars(dt) {
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

    /* 粒子间连线 */
    ctx.lineWidth = 1;
    for (let i = 0; i < parts.length; i++) {
      const a = parts[i];
      for (let j = i + 1; j < parts.length; j++) {
        const b = parts[j];
        const dx = a.x - b.x, dy = a.y - b.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < LINK_D * LINK_D) {
          const alpha = (1 - Math.sqrt(d2) / LINK_D) * pal.linkA;
          ctx.strokeStyle = 'rgba(' + pal.link + ',' + alpha.toFixed(3) + ')';
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
        }
      }
    }

    /* 鼠标连线（主题强调色高亮） */
    if (mouseOn && !REDUCED) {
      for (const p of parts) {
        const dx = p.x - mx, dy = p.y - my;
        const d = Math.hypot(dx, dy);
        if (d < MOUSE_D) {
          const alpha = (1 - d / MOUSE_D) * pal.mlinkA;
          ctx.strokeStyle = 'rgba(' + pal.mlink + ',' + alpha.toFixed(3) + ')';
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(mx, my);
          ctx.stroke();
        }
      }
    }

    /* 粒子本体 */
    for (const p of parts) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(' + pal[p.c] + ',0.62)';
      ctx.fill();
    }
  }

  /* ----------------------------------------------------------
     五、绘制：蓝白玻璃六边形 HUD 网格
     ---------------------------------------------------------- */
  function drawGlassGrid() {
    /* 基础网格：全部六边形合成一条路径，一次描边 */
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(37,99,235,0.09)';
    ctx.beginPath();
    for (const hx of hexes) hexPath(hx.x, hx.y, hx.s);
    ctx.stroke();

    if (!mouseOn || REDUCED) return;

    /* 鼠标邻域：玻璃面板被逐格点亮 */
    for (const hx of hexes) {
      const dx = hx.x - mx, dy = hx.y - my;
      const d = Math.hypot(dx, dy);
      if (d >= HEX_R) continue;
      const k = 1 - d / HEX_R;
      ctx.beginPath();
      hexPath(hx.x, hx.y, hx.s);
      ctx.fillStyle = 'rgba(147,197,253,' + (0.16 * k).toFixed(3) + ')';
      ctx.fill();
      ctx.strokeStyle = 'rgba(34,211,238,' + (0.5 * k).toFixed(3) + ')';
      ctx.stroke();
    }
  }

  /* ----------------------------------------------------------
     六、绘制：涟漪（两种主题通用）
     ---------------------------------------------------------- */
  function drawRipples(dt) {
    for (let i = ripples.length - 1; i >= 0; i--) {
      const rp = ripples[i];
      rp.r += rp.spd * dt;
      rp.a *= Math.pow(rp.dec, dt);
      if (rp.r > 230 || rp.a < 0.02) { ripples.splice(i, 1); continue; }
      ctx.lineWidth = rp.lw;
      ctx.strokeStyle = 'rgba(' + pal[rp.c] + ',' + rp.a.toFixed(3) + ')';
      ctx.beginPath();
      ctx.arc(rp.x, rp.y, rp.r, 0, Math.PI * 2);
      ctx.stroke();
      if (rp.ring2) {
        ctx.strokeStyle = 'rgba(' + pal[rp.c === 'r1' ? 'r2' : 'r1'] + ',' + (rp.a * 0.5).toFixed(3) + ')';
        ctx.beginPath();
        ctx.arc(rp.x, rp.y, rp.r * 0.62, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.lineWidth = 1;
    }
  }

  /* ----------------------------------------------------------
     七、绘制：流星拖尾（长按划动时划过水面的光轨）
     ---------------------------------------------------------- */
  function drawTrail() {
    const now = performance.now();
    while (trail.length && now - trail[0].t > TRAIL_LIFE) trail.shift();
    if (trail.length < 2 || REDUCED) return;

    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    for (let i = 1; i < trail.length; i++) {
      const a = trail[i - 1];
      const b = trail[i];
      const k = Math.max(0, 1 - (now - b.t) / TRAIL_LIFE);   // 1 最新 → 0 最旧
      const kk = Math.min(1, k * pal.trailK);

      /* 外发光 */
      ctx.strokeStyle = 'rgba(' + pal.trail + ',' + (0.12 * kk).toFixed(3) + ')';
      ctx.lineWidth = 2 + 11 * k;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();

      /* 光带主体 */
      ctx.strokeStyle = 'rgba(' + pal.trail + ',' + (0.42 * kk).toFixed(3) + ')';
      ctx.lineWidth = 1 + 3.6 * k;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();

      /* 内芯（流星亮线） */
      ctx.strokeStyle = 'rgba(' + pal.core + ',' + (0.5 * kk).toFixed(3) + ')';
      ctx.lineWidth = Math.max(0.6, 1.7 * k);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    }
    ctx.lineWidth = 1;

    /* 流星头部：光晕 + 亮点 */
    const head = trail[trail.length - 1];
    ctx.beginPath();
    ctx.arc(head.x, head.y, 13, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(' + pal.trail + ',0.14)';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(head.x, head.y, 5, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(' + pal.trail + ',0.35)';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(head.x, head.y, 2.4, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(' + pal.core + ',0.95)';
    ctx.fill();
  }

  /* ----------------------------------------------------------
     八、主绘制调度
     ---------------------------------------------------------- */
  function drawFrame(dt) {
    ctx.clearRect(0, 0, W, H);

    /* 长按：持续涌出的水面波纹（慢速） */
    if (hold) {
      hold.acc += dt;
      if (hold.acc >= HOLD_EVERY) {
        hold.acc = 0;
        hold.alt = !hold.alt;
        spawnRipple(hold.x + (Math.random() * 10 - 5), hold.y + (Math.random() * 10 - 5), {
          spd: 1.5, dec: 0.982, lw: 1.2, ring2: false, c: hold.alt ? 'r1' : 'r2'
        });
      }
    }

    if (light) drawGlassGrid();
    else drawStars(dt);

    drawRipples(dt);
    drawTrail();
  }

  /* ----------------------------------------------------------
     八、主循环：光标缓动 + 聚光 + 视差
     ---------------------------------------------------------- */
  let last = performance.now();

  function frame(now) {
    const dt = Math.min(2.6, (now - last) / 16.667);
    last = now;
    syncTheme();

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
     九、启动
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
