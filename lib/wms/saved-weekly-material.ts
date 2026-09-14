import type { WeeklySnapshot, WeeklyWorkspace, WeeklyVendorItem } from "./weekly-work-types";
export function savedWeeklyOperationalToken(workspace: WeeklyWorkspace): string | undefined {
  return workspace.materialSnapshot?.operationalToken || workspace.runs.filter(run=>!run.id.startsWith("TRANSFER-")).sort((a,b)=>b.snapshot.createdAt.localeCompare(a.snapshot.createdAt))[0]?.snapshot.operationalToken;
}
/** File output and routing use the last explicit analysis, never poll source files. */
export function savedWeeklyMaterial(workspace: WeeklyWorkspace, skuId: string, purchaseOrders: string[]): { snapshot: WeeklySnapshot; item: WeeklyVendorItem } {
  const pos = [...new Set(purchaseOrders.map(po => po.trim()).filter(Boolean))];
  if (!pos.length || pos.some(po => !/^\d+$/.test(po))) throw new Error(`SKU ${skuId}의 원래 발주번호를 확인할 수 없습니다. 이번주 입고상세내역 조회를 먼저 해 주세요.`);
  const snapshots = [workspace.materialSnapshot, ...workspace.runs.filter(run=>!run.id.startsWith("TRANSFER-")).map(run => run.snapshot)].filter((snapshot): snapshot is WeeklySnapshot => Boolean(snapshot)).sort((a,b) => b.createdAt.localeCompare(a.createdAt));
  // An explicit later zero/stop for the same PO+SKU must never be replaced by old shortage evidence.
  for (const po of pos) {
    const latest = snapshots.find(snapshot => snapshot.vendorItems.some(item => item.skuId === skuId && item.shortageDetails?.some(detail => detail.purchaseOrderNumber === po)));
    const latestItem = latest?.vendorItems.find(item => item.skuId === skuId);
    const latestDetail = latestItem?.shortageDetails?.find(detail => detail.purchaseOrderNumber === po);
    if (latestItem?.discontinued || latestDetail && latestDetail.shortageQuantity <= 0) throw new Error(`발주 ${po} · SKU ${skuId}는 최신 자료에서 미납이 아니거나 단종 상태입니다.`);
  }
  const snapshot = snapshots.find(snapshot => snapshot.vendorItems.some(item => item.skuId === skuId && pos.every(po => item.shortageDetails?.some(detail => detail.purchaseOrderNumber === po))));
  const item = snapshot?.vendorItems.find(item => item.skuId === skuId);
  if (!snapshot || !item || snapshot.blockers.length || item.discontinued || workspace.productOverrides[skuId]?.discontinued) throw new Error(`SKU ${skuId}의 저장된 미납 자료가 없거나 단종 상태입니다. 입고상세내역 조회 또는 단종해제 상태를 확인해 주세요.`);
  const details = item.shortageDetails!.filter(detail => pos.includes(detail.purchaseOrderNumber));
  if (details.length !== pos.length || details.some(detail => !Number.isSafeInteger(detail.shortageQuantity) || detail.shortageQuantity <= 0 || detail.confirmedQuantity - detail.receivedQuantity !== detail.shortageQuantity || detail.receivedQuantity < 0)) throw new Error(`SKU ${skuId}의 발주번호별 미납수량을 확인해 주세요.`);
  const quantity = details.reduce((sum, detail) => sum + detail.shortageQuantity, 0);
  return { snapshot, item: { ...item, shortageDetails: details, relatedPurchaseOrderNumbers: pos, shortageQuantity: quantity, confirmedQuantity: details.reduce((n,d)=>n+d.confirmedQuantity,0), receivedQuantity: details.reduce((n,d)=>n+d.receivedQuantity,0) } };
}
