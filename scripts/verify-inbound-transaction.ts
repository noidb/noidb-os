import assert from "node:assert/strict";
import { buildInboundImportContext } from "../lib/wms/inbound-import-context";
import { parseInboundSourceRows } from "../lib/wms/inbound-import-safety";
import { applyInboundTransaction, InboundCommitUncertainError } from "../lib/wms/inbound-import-transaction";
import { createInboundTransactionStore } from "../lib/wms/inbound-import-store";

const historyHeaders = ["데이터세트", "발주번호", "입고예정일", "SKU ID", "상품명", "입고수량", "반출", "순입고", "최근입고일", "이전공급가일", "이전공급가", "최근공급가일", "최근공급가", "반영일"];
const dataset = { fingerprint: "fixture", sourceFile: "fixture.xlsx", items: parseInboundSourceRows([{ 번호: "PO1", SKU번호: "100", SKU명: "반지, 실버, 17호", 구분: "입고", "입고/반출시각": "2026/09/06 12:00:00", 수량: "4" }], "fixture.xlsx") };
function fixture() {
  let state: any[] = [
    { sheetId: 1, title: "제품DB", rows: [["SKU ID", "누적입고", "미입고", "현재고", "원가", "이미지"], ["100", "0", "12", "55", "700", "keep"]] },
    { sheetId: 2, title: "_입고요약", rows: [historyHeaders] },
    { sheetId: 3, title: "_발주이력", rows: [["발주번호", "SKU ID", "확정수량", "발주수량", "발주현황"], ["PO1", "100", "12", "12", "발주확정"]] },
  ].map(s => ({ ...s, gridProperties: { rowCount: 1000, columnCount: 30 } }));
  const original = structuredClone(state);
  let writes = 0, lostResponse = false, failBatch = false, commits = 0, lostBefore = false, constrained = false;
  const readRows = async (name: string) => structuredClone(state.find(s => s.title === name).rows).map((row: unknown[]) => row.map(value => String(value ?? "")));
  const load = async () => buildInboundImportContext([dataset], await readRows("_입고요약"), await readRows("제품DB"), await readRows("_발주이력"));
  const request = async (path: string, body?: unknown) => {
    if (!body) return Response.json(path.includes("includeGridData") ? { sheets: [{ data: constrained ? [{ startRow: 1, startColumn: 1, rowData: [{ values: [{ dataValidation: { strict: true } }] }] }] : [] }] } : { sheets: state.map(({ rows, ...properties }) => ({ properties })) });
    writes++;
    const operations = (body as any).requests;
    const isCommit = operations.some((r: any) => r.duplicateSheet);
    if (isCommit && lostBefore) throw new Error("network lost before commit");
    if (isCommit && failBatch) return new Response("invalid batch", { status: 400 });
    const next = structuredClone(state);
    try {
      for (const operation of operations) {
        if (operation.addSheet) {
          const p = operation.addSheet.properties;
          assert.ok(!next.some(s => s.title === p.title), "unique title"); next.push({ ...p, rows: [] });
        } else if (operation.duplicateSheet) {
          const p = operation.duplicateSheet;
          assert.ok(!next.some(s => s.title === p.newSheetName));
          next.push({ ...structuredClone(next.find(s => s.sheetId === p.sourceSheetId)), sheetId: p.newSheetId, title: p.newSheetName });
        } else if (operation.updateSheetProperties) Object.assign(next.find(s => s.sheetId === operation.updateSheetProperties.properties.sheetId), operation.updateSheetProperties.properties);
        else if (operation.deleteSheet) next.splice(next.findIndex(s => s.sheetId === operation.deleteSheet.sheetId), 1);
        else if (operation.updateCells) {
          const { range, rows, fields } = operation.updateCells;
          assert.equal(fields, "userEnteredValue"); assert.equal(range.endRowIndex - range.startRowIndex, rows.length);
          const target = next.find(s => s.sheetId === range.sheetId);
          if (range.sheetId === 1) { assert.equal(rows.length, 1); assert.ok([1, 2].includes(range.startColumnIndex)); }
          else { assert.equal(range.sheetId, 2); assert.equal(range.startRowIndex, 1, "append only"); }
          rows.forEach((row: any, r: number) => row.values.forEach((cell: any, c: number) => {
            assert.equal(row.values.length, range.endColumnIndex - range.startColumnIndex);
            target.rows[range.startRowIndex + r] ||= [];
            target.rows[range.startRowIndex + r][range.startColumnIndex + c] = cell.userEnteredValue.numberValue ?? cell.userEnteredValue.stringValue;
          }));
        } else if (operation.repeatCell) { assert.equal(operation.repeatCell.range.sheetId, 2); assert.equal(operation.repeatCell.fields, "userEnteredFormat.numberFormat"); }
        else throw new Error("Unexpected mutation");
      }
    } catch { return new Response("conflict", { status: 400 }); }
    state = next;
    if (isCommit) { commits++; if (lostResponse) throw new Error("network lost after server committed"); }
    return Response.json({});
  };
  const store = createInboundTransactionStore({ request, readRows });
  return { store, load, original, get state() { return state; }, get writes() { return writes; }, get commits() { return commits; }, loseResponse() { lostResponse = true; }, loseBefore() { lostBefore = true; }, constrain() { constrained = true; }, fail() { failBatch = true; } };
}
async function main() {
  const f = fixture(), plan = await f.load();
  const outcomes = await Promise.allSettled([applyInboundTransaction(plan.token, f.load, f.store), applyInboundTransaction(plan.token, f.load, f.store)]);
  assert.equal(f.commits, 1); assert.ok(outcomes.some(o => o.status === "fulfilled"));
  assert.deepEqual(f.state.find(s => s.sheetId === 1).rows[1].slice(3), ["55", "700", "keep"]);
  assert.deepEqual(f.state.find(s => s.title.startsWith("_입고백업_DB_")).rows, f.original[0].rows);
  assert.deepEqual(f.state.find(s => s.title.startsWith("_입고백업_이력_")).rows, f.original[1].rows);
  const writes = f.writes;
  assert.equal((await applyInboundTransaction(plan.token, f.load, f.store)).alreadyApplied, true);
  assert.equal(f.writes, writes, "receipt retry performs no writes");
  assert.equal((await f.load()).incoming.length, 0);

  const stale = fixture(), stalePlan = await stale.load();
  stale.state[0].rows[1][2] = "11";
  await assert.rejects(applyInboundTransaction(stalePlan.token, stale.load, stale.store), /변경/);
  assert.equal(stale.commits, 0); assert.equal(stale.state.length, 3, "stale preview releases lock");

  const failed = fixture(); failed.fail();
  await assert.rejects(applyInboundTransaction((await failed.load()).token, failed.load, failed.store), /거부/);
  assert.deepEqual(failed.state, failed.original, "failed atomic commit has no business changes or leftover lock");

  const lost = fixture(), lostPlan = await lost.load(); lost.loseResponse();
  await assert.rejects(applyInboundTransaction(lostPlan.token, lost.load, lost.store), InboundCommitUncertainError);
  assert.equal(lost.commits, 1);
  assert.equal((await applyInboundTransaction(lostPlan.token, lost.load, lost.store)).alreadyApplied, true);
  assert.equal(lost.commits, 1, "lost response retry must not add events twice");
  const pending = fixture(), pendingPlan = await pending.load(); pending.loseBefore();
  await assert.rejects(applyInboundTransaction(pendingPlan.token, pending.load, pending.store), InboundCommitUncertainError);
  const pendingWrites = pending.writes;
  await assert.rejects(applyInboundTransaction(pendingPlan.token, pending.load, pending.store), /결과 확인/);
  assert.equal(pending.writes, pendingWrites); assert.equal(pending.commits, 0);
  assert.equal(pending.state.length, 4, "uncertain write keeps exclusive lock");
  assert.deepEqual(pending.state.slice(0, 3), pending.original);

  const constrained = fixture(); constrained.constrain();
  await assert.rejects(applyInboundTransaction((await constrained.load()).token, constrained.load, constrained.store), /입력 제한/);
  assert.deepEqual(constrained.state, constrained.original);

  const changed = fixture(), changedPlan = await changed.load();
  await assert.rejects(applyInboundTransaction(changedPlan.token, async () => {
    const snapshot = await changed.load(); changed.state[0].rows[1][3] = "56"; return snapshot;
  }, changed.store), /저장 직전/);
  assert.equal(changed.commits, 0); assert.equal(changed.state.length, 3);
  console.log("Inbound transaction PASS: concurrent writers, targeted cells, atomic backups, stale recheck, failed batch cleanup, response-loss replay, duplicate prevention; no operating writes");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
