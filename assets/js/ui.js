/* ============================================================
   ForgeOS // ui.js
   界面逻辑：启动序列 / 打字机 / 终端打字 / 卡片倾斜 / 数字滚动 / Toast
   ============================================================ */
(() => {
  'use strict';

  const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const FINE = window.matchMedia('(pointer: fine)').matches;

  /* ----------------------------------------------------------
     一、启动序列（每次会话只播放一次）
     ---------------------------------------------------------- */
  const boot = document.getElementById('boot');
  let booted = false;
  try { booted = sessionStorage.getItem('forgeos:booted') === '1'; } catch (e) { /* 隐私模式忽略 */ }

  function systemReady() {
    if (document.body.classList.contains('ready')) return;
    document.body.classList.add('ready');
    initCounters();
  }

  if (!boot) {
    systemReady();
  } else if (REDUCED || booted) {
    boot.remove();
    systemReady();
  } else {
    runBoot(boot);
  }

  function runBoot(el) {
    const fill = document.getElementById('bootFill');
    const pct = document.getElementById('bootPct');
    const lines = Array.from(document.querySelectorAll('#bootLines .boot-line'));
    const DUR = 2100;
    const t0 = performance.now();
    let done = false;
    let li = 0;

    const lineTimer = setInterval(() => {
      if (li < lines.length) lines[li++].classList.add('on');
      else clearInterval(lineTimer);
    }, Math.round(DUR / (lines.length + 1)));

    function finish() {
      if (done) return;
      done = true;
      clearInterval(lineTimer);
      lines.forEach((l) => l.classList.add('on'));
      if (fill) fill.style.width = '100%';
      if (pct) pct.textContent = '100%';
      el.classList.add('done');
      try { sessionStorage.setItem('forgeos:booted', '1'); } catch (e) { /* ignore */ }
      systemReady();
      setTimeout(() => el.remove(), 700);
    }

    function progress(now) {
      if (done) return;
      const k = Math.min(1, (now - t0) / DUR);
      const eased = 1 - Math.pow(1 - k, 3);
      const v = Math.round(eased * 100);
      if (fill) fill.style.width = (eased * 100).toFixed(1) + '%';
      if (pct) pct.textContent = String(v).padStart(3, '0') + '%';
      if (k < 1) requestAnimationFrame(progress);
      else finish();
    }

    requestAnimationFrame(progress);

    /* 点击 / 按键跳过 */
    el.addEventListener('pointerdown', finish);
    window.addEventListener('keydown', finish, { once: true });
    /* 兜底：6 秒后强制结束，避免任何意外卡死 */
    setTimeout(finish, 6000);
  }

  /* ----------------------------------------------------------
     二、英雄区打字机
     ---------------------------------------------------------- */
  (function typewriter() {
    const el = document.getElementById('typewriter');
    if (!el) return;
    const PHRASES = [
      '锻造代码，淬炼知识。',
      '学习助手 · 代码工坊 · 知识引擎 · 任务矩阵。',
      '一站式个人工作间，为你而建。'
    ];
    if (REDUCED) { el.textContent = PHRASES[0]; return; }

    let pi = 0, ci = 0, del = false;
    (function tick() {
      const cur = PHRASES[pi];
      if (!del) {
        ci++;
        el.textContent = cur.slice(0, ci);
        if (ci === cur.length) { del = true; return setTimeout(tick, 2100); }
        return setTimeout(tick, 68);
      }
      ci--;
      el.textContent = cur.slice(0, ci);
      if (ci === 0) { del = false; pi = (pi + 1) % PHRASES.length; return setTimeout(tick, 420); }
      setTimeout(tick, 26);
    })();
  })();

  /* ----------------------------------------------------------
     三、数字滚动（等系统就绪后再启动，与启动动画错开）
     ---------------------------------------------------------- */
  function initCounters() {
    const nodes = document.querySelectorAll('[data-count]');
    if (!nodes.length) return;

    const io = new IntersectionObserver((entries) => {
      entries.forEach((en) => {
        if (!en.isIntersecting) return;
        io.unobserve(en.target);
        animateCount(en.target);
      });
    }, { threshold: 0.4 });

    nodes.forEach((el) => io.observe(el));
  }

  function animateCount(el) {
    const target = parseFloat(el.dataset.count || '0');
    const dec = parseInt(el.dataset.decimals || '0', 10);
    const pad = parseInt(el.dataset.pad || '0', 10);
    const comma = el.dataset.comma === '1';
    const suffix = el.dataset.suffix || '';

    const fmt = (v) => {
      let s = comma ? Math.round(v).toLocaleString('en-US') : v.toFixed(dec);
      if (pad) s = s.padStart(pad, '0');
      return suffix ? s + '<span class="sfx">' + suffix + '</span>' : s;
    };

    if (REDUCED) { el.innerHTML = fmt(target); return; }

    const t0 = performance.now();
    const D = 1500;
    (function step(now) {
      const k = Math.min(1, (now - t0) / D);
      const eased = 1 - Math.pow(1 - k, 3);
      el.innerHTML = fmt(target * eased);
      if (k < 1) requestAnimationFrame(step);
    })(t0);
  }

  /* ----------------------------------------------------------
     四、终端自动打字（进入视口后播放一次）
     ---------------------------------------------------------- */
  const TERM_LINES = [
    { t: 'cmd', x: 'forge init my-workspace' },
    { t: 'out', x: '[CORE] 正在锻造你的工作间…' },
    { t: 'ok',  x: '[ OK ] 核心引擎已挂载' },
    { t: 'cmd', x: 'forge add study-assistant knowledge-base' },
    { t: 'ok',  x: '[ OK ] 学习助手 + 知识库 已接入' },
    { t: 'cmd', x: 'forge run --mode=deep-work' },
    { t: 'out', x: '[SYS ] 欢迎回来，指挥官。' }
  ];

  (function terminal() {
    const body = document.getElementById('termBody');
    if (!body) return;
    let started = false;

    const io = new IntersectionObserver((entries) => {
      entries.forEach((en) => {
        if (!en.isIntersecting || started) return;
        started = true;
        io.disconnect();
        play();
      });
    }, { threshold: 0.35 });
    io.observe(body);

    function addLine(cls, html) {
      const p = document.createElement('div');
      p.className = 't-line ' + cls;
      p.innerHTML = html;
      body.appendChild(p);
      return p;
    }

    function play() {
      if (REDUCED) {
        TERM_LINES.forEach((l) => {
          const html = l.t === 'cmd'
            ? '<span class="t-prompt">$ </span>' + l.x
            : (l.t === 'ok' ? l.x.replace('[ OK ]', '<span class="t-ok">[ OK ]</span>') : l.x);
          addLine(l.t, html);
        });
        addLine('cmd', '<span class="t-prompt">$ </span><span class="t-cursor"></span>');
        return;
      }

      let i = 0;
      (function nextLine() {
        if (i >= TERM_LINES.length) {
          addLine('cmd', '<span class="t-prompt">$ </span><span class="t-cursor"></span>');
          return;
        }
        const line = TERM_LINES[i++];
        const prefix = line.t === 'cmd' ? '<span class="t-prompt">$ </span>' : '';
        const node = addLine(line.t, prefix);

        /* [OK] 行按字符高亮 */
        const isOk = line.t === 'ok';
        let ci = 0;
        const speed = line.t === 'cmd' ? 34 : 13;
        (function type() {
          ci++;
          const chunk = line.x.slice(0, ci);
          node.innerHTML = prefix + (isOk ? chunk.replace('[ OK ]', '<span class="t-ok">[ OK ]</span>') : chunk);
          if (ci < line.x.length) return setTimeout(type, speed);
          setTimeout(nextLine, line.t === 'cmd' ? 320 : 160);
        })();
      })();
    }
  })();

  /* ----------------------------------------------------------
     五、滚动出现动画
     ---------------------------------------------------------- */
  const revealIO = new IntersectionObserver((entries) => {
    entries.forEach((en) => {
      if (!en.isIntersecting) return;
      en.target.classList.add('in');
      revealIO.unobserve(en.target);
    });
  }, { threshold: 0.15, rootMargin: '0px 0px -8% 0px' });

  document.querySelectorAll('.reveal').forEach((el) => {
    const d = el.dataset.delay;
    if (d) el.style.transitionDelay = d + 'ms';
    revealIO.observe(el);
  });

  /* ----------------------------------------------------------
     六、模块卡片 3D 倾斜 + 光泽
     ---------------------------------------------------------- */
  if (FINE && !REDUCED) {
    const MAX = 7;
    document.querySelectorAll('[data-tilt]').forEach((card) => {
      card.addEventListener('pointermove', (e) => {
        const r = card.getBoundingClientRect();
        const px = (e.clientX - r.left) / r.width;
        const py = (e.clientY - r.top) / r.height;
        const ry = (px - 0.5) * 2 * MAX;
        const rx = -(py - 0.5) * 2 * MAX;
        card.style.transform =
          'perspective(900px) rotateX(' + rx.toFixed(2) + 'deg) rotateY(' + ry.toFixed(2) + 'deg) translateY(-4px)';
        card.style.setProperty('--gx', (px * 100).toFixed(1) + '%');
        card.style.setProperty('--gy', (py * 100).toFixed(1) + '%');
      });
      card.addEventListener('pointerleave', () => { card.style.transform = ''; });
    });
  }

  /* ----------------------------------------------------------
     七、导航栏
     ---------------------------------------------------------- */
  const nav = document.getElementById('navbar');
  const navLinks = document.getElementById('navLinks');
  const navToggle = document.getElementById('navToggle');

  window.addEventListener('scroll', () => {
    if (nav) nav.classList.toggle('scrolled', window.scrollY > 8);
  }, { passive: true });

  navToggle?.addEventListener('click', () => {
    const open = navLinks.classList.toggle('open');
    navToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
  });

  navLinks?.addEventListener('click', (e) => {
    if (e.target.closest('a')) {
      navLinks.classList.remove('open');
      navToggle?.setAttribute('aria-expanded', 'false');
    }
  });

  /* 高亮当前章节 */
  const navMap = {};
  document.querySelectorAll('.nav-link[data-nav]').forEach((a) => { navMap[a.dataset.nav] = a; });
  const secIO = new IntersectionObserver((entries) => {
    entries.forEach((en) => {
      if (!en.isIntersecting) return;
      document.querySelectorAll('.nav-link.active').forEach((a) => a.classList.remove('active'));
      navMap[en.target.id]?.classList.add('active');
    });
  }, { rootMargin: '-42% 0px -52% 0px' });
  document.querySelectorAll('section[id], footer[id]').forEach((s) => secIO.observe(s));

  /* ----------------------------------------------------------
     七点五、主题切换（右上角：蓝白科幻风 ⇄ 夜色）
     ---------------------------------------------------------- */
  const themeToggle = document.getElementById('themeToggle');
  const themeLabel = document.getElementById('themeLabel');
  const themeMeta = document.querySelector('meta[name="theme-color"]');

  function currentTheme() {
    return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
  }

  function applyTheme(t, persist) {
    if (t === 'light') document.documentElement.setAttribute('data-theme', 'light');
    else document.documentElement.removeAttribute('data-theme');
    if (themeLabel) themeLabel.textContent = t === 'light' ? '蓝白' : '夜色';
    themeToggle?.setAttribute('aria-pressed', t === 'light' ? 'true' : 'false');
    if (themeMeta) themeMeta.setAttribute('content', t === 'light' ? '#eef4fd' : '#050a18');
    if (persist) {
      try { localStorage.setItem('forgeos:theme', t); } catch (e) { /* ignore */ }
    }
  }

  applyTheme(currentTheme(), false);
  themeToggle?.addEventListener('click', () => {
    applyTheme(currentTheme() === 'light' ? 'dark' : 'light', true);
  });

  /* ----------------------------------------------------------
     八、Toast 提示
     ---------------------------------------------------------- */
  const toastRoot = document.getElementById('toastRoot');
  function toast(msg) {
    if (!toastRoot) return;
    const t = document.createElement('div');
    t.className = 'toast';
    t.innerHTML = '<span class="toast-dot"></span><span></span>';
    t.lastElementChild.textContent = msg;
    toastRoot.appendChild(t);
    requestAnimationFrame(() => t.classList.add('in'));
    setTimeout(() => {
      t.classList.remove('in');
      setTimeout(() => t.remove(), 350);
    }, 2900);
  }

  document.querySelectorAll('[data-toast]').forEach((el) => {
    el.addEventListener('click', (e) => {
      if (el.tagName === 'A' && el.getAttribute('href') === '#') e.preventDefault();
      toast(el.dataset.toast);
    });
  });

  /* ----------------------------------------------------------
     九、杂项
     ---------------------------------------------------------- */
  document.querySelectorAll('.js-year').forEach((el) => { el.textContent = new Date().getFullYear(); });
  if (nav) nav.classList.toggle('scrolled', window.scrollY > 8);
})();
