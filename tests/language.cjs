// Run with node tests/language.cjs. Uses installed Chrome and Node 22+, no packages.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function connect(url) {
  const socket = new WebSocket(url);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  let id = 0;
  const pending = new Map();
  const errors = [];
  socket.onmessage = ({ data }) => {
    const message = JSON.parse(data);
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails);
    if (!pending.has(message.id)) return;
    const { resolve, reject, timer } = pending.get(message.id);
    pending.delete(message.id);
    clearTimeout(timer);
    message.error ? reject(new Error(JSON.stringify(message.error))) : resolve(message.result);
  };
  return {
    errors,
    close: () => socket.close(),
    send(method, params = {}) {
      return new Promise((resolve, reject) => {
        const key = ++id;
        const timer = setTimeout(() => { pending.delete(key); reject(new Error('Timeout: ' + method)); }, 10000);
        pending.set(key, { resolve, reject, timer });
        socket.send(JSON.stringify({ id: key, method, params }));
      });
    }
  };
}

(async () => {
  const server = http.createServer((req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    const file = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.writeHead(404); res.end(); return;
    }
    res.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.xml': 'application/xml' }[path.extname(file)] || 'text/plain') + '; charset=utf-8');
    res.end(fs.readFileSync(file));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeos-language-'));
  const browser = spawn(process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', [
    '--headless=new', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0',
    '--user-data-dir=' + profile, 'about:blank'
  ], { stdio: 'ignore', windowsHide: true });
  let launchError;
  browser.on('error', error => { launchError = error; });
  let cdp;
  try {
    const portFile = path.join(profile, 'DevToolsActivePort');
    for (let i = 0; i < 100 && !fs.existsSync(portFile) && !launchError; i++) await sleep(100);
    if (launchError) throw launchError;
    assert(fs.existsSync(portFile), 'Chrome did not start');
    const port = fs.readFileSync(portFile, 'utf8').split('\n')[0];
    const targets = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json();
    cdp = await connect(targets.find(target => target.type === 'page').webSocketDebuggerUrl);
    await cdp.send('Runtime.enable');
    await cdp.send('Page.enable');
    const evaluate = async expression => {
      const result = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
      return result.result.value;
    };
    const baseUrl = 'http://127.0.0.1:' + server.address().port;
    if (process.argv.includes('--render-social')) {
      await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1200, height: 630, deviceScaleFactor: 1, mobile: false });
      await cdp.send('Page.navigate', { url: baseUrl + '/assets/images/social-card.svg' });
      for (let i = 0; i < 50; i++) {
        if (await evaluate('document.documentElement.tagName === "svg"')) break;
        await sleep(100);
      }
      await evaluate('document.fonts.ready.then(() => true)');
      const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(path.join(root, 'assets/images/social-card.png'), Buffer.from(shot.data, 'base64'));
      await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 812, deviceScaleFactor: 1, mobile: false });
    }
    await cdp.send('Page.navigate', { url: baseUrl });
    for (let i = 0; i < 100; i++) {
      if (await evaluate('!!window.ForgeI18n && !!document.body.classList.contains("ready")')) break;
      await sleep(100);
    }
    assert.equal(await evaluate('document.documentElement.lang'), 'zh-CN');
    const click = id => evaluate(`document.getElementById(${JSON.stringify(id)}).click()`);
    await click('languageToggle');
    assert.equal(await evaluate('document.documentElement.lang'), 'en');
    assert.equal(await evaluate('document.title'), 'ForgeOS // Personal Workshop OS');
    assert.equal(await evaluate('document.querySelector(".nav-link").textContent'), 'Home');
    assert.equal(await evaluate('localStorage.getItem("forgeos:language")'), 'en');
    assert.equal(await evaluate('document.querySelector(".brand svg").children.length'), 2);
    await click('themeToggle');
    assert.equal(await evaluate('document.getElementById("themeLabel").textContent'), 'Light');
    await evaluate('document.querySelector("[data-toast]").click()');
    assert.match(await evaluate('document.querySelector(".toast").textContent'), /Documentation/);
    await click('languageToggle');
    assert.equal(await evaluate('document.querySelector(".toast span[data-i18n-en]").textContent === document.querySelector("[data-toast]").dataset.toast'), true);
    await click('languageToggle');
    await cdp.send('Page.reload');
    await sleep(1000);
    assert.equal(await evaluate('document.documentElement.lang'), 'en');
    assert.equal(await evaluate('document.documentElement.dataset.theme'), 'light');

    for (const width of [320, 375, 768, 1024, 1100, 1440]) {
      await cdp.send('Emulation.setDeviceMetricsOverride', { width, height: 812, deviceScaleFactor: 1, mobile: false });
      for (let lang = 0; lang < 2; lang++) {
        const layout = await evaluate(`(() => {
          const brand = document.querySelector('.brand').getBoundingClientRect();
          const controls = document.querySelector('.nav-right').getBoundingClientRect();
          return { overlap: brand.right > controls.left, overflow: controls.right > innerWidth };
        })()`);
        assert.deepEqual(layout, { overlap: false, overflow: false }, 'Header at width ' + width);
        const contentOverflow = await evaluate(`(() => {
          return [...document.querySelectorAll('.hero-stats, .stat, .card, .mod-title, .mod-desc, .card-bottom, .footer-grid, .f-tag')]
            .filter(el => el.scrollWidth > el.clientWidth + 1)
            .map(el => el.className);
        })()`);
        assert.deepEqual(contentOverflow, [], 'Content overflow at width ' + width);
        const smallTargets = await evaluate(`(() => [...document.querySelectorAll('a, button')]
          .filter(el => getComputedStyle(el).visibility !== 'hidden' && el.getClientRects().length)
          .filter(el => { const r = el.getBoundingClientRect(); return r.width < 43.5 || r.height < 43.5; })
          .map(el => el.id || el.textContent.trim()))()`);
        assert.deepEqual(smallTargets, [], 'Touch targets at width ' + width);
        if (width <= 1024) {
          await click('navToggle');
          assert.equal(await evaluate('document.getElementById("navToggle").getAttribute("aria-expanded")'), 'true');
          await click('navToggle');
        }
        await click('languageToggle');
      }
    }
    await evaluate('document.getElementById("console").scrollIntoView({behavior:"instant"})');
    await sleep(500);
    for (let i = 0; i < 6; i++) await click('languageToggle');
    await sleep(8500);
    assert.equal(await evaluate('document.querySelectorAll("#termBody .t-line").length'), 8);
    assert.equal(await evaluate('/[\\u4e00-\\u9fff]/.test(document.getElementById("termBody").textContent)'), false);
    await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    await cdp.send('Page.reload');
    await sleep(600);
    assert.equal(await evaluate('document.getElementById("typewriter").textContent'), 'Forge code. Refine knowledge.');
    await click('languageToggle');
    assert.equal(await evaluate('document.getElementById("typewriter").textContent === ForgeI18n.t("type.0")'), true);
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: "Storage.prototype.getItem = Storage.prototype.setItem = () => { throw new Error('Storage blocked'); };" });
    await cdp.send('Page.reload');
    await sleep(600);
    assert.equal(await evaluate('document.documentElement.lang'), 'zh-CN');
    await click('languageToggle');
    assert.equal(await evaluate('document.documentElement.lang'), 'en');
    // No-JS/failed observer cases must keep all reveal content readable.
    const assertReadable = async label => {
      const unreadable = await evaluate(`(() => [...document.querySelectorAll('.reveal')]
        .filter(el => { const css = getComputedStyle(el); return Number(css.opacity) < .99 || css.visibility === 'hidden' || css.filter !== 'none'; })
        .map(el => el.className))()`);
      assert.deepEqual(unreadable, [], label);
    };
    const noObserver = await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: 'window.IntersectionObserver = undefined;' });
    await cdp.send('Page.reload');
    await sleep(700);
    assert.equal(await evaluate('document.documentElement.classList.contains("ui-ready")'), true);
    await assertReadable('Missing IntersectionObserver');
    assert.equal(await evaluate('document.querySelectorAll("#termBody .t-line").length'), 8);
    await cdp.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: noObserver.identifier });

    await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
    await cdp.send('Page.navigate', { url: baseUrl + '/#modules' });
    await cdp.send('Page.reload');
    await sleep(1800);
    await assertReadable('Direct module anchor');
    await evaluate('window.scrollTo({top: document.documentElement.scrollHeight, behavior:"instant"})');
    await sleep(1400);
    await assertReadable('Fast scroll to page end');
    await evaluate("document.querySelector('.f-links a[href=\"#modules\"]').click()");
    await sleep(1400);
    await assertReadable('Navigation to modules');

    await cdp.send('Network.enable');
    await cdp.send('Network.setBlockedURLs', { urls: ['*assets/js/ui.js*'] });
    await cdp.send('Page.reload');
    await sleep(6500);
    await assertReadable('Blocked UI script');
    assert.equal(await evaluate('getComputedStyle(document.getElementById("boot")).display'), 'none');
    assert.equal(await evaluate('getComputedStyle(document.querySelector(".hero-in")).opacity'), '1');
    await cdp.send('Network.setBlockedURLs', { urls: [] });
    await cdp.send('Emulation.setScriptExecutionDisabled', { value: true });
    await cdp.send('Page.reload');
    await sleep(500);
    await assertReadable('JavaScript disabled');
    assert.equal(await evaluate('getComputedStyle(document.querySelector(".nav-links")).visibility'), 'visible');
    assert.equal(await evaluate('getComputedStyle(document.getElementById("boot")).display'), 'none');
    await cdp.send('Emulation.setScriptExecutionDisabled', { value: false });

    const seo = await evaluate(`({ canonical: document.querySelector('link[rel="canonical"]').href,
      image: document.querySelector('meta[property="og:image"]').content,
      card: document.querySelector('meta[name="twitter:card"]').content,
      schema: JSON.parse(document.querySelector('script[type="application/ld+json"]').textContent)['@type'] })`);
    assert.equal(seo.canonical, 'https://forgeos.work/');
    assert.equal(seo.card, 'summary_large_image');
    assert.equal(seo.schema, 'WebSite');
    const picture = Buffer.from(await (await fetch(baseUrl + new URL(seo.image).pathname)).arrayBuffer());
    assert.equal(picture.subarray(1, 4).toString(), 'PNG');
    assert.equal(picture.readUInt32BE(16), 1200);
    assert.equal(picture.readUInt32BE(20), 630);
    assert.deepEqual(cdp.errors, [], 'Browser runtime errors');
    console.log('PASS: both languages at six widths, layout/touch targets, theme, live translations, persistence, animations, reduced motion, blocked storage, anchors, fast scroll, failed observer, blocked UI script, JavaScript disabled, SEO and social image; no runtime errors.');
  } finally {
    if (cdp) cdp.close();
    browser.kill();
    server.close();
    // The isolated browser profile stays in the OS temp directory, never in the site.
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
