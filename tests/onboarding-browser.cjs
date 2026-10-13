// Run with Node 22+ and Chrome installed. An isolated temporary profile is used.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

(async () => {
  const server = http.createServer((req, res) => {
    let pathname = new URL(req.url, 'http://localhost').pathname;
    if (pathname.endsWith('/')) pathname += 'index.html';
    const file = path.resolve(root, '.' + pathname);
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); res.end(); return; }
    res.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' }[path.extname(file)] || 'application/octet-stream') + '; charset=utf-8');
    res.end(fs.readFileSync(file));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeos-planner-'));
  const browser = spawn(process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', [
    '--headless=new', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', '--user-data-dir=' + profile, 'about:blank'
  ], { stdio: 'ignore', windowsHide: true });
  let launchError, socket;
  browser.on('error', error => { launchError = error; });
  try {
    const portFile = path.join(profile, 'DevToolsActivePort');
    for (let i = 0; i < 100 && !fs.existsSync(portFile) && !launchError; i++) await sleep(100);
    if (launchError) throw launchError;
    assert(fs.existsSync(portFile), 'Chrome did not start');
    const port = fs.readFileSync(portFile, 'utf8').split('\n')[0];
    const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    socket = new WebSocket(targets.find(target => target.type === 'page').webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
    let id = 0;
    const pending = new Map(), errors = [];
    socket.onmessage = ({ data }) => {
      const message = JSON.parse(data);
      if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails);
      const request = pending.get(message.id);
      if (!request) return;
      pending.delete(message.id); clearTimeout(request.timer);
      message.error ? request.reject(new Error(JSON.stringify(message.error))) : request.resolve(message.result);
    };
    const send = (method, params = {}) => new Promise((resolve, reject) => {
      const key = ++id;
      const timer = setTimeout(() => { pending.delete(key); reject(new Error('Timeout: ' + method)); }, 10000);
      pending.set(key, { resolve, reject, timer }); socket.send(JSON.stringify({ id: key, method, params }));
    });
    const evaluate = async expression => {
      const response = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      if (response.exceptionDetails) throw new Error(JSON.stringify(response.exceptionDetails));
      return response.result.value;
    };
    await send('Runtime.enable'); await send('Page.enable');
    const base = `http://127.0.0.1:${server.address().port}`;
    const waitFor = async expression => {
      for (let i = 0; i < 100; i++) {
        try { if (await evaluate(expression)) return; } catch (error) { if (!/context|navigat/i.test(error.message)) throw error; }
        await sleep(50);
      }
      throw new Error('Timed out: ' + expression);
    };

    const pages = [['schedule', '/planner/'], ['knowledge', '/knowledge/'], ['agents', '/planner/agent.html#login']];
    const key = module => 'forgeos:onboarding:' + module;
    const ready = () => waitFor('!window.__oldPage && document.readyState === "complete"');
    const navigate = async url => {
      const same = await evaluate('location.href === ' + JSON.stringify(base + url));
      await evaluate('window.__oldPage = true');
      await send(same ? 'Page.reload' : 'Page.navigate', same ? {} : { url: base + url });
      await ready();
    };
    const reload = async () => { await evaluate('window.__oldPage = true'); await send('Page.reload'); await ready(); };
    const shown = () => evaluate('!!document.getElementById("moduleGuide")?.open');
    const reset = module => evaluate(`localStorage.removeItem(${JSON.stringify(key(module))}); sessionStorage.removeItem(${JSON.stringify(key(module))})`);
    const click = async selector => {
      const point = await evaluate(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); e.scrollIntoView({block: 'nearest', behavior: 'instant'}); const r = e.getBoundingClientRect(); return {x: r.x + r.width / 2, y: r.y + r.height / 2}; })()`);
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...point });
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...point });
    };
    const dismiss = async action => {
      if (action === 'escape') await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
      else await click('[data-guide-action=' + action + ']');
      await waitFor('!document.getElementById("moduleGuide")');
    };
    const screenshots = path.join(profile, 'onboarding'); fs.mkdirSync(screenshots);
    const shot = async name => {
      const result = await send('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(path.join(screenshots, name + '.png'), Buffer.from(result.data, 'base64'));
    };
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await navigate('/');
    assert.equal(await shown(), false, 'No guide on the home page');
    for (const [module, url] of pages) {
      await navigate(url);
      assert.equal(await shown(), true, module + ' has its own first visit');
      assert.equal(await evaluate(`localStorage.getItem(${JSON.stringify(key(module))})`), 'seen', 'Seen immediately');
      assert.equal(await evaluate('document.querySelectorAll(".module-guide-steps li").length'), 3);
      // Native modal focus cannot escape into the workspace.
      for (let i = 0; i < 6; i++) {
        await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
        assert.equal(await evaluate('document.getElementById("moduleGuide").contains(document.activeElement) || document.activeElement === document.body'), true);
      }
      await reload();
      assert.equal(await shown(), false, 'Refresh without dismissing never repeats the guide');
      await reset(module); await reload();
      await dismiss(module === 'schedule' ? 'start' : module === 'knowledge' ? 'skip' : 'escape');
      assert.equal(await evaluate('document.activeElement !== document.body'), true, 'Focus returns to a useful control');
      await reload(); assert.equal(await shown(), false, 'Dismissed guide stays hidden');
      // localStorage still suppresses the guide after session storage is cleared.
      await evaluate('sessionStorage.clear()'); await reload();
      assert.equal(await shown(), false, 'Persisted across browsing sessions');
      await click('[data-open-guide]');
      assert.equal(await shown(), true, 'Manual replay works without clearing storage');
      await dismiss('skip');
      assert.equal(await evaluate('document.activeElement.matches("[data-open-guide]")'), true, 'Replay returns focus to its entry');
      await reload(); assert.equal(await shown(), false, 'Replay does not reset first-visit state');
    }
    // Actual data stays empty: looking at guides never creates tasks, notes, chats, or accounts.
    for (const name of ['planner', 'knowledge', 'knowledge-chats', 'agent-accounts']) {
      assert.equal(await evaluate(`localStorage.getItem('forgeos:${name}:v1')`), null, name + ' unchanged');
    }
    for (const [module, url] of pages) {
      for (const language of ['en', 'zh-CN']) {
        for (const theme of ['dark', 'light']) {
          await evaluate(`localStorage.setItem('forgeos:language', ${JSON.stringify(language)}); localStorage.setItem('forgeos:theme', ${JSON.stringify(theme)})`);
          await reset(module); await navigate(url);
          for (const width of [320, 375, 768, 1440]) {
            await send('Emulation.setDeviceMetricsOverride', { width, height: 820, deviceScaleFactor: 1, mobile: width < 500 });
            assert.equal(await evaluate(`(() => {
              const d = document.getElementById('moduleGuide'), r = d.getBoundingClientRect();
              return r.left >= 0 && r.right <= innerWidth + 1 && r.top >= 0 && r.bottom <= innerHeight + 1 && d.scrollWidth <= d.clientWidth + 1;
            })()`), true, [module, language, theme, width].join(' '));
            if ((language === 'en' && theme === 'dark' && width === 1440) || (language === 'zh-CN' && theme === 'light' && width === 375)) await shot([module, language, theme, width].join('-'));
          }
          await dismiss('close');
        }
      }
    }
    await reset('schedule'); await navigate('/planner/');
    await send('Emulation.setDeviceMetricsOverride', { width: 320, height: 480, deviceScaleFactor: 1, mobile: true });
    assert.equal(await evaluate('document.getElementById("moduleGuide").scrollHeight > document.getElementById("moduleGuide").clientHeight'), true, 'Short screens scroll within the card');
    await dismiss('start');
    assert.equal(await evaluate('document.activeElement.id'), 'naturalTask');
    await navigate('/knowledge/');
    await click('#sidebarToggle');
    await click('[data-open-guide]');
    assert.equal(await shown(), true, 'Mobile sidebar opens the guide');
    await dismiss('skip');
    assert.equal(await evaluate('document.activeElement.matches("[data-open-guide]")'), true, 'Mobile replay restores focus inside the drawer');
    await click('#sidebarClose');
    assert.equal(await evaluate('document.getElementById("chatShell").inert'), false, 'Chat remains usable after replay');
    // Session storage fallback survives a refresh when persistent writes are denied.
    await reset('knowledge');
    const blockedLocal = await send('Page.addScriptToEvaluateOnNewDocument', { source: `const originalSet = Storage.prototype.setItem; Storage.prototype.setItem = function(k, v) { if (this === window.localStorage && k.startsWith('forgeos:onboarding:')) throw new Error('blocked'); return originalSet.call(this, k, v); };` });
    await navigate('/knowledge/'); assert.equal(await shown(), true);
    assert.equal(await evaluate('document.querySelector(".module-guide-note").textContent.includes("session")'), false, 'Uses selected Chinese language');
    assert.equal(await evaluate('sessionStorage.getItem("forgeos:onboarding:knowledge")'), 'seen');
    await dismiss('skip'); await reload(); assert.equal(await shown(), false);
    await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: blockedLocal.identifier });
    await reset('knowledge');
    const blockedAll = await send('Page.addScriptToEvaluateOnNewDocument', { source: `Storage.prototype.getItem = Storage.prototype.setItem = () => { throw new Error('blocked'); };` });
    await navigate('/knowledge/'); assert.equal(await shown(), true);
    assert.equal(await evaluate('document.querySelector(".module-guide-note").textContent.includes("could not save")'), true);
    await dismiss('escape');
    await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: blockedAll.identifier });
    await navigate('/planner/template.html'); assert.equal(await shown(), false, 'Design preview does not create another module guide');
    assert.deepEqual(errors, [], 'No browser exceptions');
    console.log('PASS: independent first visits, refresh/session persistence, all dismissal paths, focus, unchanged user data, bilingual themes, mobile/short layouts, and blocked-storage fallback.');
    console.log('Screenshots: ' + screenshots);
  } finally {
    if (socket) socket.close(); browser.kill(); server.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
