import { createHash } from "node:crypto";
import { savedWeeklyMaterial } from "../saved-weekly-material";
import type { WeeklyWorkspace, WeeklySnapshot } from "../weekly-work-types";
import type { VendorOrderDraftLine } from "./types";
import { logisticsReceiptLineKey } from "../logistics-receipts";

/** Missing legacy PO links are proposed from exact-SKU saved evidence, then explicitly confirmed. */
export function vendorReorderMaterial(workspace: WeeklyWorkspace, line: VendorOrderDraftLine, selectedPurchaseOrders?: string[]) {
  if (line.isStockReplenishment) throw new Error("재고보충 상품은 입고완료로 처리해 주세요.");
  const imported = line.importedVendorSource;
  if (imported) {
    const sourcePos = imported.details.map(detail => detail.purchaseOrderNumber);
    const selected = selectedPurchaseOrders || sourcePos;
    if (imported.kind !== "aside-vendor-pending" || imported.skuId !== line.skuId || !imported.batchId || !imported.fileName || !imported.sheetName || !Number.isSafeInteger(imported.rowNumber) || imported.rowNumber <= 0 || !imported.recordedAt
      || !sourcePos.length || new Set(sourcePos).size !== sourcePos.length || sourcePos.some(po => !/^\d+$/.test(po))
      || new Set(line.relatedPurchaseOrderNumbers.map(po => po.trim()).filter(Boolean)).size !== sourcePos.length || sourcePos.some(po => !line.relatedPurchaseOrderNumbers.map(value => value.trim()).includes(po))
      || !selected.length || new Set(selected).size !== selected.length || selected.length !== sourcePos.length || selected.some(po => !sourcePos.includes(po))) throw new Error("가져온 거래처 미납 발주번호를 확인해 주세요.");
    const details = imported.details.map(detail => {
      if (!Number.isSafeInteger(detail.confirmedQuantity) || detail.confirmedQuantity <= 0 || !Number.isSafeInteger(detail.receivedQuantity) || detail.receivedQuantity < 0
        || !Number.isSafeInteger(detail.shortageQuantity) || detail.shortageQuantity <= 0 || detail.confirmedQuantity - detail.receivedQuantity !== detail.shortageQuantity) throw new Error("가져온 거래처 미납수량을 확인해 주세요.");
      return { ...detail };
    });
    const quantity = details.reduce((sum, detail) => sum + detail.shortageQuantity, 0);
    if (!Number.isSafeInteger(quantity) || quantity <= 0) throw new Error("가져온 거래처 미납수량을 확인해 주세요.");
    const evidence = { kind: imported.kind, batchId: imported.batchId, fileName: imported.fileName, sheetName: imported.sheetName, rowNumber: imported.rowNumber, recordedAt: imported.recordedAt, skuId: imported.skuId, details };
    const sourceToken = createHash("sha256").update(JSON.stringify(evidence)).digest("hex");
    const item = { skuId: line.skuId, productName: line.productName, productLink: "", vendorName: line.vendorName, imageUrl: line.imageUrl, optionLabel: line.optionLabel, modelName: line.modelName, barcode: line.barcode, shortageQuantity: quantity, openOrderQuantity: 0, suggestedQuantity: quantity, relatedPurchaseOrderNumbers: selected, shortageDetails: details, issues: [], discontinued: false };
    const snapshot: WeeklySnapshot = { id: `VENDOR-ASIDE-${sourceToken.slice(0,24)}`, sourceToken, operationalToken: sourceToken, createdAt: imported.recordedAt, period: { startDate: imported.recordedAt.slice(0,10), endDate: imported.recordedAt.slice(0,10) }, source: { files: [imported.fileName], latestActualDate: "", firstActualDate: "", eventCount: 0, duplicateCount: 0, selectedEventCount: 0, mode: "upload" }, couponItems: [], vendorItems: [item], warnings: [], blockers: [] };
    const token = createHash("sha256").update(JSON.stringify([line, evidence, workspace.revision])).digest("hex");
    return { snapshot, item, token, linkedFromSku: false, purchaseOrderNumbers: selected, importedVendorEvidence: true as const };
  }
  const details = line.shipmentReceiptDetails;
  if (details?.length) {
    const sourcePos = [...new Set(details.map(detail => detail.purchaseOrderNumber))];
    const selected = selectedPurchaseOrders || sourcePos;
    if (!selected.length || new Set(selected).size !== selected.length || selected.some(po => !sourcePos.includes(po)) || selected.length !== sourcePos.length) throw new Error("원본 쉽먼트 발주번호를 모두 선택해 주세요.");
    const keys = new Set<string>();
    const lines = details.filter(detail => selected.includes(detail.purchaseOrderNumber)).map(detail => {
      if (detail.skuId !== line.skuId || !detail.lineKey || keys.has(detail.lineKey) || detail.lineKey !== logisticsReceiptLineKey(detail.shipmentNumber, detail.boxId, detail.purchaseOrderNumber, detail.skuId)
        || !Number.isSafeInteger(detail.deliveredQuantity) || detail.deliveredQuantity < 0 || !Number.isSafeInteger(detail.receivedQuantity) || detail.receivedQuantity < 0 || !Number.isSafeInteger(detail.shortageQuantity) || detail.shortageQuantity <= 0 || (detail.handledQuantity !== undefined && (!Number.isSafeInteger(detail.handledQuantity) || detail.handledQuantity < 0))
        || detail.deliveredQuantity - detail.receivedQuantity - (detail.handledQuantity || 0) !== detail.shortageQuantity) throw new Error("원본 쉽먼트 미납수량을 확인해 주세요.");
      keys.add(detail.lineKey);
      const shipment = workspace.logisticsReceipts?.shipments.find(item => item.shipmentNumber === detail.shipmentNumber);
      const current = shipment?.status === "마감" ? shipment.lines.find(item => logisticsReceiptLineKey(shipment.shipmentNumber,item.boxId,item.purchaseOrderNumber,item.skuId) === detail.lineKey) : undefined;
      if (!current || current.deliveredQuantity !== detail.deliveredQuantity || current.receivedQuantity !== detail.receivedQuantity) throw new Error("현재 쉽먼트 수집 자료와 원본 미납수량이 달라 재발주할 수 없습니다.");
      return detail;
    });
    const byPo = new Map<string,{purchaseOrderNumber:string;confirmedQuantity:number;receivedQuantity:number;shortageQuantity:number}>();
    for (const detail of lines) { const row=byPo.get(detail.purchaseOrderNumber)||{purchaseOrderNumber:detail.purchaseOrderNumber,confirmedQuantity:0,receivedQuantity:0,shortageQuantity:0}; row.confirmedQuantity+=detail.deliveredQuantity;row.receivedQuantity+=detail.receivedQuantity;row.shortageQuantity+=detail.shortageQuantity;byPo.set(detail.purchaseOrderNumber,row); }
    const item = { skuId: line.skuId, productName: line.productName, productLink: "", vendorName: line.vendorName, imageUrl: line.imageUrl, optionLabel: line.optionLabel, modelName: line.modelName, barcode: line.barcode, shortageQuantity: lines.reduce((sum,row)=>sum+row.shortageQuantity,0), openOrderQuantity:0,suggestedQuantity:lines.reduce((sum,row)=>sum+row.shortageQuantity,0),relatedPurchaseOrderNumbers:selected,shortageDetails:[...byPo.values()],issues:[],discontinued:false };
    const snapshot: WeeklySnapshot = { id:`VENDOR-SHIPMENT-${createHash("sha256").update(JSON.stringify(lines)).digest("hex").slice(0,24)}`,sourceToken:createHash("sha256").update(JSON.stringify(lines)).digest("hex"),createdAt:line.updatedAt,period:{startDate:line.updatedAt.slice(0,10),endDate:line.updatedAt.slice(0,10)},source:{files:lines.map(row=>`쉽먼트 ${row.shipmentNumber}`),latestActualDate:"",firstActualDate:"",eventCount:0,duplicateCount:0,selectedEventCount:0,mode:"browser"},couponItems:[],vendorItems:[item],warnings:[],blockers:[] };
    const token=createHash("sha256").update(JSON.stringify([line,lines,workspace.revision])).digest("hex");
    return { snapshot,item,token,linkedFromSku:false,purchaseOrderNumbers:selected,shipmentReceiptLines:lines };
  }
  const sourcePos = [...new Set(line.relatedPurchaseOrderNumbers.map(po=>po.trim()).filter(Boolean))];
  const snapshots = [workspace.materialSnapshot, ...workspace.runs.filter(r=>!r.id.startsWith("TRANSFER-")).map(r=>r.snapshot)].filter((s): s is WeeklySnapshot=>Boolean(s)).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
  const candidate = snapshots.find(s=>s.vendorItems.some(i=>i.skuId===line.skuId && i.shortageDetails?.length));
  const candidateItem = candidate?.vendorItems.find(i=>i.skuId===line.skuId);
  const proposed = sourcePos.length ? sourcePos : candidateItem?.shortageDetails?.filter(d=>d.shortageQuantity>0).map(d=>d.purchaseOrderNumber) || [];
  const selected = selectedPurchaseOrders || proposed;
  if (!selected.length) throw new Error(`SKU ${line.skuId}의 연결 가능한 미입고 발주번호가 없습니다. 입고상세내역에서 원래 발주번호를 확인해 주세요.`);
  if (selected.some(po=>!proposed.includes(po)) || new Set(selected).size!==selected.length || sourcePos.length && (selected.length!==sourcePos.length || sourcePos.some(po=>!selected.includes(po)))) throw new Error("원래 발주번호 또는 확인한 미입고 목록이 달라졌습니다. 다시 확인해 주세요.");
  const material = savedWeeklyMaterial(workspace,line.skuId,selected);
  const token = createHash("sha256").update(JSON.stringify([line,material.item.shortageDetails,material.snapshot.id,material.snapshot.createdAt,workspace.revision])).digest("hex");
  return { ...material, token, linkedFromSku:sourcePos.length===0, purchaseOrderNumbers:selected };
}
