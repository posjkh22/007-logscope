const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const iconv = require('iconv-lite');
let app, page, directory;
const pageErrors = [];

test.beforeAll(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'logscope-e2e-'));
  const env = { ...process.env, LOGSCOPE_TEST: '1', LOGSCOPE_PROFILE: path.join(directory, 'profile') };
  delete env.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({ args: [path.join(__dirname, '../..')], env });
  page = await app.firstWindow();
  page.on('pageerror', error => pageErrors.push(error.message));
  await expect(page.locator('#result-count')).not.toHaveText('0');
  await expect(page.locator('#results-tab')).toHaveAttribute('aria-selected', 'true');
});
test.afterAll(async () => {
  if (app) await app.close();
  if (directory) {
    expect(path.dirname(path.resolve(directory))).toBe(path.resolve(os.tmpdir()));
    expect(path.basename(directory)).toMatch(/^logscope-e2e-/);
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('demo runs in isolated renderer and result opens exact source line', async () => {
  await expect(page.locator('#demo-badge')).toBeVisible();
  await expect(page.locator('.file-item')).toHaveCount(3);
  const security = await app.evaluate(({ BrowserWindow }) => {
    const options = BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences();
    return { sandbox: options.sandbox, isolation: options.contextIsolation, node: options.nodeIntegration };
  });
  expect(security).toEqual({ sandbox: true, isolation: true, node: false });
  expect(await page.evaluate(() => typeof window.require)).toBe('undefined');
  await expect(page.locator('.result-path').first()).toHaveText(path.join(__dirname, '../../examples/api-gateway.log'));
  const searchHeight = (await page.locator('#global-search').boundingBox()).height;
  expect(searchHeight).toBeLessThan(100);
  await page.screenshot({ path: 'test-results/logscope-results.png' });
  const target = page.locator('.result-row').nth(3);
  const line = (await target.locator('.result-number').textContent()).replace(/[L,]/g, '');
  await target.click();
  await expect(page.locator('.log-row.current')).toHaveAttribute('data-line', line);
  await expect(page.locator('.log-row.current')).toContainText('timeout');
  await expect(page.locator('#viewer-tab')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#global-search')).toBeHidden();
  await expect(page.locator('#results-panel')).toBeHidden();
  const mainWidth = (await page.locator('main').boundingBox()).width;
  expect((await page.locator('#viewer-panel').boundingBox()).width).toBeGreaterThan(mainWidth - 2);
  await page.keyboard.press('Control+1');
  await expect(page.locator('.result-row.selected')).toContainText(`L${line}`);
  await page.keyboard.press('Control+2');
  await expect(page.locator('.log-row.current')).toHaveAttribute('data-line', line);
});

test('whole-file find, next match, matches-only and bookmark persist in UI', async () => {
  await page.locator('#viewer-query').fill('timeout');
  await expect(page.locator('#viewer-find-count')).toHaveText(/\d+ \/ [1-9]\d*/, { timeout: 15000 });
  await expect(page.locator('#file-results-panel')).toBeVisible();
  await expect(page.locator('#file-results-count')).not.toHaveText('0');
  await page.locator('#file-results-list').evaluate(element => { element.scrollTop = 350; });
  const match = page.locator('[data-file-match="10"]');
  const matchLine = (await match.locator('.file-result-line').textContent()).replace(/[L,]/g, '');
  await match.click();
  await expect(page.locator('.log-row.current')).toHaveAttribute('data-line', matchLine);
  await expect(page.locator('#matches-only')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('[data-file-match="10"]')).toHaveClass(/selected/);
  await page.screenshot({ path: 'test-results/logscope-desktop.png' });
  const before = await page.locator('.log-row.current').getAttribute('data-line');
  await page.locator('#find-next').click();
  await expect(page.locator('.log-row.current')).not.toHaveAttribute('data-line', before);
  await page.locator('#bookmark-line').click();
  await expect(page.locator('#bookmark-count')).toHaveText('1');
  await page.locator('#matches-only').click();
  expect(await page.locator('.log-row').count()).toBeGreaterThan(1);
  await expect(page.locator('.log-row').first()).toContainText('timeout');
  await page.locator('#bookmarks-button').click();
  await expect(page.locator('.modal-bookmark')).toHaveCount(1);
  await page.keyboard.press('Escape');
});

test('file search level and exclude filters, case toggle, copy and panel sizing', async () => {
  await page.locator('#matches-only').click();
  await page.locator('#viewer-level').selectOption('ERROR');
  await expect(page.locator('#file-level-summary')).toContainText('ERROR');
  await expect(page.locator('#file-level-summary')).not.toContainText('WARN');
  await page.locator('#viewer-exclude').fill('payment-db');
  await expect(page.locator('#file-results-count')).toHaveText('0');
  await expect(page.locator('#file-results-list')).toContainText('일치하는 로그가 없습니다');
  await page.locator('#viewer-exclude').fill(''); await page.locator('#viewer-level').selectOption('');
  await expect(page.locator('#file-results-count')).not.toHaveText('0');
  await page.locator('#viewer-query').fill('TIMEOUT'); await page.locator('#viewer-case').click();
  await expect(page.locator('#file-results-count')).toHaveText('0');
  await page.locator('#viewer-case').click();
  await expect(page.locator('#file-results-count')).not.toHaveText('0');
  await page.locator('#copy-file-results').click();
  expect(await app.evaluate(({ clipboard }) => clipboard.readText())).toContain('timeout');
  const before = (await page.locator('#file-results-panel').boundingBox()).height;
  await page.locator('#file-results-splitter').focus(); await page.keyboard.press('ArrowUp');
  expect((await page.locator('#file-results-panel').boundingBox()).height).toBeGreaterThan(before);
  await page.locator('#close-file-results').click();
  await expect(page.locator('#file-results-panel')).toBeHidden();
  await page.locator('#file-results-toggle').click();
  await expect(page.locator('#file-results-panel')).toBeVisible();
  await page.locator('#viewer-query').fill('timeout');
  await expect(page.locator('#viewer-search-button')).toHaveText('파일 전체 검색');
  await page.locator('#viewer-regex').click(); await page.locator('#viewer-query').fill('[');
  await expect(page.locator('#file-results-status')).toContainText('정규식이 올바르지 않습니다');
  await page.locator('#viewer-query').fill('timeout'); await page.locator('#viewer-regex').click();
  await expect(page.locator('#file-results-count')).not.toHaveText('0');
});

test('regex error is actionable and valid search recovers', async () => {
  await page.locator('#results-tab').click();
  await page.locator('#query').fill('[');
  await page.locator('#regex-toggle').click();
  await page.locator('#search-button').click();
  await expect(page.locator('#results-summary')).toContainText('정규식이 올바르지 않습니다');
  await page.locator('#query').fill('timeout.*5000');
  await page.locator('#search-button').click();
  await expect(page.locator('#results-summary')).toContainText('건 일치');
  expect(Number((await page.locator('#result-count').textContent()).replace(/,/g, ''))).toBeGreaterThan(0);
  await page.locator('#regex-toggle').click();
});

test('real multi-file import, CP949, XSS, filters and JSON inspector', async () => {
  const real = path.join(directory, 'real'); await fs.mkdir(real);
  await fs.writeFile(path.join(real, 'korean.log'), iconv.encode('2026-10-23 09:00:00 INFO 결제 완료\n2026-10-23 09:01:00 ERROR 한글 timeout\n', 'cp949'));
  await fs.writeFile(path.join(real, 'server.jsonl'), [
    JSON.stringify({ timestamp: '2026-10-23T09:02:00', level: 'ERROR', message: 'timeout <img src=x onerror="window.pwned=true">', trace_id: 'abc123' }),
    JSON.stringify({ timestamp: '2026-10-23T09:03:00', level: 'WARN', message: 'timeout healthcheck' })
  ].join('\n'));
  // Replace the native dialog with deterministic paths; the production import code still runs.
  await app.evaluate(({ dialog }, input) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [input] }); }, real);
  await page.locator('#add-folder').click();
  await expect(page.locator('.file-item')).toHaveCount(2);
  await expect(page.locator('#demo-badge')).toBeHidden();
  await page.locator('#query').fill('timeout'); await page.locator('#search-button').click();
  await expect(page.locator('#result-count')).toHaveText('3');
  await page.locator('.result-row').filter({ hasText: 'korean.log' }).click();
  await expect(page.locator('.log-row.current')).toContainText('한글 timeout');
  await expect(page.locator('#status-encoding')).toHaveText('CP949');
  await page.locator('#copy-path').click();
  expect(await app.evaluate(({ clipboard }) => clipboard.readText())).toBe(path.join(real, 'korean.log'));
  await page.locator('#results-tab').click();
  await page.locator('.result-row').filter({ hasText: 'server.jsonl' }).first().click();
  await expect(page.locator('.log-row.current')).toContainText('<img src=x');
  expect(await page.evaluate(() => window.pwned)).toBeUndefined();
  await page.locator('#detail-button').click();
  await expect(page.locator('#line-detail')).toContainText('JSON INSPECTOR');
  await expect(page.locator('#line-detail')).toContainText('abc123');
  await page.locator('[data-close-detail]').click();
  await page.locator('#trace-search').click();
  await expect(page.locator('#query')).toHaveValue('abc123');
  await expect(page.locator('#result-count')).toHaveText('1');
  await page.locator('#query').fill('timeout'); await page.locator('#search-button').click();
  await expect(page.locator('#result-count')).toHaveText('3');
  await page.locator('[data-level="ERROR"]').click();
  await expect(page.locator('#result-count')).toHaveText('2');
  await page.locator('#filters-button').click();
  await page.locator('#glob').fill('*.jsonl');
  await page.locator('#search-button').click();
  await expect(page.locator('#result-count')).toHaveText('1');
  await page.locator('.result-row').first().click();
});

test('exports actual results, follows appended logs and handles truncation', async () => {
  const csv = path.join(directory, 'export.csv');
  await app.evaluate(({ dialog }, output) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: output }); }, csv);
  await page.locator('#export-button').click();
  await expect.poll(async () => { try { return await fs.readFile(csv, 'utf8'); } catch { return ''; } }).toContain('abc123');
  await page.locator('#tail-toggle').click();
  const file = path.join(directory, 'real/server.jsonl');
  await fs.appendFile(file, '\n2026-10-23 09:04:00 ERROR appended_live_marker\n');
  await expect(page.locator('#viewer-content')).toContainText('appended_live_marker', { timeout: 15000 });
  await fs.writeFile(file, '2026-10-23 09:05:00 INFO rotated_file_marker\n');
  await expect(page.locator('#viewer-content')).toContainText('rotated_file_marker', { timeout: 15000 });
  await page.locator('#tail-toggle').click();
});

test('keyboard command palette, goto and saved searches work without renderer errors', async () => {
  await page.keyboard.press('Control+k');
  await page.locator('#command-input').fill('행 번호');
  await page.keyboard.press('Enter');
  await expect(page.locator('#goto-input')).toBeVisible();
  await page.locator('#goto-input').fill('1'); await page.locator('#goto-submit').click();
  await expect(page.locator('.log-row.current')).toHaveAttribute('data-line', '1');
  await page.locator('#save-search').click();
  await expect(page.locator('[data-saved]')).toHaveCount(1);
  expect(pageErrors).toEqual([]);
});

test('large result virtualization, exact line seek and pathological regex cancellation', async () => {
  await page.locator('#workspace-menu').click(); await page.locator('#clear-confirm').click();
  const real = path.join(directory, 'large'); await fs.mkdir(real);
  await fs.writeFile(path.join(real, 'large.log'), Array.from({ length: 120000 }, (_, i) => `2026-10-23 09:00:00 INFO marker 한글 ${i + 1}`).join('\n'));
  await fs.writeFile(path.join(real, 'regex.log'), 'a'.repeat(200) + '!\n');
  await app.evaluate(({ dialog }, input) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [input] }); }, real);
  await page.locator('#add-folder').click(); await expect(page.locator('.file-item')).toHaveCount(2);
  await expect(page.locator('#search-button')).toContainText('검색');
  await page.locator('#reset-filters').click();
  await expect(page.locator('#search-button')).toContainText('검색');
  await page.locator('#query').fill('marker'); await page.locator('#search-button').click();
  await expect(page.locator('#result-count')).toHaveText('20,000', { timeout: 20000 });
  await expect(page.locator('#results-summary')).toContainText('상한 도달');
  expect(await page.locator('.result-row').count()).toBeLessThan(25);
  await page.locator('.result-row').first().click();
  await page.locator('#goto-button').click(); await page.locator('#goto-input').fill('119999'); await page.locator('#goto-submit').click();
  await expect(page.locator('.log-row.current')).toContainText('한글 119999');
  await page.locator('#viewer-query').fill('marker');
  await expect(page.locator('#file-results-count')).toHaveText('20,000', { timeout: 20000 });
  await expect(page.locator('#file-results-status')).toContainText('상한 도달');
  expect(await page.locator('.file-result-row').count()).toBeLessThan(40);
  await page.locator('#file-results-list').evaluate(element => { element.scrollTop = element.scrollHeight; });
  await page.locator('[data-file-match="19999"]').click();
  await expect(page.locator('.log-row.current')).toHaveAttribute('data-line', '20000');
  await page.locator('#results-tab').click();
  await page.locator('#query').fill('^(a+)+$'); await page.locator('#regex-toggle').click(); await page.locator('#search-button').click();
  await expect(page.locator('#search-button')).toContainText('중지');
  await expect(page.locator('#results-summary')).toContainText('1/2 파일', { timeout: 15000 });
  await page.locator('#search-button').click();
  await expect(page.locator('#search-button')).toContainText('검색');
  await expect(page.locator('#status-text')).toContainText('중지됨');
  await page.locator('#regex-toggle').click(); await page.locator('#query').fill('한글 119999'); await page.locator('#search-button').click();
  await expect(page.locator('#result-count')).toHaveText('1');
  expect(pageErrors).toEqual([]);
});

test('same-name files display distinct full paths and the tab layout fits a small window', async () => {
  await page.locator('#workspace-menu').click(); await page.locator('#clear-confirm').click();
  const root = path.join(directory, 'same-name');
  const first = path.join(root, 'first/app.log'), second = path.join(root, 'second/app.log');
  await fs.mkdir(path.dirname(first), { recursive: true }); await fs.mkdir(path.dirname(second), { recursive: true });
  await fs.writeFile(first, '2026-10-23 09:00:00 INFO needle first_source\n');
  await fs.writeFile(second, '2026-10-23 09:00:00 ERROR needle second_source\n');
  await app.evaluate(({ dialog }, input) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [input] }); }, root);
  await page.locator('#add-folder').click(); await expect(page.locator('.file-item')).toHaveCount(2);
  await expect(page.locator('#search-button')).toContainText('검색');
  await page.locator('#query').fill('needle'); await page.locator('#search-button').click();
  await expect(page.locator('#result-count')).toHaveText('2');
  await expect(page.locator('.result-path')).toHaveText([first, second]);
  await page.locator('.result-row').nth(1).click();
  await expect(page.locator('#viewer-path')).toHaveText(second);
  await expect(page.locator('.log-row.current')).toContainText('second_source');
  await page.locator('#viewer-query').fill('needle');
  await expect(page.locator('#file-results-count')).toHaveText('1');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1100, 720));
  await expect.poll(() => page.evaluate(() => window.innerWidth)).toBe(1100);
  const bodyWidth = await page.evaluate(() => ({ scroll: document.body.scrollWidth, client: document.body.clientWidth }));
  expect(bodyWidth.scroll).toBeLessThanOrEqual(bodyWidth.client);
  const content = await page.locator('#viewer-content').boundingBox();
  expect(content.height).toBeGreaterThanOrEqual(85);
  const results = await page.locator('#file-results-panel').boundingBox();
  const footer = await page.locator('.statusbar').boundingBox();
  expect(results.y + results.height).toBeLessThanOrEqual(footer.y);
  await page.screenshot({ path: 'test-results/logscope-compact.png' });
  expect(pageErrors).toEqual([]);
});
