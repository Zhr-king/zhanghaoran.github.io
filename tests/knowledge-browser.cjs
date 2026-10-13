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
    const ready = () => waitFor('!window.__oldPage && document.documentElement.dataset.knowledgeReady === "true"');
    const click = id => evaluate('document.getElementById(' + JSON.stringify(id) + ').click()');
    const saved = () => evaluate('JSON.parse(localStorage.getItem("forgeos:knowledge:v1"))');
    const chats = () => evaluate('JSON.parse(localStorage.getItem("forgeos:knowledge-chats:v1"))');
    const reload = async () => { await evaluate('window.__oldPage = true'); await send('Page.reload'); await ready(); };
    const setInput = (id, value) => evaluate('document.getElementById(' + JSON.stringify(id) + ').value = ' + JSON.stringify(value) + '; document.getElementById(' + JSON.stringify(id) + ').dispatchEvent(new Event("input"))');
    const submitChat = async content => { await setInput('chatInput', content); await evaluate('document.getElementById("chatForm").requestSubmit()'); };
    const close = id => evaluate('document.getElementById(' + JSON.stringify(id) + ').close()');
    const layout = async label => {
      const value = await evaluate('({ page: document.documentElement.scrollWidth > innerWidth + 1, composer: document.getElementById("chatForm").getBoundingClientRect().bottom > innerHeight, shell: document.getElementById("chatShell").getBoundingClientRect().right > innerWidth + 1 })');
      assert.deepEqual(value, { page: false, composer: false, shell: false }, label);
    };
    const screenshots = path.join(profile, 'previews'); fs.mkdirSync(screenshots);
    const screenshot = async name => {
      const shot = await send('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(path.join(screenshots, name + '.png'), Buffer.from(shot.data, 'base64'));
    };
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
    await send('Page.navigate', { url: base + '/knowledge/' }); await ready();
    await waitFor('document.getElementById("moduleGuide")?.open');
    await evaluate('document.querySelector("[data-guide-action=skip]").click()');
    await waitFor('!document.getElementById("moduleGuide")');
    assert.equal(await saved(), null); assert.equal(await chats(), null);
    assert.equal(await evaluate('document.getElementById("chatWelcome").hidden'), false);
    assert.equal(await evaluate('document.getElementById("sidebarSubjectCount").textContent'), '0');
    assert.equal(await evaluate('document.querySelectorAll("[data-study-mode]").length'), 0);
    await evaluate('localStorage.setItem("forgeos:planner:v1", "preserve-me")');
    for (const language of ['en', 'zh-CN']) {
      if (await evaluate('document.documentElement.lang') !== language) await click('languageToggle');
      for (const theme of ['dark', 'light']) {
        if (await evaluate('document.documentElement.dataset.theme || "dark"') !== theme) {
          await click('themeToggle'); await waitFor('(document.documentElement.dataset.theme || "dark") === ' + JSON.stringify(theme));
        }
        for (const width of [320, 375, 768, 1024, 1440]) {
          await send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width < 500 });
          await layout('Welcome ' + [language, theme, width].join(' '));
          if (width === 375 || width === 1440) await screenshot('welcome-' + [language, theme, width].join('-'));
        }
      }
    }
    if (await evaluate('document.documentElement.lang') !== 'en') await click('languageToggle');
    await click('welcomeSubject');
    assert.equal(await evaluate('document.getElementById("subjectDialog").open'), true);
    await setInput('subjectName', 'Physics');
    await setInput('subjectDescription', 'Motion and energy');
    await evaluate('document.getElementById("subjectForm").requestSubmit()');
    assert.equal((await saved()).subjects.length, 1);
    const subjectId = (await saved()).subjects[0].id;
    await click('openSubjects'); await click('addSubject'); await setInput('subjectName', 'physics');
    await evaluate('document.getElementById("subjectForm").requestSubmit()');
    assert.equal((await saved()).subjects.length, 1);
    await close('subjectDialog'); await close('subjectsDialog');
    await click('attachDocument');
    const imported = '# Energy\n\nA kiln-signal note on energy.\n<script>window.__injected=true</script>\n<img src=x onerror="window.__injected=true">';
    await evaluate('(() => { const d = new DataTransfer(); d.items.add(new File([' + JSON.stringify(imported) + '], "Physics.md", { type: "text/markdown" })); const input = document.getElementById("documentFile"); input.files = d.files; input.dispatchEvent(new Event("change")); })()');
    await waitFor('document.getElementById("documentContent").value.includes("kiln-signal")');
    await setInput('documentDescription', 'Understanding energy');
    await evaluate('document.getElementById("documentForm").requestSubmit()');
    assert.equal((await saved()).notes.length, 1);
    assert.equal((await saved()).notes[0].content, imported);
    await close('documentsDialog');
    await submitChat('Find kiln-signal');
    assert.equal((await chats()).chats.length, 1);
    assert.equal((await chats()).chats[0].messages.length, 2);
    assert.equal(await evaluate('document.querySelectorAll(".kb-chat-result").length'), 1);
    assert.equal(await evaluate('document.getElementById("chatWelcome").hidden'), true);
    await evaluate('document.querySelector(".kb-chat-result").click()');
    assert.equal(await evaluate('document.querySelectorAll("#readerContent script, #readerContent img").length'), 0);
    assert.equal(await evaluate('Boolean(window.__injected)'), false);
    await click('markLearned'); assert((await saved()).notes[0].learnedAt > 0);
    await close('readerDialog');
    const firstId = (await chats()).activeId;
    await setInput('chatInput', 'draft to keep');
    await click('newChat');
    assert.equal(await evaluate('document.getElementById("chatWelcome").hidden'), false);
    await submitChat('Second discussion');
    const secondId = (await chats()).activeId;
    assert.notEqual(secondId, firstId);
    await evaluate('document.querySelector(' + JSON.stringify('[data-chat-id="' + firstId + '"] .kb-history-open') + ').click()');
    assert.equal(await evaluate('document.getElementById("chatInput").value'), 'draft to keep');
    await evaluate('document.querySelector(".kb-history-item.is-active .kb-rename-chat").click()');
    await setInput('renameInput', 'Energy study');
    await evaluate('document.getElementById("renameForm").requestSubmit()');
    assert.equal((await chats()).chats.find(chat => chat.id === firstId).title, 'Energy study');
    await setInput('historySearch', 'Energy study');
    assert.equal(await evaluate('document.querySelectorAll(".kb-history-item").length'), 1);
    await setInput('historySearch', '');
    await setInput('chatInput', 'review my notes');
    await evaluate('document.getElementById("chatInput").dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", isComposing: true, bubbles: true }))');
    assert.equal((await chats()).chats.find(chat => chat.id === firstId).messages.length, 2, 'IME enter does not send');
    await evaluate('document.getElementById("chatInput").dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", shiftKey: true, bubbles: true }))');
    assert.equal((await chats()).chats.find(chat => chat.id === firstId).messages.length, 2, 'Shift enter does not send');
    await evaluate('document.getElementById("chatInput").dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))');
    assert.equal((await chats()).chats.find(chat => chat.id === firstId).messages.length, 4);
    await evaluate('Array.from(document.querySelectorAll(".kb-chat-result")).at(-1).click()');
    assert.equal(await evaluate('document.querySelector("#readerContent .kb-markdown") === null'), true);
    await evaluate('document.querySelector(".kb-review-prompt button").click()'); await click('markLearned');
    assert.equal((await saved()).notes[0].reviewCount, 1);
    await click('languageToggle');
    assert.equal(await evaluate('document.getElementById("markLearned").disabled'), true);
    await close('readerDialog');
    await reload();
    assert.equal((await chats()).activeId, firstId);
    assert.equal(await evaluate('document.querySelectorAll(".kb-message").length'), 4);
    for (const width of [320, 375, 768, 1440]) {
      await send('Emulation.setDeviceMetricsOverride', { width, height: 800, deviceScaleFactor: 1, mobile: width < 500 });
      await layout('Conversation ' + width);
      if (width === 375 || width === 1440) await screenshot('conversation-' + width);
      if (width === 375) {
        assert.equal(await evaluate('document.getElementById("sidebarToggle").getAttribute("aria-expanded")'), 'false');
        await click('sidebarToggle');
        assert.equal(await evaluate('document.getElementById("chatShell").inert'), true);
        await screenshot('mobile-history');
        await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
        assert.equal(await evaluate('document.getElementById("chatShell").inert'), false);
        await click('attachDocument');
        const fit = await evaluate('(() => { const r = document.getElementById("documentsDialog").getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth + 1; })()');
        assert.equal(fit, true, 'Mobile documents fit');
        await screenshot('mobile-documents'); await close('documentsDialog');
      }
    }
    await setInput('chatInput', 'Keep this message');
    await evaluate('window.__setItem = Storage.prototype.setItem; Storage.prototype.setItem = () => { throw new Error("Quota"); }; document.getElementById("chatForm").requestSubmit()');
    assert.equal(await evaluate('document.getElementById("chatInput").value'), 'Keep this message');
    assert.equal((await chats()).chats.find(chat => chat.id === firstId).messages.length, 4);
    await evaluate('Storage.prototype.setItem = window.__setItem');
    await click('attachDocument');
    await setInput('documentTitle', 'Keep document draft'); await setInput('documentContent', 'Keep content');
    await evaluate('Storage.prototype.setItem = () => { throw new Error("Quota"); }; document.getElementById("documentForm").requestSubmit()');
    assert.equal(await evaluate('document.getElementById("documentTitle").value'), 'Keep document draft');
    assert.equal((await saved()).notes.length, 1);
    await evaluate('Storage.prototype.setItem = window.__setItem'); await close('documentsDialog');
    await evaluate('window.confirm = () => false; document.querySelector(".kb-history-item.is-active .kb-delete-chat").click()');
    assert.equal((await chats()).chats.length, 2);
    await evaluate('window.confirm = () => true; document.querySelector(".kb-history-item.is-active .kb-delete-chat").click()');
    assert.equal((await chats()).chats.length, 1);
    assert.equal((await saved()).notes.length, 1, 'Deleting a conversation keeps notes');
    await reload(); assert.equal((await chats()).chats.length, 1);
    assert.equal(await evaluate('localStorage.getItem("forgeos:planner:v1")'), 'preserve-me');
    await evaluate('(() => { const key = "forgeos:knowledge-chats:v1", data = JSON.parse(localStorage.getItem(key)), example = data.chats[0]; data.chats = Array.from({ length: 70 }, (_, i) => ({ ...example, id: "history-" + i, title: "Long conversation title " + i })); data.activeId = data.chats[0].id; localStorage.setItem(key, JSON.stringify(data)); })()');
    await reload();
    assert.equal(await evaluate('document.querySelectorAll(".kb-history-item").length'), 70);
    assert.equal(await evaluate('(() => { const node = document.getElementById("chatHistory"); return node.scrollHeight > node.clientHeight && document.getElementById("chatSidebar").getBoundingClientRect().bottom <= innerHeight + 1; })()'), true, 'Long history scrolls inside the sidebar');
    await layout('Long history');
    await evaluate('localStorage.setItem("forgeos:knowledge-chats:v1", "corrupt history")');
    await reload(); await submitChat('Do not overwrite corrupt history');
    assert.equal(await evaluate('localStorage.getItem("forgeos:knowledge-chats:v1")'), 'corrupt history');
    assert.equal((await saved()).notes.length, 1);
    assert.deepEqual(errors, [], 'No browser exceptions');
    console.log('PASS: chat layout, mobile sidebar, bilingual themes, local notes, history, rename, drafts, reload, IME, review and safe storage');
    console.log('Screenshots: ' + screenshots);
  } finally {
    if (socket) socket.close(); browser.kill(); server.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
