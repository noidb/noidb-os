import { randomInt } from "node:crypto";
import { getWmsGoogleAccessToken } from "./google-service-account";
import { fetchSheetRows, getWmsSpreadsheetId } from "./google-sheets";
import { analyzeInboundImportSafety } from "./inbound-import-safety";
import type { InboundImportContext } from "./inbound-import-context";
import { inboundHistoryAppendRows, InboundCommitUncertainError, type InboundTransactionStore } from "./inbound-import-transaction";

const LOCK = "_입고저장_진행중";
const receiptNames = (token: string) => [`_입고백업_DB_${token}`, `_입고백업_이력_${token}`];
interface Tab { sheetId: number; title: string; gridProperties: { rowCount: number; columnCount: number } }
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

async function sheetsRequest(path: string, body?: unknown) {
  return fetch(`https://sheets.googleapis.com/v4/spreadsheets/${getWmsSpreadsheetId()}${path}`, {
    method: body ? "POST" : "GET", headers: { Authorization: `Bearer ${await getWmsGoogleAccessToken()}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}), cache: "no-store",
  });
}
async function tabs(request = sheetsRequest): Promise<Tab[]> {
  const response = await request("?fields=sheets.properties");
  if (!response.ok) throw new Error("입고 저장소의 연결을 확인해 주세요.");
  const data = await response.json();
  return data.sheets.map((sheet: { properties: Tab }) => sheet.properties);
}
function newId(existing: Set<number>) { let id = randomInt(100_000_000, 1_900_000_000); while (existing.has(id)) id++; existing.add(id); return id; }

export function buildInboundCommitRequests(context: InboundImportContext, product: Tab, history: Tab, lockId: number, backupIds: number[], now: string) {
  const names = receiptNames(context.token);
  const requests: unknown[] = [product, history].flatMap((tab, i) => [
    { duplicateSheet: { sourceSheetId: tab.sheetId, newSheetId: backupIds[i], newSheetName: names[i] } },
    { updateSheetProperties: { properties: { sheetId: backupIds[i], hidden: true }, fields: "hidden" } },
  ]);
  const start = context.historyRows.length;
  const rows = inboundHistoryAppendRows(context, now);
  if (history.gridProperties.rowCount < start + rows.length) requests.push({ appendDimension: { sheetId: history.sheetId, dimension: "ROWS", length: start + rows.length - history.gridProperties.rowCount } });
  requests.push({ updateCells: {
    range: { sheetId: history.sheetId, startRowIndex: start, endRowIndex: start + rows.length, startColumnIndex: 0, endColumnIndex: 14 },
    rows: rows.map(row => ({ values: row.map(value => ({ userEnteredValue: typeof value === "number" ? { numberValue: value } : { stringValue: value } })) })), fields: "userEnteredValue",
  } });
  for (const c of [5, 6, 7, 10, 12]) requests.push({ repeatCell: { range: { sheetId: history.sheetId, startRowIndex: start, endRowIndex: start + rows.length, startColumnIndex: c, endColumnIndex: c + 1 }, cell: { userEnteredFormat: { numberFormat: { type: "NUMBER", pattern: "#,##0" } } }, fields: "userEnteredFormat.numberFormat" } });
  for (const change of context.cellPreview.changes) {
    if (!["누적입고", "미입고"].includes(change.field) || String(context.productRows[0][change.column - 1]).trim() !== change.field
      || String(context.productRows[change.row - 1]?.[context.productRows[0].indexOf("SKU ID")] ?? "").trim() !== change.sku
      || !Number.isSafeInteger(change.after) || change.after < 0) throw new Error("입고 변경 셀을 확인하지 못했습니다.");
    requests.push({ updateCells: { range: { sheetId: product.sheetId, startRowIndex: change.row - 1, endRowIndex: change.row, startColumnIndex: change.column - 1, endColumnIndex: change.column }, rows: [{ values: [{ userEnteredValue: { numberValue: change.after } }] }], fields: "userEnteredValue" } });
  }
  requests.push({ deleteSheet: { sheetId: lockId } });
  return requests;
}

export function createInboundTransactionStore(dependencies: { request?: typeof sheetsRequest; readRows?: typeof fetchSheetRows } = {}): InboundTransactionStore {
  const request = dependencies.request || sheetsRequest;
  const readRows = dependencies.readRows || fetchSheetRows;
  return {
    async hasReceipt(token) {
      const all = await tabs(request);
      return receiptNames(token).every(name => all.some(tab => tab.title === name));
    },
    async acquire() {
      const all = await tabs(request);
      if (all.some(tab => tab.title === LOCK)) throw new Error("다른 입고 저장이 진행 중이거나 이전 저장 결과 확인이 필요합니다. 잠시 후 다시 확인해 주세요.");
      const lockId = newId(new Set(all.map(tab => tab.sheetId)));
      // Unique sheet title serializes independent server instances. Never auto-expire this lock.
      const response = await request(":batchUpdate", { requests: [{ addSheet: { properties: { sheetId: lockId, title: LOCK, hidden: true, gridProperties: { rowCount: 1, columnCount: 1 } } } }] });
      if (!response.ok) throw new Error("입고 저장 잠금을 확보하지 못했습니다. 새 입고파일 확인을 다시 눌러 주세요.");
      return lockId;
    },
    async release(lockId) {
      const response = await request(":batchUpdate", { requests: [{ deleteSheet: { sheetId: lockId } }] });
      if (!response.ok) throw new Error("입고 저장 잠금 해제 확인이 필요합니다. 관리자에게 알려 주세요.");
    },
    async commit(context, lockId) {
      let sent = false;
      try {
        const all = await tabs(request);
        const product = all.find(tab => tab.title === "제품DB"), history = all.find(tab => tab.title === "_입고요약");
        if (!product || !history || !all.some(tab => tab.sheetId === lockId && tab.title === LOCK)) throw new Error("입고 저장 대상이 변경되었습니다.");
        // Inspect native constraints on precisely the columns which will be written.
        if (context.cellPreview.changes.length) {
          const changes = context.cellPreview.changes;
          const columns = [...new Set(changes.map(c => c.column))];
          const letter = (n: number) => { let s = ""; for (; n; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + (n - 1) % 26) + s; return s; };
          const ranges = columns.map(col => {
            const selected = changes.filter(c => c.column === col).map(c => c.row);
            return `ranges=${encodeURIComponent(`'제품DB'!${letter(col)}${Math.min(...selected)}:${letter(col)}${Math.max(...selected)}`)}`;
          }).join("&");
          const response = await request(`?${ranges}&includeGridData=true&fields=sheets(data(startRow,startColumn,rowData(values(dataValidation,userEnteredValue))))`);
          if (!response.ok) throw new Error("제품DB 셀 형식을 확인하지 못했습니다.");
          const data = await response.json();
          for (const grid of data.sheets?.[0]?.data || []) for (let i = 0; i < (grid.rowData || []).length; i++) {
            const row = (grid.startRow || 0) + i + 1, col = (grid.startColumn || 0) + 1;
            if (!changes.some(c => c.row === row && c.column === col)) continue;
            const cell = grid.rowData[i].values?.[0];
            if (cell?.dataValidation || cell?.userEnteredValue?.formulaValue) throw new Error("변경 셀에 수식 또는 입력 제한이 있어 저장을 중단했습니다.");
          }
        }
        const [h, p, po] = await Promise.all([readRows("_입고요약"), readRows("제품DB", { valueRenderOption: "FORMULA" }), readRows("_발주이력")]);
        if (!same(h, context.historyRows) || !same(p, context.productRows) || !same(po, context.purchaseRows)) throw new Error("저장 직전 자료가 변경되었습니다. 새 입고파일 확인을 다시 눌러 주세요.");
        const ids = new Set(all.map(tab => tab.sheetId));
        const requests = buildInboundCommitRequests(context, product, history, lockId, [newId(ids), newId(ids)], new Date().toISOString());
        sent = true;
        const response = await request(":batchUpdate", { requests });
        if (!response.ok) {
          if (response.status >= 400 && response.status < 500 && response.status !== 408) { sent = false; throw new Error("입고 저장이 거부되어 반영되지 않았습니다. 연결 상태를 확인해 주세요."); }
          throw new InboundCommitUncertainError("입고 저장 응답을 확인하지 못했습니다. 자동 재시도하지 않고 결과 확인을 기다립니다.");
        }
      } catch (error) {
        if (!sent) await this.release(lockId);
        if (sent && !(error instanceof InboundCommitUncertainError)) throw new InboundCommitUncertainError("입고 저장 결과 확인이 필요합니다. 새 입고파일 확인을 눌러 주세요.");
        throw error;
      }
    },
    async verify(context) {
      try {
        const [history, products] = await Promise.all([readRows("_입고요약"), readRows("제품DB", { valueRenderOption: "FORMULA" })]);
        const replay = analyzeInboundImportSafety(history, context.datasets);
        if (replay.conflicts.length || replay.candidateEventCount) throw new Error("이력 대조 불일치");
        for (const change of context.cellPreview.changes) if (Number(products[change.row - 1]?.[change.column - 1]) !== change.after || String(products[change.row - 1]?.[products[0].indexOf("SKU ID")] || "") !== change.sku) throw new Error("저장 셀 대조 불일치");
      } catch { throw new InboundCommitUncertainError("저장 요청은 처리됐지만 최종 확인이 필요합니다. 다시 확인해 주세요."); }
    },
  };
}
