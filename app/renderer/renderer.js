'use strict';
const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const api = window.logscope;
const RESULT_ROW_HEIGHT = 84;
const FILE_RESULT_ROW_HEIGHT = 35;
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const paths = {
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/>',
  box: '<path d="m12 3 9 5v9l-9 5-9-5V8zM3 8l9 5 9-5M12 13v9M7.5 5.5l9 5"/>',
  layers: '<path d="m12 3 10 5-10 5L2 8zM2 12l10 5 10-5M2 16l10 5 10-5"/>',
  'folder-plus': '<path d="M3 7V5h7l2 3h9v12H3V7zM12 11v6M9 14h6"/>',
  'file-plus': '<path d="M14 2H5v20h14V7zM14 2v5h5M12 11v6M9 14h6"/>',
  file: '<path d="M14 2H5v20h14V7zM14 2v5h5M8 12h8M8 16h6"/>',
  more: '<circle cx="4" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="20" cy="12" r="1"/>',
  upload: '<path d="M12 16V3m-5 5 5-5 5 5M4 16v5h16v-5"/>',
  plus: '<path d="M12 4v16M4 12h16"/>',
  bookmark: '<path d="M6 3h12v19l-6-5-6 5z"/>',
  keyboard: '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M5 9h1m3 0h1m3 0h1m3 0h1M5 12h1m3 0h1m3 0h1m3 0h1M7 16h10"/>',
  history: '<path d="M3 11a9 9 0 1 1 2 7M3 5v6h6M12 7v6l4 2"/>',
  download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
  'arrow-right': '<path d="M4 12h16m-6-6 6 6-6 6"/>',
  sliders: '<path d="M4 6h6m4 0h6M4 18h6m4 0h6M4 12h2m4 0h10"/><circle cx="12" cy="6" r="2"/><circle cx="8" cy="12" r="2"/><circle cx="12" cy="18" r="2"/>',
  'chevron-down': '<path d="m6 9 6 6 6-6"/>',
  'chevron-up': '<path d="m6 15 6-6 6 6"/>',
  rotate: '<path d="M3 10a9 9 0 1 1 2 8M3 4v6h6"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.1M3 12h.1M3 18h.1"/>',
  sort: '<path d="M4 5v15m-3-3 3 3 3-3M10 5h11M10 10h8M10 15h5"/>',
  terminal: '<rect x="2" y="3" width="20" height="18" rx="3"/><path d="m6 8 4 4-4 4M13 16h5"/>',
  external: '<path d="M14 3h7v7M21 3l-11 11M10 3H3v18h18v-7"/>',
  filter: '<path d="M3 4h18l-7 8v7l-4 2v-9z"/>',
  wrap: '<path d="M3 6h18M3 11h14a4 4 0 0 1 0 8h-5m3-3-3 3 3 3M3 16h4"/>',
  highlighter: '<path d="m15 3 6 6-10 10-6-6zM5 13l-3 6 3 3 6-3M2 22h10"/>',
  copy: '<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V3H3v13h5"/>',
  shield: '<path d="m12 2 9 4v6c0 5-9 10-9 10S3 17 3 12V6zM8 12l3 3 5-6"/>',
  command: '<path d="M9 9h6v6H9zM9 9V5a3 3 0 1 0-3 3h3M15 9V5a3 3 0 1 1 3 3h-3M9 15v4a3 3 0 1 1-3-3h3M15 15v4a3 3 0 1 0 3-3h-3"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  check: '<path d="m5 12 4 4L19 6"/>'
};
const icon = name => `<svg viewBox="0 0 24 24" aria-hidden="true">${paths[name] || paths.file}</svg>`;
function hydrateIcons(root = document) { root.querySelectorAll('[data-icon]').forEach(node => { node.innerHTML = icon(node.dataset.icon); }); }
hydrateIcons();

function stored(key, fallback) { try { return JSON.parse(localStorage.getItem(`logscope.${key}`)) ?? fallback; } catch { return fallback; } }
function store(key, value) { try { localStorage.setItem(`logscope.${key}`, JSON.stringify(value)); } catch { /* storage unavailable */ } }
const state = {
  files: [], selectedFiles: new Set(), rows: [], selectedResult: -1, searching: false, requestId: null,
  levels: new Set(), caseSensitive: false, wholeWord: false, regex: false, demo: false,
  lastOptions: null, sortNewest: false, tabs: [], activeFile: null, currentLine: 1,
  viewer: null, viewerLoading: false, viewerRead: 0, viewerMatches: [], viewerRequest: null, viewerMatchIndex: -1,
  viewerRegex: false, viewerFinding: false, matchesOnly: false, wrap: false, tail: false,
  bookmarks: stored('bookmarks', []), saved: stored('saved', []), history: stored('history', []),
  highlightTerms: stored('highlights', ['timeout', 'trace_id', 'payment-db']),
  resultFrame: 0, viewerFrame: 0, booting: true, showDetail: false, matchPage: 0,
  fontSize: Math.min(17, Math.max(10, stored('fontSize', 11))),
  workspace: 'results', resultsScroll: 0, viewerScroll: 0, fileResultsScroll: 0, fileResultsOpen: false, fileResultsFrame: 0,
  viewerCase: false, viewerMode: 'literal', viewerFindSummary: null, viewerFindSignature: '', viewerFindProgress: 0
};

function toast(message, error = false) {
  const element = document.createElement('div');
  element.className = `toast${error ? ' error' : ''}`;
  element.textContent = message;
  $('#toast-container').append(element);
  setTimeout(() => element.remove(), error ? 6500 : 3500);
}
function errorMessage(error) { return String(error?.message || error).replace(/^Error invoking remote method '[^']+': Error: /, ''); }
async function safely(fn) { try { return await fn(); } catch (error) { toast(errorMessage(error), true); } }
function formatSize(bytes) { return bytes < 1024 ? `${bytes} B` : bytes < 1048576 ? `${(bytes / 1024).toFixed(1)} KB` : bytes < 1073741824 ? `${(bytes / 1048576).toFixed(1)} MB` : `${(bytes / 1073741824).toFixed(2)} GB`; }
const number = value => Number(value || 0).toLocaleString('ko-KR');
function setStatus(value) { $('#status-text').textContent = value; }
function emptyState(name, title, description, action = '') { return `<div class="empty-state"><div class="empty-illustration">${icon(name)}</div><strong>${esc(title)}</strong><p>${esc(description)}</p>${action}</div>`; }

function renderFiles() {
  const filter = $('#file-filter').value.trim().toLowerCase();
  const visible = state.files.filter(file => file.relativePath.toLowerCase().includes(filter));
  $('#file-count').textContent = state.files.length;
  $('#file-list').innerHTML = visible.length ? visible.map(file => `<div class="file-item${state.activeFile === file.id ? ' active' : ''}" data-id="${file.id}"><input type="checkbox" aria-label="${esc(file.name)} 검색에 포함" ${state.selectedFiles.has(file.id) ? 'checked' : ''}><span class="file-icon">${icon('file')}</span><button class="file-open" title="${esc(file.path)}"><span class="file-name">${esc(file.name)}</span><span class="file-meta">${formatSize(file.size)} · ${esc(file.name.split('.').pop().toUpperCase())}</span></button><button class="file-remove" title="목록에서 제거" aria-label="${esc(file.name)} 목록에서 제거">${icon('close')}</button></div>`).join('') : `<div class="saved-empty">${state.files.length ? '일치하는 파일이 없습니다.' : '폴더 또는 파일을 추가하세요.'}</div>`;
  $('#status-files').textContent = `${number(state.files.length)} files · ${formatSize(state.files.reduce((sum, file) => sum + file.size, 0))}`;
  $('#demo-badge').hidden = !state.demo;
  $('#workspace-title').textContent = state.demo ? '샘플 워크스페이스' : '내 워크스페이스';
  updateScope();
}
function updateScope() {
  $('#scope-label').textContent = `${number(state.selectedFiles.size)}개 파일 · ${state.selectedFiles.size === state.files.length ? '전체 범위' : '선택한 범위'}`;
  $('#select-all-files').textContent = state.selectedFiles.size === state.files.length && state.files.length ? '선택 해제' : '전체 선택';
  $('#remove-selected-count').textContent = number(state.selectedFiles.size);
  $('#remove-selected').disabled = !state.selectedFiles.size;
}

function switchWorkspace(workspace, focus = false) {
  if (state.workspace === 'results' && workspace !== 'results') state.resultsScroll = $('#results-list').scrollTop;
  if (state.workspace === 'viewer' && workspace !== 'viewer') { state.viewerScroll = $('#viewer-content').scrollTop; state.fileResultsScroll = $('#file-results-list').scrollTop; }
  const changing = state.workspace !== workspace;
  state.workspace = workspace;
  for (const name of ['results', 'viewer']) {
    const active = workspace === name;
    $(`#${name}-panel`).hidden = !active;
    $(`#${name}-tab`).classList.toggle('active', active);
    $(`#${name}-tab`).setAttribute('aria-selected', String(active));
    $(`#${name}-tab`).tabIndex = active ? 0 : -1;
  }
  $('#global-search').hidden = workspace !== 'results';
  if (workspace === 'results') {
    $('#results-list').scrollTop = state.resultsScroll;
    renderResults();
  } else {
    if (changing) { $('#viewer-content').scrollTop = state.viewerScroll; $('#file-results-list').scrollTop = state.fileResultsScroll; }
    renderFileResults(); if (state.matchesOnly) renderViewer();
  }
  if (focus) $(`#${workspace}-tab`).focus();
}

async function acceptWorkspace(result) {
  if (!result) return;
  cancelSearch();
  await api.cancel('viewer');
  state.viewerRequest = null; state.viewerFinding = false;
  const old = new Set(state.files.map(file => file.id));
  state.files = result.files; state.demo = !!result.demo;
  const ids = new Set(state.files.map(file => file.id));
  state.selectedFiles = new Set([...state.selectedFiles].filter(id => ids.has(id)));
  state.files.forEach(file => { if (!old.has(file.id)) state.selectedFiles.add(file.id); });
  state.rows = []; state.selectedResult = -1;
  state.tabs = state.tabs.filter(tab => ids.has(tab.fileId));
  if (!ids.has(state.activeFile)) clearViewer();
  renderFiles(); renderTabs(); renderResults(); updateResultsHeader();
  if (result.errors?.length) toast(`${result.errors.length}개 경로를 읽지 못했습니다. ${result.errors[0].message}`, true);
  if (result.capped) toast('파일 수가 10,000개에 도달하여 일부 경로는 추가하지 않았습니다.', true);
  setStatus(`${state.files.length}개 파일 준비됨`);
}

function queryOptions() {
  const extra = $('#extra-level').value;
  const levels = [...state.levels];
  if (extra && !levels.includes(extra)) levels.push(extra);
  return {
    query: $('#query').value, caseSensitive: state.caseSensitive, wholeWord: state.wholeWord, regex: state.regex,
    mode: $('#search-mode').value, glob: $('#glob').value, exclude: $('#exclude').value,
    encoding: $('#encoding').value, from: $('#date-from').value, to: $('#date-to').value,
    levels, limit: Number($('#result-limit').value)
  };
}
function updateFilterBadge() {
  const options = queryOptions();
  const count = [options.mode !== 'literal', options.glob, options.exclude, options.encoding !== 'auto', options.from, options.to, options.levels.length > 0].filter(Boolean).length;
  $('#active-filter-count').textContent = count; $('#active-filter-count').hidden = !count;
}
function setToggle(id, value) { $(id).classList.toggle('active', value); $(id).setAttribute('aria-pressed', String(value)); }
function applyOptions(options) {
  $('#query').value = options.query || '';
  for (const [property, id] of [['caseSensitive', '#case-toggle'], ['wholeWord', '#word-toggle'], ['regex', '#regex-toggle']]) { state[property] = !!options[property]; setToggle(id, state[property]); }
  for (const [property, id] of [['mode', '#search-mode'], ['glob', '#glob'], ['exclude', '#exclude'], ['encoding', '#encoding'], ['from', '#date-from'], ['to', '#date-to'], ['limit', '#result-limit']]) $(id).value = options[property] ?? ({ mode: 'literal', encoding: 'auto', limit: 20000 }[property] || '');
  state.levels = new Set((options.levels || []).filter(level => ['ERROR', 'WARN', 'INFO'].includes(level)));
  $('#extra-level').value = (options.levels || []).find(level => !state.levels.has(level)) || '';
  $$('[data-level]').forEach(button => button.classList.toggle('active', state.levels.has(button.dataset.level)));
  updateFilterBadge();
}

async function startSearch() {
  if (!state.selectedFiles.size) { toast('검색할 파일을 하나 이상 선택해 주세요.'); return; }
  switchWorkspace('results');
  await api.cancel('global');
  state.requestId = crypto.randomUUID(); state.rows = []; state.selectedResult = -1; state.searching = true;
  state.lastOptions = queryOptions();
  state.resultsScroll = 0; $('#results-list').scrollTop = 0; $('#elapsed').textContent = ''; $('#search-progress').hidden = false;
  $('#search-button').innerHTML = `${icon('close')}중지`;
  $('#results-summary').textContent = '로그를 읽고 있습니다…';
  setStatus('파일 검색 중…'); updateFilterBadge(); renderResults(); updateResultsHeader();
  if (state.lastOptions.query.trim()) {
    state.history = [state.lastOptions, ...state.history.filter(item => JSON.stringify(item) !== JSON.stringify(state.lastOptions))].slice(0, 20);
    store('history', state.history);
  }
  const id = state.requestId;
  try { await api.search({ requestId: id, fileIds: [...state.selectedFiles], options: state.lastOptions }); }
  catch (error) { if (id === state.requestId) finishSearchError(errorMessage(error)); }
}
function cancelSearch() {
  if (state.searching) { api.cancel('global'); setStatus('검색 중지됨'); $('#results-summary').textContent = `${number(state.rows.length)}건에서 검색을 중지했습니다.`; }
  state.searching = false; state.requestId = null;
  $('#search-progress').hidden = true; $('#search-button').innerHTML = `검색${icon('arrow-right')}`;
}
function finishSearchError(message) { cancelSearch(); setStatus('검색 오류'); $('#results-summary').textContent = message; toast(message, true); renderResults(); }
function updateResultsHeader() { $('#result-count').textContent = number(state.rows.length); $('#results-tab-count').textContent = number(state.rows.length); $('#export-button').disabled = state.searching || !state.rows.length; }
function scheduleResults() { if (!state.resultFrame) state.resultFrame = requestAnimationFrame(() => { state.resultFrame = 0; renderResults(); }); }

function highlighted(text, ranges = [], terms = [], colorize = false) {
  const clipped = text.length > 14000;
  text = text.slice(0, 14000);
  const spans = ranges.filter(range => range.start < text.length).map(range => ({ start: range.start, end: Math.min(text.length, range.end), color: 0 }));
  const lower = text.toLocaleLowerCase();
  terms.slice(0, 12).forEach((term, index) => {
    const needle = term.toLocaleLowerCase();
    if (!needle) return;
    let at = 0, hits = 0;
    while ((at = lower.indexOf(needle, at)) !== -1 && hits++ < 150) { spans.push({ start: at, end: at + needle.length, color: index % 4 }); at += needle.length; }
  });
  spans.sort((a, b) => a.start - b.start || b.end - a.end);
  const emit = value => {
    let html = esc(value);
    if (colorize) {
      html = html.replace(/\b(TRACE|DEBUG|INFO|WARN|ERROR|FATAL)\b/g, '<span class="log-level $1">$1</span>');
      html = html.replace(/^(\d{4}-\d\d-\d\d[ T]\d\d:\d\d:\d\d(?:\.\d+)?)/, '<span class="log-time">$1</span>');
    }
    return html;
  };
  let output = '', cursor = 0;
  for (const span of spans) {
    if (span.start < cursor || span.end <= span.start) continue;
    output += emit(text.slice(cursor, span.start)) + `<mark class="color-${span.color}">${esc(text.slice(span.start, span.end))}</mark>`;
    cursor = span.end;
  }
  return output + emit(text.slice(cursor)) + (clipped ? '<span class="muted"> … [화면 표시 생략]</span>' : '');
}

function renderResults() {
  if (state.workspace !== 'results') return;
  const container = $('#results-list');
  if (!state.rows.length) {
    container.innerHTML = state.searching ? emptyState('search', '로그에서 단서를 찾고 있습니다', '검색은 백그라운드에서 실행됩니다. 언제든 중지할 수 있습니다.') : state.files.length ? emptyState('search', '검색으로 탐색을 시작하세요', '검색어를 입력하거나 빈 검색으로 모든 로그를 살펴보세요.') : emptyState('folder-plus', '첫 번째 로그를 가져오세요', '폴더 안의 로그 파일들을 현재 검색 목록에 추가합니다.', '<button class="button primary" data-action="add-folder">폴더 가져오기</button>');
    return;
  }
  const height = RESULT_ROW_HEIGHT;
  const start = Math.max(0, Math.floor(container.scrollTop / height) - 4);
  const end = Math.min(state.rows.length, start + Math.ceil(container.clientHeight / height) + 10);
  let html = `<div class="virtual-canvas" style="height:${state.rows.length * height}px">`;
  for (let index = start; index < end; index++) {
    const row = state.rows[index];
    // Keep the matching text visible when the timestamp/prefix is very long.
    const matchStart = row.ranges?.[0]?.start || 0;
    const snippetStart = Math.max(0, matchStart - 65);
    const snippet = row.text.slice(snippetStart, snippetStart + 600);
    const ranges = (row.ranges || []).map(range => ({ start: range.start - snippetStart, end: range.end - snippetStart })).filter(range => range.start >= 0);
    const filePath = state.files.find(file => file.id === row.fileId)?.path || row.relativePath;
    html += `<button class="result-row${index === state.selectedResult ? ' selected' : ''}" style="top:${index * height}px" data-result="${index}" aria-label="${esc(row.fileName)} ${row.lineNumber}행"><div class="result-top"><span class="level-badge ${esc(row.level)}">${esc(row.level)}</span><span class="result-file">${esc(row.fileName)}</span><span class="result-number">L${number(row.lineNumber)}</span></div><div class="result-path" title="${esc(filePath)}">${esc(filePath)}</div><div class="result-message">${snippetStart ? '… ' : ''}${highlighted(snippet, ranges)}</div></button>`;
  }
  container.innerHTML = html + '</div>';
}
function sortRows() {
  if (state.sortNewest) {
    const times = new Map(state.rows.map(row => [row, Date.parse(row.timestamp.replace(',', '.'))]));
    state.rows.sort((a, b) => (Number.isFinite(times.get(b)) ? times.get(b) : -Infinity) - (Number.isFinite(times.get(a)) ? times.get(a) : -Infinity) || a.fileId.localeCompare(b.fileId) || a.lineNumber - b.lineNumber);
  }
  else { const order = new Map(state.files.map((file, index) => [file.id, index])); state.rows.sort((a, b) => order.get(a.fileId) - order.get(b.fileId) || a.lineNumber - b.lineNumber); }
}
async function selectResult(index) {
  if (!state.rows[index]) return;
  state.selectedResult = index;
  const row = state.rows[index];
  state.matchesOnly = false; setToggle('#matches-only', false);
  renderResults();
  await openFile(row.fileId, row.lineNumber, row.encoding);
}

api.onSearch(event => {
  if (event.kind === 'viewer') { receiveViewerSearch(event); return; }
  if (event.requestId !== state.requestId) return;
  if (event.type === 'batch') { state.rows.push(...event.rows); updateResultsHeader(); scheduleResults(); }
  if (event.type === 'progress') { $('#results-summary').innerHTML = `<b>${number(event.count)}건</b> 일치 · ${event.scanned}/${event.total} 파일 · ${number(event.lines)}행 확인`; }
  if (event.type === 'error') finishSearchError(event.message);
  if (event.type === 'done') {
    state.searching = false; $('#search-progress').hidden = true; $('#search-button').innerHTML = `검색${icon('arrow-right')}`;
    sortRows(); updateResultsHeader(); renderResults();
    $('#elapsed').textContent = event.elapsed < 1000 ? `${event.elapsed} ms` : `${(event.elapsed / 1000).toFixed(2)} s`;
    $('#results-summary').innerHTML = `<b>${number(event.count)}건 일치</b> · ${event.scanned}개 파일 · ${number(event.lines)}행${event.limited ? ' · 상한 도달' : ''}${event.errors.length ? ` · ${event.errors.length}개 파일 오류` : ''}`;
    setStatus(event.limited ? '결과 상한에 도달했습니다. 필터로 범위를 줄여 주세요.' : `검색 완료 · ${number(event.count)}건 일치`);
    if (!state.rows.length) $('#results-list').innerHTML = emptyState('search', '일치하는 로그가 없습니다', '검색어와 파일 범위, 레벨 또는 시간 필터를 확인해 보세요.');
    if (event.errors.length) toast(`${event.errors[0].name}: ${event.errors[0].message}`, true);
    if (event.clippedLines) toast(`${number(event.clippedLines)}개의 긴 행은 앞부분 256KB만 검색했습니다.`, true);
    if (event.memoryLimited) toast('결과 메모리 상한(32MB)에 도달했습니다. 필터로 검색 범위를 줄여 주세요.');
  }
});
api.onNotice(message => toast(message, true));

function clearViewer() {
  state.viewerRead++; state.activeFile = null; state.viewer = null; state.currentLine = 1;
  state.viewerMatches = []; state.viewerMatchIndex = -1; state.viewerFinding = false; state.tail = false;
  state.viewerFindSummary = null; state.viewerFindSignature = ''; state.fileResultsOpen = false;
  setToggle('#tail-toggle', false); renderTabs(); renderViewer(); updateViewerCount();
  $('#line-detail').hidden = true; $('#viewer-position').textContent = '파일을 선택해 주세요';
}
function renderTabs() {
  const active = state.files.find(file => file.id === state.activeFile);
  $('#viewer-tab-name').textContent = active?.name || '';
  $('#viewer-tab-name').title = active?.path || '';
  $('#viewer-file-name').textContent = active?.name || '로그 뷰어';
  $('#viewer-path').textContent = active?.path || '';
  $('#viewer-path').title = active?.path || '';
  $('#viewer-tabs').innerHTML = state.tabs.length ? state.tabs.map(tab => {
    const file = state.files.find(item => item.id === tab.fileId);
    if (!file) return '';
    return `<div class="viewer-tab${state.activeFile === tab.fileId ? ' active' : ''}" data-tab="${tab.fileId}"><button class="tab-open" title="${esc(file.path)}">${esc(file.name)}</button><button class="tab-close" aria-label="${esc(file.name)} 탭 닫기">×</button></div>`;
  }).join('') : '<span class="saved-empty">원문 미리보기</span>';
}
async function openFile(fileId, line = 1, encoding = null) {
  if (!state.files.some(file => file.id === fileId)) { toast('현재 워크스페이스에 없는 파일입니다.', true); return; }
  const changed = state.activeFile !== fileId;
  if (changed) {
    await api.cancel('viewer'); state.viewerRequest = null; state.viewerFinding = false;
    state.viewerMatches = []; state.viewerMatchIndex = -1; state.tail = false; setToggle('#tail-toggle', false);
    state.viewerFindSummary = null; state.viewerFindSignature = '';
  }
  state.activeFile = fileId; state.currentLine = line;
  switchWorkspace('viewer');
  const tab = state.tabs.find(item => item.fileId === fileId);
  if (!tab) state.tabs.push({ fileId, line }); else tab.line = line;
  renderFiles(); renderTabs(); updateViewerCount();
  await loadViewer(line, false, encoding || (changed ? $('#encoding').value : null));
  if (changed && $('#viewer-query').value.trim()) await findInFile();
}
async function loadViewer(line = state.currentLine, tail = false, encoding = null, quiet = false) {
  if (!state.activeFile) return;
  const ticket = ++state.viewerRead;
  const fileId = state.activeFile;
  if (!quiet) { state.viewerLoading = true; $('#viewer-content').innerHTML = emptyState('terminal', '원문을 불러오고 있습니다', '큰 파일은 처음 열 때 행 인덱스를 생성합니다.'); }
  try {
    const data = await api.readWindow({ fileId, line, count: 300, tail, encoding: encoding || state.viewer?.encoding || $('#encoding').value });
    if (ticket !== state.viewerRead || fileId !== state.activeFile) return;
    state.viewer = data; state.viewerLoading = false;
    state.currentLine = tail ? data.totalLines : Math.min(Math.max(1, line), Math.max(1, data.totalLines));
    const tab = state.tabs.find(item => item.fileId === fileId); if (tab) tab.line = state.currentLine;
    $('#status-encoding').textContent = data.encoding.toUpperCase();
    $('#viewer-position').textContent = `L${number(state.currentLine)} / ${number(data.totalLines)} · ${formatSize(data.size)}`;
    renderViewer(); renderFileResults();
    requestAnimationFrame(() => {
      const element = $('#viewer-content');
      if (tail) element.scrollTop = element.scrollHeight;
      else {
        const row = element.querySelector(`[data-line="${state.currentLine}"]`);
        if (row) element.scrollTop = Math.max(0, row.offsetTop - element.clientHeight * .32);
      }
    });
    if (state.showDetail) renderDetail();
  } catch (error) {
    if (ticket !== state.viewerRead) return;
    state.viewerLoading = false; $('#viewer-content').innerHTML = emptyState('file', '파일을 읽을 수 없습니다', errorMessage(error)); toast(errorMessage(error), true);
  }
}
function currentRows() {
  if (state.matchesOnly && $('#viewer-query').value.trim()) return state.wrap ? state.viewerMatches.slice(state.matchPage * 300, (state.matchPage + 1) * 300) : state.viewerMatches;
  return state.viewer?.rows || [];
}
function renderViewer() {
  const container = $('#viewer-content');
  container.classList.toggle('wrap', state.wrap);
  if (!state.viewer) { container.innerHTML = emptyState('terminal', '원문에 집중하는 분석 공간', '통합 검색 결과를 클릭하거나 왼쪽 파일을 열어 로그를 분석하세요.'); return; }
  const rows = currentRows();
  if (!rows.length) { container.innerHTML = emptyState('filter', state.viewerFinding ? '파일에서 검색 중입니다' : '표시할 로그가 없습니다', state.matchesOnly ? '파일 검색어를 변경하거나 ‘일치 행만’을 해제하세요.' : '비어 있는 파일입니다.'); return; }
  const virtual = state.matchesOnly && !state.wrap && rows.length > 500;
  let start = 0, end = rows.length;
  if (virtual) { start = Math.max(0, Math.floor(container.scrollTop / 27) - 7); end = Math.min(rows.length, start + Math.ceil(container.clientHeight / 27) + 17); }
  const matchMap = new Map(state.viewerMatches.map(row => [row.lineNumber, row]));
  const globalMatch = state.rows[state.selectedResult];
  let html = virtual ? `<div class="virtual-canvas" style="height:${rows.length * 27}px">` : '';
  if (state.matchesOnly && state.wrap && state.viewerMatches.length > 300) html += `<div class="wrap-paging-note">줄바꿈 모드 · ${state.matchPage * 300 + 1}–${Math.min(state.viewerMatches.length, (state.matchPage + 1) * 300)} / ${number(state.viewerMatches.length)}개 일치 · 하단 화살표로 구간 이동</div>`;
  for (let index = start; index < end; index++) {
    const row = rows[index];
    const match = matchMap.get(row.lineNumber);
    const ranges = match?.ranges || (globalMatch?.fileId === state.activeFile && globalMatch.lineNumber === row.lineNumber ? globalMatch.ranges : []);
    const bookmarked = state.bookmarks.some(bookmark => bookmark.path === state.viewer.file.path && bookmark.line === row.lineNumber);
    html += `<div class="log-row${row.lineNumber === state.currentLine ? ' current' : ''}${match ? ' is-match' : ''}" data-line="${row.lineNumber}"${virtual ? ` style="position:absolute;top:${index * 27}px;right:0;left:0"` : ''}>${bookmarked ? '<span class="bookmark-dot">◆</span>' : ''}<span class="line-gutter">${row.lineNumber}</span><span class="line-text">${highlighted(row.text, ranges, state.highlightTerms, true)}${row.truncated ? '<span class="muted"> [256KB 이후 생략]</span>' : ''}</span></div>`;
  }
  container.innerHTML = html + (virtual ? '</div>' : '');
  $('#page-prev').disabled = state.matchesOnly ? !state.wrap || state.matchPage === 0 : !state.viewer.rows.length || state.viewer.rows[0].lineNumber <= 1;
  $('#page-next').disabled = state.matchesOnly ? !state.wrap || (state.matchPage + 1) * 300 >= state.viewerMatches.length : !state.viewer.rows.length || state.viewer.rows.at(-1).lineNumber >= state.viewer.totalLines;
}
function selectedLine() { return currentRows().find(row => row.lineNumber === state.currentLine) || state.viewer?.rows.find(row => row.lineNumber === state.currentLine); }
function selectLine(line) {
  state.currentLine = line;
  $$('.log-row.current').forEach(node => node.classList.remove('current'));
  $(`.log-row[data-line="${line}"]`)?.classList.add('current');
  $('#viewer-position').textContent = `L${number(line)} / ${number(state.viewer?.totalLines)} · ${formatSize(state.viewer?.size || 0)}`;
  const matchIndex = state.viewerMatches.findIndex(row => row.lineNumber === line); if (matchIndex >= 0) state.viewerMatchIndex = matchIndex;
  updateViewerCount(); scheduleFileResults(); if (state.showDetail) renderDetail();
}

let findTimer;
function updateViewerQueryUI() {
  const select = $('#viewer-mode');
  select.disabled = state.viewerRegex;
  select.value = state.viewerRegex ? 'regex' : state.viewerMode;
  const help = $('#viewer-query-help');
  const descriptions = {
    any: 'OR: 공백으로 나눈 조건 중 하나라도 포함된 행을 찾습니다. 예: timeout "connection refused" failed',
    all: 'AND: 공백으로 나눈 모든 조건이 같은 행에 있어야 합니다. 공백이 있는 문구는 "큰따옴표"로 묶으세요.',
    regex: '정규식 모드: OR 조건은 | 로 연결하세요. 예: timeout|connection\\s+refused|failed · 검색 방식을 바꾸려면 .* 를 해제하세요.'
  };
  const active = state.viewerRegex ? 'regex' : state.viewerMode;
  help.textContent = descriptions[active] || '';
  help.hidden = active === 'literal';
  $('#viewer-query').placeholder = active === 'any' ? 'timeout "connection refused" failed' : active === 'all' ? 'payment timeout' : active === 'regex' ? 'timeout|connection\\s+refused|failed' : '현재 파일 전체에서 검색…';
}
function viewerFindOptions() {
  return { query: $('#viewer-query').value, regex: state.viewerRegex, caseSensitive: state.viewerCase,
    mode: state.viewerMode,
    levels: $('#viewer-level').value ? [$('#viewer-level').value] : [], exclude: $('#viewer-exclude').value,
    encoding: state.viewer?.encoding || $('#encoding').value, limit: 20000 };
}
async function findInFile({ background = false } = {}) {
  clearTimeout(findTimer);
  await api.cancel('viewer');
  state.viewerMatches = []; state.viewerMatchIndex = -1; state.viewerRequest = null; state.viewerFinding = false; state.matchPage = 0;
  state.viewerFindSummary = null; state.viewerFindProgress = 0;
  updateViewerCount();
  if (!state.activeFile || !$('#viewer-query').value.trim()) { state.matchesOnly = false; setToggle('#matches-only', false); renderViewer(); return; }
  state.viewerRequest = crypto.randomUUID(); state.viewerFinding = true;
  if (!background) { state.fileResultsOpen = true; $('#file-results-list').scrollTop = 0; }
  const options = viewerFindOptions();
  state.viewerFindSignature = JSON.stringify(options);
  const request = { requestId: state.viewerRequest, fileId: state.activeFile, options };
  updateViewerCount();
  try { await api.findFile(request); }
  catch (error) { if (state.viewerRequest === request.requestId) { state.viewerFinding = false; state.viewerFindSummary = { error: errorMessage(error) }; toast(errorMessage(error), true); updateViewerCount(); } }
}
function updateViewerCount() {
  $('#viewer-find-count').textContent = state.viewerFinding ? '검색 중…' : `${state.viewerMatchIndex >= 0 ? state.viewerMatchIndex + 1 : 0} / ${number(state.viewerMatches.length)}`;
  $('#viewer-search-button').textContent = state.viewerFinding ? '검색 중지' : '파일 전체 검색';
  $('#viewer-search-button').disabled = !state.activeFile;
  $('#file-results-panel').hidden = !state.activeFile || !state.fileResultsOpen;
  $('#file-results-splitter').hidden = $('#file-results-panel').hidden;
  setToggle('#file-results-toggle', state.fileResultsOpen);
  scheduleFileResults();
}
function receiveViewerSearch(event) {
  if (event.requestId !== state.viewerRequest) return;
  if (event.type === 'batch') { state.viewerMatches.push(...event.rows); updateViewerCount(); }
  if (event.type === 'progress') { state.viewerFindProgress = event.lines; scheduleFileResults(); }
  if (event.type === 'error') { state.viewerFinding = false; state.viewerFindSummary = { error: event.message }; updateViewerCount(); toast(event.message, true); }
  if (event.type === 'done') {
    state.viewerFinding = false;
    state.viewerFindSummary = event;
    state.viewerMatchIndex = state.viewerMatches.findIndex(row => row.lineNumber === state.currentLine);
    updateViewerCount(); renderViewer();
    if (event.limited) toast(event.memoryLimited ? '파일 검색 결과가 메모리 상한(32MB)에 도달했습니다.' : '파일 검색은 20,000개 일치까지만 표시합니다.');
  }
}
async function navigateMatch(direction) {
  if (!state.viewerMatches.length) return;
  const index = state.viewerMatchIndex < 0 ? (direction < 0 ? state.viewerMatches.length - 1 : 0) : (state.viewerMatchIndex + direction + state.viewerMatches.length) % state.viewerMatches.length;
  await goToFileMatch(index);
}
async function goToFileMatch(index, context = false) {
  if (!state.viewerMatches[index]) return;
  state.viewerMatchIndex = index;
  const list = $('#file-results-list');
  if (index * FILE_RESULT_ROW_HEIGHT < list.scrollTop || (index + 1) * FILE_RESULT_ROW_HEIGHT > list.scrollTop + list.clientHeight) list.scrollTop = Math.max(0, index * FILE_RESULT_ROW_HEIGHT - list.clientHeight / 2);
  if (context) { state.matchesOnly = false; setToggle('#matches-only', false); }
  const match = state.viewerMatches[state.viewerMatchIndex];
  state.tail = false; setToggle('#tail-toggle', false);
  updateViewerCount();
  if (state.matchesOnly) {
    state.currentLine = match.lineNumber;
    state.matchPage = Math.floor(state.viewerMatchIndex / 300);
    if (!state.wrap && state.viewerMatches.length > 500) $('#viewer-content').scrollTop = Math.max(0, state.viewerMatchIndex * 27 - 70);
    renderViewer();
    $(`.log-row[data-line="${match.lineNumber}"]`)?.scrollIntoView({ block: 'center' });
    selectLine(match.lineNumber);
  } else await loadViewer(match.lineNumber);
  renderFileResults();
}

function scheduleFileResults() {
  if (!state.fileResultsFrame) state.fileResultsFrame = requestAnimationFrame(() => { state.fileResultsFrame = 0; renderFileResults(); });
}
function renderFileResults() {
  const summary = state.viewerFindSummary;
  $('#file-results-count').textContent = number(state.viewerMatches.length);
  $('#file-results-status').textContent = state.viewerFinding ? `${number(state.viewerFindProgress)}행 검사 중…` : summary?.error ? summary.error : summary?.cancelled ? '검색 중지됨' : summary ? `${number(summary.lines)}행 검사 · ${summary.elapsed} ms${summary.limited ? ' · 결과 상한 도달' : ''}` : '파일 전체에서 검색 · 클릭하면 원문으로 이동';
  if (state.viewerRegex || state.viewerMode !== 'literal') $('#file-results-status').textContent = `${state.viewerRegex ? '정규식' : state.viewerMode === 'any' ? 'OR' : 'AND'} · ${$('#file-results-status').textContent}`;
  $('#file-level-summary').textContent = Object.entries(summary?.counts || {}).map(([level, count]) => `${level} ${number(count)}`).join('  ·  ');
  $('#copy-file-results').disabled = state.viewerFinding || !state.viewerMatches.length;
  if (state.workspace !== 'viewer' || $('#file-results-panel').hidden) return;
  const container = $('#file-results-list');
  if (!state.viewerMatches.length) {
    container.innerHTML = `<div class="file-results-empty">${esc(summary?.error || (state.viewerFinding ? '파일 전체를 검색하고 있습니다…' : !$('#viewer-query').value.trim() ? '위 검색창에 검색어를 입력하세요. 파일 전체의 일치 목록을 보여 줍니다.' : '일치하는 로그가 없습니다. 검색어 또는 레벨·제외 조건을 확인하세요.'))}</div>`;
    return;
  }
  const height = FILE_RESULT_ROW_HEIGHT;
  const start = Math.max(0, Math.floor(container.scrollTop / height) - 4);
  const end = Math.min(state.viewerMatches.length, start + Math.ceil(container.clientHeight / height) + 10);
  let html = `<div class="virtual-canvas" style="height:${state.viewerMatches.length * height}px">`;
  for (let index = start; index < end; index++) {
    const row = state.viewerMatches[index];
    const offset = Math.max(0, (row.ranges?.[0]?.start || 0) - 45);
    const ranges = (row.ranges || []).filter(range => range.start >= offset).map(range => ({ start: range.start - offset, end: range.end - offset }));
    html += `<button class="file-result-row${state.currentLine === row.lineNumber ? ' selected' : ''}" style="top:${index * height}px" data-file-match="${index}" aria-label="파일 검색 결과 ${row.lineNumber}행"><span class="file-result-line">L${number(row.lineNumber)}</span><span class="file-result-time">${esc(row.timestamp.match(/\d\d:\d\d:\d\d(?:[.,]\d{1,3})?/)?.[0] || '—')}</span><span class="level-badge ${row.level}">${row.level}</span><span class="file-result-text">${offset ? '… ' : ''}${highlighted(row.text.slice(offset, offset + 1600), ranges)}</span></button>`;
  }
  container.innerHTML = html + '</div>';
}

async function traceAcrossFiles() {
  const selection = window.getSelection()?.toString().trim();
  const text = selectedLine()?.text || '';
  const id = selection || text.match(/(?:trace[_-]?id|request[_-]?id|correlation[_-]?id)["']?\s*[:=]\s*["']?([\w.:/-]+)/i)?.[1];
  if (!id || id.length > 500) { toast('현재 행에 trace_id 또는 request_id가 없습니다. 추적할 텍스트를 선택해도 됩니다.'); return; }
  applyOptions({ query: id });
  await startSearch();
}

function renderSaved() {
  $('#saved-searches').innerHTML = state.saved.length ? state.saved.map((item, index) => `<div class="saved-item"><span>${icon('bookmark')}</span><button data-saved="${index}" title="${esc(item.query)}">${esc(item.query || '전체 로그')}</button><button class="icon-button small" data-delete-saved="${index}" aria-label="저장한 검색 삭제">${icon('close')}</button></div>`).join('') : '<div class="saved-empty">자주 쓰는 검색을 저장해 두세요.</div>';
  $('#bookmark-count').textContent = state.bookmarks.length;
}
function toggleBookmark() {
  const row = selectedLine(); if (!row || !state.viewer) return;
  const file = state.viewer.file;
  const index = state.bookmarks.findIndex(item => item.path === file.path && item.line === row.lineNumber);
  if (index >= 0) { state.bookmarks.splice(index, 1); toast('북마크를 해제했습니다.'); }
  else { state.bookmarks.push({ path: file.path, name: file.name, line: row.lineNumber, text: row.text.slice(0, 1000) }); toast('북마크에 추가했습니다.'); }
  store('bookmarks', state.bookmarks); renderSaved(); renderViewer();
}
function renderDetail() {
  const row = selectedLine(); if (!row) return;
  let content = row.text;
  let parsed = false;
  try { content = JSON.stringify(JSON.parse(row.text), null, 2); parsed = true; }
  catch {
    const json = row.text.slice(row.text.indexOf('{'));
    try { content = JSON.stringify(JSON.parse(json), null, 2); parsed = true; } catch { /* plain log */ }
  }
  $('#line-detail').hidden = !state.showDetail;
  $('#line-detail').innerHTML = `<header><strong>${parsed ? 'JSON INSPECTOR' : 'LINE INSPECTOR'}</strong><button class="icon-button small" data-close-detail aria-label="상세 닫기">${icon('close')}</button></header><div class="detail-meta">L${row.lineNumber} · ${esc(row.level)} · ${esc(row.timestamp || '타임스탬프 없음')}</div><pre>${esc(content)}</pre>`;
}

function modal(title, body) {
  $('#modal-content').innerHTML = `<div class="modal-header"><h2>${esc(title)}</h2><button class="icon-button" data-close-modal aria-label="닫기">${icon('close')}</button></div><div class="modal-body">${body}</div>`;
  if (!$('#modal').open) $('#modal').showModal();
}
function closeModal() { $('#modal').close(); }
function showBookmarks() {
  modal('북마크', `<p class="modal-description">중요한 로그를 모아 두고 원문으로 돌아가세요. Ctrl+B로 현재 행을 저장합니다.</p><div class="modal-list">${state.bookmarks.length ? state.bookmarks.map((item, index) => `<div class="modal-bookmark"><button data-bookmark="${index}"><strong>${esc(item.name)} : ${item.line}</strong><p>${esc(item.text)}</p></button><button class="icon-button" data-delete-bookmark="${index}" aria-label="북마크 삭제">${icon('close')}</button></div>`).join('') : '<div class="saved-empty">아직 저장한 북마크가 없습니다.</div>'}</div>`);
}
const shortcuts = [['검색 / 뷰어 탭', 'Ctrl + 1 / Ctrl + 2'], ['전체 파일 검색', 'Ctrl + Shift + F'], ['현재 파일에서 검색', 'Ctrl + F'], ['다음 / 이전 일치', 'F3 / Shift + F3'], ['원문 행 이동', 'Ctrl + G'], ['현재 행 북마크', 'Ctrl + B'], ['명령 팔레트', 'Ctrl + K'], ['검색 결과 선택', '↑ / ↓ → Enter'], ['검색 중지 / 창 닫기', 'Esc']];
function showHelp() { modal('작은 단축키, 빠른 탐색', `<p class="modal-description">검색 결과를 클릭하면 원문과 앞뒤 로그를 확인할 수 있습니다.<br>상세 필터의 시간은 시간대가 없는 로그의 경우 이 컴퓨터의 로컬 시간으로 해석합니다.</p><div class="shortcut-grid">${shortcuts.map(([label, key]) => `<span>${label}</span><kbd>${key}</kbd>`).join('')}</div>`); }
function showGoto() {
  if (!state.viewer) return;
  modal('행 번호로 이동', `<p class="modal-description">1 ~ ${number(state.viewer.totalLines)} 사이의 행 번호를 입력하세요.</p><input id="goto-input" type="number" min="1" max="${state.viewer.totalLines}" value="${state.currentLine}" aria-label="이동할 행 번호"><div class="modal-actions"><button class="button primary" id="goto-submit">이동 ${icon('arrow-right')}</button></div>`);
  $('#goto-input').select();
}
async function gotoSubmit() {
  const line = Number($('#goto-input').value);
  if (!Number.isInteger(line) || line < 1 || line > state.viewer.totalLines) { toast('파일 범위 안의 행 번호를 입력해 주세요.'); return; }
  closeModal(); switchWorkspace('viewer'); state.matchesOnly = false; state.tail = false; setToggle('#matches-only', false); setToggle('#tail-toggle', false); await loadViewer(line);
}
function showHistory() {
  modal('최근 검색', `<div class="modal-list">${state.history.length ? state.history.map((item, index) => `<button class="modal-item" data-history="${index}"><span>${esc(item.query || '전체 로그')}</span><small>${item.regex ? 'REGEX' : item.mode.toUpperCase()} · ${item.levels.length ? esc(item.levels.join(', ')) : 'ALL LEVELS'}</small></button>`).join('') : '<p class="saved-empty">최근 검색이 없습니다.</p>'}</div>`);
}
const commands = [
  ['folder', '폴더 추가', '로그 폴더 가져오기'], ['files', '파일 추가', '여러 로그 파일 선택'], ['search', '통합 검색으로 이동', 'Ctrl+Shift+F'], ['find', '현재 파일 검색', 'Ctrl+F'], ['goto', '행 번호로 이동', 'Ctrl+G'], ['bookmark', '현재 행 북마크', 'Ctrl+B'], ['bookmarks', '북마크 열기', '저장된 로그'], ['export', '검색 결과 내보내기', 'CSV / JSON'], ['tail', '실시간 추적 켜기/끄기', 'LIVE'], ['help', '키보드 단축키', '?']
];
function showCommands() { modal('무엇을 할까요?', '<input id="command-input" placeholder="명령 검색…" aria-label="명령 검색"><div id="command-list" class="modal-list"></div>'); renderCommands(''); $('#command-input').focus(); }
function renderCommands(query) { $('#command-list').innerHTML = commands.filter(command => command.join(' ').toLowerCase().includes(query.toLowerCase())).map(([id, title, detail]) => `<button class="modal-item" data-command="${id}"><span>${esc(title)}</span><small>${esc(detail)}</small></button>`).join(''); }
async function runCommand(id) {
  closeModal();
  const actions = { folder: () => importFiles('folder'), files: () => importFiles('files'), search: () => { switchWorkspace('results'); $('#query').focus(); }, find: () => { switchWorkspace('viewer'); $('#viewer-query').focus(); }, goto: showGoto, bookmark: toggleBookmark, bookmarks: showBookmarks, export: exportResults, tail: toggleTail, help: showHelp };
  await actions[id]?.();
}
async function importFiles(kind) {
  setStatus('파일 목록을 읽고 있습니다…');
  const result = await api.choose(kind);
  if (!result) { setStatus('준비됨'); return; }
  await acceptWorkspace(result);
  if (state.files.length) { $('#query').focus(); if ($('#query').value.trim()) await startSearch(); }
}
async function exportResults() { const output = await api.export(); if (output) toast('검색 결과를 저장했습니다.'); }
function toggleTail() {
  if (!state.activeFile) return;
  state.tail = !state.tail; setToggle('#tail-toggle', state.tail);
  if (state.tail) { state.matchesOnly = false; setToggle('#matches-only', false); safely(() => loadViewer(state.currentLine, true)); toast('실시간 추적 중 · 파일 끝부분이 자동으로 갱신됩니다.'); }
}

// Global search and file actions.
$('#search-form').addEventListener('submit', event => { event.preventDefault(); state.searching ? cancelSearch() : safely(startSearch); });
$('#add-folder').addEventListener('click', () => safely(() => importFiles('folder')));
$('#add-files').addEventListener('click', () => safely(() => importFiles('files')));
$('#drop-hint').addEventListener('click', () => safely(() => importFiles('files')));
$('#file-filter').addEventListener('input', renderFiles);
$('#select-all-files').addEventListener('click', () => { state.selectedFiles = state.selectedFiles.size === state.files.length ? new Set() : new Set(state.files.map(file => file.id)); renderFiles(); });
$('#file-list').addEventListener('change', event => { const item = event.target.closest('[data-id]'); if (item && event.target.matches('input')) { event.target.checked ? state.selectedFiles.add(item.dataset.id) : state.selectedFiles.delete(item.dataset.id); updateScope(); } });
$('#file-list').addEventListener('click', event => safely(async () => {
  const item = event.target.closest('[data-id]'); if (!item) return;
  if (event.target.closest('.file-open')) await openFile(item.dataset.id);
  if (event.target.closest('.file-remove')) {
    const remaining = await api.removeFile(item.dataset.id);
    await acceptWorkspace({ files: remaining, demo: state.demo && remaining.length > 0 });
    updateViewerCount();
    if (!remaining.length) switchWorkspace('results');
    toast('파일을 목록에서 제거했습니다. 원본 파일은 유지됩니다.');
  }
}));
$('#remove-selected').addEventListener('click', () => safely(async () => {
  const count = state.selectedFiles.size;
  if (!count) return;
  const remaining = await api.removeFiles([...state.selectedFiles]);
  await acceptWorkspace({ files: remaining, demo: state.demo && remaining.length > 0 });
  updateViewerCount();
  if (!remaining.length) switchWorkspace('results');
  toast(`${number(count)}개 파일을 목록에서 제거했습니다. 원본 파일은 유지됩니다.`);
}));
for (const [id, key] of [['#case-toggle', 'caseSensitive'], ['#word-toggle', 'wholeWord'], ['#regex-toggle', 'regex']]) $(id).addEventListener('click', () => { state[key] = !state[key]; setToggle(id, state[key]); });
$('#filters-button').addEventListener('click', () => { $('#filters-panel').hidden = !$('#filters-panel').hidden; $('#filters-button').classList.toggle('active', !$('#filters-panel').hidden); });
$('#filters-panel').addEventListener('input', updateFilterBadge);
$$('[data-level]').forEach(button => button.addEventListener('click', () => { const level = button.dataset.level; state.levels.has(level) ? state.levels.delete(level) : state.levels.add(level); button.classList.toggle('active', state.levels.has(level)); updateFilterBadge(); if (state.files.length) safely(startSearch); }));
$('#reset-filters').addEventListener('click', () => { applyOptions({ query: $('#query').value }); if (state.files.length) safely(startSearch); });
$('#result-sort').addEventListener('click', () => {
  const selected = state.rows[state.selectedResult];
  state.sortNewest = !state.sortNewest; sortRows();
  state.selectedResult = state.rows.indexOf(selected); $('#results-list').scrollTop = 0; renderResults();
  toast(state.sortNewest ? '타임스탬프 내림차순으로 정렬했습니다.' : '파일 순서와 행 번호로 정렬했습니다.');
});
$('#results-list').addEventListener('scroll', scheduleResults);
$('#results-list').addEventListener('click', event => { const row = event.target.closest('[data-result]'); if (row) safely(() => selectResult(Number(row.dataset.result))); if (event.target.closest('[data-action="add-folder"]')) safely(() => importFiles('folder')); });
$('#results-list').addEventListener('keydown', event => {
  if (['ArrowDown', 'ArrowUp'].includes(event.key) && state.rows.length) {
    event.preventDefault(); const index = Math.max(0, Math.min(state.rows.length - 1, state.selectedResult + (event.key === 'ArrowDown' ? 1 : -1)));
    state.selectedResult = index;
    $('#results-list').scrollTop = Math.max(0, index * RESULT_ROW_HEIGHT - 90); renderResults();
  }
  if (event.key === 'Enter' && state.selectedResult >= 0) { event.preventDefault(); safely(() => selectResult(state.selectedResult)); }
});
$('#export-button').addEventListener('click', () => safely(exportResults));
$('#results-tab').addEventListener('click', () => switchWorkspace('results'));
$('#viewer-tab').addEventListener('click', () => switchWorkspace('viewer'));
$('.workspace-tablist').addEventListener('keydown', event => {
  if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
    event.preventDefault();
    switchWorkspace(event.key === 'Home' ? 'results' : event.key === 'End' ? 'viewer' : state.workspace === 'results' ? 'viewer' : 'results', true);
  }
});
$('#history-button').addEventListener('click', showHistory);
$('#save-search').addEventListener('click', () => { const options = queryOptions(); if (!options.query.trim()) { toast('저장할 검색어를 입력해 주세요.'); return; } state.saved = [options, ...state.saved.filter(item => JSON.stringify(item) !== JSON.stringify(options))].slice(0, 20); store('saved', state.saved); renderSaved(); toast('현재 필터와 함께 검색을 저장했습니다.'); });
$('#saved-searches').addEventListener('click', event => {
  const open = event.target.closest('[data-saved]'); const remove = event.target.closest('[data-delete-saved]');
  if (open) { applyOptions(state.saved[Number(open.dataset.saved)]); safely(startSearch); }
  if (remove) { state.saved.splice(Number(remove.dataset.deleteSaved), 1); store('saved', state.saved); renderSaved(); }
});
function showWorkspaceReset() {
  modal('작업 공간 초기화', '<div class="confirm-panel">파일 목록·검색 결과·열린 탭·검색 조건을 초기화합니다.<br><strong>원본 로그 파일은 삭제하지 않습니다.</strong><br>북마크와 저장한 검색은 유지됩니다.</div><div class="modal-actions"><button class="button" data-close-modal>취소</button><button class="button primary" id="clear-confirm">초기화</button></div>');
}
$('#workspace-menu').addEventListener('click', showWorkspaceReset);
$('#workspace-reset').addEventListener('click', showWorkspaceReset);
$('#demo-button').addEventListener('click', () => safely(async () => { await acceptWorkspace(await api.demo()); applyOptions({ query: 'timeout' }); await startSearch(); }));

// Source viewer.
$('#viewer-tabs').addEventListener('click', event => safely(async () => {
  const tab = event.target.closest('[data-tab]'); if (!tab) return;
  if (event.target.closest('.tab-close')) {
    state.tabs = state.tabs.filter(item => item.fileId !== tab.dataset.tab);
    if (state.activeFile === tab.dataset.tab) {
      await api.cancel('viewer'); state.viewerRequest = null;
      const next = state.tabs.at(-1); if (next) await openFile(next.fileId, next.line); else clearViewer();
    }
    renderTabs(); renderFiles();
  } else { const item = state.tabs.find(item => item.fileId === tab.dataset.tab); await openFile(item.fileId, item.line); }
}));
$('#viewer-content').addEventListener('click', event => { const row = event.target.closest('[data-line]'); if (row) selectLine(Number(row.dataset.line)); });
$('#viewer-content').addEventListener('dblclick', () => { const text = window.getSelection()?.toString().trim(); if (text && text.length < 300) { $('#viewer-query').value = text; safely(findInFile); } });
$('#viewer-content').addEventListener('scroll', () => { if (state.matchesOnly && !state.wrap && state.viewerMatches.length > 500 && !state.viewerFrame) state.viewerFrame = requestAnimationFrame(() => { state.viewerFrame = 0; renderViewer(); }); });
$('#viewer-query').addEventListener('input', () => { clearTimeout(findTimer); findTimer = setTimeout(() => safely(findInFile), 300); });
$('#viewer-query').addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); if (state.viewerFindSignature !== JSON.stringify(viewerFindOptions())) safely(findInFile); else safely(() => navigateMatch(event.shiftKey ? -1 : 1)); } });
$('#viewer-mode').addEventListener('change', () => { state.viewerMode = $('#viewer-mode').value; updateViewerQueryUI(); safely(findInFile); });
$('#viewer-regex').addEventListener('click', () => { state.viewerRegex = !state.viewerRegex; setToggle('#viewer-regex', state.viewerRegex); updateViewerQueryUI(); safely(findInFile); });
updateViewerQueryUI();
$('#viewer-case').addEventListener('click', () => { state.viewerCase = !state.viewerCase; setToggle('#viewer-case', state.viewerCase); safely(findInFile); });
$('#viewer-level').addEventListener('change', () => safely(findInFile));
$('#viewer-exclude').addEventListener('input', () => { clearTimeout(findTimer); findTimer = setTimeout(() => safely(findInFile), 300); });
function cancelFileSearch() {
  api.cancel('viewer'); state.viewerRequest = null; state.viewerFinding = false;
  state.viewerFindSummary = { cancelled: true }; updateViewerCount(); renderViewer();
}
$('#viewer-search-button').addEventListener('click', () => { if (state.viewerFinding) cancelFileSearch(); else safely(findInFile); });
$('#file-results-toggle').addEventListener('click', () => { state.fileResultsOpen = !state.fileResultsOpen; updateViewerCount(); });
$('#close-file-results').addEventListener('click', () => { state.fileResultsOpen = false; updateViewerCount(); });
$('#file-results-list').addEventListener('scroll', scheduleFileResults);
$('#file-results-list').addEventListener('click', event => { const result = event.target.closest('[data-file-match]'); if (result) safely(() => goToFileMatch(Number(result.dataset.fileMatch), true)); });
$('#file-results-list').addEventListener('keydown', event => {
  if (!['ArrowDown', 'ArrowUp', 'Enter'].includes(event.key) || !state.viewerMatches.length) return;
  event.preventDefault();
  const index = event.key === 'Enter' ? Math.max(0, state.viewerMatchIndex) : Math.max(0, Math.min(state.viewerMatches.length - 1, state.viewerMatchIndex + (event.key === 'ArrowDown' ? 1 : -1)));
  const container = $('#file-results-list');
  if (index * FILE_RESULT_ROW_HEIGHT < container.scrollTop || (index + 1) * FILE_RESULT_ROW_HEIGHT > container.scrollTop + container.clientHeight) container.scrollTop = Math.max(0, index * FILE_RESULT_ROW_HEIGHT - container.clientHeight / 2);
  safely(() => goToFileMatch(index, true));
});
$('#copy-file-results').addEventListener('click', () => safely(async () => {
  const text = state.viewerMatches.map(row => `L${row.lineNumber}\t${row.text}`).join('\n');
  if (new TextEncoder().encode(text).length > 4 * 1024 * 1024) { toast('복사할 결과가 4MB를 넘습니다. 레벨·제외 조건으로 범위를 줄여 주세요.'); return; }
  await api.copy(text); toast(`${number(state.viewerMatches.length)}개 파일 검색 결과를 복사했습니다.`);
}));
$('#trace-search').addEventListener('click', () => safely(traceAcrossFiles));
$('#copy-path').addEventListener('click', () => safely(async () => { const file = state.files.find(file => file.id === state.activeFile); if (file) { await api.copy(file.path); toast('전체 경로를 복사했습니다.'); } }));
$('#find-next').addEventListener('click', () => safely(() => navigateMatch(1)));
$('#find-prev').addEventListener('click', () => safely(() => navigateMatch(-1)));
$('#matches-only').addEventListener('click', () => { if (!$('#viewer-query').value.trim()) { $('#viewer-query').focus(); toast('현재 파일에서 찾을 검색어를 먼저 입력해 주세요.'); return; } state.matchesOnly = !state.matchesOnly; setToggle('#matches-only', state.matchesOnly); $('#viewer-content').scrollTop = 0; renderViewer(); });
$('#wrap-toggle').addEventListener('click', () => { state.wrap = !state.wrap; setToggle('#wrap-toggle', state.wrap); renderViewer(); });
$('#highlight-button').addEventListener('click', () => { $('#highlight-panel').hidden = !$('#highlight-panel').hidden; if (!$('#highlight-panel').hidden) $('#highlight-terms').focus(); });
$('#highlight-terms').value = state.highlightTerms.join(', ');
$('#highlight-terms').addEventListener('input', () => { state.highlightTerms = $('#highlight-terms').value.split(',').map(x => x.trim()).filter(Boolean).slice(0, 12); store('highlights', state.highlightTerms); renderViewer(); });
$('#tail-toggle').addEventListener('click', toggleTail);
$('#reveal-button').addEventListener('click', () => { if (state.activeFile) safely(() => api.reveal(state.activeFile)); });
$('#bookmark-line').addEventListener('click', toggleBookmark);
$('#copy-line').addEventListener('click', () => safely(async () => { const row = selectedLine(); if (row) { await api.copy(row.text); toast('선택한 행을 복사했습니다.'); } }));
$('#detail-button').addEventListener('click', () => { state.showDetail = !state.showDetail; $('#line-detail').hidden = !state.showDetail; if (state.showDetail) renderDetail(); });
$('#line-detail').addEventListener('click', event => { if (event.target.closest('[data-close-detail]')) { state.showDetail = false; $('#line-detail').hidden = true; } });
$('#page-prev').addEventListener('click', () => { if (state.matchesOnly && state.wrap) { state.matchPage = Math.max(0, state.matchPage - 1); $('#viewer-content').scrollTop = 0; renderViewer(); } else safely(() => loadViewer(Math.max(1, (state.viewer?.rows[0]?.lineNumber || 1) - 200))); });
$('#page-next').addEventListener('click', () => { if (state.matchesOnly && state.wrap) { state.matchPage++; $('#viewer-content').scrollTop = 0; renderViewer(); } else safely(() => loadViewer((state.viewer?.rows.at(-1)?.lineNumber || 1) + 1)); });
$('#goto-button').addEventListener('click', showGoto);
let polling = false;
setInterval(async () => {
  if (!state.tail || !state.activeFile || !state.viewer || polling) return;
  polling = true;
  try {
    const fileId = state.activeFile; const stat = await api.statFile(fileId);
    if (state.tail && fileId === state.activeFile && (stat.size !== state.viewer.size || stat.mtimeMs !== state.viewer.mtimeMs)) {
      await loadViewer(state.currentLine, true, null, true);
      if ($('#viewer-query').value.trim()) await findInFile({ background: true });
    }
  } catch (error) { state.tail = false; setToggle('#tail-toggle', false); toast(`실시간 추적 중단: ${errorMessage(error)}`, true); }
  finally { polling = false; }
}, 1500);

// Modal actions and keyboard navigation.
$('#bookmarks-button').addEventListener('click', showBookmarks);
$('#help-button').addEventListener('click', showHelp);
$('#command-button').addEventListener('click', showCommands);
function applyFont() { document.documentElement.style.setProperty('--log-font-size', `${state.fontSize}px`); $('#font-size').textContent = `${state.fontSize}px`; store('fontSize', state.fontSize); }
$('#font-down').addEventListener('click', () => { state.fontSize = Math.max(10, state.fontSize - 1); applyFont(); });
$('#font-up').addEventListener('click', () => { state.fontSize = Math.min(17, state.fontSize + 1); applyFont(); });
applyFont();
$('#modal').addEventListener('click', event => safely(async () => {
  if (event.target === $('#modal') || event.target.closest('[data-close-modal]')) closeModal();
  const history = event.target.closest('[data-history]');
  if (history) { applyOptions(state.history[Number(history.dataset.history)]); closeModal(); await startSearch(); }
  const bookmark = event.target.closest('[data-bookmark]');
  if (bookmark) {
    const item = state.bookmarks[Number(bookmark.dataset.bookmark)];
    const file = state.files.find(file => file.path === item.path);
    if (file) { closeModal(); await openFile(file.id, item.line); }
    else toast('이 북마크의 파일을 먼저 워크스페이스에 추가해 주세요.');
  }
  const removeBookmark = event.target.closest('[data-delete-bookmark]');
  if (removeBookmark) { state.bookmarks.splice(Number(removeBookmark.dataset.deleteBookmark), 1); store('bookmarks', state.bookmarks); renderSaved(); renderViewer(); showBookmarks(); }
  const command = event.target.closest('[data-command]'); if (command) await runCommand(command.dataset.command);
  if (event.target.closest('#goto-submit')) await gotoSubmit();
  if (event.target.closest('#clear-confirm')) {
    closeModal(); await api.clear();
    applyOptions({ query: '' }); $('#file-filter').value = '';
    $('#viewer-query').value = ''; $('#viewer-exclude').value = ''; $('#viewer-level').value = '';
    state.viewerRegex = false; state.viewerCase = false; state.viewerMode = 'literal'; state.matchesOnly = false;
    updateViewerQueryUI();
    setToggle('#viewer-regex', false); setToggle('#viewer-case', false); setToggle('#matches-only', false);
    $('#filters-panel').hidden = true; $('#filters-button').classList.remove('active');
    state.resultsScroll = 0; state.viewerScroll = 0; state.fileResultsScroll = 0;
    await acceptWorkspace({ files: [], demo: false }); switchWorkspace('results');
    $('#results-summary').textContent = '작업 공간을 초기화했습니다. 폴더 또는 파일을 가져와 시작하세요.';
    toast('작업 공간을 초기화했습니다. 원본 파일과 저장한 검색·북마크는 유지됩니다.');
  }
}));
$('#modal').addEventListener('input', event => { if (event.target.id === 'command-input') renderCommands(event.target.value); });
$('#modal').addEventListener('keydown', event => { if (event.key === 'Enter' && event.target.id === 'goto-input') { event.preventDefault(); safely(gotoSubmit); } if (event.key === 'Enter' && event.target.id === 'command-input') { event.preventDefault(); const first = $('#command-list [data-command]'); if (first) safely(() => runCommand(first.dataset.command)); } });
document.addEventListener('keydown', event => {
  const mod = event.ctrlKey || event.metaKey;
  if (mod && event.key.toLowerCase() === 'k') { event.preventDefault(); showCommands(); return; }
  if ($('#modal').open) return;
  if (mod && ['1', '2'].includes(event.key)) { event.preventDefault(); switchWorkspace(event.key === '1' ? 'results' : 'viewer', true); }
  if (mod && event.key.toLowerCase() === 'f') { event.preventDefault(); switchWorkspace(event.shiftKey ? 'results' : 'viewer'); (event.shiftKey ? $('#query') : $('#viewer-query')).focus(); (event.shiftKey ? $('#query') : $('#viewer-query')).select(); }
  if (mod && event.key.toLowerCase() === 'g') { event.preventDefault(); showGoto(); }
  if (mod && event.key.toLowerCase() === 'b') { event.preventDefault(); toggleBookmark(); }
  if (event.key === 'F3') { event.preventDefault(); safely(() => navigateMatch(event.shiftKey ? -1 : 1)); }
  if (event.key === 'Escape') { if (state.workspace === 'viewer' && state.viewerFinding) cancelFileSearch(); else if (state.searching) cancelSearch(); }
  if (event.key === '?' && !event.target.matches('input,textarea,select')) showHelp();
});
$$('[data-window]').forEach(button => button.addEventListener('click', () => api.windowControl(button.dataset.window)));

// Drag/drop and adjustable file-search results height.
let dragDepth = 0;
document.addEventListener('dragenter', event => { if ([...event.dataTransfer.types].includes('Files')) { event.preventDefault(); dragDepth++; $('#drop-overlay').hidden = false; } });
document.addEventListener('dragover', event => { event.preventDefault(); if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'; });
document.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; $('#drop-overlay').hidden = true; } });
document.addEventListener('drop', event => {
  event.preventDefault(); dragDepth = 0; $('#drop-overlay').hidden = true;
  const dropped = api.pathsForFiles([...event.dataTransfer.files]);
  if (dropped.length) safely(async () => { setStatus('파일 목록을 읽고 있습니다…'); await acceptWorkspace(await api.addPaths(dropped)); if ($('#query').value.trim()) await startSearch(); });
});
const split = $('#file-results-splitter');
function setFileResultsHeight(height) {
  height = Math.max(125, Math.min(450, height));
  $('#viewer-panel').style.setProperty('--file-results-height', `${height}px`);
  store('fileResultsHeight', height); scheduleFileResults();
}
setFileResultsHeight(stored('fileResultsHeight', 230));
split.addEventListener('pointerdown', event => {
  const initial = $('#file-results-panel').getBoundingClientRect().height;
  const startY = event.clientY;
  split.setPointerCapture(event.pointerId); document.body.style.cursor = 'row-resize';
  const move = event => {
    setFileResultsHeight(initial + startY - event.clientY);
  };
  const end = () => { document.body.style.cursor = ''; split.removeEventListener('pointermove', move); split.removeEventListener('pointerup', end); };
  split.addEventListener('pointermove', move); split.addEventListener('pointerup', end, { once: true });
});
split.addEventListener('keydown', event => { if (['ArrowUp', 'ArrowDown'].includes(event.key)) { event.preventDefault(); setFileResultsHeight(stored('fileResultsHeight', 230) + (event.key === 'ArrowUp' ? 20 : -20)); } });
new ResizeObserver(() => { scheduleResults(); scheduleFileResults(); if (state.workspace === 'viewer' && state.matchesOnly) renderViewer(); }).observe($('#investigation'));
new ResizeObserver(scheduleFileResults).observe($('#file-results-list'));

async function boot() {
  renderSaved(); renderFiles(); renderResults(); renderTabs(); renderViewer();
  const bootstrap = await api.bootstrap();
  if (bootstrap.files.length || bootstrap.hasSavedWorkspace) await acceptWorkspace(bootstrap);
  else {
    await acceptWorkspace(await api.demo());
    applyOptions({ query: 'timeout' });
    await startSearch();
  }
  state.booting = false;
}
safely(boot);
