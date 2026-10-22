/* Google Calendar capture: no rescheduling and no browser-side Google credentials. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const tr = (zh, en) => window.ForgeI18n.language === 'en' ? en : zh;
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Shanghai';
  let status = {}, calendars = [], target = '', snapshot = null, working = false, feedback = null, result = null;
  const errors = {
    ...window.ForgeCalendarConnection.errors,
    SERVICE_UNAVAILABLE: ['请运行 npm start，并打开本地工作台。', 'Run npm start and open the local workspace.'],
    GOOGLE_NOT_CONFIGURED: ['本地服务已启动，请先按接入说明填写 Google OAuth 配置。', 'The service is running. Configure Google OAuth using the setup guide.'],
    GOOGLE_AUTH_FAILED: ['Google 授权未完成，请重新连接。', 'Google authorization did not complete. Reconnect.'],
    GOOGLE_AUTH_NETWORK_FAILED: ['本地服务无法连接 Google，授权未完成。请检查本机网络或服务的代理配置后重新连接。', 'The local service cannot reach Google. Check its network or proxy settings, then reconnect.'],
    GOOGLE_AUTH_INVALID_RESPONSE: ['Google 授权接口返回异常，请检查网络后重新连接。', 'Google returned an unexpected authorization response. Check the network and reconnect.'],
    GOOGLE_AUTH_SESSION_EXPIRED: ['授权会话已过期或丢失，请在当前页面重新连接，并保持服务运行。', 'The authorization session expired or was lost. Reconnect here and keep the service running.'],
    GOOGLE_CLIENT_REJECTED: ['Google 拒绝了客户端凭据，请检查本地 Client ID 和 Client Secret，更新后重启服务。', 'Google rejected the client credentials. Check your local Client ID and Client Secret, then restart the service.'],
    GOOGLE_AUTH_CODE_EXPIRED: ['授权码已失效，请重新点击连接 Google 日历，不要刷新授权回调页面。', 'The authorization code is no longer valid. Start a new connection instead of refreshing the callback.'],
    GOOGLE_PROFILE_FAILED: ['授权后读取 Google 账号信息失败，请重新连接并授予账号信息权限。', 'Could not read your Google account information. Reconnect and grant account information access.'],
    SIGN_IN_REQUIRED: ['登录已失效，请重新连接 Google 日历。', 'Your session expired. Reconnect Google Calendar.'],
    SESSION_REQUIRED: ['请检查连接后重新登录。', 'Check the connection and sign in again.'],
    CALENDAR_CONNECTION_FAILED: ['无法连接 Google 日历，请检查网络后重试。', 'Cannot reach Google Calendar. Check your network and retry.'],
    CALENDAR_API_DISABLED: ['请在 Google Cloud 项目中启用 Google Calendar API，再重试。', 'Enable Google Calendar API in your Google Cloud project, then retry.'],
    CALENDAR_ACCESS_DENIED: ['Google 日历拒绝访问，请检查日历权限并重新授权。', 'Google Calendar denied access. Check calendar permissions and reconnect.'],
    CALENDAR_RATE_LIMITED: ['Google 日历请求暂时达到限额，请稍后重试。', 'Google Calendar request limit reached. Please retry later.'],
    CALENDAR_API_FAILED: ['Google 日历暂时无法完成请求，请稍后重试。', 'Google Calendar could not complete the request. Please retry later.'],
    CALENDAR_INVALID_RESPONSE: ['Google 日历返回了无法识别的结果，请重试。', 'Google Calendar returned an unexpected response. Please retry.'],
    CALENDAR_READ_ONLY: ['这个日历为只读，请选择可写日历。', 'This calendar is read-only. Choose a writable calendar.'],
    CALENDAR_NOT_READABLE: ['无法读取这个日历，暂不能检查重叠。', 'This calendar cannot be read to check overlaps.'],
    CALENDAR_NOT_ACCESSIBLE: ['无法访问所选日历，请检查连接并重新选择。', 'This calendar is no longer accessible. Check the connection and select again.'],
    INVALID_WINDOW: ['请填写有效的起止时间，结束须晚于开始，时段最多为 32 天。', 'Enter valid start and end times, with a positive duration of at most 32 days.'],
    INVALID_EVENT: ['请核对事件名称、时间和相关信息。', 'Check the event title, times and details.'],
    UNCERTAIN_WRITE: ['Google 可能已创建事件，但暂未核实。请保留表单内容重试，服务会先核对已有事件，避免重复创建。', 'Google may have created the event, but it is not verified yet. Retry with the same details; the service checks the previous request before creating anything.'],
    REQUEST_CHANGED: ['这次请求的内容已变化，请重新填写后提交。', 'This request has changed. Fill in the details and submit again.'],
    WRITE_IN_PROGRESS: ['正在录入，请稍候。', 'An event is being added. Please wait.'],
    UNEXPANDED_RECURRENCE: ['无法完整读取重复日程，暂未创建事件，请重新读取。', 'Recurring events could not be fully read. No event was created. Refresh and retry.'],
    CALENDAR_TOO_LARGE: ['这段时间的日程过多，无法完整检查，请缩短时间范围。', 'Too many events to check completely. Use a shorter time range.']
  };
  const node = (tag, text, className) => { const n = document.createElement(tag); if (text !== undefined) n.textContent = text; if (className) n.className = className; return n; };
  const dateKey = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  const localValue = d => dateKey(d) + 'T' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  const format = time => new Date(time).toLocaleString(window.ForgeI18n.language === 'en' ? 'en-GB' : 'zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
  function errorMessage(error) {
    feedback = { pair: errors[error.code] || ['操作未完成，请检查连接后重试。', 'The operation could not finish. Check the connection and retry.'], error: true };
    if (['SIGN_IN_REQUIRED', 'SESSION_REQUIRED', 'GOOGLE_AUTH_FAILED'].includes(error.code)) { status.authenticated = false; target = ''; snapshot = null; result = null; }
  }
  async function api(route, payload) {
    let response, value;
    try { response = await fetch('/api/calendar/' + route, { method: payload === undefined ? 'GET' : 'POST', credentials: 'same-origin', headers: payload === undefined ? {} : { 'Content-Type': 'application/json', 'X-ForgeOS-CSRF': status.csrf || '' }, body: payload === undefined ? undefined : JSON.stringify(payload) }); }
    catch { throw { code: 'SERVICE_UNAVAILABLE' }; }
    try { value = await response.json(); } catch { throw { code: 'SERVICE_UNAVAILABLE' }; }
    if (!response.ok) throw { code: value.error || 'SERVICE_UNAVAILABLE' };
    return value;
  }
  function safeLink(href) {
    try { const url = new URL(href); return url.protocol === 'https:' && ['calendar.google.com', 'www.google.com'].includes(url.hostname) ? url.href : null; } catch { return null; }
  }
  function render() {
    $('eventTitle').placeholder = tr('项目讨论', 'Project discussion');
    $('eventLocation').placeholder = tr('会议室 / 线上链接', 'Meeting room / online link');
    $('eventDescription').placeholder = tr('讨论内容、准备材料、备注……', 'Agenda, preparation, notes…');
    $('calendarState').textContent = working ? tr('处理中…', 'Working…') : status.authenticated ? tr('已连接', 'Connected') : tr('未连接', 'Not connected');
    $('calendarState').dataset.state = status.authenticated ? 'connected' : 'disconnected';
    $('connectCalendar').hidden = Boolean(status.authenticated);
    $('connectCalendar').disabled = working || !status.configured;
    $('retryCalendar').disabled = working;
    $('disconnectCalendar').hidden = !status.authenticated; $('disconnectCalendar').disabled = working;
    $('calendarSettings').hidden = !status.authenticated;
    $('calendarTarget').disabled = working;
    $('eventFields').disabled = working || !status.authenticated || !target;
    $('readCalendar').disabled = working || !target || !status.authenticated;
    $('calendarDate').disabled = working;
    $('createCalendarEvent').textContent = working ? tr('处理中…', 'Working…') : tr('添加到 Google 日历 →', 'Add to Google Calendar →');
    $('calendarSetup').hidden = Boolean(status.configured);
    $('calendarFeedback').textContent = feedback ? tr(...feedback.pair) : status.email || '';
    $('calendarFeedback').classList.toggle('error', Boolean(feedback?.error));
    $('calendarTimeZone').textContent = tr('时间以本机时区为准：', 'Times use your local timezone: ') + zone;
    $('calendarReadSummary').textContent = snapshot ? tr(`已读取 ${snapshot.events.length} 个日程。`, `${snapshot.events.length} events loaded.`) : tr('连接后查看日历中的日程。', 'Connect to see events in your calendar.');
    const list = $('calendarEvents'); list.replaceChildren();
    if (!snapshot?.events.length) { list.append(node('p', snapshot ? tr('这一周暂无日程。', 'No events this week.') : tr('你的安排将在这里显示。', 'Your events will appear here.'), 'calendar-empty')); }
    for (const event of snapshot?.events || []) {
      const conflict = event.busy && snapshot.events.some(other => other.id !== event.id && other.busy && event.start < other.end && other.start < event.end);
      const card = node('article', undefined, 'calendar-event' + (conflict || event.colorId === '11' ? ' overlapping' : ''));
      card.append(node('small', event.allDay ? format(event.start).split(',')[0] + ' · ' + tr('全天', 'All day') : format(event.start) + ' — ' + format(event.end)), node('strong', event.title));
      if (event.location) card.append(node('span', event.location));
      if (conflict) card.append(node('span', tr('时间重叠', 'Time overlap'), 'calendar-overlap-label'));
      const href = safeLink(event.htmlLink);
      if (href) { const link = node('a', tr('在 Google 日历中查看 ↗', 'View in Google Calendar ↗')); link.href = href; link.target = '_blank'; link.rel = 'noopener noreferrer'; card.append(link); }
      list.append(card);
    }
    const output = $('calendarResult'); output.hidden = !result; output.replaceChildren();
    if (result) {
      output.classList.toggle('overlapping', result.overlap);
      output.append(node('strong', result.overlap ? tr('已录入，发现时间重叠', 'Added with a time overlap') : tr('已添加到 Google 日历', 'Added to Google Calendar')),
        node('p', result.event.title + ' · ' + format(result.event.start) + ' — ' + format(result.event.end)));
      if (result.overlap) { output.append(node('p', tr('新事件已在 Google 日历中标红。重叠日程：', 'The new event is red in Google Calendar. Overlapping events:'))); const list = node('ul'); for (const event of result.conflicts) list.append(node('li', event.title + ' · ' + format(event.start) + ' — ' + format(event.end))); output.append(list); }
      const href = safeLink(result.event.htmlLink);
      if (href) { const a = node('a', tr('打开这个事件 ↗', 'Open this event ↗')); a.href = href; a.target = '_blank'; a.rel = 'noopener noreferrer'; output.append(a); }
    }
  }
  async function read() {
    const date = new Date($('calendarDate').value + 'T00:00:00'), end = new Date(date); end.setDate(end.getDate() + 7);
    if (!Number.isFinite(date.getTime())) throw { code: 'INVALID_WINDOW' };
    snapshot = null;
    snapshot = await api('read', { calendarId: target, startTime: date.toISOString(), endTime: end.toISOString(), timeZone: zone });
  }
  async function refresh() {
    if (working || !target) return;
    working = true; feedback = null; render();
    try { await read(); } catch (error) { errorMessage(error); } finally { working = false; render(); }
  }
  async function connectStatus() {
    if (working) return;
    working = true; feedback = null; snapshot = null; render();
    try {
      status = await api('status');
      if (status.authorizing && !status.authenticated) {
        feedback = { pair: window.ForgeCalendarConnection.waiting }; render();
        await window.ForgeCalendarConnection.wait(api);
        status = await api('status'); feedback = null;
      }
      if (!status.configured) throw { code: 'GOOGLE_NOT_CONFIGURED' };
      if (!status.authenticated && status.authError) throw { code: status.authError };
      if (status.authenticated) {
        calendars = (await api('calendars', {})).calendars;
        let saved; try { saved = localStorage.getItem('forgeos:calendar-target'); } catch {}
        target = calendars.some(c => c.id === saved) ? saved : calendars[0]?.id || '';
        $('calendarTarget').replaceChildren(...calendars.map(c => { const opt = node('option', c.title); opt.value = c.id; return opt; }));
        $('calendarTarget').value = target;
        if (target) await read(); else feedback = { pair: ['该账号没有可用日历。', 'No calendars are available for this account.'] };
      }
    } catch (error) { errorMessage(error); } finally { working = false; render(); }
  }
  let requestMemory;
  async function requestId(payload) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(payload)));
    const signature = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
    let previous = requestMemory;
    try { previous = JSON.parse(sessionStorage.getItem('forgeos:calendar-pending')) || previous; } catch {}
    requestMemory = previous?.signature === signature ? previous : { signature, id: crypto.randomUUID() };
    try { sessionStorage.setItem('forgeos:calendar-pending', JSON.stringify(requestMemory)); } catch {}
    return requestMemory.id;
  }
  $('calendarEventForm').addEventListener('submit', async event => {
    event.preventDefault(); if (working || !target || !status.authenticated) return;
    const start = new Date($('eventStart').value), end = new Date($('eventEnd').value);
    if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start) { errorMessage({ code: 'INVALID_WINDOW' }); render(); return; }
    working = true; feedback = null; result = null; render();
    try {
      const payload = { calendarId: target, startTime: start.toISOString(), endTime: end.toISOString(), timeZone: zone, title: $('eventTitle').value.trim(), description: $('eventDescription').value, location: $('eventLocation').value.trim() };
      result = await api('events', { ...payload, requestId: await requestId(payload) });
      requestMemory = null; try { sessionStorage.removeItem('forgeos:calendar-pending'); } catch {}
      $('eventTitle').value = ''; $('eventDescription').value = ''; $('eventLocation').value = '';
      $('calendarDate').value = dateKey(start);
      try { await read(); } catch { feedback = { pair: ['事件已创建，但列表刷新失败。请点刷新查看。', 'The event was created, but the list could not refresh. Click Refresh.'], error: true }; }
    } catch (error) { errorMessage(error); } finally { working = false; render(); }
  });
  $('connectCalendar').addEventListener('click', async () => {
    if (working) return; working = true; render();
    try {
      const connected = await window.ForgeCalendarConnection.start(api, '/planner/calendar.html', () => {
        feedback = { pair: window.ForgeCalendarConnection.waiting }; render();
      });
      if (connected) { working = false; await connectStatus(); }
    } catch (error) { errorMessage(error); }
    finally { working = false; render(); }
  });
  $('disconnectCalendar').addEventListener('click', async () => {
    if (working) return; working = true; render();
    try { await api('disconnect', {}); status = {}; target = ''; snapshot = null; result = null; }
    catch (error) { errorMessage(error); } finally { working = false; render(); }
    await connectStatus();
  });
  $('calendarTarget').addEventListener('change', () => { target = $('calendarTarget').value; snapshot = null; result = null; try { localStorage.setItem('forgeos:calendar-target', target); } catch {} refresh(); });
  $('calendarDate').addEventListener('change', refresh);
  $('retryCalendar').addEventListener('click', connectStatus); $('readCalendar').addEventListener('click', refresh);
  document.addEventListener('forgeos:languagechange', render);
  const start = new Date(); start.setMinutes(0, 0, 0); start.setHours(start.getHours() + 1);
  $('eventStart').value = localValue(start); $('eventEnd').value = localValue(new Date(start.getTime() + 3600000)); $('calendarDate').value = dateKey(new Date());
  const callbackState = new URLSearchParams(location.search).get('calendar');
  if (callbackState) { const cleanUrl = new URL(location.href); cleanUrl.searchParams.delete('calendar'); history.replaceState(null, '', cleanUrl); }
  connectStatus().then(() => {
    if (!status.authenticated && !feedback && ['auth-failed', 'session-expired'].includes(callbackState)) {
      errorMessage({ code: callbackState === 'session-expired' ? 'GOOGLE_AUTH_SESSION_EXPIRED' : 'GOOGLE_AUTH_FAILED' }); render();
    }
  });
})();
