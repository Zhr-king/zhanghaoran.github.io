// Real HTTP + Chrome; Codex inference is a deterministic fixture in this test.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

(async () => {
  const { createApp } = await import('../server/app.mjs');
  const { CodexError } = await import('../server/codex-service.mjs');
  let verifiedAt = null, extracts = 0, probes = 0, fail = false, release, hold = false;
  const result = { title: 'Review report', duration: 45, deadline: '2026-11-05T17:00', start: '2026-11-05T14:00', priority: 'high', location: 'Room 2', notes: 'Bring notes' };
  const codex = {
    status: async () => ({ available: true, installed: true, authenticated: true, verifiedAt }),
    test: async () => { probes++; verifiedAt = new Date().toISOString(); return { connected: true, verifiedAt }; },
    extract: async input => {
      extracts++; assert(input.text); assert.match(input.now, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/); assert(input.timeZone);
      if (hold) { hold = false; await new Promise(resolve => { release = resolve; }); }
      if (fail) throw new CodexError('CODEX_TIMEOUT', 504);
      return { provider: 'codex', verifiedAt, task: input.text === 'Read a book' ? { ...result, title: 'Read a book', duration: null, deadline: null, start: null, priority: null, location: null, notes: null } : result };
    }
  };
  const server = createApp({ root: path.resolve(__dirname, '..'), dataDirectory: path.join(os.tmpdir(), 'forgeos-codex-fixture') }, {
    codex, oauth: { configured: false }, transport: { status: () => ({}), close: async () => {} }, service: {}
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeos-codex-browser-'));
  const browser = spawn(process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', [
    '--headless=new', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', '--user-data-dir=' + profile, 'about:blank'
  ], { windowsHide: true, stdio: 'ignore' });
  let socket, launchError;
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
    let sequence = 0;
    const pending = new Map(), errors = [];
    socket.onmessage = ({ data }) => {
      const message = JSON.parse(data);
      if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails);
      const entry = pending.get(message.id);
      if (!entry) return;
      pending.delete(message.id); clearTimeout(entry.timer);
      message.error ? entry.reject(new Error(JSON.stringify(message.error))) : entry.resolve(message.result);
    };
    const send = (method, params = {}) => new Promise((resolve, reject) => {
      const id = ++sequence, timer = setTimeout(() => { pending.delete(id); reject(new Error('Timeout: ' + method)); }, 10000);
      pending.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params }));
    });
    const evaluate = async expression => {
      const response = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      if (response.exceptionDetails) throw new Error(JSON.stringify(response.exceptionDetails));
      return response.result.value;
    };
    const until = async expression => {
      for (let i = 0; i < 150; i++) {
        try { if (await evaluate(expression)) return; } catch (error) { if (!/context|navigat/i.test(error.message)) throw error; }
        await sleep(50);
      }
      throw new Error('Wait failed: ' + expression);
    };
    const click = id => evaluate(`document.getElementById(${JSON.stringify(id)}).click()`);
    const value = id => evaluate(`document.getElementById(${JSON.stringify(id)}).value`);
    const extract = async text => {
      await evaluate(`document.getElementById('naturalTask').value=${JSON.stringify(text)};document.getElementById('captureForm').requestSubmit()`);
      await until('!document.getElementById("extractTask").disabled');
    };
    await send('Runtime.enable'); await send('Page.enable');
    await send('Page.navigate', { url: base + '/planner/' });
    await until('window.ForgeCodex?.status.authenticated && window.ForgeAgent && document.readyState === "complete"');
    await evaluate('document.querySelector("[data-guide-action=skip]")?.click()');
    // Legacy Codex demo state must not cause a real request or a connected badge.
    await evaluate('localStorage.setItem("forgeos:agent-accounts:v1", JSON.stringify({version:1,accounts:[{provider:"codex",kind:"demo",signedInAt:1}],defaultProvider:"codex"}));dispatchEvent(new Event("pageshow"))');
    assert.equal(await evaluate('window.ForgeAgent.usesCodex'), false);
    assert.equal(probes, 0); assert.equal(extracts, 0);
    await evaluate('window.ForgePlanner.parse = () => { throw new Error("Local template parsing must not run"); }');
    await extract('Tomorrow by 5pm write a report, 2 hours, high priority');
    assert.equal(extracts, 0, 'No default Codex means no inference or local fallback');
    for (const id of ['taskTitle', 'taskDuration', 'taskDeadline', 'taskCalendarStart', 'taskPriority']) assert.equal(await value(id), '');
    assert.match(await evaluate('document.getElementById("extractionStatus").textContent'), /Connect Codex|请先连接 Codex/);
    await click('connectCodex');
    await until('window.ForgeAgent.usesCodex && !document.getElementById("connectCodex").disabled');
    assert.equal(probes, 1);
    assert.equal(await evaluate('document.querySelector("[data-agent-state]").dataset.state'), 'connected');
    await extract('Tomorrow at 2pm review a report for 45 minutes, due at 5pm, urgent, Room 2, bring notes');
    assert.equal(extracts, 1);
    for (const [id, expected] of Object.entries({ taskTitle: result.title, taskDuration: '45', taskDeadline: result.deadline, taskCalendarStart: result.start, taskPriority: 'high', taskCalendarLocation: result.location, taskCalendarDescription: result.notes })) assert.equal(await value(id), expected, id);
    assert.equal(await evaluate('JSON.parse(localStorage.getItem("forgeos:planner:v1") || "null")?.tasks?.length || 0'), 0, 'Extraction does not save tasks');
    await extract('Read a book');
    for (const id of ['taskDuration', 'taskDeadline', 'taskCalendarStart', 'taskPriority', 'taskCalendarLocation', 'taskCalendarDescription']) assert.equal(await value(id), '', id + ' stays empty');
    assert.match(await evaluate('document.getElementById("extractionStatus").textContent'), /Extracted by Codex|已由 Codex 识别/);
    assert.equal(await evaluate('document.querySelectorAll("#taskSubmitFeedback li").length'), 3);
    fail = true; await extract('Keep this draft');
    assert.equal(await value('naturalTask'), 'Keep this draft'); assert.equal(await value('taskTitle'), 'Read a book');
    assert.match(await evaluate('document.getElementById("taskSubmitFeedback").textContent'), /timed out|超时/);
    fail = false; hold = true;
    await evaluate('document.getElementById("captureForm").requestSubmit();document.getElementById("captureForm").requestSubmit()');
    for (let i = 0; i < 100 && !release; i++) await sleep(20);
    assert(release); assert.equal(extracts, 4, 'Duplicate clicks start one inference');
    await evaluate('document.getElementById("taskTitle").value="My edit"'); release();
    await until('!document.getElementById("extractTask").disabled');
    assert.equal(await value('taskTitle'), 'My edit', 'A late response must not overwrite edits');
    // A manually completed task may keep an unspecified priority after reload.
    await evaluate('document.getElementById("taskDuration").value="30";document.getElementById("taskDeadline").value="2099-11-06T17:00";document.getElementById("taskCalendarSync").checked=false;document.getElementById("taskCalendarSync").dispatchEvent(new Event("change"))');
    await click('saveTask');
    assert.equal(await evaluate('JSON.parse(localStorage.getItem("forgeos:planner:v1")).tasks[0].priority'), null);
    await send('Page.reload');
    await until('document.querySelector(".task-name")?.textContent === "My edit"');
    assert.match(await evaluate('document.querySelector(".task-meta").textContent'), /Priority not specified|优先级未指定/);
    await send('Page.navigate', { url: base + '/planner/agent.html#default' });
    await until('document.getElementById("defaultAgentName")?.textContent === "Codex"');
    await evaluate('document.querySelector("[data-guide-action=skip]")?.click()');
    assert.doesNotMatch(await evaluate('document.querySelector(".agent-account-row[data-provider=codex]").textContent'), /demo|演示/i);
    await click('clearDefaultAgent'); assert.equal(await evaluate('window.ForgeAgent.usesCodex'), false);
    await click('loginTab');
    await evaluate('document.querySelector("#agentProviderList [data-provider=codex] button").click()');
    await until('document.getElementById("defaultAgentForm") && !document.getElementById("defaultPanel").hidden');
    await click('saveDefaultAgent'); assert.equal(await evaluate('window.ForgeAgent.usesCodex'), true);
    for (const language of ['zh-CN', 'en']) {
      if (await evaluate('document.documentElement.lang') !== language) await click('languageToggle');
      if (language === 'en') assert.doesNotMatch(await evaluate('document.body.innerText'), /[\u3400-\u9fff]/);
      for (const width of [320, 768, 1440]) {
        await send('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: width < 500 });
        assert.equal(await evaluate('document.documentElement.scrollWidth > innerWidth + 1'), false, language + '/' + width);
      }
    }
    assert.deepEqual(errors, []);
    console.log('PASS: real HTTP connection flow, legacy migration, extraction, missing fields, failure preservation, duplicate clicks, edit protection, account selection, languages and responsive layout.');
  } finally {
    release?.(); socket?.close(); browser.kill(); server.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
