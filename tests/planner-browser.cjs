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
    const ready = async () => {
      for (let i = 0; i < 100; i++) {
        try { if (await evaluate('!window.__oldPage && document.readyState === "complete" && Boolean(window.ForgePlanner) && document.getElementById("taskDeadline").value !== ""')) return; } catch (error) { if (!/context|navigat/i.test(error.message)) throw error; }
        await sleep(100);
      }
      throw new Error('Planner did not become ready');
    };
    await send('Page.navigate', { url: base + '/planner/' }); await ready();
    const click = id => evaluate(`document.getElementById(${JSON.stringify(id)}).click()`);
    const saved = () => evaluate('JSON.parse(localStorage.getItem("forgeos:planner:v1"))');
    await click('loadDemo'); assert.equal((await saved()).tasks.length, 3);
    await click('generatePlan'); assert.equal((await saved()).schedule.length, 0, 'Generating must not apply a plan');
    assert.equal(await evaluate('document.querySelectorAll(".proposal-line").length'), 3);
    await click('confirmPlan'); const initial = (await saved()).schedule; assert.equal(initial.length, 3);
    await evaluate('document.querySelector(".task-actions button:nth-child(2)").click()');
    assert.deepEqual((await saved()).schedule, initial, 'Extending duration must await confirmation');
    await click('discardPlan'); assert.deepEqual((await saved()).schedule, initial);
    await click('generatePlan'); await click('confirmPlan');
    assert.equal((await saved()).tasks[0].duration, 150);
    const extended = await saved();
    const extendedSlot = extended.schedule.find(slot => slot.taskId === extended.tasks[0].id);
    assert.equal(extendedSlot.end - extendedSlot.start, 150 * 60000);
    await evaluate(`(() => {
      const data = JSON.parse(localStorage.getItem('forgeos:planner:v1'));
      const slot = data.schedule[0], start = new Date(slot.start), end = new Date(slot.start + 15 * 60000);
      const clock = date => String(date.getHours()).padStart(2, '0') + ':' + String(date.getMinutes()).padStart(2, '0');
      document.getElementById('eventTitle').value = 'New meeting';
      document.getElementById('eventDate').value = ForgePlanner.dateKey(start);
      document.getElementById('eventStart').value = clock(start);
      document.getElementById('eventEnd').value = clock(end);
      document.getElementById('eventForm').requestSubmit();
    })()`);
    assert.deepEqual((await saved()).schedule, extended.schedule, 'Fixed event must not silently move tasks');
    assert.equal(await evaluate('document.querySelectorAll("#scheduleList .conflict-line").length > 0'), true);
    await click('confirmPlan');
    const afterEvent = await saved();
    const eventStart = new Date(afterEvent.events[0].date + 'T' + afterEvent.events[0].start).getTime();
    assert(afterEvent.schedule.every(slot => slot.end <= eventStart || slot.start >= eventStart + 15 * 60000));
    await evaluate('window.__oldPage = true'); await send('Page.reload'); await ready();
    assert.deepEqual((await saved()).schedule, afterEvent.schedule, 'Confirmed schedule survives reload');
    assert.equal(await evaluate('document.querySelectorAll(".task-row").length'), 3);
    for (const language of ['zh-CN', 'en']) {
      if (await evaluate('document.documentElement.lang') !== language) await click('languageToggle');
      for (const theme of ['dark', 'light']) {
        await evaluate(`document.documentElement.dataset.theme = ${JSON.stringify(theme)}`);
        for (const width of [320, 375, 768, 1440]) {
          await send('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: width < 500 });
          const layout = await evaluate(`({ overflow: document.documentElement.scrollWidth > innerWidth + 1,
            badFonts: [...document.querySelectorAll('h1, h2, button, input, textarea, select')].filter(el => !getComputedStyle(el).fontFamily.startsWith('Calibri')).length })`);
          assert.equal(layout.overflow, false, `Overflow: ${language}/${theme}/${width}`);
          assert.equal(layout.badFonts, 0, 'Calibri must be the first font throughout the planner');
        }
      }
    }
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1100, deviceScaleFactor: 1, mobile: false });
    await evaluate('document.documentElement.dataset.theme = "dark"');
    const screenshot = await send('Page.captureScreenshot', { format: 'png' });
    const screenshotPath = path.join(profile, 'planner-desktop.png');
    fs.writeFileSync(screenshotPath, Buffer.from(screenshot.data, 'base64'));
    console.log('Screenshot: ' + screenshotPath);
    await evaluate('document.querySelector(".complete-btn").click()');
    assert.equal((await saved()).tasks.filter(task => task.done).length, 1);
    assert.equal((await saved()).schedule.length, 2);
    await evaluate('document.getElementById("workStart").value = "18:00"; document.getElementById("workEnd").value = "09:00"; document.getElementById("preferencesForm").requestSubmit()');
    assert.equal((await saved()).preferences.start, '09:00', 'Invalid preferences must not be persisted');
    assert.deepEqual(errors, [], 'No browser runtime errors');
    console.log('PASS: capture, confirmation, delay/replanning, discard, fixed-event conflicts, persistence, completion, validation, both languages/themes, and responsive Calibri layout.');
  } finally {
    if (socket) socket.close(); browser.kill(); server.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
