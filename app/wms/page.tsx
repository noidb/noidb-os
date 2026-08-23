const ROUTES: { href: string; label: string }[] = [
  { href: "/wms/work-center", label: "작업센터 (발주서 조회)" },
  { href: "/wms/picking", label: "피킹" },
  { href: "/wms/vendor-orders", label: "거래처 발주" },
  { href: "/wms/vendor-orders/status-requests", label: "단종/해제 SKU" },
  { href: "/wms/inbound", label: "입고" },
  { href: "/wms/shipment", label: "쉽먼트" },
  { href: "/wms/inventory", label: "재고" },
  { href: "/wms/warehouse", label: "창고" },
];

export default function WmsHomePage() {
  return (
    <main style={{ padding: "40px", fontFamily: "sans-serif" }}>
      <h1>NOID WMS</h1>
      <p>창고/발주/피킹 관리 시스템(WMS)의 진입 화면입니다.</p>
      <p>상태: 개발 중 (Sprint 1 — 발주서 읽기 전용 조회 진행 중)</p>
      <ul>
        {ROUTES.map(route => (
          <li key={route.href}>
            <a href={route.href}>{route.label}</a>
          </li>
        ))}
      </ul>
    </main>
  );
}
