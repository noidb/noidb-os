// Business APIs are intercepted; no Sheet/Drive writes or file generation.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { chromium } = require(require.resolve('playwright', { paths: [process.env.NOIDB_TEST_DEPENDENCIES || process.cwd()] }));
const base = process.env.NOIDB_TEST_URL || 'http://127.0.0.1:3116';
async function main() {
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  try {
    const context = await browser.newContext();
    const errors = [];
    let previewCalls = 0;
    let failNext = false;
    await context.route('**/api/**', async route => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.pathname === '/api/wms/inbound-drive-sync') {
        assert.equal(request.postDataJSON().action, 'preview');
        previewCalls++;
        if (failNext) return route.fulfill({ status: 400, json: { success: false, error: '다시 확인해 주세요.' } });
        return route.fulfill({ json: { success: true, canApply: false, newFiles: [{ id: 'fixture', name: '입고상세내역_20260906.xlsx' }], modifiedFiles: [], result: {
          candidateEvents: 1, parsed: 1, totalInbound: 4,
          cellPreview: { token: 'HIDDEN_INTERNAL_TOKEN', skus: ['100'], purchaseOrders: ['A'], blockers: [], changes: [
            { sku: '100', row: 2, column: 2, field: '누적입고', before: '8', after: 12 },
            { sku: '100', row: 2, column: 3, field: '미입고', before: '99', after: 4 },
          ] },
        } } });
      }
      assert.equal(request.method(), 'GET', 'No unrelated write');
      return route.fulfill({ json: { success: true, results: [], items: [], configured: false } });
    });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    await fs.mkdir('tmp/inbound-cell-preview-browser', { recursive: true });
    for (const width of [360, 390, 412, 430, 1920]) {
      await page.setViewportSize({ width, height: width < 500 ? 844 : 1080 });
      await page.goto(base + '/wms/inbound');
      await page.getByRole('button', { name: '새 입고파일 확인', exact: true }).click();
      const summary = page.getByText('제품DB 변경 미리보기 · 2셀', { exact: true });
      await summary.waitFor();
      assert.equal(await summary.evaluate(el => el.parentElement.open), false);
      await summary.click();
      await page.getByText('제품DB 2행 · 99 → 4', { exact: true }).waitFor();
      assert.ok(!(await page.locator('body').innerText()).includes('HIDDEN_INTERNAL_TOKEN'));
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      await page.screenshot({ path: `tmp/inbound-cell-preview-browser/${width}.png`, fullPage: true });
    }
    failNext = true;
    await page.getByRole('button', { name: '새 입고파일 확인', exact: true }).click();
    await page.getByText('다시 확인해 주세요.', { exact: true }).waitFor();
    assert.equal(await page.getByText('제품DB 변경 미리보기 · 2셀', { exact: true }).count(), 0, 'Failed refresh must clear stale preview');
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ ok: true, widths: [360, 390, 412, 430, 1920], previewCalls, writes: 0, stalePreviewCleared: true }));
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
