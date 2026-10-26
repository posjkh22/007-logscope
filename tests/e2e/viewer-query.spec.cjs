const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
let app, page, directory;
const failures = [];
const sample = [
  'INFO request completed',
  'ERROR upstream timeout trace_id=tr_abcd',
  'WARN connection refused upstream=db',
  'ERROR task failed worker=send',
  'ERROR timeout and connection refused trace_id=tr_abcd',
  'INFO connection established; refused after reconnect',
  'WARN 결제 실패 주문=1',
  'ERROR timeout healthcheck',
  'INFO TIMEOUT uppercase',
  'INFO literal conn[42] marker',
  'ERROR timeout retried failed'
].map((text, index) => `2026-10-23 09:00:${String(index).padStart(2, '0')} ${text}`).join('\n');
const orQuery = 'timeout "connection refused" failed';

test.beforeAll(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'logscope-or-'));
  const file = path.join(directory, 'conditions.log'); await fs.writeFile(file, sample);
  const env = { ...process.env, LOGSCOPE_TEST: '1', LOGSCOPE_PROFILE: path.join(directory, 'profile') }; delete env.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({ args: [path.join(__dirname, '../..')], env });
  page = await app.firstWindow(); page.on('pageerror', error => failures.push(error.message));
  await expect(page.locator('#result-count')).toHaveText('139');
  await app.evaluate(({ dialog }, input) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [input] }); }, file);
  await page.locator('#add-files').click(); await expect(page.locator('.file-item')).toHaveCount(1);
  await page.locator('.file-open').click();
  await expect(page.locator('.log-row.current')).toBeVisible();
});
test.afterAll(async () => {
  if (app) await app.close();
  expect(path.dirname(path.resolve(directory))).toBe(path.resolve(os.tmpdir()));
  expect(path.basename(directory)).toMatch(/^logscope-or-/);
  await fs.rm(directory, { recursive: true, force: true });
});

test('OR combines multiple conditions once per line and highlights each matching phrase', async () => {
  await page.locator('#viewer-mode').selectOption('any');
  await page.locator('#viewer-query').fill(orQuery);
  await expect(page.locator('#file-results-count')).toHaveText('7');
  await expect(page.locator('#file-results-status')).toContainText('OR');
  await expect(page.locator('#viewer-query-help')).toContainText('하나라도');
  await expect(page.locator('.file-result-line')).toHaveText(['L2', 'L3', 'L4', 'L5', 'L8', 'L9', 'L11']);
  await page.locator('[data-file-match="3"]').click();
  await expect(page.locator('.log-row.current')).toHaveAttribute('data-line', '5');
  const marked = await page.locator('.log-row.current mark').allTextContents();
  expect(marked).toEqual(expect.arrayContaining(['timeout', 'connection refused']));
});

test('OR composes with level, exclusions and case-sensitive matching', async () => {
  await page.locator('#viewer-level').selectOption('ERROR');
  await expect(page.locator('#file-results-count')).toHaveText('5');
  await page.locator('#viewer-exclude').fill('healthcheck');
  await expect(page.locator('#file-results-count')).toHaveText('4');
  await page.locator('#viewer-exclude').fill(''); await page.locator('#viewer-level').selectOption('');
  await expect(page.locator('#file-results-count')).toHaveText('7');
  await page.locator('#viewer-case').click(); await expect(page.locator('#file-results-count')).toHaveText('6');
  await page.locator('#viewer-case').click(); await expect(page.locator('#file-results-count')).toHaveText('7');
});

test('AND, literal and quoted phrases have distinct, predictable semantics', async () => {
  await page.locator('#viewer-mode').selectOption('all');
  await page.locator('#viewer-query').fill('timeout failed');
  await expect(page.locator('#file-results-count')).toHaveText('1');
  await expect(page.locator('.file-result-line')).toHaveText(['L11']);
  await page.locator('#viewer-mode').selectOption('literal');
  await expect(page.locator('#file-results-count')).toHaveText('0');
  await page.locator('#viewer-mode').selectOption('any');
  await page.locator('#viewer-query').fill('"connection refused"');
  await expect(page.locator('#file-results-count')).toHaveText('2');
  await expect(page.locator('.file-result-line')).toHaveText(['L3', 'L5']);
  await page.locator('#viewer-query').fill('"결제 실패" conn[42]');
  await expect(page.locator('#file-results-count')).toHaveText('2');
  await expect(page.locator('.file-result-line')).toHaveText(['L7', 'L10']);
});

test('regex mode explains alternatives and malformed quotes recover without freezing', async () => {
  await page.locator('#viewer-regex').click();
  await expect(page.locator('#viewer-mode')).toBeDisabled();
  await expect(page.locator('#viewer-mode')).toHaveValue('regex');
  await expect(page.locator('#viewer-query-help')).toContainText('|');
  await page.locator('#viewer-query').fill('timeout|failed');
  await expect(page.locator('#file-results-count')).toHaveText('6');
  await page.locator('#viewer-regex').click();
  await expect(page.locator('#viewer-mode')).toBeEnabled();
  await expect(page.locator('#viewer-mode')).toHaveValue('any');
  await expect(page.locator('#file-results-count')).toHaveText('0');
  await page.locator('#viewer-query').fill('timeout "connection refused');
  await expect(page.locator('#file-results-status')).toContainText('큰따옴표가 닫히지 않았습니다');
  await page.locator('#viewer-query').fill(orQuery);
  await expect(page.locator('#file-results-count')).toHaveText('7');
  await page.screenshot({ path: 'test-results/logscope-or-search.png' });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1100, 720));
  await expect.poll(() => page.evaluate(() => window.innerWidth)).toBe(1100);
  expect(await page.evaluate(() => document.body.scrollWidth <= document.body.clientWidth)).toBe(true);
  await expect(page.locator('#viewer-search-button')).toBeVisible();
});

test('workspace reset returns the viewer search to literal mode', async () => {
  await page.locator('#workspace-reset').click(); await page.locator('#clear-confirm').click();
  await expect(page.locator('#viewer-mode')).toHaveValue('literal');
  await expect(page.locator('#viewer-query-help')).toBeHidden();
  await expect(page.locator('#viewer-query')).toHaveValue('');
  expect(failures).toEqual([]);
});
