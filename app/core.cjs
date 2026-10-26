const fs = require('node:fs');
const path = require('node:path');
const iconv = require('iconv-lite');

const MAX_LINE_BYTES = 256 * 1024;
const LEVELS = ['TRACE', 'DEBUG', 'INFO', 'WARN', 'ERROR', 'FATAL'];
const INDEX_STRIDE = 512;

async function detectEncoding(file, selected = 'auto') {
  if (selected !== 'auto') {
    if (!['utf8', 'utf16le', 'cp949'].includes(selected)) throw new Error('지원하지 않는 인코딩입니다.');
    return selected;
  }
  const handle = await fs.promises.open(file, 'r');
  try {
    const buffer = Buffer.alloc(8192);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    const sample = buffer.subarray(0, bytesRead);
    if (sample[0] === 0xff && sample[1] === 0xfe) return 'utf16le';
    // Fatal streaming decoding allows an incomplete multibyte character at sample end.
    try { new TextDecoder('utf-8', { fatal: true }).decode(sample, { stream: true }); return 'utf8'; }
    catch { return 'cp949'; }
  } finally { await handle.close(); }
}

/** Stream physical lines with exact byte offsets, bounding memory even for huge lines. */
async function* readLines(file, { encoding = 'utf8', start = 0, startLine = 1 } = {}) {
  const stream = fs.createReadStream(file, { start, highWaterMark: 128 * 1024 });
  const wide = encoding === 'utf16le';
  let carry = Buffer.alloc(0);
  let pieces = [];
  let kept = 0;
  let length = 0;
  let offset = start;
  let number = startLine;
  const keep = (part) => {
    length += part.length;
    if (kept < MAX_LINE_BYTES) {
      const next = part.subarray(0, MAX_LINE_BYTES - kept);
      pieces.push(next);
      kept += next.length;
    }
  };
  const finish = (newlineBytes) => {
    let data = Buffer.concat(pieces, kept);
    if (wide ? data.length >= 2 && data[data.length - 2] === 13 && data[data.length - 1] === 0 : data[data.length - 1] === 13) {
      data = data.subarray(0, data.length - (wide ? 2 : 1));
    }
    let text = iconv.decode(data, encoding);
    if (number === 1) text = text.replace(/^\uFEFF/, '');
    const record = { lineNumber: number++, text, offset, truncated: length > MAX_LINE_BYTES };
    offset += length + newlineBytes;
    pieces = []; kept = 0; length = 0;
    return record;
  };
  try {
    for await (const chunk of stream) {
      let data = carry.length ? Buffer.concat([carry, chunk]) : chunk;
      carry = Buffer.alloc(0);
      if (wide && data.length % 2) { carry = data.subarray(data.length - 1); data = data.subarray(0, data.length - 1); }
      let from = 0;
      for (let i = 0; i < data.length; i += wide ? 2 : 1) {
        if (data[i] === 10 && (!wide || data[i + 1] === 0)) {
          keep(data.subarray(from, i));
          yield finish(wide ? 2 : 1);
          from = i + (wide ? 2 : 1);
        }
      }
      keep(data.subarray(from));
    }
    if (carry.length) keep(carry);
    if (length) yield finish(0);
  } finally { stream.destroy(); }
}

function metadata(text) {
  const match = text.match(/\b(TRACE|DEBUG|INFO|WARN(?:ING)?|ERROR|FATAL|CRITICAL)\b/i);
  const rawLevel = match?.[1]?.toUpperCase();
  const level = rawLevel === 'WARNING' ? 'WARN' : rawLevel === 'CRITICAL' ? 'FATAL' : rawLevel || 'OTHER';
  const time = text.match(/\b\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:[.,]\d{1,3})?(?:Z|[+-]\d{2}:\d{2})?/);
  return { level, timestamp: time?.[0] || '' };
}

function escapeRegex(value) { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

function queryTerms(query) {
  const terms = [];
  let term = '', quoted = false;
  for (let index = 0; index < query.length; index++) {
    const character = query[index];
    if (quoted && character === '\\' && query[index + 1] === '"') { term += '"'; index++; }
    else if (character === '"') quoted = !quoted;
    else if (!quoted && /\s/u.test(character)) { if (term) terms.push(term); term = ''; }
    else term += character;
  }
  if (quoted) throw new Error('검색 문구의 큰따옴표가 닫히지 않았습니다. 예: timeout "connection refused"');
  if (term) terms.push(term);
  if (!terms.length) throw new Error('검색어를 하나 이상 입력해 주세요. 빈 따옴표는 검색 조건이 아닙니다.');
  return terms;
}

function compileQuery(options = {}) {
  const query = String(options.query || '').trim();
  if (query.length > 2000) throw new Error('검색어는 2,000자 이내로 입력해 주세요.');
  const flags = options.caseSensitive ? 'u' : 'iu';
  const terms = query && !options.regex && ['all', 'any'].includes(options.mode) ? queryTerms(query) : [query];
  let patterns;
  try {
    if (!query) patterns = [new RegExp('', flags)];
    else if (options.regex) patterns = [new RegExp(query, flags)];
    else {
      patterns = terms.map(term => new RegExp(options.wholeWord ? `(?<![\\p{L}\\p{N}_])${escapeRegex(term)}(?![\\p{L}\\p{N}_])` : escapeRegex(term), flags));
    }
  } catch (error) { throw new Error(`정규식이 올바르지 않습니다: ${error.message}`); }
  const exclude = String(options.exclude || '').split(',').map(s => s.trim()).filter(Boolean);
  const levels = new Set(options.levels || []);
  const from = options.from ? Date.parse(options.from) : null;
  const to = options.to ? Date.parse(options.to) : null;
  if ((options.from && !Number.isFinite(from)) || (options.to && !Number.isFinite(to))) throw new Error('시간 범위를 확인해 주세요.');
  if (from !== null && to !== null && from > to) throw new Error('시작 시간은 종료 시간보다 빨라야 합니다.');
  return {
    ranges(text) {
      const ranges = [];
      if (!query) return ranges;
      for (const pattern of patterns) {
        const re = new RegExp(pattern.source, pattern.flags + 'g');
        let match;
        while (ranges.length < 100 && (match = re.exec(text))) {
          if (match[0].length) ranges.push({ start: match.index, end: match.index + match[0].length });
          else re.lastIndex += text.codePointAt(re.lastIndex) > 0xffff ? 2 : 1;
        }
      }
      return ranges;
    },
    test(text, meta = metadata(text)) {
      if (levels.size && !levels.has(meta.level)) return false;
      if (from !== null || to !== null) {
        const time = Date.parse(meta.timestamp.replace(',', '.'));
        if (!Number.isFinite(time) || (from !== null && time < from) || (to !== null && time > to)) return false;
      }
      const haystack = options.caseSensitive ? text : text.toLocaleLowerCase();
      if (exclude.some(term => haystack.includes(options.caseSensitive ? term : term.toLocaleLowerCase()))) return false;
      return options.mode === 'any' && !options.regex ? patterns.some(r => r.test(text)) : patterns.every(r => r.test(text));
    }
  };
}

function globMatch(file, patterns) {
  if (!String(patterns || '').trim()) return true;
  return String(patterns).split(',').some(pattern => {
    pattern = pattern.trim().replace(/\\/g, '/');
    if (!pattern) return false;
    let source = '';
    for (let i = 0; i < pattern.length; i++) {
      if (pattern[i] === '*' && pattern[i + 1] === '*') {
        if (pattern[i + 2] === '/') { source += '(?:.*/)?'; i += 2; }
        else { source += '.*'; i++; }
      } else if (pattern[i] === '*') source += '[^/]*';
      else if (pattern[i] === '?') source += '[^/]';
      else source += escapeRegex(pattern[i]);
    }
    const target = pattern.includes('/') ? file.replace(/\\/g, '/') : path.basename(file);
    return new RegExp(`^${source}$`, 'i').test(target);
  });
}

module.exports = { readLines, metadata, compileQuery, globMatch, detectEncoding, LEVELS, INDEX_STRIDE, MAX_LINE_BYTES };
