import { calculateSupplierHubShortages } from "@/lib/wms/supplier-hub-shortage";
import { readPickingWaveStore } from "@/lib/wms/picking-wave/server-store";
import { fetchProductCatalog, normalizeSkuId } from "@/lib/wms/product-catalog";
import { loadSupplierHubPurchaseOrders } from "@/lib/wms/supplier-hub-orders";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const headers = ["발주번호", "SKU ID", "상품명", "확정수량", "_주간원문검증오류"];

export default async function WmsInboundPage() {
  try {
    const [store, orders, catalog] = await Promise.all([
      readPickingWaveStore(), loadSupplierHubPurchaseOrders(), fetchProductCatalog(),
    ]);
    const purchaseRows = [headers, ...orders.flatMap(order => order.items.map(item => [
      order.purchaseOrderNumber, normalizeSkuId(item.productCode), item.productName, String(item.vendorConfirmedQuantity), "",
    ]))];
    const calculation = calculateSupplierHubShortages({
      statuses: store.supplierHubOrderStatuses,
      events: store.supplierHubInboundEvents,
      purchaseRows,
    });
    const catalogBySku = new Map(catalog.items.map(item => [normalizeSkuId(item.skuId), item]));
    const totalShortage = calculation.shortagePairs.reduce((sum, item) => sum + item.shortageQuantity, 0);
    return <main style={{ maxWidth: 1280, margin: "0 auto", padding: "28px 18px", fontFamily: "sans-serif", color: "#29352f" }}>
      <h1 style={{ marginBottom: 8 }}>입고결과 · 실제미납</h1>
      <p style={{ color: "#66736a" }}>정산완료 발주서만 대상으로 발주번호+SKU별 확정수량과 Supplier Hub 실제 입고를 대조합니다.</p>
      <section aria-label="실제미납 요약" style={{ margin: "22px 0", padding: 18, border: "1px solid #dfe6dc", borderRadius: 12, background: "#f7faf5" }}>
        <strong style={{ fontSize: 20 }}>확정 실제미납 {calculation.shortagePairs.length.toLocaleString()}건 · 총 {totalShortage.toLocaleString()}개</strong>
        <p style={{ marginBottom: 0, color: "#66736a" }}>정산완료 {calculation.exactSettledCount}개 발주서 · 매입용 제외 {calculation.excludedPurchaseTypeCount}개 · inbound 고유 이벤트 {calculation.uniqueInboundEventCount.toLocaleString()}건 · 계산불가 {calculation.unresolvedPairs.length}개</p>
      </section>
      {calculation.noInboundEventOrderNumbers.length ? <p role="alert" style={{ color: "#9a492d" }}>입고데이터 미확인 발주서 {calculation.noInboundEventOrderNumbers.length}개: {calculation.noInboundEventOrderNumbers.join(", ")}</p> : null}
      {calculation.shortagePairs.length ? <div style={{ overflowX: "auto" }}><table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}><caption style={{ textAlign: "left", padding: "0 0 10px", fontWeight: 700 }}>발주번호+SKU별 실제미납</caption><thead><tr>{["발주번호", "SKU ID", "상품명", "확정 발주수량", "실제 입고수량", "실제미납수량", "거래처"].map(label => <th key={label} scope="col" style={{ padding: 9, textAlign: "left", background: "#eef4eb", borderBottom: "1px solid #dfe6dc", whiteSpace: "nowrap" }}>{label}</th>)}</tr></thead><tbody>{calculation.shortagePairs.map(item => { const product = catalogBySku.get(item.skuId); return <tr key={JSON.stringify([item.orderNo, item.skuId])}>{[item.orderNo, item.skuId, item.skuName || product?.productName || "상품명 확인 필요", `${item.confirmedQuantity.toLocaleString()}개`, `${item.receivedQuantity.toLocaleString()}개`, `${item.shortageQuantity.toLocaleString()}개`, product?.vendorName || "거래처 확인 필요"].map((value, index) => <td key={index} style={{ padding: 9, borderBottom: "1px solid #edf0e8", whiteSpace: index === 2 ? "normal" : "nowrap" }}>{value}</td>)}</tr>; })}</tbody></table></div> : <p>현재 확정 실제미납이 없습니다.</p>}
    </main>;
  } catch (error) {
    return <main style={{ padding: "40px 18px", fontFamily: "sans-serif", color: "#9a492d" }}><h1>입고결과 · 실제미납</h1><p role="alert">자료를 불러오지 못했습니다: {error instanceof Error ? error.message : "원본과 Supplier Hub 자료를 확인해 주세요."}</p></main>;
  }
}
