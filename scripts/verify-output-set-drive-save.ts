/**
 * 2026-11-05 출력세트 G드라이브 저장(나눠 보내기) 검사.
 * 실행: npx --yes tsx scripts/verify-output-set-drive-save.ts
 */
import assert from "node:assert/strict";
import { saveOutputSetToDrive } from "../lib/wms/output-set-drive-save";

const CHUNK = 2_621_440;
const received = new Map<string, Buffer[]>();
const calls: { action: string; start?: number; total?: number; length?: number }[] = [];

(globalThis as unknown as { fetch: unknown }).fetch = async (_url: string, init: { body: string }) => {
  const body = JSON.parse(init.body);
  const reply = (data: Record<string, unknown>) => ({ ok: true, status: 200, json: async () => data });
  if (body.action === "start") {
    calls.push({ action: "start" });
    return reply({ ok: true, sessionUri: `session:${body.fileName}`, fileName: body.fileName, folder: "20261106" });
  }
  const bytes = Buffer.from(body.base64, "base64");
  calls.push({ action: "chunk", start: body.start, total: body.total, length: bytes.length });
  const parts = received.get(body.sessionUri) || [];
  const sofar = parts.reduce((sum, part) => sum + part.length, 0);
  assert.equal(body.start, sofar, "조각은 앞에서부터 빈틈없이 이어져야 한다");
  parts.push(bytes);
  received.set(body.sessionUri, parts);
  const done = sofar + bytes.length === body.total;
  if (!done) assert.equal(bytes.length % 262_144, 0, "마지막 조각이 아니면 256KiB의 배수");
  return reply({ ok: true, done, fileName: done ? String(body.sessionUri).replace("session:", "") : "" });
};

async function main() {
  const small = new Uint8Array(1000).map((_, index) => index % 251);
  const big = new Uint8Array(CHUNK * 2 + 12345).map((_, index) => (index * 7) % 253);
  const progress: string[] = [];
  const result = await saveOutputSetToDrive("2026-11-06", [{ name: "01_부착문서_4분할.pdf", bytes: small }, { name: "03_바코드출력_20261106_최종.xlsx", bytes: big }], message => progress.push(message));

  assert.equal(result.folder, "20261106");
  assert.deepEqual(result.fileNames, ["01_부착문서_4분할.pdf", "03_바코드출력_20261106_최종.xlsx"]);
  assert.deepEqual(calls.filter(call => call.action === "chunk").map(call => call.length), [1000, CHUNK, CHUNK, 12345]);
  assert.ok(Buffer.concat(received.get("session:01_부착문서_4분할.pdf")!).equals(Buffer.from(small)), "작은 파일 내용 동일");
  assert.ok(Buffer.concat(received.get("session:03_바코드출력_20261106_최종.xlsx")!).equals(Buffer.from(big)), "큰 파일 내용 동일");
  assert.equal(progress.length, 2);

  // 저장이 실패하면 오류를 던진다(화면이 ZIP 내려받기로 넘어가도록)
  (globalThis as unknown as { fetch: unknown }).fetch = async () => ({ ok: false, status: 400, json: async () => ({ ok: false, error: "폴더 없음" }) });
  await assert.rejects(saveOutputSetToDrive("2026-11-06", [{ name: "a.pdf", bytes: small }]), /폴더 없음/);

  console.log("verify-output-set-drive-save OK");
}

main().catch(error => { console.error(error); process.exit(1); });
