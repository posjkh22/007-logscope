const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
let app, page, directory;
const originals = new Map();
const errors = [];
async function launch() {
  const env = { ...process.env, LOGSCOPE_TEST: '1', LOGSCOPE_PROFILE: path.join(directory, 'profile') };
  delete env.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({ args: [path.join(__dirname, '../..')], env });
  page = await app.firstWindow();
  page.on('pageerror', error => errors.push(error.message));
}
async function chooseFolder(folder) {
  await app.evaluate(({ dialog }, input) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [input] }); }, folder);
  await page.locator('#add-folder').click();
}
async function addFixture(relative, content) {
  const file = path.join(directory, relative);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, content); originals.set(file, content);
  return file;
}
test.beforeAll(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'logscope-workspace-'));
  await addFixture('alpha/a.log', '2026-10-23 09:00:00 INFO timeout alpha\n');
  await addFixture('alpha/nested/deep.log', '2026-10-23 09:01:00 WARN timeout deep\n');
  await addFixture('beta/a.log', '2026-10-23 09:02:00 ERROR timeout beta\n');
  await launch();
  await expect(page.locator('#result-count')).toHaveText('139');
});
test.afterAll(async () => {
  if (app) await app.close();
  expect(path.dirname(path.resolve(directory))).toBe(path.resolve(os.tmpdir()));
  expect(path.basename(directory)).toMatch(/^logscope-workspace-/);
  await fs.rm(directory, { recursive: true, force: true });
});

test('folder import merges snapshots, ignores duplicates and refreshes new files on reimport', async () => {
  await expect(page.locator('#add-folder')).toHaveText('폴더 가져오기');
  await expect(page.locator('.import-help')).toContainText('새 파일은 폴더를 다시 가져와');
  await chooseFolder(path.join(directory, 'alpha'));
  await expect(page.locator('.file-item')).toHaveCount(2);
  await expect(page.locator('#demo-badge')).toBeHidden();
  await chooseFolder(path.join(directory, 'beta'));
  await expect(page.locator('.file-item')).toHaveCount(3);
  await addFixture('alpha/new.log', '2026-10-23 09:03:00 INFO timeout new_file\n');
  await expect(page.locator('.file-item')).toHaveCount(3);
  await chooseFolder(path.join(directory, 'alpha'));
  await expect(page.locator('.file-item')).toHaveCount(4);
  await expect(page.locator('#result-count')).toHaveText('4');
});

test('visible individual and selected removals change only the file list', async () => {
  await expect(page.locator('.file-remove').first()).toHaveCSS('opacity', '1');
  await expect(page.locator('#workspace-reset')).toBeVisible();
  await expect(page.locator('#remove-selected-count')).toHaveText('4');
  await page.locator('#select-all-files').click();
  await expect(page.locator('#remove-selected')).toBeDisabled();
  await page.locator('.file-item input').first().check();
  await expect(page.locator('#remove-selected-count')).toHaveText('1');
  await page.locator('#remove-selected').click();
  await expect(page.locator('.file-item')).toHaveCount(3);
  await page.locator('.file-remove').first().click();
  await expect(page.locator('.file-item')).toHaveCount(2);
  for (const [file, content] of originals) expect(await fs.readFile(file, 'utf8')).toBe(content);
  await page.locator('#select-all-files').click();
  await expect(page.locator('#remove-selected-count')).toHaveText('2');
});

test('reset clears files and filters, keeps saved items and stays empty after restart', async () => {
  await page.locator('#query').fill('timeout'); await page.locator('#query').press('Enter');
  await expect(page.locator('#result-count')).toHaveText('2');
  await page.locator('.result-row').first().click();
  await expect(page.locator('.log-row.current')).toBeVisible();
  await page.keyboard.press('Control+b');
  await page.locator('#save-search').click();
  await expect(page.locator('#bookmark-count')).toHaveText('1');
  await expect(page.locator('[data-saved]')).toHaveCount(1);
  await page.locator('#results-tab').click();
  await page.locator('#query').fill('before-reset');
  await page.locator('#regex-toggle').click();
  await page.locator('#filters-button').click();
  await page.locator('#glob').fill('*.notlog');
  await page.locator('#exclude').fill('heartbeat');
  await page.locator('#file-filter').fill('invisible');
  await page.locator('#workspace-reset').click();
  await expect(page.locator('#modal')).toContainText('원본 로그 파일은 삭제하지 않습니다');
  await page.locator('#clear-confirm').click();
  await expect(page.locator('.file-item')).toHaveCount(0);
  await expect(page.locator('#query')).toHaveValue('');
  await expect(page.locator('#file-filter')).toHaveValue('');
  await expect(page.locator('#glob')).toHaveValue('');
  await expect(page.locator('#exclude')).toHaveValue('');
  await expect(page.locator('#regex-toggle')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('.viewer-tab')).toHaveCount(0);
  await expect(page.locator('#remove-selected')).toBeDisabled();
  await expect(page.locator('#bookmark-count')).toHaveText('1');
  await expect(page.locator('[data-saved]')).toHaveCount(1);
  await app.close(); app = null;
  await launch();
  await expect(page.locator('#status-text')).toHaveText('0개 파일 준비됨');
  await expect(page.locator('.file-item')).toHaveCount(0);
  await expect(page.locator('#demo-badge')).toBeHidden();
  await expect(page.locator('#bookmark-count')).toHaveText('1');
  await expect(page.locator('[data-saved]')).toHaveCount(1);
  for (const [file, content] of originals) expect(await fs.readFile(file, 'utf8')).toBe(content);
  await page.screenshot({ path: 'test-results/logscope-workspace-reset.png' });
  expect(errors).toEqual([]);
});
