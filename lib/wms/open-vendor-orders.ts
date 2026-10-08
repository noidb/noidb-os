import { normalizeSkuId } from "./sku-normalize";
import { deriveVendorOrderDrafts } from "./vendor-order/derive-drafts";
import { vendorLineClassification } from "./vendor-order/receiving-state";
import type { PickingWaveStoreSnapshot } from "./picking-wave/shared-store-types";

export interface OpenVendorOrder {
  /** 거래처에 이미 보냈고 아직 입고가 끝나지 않은 수량 합계 */
  quantity: number;
  vendors: string[];
  /** 가장 이른 발주 전송일(YYYY-MM-DD) */
  sentOn: string;
  /** 입고지연으로 표시된 발주가 있는지 */
  delayed: boolean;
}

/**
 * SKU별로 '이미 거래처에 보낸 발주 중 입고가 끝나지 않은 것'(입고대기·입고지연)을 모은다.
 * 아직 보내지 않은 발주서는 거래처발주 시 자동으로 합쳐지므로 여기 넣지 않는다.
 */
export function openVendorOrdersBySku(store: Pick<PickingWaveStoreSnapshot, "vendorOrderDrafts" | "vendorOrderLines" | "deletedVendorLineIds" | "deletedVendorDraftIds">): Record<string, OpenVendorOrder> {
  const drafts = new Map(deriveVendorOrderDrafts(store.vendorOrderDrafts || [], store.vendorOrderLines || []).map(draft => [draft.id, draft]));
  const result: Record<string, OpenVendorOrder> = {};
  for (const line of store.vendorOrderLines || []) {
    const draft = drafts.get(line.draftId);
    if (!draft || draft.status !== "sent" || store.deletedVendorLineIds?.[line.id] || store.deletedVendorDraftIds?.[line.draftId] || line.orderExclusion) continue;
    const state = vendorLineClassification(line);
    if (state === "resolved") continue;
    const remaining = Math.max(0, (line.shortageQuantity || 0) - (line.receivedQuantity || 0));
    if (!remaining) continue;
    const skuId = normalizeSkuId(line.skuId);
    const sentOn = (draft.sentAt || line.updatedAt || "").slice(0, 10);
    const current = result[skuId] || { quantity: 0, vendors: [], sentOn, delayed: false };
    current.quantity += remaining;
    if (!current.vendors.includes(line.vendorName)) current.vendors.push(line.vendorName);
    if (sentOn && (!current.sentOn || sentOn < current.sentOn)) current.sentOn = sentOn;
    current.delayed ||= state === "delayed";
    result[skuId] = current;
  }
  return result;
}
