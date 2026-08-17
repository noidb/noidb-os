"use client";

import { useWmsPickingFlow } from "@/lib/wms/picking-flow-context";
import { WMS_MOBILE_WIDTH, wmsColors, wmsGhostButton } from "@/lib/wms/ui-tokens";

export default function WmsVendorOrdersPage() {
  const { activeBatch, vendorShortageSummary, resetFlow } = useWmsPickingFlow();

  if (!vendorShortageSummary) {
    return (
      <main style={{ maxWidth: WMS_MOBILE_WIDTH, margin: "0 auto", padding: "24px 16px", fontFamily: "sans-serif", color: wmsColors.ink }}>
        <h1>거래처 발주 (Vendor Orders)</h1>
        <p>피킹 부족분으로 자동 생성되는 거래처 발주를 조회하고 승인 후 발송할 화면입니다.</p>
        <p>
          상태: 개발 중 (Sprint 2 — 아직 피킹이 완료되지 않았습니다. <a href="/wms/work-center">작업센터</a>에서 피킹을 완료하면
          이 화면에 부족 수량이 자동으로 표시됩니다.)
        </p>
      </main>
    );
  }

  const totalShortageItems = vendorShortageSummary.reduce((sum, group) => sum + group.items.length, 0);

  return (
    <main style={{ padding: "40px", fontFamily: "sans-serif" }}>
      <h1>거래처 발주 (Vendor Orders)</h1>
      <p>
        {activeBatch?.center} 피킹 완료 — 부족 수량이 거래처별로 자동 그룹핑되었습니다. (샘플 데이터, 실제 발송/저장 없음)
      </p>

      {totalShortageItems === 0 ? (
        <p>부족 수량이 없습니다. 모든 발주 수량이 정상적으로 피킹되었습니다.</p>
      ) : (
        vendorShortageSummary.map(group => (
          <div key={group.vendorName} style={{ border: "1px solid #ddd", borderRadius: "8px", padding: "16px", marginBottom: "16px" }}>
            <h2 style={{ margin: "0 0 8px" }}>{group.vendorName}</h2>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
                <thead>
                  <tr style={{ textAlign: "left", borderBottom: "1px solid #ccc" }}>
                    <th>SKU ID</th>
                    <th>상품명</th>
                    <th>옵션</th>
                    <th>발주수량</th>
                    <th>찾은수량</th>
                    <th>부족수량</th>
                  </tr>
                </thead>
                <tbody>
                  {group.items.map(item => (
                    <tr key={item.skuId} style={{ borderBottom: "1px solid #eee" }}>
                      <td>{item.skuId}</td>
                      <td>{item.productName}</td>
                      <td>{item.optionLabel}</td>
                      <td>{item.orderedQty}</td>
                      <td>{item.pickedQty}</td>
                      <td style={{ color: wmsColors.warn, fontWeight: "bold" }}>{item.shortageQty}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button disabled style={{ marginTop: "8px" }} title="다음 스프린트에서 승인/발송 기능이 구현됩니다">
              승인 후 발송 (다음 스프린트 구현 예정)
            </button>
          </div>
        ))
      )}

      <button onClick={resetFlow} style={{ ...wmsGhostButton, width: "100%", marginTop: "16px" }}>
        작업 초기화
      </button>
    </main>
  );
}
