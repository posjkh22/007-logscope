const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { Worker } = require('node:worker_threads');
const iconv = require('iconv-lite');
const { readLines, compileQuery, metadata, detectEncoding, globMatch, MAX_LINE_BYTES } = require('../app/core.cjs');
let directory;
before(async () => { directory = await fs.mkdtemp(path.join(os.tmpdir(), 'logscope-core-')); });
after(async () => {
  assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
  assert.ok(path.basename(directory).startsWith('logscope-core-'));
  await fs.rm(directory, { recursive: true, force: true });
});
const collect = async generator => { const rows = []; for await (const row of generator) rows.push(row); return rows; };
function runWorker(data) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(path.join(__dirname, '../app/worker.cjs'), { workerData: data });
    const events = [];
    worker.on('message', event => { events.push(event); if (event.type === 'error') reject(new Error(event.message)); });
    worker.on('error', reject);
    worker.on('exit', code => code === 0 ? resolve(events) : reject(new Error(`Exit ${code}`)));
  });
}

test('UTF-8 CRLF, BOM, empty lines and byte offsets survive random access', async () => {
  const file = path.join(directory, 'utf8.log');
  const text = '\uFEFF첫째 로그\r\n\r\n마지막 로그';
  await fs.writeFile(file, text);
  const rows = await collect(readLines(file));
  assert.deepEqual(rows.map(row => row.text), ['첫째 로그', '', '마지막 로그']);
  assert.equal(rows[1].offset, Buffer.byteLength('\uFEFF첫째 로그\r\n'));
  const resumed = await collect(readLines(file, { start: rows[2].offset, startLine: 3 }));
  assert.equal(resumed[0].text, '마지막 로그');
  assert.equal(resumed[0].lineNumber, 3);
});

test('CP949 and UTF-16LE preserve Korean text and exact offsets', async () => {
  for (const encoding of ['cp949', 'utf16le']) {
    const file = path.join(directory, `${encoding}.log`);
    const input = `${encoding === 'utf16le' ? '\uFEFF' : ''}결제 실패\r\n한글 검색\n끝`;
    await fs.writeFile(file, iconv.encode(input, encoding));
    assert.equal(await detectEncoding(file), encoding);
    const rows = await collect(readLines(file, { encoding }));
    assert.deepEqual(rows.map(row => row.text), ['결제 실패', '한글 검색', '끝']);
    const resumed = await collect(readLines(file, { encoding, start: rows[1].offset, startLine: 2 }));
    assert.equal(resumed[0].text, '한글 검색');
  }
});

test('chunk boundaries, UTF-16 code units, final newline and long line bounds', async () => {
  const file = path.join(directory, 'boundary.log');
  const first = 'x'.repeat(128 * 1024 - 1);
  await fs.writeFile(file, `${first}\r\n한글\n${'z'.repeat(MAX_LINE_BYTES + 123)}\nlast\n`);
  const rows = await collect(readLines(file));
  assert.equal(rows.length, 4);
  assert.equal(rows[0].text, first);
  assert.equal(rows[1].text, '한글');
  assert.equal(rows[2].text.length, MAX_LINE_BYTES);
  assert.equal(rows[2].truncated, true);
  const resumed = await collect(readLines(file, { start: rows[3].offset, startLine: 4 }));
  assert.equal(resumed[0].text, 'last');
  const wide = path.join(directory, 'wide-boundary.log');
  await fs.writeFile(wide, iconv.encode('가'.repeat(65535) + '\r\n한글\n', 'utf16le'));
  assert.deepEqual((await collect(readLines(wide, { encoding: 'utf16le' }))).map(row => row.text), ['가'.repeat(65535), '한글']);
});

test('phrase, AND/OR, case, Unicode whole words, exclusions and regex ranges', () => {
  assert.equal(compileQuery({ query: '', wholeWord: true }).test('한글한단어'), true);
  assert.equal(compileQuery({ query: 'Connection timeout' }).test('ERROR connection timeout'), true);
  assert.equal(compileQuery({ query: 'timeout', caseSensitive: true }).test('TIMEOUT'), false);
  assert.equal(compileQuery({ query: '결제', wholeWord: true }).test('결제 처리'), true);
  assert.equal(compileQuery({ query: '결제', wholeWord: true }).test('결제완료'), false);
  assert.equal(compileQuery({ query: '"connection pool" timeout', mode: 'all' }).test('timeout in connection pool'), true);
  assert.equal(compileQuery({ query: 'timeout failed', mode: 'any' }).test('request failed'), true);
  assert.equal(compileQuery({ query: 'timeout', exclude: 'healthcheck, heartbeat' }).test('healthcheck timeout'), false);
  const regex = compileQuery({ query: 'duration=\\d+ms', regex: true });
  assert.equal(regex.test('duration=250ms'), true);
  assert.deepEqual(regex.ranges('duration=250ms'), [{ start: 0, end: 14 }]);
  assert.deepEqual(compileQuery({ query: '(?=.)', regex: true }).ranges('😀'), []);
  assert.throws(() => compileQuery({ query: '[', regex: true }), /정규식/);
});

test('multiple OR/AND conditions preserve phrases and literal punctuation', () => {
  const any = compileQuery({ query: 'timeout "connection refused" "결제 실패" conn[42]', mode: 'any' });
  for (const text of ['upstream TIMEOUT', 'connection refused by db', '주문 결제 실패', 'literal conn[42]']) assert.equal(any.test(text), true);
  assert.equal(any.test('connection established, refused after reconnect'), false);
  assert.equal(any.test('literal conn4'), false);
  const all = compileQuery({ query: 'timeout "connection refused"', mode: 'all' });
  assert.equal(all.test('connection refused after timeout'), true);
  assert.equal(all.test('connection refused only'), false);
  assert.equal(all.test('timeout only'), false);
  const ranges = compileQuery({ query: 'timeout failed', mode: 'any' }).ranges('timeout and failed and timeout');
  assert.deepEqual(ranges.map(range => 'timeout and failed and timeout'.slice(range.start, range.end)).sort(), ['failed', 'timeout', 'timeout']);
});

test('quoted terms validate syntax, ignore empty alternatives and allow escaped quotes', () => {
  const query = compileQuery({ query: 'timeout ""', mode: 'any' });
  assert.equal(query.test('normal log'), false);
  assert.equal(query.test('timeout'), true);
  assert.throws(() => compileQuery({ query: '""', mode: 'any' }), /검색어/);
  assert.throws(() => compileQuery({ query: 'timeout "connection refused', mode: 'any' }), /큰따옴표/);
  assert.equal(compileQuery({ query: '"connection \\"pool\\"" timeout', mode: 'any' }).test('connection "pool" ready'), true);
  assert.equal(compileQuery({ query: 'timeout|failed', mode: 'all', regex: true }).test('failed'), true);
  assert.equal(compileQuery({ query: 'timeout "connection', mode: 'literal' }).test('timeout "connection'), true);
});

test('level and time filters normalize WARNING/CRITICAL and reject missing dates', () => {
  assert.equal(metadata('2026-10-23 09:01:03.123 WARNING wait').level, 'WARN');
  assert.equal(metadata('{"level":"critical","message":"bad"}').level, 'FATAL');
  const query = compileQuery({ query: '', levels: ['ERROR'], from: '2026-10-23T09:00', to: '2026-10-23T10:00' });
  assert.equal(query.test('2026-10-23 09:30:00 ERROR failed'), true);
  assert.equal(query.test('2026-10-23 09:30:00 INFO fine'), false);
  assert.equal(query.test('ERROR failed'), false);
  assert.equal(query.test('2026-10-23 11:30:00 ERROR failed'), false);
  assert.throws(() => compileQuery({ from: '2026-10-23T10:00', to: '2026-10-23T09:00' }), /시작 시간/);
});

test('glob handles multiple patterns, nested paths and literal metacharacters', () => {
  assert.equal(globMatch('gateway.log', '**/*.log'), true);
  assert.equal(globMatch('nested/gateway.log', '**/*.log'), true);
  assert.equal(globMatch('server/a.txt', '**/server/*.txt, *.log'), true);
  assert.equal(globMatch('gateway.json', '*.log, *.txt'), false);
  assert.equal(globMatch('test[1].log', 'test[1].log'), true);
  assert.equal(globMatch('test1.log', 'test[1].log'), false);
});

test('worker streams matches across files, enforces limits and reports unreadable files', async () => {
  const a = path.join(directory, 'a.log'), b = path.join(directory, 'b.log');
  await fs.writeFile(a, 'INFO ready\nERROR timeout 1\nERROR timeout 2\n');
  await fs.writeFile(b, 'WARN timeout 3\n');
  const files = [a, b, path.join(directory, 'missing.log')].map((file, index) => ({ id: `f${index}`, path: file, name: path.basename(file) }));
  const events = await runWorker({ task: 'search', files, options: { query: 'timeout', encoding: 'auto' } });
  const rows = events.filter(event => event.type === 'batch').flatMap(event => event.rows);
  assert.equal(rows.length, 3);
  assert.equal(rows[0].lineNumber, 2);
  assert.equal(events.at(-1).errors.length, 1);
  assert.equal(events.at(-1).counts.ERROR, 2);
  const limited = await runWorker({ task: 'search', files, options: { query: 'timeout', limit: 2 } });
  assert.equal(limited.at(-1).limited, true);
  assert.equal(limited.at(-1).count, 2);
});

test('sparse index supports exact seeks in a 120,000-line file', async () => {
  const file = path.join(directory, 'large.log');
  await fs.writeFile(file, Array.from({ length: 120000 }, (_, i) => `2026-10-23 09:00:00 INFO 한글 행 ${i + 1}`).join('\n'));
  const events = await runWorker({ task: 'index', file: { path: file }, encoding: 'auto' });
  const index = events.at(-1);
  assert.equal(index.totalLines, 120000);
  assert.equal(index.checkpoints.length, Math.ceil(120000 / 512));
  const checkpoint = index.checkpoints.at(-1);
  const rows = await collect(readLines(file, { encoding: index.encoding, start: checkpoint.offset, startLine: checkpoint.lineNumber }));
  assert.equal(rows.at(-1).lineNumber, 120000);
  assert.match(rows.at(-1).text, /한글 행 120000$/);
});

test('incremental index rereads the trailing partial line and agrees with a full rebuild', async () => {
  const file = path.join(directory, 'append.log');
  await fs.writeFile(file, Array.from({ length: 1500 }, (_, i) => `한글 로그 ${i + 1}`).join('\n'));
  const initial = (await runWorker({ task: 'index', file: { path: file }, encoding: 'auto' })).at(-1);
  await fs.appendFile(file, ' 이어쓰기\n새 행\n');
  const incremental = (await runWorker({ task: 'index', file: { path: file }, encoding: 'auto', resume: initial })).at(-1);
  const rebuilt = (await runWorker({ task: 'index', file: { path: file }, encoding: 'auto' })).at(-1);
  assert.equal(incremental.totalLines, 1501);
  assert.deepEqual(incremental.checkpoints, rebuilt.checkpoints);
  assert.equal(incremental.tailSample, rebuilt.tailSample);
});

test('result byte budget stops a broad search before unlimited memory growth', async () => {
  const file = path.join(directory, 'memory.log');
  await fs.writeFile(file, ('INFO ' + 'x'.repeat(12000) + '\n').repeat(3000));
  const events = await runWorker({ task: 'search', files: [{ id: 'memory', path: file, name: 'memory.log' }], options: { query: '', limit: 100000 } });
  const done = events.at(-1);
  assert.equal(done.limited, true);
  assert.equal(done.memoryLimited, true);
  assert.ok(done.count < 3000);
});
