import ShipmentReceiptsPage from "../inbound/shipments/page";

export const dynamic = "force-dynamic";

// 메인 '입고결과 확인' 화면. 예전 과거청산(주간 집계·미분류 실제미납)은 2026-10-08 사용자 요청으로 없앴다.
// 아래 바로가기 4개(단종 처리·거래처 발주·미납분 재발주요청·입고확인 내역)는 2026-10-20 사용자 요청으로 뺐다.
export default function VendorOrdersPage() {
  return <ShipmentReceiptsPage />;
}
