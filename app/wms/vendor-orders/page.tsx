import ShipmentReceiptsPage from "../inbound/shipments/page";

export const dynamic = "force-dynamic";

// 메인 '입고결과 확인' 화면. 예전 과거청산(주간 집계·미분류 실제미납)은 2026-10-08 사용자 요청으로 없앴다.
export default function VendorOrdersPage() {
  return <>
    <ShipmentReceiptsPage />
    <nav aria-label="입고결과 후속 업무" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 8, margin: "12px 0", padding: 12, background: "#fff", border: "1px solid #ddd7cd", borderRadius: 14 }}>
      {[
        ["단종 처리", "/wms/vendor-orders/status-requests", "softBeigeButton"],
        ["거래처 발주", "/wms/vendor-orders/manage", "softSageButton"],
        ["미납분 재발주요청", "/wms/inbound/reorder", "softSageButton"],
        ["입고확인 내역", "/wms/vendor-orders/receiving", "softBeigeButton"],
      ].map(([label, href, color]) => <a key={href} href={href} className={color} style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: 48, borderRadius: 8, textDecoration: "none", fontSize: 16, fontWeight: 800 }}>{label}</a>)}
    </nav>
  </>;
}
