"use client";

import { useState } from "react";
import type { ProductCatalogItem } from "@/lib/wms/product-catalog";
import { getWmsDisplayImageUrl } from "@/lib/wms/image-display-url";
import { wmsColors } from "@/lib/wms/ui-tokens";

/**
 * SKU리스트 화면 2종(sku-list, sku-summary) 공용 제품 썸네일 (2026-10-02).
 * 입고처리 화면(app/wms/vendor-orders/receiving)과 같은 방식: 제품DB 이미지 주소를
 * getWmsDisplayImageUrl로 표시용 주소로 바꾸고, 비었거나 로드 실패하면 드라이브 사진 폴더에서
 * 모델명으로 찾는 /api/wms/product-image/from-drive로 대신 띄운다. 둘 다 실패하면 "이미지 없음".
 * 누르면 큰 이미지를 새 탭으로 연다.
 */
export default function ProductThumb({ catalog, skuId, alt }: { catalog?: ProductCatalogItem; skuId: string; alt: string }) {
  const driveFallbackUrl = `/api/wms/product-image/from-drive?model=${encodeURIComponent(catalog?.modelSku || catalog?.modelName || skuId)}`;
  const [src, setSrc] = useState(() => getWmsDisplayImageUrl(catalog?.imageUrl) || driveFallbackUrl);
  const [failed, setFailed] = useState(false);

  if (failed) {
    return <div style={{ width: "72px", height: "72px", borderRadius: "10px", background: "#f2f2f2", fontSize: "11px", color: wmsColors.muted, display: "grid", placeItems: "center" }}>이미지 없음</div>;
  }
  return (
    <a href={src} target="_blank" rel="noreferrer" style={{ lineHeight: 0 }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt}
        loading="lazy"
        onError={() => { if (src !== driveFallbackUrl) setSrc(driveFallbackUrl); else setFailed(true); }}
        style={{ width: "72px", height: "72px", objectFit: "cover", borderRadius: "10px", display: "block", background: "#f2f2f2" }}
      />
    </a>
  );
}
