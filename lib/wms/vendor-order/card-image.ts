import { renderVendorOrderImage } from "./render-order-image";
import type { VendorOrderDraftLine } from "./types";

// Preview and download share the same bytes. Save timestamps are intentionally
// excluded so saving an unchanged draft does not load every product photo again.
const cards = new Map<string, Promise<Blob>>();

export function vendorOrderCardKey(vendorName: string, line: VendorOrderDraftLine, orderDate: string): string {
  return JSON.stringify([vendorName, orderDate, line.skuId, line.productName, line.optionLabel,
    line.category, line.imageUrl, line.barcode, line.shortageQuantity, line.actualShortageQuantity, line.memo]);
}

export function getVendorOrderCardImage(vendorName: string, line: VendorOrderDraftLine, orderDate: string): Promise<Blob> {
  const key = vendorOrderCardKey(vendorName, line, orderDate);
  const cached = cards.get(key);
  if (cached) return cached;
  const pending = renderVendorOrderImage(vendorName, [line], line.waveId, {
    orderDate, strictImages: Boolean(line.imageUrl),
  }).then(blob => {
    if (!blob) throw new Error("발주서 이미지를 만들지 못했습니다. 다시 시도해 주세요.");
    return blob;
  }).catch(error => {
    cards.delete(key);
    throw error;
  });
  cards.set(key, pending);
  if (cards.size > 120) cards.delete(cards.keys().next().value!);
  return pending;
}
