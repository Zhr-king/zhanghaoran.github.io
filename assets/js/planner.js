(() => {
  'use strict';
  const core = window.ForgePlanner;
  const $ = id => document.getElementById(id);
  const tr = (zh, en) => window.ForgeI18n.language === 'en' ? en : zh;
  const KEY = 'forgeos:planner:v1';
  const defaults = () => ({ tasks: [], events: [], schedule: [], preferences: { start: '09:00', end: '18:00', focus: 'morning' }, confirmedAt: null });
  const validTime = value => typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
  const validDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && core.dateKey(new Date(value + 'T12:00')) === value;
  const validDeadline = value => typeof value === 'string' && value.length === 16 && validDate(value.slice(0, 10)) && validTime(value.slice(11)) && value[10] === 'T';
  let state = defaults(), proposal = null, editing = null, selectedDay = 0;
  let loadFailed = false;
  try {
    const saved = JSON.parse(localStorage.getItem(KEY));
    if (saved) {
      if (!Array.isArray(saved.tasks) || !saved.tasks.every(task => typeof task.id === 'string' && typeof task.title === 'string' && task.title.trim() && task.title.length <= 300 && Number.isInteger(task.duration) && task.duration >= 15 && task.duration <= 720 && validDeadline(task.deadline) && ['normal', 'high'].includes(task.priority) && typeof task.done === 'boolean') ||
        !Array.isArray(saved.events) || !saved.events.every(event => typeof event.id === 'string' && typeof event.title === 'string' && validDate(event.date) && validTime(event.start) && validTime(event.end) && event.start < event.end) ||
        !Array.isArray(saved.schedule) || !saved.schedule.every(slot => saved.tasks.some(task => task.id === slot.taskId) && Number.isFinite(slot.start) && Number.isFinite(slot.end) && slot.start < slot.end) ||
        !saved.preferences || !validTime(saved.preferences.start) || !validTime(saved.preferences.end) || saved.preferences.start >= saved.preferences.end || !['morning', 'afternoon'].includes(saved.preferences.focus)) throw new Error('Invalid planner data');
      state = { ...defaults(), ...saved };
    }
  } catch (error) { loadFailed = true; }

  function node(tag, text, className) {
    const element = document.createElement(tag);
    if (text !== undefined) element.textContent = text;
    if (className) element.className = className;
    return element;
  }
  function action(text, handler, className = 'text-btn') {
    const button = node('button', text, className);
    button.type = 'button'; button.addEventListener('click', handler); return button;
  }
  function notify(zh, en, error = false) { $('feedback').textContent = tr(zh, en); $('feedback').classList.toggle('error', error); }
  function persist() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); }
    catch (error) { notify('浏览器无法保存数据，本次操作仅在当前页面有效。', 'Browser storage is unavailable. Changes will last only while this page stays open.', true); }
  }
  function changed(zh, en) { proposal = null; notify(zh, en); persist(); render(); }
  function locale() { return window.ForgeI18n.language === 'en' ? 'en-GB' : 'zh-CN'; }
  function formatDate(value) { return new Date(value).toLocaleDateString(locale(), { month: 'short', day: 'numeric' }); }
  function formatTime(value) { return new Date(value).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit', hour12: false }); }
  function slotText(slot) { return `${formatDate(slot.start)} · ${formatTime(slot.start)}–${formatTime(slot.end)}`; }
  function empty(parent, title, copy) { const block = node('div', undefined, 'empty-state'); block.append(node('strong', title), node('span', copy)); parent.append(block); }
  function selectedDate() { const date = new Date(); date.setDate(date.getDate() + selectedDay); return date; }
  function activeSlots() { return state.schedule.filter(slot => state.tasks.some(task => task.id === slot.taskId && !task.done)); }
  function resetEditor() {
    editing = null; $('taskForm').reset(); $('cancelEdit').hidden = true;
    const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
    $('taskDeadline').value = `${core.dateKey(tomorrow)}T18:00`;
    $('saveTask').textContent = tr('添加任务 ＋', 'Add task +');
  }
  function renderSchedule() {
    const date = selectedDate(), key = core.dateKey(date);
    $('selectedDate').textContent = formatDate(date);
    $('prevDay').disabled = selectedDay === 0; $('nextDay').disabled = selectedDay === 6;
    $('dayStrip').replaceChildren();
    for (let day = 0; day < 7; day++) {
      const date = new Date(); date.setDate(date.getDate() + day);
      const button = action('', () => { selectedDay = day; renderSchedule(); }, 'day-button');
      button.setAttribute('aria-pressed', String(selectedDay === day));
      button.setAttribute('aria-label', date.toLocaleDateString(locale(), { weekday: 'long', month: 'long', day: 'numeric' }));
      button.append(node('span', date.toLocaleDateString(locale(), { weekday: 'short' })), node('strong', String(date.getDate())));
      $('dayStrip').append(button);
    }
    const blocks = state.events.filter(event => event.date === key).map(event => ({ ...event, start: core.at(event.date, event.start), end: core.at(event.date, event.end), fixed: true }));
    activeSlots().filter(slot => core.dateKey(new Date(slot.start)) === key).forEach(slot => {
      const task = state.tasks.find(task => task.id === slot.taskId);
      blocks.push({ ...slot, title: task.title, fixed: false, conflict: state.events.some(event => core.overlaps(slot, { start: core.at(event.date, event.start), end: core.at(event.date, event.end) })) });
    });
    $('scheduleList').replaceChildren();
    blocks.sort((a, b) => a.start - b.start).forEach(block => {
      const row = node('div', undefined, 'schedule-item');
      const card = node('div', undefined, 'schedule-block' + (block.fixed ? ' fixed' : ''));
      card.append(node('strong', block.title), node('small', `${Math.round((block.end - block.start) / 60000)} ${tr('分钟', 'min')} · ${block.fixed ? tr('固定安排', 'Fixed event') : tr('已确认', 'Confirmed')}`));
      if (block.conflict) card.append(node('small', tr('与固定安排冲突，请重新排程', 'Overlaps a fixed event. Replanning needed.'), 'conflict-line'));
      row.append(node('span', `${formatTime(block.start)}–${formatTime(block.end)}`, 'schedule-time'), card);
      $('scheduleList').append(row);
    });
    if (!blocks.length) empty($('scheduleList'), tr('留一段时间，给重要的事。', 'Space for your next step.'), tr('添加任务，生成并确认建议后，日程会显示在这里。', 'Add tasks, generate a proposal, and confirm it to fill your schedule.'));
  }
  function renderProposal() {
    const content = $('proposalContent'); content.replaceChildren();
    $('proposalActions').hidden = !proposal;
    $('confirmPlan').disabled = !proposal?.slots.length;
    $('conflictCount').textContent = proposal ? String(proposal.issues.length) : '—';
    if (!proposal) {
      empty(content, tr('等待生成排程建议', 'Ready when you are'), tr('任务有变化时，再生成一次建议。原日程会保留到你确认新计划。', 'Generate a fresh proposal after changes. Your schedule stays in place until you confirm.'));
      return;
    }
    if (!proposal.slots.length && !proposal.issues.length) content.append(node('p', tr('先添加一个未完成的任务。', 'Add an open task to get started.')));
    proposal.slots.forEach(slot => {
      const task = state.tasks.find(task => task.id === slot.taskId);
      const row = node('div', undefined, 'proposal-line');
      row.append(node('strong', task.title), node('small', slotText(slot)));
      const previous = state.schedule.find(old => old.taskId === slot.taskId);
      if (previous && (previous.start !== slot.start || previous.end !== slot.end)) row.append(node('small', `${tr('原安排：', 'Previously: ')}${slotText(previous)}`));
      content.append(row);
    });
    proposal.issues.forEach(issue => {
      const title = state.tasks.find(task => task.id === issue.taskId)?.title || '';
      const reason = issue.reason === 'overdue' ? tr('已超过截止时间，请编辑截止时间。', 'Deadline has passed. Update the deadline.') : issue.reason === 'hours' ? tr('可用时段无效，请检查偏好。', 'Check your available hours.') : tr('未来 7 天内没有满足时长和截止时间的连续空档，请调整任务或可用时段。', 'No continuous slot fits within the next 7 days and the deadline. Adjust the task or your available hours.');
      content.append(node('p', `${title ? title + ' — ' : ''}${reason}`, 'conflict-line'));
    });
    if (proposal.issues.length && proposal.slots.length) content.append(node('p', tr('确认后只安排可排入的任务；冲突任务保留在任务池，其原日程将被移除。', 'Confirmation schedules only the tasks shown above. Conflicting tasks stay in the task pool and lose any previous time slots.'), 'field-help'));
  }
  function renderTasks() {
    const list = $('taskList'); list.replaceChildren();
    if (!state.tasks.length) empty(list, tr('从一个小任务开始', 'Start with one small task'), tr('在左侧录入任务，或试用页面上方的示例。', 'Capture a task or try the example tasks above.'));
    state.tasks.forEach(task => {
      const row = node('div', undefined, 'task-row' + (task.done ? ' done' : ''));
      const complete = action(task.done ? '✓' : '○', () => {
        task.done = !task.done;
        state.schedule = state.schedule.filter(slot => slot.taskId !== task.id);
        changed('任务状态已更新，请按需重新生成建议。', 'Task status updated. Generate a fresh plan when needed.');
      }, 'complete-btn');
      complete.setAttribute('aria-label', `${task.done ? tr('恢复任务：', 'Reopen task: ') : tr('完成任务：', 'Complete task: ')}${task.title}`);
      complete.setAttribute('aria-pressed', String(task.done));
      const body = node('div');
      body.append(node('strong', task.title, 'task-name'), node('p', `${task.duration} ${tr('分钟', 'min')} · ${task.priority === 'high' ? tr('高优先级', 'High priority') : tr('普通', 'Normal')} · ${tr('截止 ', 'Due ')}${formatDate(task.deadline)} ${formatTime(task.deadline)}`, 'task-meta'));
      const actions = node('div', undefined, 'task-actions');
      actions.append(action(tr('编辑', 'Edit'), () => {
        editing = task.id; $('taskTitle').value = task.title; $('taskDuration').value = task.duration;
        $('taskPriority').value = task.priority; $('taskDeadline').value = task.deadline;
        $('saveTask').textContent = tr('保存修改', 'Save changes'); $('cancelEdit').hidden = false;
        $('taskTitle').focus();
      }));
      if (!task.done) actions.append(action(tr('延长 30 分钟并重排', '+30 min & replan'), () => {
        if (task.duration + 30 > 720) { notify('单个任务最多支持 720 分钟，请拆分任务。', 'A task can be at most 720 minutes. Split it into smaller tasks.', true); return; }
        task.duration += 30;
        if (editing === task.id) $('taskDuration').value = task.duration;
        notify('已增加预计时长，新的排程建议等待确认。', 'Duration increased. Review and confirm the new proposal.');
        persist(); generate(false);
      }));
      actions.append(action(tr('删除', 'Delete'), () => {
        state.tasks = state.tasks.filter(item => item.id !== task.id); state.schedule = state.schedule.filter(slot => slot.taskId !== task.id);
        if (editing === task.id) resetEditor();
        changed('任务已删除。', 'Task deleted.');
      }));
      body.append(actions); row.append(complete, body); list.append(row);
    });
  }
  function renderEvents() {
    $('eventList').replaceChildren();
    state.events.slice().sort((a, b) => core.at(a.date, a.start) - core.at(b.date, b.start)).forEach(event => {
      const row = node('div', undefined, 'event-row');
      row.append(node('span', `${event.title} · ${formatDate(event.date + 'T12:00')} ${event.start}–${event.end}`), action(tr('移除', 'Remove'), () => {
        state.events = state.events.filter(item => item.id !== event.id); changed('固定安排已移除。', 'Fixed event removed.');
      })); $('eventList').append(row);
    });
  }
  function render() {
    $('taskCount').textContent = String(state.tasks.filter(task => !task.done).length);
    $('plannedHours').replaceChildren(document.createTextNode((activeSlots().reduce((sum, slot) => sum + slot.end - slot.start, 0) / 3600000).toFixed(1) + ' '), node('small', 'h'));
    $('lastConfirmed').textContent = state.confirmedAt ? `${tr('上次确认：', 'Last confirmed: ')}${formatDate(state.confirmedAt)} ${formatTime(state.confirmedAt)}` : '';
    $('saveTask').textContent = editing ? tr('保存修改', 'Save changes') : tr('添加任务 ＋', 'Add task +');
    $('naturalTask').placeholder = tr('明天下午5点前完成项目报告，需要2小时，高优先级', 'Finish the project report tomorrow by 17:00, 2 hours, high priority');
    renderSchedule(); renderProposal(); renderTasks(); renderEvents();
  }
  function generate(announce = true) {
    proposal = core.plan(state.tasks, state.events, state.preferences);
    if (announce) notify('建议已生成，请检查后确认。', 'Proposal generated. Review it before confirming.');
    render();
  }
  $('captureForm').addEventListener('submit', event => {
    event.preventDefault();
    if (!$('naturalTask').value.trim()) return;
    const parsed = core.parse($('naturalTask').value);
    resetEditor(); $('taskTitle').value = parsed.title; $('taskDuration').value = parsed.duration;
    $('taskDeadline').value = parsed.deadline; $('taskPriority').value = parsed.priority;
    notify('已按本地规则填写。未识别的时长默认 60 分钟，日期默认今天、时间默认 18:00，请核对。', 'Filled using local rules. Missing details default to 60 minutes, today, and 18:00. Please review all fields.');
    $('taskTitle').focus();
  });
  $('taskForm').addEventListener('submit', event => {
    event.preventDefault();
    const title = $('taskTitle').value.trim(), duration = Number($('taskDuration').value), deadline = $('taskDeadline').value;
    if (!title || !Number.isInteger(duration) || duration < 15 || duration > 720 || !validDeadline(deadline) || new Date(deadline).getTime() <= Date.now()) {
      notify('请填写任务名称、15–720 分钟的时长，以及未来的截止时间。', 'Enter a task name, 15–720 minutes, and a future deadline.', true); return;
    }
    const task = { id: editing || crypto.randomUUID(), title, duration, deadline, priority: $('taskPriority').value, done: state.tasks.find(task => task.id === editing)?.done || false };
    if (editing) state.tasks = state.tasks.map(item => item.id === editing ? task : item);
    else state.tasks.push(task);
    resetEditor(); $('naturalTask').value = '';
    changed('任务已保存。生成新建议并确认后，修改才会应用到日程。', 'Task saved. Generate and confirm a new proposal to apply changes to your schedule.');
  });
  $('cancelEdit').addEventListener('click', resetEditor);
  $('preferencesForm').addEventListener('submit', event => {
    event.preventDefault();
    const start = $('workStart').value, end = $('workEnd').value;
    if (!validTime(start) || !validTime(end) || start >= end) { notify('结束时间必须晚于开始时间。', 'The end of your day must be later than its start.', true); return; }
    state.preferences = { start, end, focus: $('focusTime').value };
    changed('偏好已保存，下次生成建议时生效。', 'Preferences saved for your next proposal.');
  });
  $('eventForm').addEventListener('submit', event => {
    event.preventDefault();
    const item = { id: crypto.randomUUID(), title: $('eventTitle').value.trim(), date: $('eventDate').value, start: $('eventStart').value, end: $('eventEnd').value };
    if (!item.title || !validDate(item.date) || !validTime(item.start) || !validTime(item.end) || item.start >= item.end) { notify('请填写有效名称和日期，结束时间必须晚于开始时间。', 'Enter a valid name and date, with an end time after the start.', true); return; }
    const block = { start: core.at(item.date, item.start), end: core.at(item.date, item.end) };
    if (state.events.some(other => core.overlaps(block, { start: core.at(other.date, other.start), end: core.at(other.date, other.end) }))) { notify('此时段已有固定安排，请调整时间。', 'This overlaps another fixed event. Choose another time.', true); return; }
    state.events.push(item); $('eventTitle').value = '';
    const conflicts = activeSlots().filter(slot => core.overlaps(block, slot));
    changed(conflicts.length ? '固定安排与现有任务冲突，已生成重排建议，确认后再移动任务。' : '固定安排已添加，排程时会避开此时段。', conflicts.length ? 'This fixed event overlaps a task. Review the new proposal before moving tasks.' : 'Fixed event added. Planning will keep this time free.');
    if (conflicts.length) generate(false);
  });
  $('generatePlan').addEventListener('click', () => generate());
  $('discardPlan').addEventListener('click', () => { proposal = null; render(); notify('已放弃建议，保留原日程。', 'Proposal discarded. Your previous schedule is unchanged.'); });
  $('confirmPlan').addEventListener('click', () => {
    if (!proposal?.slots.length) return;
    if (proposal.slots.some(slot => slot.start < Date.now())) { generate(); notify('时间已变化，建议已刷新，请重新检查后确认。', 'Time has moved on. The proposal was refreshed; review it again before confirming.'); return; }
    state.schedule = proposal.slots.map(slot => ({ ...slot })); state.confirmedAt = Date.now();
    const first = new Date(state.schedule[0].start), today = new Date();
    selectedDay = Math.max(0, Math.min(6, Math.round((Date.UTC(first.getFullYear(), first.getMonth(), first.getDate()) - Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())) / 86400000)));
    changed('新计划已确认，日程已更新。', 'Plan confirmed. Your schedule is updated.');
  });
  $('loadDemo').addEventListener('click', () => {
    const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1); const date = core.dateKey(tomorrow);
    const examples = [
      { title: tr('完成 ForgeOS 项目报告', 'Finish the ForgeOS project report'), duration: 120, priority: 'high' },
      { title: tr('整理本周学习笔记', 'Review this week’s learning notes'), duration: 45, priority: 'normal' },
      { title: tr('实现时间规划页面原型', 'Build the planning page prototype'), duration: 90, priority: 'normal' }
    ];
    examples.forEach(task => state.tasks.push({ ...task, id: crypto.randomUUID(), deadline: date + 'T18:00', done: false }));
    changed('已添加 3 个示例任务，可编辑后生成建议。', 'Added 3 example tasks. Edit them or generate a proposal.');
  });
  $('prevDay').addEventListener('click', () => { selectedDay = Math.max(0, selectedDay - 1); renderSchedule(); });
  $('nextDay').addEventListener('click', () => { selectedDay = Math.min(6, selectedDay + 1); renderSchedule(); });
  $('todayButton').addEventListener('click', () => { selectedDay = 0; renderSchedule(); });
  document.addEventListener('forgeos:languagechange', () => { $('feedback').textContent = ''; render(); });
  $('workStart').value = state.preferences.start; $('workEnd').value = state.preferences.end; $('focusTime').value = state.preferences.focus;
  $('eventDate').value = core.dateKey(new Date()); resetEditor(); render();
  if (loadFailed) notify('无法读取本地规划数据。当前使用空白工作台，保存可能不可用。', 'Local planning data could not be read. Starting with an empty workspace; saving may be unavailable.', true);
})();
