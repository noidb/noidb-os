"use client";

import { useRef, useState } from "react";
import { getVendorOrderCardImage, vendorOrderCardKey } from "@/lib/wms/vendor-order/card-image";
import type { VendorOrderDraftLine, VendorOrderDraftStatus } from "@/lib/wms/vendor-order/types";
import type { PickingWave } from "@/lib/wms/picking-wave/types";
import { wmsColors, wmsGreenDarkButton, wmsPrimaryButton } from "@/lib/wms/ui-tokens";

interface Props {
  wave: PickingWave;
  vendorName: string;
  lines: VendorOrderDraftLine[];
  status: VendorOrderDraftStatus;
  productLinksBySku?: Record<string, string>;
  readOnly: boolean;
  busy: boolean;
  statusSaving: boolean;
  onBeforeExport: () => Promise<VendorOrderDraftLine[]>;
  onMarkSent: () => void | Promise<void>;
  orderDate: string;
}

/** 초안에 표시한 카드 이미지 그대로 저장하고, 사용자가 전송완료를 기록한다. */
export default function VendorOrderExportPanel({ vendorName, lines, status, readOnly, busy, statusSaving, onBeforeExport, onMarkSent, orderDate }: Props) {
  const [shareBusy, setShareBusy] = useState(false);
  const [shareFallbackMessage, setShareFallbackMessage] = useState<string | null>(null);
  const latest = useRef({ vendorName, lines, orderDate });
  latest.current = { vendorName, lines, orderDate };

  function downloadBlob(blob: Blob, fileName: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  /** SKU별 카드 파일만 저장한다. Web Share나 자동 카카오톡 전송은 사용하지 않는다. */
  async function handleShare() {
    if (readOnly || status === "sent" || busy || statusSaving || shareBusy) return;
    setShareBusy(true);
    setShareFallbackMessage(null);
    try {
      const checkedLines = await onBeforeExport();
      if (!checkedLines.length) throw new Error("출력할 발주 상품이 없습니다.");
      const blobs = await Promise.all(checkedLines.map(line => getVendorOrderCardImage(vendorName, line, orderDate)));
      const exportedKeys = checkedLines.map(line => vendorOrderCardKey(vendorName, line, orderDate)).sort();
      const visibleKeys = latest.current.lines.map(line => vendorOrderCardKey(latest.current.vendorName, line, latest.current.orderDate)).sort();
      if (JSON.stringify(exportedKeys) !== JSON.stringify(visibleKeys)) throw new Error("발주 내용이 변경됐습니다. 이미지를 다시 저장해 주세요.");
      if (blobs.some(blob => !blob)) {
        setShareFallbackMessage("이미지 발주서 생성에 실패했습니다 — 다시 시도해주세요.");
        return;
      }
      blobs.forEach((blob, index) => downloadBlob(blob!, `발주서_${vendorName}_${checkedLines[index].skuId}.png`));
      setShareFallbackMessage("SKU별 카드 이미지를 다운로드했습니다 — 카카오톡에서 직접 첨부해주세요.");
    } catch (error) {
      if (error instanceof Error && error.name !== "AbortError") {
        setShareFallbackMessage(error.message || "이미지를 저장하지 못했습니다. 다시 시도해주세요.");
      }
    } finally {
      setShareBusy(false);
    }
  }

  if (status === "sent") return null;

  return (
    <div style={{ marginTop: "12px", paddingTop: "12px", borderTop: `1px dashed ${wmsColors.border}` }}>
      <p style={{ fontSize: "12px", color: wmsColors.muted, margin: "0 0 10px" }}>카카오톡으로 보낸 뒤 전송완료를 눌러주세요.</p>

      {shareFallbackMessage && (
        <p role="status" style={{ fontSize: "11px", color: wmsColors.warn, marginBottom: "8px" }}>{shareFallbackMessage}</p>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "12px" }}>
        <button
          onClick={handleShare}
          disabled={readOnly || shareBusy || busy || statusSaving}
          style={{ ...wmsPrimaryButton, minHeight: "48px", fontSize: "12px", padding: "0 6px", whiteSpace: "normal", lineHeight: 1.25, opacity: shareBusy ? 0.6 : 1 }}
        >
          {shareBusy ? "생성 중..." : "카카오톡용 이미지 저장"}
        </button>
        <button
          onClick={() => { if (!readOnly) void onMarkSent(); }}
          disabled={readOnly || busy || statusSaving || shareBusy}
          style={{ ...wmsGreenDarkButton, minHeight: "48px", fontSize: "12px", padding: "0 6px", whiteSpace: "normal", lineHeight: 1.25, opacity: readOnly || busy || statusSaving ? 0.65 : 1 }}
        >
          전송완료
        </button>
      </div>
    </div>
  );
}
