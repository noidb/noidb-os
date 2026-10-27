// 출력세트 저장 때 자동으로 채운 쉽먼트번호·등록기록이 지워지지 않는지 검사(2026-10-27 버그).
// 실행: npx --yes tsx scripts/verify-output-set-keeps-shipment-numbers.ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { applyOutputSetRecord, pendingDispatchRequirements } from "../lib/wms/invoice-group/output-set";
import { missingInvoiceGroupDispatchRequirements, type InvoiceGroup } from "../lib/wms/invoice-group/types";

const at = "2026-10-27T00:00:00.000Z";
const now = "2026-10-27T05:00:00.000Z";
const barcode = "03_바코드출력_20261029_최종.xlsx";

// 자동 출력세트 첫 건: 쉽먼트파일은 만들었지만 쉽먼트번호는 아직 비어 있음(렌더 시점 groups).
const stale: InvoiceGroup = {
  id: "G-1", purchaseOrderNumbers: ["150000001"], expectedDate: "2026-10-29", fulfillmentCenter: "동탄1", mergedFromMultiplePo: false, stage: "new",
  fulfillmentCenterPhone: "01000000000", fulfillmentCenterZip: "00000", fulfillmentCenterAddress: "경기도",
  poConfirmations: [{ purchaseOrderNumber: "150000001", confirmedFileName: "c.xlsx", confirmedFilePath: "fixture", confirmedAt: at }],
  skuCount: 1, totalQuantity: 1,
  invoiceGeneratedAt: at, invoiceFileName: "invoice.xlsx",
  shipmentInvoiceNumbers: [{ purchaseOrderNumber: "150000001", invoiceNumber: "463000000001" }],
  shipmentFileName: "shipment.xlsx", shipmentFileGeneratedAt: at, shipmentNumbers: [],
  createdAt: at, updatedAt: at,
};
// autoFillShipmentNumbers가 Label PDF에서 번호를 채워 저장한 최신 묶음(filledGroups).
const filled: InvoiceGroup = { ...stale, shipmentNumbers: ["50129648"], shipmentRegisteredAt: now, updatedAt: now };

// 1) 최신 묶음에 기록을 얹으면 번호·등록기록이 남고 출고완료 조건을 모두 통과한다.
const saved = applyOutputSetRecord(filled, barcode, now);
assert.deepEqual(saved.shipmentNumbers, ["50129648"], "쉽먼트번호가 남아야 한다");
assert.equal(saved.shipmentRegisteredAt, now, "쉽먼트 등록 기록이 남아야 한다");
assert.equal(saved.outputSetGeneratedAt, now);
assert.equal(saved.barcodeFileName, barcode);
assert.deepEqual(missingInvoiceGroupDispatchRequirements(saved), [], "출고완료 버튼이 열려야 한다");
assert.equal(saved.stage, "shipment_completed");

// 2) (버그 재현) 낡은 묶음에 얹으면 번호가 빠진 것으로 판정된다 — 그래서 반드시 최신 묶음을 써야 한다.
const buggy = applyOutputSetRecord(stale, barcode, now);
assert.deepEqual(missingInvoiceGroupDispatchRequirements(buggy), ["Supplier Hub 쉽먼트 등록 기록", "8자리 Supplier Hub 쉽먼트번호"]);
assert.deepEqual(pendingDispatchRequirements([buggy, saved]), ["Supplier Hub 쉽먼트 등록 기록", "8자리 Supplier Hub 쉽먼트번호"], "잠겼을 때 빠진 항목 표시");
assert.deepEqual(pendingDispatchRequirements([saved]), []);

// 3) 화면 코드가 filledGroups 기준으로 저장하고, 빠진 항목을 버튼 위에 보여주는지.
const page = readFileSync("app/wms/logistics/dates/[expectedDate]/page.tsx", "utf8");
assert.match(page, /applyOutputSetRecord\([^)]*\),\s*filledGroups\)/, "출력세트 기록은 filledGroups 기준으로 저장해야 한다");
assert.match(page, /pendingDispatchRequirements\(groups\)/, "잠긴 출고완료 버튼 위에 빠진 항목을 보여줘야 한다");

console.log("verify-output-set-keeps-shipment-numbers: OK");
