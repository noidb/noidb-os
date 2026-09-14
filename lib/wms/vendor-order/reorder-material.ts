import { createHash } from "node:crypto";
import { savedWeeklyMaterial } from "../saved-weekly-material";
import type { WeeklyWorkspace, WeeklySnapshot } from "../weekly-work-types";
import type { VendorOrderDraftLine } from "./types";

/** Missing legacy PO links are proposed from exact-SKU saved evidence, then explicitly confirmed. */
export function vendorReorderMaterial(workspace: WeeklyWorkspace, line: VendorOrderDraftLine, selectedPurchaseOrders?: string[]) {
  if (line.isStockReplenishment) throw new Error("재고보충 상품은 입고완료로 처리해 주세요.");
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
