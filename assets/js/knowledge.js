/* Browser-local learning library. Obsidian vault access and AI are not connected. */
(() => {
  'use strict';
  const KEY = 'forgeos:knowledge:v1';
  const $ = id => document.getElementById(id);
  const tr = (zh, en) => window.ForgeI18n.language === 'en' ? en : zh;
  const label = value => Array.isArray(value) ? tr(...value) : value;
  const subjects = [
    { id: 'math', name: ['数学', 'Mathematics'], description: ['从直觉到推导，把抽象概念慢慢拆开。', 'Build intuition. Make abstract ideas a little clearer.'], color: 'blue', symbol: '∑', sample: true },
    { id: 'english', name: ['英语', 'English'], description: ['积累表达，也练习把想法说清楚。', 'Find the words. Express your ideas with confidence.'], color: 'cyan', symbol: 'Aa', sample: true },
    { id: 'coding', name: ['编程', 'Programming'], description: ['理解原理，动手验证，让知识跑起来。', 'Understand the idea, then bring it to life in code.'], color: 'violet', symbol: '</>', sample: true }
  ];
  const sampleNotes = [
    { id: 'limits', subjectId: 'math', title: ['极限：无限接近的直觉', 'Limits: the idea of getting closer'], description: ['从 x 接近 2 时的函数变化，理解“接近”与“等于”的区别。', 'Use a simple function to explore the difference between approaching a value and being equal to it.'], content: ['## 先看一个例子\n当 f(x) = 2x，x 越接近 2，f(x) 就越接近 4。我们说 x 趋于 2 时，f(x) 的极限为 4。\n\n## 接近，不一定取到\n极限描述的是附近的变化趋势，不要求函数在那个点有定义。\n例如 (x² − 4) / (x − 2) 在 x = 2 处没有定义，但 x ≠ 2 时它等于 x + 2，因此 x 趋于 2 时极限为 4。\n\n## 想一想\n- 函数在一个点的值，与这个点附近的极限有什么区别？\n- 为什么左右两侧接近的结果都很重要？', '## Start with a simple function\nFor f(x) = 2x, as x gets closer to 2, f(x) gets closer to 4. The limit of f(x) as x approaches 2 is 4.\n\n## Approaching is not the same as arriving\nA limit describes nearby behavior. The function does not have to be defined at that point.\nFor example, (x² − 4) / (x − 2) is undefined at x = 2. For x ≠ 2, it equals x + 2, so its limit as x approaches 2 is 4.\n\n## Think it through\n- How does a function value differ from a limit?\n- Why do we look at both sides of the point?'], question: ['函数在某个点没有定义，还可能有极限吗？用一个例子说明。', 'Can a function have a limit at a point where it is undefined? Give an example.'] },
    { id: 'derivatives', subjectId: 'math', title: ['导数：变化有多快', 'Derivatives: how fast things change'], description: ['用平均变化率与切线斜率，建立导数的直观理解。', 'Connect average rates of change with the slope of a tangent.'], content: ['## 从平均到瞬时\n平均变化率是两点之间的变化量之比：(f(x + h) − f(x)) / h。\n当 h 趋于 0，若这个比值有极限，这个极限就是 f 在 x 处的导数。\n\n## 一个简单推导\n对于 f(x) = x²，差商为 ((x + h)² − x²) / h = 2x + h。\nh 趋于 0 时，结果为 2x，因此 f′(x) = 2x。\n\n## 几何直觉\n- 割线经过曲线上的两个点。\n- 两点无限接近时，割线趋向切线。\n- 导数描述切线斜率，也描述瞬时变化率。', '## From average to instantaneous\nThe average rate of change is (f(x + h) − f(x)) / h.\nIf this ratio has a limit as h approaches zero, that limit is the derivative at x.\n\n## A small derivation\nFor f(x) = x², the difference quotient is ((x + h)² − x²) / h = 2x + h.\nAs h approaches zero, this becomes 2x, so f′(x) = 2x.\n\n## The geometric picture\n- A secant passes through two points on a curve.\n- As the points move together, the secant approaches a tangent.\n- The derivative describes the tangent slope and the instantaneous rate of change.'], question: ['为什么 x² 的导数是 2x？试着从差商开始解释。', 'Why is the derivative of x² equal to 2x? Start with the difference quotient.'] },
    { id: 'vocabulary', subjectId: 'english', title: ['把单词放回语境', 'Learn vocabulary in context'], description: ['用搭配和例句记录词汇，再用自己的句子检验理解。', 'Collect useful combinations and examples, then make a sentence of your own.'], content: ['## 不只记一个翻译\n遇到新词时，记录它出现的句子、常见搭配，以及这个语境中的意思。\n例如 take a break 表示休息一下；这里不需要逐词翻译。\n\n## 一张词汇笔记\n- 表达：take a break\n- 例句：Let’s take a short break after this chapter.\n- 我的句子：I take a break after studying for an hour.\n\n## 回来复习时\n先遮住例句，看着中文场景说出英文表达，再和原句对照。', '## Go beyond a translation\nRecord the sentence, a useful word combination, and the meaning in context.\nFor example, learn take a break as a complete expression.\n\n## A vocabulary note\n- Expression: take a break\n- Example: Let’s take a short break after this chapter.\n- My sentence: I take a break after studying for an hour.\n\n## When you return\nHide the example. Recall the expression from a situation, then compare your sentence with the original.'], question: ['用 take a break 写一句与自己学习有关的英文句子。', 'Write a sentence about your study routine using take a break.'] },
    { id: 'reading', subjectId: 'english', title: ['阅读：先找文章的主线', 'Reading: find the main thread'], description: ['先概括每段的中心，再留意观点之间如何连接。', 'Summarize each paragraph, then look at how the ideas connect.'], content: ['## 第一遍：理解主线\n先读标题和各段的主题句，试着用一句话概括作者在讨论什么。\n\n## 第二遍：寻找证据\n- 作者提出了什么观点？\n- 哪些例子或事实支持这个观点？\n- however、therefore、for example 等连接词带来了什么变化？\n\n## 读完之后\n合上文章，用三句话写出主旨、一个支持理由和自己的疑问。', '## First pass: the main idea\nRead the title and topic sentences. Try to describe the author’s main subject in one sentence.\n\n## Second pass: the evidence\n- What claim does the author make?\n- Which examples or facts support it?\n- What do transitions such as however, therefore, and for example signal?\n\n## After reading\nClose the text. Write three sentences: the main idea, one supporting reason, and a question of your own.'], question: ['不看笔记，回忆阅读后可以写下哪三件事。', 'Without looking, recall the three things you can write after reading.'] },
    { id: 'closure', subjectId: 'coding', title: ['JavaScript 闭包的直觉', 'An intuition for JavaScript closures'], description: ['理解函数为什么还能访问创建它时所在作用域的变量。', 'Understand why a function can still access variables from the scope where it was created.'], content: ['## 函数记住了什么\n闭包让函数能够访问它定义时所在词法作用域中的变量，即使外层函数已经执行结束。\n\n```js\nfunction makeCounter() {\n  let count = 0;\n  return () => ++count;\n}\nconst next = makeCounter();\nnext(); // 1\nnext(); // 2\n```\n\n## 读懂例子\n返回的函数仍能访问 count，两次调用使用同一个变量。再次调用 makeCounter() 则会创建另一份独立的 count。\n\n## 动手试试\n创建两个计数器，交替调用，观察它们是否互相影响。', '## What does a function remember?\nA closure lets a function access variables in the lexical scope where it was defined, even after the outer function has finished.\n\n```js\nfunction makeCounter() {\n  let count = 0;\n  return () => ++count;\n}\nconst next = makeCounter();\nnext(); // 1\nnext(); // 2\n```\n\n## Read the example\nThe returned function can still access count. Both calls use the same variable. Calling makeCounter() again creates a separate count.\n\n## Try it\nCreate two counters and alternate their calls. Do they affect each other?'], question: ['为什么 next() 在 makeCounter() 结束之后，还能修改 count？', 'Why can next() still update count after makeCounter() has returned?'] },
    { id: 'async', subjectId: 'coding', title: ['async / await 与错误处理', 'async / await and error handling'], description: ['把异步步骤按顺序表达，并给失败留一个处理入口。', 'Express asynchronous steps in order and give failures a place to go.'], content: ['## 等待一个结果\nasync 函数返回 Promise。await 等待一个 Promise 完成，并把结果交给后续代码；它不会阻塞整个 JavaScript 线程。\n\n```js\nasync function loadNote(url) {\n  try {\n    const response = await fetch(url);\n    if (!response.ok) throw new Error("Load failed");\n    return await response.text();\n  } catch (error) {\n    console.error(error);\n    return null;\n  }\n}\n```\n\n## 留意失败\n- 网络错误会使 fetch 的 Promise 拒绝。\n- HTTP 错误状态仍需检查 response.ok。\n- try / catch 可以统一处理上面抛出的错误。', '## Wait for a result\nAn async function returns a Promise. await waits for a Promise to settle and passes its result to the next step; it does not block the entire JavaScript thread.\n\n```js\nasync function loadNote(url) {\n  try {\n    const response = await fetch(url);\n    if (!response.ok) throw new Error("Load failed");\n    return await response.text();\n  } catch (error) {\n    console.error(error);\n    return null;\n  }\n}\n```\n\n## Notice the failure cases\n- Network errors can reject the fetch Promise.\n- HTTP error statuses still require checking response.ok.\n- try / catch handles the errors thrown above.'], question: ['为什么使用 fetch 时，还要单独检查 response.ok？', 'Why should you check response.ok when using fetch?'] }
  ].map(note => ({ ...note, sample: true, createdAt: 0, learnedAt: null, reviewedAt: null, reviewCount: 0 }));
  const clone = value => JSON.parse(JSON.stringify(value));
  let state = { version: 1, subjects: clone(subjects), notes: clone(sampleNotes) };
  let readFailed = false, view = 'subjects', mode = 'learn', activeNoteId = null, readerMode = 'learn', revealed = false, lastQuery = '', importSequence = 0;
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
      if (data?.version !== 1 || !Array.isArray(data.subjects) || !data.subjects.length || data.subjects.length > 50 || !Array.isArray(data.notes) || data.notes.length > 200) throw new Error('Invalid library');
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
    } catch (error) { readFailed = true; tell('无法读取本地记录，当前展示示例。为保护原数据，本次不会覆盖保存。', 'Local records could not be read. Showing examples; saving is paused to protect existing data.', true); }
  }
  function commit(next, feedbackId = 'kbFeedback') {
    if (readFailed) { tell('原有记录无法读取，暂不能保存。请先备份并检查浏览器站点数据。', 'Existing records could not be read. Back up and check browser site data before saving.', true, feedbackId); return false; }
    try { localStorage.setItem(KEY, JSON.stringify(next)); state = next; return true; }
    catch (error) { tell('浏览器未能保存，输入内容已保留。请检查存储空间或浏览器权限。', 'The browser could not save. Your input is kept; check storage space or permissions.', true, feedbackId); return false; }
  }
  function setView(next, updateHash = true) {
    view = ['subjects', 'ask', 'documents'].includes(next) ? next : 'subjects';
    document.querySelectorAll('[data-view]').forEach(tab => { const selected = tab.dataset.view === view; tab.setAttribute('aria-selected', String(selected)); tab.tabIndex = selected ? 0 : -1; $(tab.dataset.view + 'Panel').hidden = !selected; });
    if (updateHash) history.replaceState(null, '', '#' + view);
  }
  function setMode(next) { mode = next; document.querySelectorAll('[data-study-mode]').forEach(node => node.setAttribute('aria-pressed', String(node.dataset.studyMode === mode))); renderSubjects(); }
  function renderSubjects() {
    const grid = $('subjectGrid'), query = $('subjectSearch').value.trim().toLocaleLowerCase(); grid.replaceChildren();
    const filtered = state.subjects.filter(subject => [subject.name, subject.description].flat().join(' ').toLocaleLowerCase().includes(query));
    for (const subject of filtered) {
      const notes = notesFor(subject.id), learned = notes.filter(note => note.learnedAt !== null).length;
      const card = button(undefined, () => {
        if (!notes.length) { setView('documents'); $('documentSubject').value = subject.id; $('documentTitle').focus(); tell('先为这个科目添加一份笔记吧。', 'Add the first note for this subject.'); return; }
        const ordered = notes.slice().sort((a, b) => mode === 'review' ? (a.reviewedAt || 0) - (b.reviewedAt || 0) : Number(a.learnedAt !== null) - Number(b.learnedAt !== null));
        openNote(ordered[0].id, mode);
      }, 'kb-subject-card');
      card.dataset.color = subject.color; card.dataset.subjectId = subject.id;
      const top = el('span', undefined, 'kb-subject-card-top'); top.append(el('span', subject.symbol, 'kb-subject-symbol'), el('span', subject.sample ? tr('示例科目', 'Example') : tr('我的科目', 'My subject'), 'kb-source-label'));
      const meta = el('span', undefined, 'kb-subject-meta'); meta.append(el('span', `${notes.length} ${tr('份笔记', 'notes')}`), el('span', `${learned}/${notes.length} ${tr('已学习', 'read')}`));
      const track = el('span', undefined, 'kb-progress-track'), fill = el('span'); fill.style.width = (notes.length ? learned / notes.length * 100 : 0) + '%'; track.append(fill); track.setAttribute('aria-hidden', 'true');
      const action = el('span', undefined, 'kb-subject-open'); action.append(el('span', !notes.length ? tr('添加第一份笔记', 'Add the first note') : mode === 'review' ? tr('开始复习', 'Start reviewing') : tr('开始学习', 'Start learning')), icon('arrow'));
      card.append(top, el('h3', label(subject.name)), el('p', label(subject.description)), meta, track, action); grid.append(card);
    }
    if (!filtered.length) empty(grid, tr('还没有这个科目', 'No matching subject'), tr('换一个关键词，或点击“添加科目”。', 'Try another keyword or add a subject.'));
  }
  function recentRow(note) {
    const row = button(undefined, () => openNote(note.id, 'learn'), 'kb-recent-row');
    const text = el('span'); text.append(el('strong', label(note.title)), el('small', `${label(subjectFor(note.subjectId).name)} · ${note.sample ? tr('示例笔记', 'Example note') : new Date(note.createdAt).toLocaleDateString(window.ForgeI18n.language === 'en' ? 'en-GB' : 'zh-CN', { month: 'short', day: 'numeric' })}`));
    row.append(icon('file'), text, icon('arrow')); return row;
  }
  function fillSubjects(select, all = false) {
    const previous = select.value; select.replaceChildren();
    if (all) { const option = el('option', tr('全部科目', 'All subjects')); option.value = ''; select.append(option); }
    state.subjects.forEach(subject => { const option = el('option', label(subject.name)); option.value = subject.id; select.append(option); });
    if (Array.from(select.options).some(option => option.value === previous)) select.value = previous;
  }
  function renderDocuments() {
    const sorted = state.notes.slice().sort((a, b) => b.createdAt - a.createdAt);
    $('documentCount').textContent = String(state.notes.length);
    $('recentNotes').replaceChildren(...sorted.slice(0, 3).map(recentRow));
    if (!sorted.length) empty($('recentNotes'), tr('第一份笔记，从这里开始', 'Your first note starts here'), tr('导入一份文档，让学习有迹可循。', 'Add a document to start your learning library.'));
    const filtered = sorted.filter(note => !$('documentFilter').value || note.subjectId === $('documentFilter').value);
    $('documentList').replaceChildren(...filtered.map(recentRow));
    if (!filtered.length) empty($('documentList'), tr('这里还没有笔记', 'No notes here yet'), tr('保存左侧的文档后，就会出现在这里。', 'Save a document and it will appear here.'));
  }
  function renderLibrary() {
    $('librarySummary').textContent = tr(`${state.subjects.length} 个科目 · ${state.notes.length} 份笔记`, `${state.subjects.length} subjects · ${state.notes.length} notes`);
    $('sidebarSubjectCount').textContent = String(state.subjects.length);
    fillSubjects($('documentSubject')); fillSubjects($('documentFilter'), true);
    renderSubjects(); renderDocuments();
    document.querySelectorAll('[data-kb-placeholder-en]').forEach(node => { node.dataset.kbPlaceholderZh ||= node.placeholder; node.placeholder = tr(node.dataset.kbPlaceholderZh, node.dataset.kbPlaceholderEn); });
    renderSuggestions(); if (lastQuery) renderResults();
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
    activeNoteId = id; readerMode = nextMode; revealed = false; $('readerFeedback').textContent = '';
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
    $('markLearned').textContent = readerMode === 'review' ? tr('完成这次复习 ✓', 'Complete this review ✓') : note.learnedAt !== null ? tr('已学习 ✓', 'Read ✓') : tr('标记已学习 ✓', 'Mark as read ✓');
    $('markLearned').disabled = readerMode === 'review' ? !revealed : note.learnedAt !== null;
    content.scrollTop = 0;
  }
  function searchNotes(query) {
    const stop = new Set(['what', 'how', 'the', 'is', 'a', 'do', 'to', 'of', 'in', 'i', 'can', 'my', 'me', 'are', 'does', 'and', 'with', 'about', 'it', 'for', 'notes', '什么', '怎么', '怎样', '如何', '理解', '笔记']);
    const tokens = (query.toLocaleLowerCase().match(/[a-z0-9]+|[\u3400-\u9fff]+/g) || []).flatMap(word => /^[\u3400-\u9fff]{3,}$/.test(word) ? Array.from({ length: word.length - 1 }, (_, index) => word.slice(index, index + 2)) : [word]).filter(word => !stop.has(word));
    return state.notes.map(note => {
      const title = [note.title, note.description, subjectFor(note.subjectId).name].flat().join(' ').toLocaleLowerCase();
      const body = [note.content].flat().join(' ').toLocaleLowerCase();
      return { note, score: Array.from(new Set(tokens)).reduce((sum, token) => sum + (title.includes(token) ? 4 : body.includes(token) ? 1 : 0), 0) };
    }).filter(result => result.score > 0).sort((a, b) => b.score - a.score).slice(0, 6).map(result => result.note);
  }
  function renderSuggestions() {
    const examples = [['怎样理解导数？', 'How do derivatives work?'], ['词汇怎么复习？', 'How can I review vocabulary?'], ['什么是闭包？', 'What is a closure?']];
    $('questionSuggestions').replaceChildren(...examples.map(example => button(tr(...example), () => { $('questionText').value = tr(...example); $('questionForm').requestSubmit(); })));
  }
  function renderResults() {
    const results = searchNotes(lastQuery), root = $('questionResults'); root.replaceChildren();
    if (!results.length) { empty(root, tr('暂时没找到相关笔记', 'No matching notes yet'), tr('试试更具体的关键词，或先添加一份相关文档。', 'Try a more specific keyword or add a relevant document.')); return; }
    root.append(el('p', tr(`找到 ${results.length} 份相关笔记，点击阅读原文。`, `Found ${results.length} related notes. Open one to read the source.`)));
    const grid = el('div', undefined, 'kb-result-grid');
    results.forEach(note => { const card = button(undefined, () => openNote(note.id, 'learn'), 'kb-panel kb-result-card'); card.append(el('span', label(subjectFor(note.subjectId).name), 'kb-eyebrow'), el('h3', label(note.title)), el('p', label(note.description) || label(note.content).slice(0, 160))); grid.append(card); }); root.append(grid);
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

  document.querySelectorAll('[data-view]').forEach(tab => tab.addEventListener('click', () => setView(tab.dataset.view)));
  document.querySelector('.kb-entry-tabs').addEventListener('keydown', event => {
    const tabs = Array.from(document.querySelectorAll('[data-view]')), current = tabs.indexOf(document.activeElement); if (current < 0 || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault(); const index = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (current + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    setView(tabs[index].dataset.view); tabs[index].focus();
  });
  document.querySelectorAll('[data-go-view]').forEach(node => node.addEventListener('click', () => setView(node.dataset.goView)));
  window.addEventListener('hashchange', () => setView(location.hash.slice(1), false));
  document.querySelectorAll('[data-study-mode]').forEach(node => node.addEventListener('click', () => setMode(node.dataset.studyMode)));
  $('subjectSearch').addEventListener('input', renderSubjects);
  $('reviewShortcut').addEventListener('click', () => { setMode('review'); $('subjectsPanel').scrollIntoView({ block: 'start', behavior: 'smooth' }); });
  $('documentFilter').addEventListener('change', renderDocuments);
  $('addSubject').addEventListener('click', () => { $('subjectForm').reset(); $('subjectFeedback').textContent = ''; $('subjectDialog').showModal(); $('subjectName').focus(); });
  document.querySelectorAll('[data-close-dialog]').forEach(node => node.addEventListener('click', () => $(node.dataset.closeDialog).close()));
  document.querySelectorAll('[data-open-connection]').forEach(node => node.addEventListener('click', () => $('connectionDialog').showModal()));
  $('connectionImport').addEventListener('click', () => { $('connectionDialog').close(); setView('documents'); $('documentTitle').focus(); });
  $('subjectForm').addEventListener('submit', event => {
    event.preventDefault(); const name = $('subjectName').value.trim(), description = $('subjectDescription').value.trim();
    if (!name) return;
    if (state.subjects.some(subject => [subject.name].flat().some(value => value.toLocaleLowerCase() === name.toLocaleLowerCase()))) { tell('这个科目已经存在。', 'This subject already exists.', true, 'subjectFeedback'); return; }
    if (state.subjects.length >= 50) { tell('当前最多支持 50 个科目。', 'This library supports up to 50 subjects.', true, 'subjectFeedback'); return; }
    const next = clone(state); next.subjects.push({ id: crypto.randomUUID(), name, description, color: $('subjectColor').value, symbol: '◇', sample: false });
    if (!commit(next, 'subjectFeedback')) return;
    $('subjectSearch').value = ''; $('subjectDialog').close(); renderLibrary(); tell('科目已添加，可以开始整理笔记了。', 'Subject added. It is ready for your notes.');
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
    if (!title || !content || !subjectFor(subjectId) || title.length > 120 || description.length > 500 || content.length > 50000) { tell('请填写有效标题、科目和笔记内容。', 'Enter a valid title, subject, and note content.', true); return; }
    if (state.notes.length >= 200) { tell('当前最多保存 200 份笔记，请先导出并整理已有文档。', 'The library holds up to 200 notes. Export and organize existing notes first.', true); return; }
    const next = clone(state); next.notes.unshift({ id: crypto.randomUUID(), subjectId, title, description, content, sample: false, createdAt: Date.now(), learnedAt: null, reviewedAt: null, reviewCount: 0 });
    if (!commit(next)) return;
    $('documentForm').reset(); $('documentSubject').value = subjectId; $('documentFilter').value = ''; $('fileFeedback').textContent = '';
    renderLibrary(); tell('文档已保存到当前浏览器，可在科目中学习或复习。', 'Document saved in this browser. Open its subject to learn or review.');
  });
  $('questionForm').addEventListener('submit', event => { event.preventDefault(); lastQuery = $('questionText').value.trim(); if (lastQuery) renderResults(); });
  document.querySelectorAll('[data-reader-mode]').forEach(node => node.addEventListener('click', () => { readerMode = node.dataset.readerMode; revealed = false; $('readerFeedback').textContent = ''; renderReader(); }));
  $('markLearned').addEventListener('click', () => {
    if (!noteFor(activeNoteId) || (readerMode === 'review' && !revealed)) return;
    const next = clone(state), note = next.notes.find(item => item.id === activeNoteId); note.learnedAt ||= Date.now();
    if (readerMode === 'review') { note.reviewedAt = Date.now(); note.reviewCount++; }
    if (!commit(next, 'readerFeedback')) return;
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
    $('readerDialog').close(); activeNoteId = null; renderLibrary(); tell('笔记已删除。', 'Note deleted.');
  });
  document.addEventListener('forgeos:languagechange', () => { renderLibrary(); if ($('readerDialog').open) renderReader(); if (!readFailed) $('kbFeedback').textContent = ''; });
  read(); renderLibrary(); setView(location.hash.slice(1), false);
})();
