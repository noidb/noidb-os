import assert from "node:assert/strict";
import { reserveLogisticsReceiptRoute } from "../lib/wms/logistics-receipt-routing";
import { logisticsReceiptLineKey, type LogisticsAsideBaseline, type LogisticsReceiptTarget } from "../lib/wms/logistics-receipts";
import { emptyWeeklyWorkspace } from "../lib/wms/weekly-work-state";
import { pendingReorderQueue } from "../lib/wms/weekly-reorder-queue";
import { consolidateVendorOrders } from "../lib/wms/vendor-order/consolidate";
import { emptyPickingWaveStoreSnapshot } from "../lib/wms/picking-wave/shared-store-types";
import type { VendorOrderDraftLine } from "../lib/wms/vendor-order/types";

const baseline: LogisticsAsideBaseline = { closedShipmentNumbers: [], pendingTargets: [], completedMarketingSkuIds: [], excludedMarketingSkuIds: [], handledLines: [], source: "test" };
const at = new Date(Date.now() - 60_000).toISOString();
const targets: LogisticsReceiptTarget[] = ["99990001", "99990002"].map(shipmentNumber => ({shipmentNumber, expectedDate: "2026-09-20", centerName: "테스트", purchaseOrderNumbers: ["111"], source: "dispatch"}));
function workspace() {
  const value = emptyWeeklyWorkspace();
  value.logisticsReceipts = { source: "supplier-hub-shipments", schemaVersion: 3, collectedAt: at,
    requestedShipmentNumbers: targets.map(t => t.shipmentNumber), shipments: targets.map(target => ({shipmentNumber: target.shipmentNumber, status: "마감",
      totalDelivered: 5, totalReceived: 2, lines: [{boxId:"B",purchaseOrderNumber:"111",skuId:"222",productName:"검증상품",barcode:"R222",deliveredQuantity:5,receivedQuantity:2}]})), skuStatuses: [{ skuId: "222", orderStatus: "정상" }] };
  return value;
}
const key = (shipment: string) => logisticsReceiptLineKey(shipment, "B", "111", "222");
const input = { lineKey: key("99990001"), decision: "reorder" as const, expectedCollectedAt: at };
const w = workspace();
const first = reserveLogisticsReceiptRoute(w, targets, input, baseline, at);
assert.equal(first.run.snapshot.vendorItems[0].shortageQuantity, 3);
reserveLogisticsReceiptRoute(w, targets, input, baseline, at);
assert.equal(w.runs.length, 1, "retry must reuse the source run");
assert.throws(() => reserveLogisticsReceiptRoute(w, targets, {...input,decision:"vendor"},baseline,at), /다른 목록/);
assert.throws(() => reserveLogisticsReceiptRoute(w, targets, {...input,expectedCollectedAt:"old"},baseline,at), /새로고침/);
reserveLogisticsReceiptRoute(w, targets, {...input,lineKey:key("99990002")},baseline,at);
assert.equal(w.runs.length,2);
assert.equal(pendingReorderQueue(w).rows[0].shortageQuantity,6,"two distinct shipments must add, not overwrite");
const changed = workspace(); changed.logisticsReceipts!.shipments[0].totalReceived=0; changed.logisticsReceipts!.shipments[0].lines[0].receivedQuantity=0;
assert.throws(()=>reserveLogisticsReceiptRoute(changed,targets,input,baseline,at),/확정된/);
const pending = workspace(); pending.logisticsReceipts!.shipments[0]={shipmentNumber:"99990001",status:"발송 완료",totalDelivered:null,totalReceived:null,lines:[]};
assert.throws(()=>reserveLogisticsReceiptRoute(pending,targets,input,baseline,at),/마감/);
const handled = workspace();
const b = {...baseline,handledLines:[{shipmentNumber:"99990001",purchaseOrderNumber:"111",skuId:"222",quantity:2,classification:"기처리",note:"test"}]};
assert.equal(reserveLogisticsReceiptRoute(handled,targets,input,b,at).run.snapshot.vendorItems[0].shortageQuantity,1);
assert.equal(pendingReorderQueue(handled).rows[0].shortageQuantity,1,"the export queue must retain the handled quantity exclusion");
const marketing = workspace();
marketing.logisticsReceipts!.shipments[0].totalDelivered = 1;
marketing.logisticsReceipts!.shipments[0].totalReceived = 1;
Object.assign(marketing.logisticsReceipts!.shipments[0].lines[0], {deliveredQuantity:1,receivedQuantity:1});
marketing.logisticsReceipts!.shipments[1].lines[0].skuId="223";
marketing.logisticsReceipts!.skuStatuses = [{ skuId: "222", orderStatus: "정상" }, { skuId: "223", orderStatus: "정상" }];
const marketingInput={...input,lineKey:`marketing::${input.lineKey}`,decision:"marketing" as const};
assert.throws(()=>reserveLogisticsReceiptRoute(marketing,targets,marketingInput,baseline,at),/확인한/);
const marketingRun=reserveLogisticsReceiptRoute(marketing,targets,{...marketingInput,confirmMarketing:true},baseline,at).run;
assert.equal(marketingRun.snapshot.couponItems.length,1);
assert.equal(pendingReorderQueue(marketing).rows.length,0,"marketing is not a shortage reorder");

const store=emptyPickingWaveStoreSnapshot();
function line(shipment: string,quantity:number): VendorOrderDraftLine {
  return {id:shipment,draftId:`${shipment}::미등록`,waveId:shipment,vendorName:"미등록",skuId:"222",modelName:"",category:"",optionLabel:"",productName:"검증",imageUrl:"",barcode:"R222",
    actualShortageQuantity:quantity,shortageQuantity:quantity,currentStock:"",relatedPurchaseOrderNumbers:["111"],memo:"",isManuallyAdded:true,sourceType:"actual-inbound-shortage",
    shipmentReceiptDetails:[{lineKey:key(shipment),shipmentNumber:shipment,boxId:"B",purchaseOrderNumber:"111",skuId:"222",deliveredQuantity:quantity+2,receivedQuantity:2,shortageQuantity:quantity}],
    createdAt:at,updatedAt:at};
}
consolidateVendorOrders(store,"one",[line("99990001",3)],at);
consolidateVendorOrders(store,"two",[line("99990002",4)],at);
assert.equal(store.vendorOrderLines.find(l=>l.shipmentReceiptDetails?.length===2)?.actualShortageQuantity,7);
consolidateVendorOrders(store,"two",[line("99990002",4)],at);
assert.equal(store.vendorOrderLines.find(l=>l.shipmentReceiptDetails?.length===2)?.shortageQuantity,7,"retry must not add quantity");
console.log("PASS logistics route reservations, source identity, retries, partial Aside exclusion, pending/zero blockers and vendor/reorder source accumulation (memory only)");
