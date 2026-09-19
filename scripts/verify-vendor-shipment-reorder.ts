import assert from "node:assert/strict";
import { vendorReorderMaterial } from "../lib/wms/vendor-order/reorder-material";
import { pendingReorderQueue } from "../lib/wms/weekly-reorder-queue";
import { emptyWeeklyWorkspace } from "../lib/wms/weekly-work-state";
import type { VendorOrderDraftLine } from "../lib/wms/vendor-order/types";
const at="2026-09-20T00:00:00.000Z", ws=emptyWeeklyWorkspace();
const details=[
 {lineKey:'["99990001","A","111","222"]',shipmentNumber:'99990001',boxId:'A',purchaseOrderNumber:'111',skuId:'222',deliveredQuantity:5,receivedQuantity:3,shortageQuantity:2},
 {lineKey:'["99990002","B","111","222"]',shipmentNumber:'99990002',boxId:'B',purchaseOrderNumber:'111',skuId:'222',deliveredQuantity:7,receivedQuantity:4,shortageQuantity:3},
];
ws.logisticsReceipts={source:'supplier-hub-shipments',schemaVersion:2,collectedAt:at,requestedShipmentNumbers:details.map(x=>x.shipmentNumber),shipments:details.map(x=>({shipmentNumber:x.shipmentNumber,status:'마감',totalDelivered:x.deliveredQuantity,totalReceived:x.receivedQuantity,lines:[{...x,productName:'검증상품',barcode:'R'}]}))};
const line={id:'sent',draftId:'d',waveId:'w',vendorName:'V',skuId:'222',modelName:'',category:'',optionLabel:'',productName:'검증상품',imageUrl:'',barcode:'R',shortageQuantity:5,relatedPurchaseOrderNumbers:['111'],updatedAt:at,createdAt:at,isManuallyAdded:true,shipmentReceiptDetails:details} as VendorOrderDraftLine;
const material=vendorReorderMaterial(ws,line);assert.equal(material.shipmentReceiptLines!.length,2);assert.equal(material.item.shortageQuantity,5);
ws.runs.push({id:'TRANSFER',revision:0,updatedAt:at,sentVendors:{},snapshot:{...material.snapshot,id:'TRANSFER',vendorItems:[material.item]},reviews:{'222':{skuId:'222',vendorName:'V',imageUrl:'',quantity:5,quantityConfirmed:true,decision:'reorder'}},routedElsewhereSkuIds:[],logisticsReceiptLines:material.shipmentReceiptLines!});
let queue=pendingReorderQueue(ws);assert.equal(queue.rows[0].shortageQuantity,5);assert.equal(queue.sources.length,2,'same PO/SKU retains two exact shipment sources');
console.log('PASS vendor shipment material validates/retains two sources and queue aggregates only for XLSX (memory only)');
