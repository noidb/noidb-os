"use client";

import { useEffect, useState, type CSSProperties } from "react";
import { usePickingWaveRepository } from "@/lib/wms/picking-wave/context";
import { buildBasketDisplayNames } from "@/lib/wms/picking-wave/basket-display";
import type { BasketAssignment, PickingWave, PickingWaveItem } from "@/lib/wms/picking-wave/types";
import { WMS_MOBILE_WIDTH, wmsColors, wmsPrimaryButton, wmsGhostButton } from "@/lib/wms/ui-tokens";
import PoConfirmSection from "./PoConfirmSection";
import HanjinUploadSection from "./HanjinUploadSection";

export default function WmsPickingWaveCompletePage({ params }: { params: { waveId: string } }) {
  const waveRepository = usePickingWaveRepository();
  const [wave, setWave] = useState<PickingWave | null>(null);
  const [items, setItems] = useState<PickingWaveItem[]>([]);
  const [baskets, setBaskets] = useState<BasketAssignment[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const [loadedWave, loadedItems, loadedBaskets] = await Promise.all([
        waveRepository.getWave(params.waveId),
        waveRepository.listItems(params.waveId),
        waveRepository.listBaskets(params.waveId),
      ]);
      setWave(loadedWave);
      setItems(loadedItems);
      setBaskets(loadedBaskets);
      setLoading(false);
    })();
  }, [params.waveId, waveRepository]);

  if (loading) {
    return (
      <main style={pageStyle}>
        <p style={{ color: wmsColors.muted }}>불러오는 중...</p>
      </main>
    );
  }

  if (!wave) {
    return (
      <main style={pageStyle}>
        <h1 style={{ fontSize: "18px" }}>통합 피킹 완료</h1>
        <p style={{ color: "#c0392b" }}>해당 통합 피킹 작업을 찾을 수 없습니다.</p>
        <a href="/wms/picking/waves" style={{ color: wmsColors.green, fontWeight: 700 }}>
          목록으로
        </a>
      </main>
    );
  }

  const totalQuantity = items.reduce((sum, item) => sum + item.totalQuantity, 0);
  const pickedQuantity = items.reduce((sum, item) => sum + item.pickedQuantity, 0);
  const shortageQuantity = items.reduce((sum, item) => sum + item.shortageQuantity, 0);
  const unlocatedCount = items.filter(item => item.locationStatus === "unlocated").length;

  // 바구니(발주서) 완료 여부: 그 발주서를 포함하는 모든 아이템이 처리되었는지로 판단한다.
  const basketDisplayNames = buildBasketDisplayNames(baskets);
  const basketStatuses = baskets.map(basket => {
    const relatedItems = items.filter(item => item.sources.some(source => source.basketNumber === basket.basketNumber));
    const done = relatedItems.length > 0 && relatedItems.every(item => item.status !== "pending");
    return { ...basket, done };
  });

  return (
    <main style={pageStyle}>
      <div style={{ textAlign: "center", padding: "24px 0" }}>
        <div style={{ fontSize: "40px" }}>✅</div>
        <h1 style={{ fontSize: "20px", margin: "8px 0" }}>통합 피킹 완료</h1>
        <p style={{ color: wmsColors.muted, margin: 0 }}>{wave.id}</p>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "10px" }}>
        <SummaryTile label="전체 발주서 수" value={wave.sourcePurchaseOrderNumbers.length} />
        <SummaryTile label="전체 SKU 종류 수" value={items.length} />
        <SummaryTile label="전체 피킹 수량" value={totalQuantity} />
        <SummaryTile label="찾은 수량" value={pickedQuantity} />
        <SummaryTile label="부족 수량" value={shortageQuantity} highlight={shortageQuantity > 0} />
        <SummaryTile label="위치 미등록 SKU 수" value={unlocatedCount} highlight={unlocatedCount > 0} />
      </div>

      <div style={{ marginTop: "20px" }}>
        <h2 style={{ fontSize: "14px", margin: "0 0 8px" }}>바구니별 완료 상태</h2>
        <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
          {basketStatuses.map(basket => (
            <div
              key={basket.basketNumber}
              style={{
                display: "flex",
                justifyContent: "space-between",
                border: `1px solid ${wmsColors.border}`,
                borderRadius: "8px",
                padding: "8px 12px",
                fontSize: "13px",
                background: basket.done ? wmsColors.greenSoft : "#ffffff",
              }}
            >
              <span>
                <strong>{basketDisplayNames[basket.basketNumber] || `바구니 ${basket.basketNumber}`}</strong>
                <span style={{ color: wmsColors.muted, fontSize: "11px" }}> (발주서 {basket.purchaseOrderNumber})</span>
                {basket.shipmentNumber ? ` / 쉽먼트 ${basket.shipmentNumber}` : ""}
              </span>
              <span style={{ fontWeight: 700, color: basket.done ? wmsColors.greenDark : wmsColors.muted }}>
                {basket.done ? "완료" : "미완료"}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div style={{ marginTop: "20px" }}>
        <h2 style={{ fontSize: "14px", margin: "0 0 8px" }}>발주확정 서류 생성</h2>
        <p style={{ fontSize: "11px", color: wmsColors.muted, margin: "0 0 10px" }}>
          발주서별로 실제 찾은 수량을 확인하고, 필요하면 확정수량을 직접 고친 뒤 서류를 생성하세요.
          원본 PO_FOR_CONFIRM 파일을 찾지 못하면 안내 메시지가 뜹니다 (lib/wms/data/po-for-confirm
          폴더에 넣어야 합니다). 외부 Supplier Hub에는 자동 업로드하지 않습니다 — 파일만 만들어집니다.
        </p>
        {wave.sourcePurchaseOrderNumbers.map(poNumber => (
          <PoConfirmSection key={poNumber} purchaseOrderNumber={poNumber} items={items} />
        ))}
      </div>

      <HanjinUploadSection baskets={baskets} />

      {shortageQuantity > 0 && (
        <a href={`/wms/picking/waves/${wave.id}/vendor-orders`} style={{ display: "block", textDecoration: "none", marginTop: "20px" }}>
          <button style={{ ...wmsPrimaryButton, width: "100%" }}>거래처별 부족분 발주서 보기 ({shortageQuantity}개)</button>
        </a>
      )}

      <a href="/wms/picking/waves" style={{ display: "block", textDecoration: "none", marginTop: "10px" }}>
        <button style={{ ...wmsGhostButton, width: "100%" }}>목록으로</button>
      </a>
    </main>
  );
}

const pageStyle: CSSProperties = {
  maxWidth: WMS_MOBILE_WIDTH,
  margin: "0 auto",
  padding: "16px",
  fontFamily: "sans-serif",
  background: wmsColors.background,
  color: wmsColors.ink,
  minHeight: "100vh",
};

function SummaryTile({ label, value, highlight }: { label: string; value: number; highlight?: boolean }) {
  return (
    <div style={{ background: wmsColors.surfaceBeige, border: `1px solid ${wmsColors.border}`, borderRadius: "12px", padding: "14px", textAlign: "center" }}>
      <div style={{ fontSize: "22px", fontWeight: 800, color: highlight && value > 0 ? wmsColors.warn : wmsColors.ink }}>{value}</div>
      <div style={{ fontSize: "12px", color: wmsColors.muted, marginTop: "2px" }}>{label}</div>
    </div>
  );
}
