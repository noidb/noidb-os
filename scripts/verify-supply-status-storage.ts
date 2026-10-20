import assert from "node:assert/strict";
import { compareSupplyStatusWithProductDb, compareSupplyStatusWithStorageTab, type DownloadRow } from "../lib/wms/supply-status-update";

const dl = (skuId: string, approvalRaw: string, barcode = "R0001", productName = "상품"): DownloadRow =>
  ({ matchKey: "", explicitModelSku: "", optionName: "", skuId, productName, barcode, approvalRaw, approved: approvalRaw === "정상" });

// 보관 탭: 발주가능상태만, 다른 값일 때만 바꾼다
const storage = [["SKU ID", "상품명", "현재상태", "발주가능상태"], ["111", "가", "거래처단종", "정상"], ["222", "나", "단종", "불가"], ["333", "다", "단종", "정상"]];
const updates = compareSupplyStatusWithStorageTab([dl("111", "불가"), dl("222", "불가"), dl("333", "정상"), dl("333", "불가")], storage);
assert.deepEqual(updates.map(u => [u.skuId, u.sheetRowNumber, u.col, u.orderAvailability]), [["111", 2, 4, "불가"]]);
assert.deepEqual(compareSupplyStatusWithStorageTab([dl("111", "불가")], [["SKU ID", "상품명"], ["111", "가"]]), []);

// 재등록 옛 SKU: 발주가능상태만 바뀌고 상품명·바코드는 그대로
const idx = { skuId: 0, productName: 1, orderAvailability: 2, barcode: 3 } as never;
const product = [["SKU ID", "상품명", "발주가능상태", "바코드"], ["900", "옛이름", "정상", "R0009"]];
const r = compareSupplyStatusWithProductDb([dl("900", "불가", "R1234", "새이름")], product, idx, new Set(["900"]));
assert.equal(r.updates.length, 1);
assert.equal(r.updates[0].updateOrderAvailability, true);
assert.equal(r.updates[0].updateProductName, false);
assert.equal(r.updates[0].updateBarcode, false);
console.log("verify-supply-status-storage OK");
