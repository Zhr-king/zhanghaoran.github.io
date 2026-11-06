/* Codex uses the local service; other providers remain clearly labelled demos. */
(() => {
  'use strict';
  const KEY = 'forgeos:agent-accounts:v1';
  const providers = [
    { id: 'codex', name: 'Codex', icon: 'chatgpt.svg' },
    { id: 'claude', name: 'Claude', icon: 'claude-color.svg' },
    { id: 'gemini', name: 'Gemini', icon: 'gemini-color.svg' },
    { id: 'deepseek-v4', name: 'DeepSeek V4', icon: 'deepseek-color.svg' },
    { id: 'kimi', name: 'Kimi', icon: 'kimi-color.svg' }
  ];
  const providerFor = id => providers.find(provider => provider.id === id);
  const blank = () => ({ version: 1, accounts: [], defaultProvider: null });
  const $ = id => document.getElementById(id);
  const tr = (zh, en) => window.ForgeI18n.language === 'en' ? en : zh;
  let state = blank(), selectedDefault = null;
  let activeTab = location.hash === '#login' ? 'login' : 'default';
  let loginProvider = null, feedback = null, dialogFeedback = null, renderSignature = '';
  let connecting = false;
  const codex = window.ForgeCodex;

  function read() {
    try {
      const value = localStorage.getItem(KEY);
      if (!value) { state = blank(); return; }
      const data = JSON.parse(value), ids = new Set();
      if (data.version !== 1 || !Array.isArray(data.accounts) || data.accounts.length > providers.length) throw new Error('Invalid accounts');
      const accounts = data.accounts.map(account => {
        if (!providerFor(account.provider) || !(account.kind === 'demo' || (account.provider === 'codex' && account.kind === 'cli')) || !Number.isFinite(account.signedInAt) || ids.has(account.provider)) throw new Error('Invalid account');
        ids.add(account.provider);
        return { provider: account.provider, kind: account.kind, signedInAt: account.signedInAt };
      });
      // Old demo Codex accounts must never be mistaken for a real connection.
      const migrated = accounts.filter(account => account.provider !== 'codex' || account.kind === 'cli');
      state = { version: 1, accounts: migrated, defaultProvider: migrated.some(account => account.provider === data.defaultProvider) ? data.defaultProvider : null };
    } catch (error) {
      state = blank();
      tell('无法读取本机账号选择，请重新连接。', 'Local account selections could not be read. Please reconnect.', true);
    }
  }
  function commit(next, inDialog = false) {
    try { localStorage.setItem(KEY, JSON.stringify(next)); state = next; return true; }
    catch (error) {
      tell('浏览器无法保存，请检查本地存储设置后重试。', 'Browser storage is unavailable. Check your storage settings and try again.', true, inDialog);
      return false;
    }
  }
  const signedIn = id => state.accounts.some(account => account.provider === id);
  async function connectCodex(makeDefault = false) {
    if (connecting || !codex) return;
    connecting = true;
    tell('正在验证 Codex 连接…', 'Verifying the Codex connection…'); render();
    try {
      await codex.test();
      const next = { ...state, accounts: [...state.accounts.filter(account => account.provider !== 'codex'), { provider: 'codex', kind: 'cli', signedInAt: Date.now() }],
        defaultProvider: makeDefault ? 'codex' : state.defaultProvider };
      if (!commit(next)) return;
      selectedDefault = 'codex';
      tell('Codex 连接验证成功。' + (makeDefault ? '现在可以识别任务信息。' : '可将它保存为默认智能体。'),
        'Codex connection verified. ' + (makeDefault ? 'You can now extract task details.' : 'You can save it as your default agent.'));
      if ($('defaultPanel')) chooseTab('default');
    } catch (error) { tell(...codex.errorPair(error), true); }
    finally { connecting = false; render(); }
  }
  function tell(zh, en, error = false, inDialog = false) {
    const message = { zh, en, error };
    if (inDialog) dialogFeedback = message; else feedback = message;
    renderFeedback();
  }
  function renderFeedback() {
    [['agentFeedback', feedback], ['agentDialogFeedback', dialogFeedback]].forEach(([id, message]) => {
      if (!$(id)) return;
      $(id).textContent = message ? tr(message.zh, message.en) : '';
      $(id).classList.toggle('error', Boolean(message?.error));
    });
  }
  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function paintMark(node, provider) {
    node.dataset.provider = provider?.id || '';
    node.setAttribute('aria-hidden', 'true');
    if (!provider) { node.textContent = '✦'; return node; }
    const icon = element('img', 'agent-provider-icon');
    icon.src = '../assets/images/agents/' + provider.icon;
    icon.alt = ''; // The adjacent provider name already labels this decorative icon.
    icon.width = 26; icon.height = 26;
    icon.draggable = false;
    node.replaceChildren(icon);
    return node;
  }
  function mark(provider) { return paintMark(element('span', 'agent-provider-mark'), provider); }
  function action(label, className, handler) {
    const node = element('button', className, label);
    node.type = 'button'; node.addEventListener('click', handler);
    return node;
  }
  function chooseTab(tab, focus = false) {
    activeTab = tab;
    if ($('defaultPanel')) history.replaceState(null, '', '#' + tab);
    render();
    if (focus) $(tab + 'Tab')?.focus();
  }
  function updateDefaultButton() {
    $('saveDefaultAgent').disabled = !signedIn(selectedDefault) || selectedDefault === state.defaultProvider;
  }
  function logout(id) {
    const provider = providerFor(id);
    const next = { ...state, accounts: state.accounts.filter(account => account.provider !== id), defaultProvider: state.defaultProvider === id ? null : state.defaultProvider };
    if (!commit(next)) return;
    if (selectedDefault === id) selectedDefault = state.defaultProvider;
    if (id === 'codex') tell('已取消本浏览器的 Codex 连接选择，本机 CLI 仍保持登录。', 'Codex selection removed from this browser. Your local CLI remains signed in.');
    else tell('已退出 ' + provider.name + ' 演示账号。', 'Signed out of the ' + provider.name + ' demo account.');
    render(); $(activeTab + 'Tab').focus();
  }
  function renderAccounts() {
    const accounts = providers.filter(provider => signedIn(provider.id));
    $('signedInCount').textContent = tr(accounts.length + ' 个已登录', accounts.length + ' signed in');
    $('emptyAccounts').hidden = accounts.length > 0;
    $('defaultAgentForm').hidden = accounts.length === 0;
    $('signedInAccounts').replaceChildren();
    if (!signedIn(selectedDefault)) selectedDefault = state.defaultProvider;
    accounts.forEach(provider => {
      const row = element('div', 'agent-account-row');
      row.dataset.provider = provider.id;
      const label = element('label', 'agent-account-choice');
      const input = document.createElement('input');
      input.type = 'radio'; input.name = 'defaultAgent'; input.value = provider.id;
      input.checked = selectedDefault === provider.id;
      input.addEventListener('change', () => { selectedDefault = provider.id; updateDefaultButton(); });
      const details = element('span', 'agent-account-details');
      details.append(element('strong', '', provider.name), element('small', '', provider.id === 'codex'
        ? tr(codex?.status.authenticated ? '本机 Codex · 已登录' : '本机 Codex · 请检查连接', codex?.status.authenticated ? 'Local Codex · Signed in' : 'Local Codex · Check connection')
        : tr('本机演示账号 · 演示已登录', 'Local demo account · Signed in')));
      label.append(input, mark(provider), details);
      const actions = element('div', 'agent-account-actions');
      if (provider.id === state.defaultProvider) actions.append(element('span', 'agent-default-badge', provider.id === 'codex' ? tr('默认', 'Default') : tr('默认 · 演示', 'Default · Demo')));
      const leave = action(provider.id === 'codex' ? tr('移除连接选择', 'Remove selection') : tr('退出', 'Sign out'), 'text-btn', () => logout(provider.id));
      leave.dataset.action = 'logout';
      leave.setAttribute('aria-label', provider.id === 'codex' ? tr('取消 Codex 连接选择', 'Remove Codex selection') : tr('退出 ' + provider.name + ' 演示账号', 'Sign out of ' + provider.name + ' demo'));
      actions.append(leave); row.append(label, actions);
      $('signedInAccounts').append(row);
    });
    $('clearDefaultAgent').hidden = !state.defaultProvider;
    updateDefaultButton();
  }
  function openLogin(id) {
    if (id === 'codex') { connectCodex(); return; }
    if (!providerFor(id) || signedIn(id)) return;
    loginProvider = id; dialogFeedback = null;
    renderDialog();
    if (!$('agentLoginDialog').open) $('agentLoginDialog').showModal();
  }
  function renderDialog() {
    const provider = providerFor(loginProvider);
    if (!provider) return;
    paintMark($('loginProviderMark'), provider);
    $('loginDialogTitle').textContent = tr('登录 ', 'Sign in to ') + provider.name;
    $('demoSignIn').textContent = tr('演示登录 ', 'Demo sign-in to ') + provider.name + ' →';
    renderFeedback();
  }
  function renderProviders() {
    $('agentProviderList').replaceChildren();
    providers.forEach((provider, index) => {
      const logged = signedIn(provider.id), card = element('article', 'agent-provider-card');
      card.dataset.provider = provider.id;
      const header = element('div', 'agent-provider-heading');
      const title = element('div');
      title.append(element('small', '', 'AGENT / 0' + (index + 1)), element('h3', '', provider.name));
      header.append(mark(provider), title);
      const real = provider.id === 'codex';
      const status = element('span', 'agent-state', real ? (codex?.status.authenticated ? tr('本机已登录', 'Local CLI signed in') : tr('等待连接', 'Connection needed')) : logged ? tr('演示已登录', 'Signed in · Demo') : tr('未登录 · 演示', 'Signed out · Demo'));
      status.dataset.state = real && codex?.status.authenticated ? 'connected' : logged && !real ? 'demo' : 'disconnected';
      const button = action(real ? tr('验证 Codex 连接 →', 'Verify Codex connection →') : logged ? tr('退出演示账号', 'Sign out') : tr('演示登录 →', 'Demo sign-in →'), 'secondary-btn', () => real ? connectCodex() : logged ? logout(provider.id) : openLogin(provider.id));
      button.disabled = real && connecting;
      button.dataset.action = real ? 'connect' : logged ? 'logout' : 'login';
      button.setAttribute('aria-label', real ? tr('验证 Codex 连接', 'Verify Codex connection') : (logged ? tr('退出 ', 'Sign out of ') : tr('登录 ', 'Sign in to ')) + provider.name);
      card.append(header, status, button); $('agentProviderList').append(card);
    });
  }
  function render() {
    const current = providerFor(state.defaultProvider);
    document.querySelectorAll('[data-agent-default-mark]').forEach(node => paintMark(node, current));
    document.querySelectorAll('[data-agent-state]').forEach(node => {
      const real = current?.id === 'codex';
      node.dataset.state = real ? (codex?.status.verifiedAt ? 'connected' : 'disconnected') : current ? 'demo' : 'disconnected';
      node.textContent = real ? (codex?.status.verifiedAt ? tr('Codex 已连接', 'Codex connected') : codex?.status.authenticated ? tr('Codex 已登录 · 待验证', 'Codex signed in · Not verified') : tr('Codex 连接不可用', 'Codex unavailable')) : current ? tr('演示默认：', 'Demo default: ') + current.name : tr('尚未选择默认智能体', 'No default agent selected');
    });
    if ($('connectCodex')) { $('connectCodex').disabled = connecting; $('connectCodex').textContent = connecting ? tr('连接中…', 'Connecting…') : tr('连接 Codex', 'Connect Codex'); }
    renderFeedback();
    if (!$('defaultPanel')) return;
    document.querySelectorAll('[data-agent-tab]').forEach(button => {
      const selected = button.dataset.agentTab === activeTab;
      button.setAttribute('aria-selected', String(selected)); button.tabIndex = selected ? 0 : -1;
    });
    $('defaultPanel').hidden = activeTab !== 'default'; $('loginPanel').hidden = activeTab !== 'login';
    $('defaultAgentName').textContent = current?.name || tr('等待你的选择', 'Ready when you are');
    paintMark($('defaultAgentMark'), current);
    $('defaultAgentDescription').textContent = current?.id === 'codex'
      ? tr('Schedule 将使用本机 Codex 提取任务信息，请核对结果后添加。', 'Schedule will use local Codex to extract task details. Review the result before adding.') : current
      ? tr('默认选择已保存。当前为演示账号；AI 识别需选择 Codex，也可手动填写任务。', 'Your default is saved. This is a demo account; choose Codex for AI extraction or enter tasks manually.')
      : tr('先登录一个智能体，再将它设为默认。你可以随时切换。', 'Sign in to an agent, then set it as your default. You can switch anytime.');
    $('accountTotal').textContent = state.accounts.length + ' / ' + providers.length;
    // Keep existing controls and keyboard focus when only switching tabs.
    const signature = JSON.stringify([state, window.ForgeI18n.language, codex?.status.authenticated, connecting]);
    if (signature !== renderSignature) { renderAccounts(); renderProviders(); renderSignature = signature; }
    renderDialog(); renderFeedback();
  }

  read(); selectedDefault = state.defaultProvider;
  document.querySelectorAll('[data-agent-tab]').forEach(button => {
    button.addEventListener('click', () => chooseTab(button.dataset.agentTab));
    button.addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      chooseTab(event.key === 'Home' ? 'default' : event.key === 'End' ? 'login' : activeTab === 'default' ? 'login' : 'default', true);
    });
  });
  ['goToLogin', 'manageLogins'].forEach(id => $(id)?.addEventListener('click', () => chooseTab('login', true)));
  $('closeLoginDialog')?.addEventListener('click', () => $('agentLoginDialog').close());
  $('agentLoginDialog')?.addEventListener('close', () => {
    const previous = loginProvider; loginProvider = null; dialogFeedback = null;
    if (activeTab === 'login') document.querySelector('#agentProviderList [data-provider="' + previous + '"] button')?.focus();
  });
  $('demoSignIn')?.addEventListener('click', () => {
    const provider = providerFor(loginProvider);
    if (!provider || signedIn(provider.id)) return;
    const next = { ...state, accounts: [...state.accounts, { provider: provider.id, kind: 'demo', signedInAt: Date.now() }] };
    if (!commit(next, true)) return;
    selectedDefault = provider.id;
    tell(provider.name + ' 演示登录成功。选择并保存默认智能体即可。', provider.name + ' demo sign-in complete. Choose and save your default agent.');
    $('agentLoginDialog').close(); chooseTab('default', true);
  });
  $('defaultAgentForm')?.addEventListener('submit', event => {
    event.preventDefault();
    if (!signedIn(selectedDefault)) return;
    if (!commit({ ...state, defaultProvider: selectedDefault })) return;
    const name = providerFor(selectedDefault).name;
    tell('已将 ' + name + ' 设为默认智能体' + (selectedDefault === 'codex' ? '。' : '（演示）。'), name + ' is now your default agent' + (selectedDefault === 'codex' ? '.' : ' (demo).'));
    render(); $('defaultTab').focus();
  });
  $('clearDefaultAgent')?.addEventListener('click', () => {
    if (!commit({ ...state, defaultProvider: null })) return;
    selectedDefault = null;
    tell('已取消默认选择，账号连接选择已保留。', 'Default cleared. Your account selections are retained.');
    render(); $('defaultTab').focus();
  });
  document.addEventListener('forgeos:languagechange', render);
  document.addEventListener('forgeos:codexchange', render);
  $('connectCodex')?.addEventListener('click', () => connectCodex(true));
  window.ForgeAgent = { get usesCodex() { return state.defaultProvider === 'codex' && signedIn('codex'); } };
  window.addEventListener('hashchange', () => chooseTab(location.hash === '#login' ? 'login' : 'default'));
  function refresh() {
    read();
    if (!signedIn(selectedDefault)) selectedDefault = state.defaultProvider;
    if (loginProvider && signedIn(loginProvider)) $('agentLoginDialog')?.close();
    render();
  }
  window.addEventListener('pageshow', refresh);
  window.addEventListener('storage', event => { if (event.key === KEY || event.key === null) refresh(); });
  render();
})();
