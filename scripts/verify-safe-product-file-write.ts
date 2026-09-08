import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { collectProductDbFiles, syncProductDbToGoogleSheet } from "../lib/product-db/files";
import { writeProductDbFiles, writeRootFolderFile } from "../lib/product-db/fs";
import { GET as checkGoogleSheetRoute, POST as syncGoogleSheetRoute } from "../app/api/google-sheet/route";
import { createNoidbActionSession, NOIDB_ACTION_SESSION_COOKIE } from "../lib/wms/noidb-action-auth";

let sheetRequestCount = 0;
const clientSheetBodies: Record<string, unknown>[] = [];
const webhookBodies: Record<string, unknown>[] = [];
let clientSheetResult: Record<string, unknown> = { configured: true, synced: true };
let webhookResult: Record<string, unknown> = { ok: true, duplicate: true, skipped: true };
let webhookCheckResult: Record<string, unknown> = { ok: true, duplicate: true, reregisterable: true };
const originalFetch = globalThis.fetch;
const previousWebhookUrl = process.env.GOOGLE_SHEETS_WEB_APP_URL;
const previousActionCode = process.env.QUICK_DRAFT_SYNC_CODE;

type FailureControl = { filename: string };

class MockDirectoryHandle {
  readonly kind = "directory";
  readonly directories = new Map<string, MockDirectoryHandle>();
  readonly files = new Map<string, Blob>();

  constructor(readonly name: string, private readonly failure: FailureControl) {}

  async getDirectoryHandle(name: string, options?: { create?: boolean }) {
    const existing = this.directories.get(name);
    if (existing) return existing;
    if (!options?.create) throw new DOMException("Not found", "NotFoundError");
    const created = new MockDirectoryHandle(name, this.failure);
    this.directories.set(name, created);
    return created;
  }

  async getFileHandle(name: string, options?: { create?: boolean }) {
    if (!this.files.has(name)) {
      if (!options?.create) throw new DOMException("Not found", "NotFoundError");
      this.files.set(name, new Blob());
    }
    const directory = this;
    return {
      kind: "file" as const,
      name,
      async createWritable() {
        return {
          async write(blob: Blob) {
            if (directory.failure.filename === name) throw new Error(`의도한 저장 실패: ${name}`);
            directory.files.set(name, blob);
          },
          async close() {},
        };
      },
    };
  }

  async removeEntry(name: string) {
    if (!this.files.delete(name) && !this.directories.delete(name)) throw new DOMException("Not found", "NotFoundError");
  }
}
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  if (String(input).includes("/api/google-sheet")) {
    sheetRequestCount += 1;
    clientSheetBodies.push(JSON.parse(String(init?.body || "{}")));
    return new Response(JSON.stringify(clientSheetResult), { status: 200, headers: { "content-type": "application/json" } });
  }
  if (String(input) === "https://example.invalid/noidb-sheet-test") {
    webhookBodies.push(JSON.parse(String(init?.body || "{}")));
    return new Response(JSON.stringify(webhookBodies.at(-1)?.action === "checkModel" ? webhookCheckResult : webhookResult), { status: 200, headers: { "content-type": "application/json" } });
  }
  if (String(input).includes("/api/export-quote")) return new Response(new Blob(["quote"]), { status: 200 });
  return new Response(JSON.stringify({ synced: true }), { status: 200, headers: { "content-type": "application/json" } });
}) as typeof fetch;

void (async () => {
  try {
    const failure = { filename: "" };
    const mockRoot = new MockDirectoryHandle("상품이미지DB", failure);
    const rootHandle = mockRoot as unknown as FileSystemDirectoryHandle;
    const file = (filename: string) => ({ folder: "", filename, path: filename, blob: new Blob([filename]) });

    await writeProductDbFiles(rootHandle, "목걸이", "SAFE001", [file("SAFE001.jpg"), file("라벨_SAFE001.jpg")], { overwriteExisting: false });
    const safeModel = mockRoot.directories.get("목걸이")?.directories.get("SAFE001");
    assert.equal(await safeModel?.files.get("SAFE001.jpg")?.text(), "SAFE001.jpg");
    await assert.rejects(
      writeProductDbFiles(rootHandle, "목걸이", "SAFE001", [file("SAFE001.jpg")], { overwriteExisting: false }),
      /기존 파일/,
    );
    assert.equal(await safeModel?.files.get("SAFE001.jpg")?.text(), "SAFE001.jpg", "기존 상품 파일은 그대로 유지되어야 합니다.");

    failure.filename = "두번째.jpg";
    await assert.rejects(
      writeProductDbFiles(rootHandle, "목걸이", "ROLLBACK001", [file("첫번째.jpg"), file("두번째.jpg")], { overwriteExisting: false }),
      /의도한 저장 실패/,
    );
    const rollbackModel = mockRoot.directories.get("목걸이")?.directories.get("ROLLBACK001");
    assert.deepEqual([...rollbackModel!.files.keys()], [], "신규 일괄 저장 실패 시 이번 실행에서 만든 파일을 모두 되돌려야 합니다.");

    failure.filename = "";
    await writeRootFolderFile(rootHandle, "라벨", "라벨_SAFE001.jpg", new Blob(["기존"]), { overwriteExisting: false });
    await assert.rejects(
      writeRootFolderFile(rootHandle, "라벨", "라벨_SAFE001.jpg", new Blob(["새값"]), { overwriteExisting: false }),
      /기존 파일/,
    );
    assert.equal(await mockRoot.directories.get("라벨")?.files.get("라벨_SAFE001.jpg")?.text(), "기존");

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
    assert.equal(clientSheetBodies.at(-1)?.syncMode, "reregisterStopped", "실제 등록은 판매중지 기존행 재사용 모드를 명시해야 합니다.");
    assert.match(String(clientSheetBodies.at(-1)?.operationId || ""), /^[A-Za-z0-9_-]{12,120}$/, "클라이언트 신규등록은 재시도용 작업번호를 보내야 합니다.");

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
      body: JSON.stringify({ ...registration, syncMode: "upsert", operationId: "test-operation-0001" }),
    }));
    assert.equal(routeResponse.status, 200);
    assert.equal(webhookBodies.at(-1)?.syncMode, "reregisterStopped", "직접 API 요청의 upsert를 무시하고 판매중지 재등록 검증을 강제해야 합니다.");
    assert.equal(webhookBodies.at(-1)?.operationId, "test-operation-0001", "동일 작업 재시도용 번호를 Apps Script까지 전달해야 합니다.");
    const duplicateBody = await routeResponse.json();
    assert.equal(duplicateBody.synced, false, "서버가 차단한 중복을 저장 성공으로 보고하면 안 됩니다.");
    assert.equal(duplicateBody.duplicate, true);
    assert.equal(webhookBodies.length, 2, "인증 실패는 Apps Script 요청 전에 차단하고, 승인된 요청만 사전확인 후 저장해야 합니다.");
    assert.equal(webhookBodies[0].action, "checkModel");
    assert.equal(webhookBodies[0].model, registration.model);

    const authenticatedHeaders = { ...sameOriginHeaders, cookie: NOIDB_ACTION_SESSION_COOKIE + "=" + session };
    const post = (body: unknown, headers: Record<string, string> = authenticatedHeaders) => syncGoogleSheetRoute(new NextRequest("https://noidb-os.vercel.app/api/google-sheet", {
      method: "POST", headers, body: JSON.stringify(body),
    }));
    const requestsBeforeRejections = webhookBodies.length;
    const crossOrigin = await post({ ...registration, operationId: "test-operation-0002" }, { ...authenticatedHeaders, origin: "https://other.invalid", "sec-fetch-site": "cross-site" });
    assert.equal(crossOrigin.status, 401, "인증된 세션도 다른 출처에서는 쓸 수 없어야 합니다.");
    const tamperedSession = await post({ ...registration, operationId: "test-operation-0002" }, { ...authenticatedHeaders, cookie: NOIDB_ACTION_SESSION_COOKIE + "=" + session.slice(0, -1) + "x" });
    assert.equal(tamperedSession.status, 401, "변조된 관리자 세션은 차단해야 합니다.");
    assert.equal((await post(registration)).status, 400);
    assert.equal((await post({ ...registration, operationId: "bad/id" })).status, 400);
    assert.equal(webhookBodies.length, requestsBeforeRejections, "인증 또는 작업번호 오류 시 외부 쓰기 요청이 없어야 합니다.");

    for (const requestedMode of [undefined, "upsert", "reregisterStopped", "arbitrary-mode"]) {
      const response = await post({ ...registration, syncMode: requestedMode, operationId: "test-operation-forced-mode" });
      assert.equal(response.status, 200);
      assert.equal(webhookBodies.at(-1)?.syncMode, "reregisterStopped", "사용자 요청이 검증 없는 upsert 모드를 지정할 수 없어야 합니다.");
    }
    assert.equal((await post({ ...registration, syncMode: "skipDuplicate", operationId: "test-migration-operation" })).status, 200);
    assert.equal(webhookBodies.at(-1)?.syncMode, "skipDuplicate", "기존 JSON 대량 이전은 판매중지 행도 재등록하지 않고 건너뛰어야 합니다.");

    webhookCheckResult = { ok: true, duplicate: true, reregisterable: true, reason: "판매중지" };
    const checked = await (await checkGoogleSheetRoute(new NextRequest("https://noidb-os.vercel.app/api/google-sheet?model=TEST-CREATE-ONLY"))).json();
    assert.equal(checked.duplicate, true);
    assert.equal(checked.reregisterable, true, "화면 사전확인에 기존행 재등록 가능 여부를 전달해야 합니다.");
    assert.equal(webhookBodies.at(-1)?.action, "checkModel");

    const mutationCount = () => webhookBodies.filter(body => body.action !== "checkModel").length;
    for (const legacyOrProtectedResult of [
      { ok: true, duplicate: true },
      { ok: true, duplicate: true, reregisterable: false, reason: "완료 상태의 기존 모델입니다." },
      { ok: true, duplicate: true, reregisterable: "true" },
    ]) {
      webhookCheckResult = legacyOrProtectedResult;
      const beforeMutationCount = mutationCount();
      const beforeBodies: number = webhookBodies.length;
      const blocked = await post({ ...registration, syncMode: "reregisterStopped", reregisterable: true, duplicate: false, operationId: "test-legacy-protected-operation" });
      const blockedBody = await blocked.json();
      assert.equal(blocked.status, 200);
      assert.equal(blockedBody.synced, false);
      assert.equal(blockedBody.duplicate, true);
      assert(blockedBody.reason, "구버전 또는 보호 상태의 차단 이유가 있어야 합니다.");
      assert.equal(mutationCount(), beforeMutationCount, "구버전·일반 중복 모델에는 상품행/이미지/견적서 쓰기 요청을 보내면 안 됩니다.");
      assert.deepEqual(webhookBodies.slice(beforeBodies).map(body => ({ action: body.action, model: body.model })), [{ action: "checkModel", model: registration.model }]);
    }
    for (const invalidResult of [{}, { ok: true }, { ok: true, duplicate: "false" }, { duplicate: false }]) {
      webhookCheckResult = invalidResult;
      const beforeMutationCount = mutationCount();
      const invalidCheck = await post({ ...registration, operationId: "test-invalid-check-operation" });
      assert.equal(invalidCheck.status, 503);
      assert.equal((await invalidCheck.json()).synced, false);
      assert.equal(mutationCount(), beforeMutationCount, "확인 결과가 모호하면 쓰기 전에 중단해야 합니다.");
    }
    webhookCheckResult = { ok: false, error: "check failed" };
    const beforeFailedCheck = mutationCount();
    assert.equal((await post({ ...registration, operationId: "test-failed-check-operation" })).status, 500);
    assert.equal(mutationCount(), beforeFailedCheck);

    // 구버전에서도 신규 모델은 skipDuplicate를 쓰므로 사전확인 이후 생긴 동시 등록을 덮어쓰지 않는다.
    webhookCheckResult = { ok: true, duplicate: false };
    webhookResult = { ok: true, duplicate: true, skipped: true };
    const racedNew = await post({ ...registration, syncMode: "upsert", operationId: "test-new-model-race-operation" });
    assert.equal(racedNew.status, 200);
    assert.equal(webhookBodies.at(-1)?.syncMode, "skipDuplicate");
    assert.equal((await racedNew.json()).synced, false);

    // 명시적인 이전 기능은 구버전에서도 사전검사 없이 create-only 계약을 유지한다.
    webhookCheckResult = {};
    const beforeMigration = webhookBodies.length;
    assert.equal((await post({ ...registration, syncMode: "skipDuplicate", operationId: "test-legacy-migration-operation" })).status, 200);
    assert.equal(webhookBodies.length, beforeMigration + 1);
    assert.equal(webhookBodies.at(-1)?.syncMode, "skipDuplicate");

    webhookCheckResult = { ok: true, duplicate: true, reregisterable: true };
    webhookResult = { ok: true, updated: true, reregistered: true, registrationStage: { updatedRows: 1 } };
    const reRegistrationResponse = await post({ ...registration, operationId: "test-reregister-operation" });
    const reRegistrationBody = await reRegistrationResponse.json();
    assert.equal(reRegistrationResponse.status, 200);
    assert.equal(reRegistrationBody.synced, true);
    assert.equal(reRegistrationBody.reregistered, true);
    assert.deepEqual(reRegistrationBody.registrationStage, { updatedRows: 1 }, "Apps Script의 재등록 완료 행 수를 그대로 전달해야 합니다.");
    const productDbRows = webhookBodies.at(-1)?.productDbRows as unknown[][];
    assert.equal(productDbRows[0][4], registration.model);
    assert.equal(productDbRows[0][5], "TEST-CREATE-ONLY-GO");
    assert.equal(productDbRows[0][10], "TEST-CREATE-ONLY-GO | 골드");

    for (const blank of ["", "   ", undefined]) {
      const response = await post({ ...registration, product: { ...registration.product, cost: blank, price: blank }, operationId: "test-blank-price-operation" });
      assert.equal(response.status, 200);
      const rows = webhookBodies.at(-1)?.productDbRows as unknown[][];
      for (const column of [13, 14, 15, 18]) assert.equal(rows[0][column], "", "미입력 가격은 계산된 0으로 기존 정보를 덮어쓰면 안 됩니다.");
    }
    assert.equal((await post({ ...registration, product: { ...registration.product, cost: "0", price: "0" }, operationId: "test-zero-price-operation" })).status, 200);
    const zeroRows = webhookBodies.at(-1)?.productDbRows as unknown[][];
    for (const column of [13, 14, 15, 18]) assert.equal(zeroRows[0][column], 0, "명시적으로 입력한 0은 빈칸으로 바꾸면 안 됩니다.");

    clientSheetResult = reRegistrationBody;
    const clientReregistered = await syncProductDbToGoogleSheet(registration);
    assert.equal(clientReregistered.ok, true);
    assert.match(clientReregistered.message, /기존 1행 재등록 완료/);
    clientSheetResult = { configured: true, synced: false, duplicate: true };
    assert.equal((await syncProductDbToGoogleSheet(registration)).ok, false, "중복 차단은 클라이언트에서도 실패여야 합니다.");
    clientSheetResult = { configured: true, synced: false };
    assert.equal((await syncProductDbToGoogleSheet(registration)).ok, false, "저장 확인이 없는 응답은 성공으로 표시하면 안 됩니다.");

    console.log("테스트·교육용 무변경 규칙 검증 완료");
    console.log("판매중지 재등록·이전 중복건너뜀·인증·출처·작업번호·응답 전달 검증 완료");
    console.log("구버전 Apps Script·보호 상태·변조된 재등록 신호·잘못된 사전검사 응답·신규 동시등록 덮어쓰기 차단 검증 완료");
    console.log("기존 파일 보존·신규 저장 실패 롤백 검증 완료");
  } finally {
    globalThis.fetch = originalFetch;
    if (previousWebhookUrl === undefined) delete process.env.GOOGLE_SHEETS_WEB_APP_URL;
    else process.env.GOOGLE_SHEETS_WEB_APP_URL = previousWebhookUrl;
    if (previousActionCode === undefined) delete process.env.QUICK_DRAFT_SYNC_CODE;
    else process.env.QUICK_DRAFT_SYNC_CODE = previousActionCode;
  }
})();
