import Link from "next/link";
import AppNavigation from "../AppNavigation";
import SupplyStatusAuditPanel from "./SupplyStatusAuditPanel";
import WimsRegistrationImportPanel from "./WimsRegistrationImportPanel";

export default function ProductRegistrationPage() {
  return (
    <main className="shell">
      <AppNavigation active="product-registration" />
      <header className="hero">
        <div className="heroBrandArea">
          <h1>상품 등록 상태 관리</h1>
          <p className="note">Supplier Hub WIMS 승인 확인부터 제품DB 연결, 상품공급상태 점검까지 한 화면에서 처리합니다.</p>
          <div className="heroUtilityActions">
            <Link className="imageGeneratorLink" href="/wms/product-catalog">상품 연결 대장</Link>
            <Link className="imageGeneratorLink" href="/">AI 상품등록 홈</Link>
          </div>
        </div>
      </header>
      <section id="product-registration-status" className="card full">
        <div className="wms-section-heading" style={{ marginTop: 0 }}>
          <div><span>PRODUCT REGISTRATION</span><h2>등록 진행상황 · 상품 운영정보</h2></div>
          <p>WIMS 승인 확인 → SKU 연결 → 상품공급상태 갱신</p>
        </div>
        <div className="wms-automation-grid">
          <WimsRegistrationImportPanel />
          <SupplyStatusAuditPanel />
        </div>
      </section>
    </main>
  );
}
