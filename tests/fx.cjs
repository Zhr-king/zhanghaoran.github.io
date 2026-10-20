// Run with node tests/fx.cjs. Exercise the real effects engine with a deterministic clock/canvas.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../assets/js/fx.js'), 'utf8');

function setup({ light = false, reduced = false, width = 1440, height = 900, dpr = 2 } = {}) {
  const frames = new Map(), timers = new Map(), observers = [];
  let time = 0, nextId = 0, draws = 0, seed = 12345;
  const makeElement = () => {
    const listeners = new Map();
    return {
      style: { setProperty(name, value) { this[name] = value; }, getPropertyValue(name) { return this[name] || ''; } },
      classList: { add() {}, remove() {}, contains() { return false; } },
      addEventListener(name, handler) { if (!listeners.has(name)) listeners.set(name, []); listeners.get(name).push(handler); },
      emit(name, event = {}) { for (const handler of listeners.get(name) || []) handler(event); }
    };
  };
  const makeContext = () => ({
    lines: [], arcs: [], copies: 0, strokes: 0, points: [],
    setTransform() {}, closePath() {}, fill() {},
    clearRect() { this.lines = []; this.arcs = []; if (this === ctx) draws++; },
    beginPath() { this.points = []; },
    moveTo(x, y) { this.points.push([x, y]); },
    lineTo(x, y) { this.points.push([x, y]); },
    arc(x, y, radius) { this.arcs.push([x, y, radius]); },
    stroke() { this.strokes++; if (this.points.length === 2) this.lines.push({ points: this.points.slice(), color: this.strokeStyle }); },
    drawImage() { this.copies++; }
  });
  const ctx = makeContext(), caches = [], root = makeElement(), dot = makeElement(), ring = makeElement();
  root.getAttribute = () => light ? 'light' : null;
  const canvas = { style: {}, getContext: () => ctx };
  const parallax = [makeElement(), makeElement()];
  parallax[0].classList.contains = name => name === 'hero-rings';
  parallax[1].classList.contains = name => name === 'hero-content';
  const document = Object.assign(makeElement(), {
    hidden: false, documentElement: root, body: makeElement(),
    querySelector: selector => selector === '.cursor-dot' ? dot : ring,
    querySelectorAll: () => parallax,
    getElementById: () => canvas,
    createElement() { const cache = makeContext(); caches.push(cache); return { getContext: () => cache }; }
  });
  const window = Object.assign(makeElement(), {
    innerWidth: width, innerHeight: height, devicePixelRatio: dpr,
    matchMedia: query => ({ matches: query.includes('reduced-motion') ? reduced : true })
  });
  const math = Object.create(Math);
  math.random = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  vm.runInNewContext(source, {
    window, document, Math: math, performance: { now: () => time },
    requestAnimationFrame(fn) { frames.set(++nextId, fn); return nextId; },
    cancelAnimationFrame(id) { frames.delete(id); },
    setTimeout(fn) { timers.set(++nextId, fn); return nextId; }, clearTimeout(id) { timers.delete(id); },
    MutationObserver: class { constructor(fn) { observers.push(fn); } observe() {} },
    Path2D: class { moveTo() {} lineTo() {} closePath() {} }
  });
  const step = (count = 1, interval = 16.667) => {
    for (let i = 0; i < count; i++) {
      time += interval;
      const pending = [...frames.values()]; frames.clear(); pending.forEach(fn => fn(time));
    }
  };
  return {
    window, document, canvas, ctx, root, caches, frames, step, parallax, dot, ring,
    get draws() { return draws; },
    theme(value) { light = value; observers.forEach(fn => fn()); },
    resize(w, h) { window.innerWidth = w; window.innerHeight = h; window.emit('resize'); const pending = [...timers.values()]; timers.clear(); pending.forEach(fn => fn()); }
  };
}

// Every star/link must remain, including close pairs straddling cell boundaries.
for (const [width, height] of [[320, 640], [1440, 900], [2560, 1440]]) {
  const fx = setup({ width, height });
  for (let frame = 0; frame < 300; frame++) {
    fx.step();
    const stars = fx.ctx.arcs;
    assert.equal(stars.length, Math.round(Math.min(200, Math.max(34, width * height / 11000))));
    const expected = [];
    for (let i = 0; i < stars.length; i++) {
      for (let j = i + 1; j < stars.length; j++) {
        const distance = Math.hypot(stars[i][0] - stars[j][0], stars[i][1] - stars[j][1]);
        if (distance < 128) expected.push(JSON.stringify({ points: [stars[i].slice(0, 2), stars[j].slice(0, 2)], color: `rgba(96,165,250,${((1 - distance / 128) * .22).toFixed(3)})` }));
      }
    }
    assert.deepEqual(fx.ctx.lines.map(line => JSON.stringify(line)).sort(), expected.sort());
  }
  assert.equal(fx.canvas.width, width * 2, 'Canvas keeps its original DPR');
  assert.equal(fx.root.style['--px'], undefined, 'Parallax must not invalidate the root');
}

const fx = setup({ light: true });
fx.step(300);
assert.equal(fx.draws, 1, 'Static light background is drawn once');
assert.equal(fx.frames.size, 0, 'No idle effects frame remains scheduled');
assert.equal(fx.caches[0].strokes, 1, 'Base grid is rasterized once');
fx.window.emit('mousemove', { clientX: 220, clientY: 310 });
fx.step(300);
assert.equal(fx.draws, 2, 'Moving the pointer refreshes the highlight');
assert.equal(fx.caches[0].strokes, 1, 'Pointer movement reuses the grid');
assert.equal(fx.frames.size, 0, 'Cursor easing eventually settles');
assert.match(fx.parallax[0].style.transform, /translate3d\(-/);
assert.match(fx.parallax[1].style.transform, /translate3d\([\d.]+px/);
assert.equal(fx.parallax[0].style['--px'], undefined, 'Moving a parent must not invalidate descendant custom properties');
fx.window.emit('pointerdown', { clientX: 220, clientY: 310 });
fx.step(30);
assert(fx.ctx.arcs.length >= 3, 'Hold keeps producing ripple rings');
fx.window.emit('pointermove', { clientX: 250, clientY: 330 });
fx.window.emit('pointermove', { clientX: 290, clientY: 350 });
fx.step();
assert(fx.ctx.arcs.some(arc => arc[2] === 13), 'Dragging retains the glowing trail head');
fx.window.emit('pointerup');
fx.step(400);
assert.equal(fx.frames.size, 0, 'Loop sleeps after ripples/trail finish');
assert.equal(fx.ctx.arcs.length, 0, 'Last frame clears expired effects');
fx.theme(false); fx.step(3);
assert(fx.frames.size > 0, 'Dark stars stay animated');
const beforeHidden = fx.draws;
fx.document.hidden = true; fx.document.emit('visibilitychange'); fx.step(60);
assert.equal(fx.draws, beforeHidden, 'Hidden document does not redraw');
fx.document.hidden = false; fx.document.emit('visibilitychange'); fx.step();
assert(fx.draws > beforeHidden, 'Visible document resumes');
fx.theme(true); fx.step(300);
fx.resize(375, 812); fx.step(300);
assert.equal(fx.canvas.width, 750);
assert.equal(fx.canvas.height, 1624);
assert.equal(fx.caches[0].strokes, 2, 'Resize rebuilds the cached grid');
assert.equal(fx.frames.size, 0);
const reduced = setup({ reduced: true });
assert.equal(reduced.draws, 1);
reduced.theme(true);
assert.equal(reduced.draws, 2, 'Reduced-motion background still switches themes');
assert.equal(reduced.frames.size, 0);
// Fast direction changes must not leave the ring behind, even between animation frames.
for (const light of [false, true]) {
  const sample = setup({ light });
  for (const [x, y] of [[10, 20], [1400, 850], [30, 800], [1200, 40]]) {
    sample.window.emit('mousemove', { clientX: x, clientY: y });
    for (const element of [sample.dot, sample.ring]) {
      const position = /translate3d\(([-\d.]+)px,([-\d.]+)px/.exec(element.style.transform);
      assert.equal(Number(position[1]), x, 'Cursor follows the latest input without waiting for canvas rendering');
      assert.equal(Number(position[2]), y);
    }
  }
  const latest = sample.ring.style.transform;
  sample.step(1, 100);
  assert.equal(sample.ring.style.transform, latest, 'A delayed frame must not move the ring back toward an old position');
  sample.document.emit('mouseleave');
  sample.window.emit('mousemove', { clientX: 400, clientY: 300 });
  assert.match(sample.ring.style.transform, /translate3d\(400px,300px/, 'Re-entry starts at the pointer instead of flying in from its old position');
}
// Parallax easing keeps the same duration at different refresh rates; cursors remain aligned.
const positions = [];
for (const rate of [30, 60, 120]) {
  const sample = setup({ light: true }); sample.step();
  sample.window.emit('mousemove', { clientX: 220, clientY: 310 });
  sample.step(rate / 5, 1000 / rate);
  positions.push([sample.dot, sample.ring, ...sample.parallax].map(el =>
    Number(/translate3d\(([-\d.]+)px/.exec(el.style.transform)[1])));
}
for (let i = 1; i < positions.length; i++) positions[i].forEach((position, j) =>
  assert(Math.abs(position - positions[0][j]) < .002, 'Pointer and parallax must not trail longer at low refresh rates'));
console.log('PASS: all particles/links across 900 frames, original DPR, cached light grid, idle sleep, cursor/parallax wake, ripples/trails, themes, resize, hidden/resume, and reduced motion.');
