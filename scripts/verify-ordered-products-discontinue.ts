/**
 * 2026-10-29 발주제품보기 '단종' 버튼 검사: 단종 신청 목록(직접 입력칸)에 SKU 넣기·되돌리기.
 * 실행: npx --yes tsx scripts/verify-ordered-products-discontinue.ts
 * 임시 폴더에서만 읽고 쓰므로 실제 저장본은 건드리지 않는다.
 */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

async function main() {
  delete process.env.VERCEL;
  delete process.env.BLOB_READ_WRITE_TOKEN;
  const dir = mkdtempSync(path.join(os.tmpdir(), "noidb-discontinue-"));
  process.chdir(dir);
  const { appendDiscontinueCodes, removeDiscontinueCodes, readDiscontinueCodeDraft, writeDiscontinueCodeDraft } = await import("../lib/wms/discontinue-code-draft-store");

  await writeDiscontinueCodeDraft("11111111\n22222222");

  // 단종 보내기: 줄 맨 아래에 붙고, 이미 있는 코드는 다시 넣지 않는다.
  const first = await appendDiscontinueCodes(["57471000"]);
  assert.deepEqual(first.added, ["57471000"]);
  assert.equal((await readDiscontinueCodeDraft()).text, "11111111\n22222222\n57471000");
  const again = await appendDiscontinueCodes(["57471000"]);
  assert.deepEqual(again.added, [], "이미 있는 SKU는 중복으로 넣지 않음");

  // 되돌리기: 그 SKU 줄만 빠지고 나머지 입력은 그대로.
  const undone = await removeDiscontinueCodes(["57471000"]);
  assert.deepEqual(undone.removed, ["57471000"]);
  assert.equal((await readDiscontinueCodeDraft()).text, "11111111\n22222222");
  const missing = await removeDiscontinueCodes(["57471000"]);
  assert.deepEqual(missing.removed, [], "없는 SKU를 되돌려도 목록은 그대로");
  assert.equal((await readDiscontinueCodeDraft()).text, "11111111\n22222222");

  // 비슷한 번호는 건드리지 않는다(줄 전체가 같을 때만 뺀다).
  await writeDiscontinueCodeDraft("5747100\n57471000\n574710001");
  await removeDiscontinueCodes(["57471000"]);
  assert.equal((await readDiscontinueCodeDraft()).text, "5747100\n574710001");

  // 코드 연결 확인: 화면 버튼 → API 동작 이름.
  const shared = readFileSync(path.join(__dirname, "../app/wms/logistics/dates/[expectedDate]/OrderedProductsShared.tsx"), "utf8");
  const route = readFileSync(path.join(__dirname, "../app/api/wms/vendor-order-actions/route.ts"), "utf8");
  for (const action of ["discontinue-list", "discontinue-list-undo"]) {
    assert.ok(shared.includes(`"${action}"`) && route.includes(`"${action}"`), `${action} 화면·API 연결`);
  }
  for (const page of ["sku-summary", "sku-list"]) {
    const source = readFileSync(path.join(__dirname, `../app/wms/logistics/dates/[expectedDate]/${page}/page.tsx`), "utf8");
    assert.ok(source.includes("<DiscontinueButton") && source.includes("disabled={Boolean(discontinue.sent["), `${page} 단종 버튼·발주 담기 막기`);
  }

  console.log("verify-ordered-products-discontinue OK");
}

main().catch(error => { console.error(error); process.exit(1); });
