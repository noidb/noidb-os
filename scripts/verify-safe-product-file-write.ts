import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { collectProductDbFiles, syncProductDbToGoogleSheet } from "../lib/product-db/files";
import { POST as syncGoogleSheetRoute } from "../app/api/google-sheet/route";
import { createNoidbActionSession, NOIDB_ACTION_SESSION_COOKIE } from "../lib/wms/noidb-action-auth";

let sheetRequestCount = 0;
const clientSheetBodies: Record<string, unknown>[] = [];
const webhookBodies: Record<string, unknown>[] = [];
const originalFetch = globalThis.fetch;
const previousWebhookUrl = process.env.GOOGLE_SHEETS_WEB_APP_URL;
const previousActionCode = process.env.QUICK_DRAFT_SYNC_CODE;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  if (String(input).includes("/api/google-sheet")) {
    sheetRequestCount += 1;
    clientSheetBodies.push(JSON.parse(String(init?.body || "{}")));
    return new Response(JSON.stringify({ configured: true, synced: true }), { status: 200, headers: { "content-type": "application/json" } });
  }
  if (String(input) === "https://example.invalid/noidb-sheet-test") {
    webhookBodies.push(JSON.parse(String(init?.body || "{}")));
    return new Response(JSON.stringify({ ok: true, duplicate: true, skipped: true }), { status: 200, headers: { "content-type": "application/json" } });
  }
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

    const registration = {
      category: "목걸이", model: "TEST-CREATE-ONLY", title: "신규 등록 안전성 검증", tags: "",
      product: { category: "목걸이", gender: "여성", colors: "골드", sizes: "Free", price: "10000", cost: "1000", supplier: "테스트" },
      analysis: {}, ready: true, photos: [], optionThumbs: {}, detailPreview: "",
    };
    await syncProductDbToGoogleSheet(registration);
    assert.equal(clientSheetBodies.at(-1)?.syncMode, "skipDuplicate", "클라이언트 신규등록은 중복 모델 건너뜀을 명시해야 합니다.");

    process.env.GOOGLE_SHEETS_WEB_APP_URL = "https://example.invalid/noidb-sheet-test";
    process.env.QUICK_DRAFT_SYNC_CODE = "test-action-code-1234";
    const sameOriginHeaders = {
      host: "noidb-os.vercel.app",
      origin: "https://noidb-os.vercel.app",
      "sec-fetch-site": "same-origin",
      "content-type": "application/json",
    };
    const unauthenticatedResponse = await syncGoogleSheetRoute(new NextRequest("https://noidb-os.vercel.app/api/google-sheet", {
      method: "POST",
      headers: sameOriginHeaders,
      body: JSON.stringify(registration),
    }));
    assert.equal(unauthenticatedResponse.status, 401, "Google 상품DB 쓰기는 관리자 세션 없이 실행되면 안 됩니다.");

    const session = createNoidbActionSession();
    const routeResponse = await syncGoogleSheetRoute(new NextRequest("https://noidb-os.vercel.app/api/google-sheet", {
      method: "POST",
      headers: { ...sameOriginHeaders, cookie: `${NOIDB_ACTION_SESSION_COOKIE}=${session}` },
      body: JSON.stringify({ ...registration, syncMode: "upsert" }),
    }));
    assert.equal(routeResponse.status, 200);
    assert.equal(webhookBodies.at(-1)?.syncMode, "skipDuplicate", "직접 API 요청도 신규등록을 upsert로 바꿀 수 없어야 합니다.");
    console.log("테스트·교육용 무변경 규칙 검증 완료");
    console.log("신규 상품등록 create-only 강제 검증 완료");
  } finally {
    globalThis.fetch = originalFetch;
    if (previousWebhookUrl === undefined) delete process.env.GOOGLE_SHEETS_WEB_APP_URL;
    else process.env.GOOGLE_SHEETS_WEB_APP_URL = previousWebhookUrl;
    if (previousActionCode === undefined) delete process.env.QUICK_DRAFT_SYNC_CODE;
    else process.env.QUICK_DRAFT_SYNC_CODE = previousActionCode;
  }
})();
