import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import {
  buildSafeSupplyStatusCellUpdates,
  parseSupplyStatusCapture,
  type ProductDbHeaderIndex,
  type SupplyStatusProposedUpdate,
} from "../lib/wms/supply-status-update";
import { POST as applySupplyStatus } from "../app/api/wms/supply-status/apply/route";
import { POST as applySupplyStatusAudit } from "../app/api/wms/supply-status/audit/apply/route";

const headers: ProductDbHeaderIndex = {
  status: 0,
  modelSku: 1,
  skuId: 2,
  productName: 3,
  color: 4,
  barcode: 5,
  orderAvailability: 6,
};

const existing: SupplyStatusProposedUpdate = {
  kind: "existing_sku",
  sheetRowNumber: 10,
  modelSku: "MODEL-BK",
  skuId: "12345678",
  productName: "변경 상품명",
  barcode: "R-NEVER-WRITE",
  orderAvailability: "정상",
  updateProductName: true,
  updateOrderAvailability: true,
};
const existingCells = buildSafeSupplyStatusCellUpdates(headers, [existing]);
assert.deepEqual(existingCells.map(cell => cell.col), [4, 7]);
assert.equal(existingCells.some(cell => cell.col === 1 || cell.col === 3 || cell.col === 6), false, "기존 SKU의 상태·SKU ID·바코드를 수정하면 안 됩니다.");

const approved: SupplyStatusProposedUpdate = {
  ...existing,
  kind: "new_approval",
  sheetRowNumber: 20,
  skuId: "87654321",
  barcode: "R000000000001",
};
const approvedCells = buildSafeSupplyStatusCellUpdates(headers, [approved]);
assert.deepEqual(approvedCells.map(cell => cell.col), [1, 3, 6, 4, 7]);
assert.equal(approvedCells.every(cell => cell.row === 20), true, "신규행을 만들지 않고 기존 승인대기 행만 수정해야 합니다.");

const liveCapture = {
  schemaVersion: 1 as const,
  source: "supplier-hub-live" as const,
  headers: ["SKU ID", "상품명", "바코드", "발주가능상태"],
  rows: [["87654321", "상품명", "R000000000001", "정상"]],
  capturedAt: "2026-09-05T00:00:00.000Z",
  sourceUrl: "https://supplier.coupang.com/plan/ticket/supplySkuList",
  totalRowCount: 1,
  pageCount: 1,
  pageSize: 100,
  coverageComplete: true as const,
};
assert.equal(parseSupplyStatusCapture(liveCapture).rows.length, 1);
assert.throws(
  () => parseSupplyStatusCapture({ ...liveCapture, sourceUrl: "https://example.com/plan/ticket/supplySkuList" }),
  /출처 주소/
);
assert.throws(
  () => parseSupplyStatusCapture({ ...liveCapture, rows: [...liveCapture.rows, liveCapture.rows[0]], totalRowCount: 2 }),
  /SKU ID.*반복/
);

console.log("상품공급상태 안전 갱신 규칙 검증 완료");

async function verifyWriteRoutesFailClosed() {
  const headers = {
    host: "noidb-os.vercel.app",
    origin: "https://noidb-os.vercel.app",
    "sec-fetch-site": "same-origin",
    "content-type": "application/json",
  };
  const applyResponse = await applySupplyStatus(new NextRequest("https://noidb-os.vercel.app/api/wms/supply-status/apply", { method: "POST", headers, body: "{}" }));
  const auditApplyResponse = await applySupplyStatusAudit(new NextRequest("https://noidb-os.vercel.app/api/wms/supply-status/audit/apply", { method: "POST", headers, body: "{}" }));
  assert.equal(applyResponse.status, 401);
  assert.equal(auditApplyResponse.status, 401);
  console.log("상품공급상태 쓰기 API 무인증 차단 검증 완료");
}

verifyWriteRoutesFailClosed().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
