"use client";

import { useEffect, useRef, useState } from "react";
import { resolveDisplayNameAndOption } from "@/lib/wms/display-name";
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
  const [error, setError] = useState<{ key: string; message: string } | null>(null);
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
      }).catch(() => {
        if (active) setError({ key, message: "사진을 불러오지 못했습니다." });
      });
    }, 150);
    return () => { active = false; window.clearTimeout(timer); if (url) URL.revokeObjectURL(url); };
  }, [key, retry]);

  const { name, option } = resolveDisplayNameAndOption(line.productName, line.optionLabel);
  const imageReady = image?.key === key;
  const currentError = error?.key === key ? error : null;
  const fallback = <div style={{ padding: "24px 16px", border: `1px solid ${wmsColors.border}`, borderRadius: 10, textAlign: "center" }}>
    <p style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>{name || "상품명 없음"}</p>
    {option && <p style={{ margin: "6px 0 0", fontSize: 16, fontWeight: 700 }}>{option}</p>}
    <p style={{ margin: "10px 0 0", fontSize: 14, color: wmsColors.muted }}>주문수량 {line.shortageQuantity}개</p>
    {currentError ? <div role="alert" style={{ marginTop: 12 }}><p style={{ margin: "0 0 8px" }}>{currentError.message}</p><button type="button" style={wmsSecondaryButton} onClick={() => setRetry(value => value + 1)}>다시 시도</button></div>
      : <p role="status" style={{ margin: "12px 0 0", color: wmsColors.muted }}>이미지 준비 중…</p>}
  </div>;

  return <div data-vendor-card-preview={line.id} style={{ width: "100%", maxWidth: 420, marginInline: "auto" }}>
    {imageReady ? <img src={image.url} alt={`${line.productName} · ${line.optionLabel || ""} · 주문수량 ${line.shortageQuantity}개`} draggable={false} style={{ display: "block", width: "100%", height: "auto", borderRadius: 10 }} /> : fallback}
    {onEditImage && <button type="button" style={{ ...wmsSecondaryButton, marginTop: 12, width: "100%" }} onClick={onEditImage}>사진 수정</button>}
  </div>;
}
