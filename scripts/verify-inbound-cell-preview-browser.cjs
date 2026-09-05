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
    let applyCalls = 0;
    let failApply = false;
    const token = 'a'.repeat(64);
    await context.route('**/api/**', async route => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.pathname === '/api/wms/inbound-drive-sync') {
        const body = request.postDataJSON();
        if (body.action === 'apply') {
          applyCalls++;
          assert.deepEqual(body, { action: 'apply', confirmed: true, expectedPreviewToken: token });
          if (failApply) return route.fulfill({ status: 409, json: { success: false, error: '저장 결과 확인이 필요합니다.' } });
          return route.fulfill({ json: { success: true, importedEvents: 1, changedCells: 2 } });
        }
        assert.equal(body.action, 'preview');
        previewCalls++;
        if (failNext) return route.fulfill({ status: 400, json: { success: false, error: '다시 확인해 주세요.' } });
        return route.fulfill({ json: { success: true, canApply: true, newFiles: [{ id: 'fixture', name: '입고상세내역_20260906.xlsx' }], modifiedFiles: [], result: {
          previewToken: token,
          candidateEvents: 1, parsed: 1, totalInbound: 4,
          cellPreview: { token: 'HIDDEN_INTERNAL_TOKEN', skus: ['100'], purchaseOrders: ['A'], blockers: [], changes: [
            { sku: '100', row: 2, column: 2, field: '누적입고', before: '8', after: 12 },
            { sku: '100', row: 2, column: 3, field: '미입고', before: '99', after: 4 },
          ] },
        } } });
      }
      assert.equal(request.method(), 'GET', 'No unrelated write');
      if (url.pathname === '/api/auth/noidb-action-session') return route.fulfill({ json: { authenticated: true, configured: true } });
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
      await page.getByRole('button', { name: '변경 내용 확인 · 입고 저장', exact: true }).click();
      await page.getByRole('dialog').waitFor();
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      await page.screenshot({ path: `tmp/inbound-cell-preview-browser/confirm-${width}.png`, fullPage: true });
      await page.getByRole('button', { name: '취소', exact: true }).click();
      assert.equal(applyCalls, 0, 'opening and cancelling confirmation never saves');
    }
    await page.getByRole('button', { name: '변경 내용 확인 · 입고 저장', exact: true }).click();
    await page.getByRole('button', { name: '확인 · 백업 후 저장', exact: true }).click();
    await page.getByText('백업 후 저장완료 · 입고 1건 · 제품DB 2셀', { exact: true }).waitFor();
    assert.equal(applyCalls, 1);
    assert.equal(await page.getByRole('dialog').count(), 0);
    await page.getByRole('button', { name: '새 입고파일 확인', exact: true }).click();
    await page.getByRole('button', { name: '변경 내용 확인 · 입고 저장', exact: true }).click();
    failApply = true;
    await page.getByRole('button', { name: '확인 · 백업 후 저장', exact: true }).click();
    await page.getByText('저장 결과 확인이 필요합니다.', { exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: '변경 내용 확인 · 입고 저장', exact: true }).count(), 0);
    assert.equal(applyCalls, 2, 'uncertain result never retries automatically');
    failNext = true;
    await page.getByRole('button', { name: '새 입고파일 확인', exact: true }).click();
    await page.getByText('다시 확인해 주세요.', { exact: true }).waitFor();
    assert.equal(await page.getByText('제품DB 변경 미리보기 · 2셀', { exact: true }).count(), 0, 'Failed refresh must clear stale preview');
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ ok: true, widths: [360, 390, 412, 430, 1920], previewCalls, mockedApplyCalls: applyCalls, operatingWrites: 0, stalePreviewCleared: true }));
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
