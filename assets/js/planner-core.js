/* Pure local scheduling rules. Replace this adapter when an agent is connected. */
((root) => {
  'use strict';
  const dateKey = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  const minutes = (value) => Number(value.slice(0, 2)) * 60 + Number(value.slice(3));
  const clock = (value) => `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
  const at = (date, time) => new Date(`${date}T${time}:00`).getTime();
  const overlaps = (a, b) => a.start < b.end && b.start < a.end;

  function parse(text, now = new Date()) {
    const durationMatch = text.match(/(\d+(?:\.\d+)?)\s*(小时|分钟|hours?|hrs?|minutes?|mins?)/i);
    const duration = durationMatch ? Math.round(Number(durationMatch[1]) * (/小时|hours?|hrs?/i.test(durationMatch[2]) ? 60 : 1)) : 60;
    let date = dateKey(now);
    const explicitDate = text.match(/\b(\d{4}-\d{2}-\d{2})\b/);
    if (explicitDate) date = explicitDate[1];
    else if (/后天/.test(text)) { const d = new Date(now); d.setDate(d.getDate() + 2); date = dateKey(d); }
    else if (/明天|tomorrow/i.test(text)) { const d = new Date(now); d.setDate(d.getDate() + 1); date = dateKey(d); }
    // Avoid treating a duration such as “2 hours” as a deadline.
    const timeMatch = text.match(/(?:[01]?\d|2[0-3]):[0-5]\d/);
    const zhTime = text.match(/(上午|下午|晚上)?\s*(\d{1,2})\s*点(?:(\d{1,2})分?)?/);
    let time = timeMatch ? timeMatch[0].padStart(5, '0') : '18:00';
    if (!timeMatch && zhTime) {
      let hour = Number(zhTime[2]);
      if (/下午|晚上/.test(zhTime[1]) && hour < 12) hour += 12;
      if (hour < 24 && Number(zhTime[3] || 0) < 60) time = clock(hour * 60 + Number(zhTime[3] || 0));
    }
    return { title: text.trim(), duration, deadline: `${date}T${time}`, priority: /紧急|高优先|urgent|high priority/i.test(text) ? 'high' : 'normal' };
  }

  function plan(tasks, events, preferences, now = new Date()) {
    const slots = [], issues = [];
    const startMinute = minutes(preferences.start), endMinute = minutes(preferences.end);
    if (!(startMinute < endMinute)) return { slots, issues: [{ reason: 'hours' }] };
    const busy = events.map(event => ({ start: at(event.date, event.start), end: at(event.date, event.end) }));
    const pending = tasks.filter(task => !task.done).slice().sort((a, b) =>
      (a.priority === 'high' ? 0 : 1) - (b.priority === 'high' ? 0 : 1) ||
      new Date(a.deadline) - new Date(b.deadline) || a.id.localeCompare(b.id));
    for (const task of pending) {
      const deadline = new Date(task.deadline).getTime();
      if (deadline <= now.getTime()) { issues.push({ taskId: task.id, reason: 'overdue' }); continue; }
      let chosen = null;
      for (let day = 0; day < 7 && !chosen; day++) {
        const date = new Date(now); date.setDate(date.getDate() + day);
        const key = dateKey(date);
        const candidates = [];
        for (let minute = startMinute; minute + task.duration <= endMinute; minute += 15) {
          const start = at(key, clock(minute));
          const end = start + task.duration * 60000;
          if (start < now.getTime() || end > deadline) continue;
          const candidate = { taskId: task.id, start, end };
          if (!busy.some(block => overlaps(candidate, block))) candidates.push(candidate);
        }
        if (preferences.focus === 'afternoon') candidates.sort((a, b) =>
          (new Date(a.start).getHours() >= 13 ? 0 : 1) - (new Date(b.start).getHours() >= 13 ? 0 : 1) || a.start - b.start);
        chosen = candidates[0] || null;
      }
      if (chosen) { slots.push(chosen); busy.push(chosen); }
      else issues.push({ taskId: task.id, reason: 'capacity' });
    }
    return { slots: slots.sort((a, b) => a.start - b.start), issues };
  }
  const api = { dateKey, minutes, clock, at, overlaps, parse, plan };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ForgePlanner = api;
})(typeof window === 'undefined' ? globalThis : window);
