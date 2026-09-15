import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parseCoupangAdsSnapshot, summarizeCoupangAds } from "../lib/coupang-ads/analysis";
import { buildCoupangAdsWorkbook } from "../lib/coupang-ads/excel";
import { COUPANG_ADS_BOOKMARKLET } from "../lib/coupang-ads/bookmarklet";

async function main() {
  const samplePath = process.argv[2];
  if (!samplePath) throw new Error("샘플 JSON 경로가 필요합니다.");
  const raw = JSON.parse(await readFile(samplePath, "utf8"));
  const parsed = parseCoupangAdsSnapshot(raw);
  const summary = summarizeCoupangAds(parsed.items);
  assert.equal(parsed.expectedTotalCount, 541, "pageInfo.totalCount");
  assert.equal(parsed.collectedCount, 441, "실제 pages ads 수");
  assert.equal(parsed.missingCount, 100, "누락 감지");
  assert.equal(parsed.items.some(item => !item.available && item.recommendation === "focus"), false, "집행 불가 상품 집중광고 제외");
  const ordered = parsed.items.filter(item => item.adOrders > 0).sort((a, b) => b.roas - a.roas);
  assert.ok(ordered.length > 0, "광고주문 상품 검출");
  assert.equal(ordered[0].sampleWarning, ordered[0].adOrders <= 1 || ordered[0].clicks < 5, "고ROAS 표본 경고");
  assert.throws(() => parseCoupangAdsSnapshot({ pages: [{ page: 1, data: {} }] }), /data\.ads/, "잘못된 JSON 오류 안내");
  const workbook = await buildCoupangAdsWorkbook(parsed);
  assert.deepEqual(workbook.worksheets.map(sheet => sheet.name), ["전체", "집중광고", "확대테스트", "관찰", "중지후보"], "Excel 시트 구성");
  assert.equal(workbook.getWorksheet("전체")?.rowCount, parsed.uniqueCount + 1, "Excel 전체 행 수");
  assert.equal(workbook.getWorksheet("확대테스트")?.rowCount, summary.recommendations.expand + 1, "Excel 분류 행 수");
  const excelBytes = (await workbook.xlsx.writeBuffer()).byteLength;
  assert.ok(excelBytes > 10_000, "Excel 파일 생성");
  assert.ok(COUPANG_ADS_BOOKMARKLET.startsWith("javascript:"), "북마클릿 스킴");
  assert.match(COUPANG_ADS_BOOKMARKLET, /ads-with-metrics/, "실제 수집 endpoint");
  assert.match(COUPANG_ADS_BOOKMARKLET, /credentials:\s*["']include["']/, "현재 로그인 세션 사용");
  assert.doesNotMatch(COUPANG_ADS_BOOKMARKLET, /document\.cookie|localStorage|sessionStorage/, "인증정보 저장 금지");
  assert.doesNotThrow(() => new Function(COUPANG_ADS_BOOKMARKLET.slice("javascript:".length)), "북마클릿 문법");
  const globals = globalThis as Record<string, unknown>;
  const original = { window: globals.window, performance: globals.performance, location: globals.location, document: globals.document, fetch: globals.fetch, setTimeout: globals.setTimeout, __name: globals.__name };
  const originalCreateObjectUrl = URL.createObjectURL;
  const originalRevokeObjectUrl = URL.revokeObjectURL;
  let downloadedBlob: Blob | null = null;
  let downloadedName = "";
  let successMessage = "";
  const requests: string[] = [];
  try {
    globals.__name = (value: unknown) => value;
    globals.window = { alert: (message: string) => { successMessage = message; } };
    globals.performance = { getEntriesByType: () => [{ name: "https://advertising.coupang.com/marketing/tetris-api/205671211/ads-with-metrics?startDate=20260825&endDate=20260831&page=1&size=100" }] };
    globals.location = { href: "https://advertising.coupang.com/ads?groupId=205671211", origin: "https://advertising.coupang.com" };
    globals.document = {
      querySelectorAll: () => [],
      createElement: () => ({ href: "", download: "", click() { downloadedName = this.download; } }),
    };
    globals.fetch = async (url: string) => {
      requests.push(url);
      const page = Number(new URL(url).searchParams.get("page"));
      const count = page <= 5 ? 100 : page === 6 ? 41 : 0;
      return { ok: true, status: 200, json: async () => ({ ads: Array.from({ length: count }, (_, index) => ({ vendoritemid: `${page}-${index}` })), pageInfo: { page, pageSize: 100, totalCount: 541 } }) };
    };
    globals.setTimeout = (callback: () => void) => { callback(); return 0; };
    URL.createObjectURL = (blob: Blob | MediaSource) => { downloadedBlob = blob as Blob; return "blob:fixture"; };
    URL.revokeObjectURL = () => undefined;
    const execute = new Function(`return ${COUPANG_ADS_BOOKMARKLET.slice("javascript:".length)}`) as () => Promise<void>;
    await execute();
  } finally {
    Object.assign(globals, original);
    URL.createObjectURL = originalCreateObjectUrl;
    URL.revokeObjectURL = originalRevokeObjectUrl;
  }
  assert.equal(requests.length, 6, "541개 수집 페이지 수");
  assert.equal(downloadedName, "coupang_ads_20260825_20260831.json", "북마클릿 파일명");
  assert.match(successMessage, /541개 상품 수집 완료/, "수집 완료 안내");
  const blobForCheck = downloadedBlob as Blob | null;
  assert.ok(blobForCheck, "북마클릿 JSON Blob 생성");
  const downloaded = JSON.parse(await blobForCheck.text());
  assert.equal(downloaded.pages.flatMap((page: { data: { ads: unknown[] } }) => page.data.ads).length, 541, "북마클릿 전체 상품 수");
  console.log(JSON.stringify({
    meta: { groupId: parsed.groupId, period: `${parsed.startDate}~${parsed.endDate}`, expected: parsed.expectedTotalCount, collected: parsed.collectedCount, unique: parsed.uniqueCount, missing: parsed.missingCount, duplicates: parsed.duplicateCount },
    summary, excel: { sheets: workbook.worksheets.map(sheet => ({ name: sheet.name, rows: sheet.rowCount })), bytes: excelBytes },
    orderedProducts: ordered.map(item => ({ vendorItemId: item.vendorItemId, name: item.itemName, clicks: item.clicks, orders: item.adOrders, sales: item.adSales, cost: item.adCost, roas: item.roas, recommendation: item.recommendationLabel, sampleWarning: item.sampleWarning })),
  }, null, 2));
}

main().catch(error => { console.error(error); process.exitCode = 1; });
