/* Google Calendar connection and capture inside the Schedule task form. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const tr = (zh, en) => window.ForgeI18n.language === 'en' ? en : zh;
  const draftKey = 'forgeos:task-calendar-draft', pendingKey = 'forgeos:task-calendar-pending';
  const fields = ['naturalTask', 'taskTitle', 'taskDuration', 'taskPriority', 'taskDeadline', 'taskCalendarStart', 'taskCalendarLocation', 'taskCalendarDescription'];
  let status = {}, busy = false, submitting = false, editing = false, message = null, calendars = [], pending;
  const messages = {
    ...window.ForgeCalendarConnection.errors,
    SERVICE_UNAVAILABLE: ['请运行 npm start，并打开本地 Schedule 连接日历。', 'Run npm start and open local Schedule to connect.'],
    GOOGLE_NOT_CONFIGURED: ['请按接入说明填写本地 Google OAuth 配置，再重启服务。', 'Configure local Google OAuth and restart the service.'],
    GOOGLE_AUTH_NETWORK_FAILED: ['本地服务无法连接 Google，请保持代理开启后重新连接。', 'The local service cannot reach Google. Keep your proxy running and reconnect.'],
    GOOGLE_CLIENT_REJECTED: ['客户端凭据被拒绝，请检查本地 OAuth 配置。', 'Client credentials were rejected. Check local OAuth settings.'],
    GOOGLE_AUTH_SESSION_EXPIRED: ['授权会话已过期，请重新连接。', 'The authorization session expired. Reconnect.'],
    GOOGLE_AUTH_CODE_EXPIRED: ['授权码已过期，请重新连接。', 'The authorization code expired. Reconnect.'],
    GOOGLE_AUTH_FAILED: ['授权未完成，请重新连接。', 'Authorization did not complete. Reconnect.'],
    SIGN_IN_REQUIRED: ['请先在上方连接 Google 日历，再添加任务。', 'Connect Google Calendar above before adding the task.'],
    SESSION_REQUIRED: ['连接已失效，请刷新连接后重新授权。', 'The session expired. Refresh the connection and authorize again.'],
    CALENDAR_API_DISABLED: ['请在 Google Cloud 启用 Google Calendar API 后重试。', 'Enable Google Calendar API in Google Cloud and retry.'],
    CALENDAR_ACCESS_DENIED: ['Google 拒绝访问，请重新授权日历读写权限。', 'Google denied access. Reconnect and grant calendar access.'],
    CALENDAR_READ_ONLY: ['这个日历只读，请选择可写日历。', 'This calendar is read-only. Select a writable calendar.'],
    CALENDAR_CONNECTION_FAILED: ['日历连接失败，任务内容已保留，请检查网络后重试。', 'Calendar connection failed. Your draft is kept; check the network and retry.'],
    CALENDAR_RATE_LIMITED: ['Google 请求达到限额，请稍后重试。', 'Google request limit reached. Retry later.'],
    UNCERTAIN_WRITE: ['Google 可能已录入。请保留原内容重试，服务会核对结果，避免重复创建。', 'Google may have saved this event. Retry with the same details to verify without duplicating it.'],
    INVALID_CALENDAR_SELECTION: ['请选择一个 Google 日历。', 'Select a Google calendar.'],
    INVALID_WINDOW: ['请填写有效的日程开始时间。', 'Enter a valid calendar start time.']
  };
  function report(error) {
    message = { pair: messages[error.code] || ['录入未完成，任务内容已保留，请重试。', 'Could not add the task. Your draft is kept; please retry.'], error: true };
    if (['SIGN_IN_REQUIRED', 'SESSION_REQUIRED'].includes(error.code)) status.authenticated = false;
    render();
    return message.pair;
  }
  async function api(route, payload) {
    let response, data;
    try {
      response = await fetch('/api/calendar/' + route, { method: payload === undefined ? 'GET' : 'POST', credentials: 'same-origin',
        headers: payload === undefined ? {} : { 'Content-Type': 'application/json', 'X-ForgeOS-CSRF': status.csrf || '' }, body: payload === undefined ? undefined : JSON.stringify(payload) });
      data = await response.json();
    } catch { throw { code: 'SERVICE_UNAVAILABLE' }; }
    if (!response.ok) throw { code: data.error || 'SERVICE_UNAVAILABLE' };
    return data;
  }
  function render() {
    $('taskCalendarState').textContent = busy ? tr('连接中…', 'Connecting…') : status.authenticated ? tr('已连接', 'Connected') : tr('未连接', 'Not connected');
    $('taskCalendarConnect').hidden = !!status.authenticated;
    $('taskCalendarConnect').disabled = busy || submitting || !status.configured;
    $('taskCalendarRefresh').disabled = busy || submitting;
    $('taskCalendarDisconnect').hidden = !status.authenticated;
    $('taskCalendarDisconnect').disabled = busy || submitting;
    const network = status.network;
    $('taskCalendarNetwork').textContent = network?.state === 'ready'
      ? tr('已收到 Google 响应', 'Google responded')
      : network?.state === 'requesting' ? tr('正在连接 Google…', 'Connecting to Google…')
      : tr('自动使用系统网络设置', 'Uses your system network settings');
    $('taskCalendarSelection').hidden = !status.authenticated;
    $('taskCalendarTarget').disabled = busy || submitting;
    $('taskCalendarFeedback').textContent = message ? tr(...message.pair) : status.email || '';
    $('taskCalendarFeedback').classList.toggle('error', !!message?.error);
    $('taskCalendarLocal').hidden = location.origin === 'http://127.0.0.1:8787';
    $('taskCalendarSync').disabled = editing;
    const sync = !editing && $('taskCalendarSync').checked;
    $('taskCalendarFields').hidden = !sync;
    $('taskCalendarStart').required = sync;
    $('saveTask').textContent = submitting ? tr('正在录入…', 'Adding…') : editing ? tr('保存修改', 'Save changes') : sync ? tr('添加任务并同步日历 ＋', 'Add task & sync calendar +') : tr('添加本地任务 ＋', 'Add local task +');
  }
  async function refresh() {
    if (busy || submitting) return;
    busy = true; message = null; render();
    try {
      status = await api('status');
      if (status.authorizing && !status.authenticated) {
        message = { pair: window.ForgeCalendarConnection.waiting }; render();
        await window.ForgeCalendarConnection.wait(api);
        status = await api('status'); message = null;
      }
      if (!status.configured) throw { code: 'GOOGLE_NOT_CONFIGURED' };
      if (status.authError && !status.authenticated) throw { code: status.authError };
      if (status.authenticated) {
        calendars = (await api('calendars', {})).calendars;
        let saved; try { saved = localStorage.getItem('forgeos:calendar-target'); } catch {}
        const selected = calendars.some(c => c.id === saved) ? saved : calendars[0]?.id || '';
        $('taskCalendarTarget').replaceChildren(...calendars.map(c => { const option = document.createElement('option'); option.value = c.id; option.textContent = c.title; return option; }));
        $('taskCalendarTarget').value = selected;
        if (!selected) throw { code: 'INVALID_CALENDAR_SELECTION' };
      }
    } catch (error) { report(error); } finally { busy = false; render(); }
  }
  function saveDraft() {
    try { sessionStorage.setItem(draftKey, JSON.stringify(Object.fromEntries(fields.map(id => [id, $(id).value])))); } catch {}
  }
  function restoreDraft() {
    try { const draft = JSON.parse(sessionStorage.getItem(draftKey)); if (draft) for (const id of fields) if (typeof draft[id] === 'string') $(id).value = draft[id]; } catch {}
  }
  $('taskCalendarConnect').addEventListener('click', async () => {
    if (busy || submitting) return;
    saveDraft(); busy = true; message = null; render();
    try {
      const connected = await window.ForgeCalendarConnection.start(api, '/planner/', () => {
        message = { pair: window.ForgeCalendarConnection.waiting }; render();
      });
      if (connected) { busy = false; await refresh(); }
    } catch (error) { report(error); }
    finally { busy = false; render(); }
  });
  $('taskCalendarRefresh').addEventListener('click', refresh);
  $('taskCalendarDisconnect').addEventListener('click', async () => {
    if (busy || submitting) return;
    busy = true; render();
    try { await api('disconnect', {}); status = {}; calendars = []; }
    catch (error) { report(error); } finally { busy = false; }
    await refresh();
  });
  $('taskCalendarTarget').addEventListener('change', () => { try { localStorage.setItem('forgeos:calendar-target', $('taskCalendarTarget').value); } catch {} });
  $('taskCalendarSync').addEventListener('change', render);
  document.addEventListener('forgeos:languagechange', render);
  window.ForgeTaskCalendar = {
    render, restoreDraft,
    setEditing(value) { editing = value; if (value) $('taskCalendarSync').checked = false; render(); },
    async add(task) {
      if (!status.authenticated) throw { code: 'SIGN_IN_REQUIRED' };
      const calendarId = $('taskCalendarTarget').value;
      if (!calendarId) throw { code: 'INVALID_CALENDAR_SELECTION' };
      const start = new Date($('taskCalendarStart').value), end = new Date(start.getTime() + task.duration * 60000);
      if (!Number.isFinite(start.getTime())) throw { code: 'INVALID_WINDOW' };
      const payload = { calendarId, title: task.title, startTime: start.toISOString(), endTime: end.toISOString(),
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Shanghai', location: $('taskCalendarLocation').value.trim(), description: $('taskCalendarDescription').value.trim() };
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(payload)));
      const signature = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
      try { pending = JSON.parse(sessionStorage.getItem(pendingKey)) || pending; } catch {}
      pending = pending?.signature === signature ? pending : { signature, id: crypto.randomUUID() };
      try { sessionStorage.setItem(pendingKey, JSON.stringify(pending)); } catch {}
      saveDraft();
      message = null; render();
      const result = await api('events', { ...payload, requestId: pending.id });
      return { ...result, requestId: pending.id };
    },
    committed() { pending = null; try { sessionStorage.removeItem(pendingKey); sessionStorage.removeItem(draftKey); } catch {} },
    setSubmitting(value) { submitting = value; render(); },
    report
  };
  const callback = new URLSearchParams(location.search).get('calendar');
  if (callback) { const url = new URL(location.href); url.searchParams.delete('calendar'); history.replaceState(null, '', url); }
  refresh().then(() => { if (!status.authenticated && !message && callback === 'auth-failed') report({ code: 'GOOGLE_AUTH_FAILED' }); });
})();
