import assert from "node:assert/strict";
import JSZip from "jszip";
import { moveWorkListItem } from "../lib/wms/work-list-routing";
import { generateLogisticsFollowUp, completeLogisticsFollowUp, logisticsFollowUpToken } from "../lib/wms/logistics-follow-up";
import { buildLogisticsReceiptBoard, type LogisticsAsideBaseline, type LogisticsReceiptTarget } from "../lib/wms/logistics-receipts";
import { reserveLogisticsReceiptRoute } from "../lib/wms/logistics-receipt-routing";
import { pendingReorderQueue } from "../lib/wms/weekly-reorder-queue";
import { emptyWeeklyWorkspace } from "../lib/wms/weekly-work-state";
import type { VendorOrderDraftLine } from "../lib/wms/vendor-order/types";
import { emptyPickingWaveStoreSnapshot } from "../lib/wms/picking-wave/shared-store-types";
import { applyPickingWaveStoreMutation } from "../lib/wms/picking-wave/server-store";

const at = new Date(Date.now() - 60_000).toISOString();
const baseline: LogisticsAsideBaseline = { closedShipmentNumbers: [], pendingTargets: [], completedMarketingSkuIds: [], excludedMarketingSkuIds: [], handledLines: [], source: "test" };
const target = (shipmentNumber: string): LogisticsReceiptTarget => ({ shipmentNumber, expectedDate: "2026-09-20", centerName: "검증", purchaseOrderNumbers: ["111"], source: "dispatch" });
const targets = [target("99990001"), target("99990002")];
const detail = (shipmentNumber:string, boxId:string, deliveredQuantity:number, receivedQuantity:number) => ({ lineKey: JSON.stringify([shipmentNumber,boxId,"111","222"]), shipmentNumber, boxId, purchaseOrderNumber:"111", skuId:"222", deliveredQuantity, receivedQuantity, shortageQuantity:deliveredQuantity-receivedQuantity });
const details=[detail("99990001","A",5,3),detail("99990002","B",7,4)];
let workspace=emptyWeeklyWorkspace();
workspace.logisticsReceipts={source:"supplier-hub-shipments",schemaVersion:3,collectedAt:at,requestedShipmentNumbers:targets.map(row=>row.shipmentNumber),shipments:details.map(row=>({shipmentNumber:row.shipmentNumber,status:"마감",totalDelivered:row.deliveredQuantity,totalReceived:row.receivedQuantity,lines:[{...row,productName:"검증상품",barcode:"R"}]})),skuStatuses:[{skuId:"222",orderStatus:"정상"}]};
const vendorLine=(id:string, source=details):VendorOrderDraftLine=>({id,draftId:"draft",waveId:"wave",vendorName:"V",skuId:"222",modelName:"",category:"",optionLabel:"",productName:"검증상품",imageUrl:"",barcode:"R",actualShortageQuantity:5,shortageQuantity:12,currentStock:"",relatedPurchaseOrderNumbers:["111"],memo:"",isManuallyAdded:true,createdAt:at,updatedAt:"updated",shipmentReceiptDetails:source});
let picking=emptyPickingWaveStoreSnapshot();picking.vendorOrderDrafts=[{id:"draft",waveId:"wave",vendorName:"V",status:"sent",createdAt:at,updatedAt:"updated",archivedAt:at}];picking.vendorOrderLines=[vendorLine("line-1")];
const deps={
 readWeeklyWorkspace:async()=>structuredClone(workspace),
 mutateWeeklyWorkspace:async(fn:(value:typeof workspace)=>unknown)=>{const next=structuredClone(workspace);const value=fn(next);next.revision++;workspace=next;return structuredClone(value)},
 listStatusRequests:async()=>[],readPickingWaveStore:async()=>structuredClone(picking),
 mutatePickingWaveStore:async(op:any)=>{picking=applyPickingWaveStoreMutation(picking,op);return structuredClone(picking)},
 transferWeeklyVendorQueue:async()=>{throw Error("vendor queue is not part of reorder")},
};
const board=()=>buildLogisticsReceiptBoard({ targets, snapshot:workspace.logisticsReceipts, baseline, routes:workspace.logisticsReceiptRoutes });
function reserveOrigin(row:typeof details[number]) { return reserveLogisticsReceiptRoute(workspace,targets,{lineKey:row.lineKey,decision:'vendor',expectedCollectedAt:at},baseline,at); }
void(async()=>{
 details.forEach(reserveOrigin);
 await moveWorkListItem("vendor","line-1","reorder","updated",deps as any,true,{token:(await import("../lib/wms/vendor-order/reorder-material")).vendorReorderMaterial(workspace,picking.vendorOrderLines[0]).token,purchaseOrderNumbers:["111"]});
 const transferred=workspace.runs.find(run=>run.logisticsReceiptLines?.length===2)!;
 assert.equal(workspace.runs.length,3);assert.equal(transferred.logisticsReceiptLines?.length,2);assert.equal(transferred.reviews["222"].quantity,5,"supplier order quantity 12 must not replace original shortage 2+3");
 let current=board();const generated=await generateLogisticsFollowUp(workspace,current,{token:logisticsFollowUpToken(workspace,current),expectedCollectedAt:at,kind:"reorder"});
 const xml=await (await JSZip.loadAsync(Buffer.from(generated.base64,"base64"))).file("xl/worksheets/sheet1.xml")!.async("string");assert.match(xml,/<c r="C3"[^>]*t="n"><v>5<\/v><\/c>/);
 workspace.logisticsFollowUp={proofs:[generated.proof]};
 const later=detail("99990003","C",9,5);targets.push(target(later.shipmentNumber));workspace.logisticsReceipts!.requestedShipmentNumbers.push(later.shipmentNumber);workspace.logisticsReceipts!.shipments.push({shipmentNumber:later.shipmentNumber,status:"마감",totalDelivered:9,totalReceived:5,lines:[{...later,productName:"검증상품",barcode:"R"}]});
 reserveOrigin(later);
 picking.vendorOrderLines.push(vendorLine("line-2",[later]));picking.vendorOrderLines[1].updatedAt="later";
 await moveWorkListItem("vendor","line-2","reorder","later",deps as any,true,{token:(await import("../lib/wms/vendor-order/reorder-material")).vendorReorderMaterial(workspace,picking.vendorOrderLines[1]).token,purchaseOrderNumbers:["111"]});
 current=board();completeLogisticsFollowUp(workspace,current,{token:logisticsFollowUpToken(workspace,current),expectedCollectedAt:at,kind:"reorder",outputKey:generated.outputKey,confirmRequested:true,validatedSavedProof:generated.proof},at);
 assert.deepEqual(pendingReorderQueue(workspace).rows.map(row=>row.shortageQuantity),[4],"later vendor shipment stays pending");
 assert.equal(workspace.runs.find(run=>run.id===transferred.id)!.reorderRequestedLines![0].shortageQuantity,5,'completion ledger aggregates both source quantities');
 assert(workspace.runs.filter(run=>details.some(row=>row.lineKey===run.logisticsReceiptLine?.lineKey)).every(run=>run.completedAt),'original vendor receipt tasks finish only after file completion');
 assert.equal(workspace.runs.find(run=>run.logisticsReceiptLine?.lineKey===later.lineKey)?.completedAt,undefined);
  const firstVendorLine = picking.vendorOrderLines.find((row:any) => row.id === "line-1");
  assert(firstVendorLine, "first vendor shipment line exists");
  await moveWorkListItem("vendor","line-1","reorder",firstVendorLine.updatedAt,deps as any,true,{token:(await import("../lib/wms/vendor-order/reorder-material")).vendorReorderMaterial(workspace,firstVendorLine).token,purchaseOrderNumbers:["111"]});
 assert.equal(workspace.runs.length,5,"retry reuses original transfer without duplicate source run");
 current=board(); const last=await generateLogisticsFollowUp(workspace,current,{token:logisticsFollowUpToken(workspace,current),expectedCollectedAt:at,kind:'reorder'});
 workspace.logisticsFollowUp!.proofs!.push(last.proof);
 completeLogisticsFollowUp(workspace,board(),{token:logisticsFollowUpToken(workspace,board()),expectedCollectedAt:at,kind:'reorder',outputKey:last.outputKey,confirmRequested:true,validatedSavedProof:last.proof},at);
 assert.equal(pendingReorderQueue(workspace).rows.length,0,'single source array completes through actual file proof');
 assert(workspace.runs.find(run=>run.logisticsReceiptLine?.lineKey===later.lineKey)?.completedAt);
 console.log("PASS vendor response move -> exact multi-shipment reorder XLSX -> proof completion; 12 order vs 2+3 shortage; later 4 retained (memory only)");
})().catch(error=>{console.error(error);process.exitCode=1});
