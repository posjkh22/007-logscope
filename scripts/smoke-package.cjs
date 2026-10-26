const { _electron: electron } = require('@playwright/test');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
(async () => {
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'logscope-package-'));
  const env = { ...process.env, LOGSCOPE_PROFILE: profile, LOGSCOPE_TEST: '1' };
  delete env.ELECTRON_RUN_AS_NODE;
  let app;
  try {
    app = await electron.launch({ executablePath: path.join(__dirname, '../release/win-unpacked/Logscope.exe'), args: [], env });
    const page = await app.firstWindow();
    await page.locator('.result-row').first().waitFor({ timeout: 20000 });
    await page.locator('.result-row').first().click();
    await page.locator('.log-row.current').waitFor({ timeout: 20000 });
    const result = { appPath: await app.evaluate(({ app }) => app.getAppPath()), results: await page.locator('#result-count').textContent(), line: await page.locator('.log-row.current').getAttribute('data-line') };
    assert.match(result.appPath, /app\.asar$/);
    assert.equal(result.results, '139');
    assert.equal(result.line, '17');
    await page.locator('#viewer-mode').selectOption('any');
    await page.locator('#viewer-query').fill('timeout "Rate limit threshold"');
    await page.waitForFunction(() => Number(document.querySelector('#file-results-count').textContent.replaceAll(',', '')) > 38 && document.querySelector('#viewer-search-button').textContent === '파일 전체 검색', null, { timeout: 20000 });
    assert.equal(await page.locator('#viewer-mode').inputValue(), 'any');
    result.fileResults = await page.locator('#file-results-count').textContent();
    result.viewerMode = 'OR';
    await page.screenshot({ path: path.join(__dirname, '../test-results/logscope-packaged-or.png') });
    console.log('Packaged app smoke test passed:', JSON.stringify(result));
  } finally {
    if (app) await app.close();
    assert.equal(path.dirname(path.resolve(profile)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(profile).startsWith('logscope-package-'));
    await fs.rm(profile, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
