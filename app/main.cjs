const { app, BrowserWindow, ipcMain, dialog, shell, clipboard, Menu } = require('electron');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { Worker } = require('node:worker_threads');
const { pathToFileURL } = require('node:url');
const { readLines, metadata, compileQuery, INDEX_STRIDE } = require('./core.cjs');

if (process.env.LOGSCOPE_PROFILE) app.setPath('userData', path.resolve(process.env.LOGSCOPE_PROFILE));
let win;
const files = new Map();
const indexes = new Map();
const jobs = new Map();
const indexWorkers = new Set();
let nextFileId = 1;
let exportRows = [];
let workspaceDemo = false;
const documentUrl = pathToFileURL(path.join(__dirname, 'renderer/index.html')).href;
const supported = new Set(['.log', '.txt', '.jsonl', '.ndjson', '.out', '.err', '.trace', '.csv', '.json']);
const statePath = () => path.join(app.getPath('userData'), 'workspace.json');
const send = (event, payload) => { if (win && !win.isDestroyed()) win.webContents.send(event, payload); };
const getFile = id => { const file = files.get(id); if (!file) throw new Error('파일을 다시 추가해 주세요.'); return file; };

function persist() {
  try {
    fs.mkdirSync(app.getPath('userData'), { recursive: true });
    fs.writeFileSync(statePath(), JSON.stringify({ paths: workspaceDemo ? [] : [...files.values()].map(f => f.path) }));
  } catch (error) { send('notice', `작업 공간 저장 실패: ${error.message}`); }
}

async function addPaths(paths, demo = false) {
  if (!Array.isArray(paths) || paths.length > 10000) throw new Error('파일은 한 번에 최대 10,000개 추가할 수 있습니다.');
  if (workspaceDemo && !demo) { files.clear(); indexes.clear(); workspaceDemo = false; }
  const existing = new Set([...files.values()].map(f => process.platform === 'win32' ? f.path.toLowerCase() : f.path));
  const errors = [];
  let capped = false;
  async function visit(input, root, explicit = false) {
    if (files.size >= 10000) { capped = true; return; }
    try {
      const absolute = path.resolve(input);
      const stat = await fsp.lstat(absolute);
      if (stat.isSymbolicLink()) return;
      if (stat.isDirectory()) {
        if (['node_modules', '.git', '$RECYCLE.BIN', 'System Volume Information'].includes(path.basename(absolute))) return;
        const children = await fsp.readdir(absolute);
        for (const child of children) {
          if (files.size >= 10000) { capped = true; break; }
          await visit(path.join(absolute, child), root || absolute);
        }
      } else if (stat.isFile() && (explicit || supported.has(path.extname(absolute).toLowerCase()))) {
        const key = process.platform === 'win32' ? absolute.toLowerCase() : absolute;
        if (existing.has(key)) return;
        const id = `f${nextFileId++}`;
        files.set(id, { id, path: absolute, name: path.basename(absolute), relativePath: root ? path.relative(root, absolute) : path.basename(absolute), size: stat.size, mtimeMs: stat.mtimeMs });
        existing.add(key);
      }
    } catch (error) { errors.push({ path: input, message: error.message }); }
  }
  for (const input of paths) { if (typeof input === 'string' && input) await visit(input, null, true); }
  workspaceDemo = demo;
  persist();
  return { files: [...files.values()], errors, capped, demo: workspaceDemo };
}

async function getIndex(file, selected = 'auto') {
  const stat = await fsp.stat(file.path);
  const key = `${file.id}:${selected}`;
  const cached = indexes.get(key);
  if (cached && cached.size === stat.size && cached.mtimeMs === stat.mtimeMs && cached.ino === stat.ino && cached.birthtimeMs === stat.birthtimeMs) return cached.promise;
  let resume;
  if (cached && stat.size > cached.size && cached.ino === stat.ino && cached.birthtimeMs === stat.birthtimeMs) {
    try {
      const previous = await cached.promise;
      const sample = Buffer.alloc(Math.min(128, cached.size));
      const handle = await fsp.open(file.path, 'r');
      try { await handle.read(sample, 0, sample.length, Math.max(0, cached.size - sample.length)); }
      finally { await handle.close(); }
      if (sample.toString('hex') === previous.tailSample) resume = previous;
    } catch { /* fall back to a full index if the file changed */ }
  }
  const worker = new Worker(path.join(__dirname, 'worker.cjs'), { workerData: { task: 'index', file, encoding: selected, resume } });
  indexWorkers.add(worker);
  let settled = false;
  const promise = new Promise((resolve, reject) => {
    worker.on('message', message => {
      if (message.type === 'indexed') { settled = true; resolve(message); }
      else if (message.type === 'error') { settled = true; reject(new Error(message.message)); }
    });
    worker.on('error', error => { settled = true; reject(error); });
    worker.on('exit', code => { indexWorkers.delete(worker); if (!settled) reject(new Error(`인덱스 작업이 종료되었습니다 (${code}).`)); });
  });
  indexes.set(key, { size: stat.size, mtimeMs: stat.mtimeMs, ino: stat.ino, birthtimeMs: stat.birthtimeMs, promise });
  try { return await promise; } catch (error) { indexes.delete(key); throw error; }
}

async function readWindow({ fileId, line = 1, count = 240, encoding = 'auto', tail = false }) {
  const file = getFile(fileId);
  const index = await getIndex(file, encoding);
  count = Math.max(20, Math.min(Number(count) || 240, 1000));
  const center = tail ? index.totalLines : Math.max(1, Math.min(Number(line) || 1, index.totalLines));
  const startLine = Math.max(1, Math.min(center - (tail ? count - 1 : Math.floor(count / 3)), Math.max(1, index.totalLines - count + 1)));
  const checkpoint = index.checkpoints[Math.floor((startLine - 1) / INDEX_STRIDE)] || { lineNumber: 1, offset: 0 };
  const rows = [];
  for await (const record of readLines(file.path, { encoding: index.encoding, start: checkpoint.offset, startLine: checkpoint.lineNumber })) {
    if (record.lineNumber < startLine) continue;
    rows.push({ ...record, ...metadata(record.text) });
    if (rows.length >= count) break;
  }
  const stat = await fsp.stat(file.path);
  return { file, rows, totalLines: index.totalLines, encoding: index.encoding, size: stat.size, mtimeMs: stat.mtimeMs };
}

function stopJob(kind) {
  const job = jobs.get(kind);
  if (!job) return;
  clearInterval(job.watchdog);
  job.worker.terminate();
  jobs.delete(kind);
}

function removeFiles(ids) {
  if (!Array.isArray(ids) || ids.length > 10000 || ids.some(id => typeof id !== 'string')) throw new Error('제거할 파일 목록을 확인해 주세요.');
  stopJob('global'); stopJob('viewer'); exportRows = [];
  for (const id of new Set(ids)) {
    files.delete(id);
    for (const key of indexes.keys()) if (key.startsWith(`${id}:`)) indexes.delete(key);
  }
  if (!files.size) workspaceDemo = false;
  persist();
  return [...files.values()];
}

function launchSearch(kind, request) {
  stopJob(kind);
  const options = request.options || {};
  compileQuery(options);
  const selected = request.fileIds ? request.fileIds.map(getFile) : [...files.values()];
  const requestId = String(request.requestId).slice(0, 100);
  if (kind === 'global') exportRows = [];
  const worker = new Worker(path.join(__dirname, 'worker.cjs'), { workerData: { task: 'search', files: selected, options } });
  let lastResponse = Date.now();
  const finish = () => {
    const job = jobs.get(kind);
    if (job?.worker === worker) { clearInterval(job.watchdog); jobs.delete(kind); }
  };
  worker.on('message', message => {
    if (jobs.get(kind)?.worker !== worker) return;
    lastResponse = Date.now();
    if (kind === 'global' && message.type === 'batch') exportRows.push(...message.rows);
    send('search-event', { ...message, kind, requestId });
    if (['done', 'error'].includes(message.type)) finish();
  });
  worker.on('error', error => { send('search-event', { type: 'error', kind, requestId, message: error.message }); finish(); });
  worker.on('exit', code => {
    if (jobs.get(kind)?.worker === worker) { send('search-event', { type: 'error', kind, requestId, message: `검색 작업이 종료되었습니다 (${code}).` }); finish(); }
  });
  const watchdog = setInterval(() => {
    if (Date.now() - lastResponse > 30000) {
      send('search-event', { type: 'error', kind, requestId, message: '30초 동안 응답이 없어 검색을 중단했습니다. 정규식이나 검색 범위를 줄여 주세요.' });
      stopJob(kind);
    }
  }, 1000);
  jobs.set(kind, { worker, watchdog });
  return { requestId };
}

function handle(channel, fn) {
  ipcMain.handle(channel, async (event, ...args) => {
    if (!win || event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame) throw new Error('접근할 수 없습니다.');
    return fn(...args);
  });
}

function registerIpc() {
  handle('bootstrap', async () => {
    let saved;
    try { saved = JSON.parse(await fsp.readFile(statePath(), 'utf8')); } catch { /* first launch */ }
    if (!files.size && saved?.paths?.length) await addPaths(saved.paths);
    return { files: [...files.values()], demo: workspaceDemo, hasSavedWorkspace: Array.isArray(saved?.paths), version: app.getVersion(), platform: process.platform };
  });
  handle('choose', async kind => {
    const result = await dialog.showOpenDialog(win, {
      title: kind === 'folder' ? '로그 폴더 추가' : '로그 파일 추가',
      properties: kind === 'folder' ? ['openDirectory', 'multiSelections'] : ['openFile', 'multiSelections'],
      filters: kind === 'folder' ? undefined : [{ name: '로그 파일', extensions: [...supported].map(x => x.slice(1)) }, { name: '모든 파일', extensions: ['*'] }]
    });
    return result.canceled ? null : addPaths(result.filePaths);
  });
  handle('add-paths', paths => addPaths(paths));
  handle('demo', async () => {
    stopJob('global'); stopJob('viewer'); files.clear(); indexes.clear();
    return addPaths([path.join(__dirname, '../examples')], true);
  });
  handle('remove-file', id => removeFiles([id]));
  handle('remove-files', removeFiles);
  handle('clear-workspace', () => { stopJob('global'); stopJob('viewer'); files.clear(); indexes.clear(); exportRows = []; workspaceDemo = false; persist(); return []; });
  handle('search', request => launchSearch('global', request));
  handle('find-file', request => launchSearch('viewer', { ...request, fileIds: [request.fileId] }));
  handle('cancel', kind => { stopJob(kind === 'viewer' ? 'viewer' : 'global'); return true; });
  handle('read-window', readWindow);
  handle('stat-file', async id => { const stat = await fsp.stat(getFile(id).path); return { size: stat.size, mtimeMs: stat.mtimeMs }; });
  handle('reveal-file', id => { shell.showItemInFolder(getFile(id).path); });
  handle('copy', text => { clipboard.writeText(String(text).slice(0, 4 * 1024 * 1024)); return true; });
  handle('export', async () => {
    if (!exportRows.length) throw new Error('내보낼 검색 결과가 없습니다.');
    const result = await dialog.showSaveDialog(win, { title: '검색 결과 내보내기', defaultPath: 'logscope-results.csv', filters: [{ name: 'CSV', extensions: ['csv'] }, { name: 'JSON', extensions: ['json'] }] });
    if (result.canceled) return null;
    const rows = exportRows.map(row => ({ file: getFile(row.fileId).path, line: row.lineNumber, level: row.level, timestamp: row.timestamp, text: row.text }));
    const cell = value => {
      let text = String(value ?? '');
      if (/^[=+@\-\t\r]/.test(text)) text = `'${text}`;
      return `"${text.replace(/"/g, '""')}"`;
    };
    const output = path.extname(result.filePath).toLowerCase() === '.json' ? JSON.stringify(rows, null, 2) : '\uFEFF' + ['file,line,level,timestamp,text', ...rows.map(row => Object.values(row).map(cell).join(','))].join('\r\n');
    await fsp.writeFile(result.filePath, output, 'utf8');
    return result.filePath;
  });
  handle('window-control', action => {
    if (action === 'minimize') win.minimize();
    if (action === 'maximize') win.isMaximized() ? win.unmaximize() : win.maximize();
    if (action === 'close') win.close();
  });
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  registerIpc();
  win = new BrowserWindow({
    title: 'Logscope', width: 1560, height: 980, minWidth: 1100, minHeight: 720,
    icon: path.join(__dirname, 'assets/icon.png'),
    backgroundColor: '#101316', frame: false, show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true }
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event, url) => { if (url !== documentUrl) event.preventDefault(); });
  win.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  win.once('ready-to-show', () => { if (process.env.LOGSCOPE_TEST !== '1') win.show(); });
  win.loadURL(documentUrl);
});
app.on('window-all-closed', () => {
  for (const kind of jobs.keys()) stopJob(kind);
  for (const worker of indexWorkers) worker.terminate();
  app.quit();
});
