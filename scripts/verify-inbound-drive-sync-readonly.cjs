const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");

class DriveOAuthNotConnectedError extends Error {}
class DriveOAuthNotConfiguredError extends Error {}
class DriveOAuthTokenInvalidError extends Error {}

const calls = { blobRead: 0, folderResolve: 0, fileList: 0, fileDownload: 0, inboundPreview: 0 };
const dependencies = {
  "@vercel/blob": { get: async () => { calls.blobRead += 1; return null; } },
  "next/server": { NextResponse: class {
    static json(body, init = {}) { return { body, status: init.status || 200 }; }
  } },
  "@/lib/wms/google-drive-oauth-reader": {
    resolveDriveFolderPath: async () => { calls.folderResolve += 1; return "fixture-folder"; },
    listOAuthDriveFolderFiles: async () => {
      calls.fileList += 1;
      return [{ id: "fixture-file", name: "입고.xlsx", modifiedTime: "2026-09-05T00:00:00Z", size: "100" }];
    },
    downloadOAuthDriveFile: async () => { calls.fileDownload += 1; return Buffer.from("fixture"); },
  },
  "@/lib/wms/google-drive-oauth": { DriveOAuthNotConfiguredError, DriveOAuthNotConnectedError, DriveOAuthTokenInvalidError },
};

const moduleFixture = { exports: {} };
vm.runInNewContext(ts.transpileModule(
  fs.readFileSync("app/api/wms/inbound-drive-sync/route.ts", "utf8"),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } },
).outputText, {
  module: moduleFixture,
  exports: moduleFixture.exports,
  Buffer,
  console,
  process,
  FormData,
  File,
  Uint8Array,
  Response,
  fetch: async (_url, init) => {
    calls.inboundPreview += 1;
    assert.equal(init.method, "POST");
    assert.equal(init.body.get("mode"), "inboundHistory");
    assert.equal(init.body.get("dryRun"), "true", "Drive sync may call only the read-only inbound preview");
    return new Response(JSON.stringify({ ok: true, previewToken: "fixture-token", candidateEvents: 1 }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  },
  require(name) {
    assert(Object.hasOwn(dependencies, name), `Unexpected dependency ${name}`);
    return dependencies[name];
  },
});

(async () => {
  const apply = await moduleFixture.exports.POST({
    json: async () => ({ action: "apply", expectedFileIds: ["fixture-file"], expectedPreviewToken: "fixture-token" }),
    nextUrl: { origin: "http://127.0.0.1:3114" },
  });
  assert.equal(apply.status, 409);
  assert.equal(apply.body.code, "INBOUND_APPLY_LOCKED");
  assert.match(apply.body.error, /제품DB 반영은 셀별 변경 검증 후 사용할 수 있습니다/);
  assert.deepEqual(calls, { blobRead: 0, folderResolve: 0, fileList: 0, fileDownload: 0, inboundPreview: 0 }, "apply must not read/write Drive, back up Sheet, or call the inbound webhook");

  const preview = await moduleFixture.exports.POST({
    json: async () => ({ action: "preview" }),
    nextUrl: { origin: "http://127.0.0.1:3114" },
  });
  assert.equal(preview.status, 200);
  assert.equal(preview.body.canApply, false);
  assert.equal(preview.body.applied, false);
  assert.equal(preview.body.backupCreated, false);
  assert.match(preview.body.message, /기존 입고결과의 쿠폰·미입고 파일은 계속 생성할 수 있습니다/);
  assert.equal(calls.inboundPreview, 1);
  console.log("입고 Drive sync 읽기 전용 PASS: apply 409, 백업/Sheet/Drive 쓰기 0, preview canApply false");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
