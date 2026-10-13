/* A first-visit guide for each workspace. No task or note data is changed. */
(() => {
  'use strict';

  const guides = {
    schedule: {
      name: ['时间规划', 'SCHEDULE'],
      title: ['把待办，变成一天的安排。', 'Make a little room for your day.'],
      intro: ['从一件小事开始，三个步骤就能上手。', 'Start with one task. Find your rhythm in three steps.'],
      icons: ['edit', 'calendar', 'clock'],
      artLabels: [['你的一天', 'YOUR DAY'], ['专注时段', 'Focus time'], ['留点空白', 'Room to breathe'], ['节奏由你掌握', 'At your own pace']],
      steps: [
        [['记下待办', 'Capture a task'], ['用一句话描述任务，核对时长和截止时间，再点击添加。', 'Describe a task. Check its duration and deadline, then add it.']],
        [['看看怎么安排', 'Make a plan'], ['设置偏好，生成排程建议。你确认后，日程才会更新。', 'Set your preferences and generate a plan. Nothing changes until you confirm.']],
        [['跟着变化调整', 'Find your rhythm'], ['在任务池编辑或完成任务，再重排；固定安排会保留。', 'Edit or finish tasks in the task pool, then replan. Fixed events stay put.']]
      ],
      target: '#naturalTask'
    },
    knowledge: {
      name: ['学习知识库', 'LEARNING LIBRARY'],
      title: ['给知识，留一个自己的位置。', 'A home for what you learn.'],
      intro: ['从你的科目和笔记出发，慢慢积累。', 'Build your library around your own subjects and notes.'],
      icons: ['book', 'file', 'chat'],
      artLabels: [['我的笔记', 'MY NOTES'], ['带着问题读', 'Read with curiosity'], ['一点点，连成知识', 'Connect the dots']],
      steps: [
        [['选个想学的方向', 'Pick a subject'], ['打开「我的科目」，添加自己的学习方向，从空白开始。', 'Open My subjects and add something you want to learn. Make it yours.']],
        [['放进一份笔记', 'Bring a note'], ['点输入框旁的「＋」，导入 Markdown / TXT，补充说明并归类。', 'Use + beside the message box to import Markdown / TXT and choose a subject.']],
        [['提问，再回来复习', 'Ask & revisit'], ['右侧提问检索本地笔记，左侧查看历史；打开笔记即可复习。', 'Search your notes on the right, find chats on the left. Open a note to review it.']]
      ],
      target: '#welcomeSubject, #chatInput'
    },
    agents: {
      name: ['智能体账号', 'AGENT ACCOUNTS'],
      title: ['为规划，选一个搭档。', 'Choose your planning partner.'],
      intro: ['先体验账号管理，再选择默认助手。', 'Try account management, then choose your default assistant.'],
      icons: ['person', 'check', 'calendar'],
      artLabels: [['你的默认助手', 'YOUR DEFAULT'], ['选择权，在你手中', 'Your agent. Your choice.'], ['演示', 'DEMO']],
      steps: [
        [['认识你的搭档', 'Choose an agent'], ['在「登录智能体」中选择服务，体验演示登录，无需密码。', 'Open Sign in and pick a provider. Try a demo account, no password needed.']],
        [['选为默认助手', 'Make it your default'], ['选中已登录的账号并保存。默认由你决定，不会自动切换。', 'Select a signed-in account and save it as your default. You make the choice.']],
        [['回到你的日程', 'Back to your day'], ['返回 Schedule 继续规划。当前为前端演示，排程仍用本地规则。', 'Return to Schedule. This is a frontend demo; plans still use local rules.']]
      ],
      target: '[data-agent-tab][aria-selected="true"]'
    }
  };

  const module = document.body.dataset.onboarding;
  const guide = guides[module];
  if (!guide || typeof HTMLDialogElement === 'undefined' || !HTMLDialogElement.prototype.showModal) return;

  // Stable, independent keys: revisiting one module never resets another.
  const key = 'forgeos:onboarding:' + module;
  function seen() {
    return ['localStorage', 'sessionStorage'].some(name => {
      try { return window[name].getItem(key) === 'seen'; } catch (error) { return false; }
    });
  }

  const paths = {
    compass: '<circle cx="12" cy="12" r="9"/><path d="m16 8-2.5 5.5L8 16l2.5-5.5Z"/>',
    edit: '<path d="m15 4 5 5M4 20l5-1L21 7a2 2 0 0 0-4-4L5 15z"/>',
    calendar: '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M7 3v5m10-5v5M3 11h18m-13 4h3m3 0h2"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    book: '<path d="M12 5v16M3 4c3-1 6-1 9 1 3-2 6-2 9-1v15c-3-1-6-1-9 2-3-3-6-3-9-2z"/>',
    file: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9zM14 3v6h6M8 13h8m-8 4h5"/>',
    chat: '<path d="M21 11a8 8 0 0 1-8 8H7l-4 3V11a9 9 0 0 1 18 0Z"/><path d="M8 9h8m-8 4h5"/>',
    person: '<circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/>',
    check: '<path d="m5 12 4 4L19 6"/>',
    spark: '<path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5z"/>',
    arrow: '<path d="M5 12h14m-5-5 5 5-5 5"/>',
    close: '<path d="m6 6 12 12M6 18 18 6"/>'
  };
  const icon = name => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name]}</svg>`;
  const label = index => `<span data-art-label="${index}"></span>`;
  const art = {
    schedule: `<div class="guide-demo-window"><div class="guide-demo-heading">${icon('calendar')}${label(0)}<span class="guide-demo-dots">···</span></div><div class="guide-demo-event"><span>09:00</span><div>${label(1)}<i></i></div></div><div class="guide-demo-event is-break"><span>10:30</span><div>${label(2)}</div></div></div><span class="guide-art-stamp">${icon('check')}</span><div class="guide-art-caption">${icon('clock')}${label(3)}</div>`,
    knowledge: `<div class="guide-demo-paper"></div><div class="guide-demo-window"><div class="guide-demo-heading">${icon('book')}${label(0)}<span class="guide-demo-dots">···</span></div><div class="guide-demo-lines"><i></i><i></i><i></i></div><div class="guide-demo-tags"><i></i><i></i></div></div><span class="guide-art-stamp">.md</span><div class="guide-demo-bubble">${icon('chat')}${label(1)}</div><div class="guide-art-caption">${icon('spark')}${label(2)}</div>`,
    agents: `<div class="guide-agent-network"><div class="guide-agent-node">${icon('person')}</div><div class="guide-agent-node is-chosen">${icon('spark')}<span>${icon('check')}</span></div><div class="guide-agent-node">${icon('person')}</div></div><div class="guide-demo-choice">${label(0)}<span class="guide-demo-badge" data-art-label="2"></span></div><div class="guide-art-caption">${label(1)}</div>`
  };
  document.querySelectorAll('[data-open-guide]').forEach(button => {
    button.hidden = false;
    button.addEventListener('click', openGuide);
  });
  if (!seen()) openGuide();

  function openGuide() {
    if (document.querySelector('dialog[open]')) return;

    const previousFocus = document.activeElement;
    const dialog = document.createElement('dialog');
    dialog.id = 'moduleGuide';
    dialog.className = 'module-guide';
    dialog.dataset.module = module;
    dialog.setAttribute('aria-labelledby', 'moduleGuideTitle');
    dialog.setAttribute('aria-describedby', 'moduleGuideIntro');
    dialog.innerHTML = `
      <div class="module-guide-top">
        <div class="module-guide-tag">${icon('compass')}<span data-guide="name"></span></div>
        <button type="button" class="module-guide-close" data-guide-action="close">${icon('close')}</button>
      </div>
      <div class="module-guide-hero">
        <div class="module-guide-copy"><span class="module-guide-kicker">${icon('spark')}<span data-guide="kicker"></span></span><h2 id="moduleGuideTitle" tabindex="-1" autofocus></h2><p id="moduleGuideIntro" class="module-guide-intro"></p></div>
        <div class="module-guide-art" aria-hidden="true">${art[module]}</div>
      </div>
      <ol class="module-guide-steps"></ol>
      <div class="module-guide-footer"><p class="module-guide-note"></p>
      <div class="module-guide-actions"><button type="button" class="module-guide-skip" data-guide-action="skip"></button><button type="button" class="module-guide-start" data-guide-action="start"><span></span>${icon('arrow')}</button></div></div>`;
    const steps = guide.steps.map((step, index) => {
      const row = document.createElement('li');
      const top = document.createElement('div');
      top.className = 'module-guide-step-top';
      top.innerHTML = `<span class="module-guide-step-icon">${icon(guide.icons[index])}</span><span class="module-guide-step-number" aria-hidden="true">0${index + 1}</span>`;
      const title = document.createElement('h3');
      const description = document.createElement('p');
      row.append(top, title, description);
      dialog.querySelector('ol').append(row);
      return { title, description };
    });
    let durable = false, session = false, started = false, leaving = false;
    const copy = pair => pair[window.ForgeI18n?.language === 'en' ? 1 : 0];
    function render() {
      dialog.querySelector('[data-guide="name"]').textContent = copy(guide.name);
      dialog.querySelector('h2').textContent = copy(guide.title);
      dialog.querySelector('.module-guide-intro').textContent = copy(guide.intro);
      dialog.querySelector('[data-guide="kicker"]').textContent = copy(['3 步，轻松上手', '3 SIMPLE STEPS']);
      dialog.querySelectorAll('[data-art-label]').forEach(node => { node.textContent = copy(guide.artLabels[Number(node.dataset.artLabel)]); });
      steps.forEach((row, index) => {
        row.title.textContent = copy(guide.steps[index][0]);
        row.description.textContent = copy(guide.steps[index][1]);
      });
      dialog.querySelector('.module-guide-close').setAttribute('aria-label', copy(['关闭指引', 'Close guide']));
      dialog.querySelector('.module-guide-skip').textContent = copy(['跳过', 'Skip']);
      dialog.querySelector('.module-guide-start span').textContent = copy(['开始使用', 'Let’s begin']);
      dialog.querySelector('.module-guide-note').textContent = copy(durable
        ? ['仅首次自动显示，随时可在「使用指引」重看。', 'Only shown once. Revisit anytime from Quick guide.']
        : session
          ? ['本次浏览期间不会再次显示。', 'This guide will stay hidden for this browsing session.']
          : ['浏览器未能保存状态，下次进入可能再次显示。', 'Your browser could not save this preference. The guide may appear again.']);
    }
    render();
    document.body.append(dialog);
    try { dialog.showModal(); } catch (error) { dialog.remove(); return; }
    // Remember as soon as it is displayed, including refreshes, Skip, and Escape.
    try { localStorage.setItem(key, 'seen'); durable = true; } catch (error) { /* Try session storage below. */ }
    try { sessionStorage.setItem(key, 'seen'); session = true; } catch (error) { /* The guide remains dismissible. */ }
    render();

    document.addEventListener('forgeos:languagechange', render);
    dialog.addEventListener('click', event => {
      const action = event.target.closest('[data-guide-action]');
      if (!action) return;
      started = action.dataset.guideAction === 'start';
      dialog.close();
    });
    const onPageHide = () => { leaving = true; if (dialog.open) dialog.close(); };
    window.addEventListener('pagehide', onPageHide);
    dialog.addEventListener('close', () => {
      document.removeEventListener('forgeos:languagechange', render);
      window.removeEventListener('pagehide', onPageHide);
      dialog.remove();
      if (leaving) return;
      const visible = node => node?.getClientRects().length && !node.closest('[inert]');
      const target = started && Array.from(document.querySelectorAll(guide.target)).find(visible);
      const fallback = previousFocus !== document.body && visible(previousFocus) ? previousFocus : document.querySelector('.site-home-link, .site-home-brand');
      (target || fallback)?.focus({ preventScroll: !target });
    }, { once: true });
  }
})();
