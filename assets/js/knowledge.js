/* Local notes and conversations. Obsidian and AI connections are not enabled. */
(() => {
  'use strict';
  const KEY = 'forgeos:knowledge:v1';
  const $ = id => document.getElementById(id);
  const tr = (zh, en) => window.ForgeI18n.language === 'en' ? en : zh;
  const label = value => Array.isArray(value) ? tr(...value) : value;
  const clone = value => JSON.parse(JSON.stringify(value));
  let state = { version: 1, subjects: [], notes: [] };
  let readFailed = false, activeNoteId = null, readerMode = 'learn', revealed = false, reviewRecorded = false, importSequence = 0;
  const subjectFor = id => state.subjects.find(subject => subject.id === id);
  const noteFor = id => state.notes.find(note => note.id === id);
  const notesFor = id => state.notes.filter(note => note.subjectId === id);
  function el(tag, text, className) { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; if (className) node.className = className; return node; }
  function icon(name) { const node = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); node.setAttribute('class', 'template-icon'); node.setAttribute('aria-hidden', 'true'); const use = document.createElementNS(node.namespaceURI, 'use'); use.setAttribute('href', '#kb-' + name); node.append(use); return node; }
  function button(text, handler, className) { const node = el('button', text, className); node.type = 'button'; node.addEventListener('click', handler); return node; }
  function tell(zh, en, error = false, id = 'kbFeedback') { $(id).textContent = tr(zh, en); $(id).classList.toggle('error', error); }
  function empty(parent, title, copy) { const node = el('div', undefined, 'kb-empty'); node.append(el('strong', title), el('span', copy)); parent.append(node); }
  const validText = (value, max) => typeof value === 'string' && value.length <= max;
  const validLabel = (value, max) => validText(value, max) || (Array.isArray(value) && value.length === 2 && value.every(text => validText(text, max)));
  const timestamp = value => value === null || (Number.isFinite(value) && value >= 0);
  function read() {
    try {
      const raw = localStorage.getItem(KEY); if (!raw) return;
      const data = JSON.parse(raw);
      if (data?.version !== 1 || !Array.isArray(data.subjects) || data.subjects.length > 50 || !Array.isArray(data.notes) || data.notes.length > 200) throw new Error('Invalid library');
      const ids = new Set();
      for (const subject of data.subjects) {
        if (!validText(subject.id, 100) || !subject.id || ids.has(subject.id) || !validLabel(subject.name, 40) || !validLabel(subject.description, 140) || !['blue', 'cyan', 'violet'].includes(subject.color) || !validText(subject.symbol, 5) || typeof subject.sample !== 'boolean') throw new Error('Invalid subject');
        ids.add(subject.id);
      }
      const noteIds = new Set();
      for (const note of data.notes) {
        if (!validText(note.id, 100) || !note.id || noteIds.has(note.id) || !ids.has(note.subjectId) || !validLabel(note.title, 120) || !validLabel(note.description, 500) || !validLabel(note.content, 50000) || (note.question !== undefined && !validLabel(note.question, 500)) || typeof note.sample !== 'boolean' || !Number.isFinite(note.createdAt) || !timestamp(note.learnedAt) || !timestamp(note.reviewedAt) || !Number.isInteger(note.reviewCount) || note.reviewCount < 0) throw new Error('Invalid note');
        noteIds.add(note.id);
      }
      state = data;
    } catch (error) { readFailed = true; tell('无法读取本地记录，当前展示空白知识库。为保护原数据，本次不会覆盖保存。', 'Local records could not be read. Showing an empty library; saving is paused to protect existing data.', true); }
  }
  function commit(next, feedbackId = 'kbFeedback') {
    if (readFailed) { tell('原有记录无法读取，暂不能保存。请先备份并检查浏览器站点数据。', 'Existing records could not be read. Back up and check browser site data before saving.', true, feedbackId); return false; }
    try { localStorage.setItem(KEY, JSON.stringify(next)); state = next; return true; }
    catch (error) { tell('浏览器未能保存，输入内容已保留。请检查存储空间或浏览器权限。', 'The browser could not save. Your input is kept; check storage space or permissions.', true, feedbackId); return false; }
  }
  function recentRow(note) {
    const row = button(undefined, () => openNote(note.id, 'learn'), 'kb-recent-row');
    const text = el('span'); text.append(el('strong', label(note.title)), el('small', `${label(subjectFor(note.subjectId).name)} · ${note.sample ? tr('示例笔记', 'Example note') : new Date(note.createdAt).toLocaleDateString(window.ForgeI18n.language === 'en' ? 'en-GB' : 'zh-CN', { month: 'short', day: 'numeric' })}`));
    row.append(icon('file'), text, icon('arrow')); return row;
  }
  function fillSubjects(select, all = false) {
    const previous = select.value; select.replaceChildren();
    if (all) { const option = el('option', tr('全部科目', 'All subjects')); option.value = ''; select.append(option); }
    else if (!state.subjects.length) { const option = el('option', tr('请先添加一个科目', 'Add a subject first')); option.value = ''; option.disabled = true; option.selected = true; select.append(option); }
    state.subjects.forEach(subject => { const option = el('option', label(subject.name)); option.value = subject.id; select.append(option); });
    if (Array.from(select.options).some(option => option.value === previous)) select.value = previous;
  }
  function renderSubjects() {
    const root = $('subjectGrid'), query = $('subjectSearch').value.trim().toLocaleLowerCase(); root.replaceChildren();
    const subjects = state.subjects.filter(subject => [subject.name, subject.description].flat().join(' ').toLocaleLowerCase().includes(query));
    for (const subject of subjects) {
      const card = button(undefined, () => { $('chatSubject').value = subject.id; $('subjectsDialog').close(); $('chatInput').focus(); }, 'kb-subject-card');
      card.dataset.color = subject.color; card.dataset.subjectId = subject.id;
      card.append(el('span', subject.symbol, 'kb-subject-symbol'), el('h3', label(subject.name)), el('p', label(subject.description)), el('div', tr(notesFor(subject.id).length + ' 份笔记 · 选择此科目 →', notesFor(subject.id).length + ' notes · Choose subject →'), 'kb-subject-meta'));
      root.append(card);
    }
    if (!subjects.length) {
      if (query) empty(root, tr('没有找到这个科目', 'No matching subject'), tr('试试其他关键词。', 'Try another keyword.'));
      else {
        const welcome = el('div', undefined, 'kb-empty kb-first-subject');
        welcome.append(icon('book'), el('strong', tr('从你的第一个科目开始', 'Start with your first subject')), el('p', tr('科目由你自己添加，把想学的知识放在一起。', 'Add your own subjects to give your learning a home.')), button(tr('创建第一个科目 ＋', 'Create your first subject +'), () => $('addSubject').click(), 'kb-button'));
        root.append(welcome);
      }
    }
  }
  function renderDocuments() {
    $('documentCount').textContent = String(state.notes.length);
    const notes = state.notes.filter(note => !$('documentFilter').value || note.subjectId === $('documentFilter').value).sort((a, b) => b.createdAt - a.createdAt);
    $('documentList').replaceChildren(...notes.map(recentRow));
    if (!notes.length) empty($('documentList'), tr('这里还没有笔记', 'No notes here yet'), tr('添加一份文档，之后可以在对话中找到它。', 'Add a document to find it in your conversations.'));
  }
  function renderLibrary() {
    $('sidebarSubjectCount').textContent = String(state.subjects.length);
    $('sidebarNoteCount').textContent = String(state.notes.length);
    fillSubjects($('documentSubject')); fillSubjects($('documentFilter'), true); fillSubjects($('chatSubject'), true);
    $('chatSubject').options[0].textContent = tr('全部科目', 'All subjects');
    $('welcomeSubject').textContent = state.subjects.length ? tr('选择一个科目开始 →', 'Choose a subject to begin →') : tr('还没有科目？添加你的第一个科目 →', 'No subjects yet? Add your first one →');
    renderSubjects(); renderDocuments();
    document.querySelectorAll('[data-kb-placeholder-en]').forEach(node => { node.dataset.kbPlaceholderZh ||= node.placeholder; node.placeholder = tr(node.dataset.kbPlaceholderZh, node.dataset.kbPlaceholderEn); });
  }
  function renderMarkdown(text, parent) {
    const output = el('div', undefined, 'kb-markdown');
    let code = null, list = null;
    for (const line of text.split(/\r?\n/)) {
      if (/^\s*```/.test(line)) { if (code) { code = null; } else { code = el('pre', ''); output.append(code); } list = null; continue; }
      if (code) { code.textContent += line + '\n'; continue; }
      if (!line.trim()) { list = null; continue; }
      const heading = line.match(/^#{1,6}\s+(.+)$/), item = line.match(/^\s*[-*]\s+(.+)$/);
      if (heading) { output.append(el('h3', heading[1])); list = null; }
      else if (item) { if (!list) { list = el('ul'); output.append(list); } list.append(el('li', item[1])); }
      else { output.append(el('p', line)); list = null; }
    }
    parent.append(output);
  }
  function openNote(id, nextMode = 'learn') {
    if (!noteFor(id)) return;
    activeNoteId = id; readerMode = nextMode; revealed = false; reviewRecorded = false; $('readerFeedback').textContent = '';
    renderReader(); if (!$('readerDialog').open) $('readerDialog').showModal();
  }
  function renderReader() {
    const note = noteFor(activeNoteId); if (!note) return;
    $('readerTitle').textContent = label(note.title); $('readerSubject').textContent = label(subjectFor(note.subjectId).name);
    $('readerSource').textContent = note.sample ? tr('示例笔记', 'Example note') : tr('本机笔记', 'Local note');
    $('readerNotes').replaceChildren(...notesFor(note.subjectId).map(item => {
      const itemButton = button(label(item.title), () => openNote(item.id, readerMode)); itemButton.setAttribute('aria-current', String(item.id === activeNoteId)); return itemButton;
    }));
    document.querySelectorAll('[data-reader-mode]').forEach(node => node.setAttribute('aria-pressed', String(node.dataset.readerMode === readerMode)));
    const content = $('readerContent'); content.replaceChildren();
    if (readerMode === 'review') {
      const prompt = el('div', undefined, 'kb-review-prompt');
      prompt.append(icon('repeat'), el('p', tr('先回忆，再对照', 'Recall first. Then compare.'), 'kb-eyebrow'), el('h3', note.question ? label(note.question) : tr('这份笔记的核心观点是什么？试着用自己的话讲一遍。', 'What is the main idea of this note? Explain it in your own words.')), el('p', label(note.description), 'kb-muted'));
      if (!revealed) prompt.append(button(tr('翻开笔记，查看要点', 'Reveal the note'), () => { revealed = true; renderReader(); $('markLearned').focus({ preventScroll: true }); }, 'kb-button secondary'));
      content.append(prompt);
    } else if (label(note.description)) content.append(el('p', label(note.description), 'kb-reader-description'));
    if (readerMode === 'learn' || revealed) renderMarkdown(label(note.content), content);
    $('markLearned').textContent = readerMode === 'review' ? (reviewRecorded ? tr('复习已记录 ✓', 'Review recorded ✓') : tr('完成这次复习 ✓', 'Complete this review ✓')) : note.learnedAt !== null ? tr('已学习 ✓', 'Read ✓') : tr('标记已学习 ✓', 'Mark as read ✓');
    $('markLearned').disabled = readerMode === 'review' ? (!revealed || reviewRecorded) : note.learnedAt !== null;
    content.scrollTop = 0;
  }
  function searchNotes(query, subjectId = '') {
    const stop = new Set(['what', 'how', 'the', 'is', 'a', 'do', 'to', 'of', 'in', 'i', 'can', 'my', 'me', 'are', 'does', 'and', 'with', 'about', 'it', 'for', 'notes', '什么', '怎么', '怎样', '如何', '理解', '笔记']);
    const tokens = (query.toLocaleLowerCase().match(/[a-z0-9]+|[\u3400-\u9fff]+/g) || []).flatMap(word => /^[\u3400-\u9fff]{3,}$/.test(word) ? Array.from({ length: word.length - 1 }, (_, index) => word.slice(index, index + 2)) : [word]).filter(word => !stop.has(word));
    return state.notes.filter(note => !subjectId || note.subjectId === subjectId).map(note => {
      const title = [note.title, note.description, subjectFor(note.subjectId).name].flat().join(' ').toLocaleLowerCase();
      const body = [note.content].flat().join(' ').toLocaleLowerCase();
      return { note, score: Array.from(new Set(tokens)).reduce((sum, token) => sum + (title.includes(token) ? 4 : body.includes(token) ? 1 : 0), 0) };
    }).filter(result => result.score > 0).sort((a, b) => b.score - a.score).slice(0, 6).map(result => result.note);
  }

  async function importFile(file) {
    if (!file) return;
    const sequence = ++importSequence;
    const submit = $('documentForm').querySelector('button[type="submit"]'); submit.disabled = false;
    if (!/\.(md|markdown|txt)$/i.test(file.name) || file.size > 200 * 1024) { tell('请选择不超过 200 KB 的 Markdown 或 TXT 文件。', 'Choose a Markdown or TXT file no larger than 200 KB.', true, 'fileFeedback'); return; }
    submit.disabled = true;
    try {
      const text = await file.text(); if (sequence !== importSequence) return;
      if (!text.trim() || text.length > 50000 || text.includes('\0')) { tell('文件需要包含文本，且不超过 50,000 字。原输入已保留。', 'Use a text file with 1–50,000 characters. Your previous input is kept.', true, 'fileFeedback'); return; }
      $('documentContent').value = text; $('documentTitle').value = file.name.replace(/\.(md|markdown|txt)$/i, '').slice(0, 120);
      tell('已读入 ' + file.name + '，填写说明并保存即可。', 'Loaded ' + file.name + '. Add a description, then save.', false, 'fileFeedback');
    } catch (error) { if (sequence === importSequence) tell('无法读取这份文件，请重试。', 'This file could not be read. Please try again.', true, 'fileFeedback'); }
    finally { if (sequence === importSequence) submit.disabled = false; }
  }

  const CHAT_KEY = 'forgeos:knowledge-chats:v1';
  let conversations = { version: 1, activeId: null, chats: [] }, chatsReadFailed = false, renameId = null;
  const drafts = new Map();
  const activeChat = () => conversations.chats.find(chat => chat.id === conversations.activeId);
  function readChats() {
    try {
      const raw = localStorage.getItem(CHAT_KEY); if (!raw) return;
      const data = JSON.parse(raw);
      if (data?.version !== 1 || !Array.isArray(data.chats) || data.chats.length > 100 || !(data.activeId === null || validText(data.activeId, 100))) throw new Error('Invalid conversations');
      const ids = new Set();
      for (const chat of data.chats) {
        if (!validText(chat.id, 100) || !chat.id || ids.has(chat.id) || !validText(chat.title, 80) || !chat.title || !validText(chat.subjectId, 100) || !Number.isFinite(chat.updatedAt) || !Array.isArray(chat.messages) || chat.messages.length > 200) throw new Error('Invalid conversation');
        ids.add(chat.id);
        for (const message of chat.messages) {
          if (!['user', 'assistant'].includes(message.role) || !validText(message.subjectId, 100)) throw new Error('Invalid message');
          if (message.role === 'user' && !validText(message.content, 4000)) throw new Error('Invalid message text');
          if (message.role === 'assistant' && (!['matches', 'empty', 'missing'].includes(message.kind) || !['learn', 'review'].includes(message.mode) || !Array.isArray(message.sources) || message.sources.length > 6 || message.sources.some(source => !validText(source.id, 100) || !validText(source.title, 120)))) throw new Error('Invalid sources');
        }
      }
      if (data.activeId !== null && !ids.has(data.activeId)) throw new Error('Invalid active conversation');
      conversations = data;
    } catch (error) { chatsReadFailed = true; tell('无法读取历史对话，原记录已保留，暂不能保存新对话。', 'Conversation history could not be read. Existing data is kept; saving is paused.', true); }
  }
  function saveChats(next, feedbackId = 'kbFeedback') {
    if (chatsReadFailed) { tell('请先备份并检查浏览器中的历史对话记录。', 'Back up and check conversation data in this browser first.', true, feedbackId); return false; }
    try { localStorage.setItem(CHAT_KEY, JSON.stringify(next)); conversations = next; return true; }
    catch (error) { tell('对话未能保存，输入内容已保留。请检查浏览器存储空间。', 'The conversation could not be saved. Your draft is kept; check browser storage.', true, feedbackId); return false; }
  }
  function renderHistory() {
    const root = $('chatHistory'), query = $('historySearch').value.trim().toLocaleLowerCase(); root.replaceChildren();
    $('historyCount').textContent = String(conversations.chats.length);
    const chats = conversations.chats.filter(chat => chat.title.toLocaleLowerCase().includes(query) || chat.messages.some(message => message.role === 'user' && message.content.toLocaleLowerCase().includes(query))).slice().sort((a, b) => b.updatedAt - a.updatedAt);
    if (!chats.length) { root.append(el('p', query ? tr('没有匹配的对话。', 'No matching conversations.') : tr('还没有历史对话。\n从右侧发出第一条消息吧。', 'No conversations yet.\nStart with your first message.'), 'kb-history-empty')); return; }
    let previousGroup = '';
    for (const chat of chats) {
      const group = new Date(chat.updatedAt).toDateString() === new Date().toDateString() ? tr('今天', 'Today') : tr('更早', 'Earlier');
      if (group !== previousGroup) { root.append(el('h3', group, 'kb-history-group')); previousGroup = group; }
      const row = el('div', undefined, 'kb-history-item' + (chat.id === conversations.activeId ? ' is-active' : ''));
      row.dataset.chatId = chat.id;
      const open = button(chat.title, () => switchChat(chat.id), 'kb-history-open'); open.title = chat.title;
      if (chat.id === conversations.activeId) open.setAttribute('aria-current', 'true');
      const actions = el('span', undefined, 'kb-history-actions');
      const rename = button(undefined, () => { renameId = chat.id; $('renameInput').value = chat.title; $('renameFeedback').textContent = ''; $('renameDialog').showModal(); $('renameInput').focus(); }, 'kb-rename-chat');
      rename.append(icon('edit')); rename.setAttribute('aria-label', tr('重命名对话：', 'Rename conversation: ') + chat.title);
      const remove = button(undefined, () => deleteChat(chat.id), 'kb-delete-chat'); remove.append(icon('trash')); remove.setAttribute('aria-label', tr('删除对话：', 'Delete conversation: ') + chat.title);
      actions.append(rename, remove); row.append(open, actions); root.append(row);
    }
  }
  function renderMessages(scroll = false) {
    const chat = activeChat(), root = $('chatMessages');
    $('chatWelcome').hidden = Boolean(chat); root.hidden = !chat; root.replaceChildren();
    $('chatTitle').textContent = chat ? chat.title : tr('新对话', 'New conversation');
    for (const message of chat?.messages || []) {
      const article = el('article', undefined, 'kb-message ' + message.role);
      article.setAttribute('aria-label', message.role === 'user' ? tr('你', 'You') : tr('本地笔记检索', 'Local note search'));
      if (message.role === 'user') {
        article.append(el('p', message.content, 'kb-user-message'));
        const subject = subjectFor(message.subjectId);
        if (subject) article.append(el('span', label(subject.name), 'kb-message-subject'));
      } else {
        const name = el('div', undefined, 'kb-assistant-name'); name.append(icon('spark'), el('span', tr('知识库 · 本地检索', 'Library · Local search'))); article.append(name);
        const copy = message.kind === 'matches' ? tr('在你的笔记里找到了这些相关资料，点击即可查看。', 'Here are related notes from your library. Open one to read it.') : message.kind === 'empty' ? tr('这个范围里还没有笔记。先添加一份文档，下次就可以在这里找到它。', 'There are no notes in this scope yet. Add a document to find it here next time.') : tr('暂时没有找到相关笔记。试试更具体的关键词，或补充一份资料。', 'No related notes found. Try a more specific keyword or add a document.');
        article.append(el('p', copy, 'kb-assistant-copy'));
        message.sources.forEach(source => {
          const note = noteFor(source.id), card = button(undefined, () => openNote(source.id, message.mode), 'kb-chat-result');
          const body = el('span'); body.append(el('strong', note ? label(note.title) : source.title), el('small', note ? (label(note.description) || label(note.content).slice(0, 150)) : tr('这份笔记已从知识库移除', 'This note has been removed from the library')));
          card.append(icon('file'), body, icon('arrow')); card.disabled = !note; article.append(card);
        });
        if (message.kind !== 'matches') article.append(button(tr('添加文档 →', 'Add a document →'), () => openDocuments(), 'kb-text-button'));
        article.append(el('p', tr('AI 尚未连接，这里展示的是本地检索结果。', 'AI is not connected. These are local search results.'), 'kb-message-source'));
      }
      root.append(article);
    }
    if (scroll) $('chatScroll').scrollTop = $('chatScroll').scrollHeight;
  }
  function rememberDraft() { drafts.set(conversations.activeId || '', { content: $('chatInput').value, subjectId: $('chatSubject').value }); }
  function restoreDraft() {
    const draft = drafts.get(conversations.activeId || '');
    $('chatInput').value = draft?.content || ''; $('chatSubject').value = draft?.subjectId ?? activeChat()?.subjectId ?? '';
    if ($('chatSubject').selectedIndex < 0) $('chatSubject').value = '';
    sizeInput();
  }
  function switchChat(id) {
    rememberDraft();
    if (id !== conversations.activeId && !saveChats({ ...conversations, activeId: id })) return;
    restoreDraft(); renderHistory(); renderMessages(true); closeMobileSidebar(); $('chatInput').focus({ preventScroll: true });
  }
  function newChat() {
    rememberDraft();
    if (conversations.chats.length && !saveChats({ ...conversations, activeId: null })) return;
    conversations.activeId = null; restoreDraft(); renderHistory(); renderMessages(); $('chatScroll').scrollTop = 0;
    closeMobileSidebar(); $('chatInput').focus({ preventScroll: true });
  }
  function deleteChat(id) {
    const chat = conversations.chats.find(item => item.id === id);
    if (!chat || !confirm(tr('删除对话“' + chat.title + '”？笔记文档会保留。', 'Delete conversation “' + chat.title + '”? Your documents will be kept.'))) return;
    rememberDraft(); const next = clone(conversations); next.chats = next.chats.filter(item => item.id !== id);
    if (next.activeId === id) next.activeId = null;
    if (!saveChats(next)) return;
    drafts.delete(id); restoreDraft(); renderHistory(); renderMessages();
  }
  function sizeInput() {
    const input = $('chatInput'); input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 180) + 'px';
    $('sendMessage').disabled = !input.value.trim();
  }
  function sendMessage(event) {
    event.preventDefault(); const content = $('chatInput').value.trim(), subjectId = $('chatSubject').value;
    if (!content || content.length > 4000) return;
    if ((!activeChat() && conversations.chats.length >= 100) || (activeChat()?.messages.length >= 200)) { tell('当前最多保存 100 个对话，每个对话 100 轮。请整理历史记录或新建对话。', 'Up to 100 conversations and 100 exchanges each. Organize history or start a new conversation.', true); return; }
    if (readFailed) { tell('笔记数据暂时无法读取，原记录已保留。', 'Notes could not be read. Existing records are kept.', true); return; }
    const review = /复习|review|revisit/i.test(content);
    const scopedNotes = state.notes.filter(note => !subjectId || note.subjectId === subjectId);
    let matches = searchNotes(content, subjectId);
    if (!matches.length && review) matches = scopedNotes.slice().sort((a, b) => (a.reviewedAt || 0) - (b.reviewedAt || 0)).slice(0, 3);
    const next = clone(conversations); let chat = next.chats.find(item => item.id === next.activeId);
    if (!chat) { chat = { id: crypto.randomUUID(), title: content.replace(/\s+/g, ' ').slice(0, 80), subjectId, updatedAt: Date.now(), messages: [] }; next.chats.push(chat); next.activeId = chat.id; }
    chat.subjectId = subjectId; chat.updatedAt = Date.now();
    chat.messages.push({ role: 'user', content, subjectId }, { role: 'assistant', kind: matches.length ? 'matches' : scopedNotes.length ? 'missing' : 'empty', mode: review ? 'review' : 'learn', subjectId, sources: matches.map(note => ({ id: note.id, title: label(note.title) })) });
    const previousId = conversations.activeId || '';
    if (!saveChats(next)) return;
    drafts.delete(previousId); drafts.delete(chat.id); $('chatInput').value = ''; sizeInput(); $('kbFeedback').textContent = '';
    renderHistory(); renderMessages(true);
  }
  const mobile = matchMedia('(max-width: 760px)');
  function setSidebar(open) {
    const narrow = mobile.matches;
    document.body.classList.toggle('sidebar-open', narrow && open);
    document.body.classList.toggle('sidebar-collapsed', !narrow && !open);
    $('sidebarBackdrop').hidden = !(narrow && open);
    $('sidebarToggle').setAttribute('aria-expanded', String(open));
    $('chatSidebar').inert = !open; $('chatShell').inert = narrow && open;
    if (narrow && open) { $('chatSidebar').setAttribute('role', 'dialog'); $('chatSidebar').setAttribute('aria-modal', 'true'); $('sidebarClose').focus(); }
    else { $('chatSidebar').removeAttribute('role'); $('chatSidebar').removeAttribute('aria-modal'); }
  }
  function closeMobileSidebar() { if (mobile.matches && document.body.classList.contains('sidebar-open')) { setSidebar(false); $('sidebarToggle').focus(); } }
  function showDialog(id) { closeMobileSidebar(); if (!$(id).open) $(id).showModal(); }
  function openDocuments() {
    showDialog('documentsDialog');
    if (!$('documentSubject').value && $('chatSubject').value) $('documentSubject').value = $('chatSubject').value;
  }
  function handleHash() {
    if (location.hash === '#documents') openDocuments();
    else if (location.hash === '#subjects') showDialog('subjectsDialog');
  }
  $('subjectSearch').addEventListener('input', renderSubjects);
  $('documentFilter').addEventListener('change', renderDocuments);
  $('addSubject').addEventListener('click', () => { $('subjectForm').reset(); $('subjectFeedback').textContent = ''; showDialog('subjectDialog'); $('subjectName').focus(); });
  $('documentAddSubject').addEventListener('click', () => $('addSubject').click());
  document.querySelectorAll('[data-close-dialog]').forEach(node => node.addEventListener('click', () => $(node.dataset.closeDialog).close()));
  document.querySelectorAll('[data-open-connection]').forEach(node => node.addEventListener('click', () => showDialog('connectionDialog')));
  $('connectionImport').addEventListener('click', () => { $('connectionDialog').close(); openDocuments(); $('documentTitle').focus(); });
  $('subjectForm').addEventListener('submit', event => {
    event.preventDefault(); const name = $('subjectName').value.trim(), description = $('subjectDescription').value.trim();
    if (!name) return;
    if (state.subjects.some(subject => [subject.name].flat().some(value => value.toLocaleLowerCase() === name.toLocaleLowerCase()))) { tell('这个科目已经存在。', 'This subject already exists.', true, 'subjectFeedback'); return; }
    if (state.subjects.length >= 50) { tell('当前最多支持 50 个科目。', 'This library supports up to 50 subjects.', true, 'subjectFeedback'); return; }
    const next = clone(state), subjectId = crypto.randomUUID(); next.subjects.push({ id: subjectId, name, description, color: $('subjectColor').value, symbol: '◇', sample: false });
    if (!commit(next, 'subjectFeedback')) return;
    $('subjectSearch').value = ''; $('subjectDialog').close(); renderLibrary(); $('documentSubject').value = subjectId; $('chatSubject').value = subjectId; tell('科目已添加，可以开始整理笔记了。', 'Subject added. It is ready for your notes.');
  });
  $('documentFile').addEventListener('change', event => { importFile(event.target.files[0]); event.target.value = ''; });
  ['dragenter', 'dragover'].forEach(name => $('fileDrop').addEventListener(name, event => { event.preventDefault(); $('fileDrop').classList.add('is-dragging'); }));
  ['dragleave', 'drop'].forEach(name => $('fileDrop').addEventListener(name, event => { event.preventDefault(); $('fileDrop').classList.remove('is-dragging'); }));
  $('fileDrop').addEventListener('drop', event => {
    if (event.dataTransfer.files.length > 1) { tell('请一次导入一份文档。', 'Please import one document at a time.', true, 'fileFeedback'); return; }
    importFile(event.dataTransfer.files[0]);
  });
  $('documentForm').addEventListener('submit', event => {
    event.preventDefault(); const title = $('documentTitle').value.trim(), description = $('documentDescription').value.trim(), content = $('documentContent').value.trim(), subjectId = $('documentSubject').value;
    if (!title || !content || !subjectFor(subjectId) || title.length > 120 || description.length > 500 || content.length > 50000) { tell('请填写有效标题、科目和笔记内容。', 'Enter a valid title, subject, and note content.', true, 'documentFeedback'); return; }
    if (state.notes.length >= 200) { tell('当前最多保存 200 份笔记，请先导出并整理已有文档。', 'The library holds up to 200 notes. Export and organize existing notes first.', true, 'documentFeedback'); return; }
    const next = clone(state); next.notes.unshift({ id: crypto.randomUUID(), subjectId, title, description, content, sample: false, createdAt: Date.now(), learnedAt: null, reviewedAt: null, reviewCount: 0 });
    if (!commit(next, 'documentFeedback')) return;
    $('documentForm').reset(); $('documentSubject').value = subjectId; $('documentFilter').value = ''; $('fileFeedback').textContent = '';
    renderLibrary(); renderMessages(); tell('文档已保存到当前浏览器，可在科目中学习或复习。', 'Document saved in this browser. Find it in a conversation or open it on the right.', false, 'documentFeedback');
  });
  document.querySelectorAll('[data-reader-mode]').forEach(node => node.addEventListener('click', () => { readerMode = node.dataset.readerMode; revealed = false; reviewRecorded = false; $('readerFeedback').textContent = ''; renderReader(); }));
  $('markLearned').addEventListener('click', () => {
    if (!noteFor(activeNoteId) || (readerMode === 'review' && (!revealed || reviewRecorded))) return;
    const next = clone(state), note = next.notes.find(item => item.id === activeNoteId); note.learnedAt ||= Date.now();
    if (readerMode === 'review') { note.reviewedAt = Date.now(); note.reviewCount++; }
    if (!commit(next, 'readerFeedback')) return;
    if (readerMode === 'review') reviewRecorded = true;
    renderLibrary(); renderReader(); tell(readerMode === 'review' ? '这次复习已记录，下次也记得回来看看。' : '已标记为学过，随时可以再复习。', readerMode === 'review' ? 'Review recorded. Come back to it again.' : 'Marked as read. You can revisit it anytime.', false, 'readerFeedback');
    if (readerMode === 'review') $('markLearned').disabled = true;
  });
  $('exportNote').addEventListener('click', () => {
    const note = noteFor(activeNoteId); if (!note) return;
    const text = '# ' + label(note.title) + '\n\n' + (label(note.description) ? '> ' + label(note.description).replace(/\n/g, '\n> ') + '\n\n' : '') + label(note.content) + '\n';
    const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown;charset=utf-8' }));
    const link = el('a'); link.href = url; link.download = (label(note.title).replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').replace(/[. ]+$/, '').slice(0, 100) || 'note') + '.md'; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  $('deleteNote').addEventListener('click', () => {
    const note = noteFor(activeNoteId); if (!note || !window.confirm(tr(`删除“${label(note.title)}”？这只影响当前浏览器中的笔记。`, `Delete “${label(note.title)}”? This only affects the note in this browser.`))) return;
    const next = clone(state); next.notes = next.notes.filter(item => item.id !== note.id);
    if (!commit(next, 'readerFeedback')) return;
    $('readerDialog').close(); activeNoteId = null; renderLibrary(); renderMessages(); tell('笔记已删除。', 'Note deleted.');
  });

  $('newChat').addEventListener('click', newChat);
  $('historySearch').addEventListener('input', renderHistory);
  $('chatForm').addEventListener('submit', sendMessage);
  $('chatInput').addEventListener('input', sizeInput);
  $('chatInput').addEventListener('keydown', event => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing && event.keyCode !== 229) { event.preventDefault(); if ($('chatInput').value.trim()) $('chatForm').requestSubmit(); }
  });
  $('openSubjects').addEventListener('click', () => showDialog('subjectsDialog'));
  $('welcomeSubject').addEventListener('click', () => state.subjects.length ? showDialog('subjectsDialog') : $('addSubject').click());
  ['openDocuments', 'welcomeDocuments', 'attachDocument'].forEach(id => $(id).addEventListener('click', openDocuments));
  document.querySelectorAll('[data-prompt]').forEach(node => node.addEventListener('click', () => {
    $('chatInput').value = node.dataset.prompt === 'review' ? tr('帮我复习这个科目的笔记', 'Help me review the notes for this subject') : tr('我想学习：', 'I would like to learn about: ');
    sizeInput(); $('chatInput').focus();
  }));
  $('renameForm').addEventListener('submit', event => {
    event.preventDefault(); const title = $('renameInput').value.trim(); if (!title) return;
    const next = clone(conversations), chat = next.chats.find(item => item.id === renameId); if (!chat) return;
    chat.title = title; if (!saveChats(next, 'renameFeedback')) return;
    $('renameDialog').close(); renderHistory(); renderMessages();
  });
  $('sidebarToggle').addEventListener('click', () => setSidebar($('sidebarToggle').getAttribute('aria-expanded') !== 'true'));
  ['sidebarClose', 'sidebarBackdrop'].forEach(id => $(id).addEventListener('click', () => { setSidebar(false); $('sidebarToggle').focus(); }));
  mobile.addEventListener('change', () => setSidebar(!mobile.matches));
  document.addEventListener('keydown', event => {
    if (!mobile.matches || !document.body.classList.contains('sidebar-open') || document.querySelector('dialog[open]')) return;
    if (event.key === 'Escape') { event.preventDefault(); closeMobileSidebar(); }
    if (event.key === 'Tab') {
      const focusable = [...$('chatSidebar').querySelectorAll('a, button, input')].filter(node => !node.disabled && node.getClientRects().length);
      const first = focusable[0], last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  });
  window.addEventListener('hashchange', handleHash);
  ['subjectsDialog', 'documentsDialog'].forEach(id => $(id).addEventListener('close', () => { if (location.hash === '#' + id.replace('Dialog', '')) history.replaceState(null, '', location.pathname + location.search); }));
  document.addEventListener('forgeos:languagechange', () => { renderLibrary(); renderHistory(); renderMessages(); if ($('readerDialog').open) renderReader(); sizeInput(); });
  read(); readChats(); renderLibrary(); renderHistory(); renderMessages(true); restoreDraft(); setSidebar(!mobile.matches); handleHash();
  document.documentElement.dataset.knowledgeReady = 'true';
})();
