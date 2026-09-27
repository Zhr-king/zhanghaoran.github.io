/* Chinese is the HTML fallback; English translations live beside their content. */
(() => {
  'use strict';

  const messages = {
    'menu.open': ['打开菜单', 'Open menu'],
    'menu.close': ['关闭菜单', 'Close menu'],
    'theme.light': ['蓝白', 'Light'],
    'theme.dark': ['夜色', 'Dark'],
    'theme.switchLight': ['切换到浅色主题', 'Switch to light theme'],
    'theme.switchDark': ['切换到深色主题', 'Switch to dark theme'],
    'type.0': ['锻造代码，淬炼知识。', 'Forge code. Refine knowledge.'],
    'type.1': ['学习 · 代码 · 笔记 · 任务', 'Study · Code · Notes · Tasks'],
    'type.2': ['你的工作间，为你而建。', 'Your space. Your pace.'],
    'term.init': ['[CORE] 正在锻造你的工作间…', '[CORE] Forging your workspace…'],
    'term.ready': ['[ OK ] 核心引擎已挂载', '[ OK ] Core engine loaded'],
    'term.modules': ['[ OK ] 学习助手 + 知识库 已接入', '[ OK ] Study + Notes ready'],
    'term.welcome': ['[SYS ] 欢迎回来，指挥官。', '[SYS ] Welcome back, Commander.']
  };
  const originals = new WeakMap();
  let language = 'zh-CN';
  try {
    if (localStorage.getItem('forgeos:language') === 'en') language = 'en';
  } catch (e) { /* Storage may be unavailable; switching still works. */ }

  function t(key) {
    return messages[key]?.[language === 'en' ? 1 : 0] ?? key;
  }

  function translate() {
    const bindings = [
      ['data-i18n-en', null],
      ['data-i18n-label-en', 'aria-label'],
      ['data-i18n-content-en', 'content'],
      ['data-toast-en', 'data-toast']
    ];
    bindings.forEach(([source, target]) => {
      document.querySelectorAll('[' + source + ']').forEach((el) => {
        let saved = originals.get(el);
        if (!saved) { saved = {}; originals.set(el, saved); }
        if (!(source in saved)) saved[source] = target ? el.getAttribute(target) : el.textContent;
        const value = language === 'en' ? el.getAttribute(source) : saved[source];
        if (target) el.setAttribute(target, value);
        else el.textContent = value;
      });
    });
    document.documentElement.lang = language;
    const toggle = document.getElementById('languageToggle');
    if (toggle) {
      toggle.textContent = language === 'en' ? '中文 CN' : 'English ENG';
      toggle.lang = language === 'en' ? 'zh-CN' : 'en';
      toggle.setAttribute('aria-label', language === 'en' ? 'Switch to Chinese' : '切换到英文');
      toggle.title = language === 'en' ? 'Switch to Chinese' : '切换到英文';
    }
  }

  window.ForgeI18n = {
    t, translate,
    originalToast: (el) => originals.get(el)?.['data-toast-en'] ?? el.dataset.toast,
    get language() { return language; }
  };
  translate();
  document.getElementById('languageToggle')?.addEventListener('click', () => {
    language = language === 'en' ? 'zh-CN' : 'en';
    try { localStorage.setItem('forgeos:language', language); } catch (e) { /* ignore */ }
    translate();
    document.dispatchEvent(new CustomEvent('forgeos:languagechange'));
  });
})();
