import assert from "node:assert/strict";
import { collectProductDbFiles } from "../lib/product-db/files";

let sheetRequestCount = 0;
const originalFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL) => {
  if (String(input).includes("/api/google-sheet")) sheetRequestCount += 1;
  if (String(input).includes("/api/export-quote")) return new Response(new Blob(["quote"]), { status: 200 });
  return new Response(JSON.stringify({ synced: true }), { status: 200, headers: { "content-type": "application/json" } });
}) as typeof fetch;

void (async () => {
  try {
    await collectProductDbFiles({
      category: "기타", model: "TEST001", title: "연습 상품", tags: "", product: {}, analysis: {}, ready: false,
      photos: [], optionThumbs: {}, detailPreview: "", label: { manufactureYearMonth: "2026.09", manufacturerName: "테스트", importerName: "테스트" },
    }, { syncGoogleSheet: false });
    assert.equal(sheetRequestCount, 0, "테스트·교육 모드는 Google 시트 요청을 보내면 안 됩니다.");
    console.log("테스트·교육용 무변경 규칙 검증 완료");
  } finally {
    globalThis.fetch = originalFetch;
  }
})();
