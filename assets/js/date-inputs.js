/* Localized calendar fields: canonical ISO values remain available to the planner. */
(() => {
  'use strict';
  const tr = (zh, en) => window.ForgeI18n.language === 'en' ? en : zh;
  const locale = () => window.ForgeI18n.language === 'en' ? 'en-GB' : 'zh-CN';
  const pad = n => String(n).padStart(2, '0');
  const dateKey = d => String(d.getFullYear()).padStart(4, '0') + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const nativeValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
  const fields = [];
  let active = null, draft, month;
  function parse(value, withTime) {
    const match = (withTime ? /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})$/ : /^(\d{4})-(\d{2})-(\d{2})$/).exec(value);
    if (!match) return null;
    const [, y, m, d, h = '0', minute = '0'] = match;
    const date = new Date(0);
    date.setFullYear(Number(y), Number(m) - 1, Number(d)); date.setHours(Number(h), Number(minute), 0, 0);
    return Number(y) >= 1 && date.getFullYear() === Number(y) && date.getMonth() === Number(m) - 1 &&
      date.getDate() === Number(d) && date.getHours() === Number(h) && date.getMinutes() === Number(minute) ? date : null;
  }
  function canonical(date, withTime) { return dateKey(date) + (withTime ? 'T' + pad(date.getHours()) + ':' + pad(date.getMinutes()) : ''); }
  function node(tag, text, className) {
    const el = document.createElement(tag);
    if (text !== undefined) el.textContent = text;
    if (className) el.className = className;
    return el;
  }
  function button(text, action, className) {
    const el = node('button', text, className);
    el.type = 'button'; el.addEventListener('click', action); return el;
  }
  const popup = node('div', undefined, 'forge-date-popup');
  popup.id = 'forgeDatePicker'; popup.hidden = true; popup.setAttribute('role', 'dialog');
  popup.setAttribute('aria-labelledby', 'forgeDateMonth'); document.body.append(popup);
  function validate(field) {
    const { input, display, withTime } = field;
    let error = '';
    if (!display.value.trim()) { if (input.required) error = tr('请选择日期' + (withTime ? '和时间。' : '。'), 'Choose a date' + (withTime ? ' and time.' : '.')); }
    else if (!parse(display.value, withTime)) error = tr('请输入有效日期，格式为 ', 'Enter a valid date using ') + (withTime ? 'YYYY-MM-DD HH:mm' : 'YYYY-MM-DD') + '.';
    else if ((input.min && input.value < input.min) || (input.max && input.value > input.max)) error = tr('请选择允许范围内的日期。', 'Choose a date within the allowed range.');
    display.setCustomValidity(error);
  }
  function sync(field) {
    field.display.value = field.input.value.replace('T', ' ');
    field.display.disabled = field.input.disabled;
    field.display.required = field.input.required;
    field.display.readOnly = field.input.readOnly;
    field.toggle.disabled = field.input.disabled || field.input.readOnly;
    validate(field);
  }
  function setValue(value) {
    const field = active;
    field.input.value = value;
    field.input.dispatchEvent(new Event('input', { bubbles: true }));
    field.input.dispatchEvent(new Event('change', { bubbles: true }));
  }
  function close(focus = false) {
    if (!active) return;
    const previous = active; active = null; popup.hidden = true;
    previous.toggle.setAttribute('aria-expanded', 'false');
    if (focus) previous.display.focus();
  }
  function position() {
    if (!active) return;
    const rect = active.wrapper.getBoundingClientRect(), box = popup.getBoundingClientRect();
    popup.style.left = Math.max(8, Math.min(rect.left, innerWidth - box.width - 8)) + 'px';
    const below = rect.bottom + 6;
    popup.style.top = Math.max(8, Math.min(below + box.height <= innerHeight - 8 ? below : rect.top - box.height - 6, innerHeight - box.height - 8)) + 'px';
  }
  function open(field) {
    if (field.display.matches(':disabled') || field.display.readOnly) return;
    if (active) close();
    active = field;
    draft = parse(field.input.value, field.withTime) || new Date();
    draft.setSeconds(0, 0);
    month = new Date(draft.getFullYear(), draft.getMonth(), 1);
    popup.hidden = false; field.toggle.setAttribute('aria-expanded', 'true'); render();
    popup.querySelector('[tabindex="0"]')?.focus();
  }
  function moveMonth(delta) { month.setMonth(month.getMonth() + delta); render(); }
  function render() {
    if (!active) return;
    popup.lang = window.ForgeI18n.language;
    popup.replaceChildren();
    const heading = node('div', undefined, 'forge-date-heading');
    const previous = button('‹', () => moveMonth(-1)); previous.setAttribute('aria-label', tr('上个月', 'Previous month'));
    const next = button('›', () => moveMonth(1)); next.setAttribute('aria-label', tr('下个月', 'Next month'));
    const title = node('strong', month.toLocaleDateString(locale(), { year: 'numeric', month: 'long' }));
    title.id = 'forgeDateMonth'; title.setAttribute('aria-live', 'polite');
    heading.append(previous, title, next); popup.append(heading);
    const grid = node('div', undefined, 'forge-date-grid'); grid.setAttribute('role', 'group');
    grid.setAttribute('aria-label', tr('选择日期', 'Choose a date'));
    for (let i = 0; i < 7; i++) grid.append(node('span', new Date(2024, 0, 1 + i).toLocaleDateString(locale(), { weekday: 'short' }), 'forge-date-weekday'));
    const offset = (month.getDay() + 6) % 7;
    for (let i = 0; i < offset; i++) grid.append(node('span'));
    const last = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
    for (let day = 1; day <= last; day++) {
      const date = new Date(month.getFullYear(), month.getMonth(), day);
      const key = dateKey(date), chosen = key === dateKey(draft);
      const el = button(String(day), () => {
        draft.setFullYear(date.getFullYear(), date.getMonth(), day);
        if (!active.withTime) { setValue(canonical(draft, false)); close(true); }
        else { render(); popup.querySelector('[data-date="' + key + '"]')?.focus(); }
      }, 'forge-date-day');
      el.dataset.date = key; el.tabIndex = chosen || (day === 1 && (draft.getMonth() !== month.getMonth() || draft.getFullYear() !== month.getFullYear())) ? 0 : -1;
      el.setAttribute('aria-label', date.toLocaleDateString(locale(), { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }));
      el.setAttribute('aria-pressed', String(chosen));
      if (key === dateKey(new Date())) el.setAttribute('aria-current', 'date');
      el.addEventListener('keydown', event => {
        const delta = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[event.key];
        if (delta === undefined) return;
        event.preventDefault(); date.setDate(date.getDate() + delta);
        draft.setFullYear(date.getFullYear(), date.getMonth(), date.getDate());
        month = new Date(date.getFullYear(), date.getMonth(), 1); render();
        popup.querySelector('[data-date="' + dateKey(date) + '"]')?.focus();
      });
      grid.append(el);
    }
    popup.append(grid);
    if (active.withTime) {
      const row = node('div', undefined, 'forge-date-time');
      for (const [part, max, value, caption] of [
        ['hour', 23, draft.getHours(), tr('小时', 'Hour')], ['minute', 59, draft.getMinutes(), tr('分钟', 'Minute')]
      ]) {
        const label = node('label', caption), control = node('input');
        control.type = 'number'; control.min = '0'; control.max = String(max); control.step = '1';
        control.value = pad(value); control.required = true; control.dataset.timePart = part;
        control.addEventListener('input', () => {
          const number = Number(control.value);
          const valid = control.value !== '' && Number.isInteger(number) && number >= 0 && number <= max;
          control.setCustomValidity(valid ? '' : tr('请输入 ', 'Enter ') + '0–' + max + '.');
          if (valid) { if (part === 'hour') draft.setHours(number); else draft.setMinutes(number); }
        });
        label.append(control); row.append(label);
      }
      popup.append(row);
    }
    const footer = node('div', undefined, 'forge-date-actions');
    footer.append(
      button(tr('清空', 'Clear'), () => { setValue(''); close(true); }),
      button(tr('今天', 'Today'), () => {
        const today = new Date(); draft.setFullYear(today.getFullYear(), today.getMonth(), today.getDate());
        month = new Date(today.getFullYear(), today.getMonth(), 1); render();
      }),
      button(tr('完成', 'Done'), () => {
        for (const control of popup.querySelectorAll('input')) if (!control.reportValidity()) return;
        setValue(canonical(draft, active.withTime)); close(true);
      }, 'forge-date-done')
    );
    popup.append(footer); position();
  }
  document.querySelectorAll('input[type="date"], input[type="datetime-local"]').forEach(input => {
    const withTime = input.type === 'datetime-local', value = input.value, defaultValue = input.defaultValue;
    const wrapper = node('div', undefined, 'forge-date-field');
    const display = node('input');
    display.type = 'text'; display.id = input.id + 'Display'; display.autocomplete = 'off';
    const toggle = button('', () => active?.input === input ? close(true) : open(field), 'forge-date-toggle');
    toggle.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M7 3v5m10-5v5M3 11h18"/></svg>';
    toggle.setAttribute('aria-haspopup', 'dialog'); toggle.setAttribute('aria-controls', popup.id); toggle.setAttribute('aria-expanded', 'false');
    input.before(wrapper); wrapper.append(display, toggle, input);
    input.type = 'hidden'; input.dataset.dateSource = withTime ? 'datetime-local' : 'date';
    for (const label of document.querySelectorAll('label[for="' + input.id + '"]')) label.htmlFor = display.id;
    const field = { input, display, toggle, wrapper, withTime }; fields.push(field);
    // Preserve input.value assignments made by task extraction, draft restore,
    // edits and form resets; never change the planner's ISO date contract.
    Object.defineProperty(input, 'value', {
      configurable: true, get() { return nativeValue.get.call(input); },
      set(next) { nativeValue.set.call(input, next); sync(field); }
    });
    input.value = value;
    display.addEventListener('input', () => {
      const parsed = parse(display.value, withTime);
      nativeValue.set.call(input, parsed ? canonical(parsed, withTime) : '');
      validate(field); input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    display.addEventListener('change', () => {
      if (parse(display.value, withTime)) sync(field);
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    display.addEventListener('keydown', event => {
      if (event.key === 'ArrowDown' && event.altKey) { event.preventDefault(); open(field); }
    });
    new MutationObserver(() => sync(field)).observe(input, { attributes: true, attributeFilter: ['disabled', 'required', 'readonly', 'min', 'max'] });
    input.form?.addEventListener('reset', event => {
      if (event.defaultPrevented) return;
      input.value = defaultValue;
      queueMicrotask(() => sync(field));
    });
  });
  function translate() {
    for (const field of fields) {
      field.display.lang = window.ForgeI18n.language;
      field.display.placeholder = field.withTime ? tr('年-月-日 时:分', 'YYYY-MM-DD HH:mm') : tr('年-月-日', 'YYYY-MM-DD');
      field.toggle.setAttribute('aria-label', field.withTime ? tr('选择日期和时间', 'Choose date and time') : tr('选择日期', 'Choose date'));
      validate(field);
    }
    if (active) render();
  }
  document.addEventListener('forgeos:languagechange', translate);
  document.addEventListener('pointerdown', event => {
    if (active && !active.wrapper.contains(event.target) && !popup.contains(event.target)) close();
  });
  document.addEventListener('keydown', event => {
    if (active && event.key === 'Escape') { event.preventDefault(); close(true); }
  });
  window.addEventListener('resize', position);
  window.addEventListener('scroll', position, true);
  translate();
})();
