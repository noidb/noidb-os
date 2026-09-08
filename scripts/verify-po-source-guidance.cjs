const assert = require("node:assert/strict"), fs = require("node:fs"), vm = require("node:vm"), ts = require("typescript");
require.extensions[".ts"] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, file);
const errors = require("../lib/wms/po-confirm.ts");

async function verifyRoute() {
  let failure;
  const module = { exports: {} };
  const dependencies = {
    "next/server": { NextResponse: { json: (body, init = {}) => ({ body, status: init.status || 200 }) } },
    "@/lib/wms/po-confirm": { ...errors, inspectPoConfirmSource: async () => { if (failure) throw failure; return { fileName: "fixture.xlsx" }; } },
  };
  const compiled = ts.transpileModule(fs.readFileSync("app/api/wms/po-confirm/inspect-source/route.ts", "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(compiled, { module, exports: module.exports, Error, Buffer, require: name => dependencies[name] });
  const request = { json: async () => ({ expectedPoNumbers: ["PO1"] }) };
  for (const [error, status, code] of [
    [new errors.PoConfirmSourceNotFoundError(["PO1"]), 404, "SOURCE_NOT_FOUND"],
    [new errors.PoConfirmSourceNotFoundError([], "broken.xlsx: 필수 열이 없습니다."), 422, "SOURCE_INVALID"],
    [new errors.PoConfirmSourceInspectionError("필수 열이 없습니다."), 422, "SOURCE_INVALID"],
    [new errors.PoConfirmSourceConflictError([{ fileName: "a.xlsx", overlapCount: 1 }, { fileName: "b.xlsx", overlapCount: 1 }]), 409, "SOURCE_CONFLICT"],
    [new Error("Drive connection failed"), 500, "SOURCE_CHECK_FAILED"],
  ]) {
    failure = error; const result = await module.exports.POST(request);
    assert.equal(result.status, status); assert.equal(result.body.code, code);
  }
  failure = undefined; assert.equal((await module.exports.POST(request)).status, 200);
  console.log("PASS API: missing, malformed source, all-files-malformed, duplicate, network, and success are distinct.");
}

function verifyPreparation() {
  const module = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync("app/wms/picking/waves/[waveId]/complete/GenerateAllPoConfirmButton.tsx", "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  vm.runInNewContext(code, { module, exports: module.exports, require: () => ({}) });
  const prepare = module.exports.poConfirmSourcePreparation;
  const po = Array.from({ length: 10 }, (_, index) => "PO" + index);
  const loading = prepare(null, po, true, false);
  assert.equal(loading.label, "양식 확인 중"); assert.equal(loading.needsTemplate, false);
  const missing = prepare(null, po, false, true);
  assert.equal(missing.label, "양식 필요"); assert.equal(missing.missingPoNumbers.length, 10);
  assert.equal(prepare(null, po, false, false).label, "원본 확인 필요", "network and malformed-source failures are not a missing download");
  const source = { purchaseOrders: po.slice(0, 8).map(purchaseOrderNumber => ({ purchaseOrderNumber })) };
  const partial = prepare(source, po, false, false);
  assert.equal(partial.needsTemplate, true); assert.deepEqual([...partial.missingPoNumbers], ["PO8", "PO9"]);
  source.purchaseOrders.push({ purchaseOrderNumber: "PO8" }, { purchaseOrderNumber: "PO9" }, { purchaseOrderNumber: "OTHER" });
  const ready = prepare(source, po, false, false);
  assert.equal(ready.needsTemplate, false); assert.equal(ready.missingPoNumbers.length, 0);
  console.log("PASS preparation state: loading, all ten missing, two missing from a partial source, network/invalid, and complete source stay distinct.");
}
(async () => { await verifyRoute(); verifyPreparation(); })().catch(error => { console.error(error); process.exitCode = 1; });
