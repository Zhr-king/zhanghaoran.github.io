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
    const ready = () => waitFor('!window.__oldPage && document.readyState === "complete" && document.querySelectorAll(".kb-subject-card").length > 0');
    const click = id => evaluate(`document.getElementById(${JSON.stringify(id)}).click()`);
    const saved = () => evaluate('JSON.parse(localStorage.getItem("forgeos:knowledge:v1"))');
    const reload = async () => { await evaluate('window.__oldPage = true'); await send('Page.reload'); await ready(); };
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1050, deviceScaleFactor: 1, mobile: false });
    await send('Page.navigate', { url: base + '/knowledge/' }); await ready();
    assert.equal(await evaluate('document.documentElement.lang'), 'en');
    assert.equal(await evaluate('document.querySelectorAll(".kb-subject-card").length'), 3);
    assert.equal(await evaluate('document.getElementById("librarySummary").textContent'), '3 subjects · 6 notes');
    assert.equal(await evaluate('Boolean(document.querySelector(".kb-feedback.error"))'), false);
    assert.equal(await saved(), null, 'Viewing examples does not write storage');
    await evaluate('localStorage.setItem("forgeos:planner:v1", "preserve-me")');
    const screenshots = path.join(profile, 'previews'); fs.mkdirSync(screenshots);
    for (const language of ['en', 'zh-CN']) {
      if (await evaluate('document.documentElement.lang') !== language) await click('languageToggle');
      for (const theme of ['dark', 'light']) {
        await evaluate(`document.documentElement.dataset.theme = ${JSON.stringify(theme)}`);
        for (const width of [320, 375, 768, 1024, 1440]) {
          await send('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: width < 500 });
          for (const view of ['subjects', 'ask', 'documents']) {
            await click(view + 'Tab');
            await sleep(30);
            const issues = await evaluate(`(() => {
              const items = [...document.querySelectorAll('.kb-main h1,.kb-main h2,.kb-panel,.kb-entry-tab,.kb-subject-card,.kb-topbar,.kb-main button')]
                .filter(el => el.getClientRects().length && el.scrollWidth > el.clientWidth + 1).map(el => el.id || el.className);
              if (document.documentElement.scrollWidth > innerWidth + 1) items.push('page');
              return items;
            })()`);
            assert.deepEqual(issues, [], language + '/' + theme + '/' + width + '/' + view);
            if ((width === 1440 && language === 'zh-CN') || (width === 375 && language === 'en')) {
              await evaluate('scrollTo({top: 0, behavior: "instant"})');
              await sleep(260);
              const shot = await send('Page.captureScreenshot', { format: 'png' });
              fs.writeFileSync(path.join(screenshots, `${view}-${language}-${theme}-${width}.png`), Buffer.from(shot.data, 'base64'));
            }
          }
          await click('subjectsTab');
          await evaluate('document.querySelector(".kb-subject-card").click()');
          assert.equal(await evaluate('document.getElementById("readerDialog").open'), true);
          const dialog = await evaluate(`(() => { const r = document.getElementById('readerDialog').getBoundingClientRect(); return { outside: r.left < 0 || r.right > innerWidth + 1, overflow: document.getElementById('readerDialog').scrollWidth > document.getElementById('readerDialog').clientWidth + 1 }; })()`);
          assert.deepEqual(dialog, { outside: false, overflow: false }, 'Reader layout ' + width);
          await evaluate('document.getElementById("readerDialog").close()');
        }
      }
    }
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
    if (await evaluate('document.documentElement.lang') !== 'en') await click('languageToggle');
    await click('subjectsTab'); await evaluate('document.getElementById("subjectsTab").focus()');
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 });
    assert.equal(await evaluate('document.activeElement.id'), 'askTab');
    assert.equal(await evaluate('document.getElementById("askPanel").hidden'), false);
    await click('subjectsTab'); await click('addSubject');
    await evaluate('document.getElementById("subjectName").value = "Physics"; document.getElementById("subjectDescription").value = "Motion and energy"; document.getElementById("subjectForm").requestSubmit()');
    assert.equal((await saved()).subjects.length, 4);
    assert.equal(await evaluate('document.getElementById("subjectDialog").open'), false);
    const subjectId = (await saved()).subjects.at(-1).id;
    await click('addSubject');
    await evaluate('document.getElementById("subjectName").value = "physics"; document.getElementById("subjectForm").requestSubmit()');
    assert.equal((await saved()).subjects.length, 4, 'Duplicate subject is rejected');
    assert.equal(await evaluate('document.getElementById("subjectDialog").open'), true);
    await evaluate('document.getElementById("subjectDialog").close()');
    await evaluate(`document.querySelector('[data-subject-id="${subjectId}"]').click()`);
    assert.equal(await evaluate('document.getElementById("documentsPanel").hidden'), false);
    assert.equal(await evaluate('document.getElementById("documentSubject").value'), subjectId);
    const imported = '## Energy\nA unique kiln-signal to find.\n<img src=x onerror="window.__injected=true">\n<script>window.__injected=true</script>\n- A safe list item\n```js\nconst value = 1;\n```';
    await evaluate(`(() => { const transfer = new DataTransfer(); transfer.items.add(new File([${JSON.stringify(imported)}], 'Physics.md', { type: 'text/markdown' })); const input = document.getElementById('documentFile'); input.files = transfer.files; input.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    await waitFor('document.getElementById("documentContent").value.includes("kiln-signal")');
    assert.equal(await evaluate('document.getElementById("documentTitle").value'), 'Physics');
    await evaluate('document.getElementById("documentDescription").value = "Energy, with a personal learning focus."; document.getElementById("documentForm").requestSubmit()');
    assert.equal((await saved()).notes.length, 7);
    assert.equal((await saved()).notes[0].content, imported);
    assert.equal(await evaluate('document.getElementById("documentContent").value'), '');
    await reload();
    assert.equal((await saved()).notes.length, 7, 'Notes survive reload');
    assert.equal(await evaluate('document.getElementById("documentsPanel").hidden'), false, 'Hash restores the active view');
    await click('askTab');
    await evaluate('document.getElementById("questionText").value = "kiln-signal"; document.getElementById("questionForm").requestSubmit()');
    assert(await evaluate('document.querySelectorAll(".kb-result-card").length >= 1'));
    assert.equal(await evaluate('document.querySelector(".kb-result-card h3").textContent'), 'Physics', 'The strongest match appears first');
    await evaluate('document.querySelector(".kb-result-card").click()');
    assert.equal(await evaluate('document.getElementById("readerTitle").textContent'), 'Physics');
    assert.equal(await evaluate('Boolean(window.__injected)'), false);
    assert.equal(await evaluate('document.querySelectorAll("#readerContent img, #readerContent script").length'), 0);
    await click('markLearned'); assert((await saved()).notes[0].learnedAt > 0);
    await evaluate('document.querySelector("[data-reader-mode=review]").click()');
    assert.equal(await evaluate('document.querySelectorAll("#readerContent .kb-markdown").length'), 0, 'Review starts with the answer hidden');
    assert.equal(await evaluate('document.getElementById("markLearned").disabled'), true);
    await evaluate('document.querySelector(".kb-review-prompt button").click()'); await click('markLearned');
    assert.equal((await saved()).notes[0].reviewCount, 1);
    const downloads = path.join(profile, 'downloads'); fs.mkdirSync(downloads);
    await send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloads });
    await click('exportNote');
    for (let i = 0; i < 50 && !fs.existsSync(path.join(downloads, 'Physics.md')); i++) await sleep(50);
    assert(fs.readFileSync(path.join(downloads, 'Physics.md'), 'utf8').includes('kiln-signal'));
    await evaluate('document.getElementById("readerDialog").close()');
    await click('documentsTab');
    await evaluate('document.getElementById("documentTitle").value = "Keep this draft"; document.getElementById("documentContent").value = "Keep this content"; window.__setItem = Storage.prototype.setItem; Storage.prototype.setItem = () => { throw new Error("Quota"); }; document.getElementById("documentForm").requestSubmit()');
    assert.equal(await evaluate('document.getElementById("documentTitle").value'), 'Keep this draft');
    assert.equal((await saved()).notes.length, 7, 'Storage errors do not mutate saved data');
    assert.equal(await evaluate('document.getElementById("kbFeedback").classList.contains("error")'), true);
    await evaluate('Storage.prototype.setItem = window.__setItem');
    await evaluate(`(() => { const transfer = new DataTransfer(); transfer.items.add(new File(['not supported'], 'No.pdf')); const input = document.getElementById('documentFile'); input.files = transfer.files; input.dispatchEvent(new Event('change')); })()`);
    assert.equal(await evaluate('document.getElementById("documentContent").value'), 'Keep this content');
    assert.equal(await evaluate('document.getElementById("fileFeedback").classList.contains("error")'), true);
    await evaluate('document.querySelector("#documentList button").click(); window.confirm = () => false');
    await click('deleteNote'); assert.equal((await saved()).notes.length, 7);
    await evaluate('window.confirm = () => true'); await click('deleteNote');
    assert.equal((await saved()).notes.length, 6);
    await reload(); assert.equal((await saved()).notes.length, 6, 'Deletion persists');
    assert.equal(await evaluate('localStorage.getItem("forgeos:planner:v1")'), 'preserve-me', 'Planner data is untouched');
    await evaluate('localStorage.setItem("forgeos:knowledge:v1", "corrupted library")'); await reload();
    assert.equal(await evaluate('document.getElementById("kbFeedback").classList.contains("error")'), true);
    assert.equal(await evaluate('localStorage.getItem("forgeos:knowledge:v1")'), 'corrupted library', 'Bad saved records are not silently overwritten');
    assert.deepEqual(errors, [], 'No runtime errors');
    console.log('Screenshots: ' + screenshots);
    console.log('PASS: three views, both languages/themes, five widths, reader layouts, keyboard tabs, subject creation/duplicates, file import, save/reload, safe note rendering, search, study/review, Markdown export, storage failure, deletion, corruption handling, and planner data isolation.');
  } finally {
    if (socket) socket.close(); browser.kill(); server.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
