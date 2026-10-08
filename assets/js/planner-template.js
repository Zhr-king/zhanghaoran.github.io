/* Presentation-only sample data. Never reads or writes real planner tasks. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const tr = (zh, en) => window.ForgeI18n.language === 'en' ? en : zh;
  const locale = () => window.ForgeI18n.language === 'en' ? 'en-GB' : 'zh-CN';
  const startDate = new Date(); startDate.setHours(12, 0, 0, 0);
  let selected = 0;
  const completed = new Set();
  const samples = [
    { id: 'research', title: ['ForgeOS 项目方案设计', 'Design the ForgeOS project'], start: 9 * 60, duration: 90, type: 'deep', icon: 'code', high: true, note: ['梳理模块边界，完善核心流程', 'Define the modules and the core experience'] },
    { id: 'learning', title: ['阅读与知识整理', 'Read, learn & connect ideas'], start: 11 * 60, duration: 60, type: 'learning', icon: 'book', note: ['', ''] },
    { id: 'build', title: ['时间规划模块开发', 'Build the planning workspace'], start: 13 * 60 + 30, duration: 90, type: 'deep', icon: 'code', high: true, note: ['完成日程视图与任务交互', 'Bring the timeline and task interactions to life'] },
    { id: 'review', title: ['项目进度复盘', 'Project progress review'], start: 16 * 60, duration: 60, type: 'meeting', icon: 'flow', note: ['', ''] }
  ];
  function el(tag, text, className) { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; if (className) node.className = className; return node; }
  function icon(name) { const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('class', 'template-icon'); svg.setAttribute('aria-hidden', 'true'); const use = document.createElementNS('http://www.w3.org/2000/svg', 'use'); use.setAttribute('href', '#icon-' + name); svg.append(use); return svg; }
  function clock(minutes) { return String(Math.floor(minutes / 60)).padStart(2, '0') + ':' + String(minutes % 60).padStart(2, '0'); }
  function day(offset) { const date = new Date(startDate); date.setDate(date.getDate() + offset); return date; }
  function tasksForDay() { return selected % 3 === 2 ? samples.filter(task => task.id !== 'build') : samples; }
  function isDone(task) { return completed.has(selected + '/' + task.id); }
  function render() {
    const tasks = tasksForDay(), date = day(selected);
    $('templateDate').textContent = startDate.toLocaleDateString(locale(), { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' });
    $('sampleMonth').textContent = date.toLocaleDateString(locale(), { year: 'numeric', month: 'long' });
    $('samplePrev').disabled = selected === 0; $('sampleNext').disabled = selected === 6;
    $('sampleWeek').replaceChildren();
    for (let i = 0; i < 7; i++) {
      const date = day(i), button = el('button'); button.type = 'button';
      button.setAttribute('aria-pressed', String(i === selected));
      button.setAttribute('aria-label', date.toLocaleDateString(locale(), { month: 'long', day: 'numeric', weekday: 'long' }));
      button.append(el('span', date.toLocaleDateString(locale(), { weekday: 'short' })), el('strong', String(date.getDate())), el('i'));
      button.addEventListener('click', () => { selected = i; render(); }); $('sampleWeek').append(button);
    }
    $('sampleEvents').replaceChildren(); $('sampleTasks').replaceChildren();
    for (const task of tasks) {
      const title = tr(...task.title), done = isDone(task);
      const event = el('article', undefined, 'sample-event ' + task.type + (done ? ' is-done' : ''));
      event.style.top = (task.start - 9 * 60) + 'px'; event.style.height = (task.duration - 5) + 'px';
      const body = el('div'), top = el('div', undefined, 'sample-event-top');
      top.append(icon(task.icon), el('h3', title, 'sample-event-title'));
      body.append(top, el('p', clock(task.start) + ' – ' + clock(task.start + task.duration) + ' · ' + task.duration + tr(' 分钟', ' min'), 'sample-event-time'));
      if (task.duration > 60) body.append(el('p', tr(...task.note), 'sample-event-note'));
      const category = done ? tr('已完成', 'DONE') : task.type === 'meeting' ? tr('固定安排', 'FIXED') : task.type === 'learning' ? tr('学习', 'LEARN') : tr('专注', 'FOCUS');
      event.append(body, el('span', category, 'event-category')); $('sampleEvents').append(event);
      const row = el('div', undefined, 'template-sample-task' + (done ? ' is-done' : ''));
      const toggle = el('button', undefined, 'sample-task-toggle'); toggle.type = 'button';
      toggle.setAttribute('aria-pressed', String(done)); toggle.setAttribute('aria-label', (done ? tr('恢复示例任务：', 'Reopen sample task: ') : tr('完成示例任务：', 'Complete sample task: ')) + title);
      toggle.append(el('span', done ? '✓' : ''));
      toggle.addEventListener('click', () => {
        const key = selected + '/' + task.id; completed.has(key) ? completed.delete(key) : completed.add(key);
        render();
        $('sampleTasks').querySelectorAll('button')[tasks.indexOf(task)].focus({ preventScroll: true });
        $('sampleFeedback').textContent = tr('示例任务已更新，真实日程不受影响。', 'Sample task updated. Your actual schedule is unchanged.');
      });
      const detail = el('div'); detail.append(el('h3', title, 'sample-task-title'));
      const meta = el('div', undefined, 'sample-task-meta'); meta.append(el('span', clock(task.start) + ' · ' + task.duration + tr(' 分钟', ' min')));
      if (task.high) meta.append(el('span', tr('高优先级', 'HIGH'), 'sample-task-priority'));
      detail.append(meta); row.append(toggle, detail); $('sampleTasks').append(row);
    }
    const lunch = el('div', tr('午间休息 · 给思绪充个电', 'LUNCH BREAK · ROOM TO RESET'), 'timeline-break'); lunch.style.top = '208px'; $('sampleEvents').append(lunch);
    const total = tasks.reduce((sum, task) => sum + task.duration, 0) / 60;
    $('sampleRemaining').replaceChildren(document.createTextNode(String(tasks.filter(task => !isDone(task)).length) + ' '), el('small', tr('项', 'tasks')));
    $('samplePlanned').replaceChildren(document.createTextNode(total + ' '), el('small', 'h'));
    $('sampleFree').replaceChildren(document.createTextNode((9 - total) + ' '), el('small', 'h'));
    $('sampleTaskCount').textContent = String(tasks.length).padStart(2, '0');
    $('sampleCapacity').textContent = Math.round(total / 9 * 100) + '%';
    $('sampleCapacityBar').style.width = (total / 9 * 100) + '%';
    $('sampleCapacityLabel').textContent = total + tr(' 小时已安排', ' h planned');
  }
  $('samplePrev').addEventListener('click', () => { selected = Math.max(0, selected - 1); render(); });
  $('sampleNext').addEventListener('click', () => { selected = Math.min(6, selected + 1); render(); });
  $('sampleToday').addEventListener('click', () => { selected = 0; render(); });
  document.addEventListener('forgeos:languagechange', render);
  render();
})();
