import type { VendorOrderDraftLine } from "@/lib/wms/vendor-order/types";
import type { WeeklyPeriod, WeeklyReview, WeeklyVendorItem } from "@/lib/wms/weekly-work-types";

export function recentPeriod(days: number): WeeklyPeriod {
  const endDate = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const start = new Date(`${endDate}T12:00:00+09:00`);
  start.setDate(start.getDate() - days + 1);
  const startDate = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(start);
  return { startDate, endDate };
}

export function recentMonthPeriod(): WeeklyPeriod {
  const { endDate } = recentPeriod(1);
  const [year, month, day] = endDate.split("-").map(Number);
  const lastDayOfPreviousMonth = new Date(Date.UTC(year, month - 1, 0)).getUTCDate();
  const start = new Date(Date.UTC(year, month - 2, Math.min(day, lastDayOfPreviousMonth)));
  return { startDate: start.toISOString().slice(0, 10), endDate };
}

export function defaultReview(item: WeeklyVendorItem): WeeklyReview {
  return { skuId: item.skuId, vendorName: item.vendorName, imageUrl: item.imageUrl, quantity: item.suggestedQuantity, decision: item.discontinued ? "hold" : item.shortageQuantity > 0 && item.openOrderQuantity >= item.shortageQuantity ? "hold" : "order", quantityConfirmed: false };
}

export function reviewNeedsAttention(review: WeeklyReview): boolean {
  return review.decision === "order" && (!review.vendorName.trim() || !review.imageUrl.trim());
}

/** UI readiness only; the server validates the original PO quantities again. */
export function reorderNeedsAttention(item: WeeklyVendorItem): boolean {
  const details = item.shortageDetails;
  if (!details?.length || new Set(details.map(row => row.purchaseOrderNumber)).size !== details.length) return true;
  return details.some(row => !/^\d+$/.test(row.purchaseOrderNumber)
    || !Number.isSafeInteger(row.confirmedQuantity) || row.confirmedQuantity <= 0
    || !Number.isSafeInteger(row.receivedQuantity) || row.receivedQuantity < 0
    || !Number.isSafeInteger(row.shortageQuantity) || row.shortageQuantity <= 0
    || row.confirmedQuantity - row.receivedQuantity !== row.shortageQuantity)
    || details.reduce((sum, row) => sum + row.shortageQuantity, 0) !== item.shortageQuantity;
}

export function displayImageUrl(url: string): string {
  return url.startsWith("/") && !url.startsWith("//") ? url : `/api/wms/image-proxy?url=${encodeURIComponent(url)}`;
}

export async function resizeProductPhoto(file: File): Promise<string> {
  if (!/^image\/(png|jpeg|webp|gif|bmp|avif)$/i.test(file.type)) throw new Error("JPG, PNG, WEBP 등 상품 사진 파일을 선택해 주세요.");
  if (file.size > 25 * 1024 * 1024) throw new Error("25MB 이하의 사진을 선택해 주세요.");
  const source = URL.createObjectURL(file);
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => { img.onload = () => resolve(); img.onerror = () => reject(new Error("사진을 읽지 못했습니다. 다른 이미지로 다시 추가해 주세요.")); img.src = source; });
    if (!img.naturalWidth || !img.naturalHeight) throw new Error("사진 크기를 확인하지 못했습니다.");
    let scale = Math.min(1, 1200 / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement("canvas");
    for (let attempt = 0; attempt < 5; attempt++) {
      canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("이 브라우저에서 사진을 처리하지 못했습니다.");
      ctx.fillStyle = "white"; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL("image/jpeg", .84 - attempt * .05);
      if (dataUrl.length <= 700 * 1024) return dataUrl;
      scale *= .75;
    }
    throw new Error("사진 용량을 줄이지 못했습니다. 더 작은 사진을 추가해 주세요.");
  } finally { URL.revokeObjectURL(source); }
}

export interface WeeklyDownload { name: string; url: string; size: number }

/** Make every image before exposing the complete bundle; a missing photo fails visibly. */
export async function prepareWeeklyDownload(blob: Blob): Promise<{ blob: Blob; files: WeeklyDownload[] }> {
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(await blob.arrayBuffer());
  const manifest = zip.file("내부자료/거래처이미지.json");
  if (manifest) {
    const spec = JSON.parse(await manifest.async("string")) as { runId: string; vendors: Array<{ vendorName: string; baseName: string; lines: VendorOrderDraftLine[] }> };
    const { renderVendorOrderImage } = await import("@/lib/wms/vendor-order/render-order-image");
    for (const vendor of spec.vendors) {
      for (let offset = 0; offset < vendor.lines.length; offset += 8) {
        const image = await renderVendorOrderImage(vendor.vendorName, vendor.lines.slice(offset, offset + 8), spec.runId, { strictImages: true });
        if (!image || image.size === 0) throw new Error(`${vendor.vendorName}의 발주 이미지를 만들지 못했습니다. 다시 시도해 주세요.`);
        const safeBase = vendor.baseName.replace(/[\\/:*?"<>|]/g, "_").replace(/\.png$/i, "");
        zip.file(`거래처발주/${safeBase}_${Math.floor(offset / 8) + 1}.png`, await image.arrayBuffer());
      }
    }
    zip.remove("내부자료");
  }
  const files: WeeklyDownload[] = [];
  try {
    for (const entry of Object.values(zip.files)) {
      if (entry.dir || entry.name.startsWith("내부자료/")) continue;
      const data = await entry.async("arraybuffer");
      const mime = entry.name.endsWith(".pdf") ? "application/pdf" : entry.name.endsWith(".png") ? "image/png" : entry.name.endsWith(".xlsx") ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" : "application/octet-stream";
      files.push({ name: entry.name, size: data.byteLength, url: URL.createObjectURL(new Blob([data], { type: mime })) });
    }
    return { blob: new Blob([await zip.generateAsync({ type: "arraybuffer", compression: "DEFLATE" })], { type: "application/zip" }), files };
  } catch (error) { files.forEach(file => URL.revokeObjectURL(file.url)); throw error; }
}
