const { parentPort, workerData } = require('node:worker_threads');
const fs = require('node:fs/promises');
const { readLines, metadata, compileQuery, globMatch, detectEncoding, INDEX_STRIDE } = require('./core.cjs');

async function search({ files, options }) {
  const matcher = compileQuery(options);
  const limit = Math.max(1, Math.min(Number(options.limit) || 20000, 100000));
  let count = 0, scanned = 0, lines = 0, clippedLines = 0, resultBytes = 0;
  const byteLimit = 32 * 1024 * 1024;
  let batch = [];
  const errors = [];
  const counts = {};
  const started = Date.now();
  for (const file of files) {
    if (!globMatch(file.relativePath || file.name, options.glob)) { scanned++; continue; }
    try {
      const encoding = await detectEncoding(file.path, options.encoding);
      for await (const line of readLines(file.path, { encoding })) {
        lines++;
        if (line.truncated) clippedLines++;
        const meta = metadata(line.text);
        if (matcher.test(line.text, meta)) {
          counts[meta.level] = (counts[meta.level] || 0) + 1;
          batch.push({ ...line, ...meta, ranges: matcher.ranges(line.text), fileId: file.id, fileName: file.name, relativePath: file.relativePath, encoding });
          count++;
          resultBytes += Buffer.byteLength(line.text, 'utf8') + 256;
          if (batch.length >= 100) { parentPort.postMessage({ type: 'batch', rows: batch }); batch = []; }
          if (count >= limit || resultBytes >= byteLimit) break;
        }
        if (lines % 5000 === 0) parentPort.postMessage({ type: 'progress', scanned, total: files.length, lines, count });
      }
    } catch (error) { errors.push({ name: file.name, message: error.message }); }
    scanned++;
    parentPort.postMessage({ type: 'progress', scanned, total: files.length, lines, count });
    if (count >= limit || resultBytes >= byteLimit) break;
  }
  if (batch.length) parentPort.postMessage({ type: 'batch', rows: batch });
  parentPort.postMessage({ type: 'done', count, scanned, total: files.length, lines, clippedLines, counts, errors, limited: count >= limit || resultBytes >= byteLimit, memoryLimited: resultBytes >= byteLimit, elapsed: Date.now() - started });
}

async function index({ file, encoding: selected, resume }) {
  const before = await fs.stat(file.path);
  const encoding = await detectEncoding(file.path, selected);
  const checkpoints = resume?.encoding === encoding ? resume.checkpoints.slice(0, -1) : [];
  const start = resume?.encoding === encoding ? resume.checkpoints.at(-1) : null;
  let totalLines = start ? start.lineNumber - 1 : 0;
  for await (const line of readLines(file.path, { encoding, start: start?.offset || 0, startLine: start?.lineNumber || 1 })) {
    totalLines = line.lineNumber;
    if ((line.lineNumber - 1) % INDEX_STRIDE === 0) checkpoints.push({ lineNumber: line.lineNumber, offset: line.offset });
    if (totalLines % 100000 === 0) parentPort.postMessage({ type: 'index-progress', totalLines });
  }
  const handle = await fs.open(file.path, 'r');
  const sample = Buffer.alloc(Math.min(128, before.size));
  try { await handle.read(sample, 0, sample.length, Math.max(0, before.size - sample.length)); }
  finally { await handle.close(); }
  parentPort.postMessage({ type: 'indexed', encoding, checkpoints, totalLines, size: before.size, mtimeMs: before.mtimeMs, tailSample: sample.toString('hex') });
}

(workerData.task === 'index' ? index(workerData) : search(workerData)).catch(error => {
  parentPort.postMessage({ type: 'error', message: error.message });
});
