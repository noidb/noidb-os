import WeeklyWork from "../inbound/WeeklyWork";
import ActualInboundShortage from "./actual-inbound-shortage/ActualInboundShortage";

export const dynamic = "force-dynamic";

export default function VendorOrdersPage() {
  return <>
    <nav style={{ padding: 20 }}><a href="/wms/inbound/shipments">쉽먼트 입고결과 가져오기 →</a></nav>
    <WeeklyWork clearanceMode />
    <ActualInboundShortage pendingOnly />
    <nav aria-label="입고결과 후속 업무" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12, margin: "24px 0", padding: 20, background: "#fff", border: "1px solid #ddd7cd", borderRadius: 14 }}>
      {[
        ["단종 처리", "/wms/vendor-orders/status-requests"],
        ["거래처 발주", "/wms/vendor-orders/manage"],
        ["미납분 재발주요청", "/wms/inbound/reorder"],
        ["입고확인 내역", "/wms/vendor-orders/receiving"],
      ].map(([label, href]) => <a key={href} href={href} style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: 48, padding: "10px 14px", border: "1px solid #ddd7cd", borderRadius: 10, color: "#29352f", background: "#f5f2ec", textDecoration: "none", fontWeight: 700 }}>{label}</a>)}
    </nav>
  </>;
}
