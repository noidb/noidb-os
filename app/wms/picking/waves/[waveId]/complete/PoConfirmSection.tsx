"use client";

import { useMemo, useState } from "react";
import type { PickingWaveItem } from "@/lib/wms/picking-wave/types";
import { wmsColors, wmsPrimaryButton } from "@/lib/wms/ui-tokens";

interface Props {
  purchaseOrderNumber: string;
  items: PickingWaveItem[];
}

interface ConfirmRow {
  skuId: string;
  productName: string;
  originalQuantity: number;
  foundQuantity: number;
}

/**
 * 발주서(PO) 1건 단위로 실제 찾은 수량을 확인하고, 필요하면 확정수량을 직접 고쳐서
 * PO_FOR_CONFIRM 원본 템플릿에 반영한 서류를 생성하는 카드. 외부 Supplier Hub에는
 * 아무것도 자동 업로드하지 않는다 — 파일만 만들어 다운로드시킨다 (2026-08-19 신규).
 */
export default function PoConfirmSection({ purchaseOrderNumber, items }: Props) {
  const rows: ConfirmRow[] = useMemo(() => {
    return items
      .filter(item => item.sources.some(source => source.purchaseOrderNumber === purchaseOrderNumber))
      .map(item => {
        const source = item.sources.find(s => s.purchaseOrderNumber === purchaseOrderNumber)!;
        const allocation = item.allocations.find(a => a.purchaseOrderNumber === purchaseOrderNumber);
        return {
          skuId: item.productCode,
          productName: item.productName,
          originalQuantity: source.requestedQuantity,
          foundQuantity: allocation ? allocation.fulfilledQuantity : 0,
        };
      });
  }, [items, purchaseOrderNumber]);

  const [confirmedByskuId, setConfirmedByskuId] = useState<Record<string, number>>(() =>
    Object.fromEntries(rows.map(row => [row.skuId, row.foundQuantity]))
  );
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resultMessage, setResultMessage] = useState<string | null>(null);

  function updateConfirmed(skuId: string, value: number) {
    setConfirmedByskuId(prev => ({ ...prev, [skuId]: Math.max(0, value) }));
  }

  async function handleGenerate() {
    setGenerating(true);
    setError(null);
    setResultMessage(null);
    try {
      const response = await fetch("/api/wms/po-confirm/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          poNumber: purchaseOrderNumber,
          confirmedQuantities: rows.map(row => ({ skuId: row.skuId, confirmedQuantity: confirmedByskuId[row.skuId] ?? row.foundQuantity })),
        }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        setError(data.error || "발주확정 서류 생성에 실패했습니다.");
        return;
      }

      const matchedCount = response.headers.get("X-Matched-Sku-Count");
      const unmatchedRaw = response.headers.get("X-Unmatched-Sku-Ids");
      const unmatched = unmatchedRaw ? decodeURIComponent(unmatchedRaw).split(",").filter(Boolean) : [];

      const disposition = response.headers.get("Content-Disposition") || "";
      const fileNameMatch = disposition.match(/filename\*=UTF-8''(.+)$/);
      const fileName = fileNameMatch ? decodeURIComponent(fileNameMatch[1]) : `PO_FOR_CONFIRM(${purchaseOrderNumber}).xlsx`;

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      setResultMessage(
        `${matchedCount}개 SKU 확정수량 반영 완료` + (unmatched.length > 0 ? ` (원본에서 못 찾은 SKU: ${unmatched.join(", ")})` : "")
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "발주확정 서류 생성 중 오류가 발생했습니다.");
    } finally {
      setGenerating(false);
    }
  }

  if (rows.length === 0) return null;

  return (
    <div style={{ border: `1px solid ${wmsColors.border}`, borderRadius: "10px", padding: "12px", marginBottom: "10px" }}>
      <h3 style={{ margin: "0 0 8px", fontSize: "13px" }}>발주서 {purchaseOrderNumber}</h3>
      <div style={{ overflowX: "auto", marginBottom: "10px" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "11px" }}>
          <thead>
            <tr style={{ textAlign: "left", borderBottom: `1px solid ${wmsColors.border}`, color: wmsColors.muted }}>
              <th style={{ padding: "4px" }}>SKU/상품명</th>
              <th style={{ padding: "4px" }}>원래 발주수량</th>
              <th style={{ padding: "4px" }}>찾은 수량</th>
              <th style={{ padding: "4px" }}>확정수량</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(row => (
              <tr key={row.skuId} style={{ borderBottom: "1px solid #eee" }}>
                <td style={{ padding: "4px", maxWidth: "140px" }}>
                  <div style={{ fontWeight: 700 }}>{row.skuId}</div>
                  <div style={{ color: wmsColors.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{row.productName}</div>
                </td>
                <td style={{ padding: "4px" }}>{row.originalQuantity}</td>
                <td style={{ padding: "4px" }}>{row.foundQuantity}</td>
                <td style={{ padding: "4px" }}>
                  <input
                    type="number"
                    min={0}
                    value={confirmedByskuId[row.skuId] ?? row.foundQuantity}
                    onChange={e => updateConfirmed(row.skuId, Number(e.target.value) || 0)}
                    style={{ width: "50px", fontSize: "11px", padding: "3px 4px", borderRadius: "4px", border: `1px solid ${wmsColors.border}` }}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {error && <p style={{ fontSize: "11px", color: "#c0392b", marginBottom: "8px" }}>{error}</p>}
      {resultMessage && <p style={{ fontSize: "11px", color: wmsColors.greenDark, marginBottom: "8px" }}>{resultMessage}</p>}

      <button onClick={handleGenerate} disabled={generating} style={{ ...wmsPrimaryButton, width: "100%", minHeight: "36px", fontSize: "12px", opacity: generating ? 0.6 : 1 }}>
        {generating ? "생성 중..." : "발주확정 서류 생성"}
      </button>
    </div>
  );
}
