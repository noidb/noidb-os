import assert from "node:assert/strict";
import {
  buildSafeSupplyStatusCellUpdates,
  type ProductDbHeaderIndex,
  type SupplyStatusProposedUpdate,
} from "../lib/wms/supply-status-update";

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

console.log("상품공급상태 안전 갱신 규칙 검증 완료");
