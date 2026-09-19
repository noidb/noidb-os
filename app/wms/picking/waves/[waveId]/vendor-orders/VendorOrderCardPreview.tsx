"use client";

import { useEffect, useRef, useState } from "react";
import type { VendorOrderDraftLine } from "@/lib/wms/vendor-order/types";
import { getVendorOrderCardImage, vendorOrderCardKey } from "@/lib/wms/vendor-order/card-image";
import { wmsColors, wmsSecondaryButton } from "@/lib/wms/ui-tokens";

export default function VendorOrderCardPreview({ line, vendorName, orderDate, onEditImage }: {
  line: VendorOrderDraftLine; vendorName: string; orderDate: string; onEditImage?: () => void;
}) {
  const key = vendorOrderCardKey(vendorName, line, orderDate);
  const current = useRef({ line, vendorName, orderDate });
  current.current = { line, vendorName, orderDate };
  const [image, setImage] = useState<{ key: string; url: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let active = true;
    let url: string | undefined;
    setError(null);
    const timer = window.setTimeout(() => {
      const input = current.current;
      void getVendorOrderCardImage(input.vendorName, input.line, input.orderDate).then(blob => {
        if (!active) return;
        url = URL.createObjectURL(blob);
        setImage({ key, url });
      }).catch(reason => {
        if (active) setError(reason instanceof Error ? reason.message : "이미지를 준비하지 못했습니다.");
      });
    }, 150);
    return () => { active = false; window.clearTimeout(timer); if (url) URL.revokeObjectURL(url); };
  }, [key, retry]);

  return <div data-vendor-card-preview={line.id} style={{ width: "100%", maxWidth: 420, marginInline: "auto" }}>
    {image?.key === key ? <img src={image.url} alt={`${line.productName} · ${line.optionLabel || ""} · 주문수량 ${line.shortageQuantity}개`} draggable={false} style={{ display: "block", width: "100%", height: "auto", borderRadius: 10 }} />
      : !error && <p role="status" style={{ padding: "32px 12px", textAlign: "center", color: wmsColors.muted }}>이미지 준비 중…</p>}
    {error && <div role="alert"><p>{error}</p><button type="button" style={wmsSecondaryButton} onClick={() => setRetry(value => value + 1)}>다시 시도</button></div>}
    {onEditImage && <button type="button" style={{ ...wmsSecondaryButton, marginTop: 12, width: "100%" }} onClick={onEditImage}>사진 수정</button>}
  </div>;
}
