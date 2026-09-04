import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { collectProductDbFiles, syncProductDbToGoogleSheet } from "../lib/product-db/files";
import { writeProductDbFiles, writeRootFolderFile } from "../lib/product-db/fs";
import { POST as syncGoogleSheetRoute } from "../app/api/google-sheet/route";
import { createNoidbActionSession, NOIDB_ACTION_SESSION_COOKIE } from "../lib/wms/noidb-action-auth";

let sheetRequestCount = 0;
const clientSheetBodies: Record<string, unknown>[] = [];
const webhookBodies: Record<string, unknown>[] = [];
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
    console.log("기존 파일 보존·신규 저장 실패 롤백 검증 완료");
  } finally {
    globalThis.fetch = originalFetch;
    if (previousWebhookUrl === undefined) delete process.env.GOOGLE_SHEETS_WEB_APP_URL;
    else process.env.GOOGLE_SHEETS_WEB_APP_URL = previousWebhookUrl;
    if (previousActionCode === undefined) delete process.env.QUICK_DRAFT_SYNC_CODE;
    else process.env.QUICK_DRAFT_SYNC_CODE = previousActionCode;
  }
})();
