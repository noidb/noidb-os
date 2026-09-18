import { calculateSupplierHubShortages } from "@/lib/wms/supplier-hub-shortage";
import { readPickingWaveStore } from "@/lib/wms/picking-wave/server-store";
import { fetchProductCatalog, normalizeSkuId } from "@/lib/wms/product-catalog";
import { loadSupplierHubPurchaseOrders } from "@/lib/wms/supplier-hub-orders";
import { readWeeklyCompletionSummary } from "@/lib/wms/weekly-completion-summary";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const headers = ["발주번호", "SKU ID", "상품명", "확정수량", "_주간원문검증오류"];
const pairKey = (orderNo: string, skuId: string) => JSON.stringify([orderNo, skuId]);
const expectedDate = (value: string | undefined) => /^\d{4}-\d{2}-\d{2}$/.test(value || "") ? value! : "";

export default async function WmsInboundPage() {
  try {
    const [store, orders, catalog, completion] = await Promise.all([
      readPickingWaveStore(), loadSupplierHubPurchaseOrders(), fetchProductCatalog(), readWeeklyCompletionSummary(),
    ]);
    const automaticLines = store.supplierHubOriginalOrderLines;
    const automaticKeys = new Set(automaticLines.map(line => pairKey(line.orderNo.trim(), normalizeSkuId(line.skuId))));
    const automaticRows = automaticLines.map(line => [
      line.orderNo.trim(), normalizeSkuId(line.skuId), line.skuName,
      line.confirmedOrderQuantity == null ? "" : String(line.confirmedOrderQuantity), line.sourceIssue || "",
    ]);
    const historicalRows = orders.flatMap(order => order.items.map(item => [
      order.purchaseOrderNumber, normalizeSkuId(item.productCode), item.productName, String(item.vendorConfirmedQuantity), "",
    ]).filter(row => !automaticKeys.has(pairKey(row[0], row[1]))));
    const purchaseRows = [headers, ...automaticRows, ...historicalRows];
    const calculation = calculateSupplierHubShortages({
      statuses: store.supplierHubOrderStatuses,
      events: store.supplierHubInboundEvents,
      purchaseRows,
    });
    const catalogBySku = new Map(catalog.items.map(item => [normalizeSkuId(item.skuId), item]));
    const expectedDates = new Map(orders.map(order => [order.purchaseOrderNumber.trim(), expectedDate(order.expectedDate)]));
    for (const line of automaticLines) {
      const value = expectedDate(line.expectedDate);
      if (value) expectedDates.set(line.orderNo.trim(), value);
    }
    const totalShortage = calculation.shortagePairs.reduce((sum, item) => sum + item.shortageQuantity, 0);
    const completedKeys = new Set(completion.completedShortagePairs);
    const activeShortages = (completion.available ? calculation.shortagePairs.filter(item => !completedKeys.has(pairKey(item.orderNo, item.skuId))) : calculation.shortagePairs)
      .sort((left, right) => {
        const leftDate = expectedDate(expectedDates.get(left.orderNo));
        const rightDate = expectedDate(expectedDates.get(right.orderNo));
        if (leftDate && !rightDate) return -1;
        if (!leftDate && rightDate) return 1;
        return (leftDate || "9999-99-99").localeCompare(rightDate || "9999-99-99")
          || left.orderNo.localeCompare(right.orderNo) || left.skuId.localeCompare(right.skuId);
      });
    const activeShortage = activeShortages.reduce((sum, item) => sum + item.shortageQuantity, 0);
    const completedShortageCount = completion.available ? calculation.shortagePairs.length - activeShortages.length : 0;
    const completedShortageQuantity = completion.available ? totalShortage - activeShortage : 0;
    return <main style={{ maxWidth: 1280, margin: "0 auto", padding: "28px 18px", fontFamily: "sans-serif", color: "#29352f" }}>
      <h1 style={{ marginBottom: 8 }}>입고결과 · 실제미납</h1>
      <p style={{ color: "#66736a" }}>정산완료 발주서만 대상으로 발주번호+SKU별 확정수량과 Supplier Hub 실제 입고를 대조합니다.</p>
      <section aria-label="실제미납 요약" style={{ margin: "22px 0", padding: 18, border: "1px solid #dfe6dc", borderRadius: 12, background: "#f7faf5" }}>
        <strong style={{ fontSize: 20 }}>실제미납 총 발생 {calculation.shortagePairs.length.toLocaleString()}건 · 총 {totalShortage.toLocaleString()}개</strong>
        <p style={{ margin: "8px 0 0", color: "#66736a" }}>{completion.available ? `재발주 처리완료 ${completedShortageCount.toLocaleString()}건 · ${completedShortageQuantity.toLocaleString()}개 · 현재 미처리 ${activeShortages.length.toLocaleString()}건 / ${activeShortage.toLocaleString()}개` : "완료이력을 확인할 수 없어 현재 미처리 수량은 보류했습니다."}</p>
        <p style={{ marginBottom: 0, color: "#66736a" }}>정산완료 {calculation.exactSettledCount}개 발주서 · 매입용 제외 {calculation.excludedPurchaseTypeCount}개 · inbound 고유 이벤트 {calculation.uniqueInboundEventCount.toLocaleString()}건 · 계산불가 {calculation.unresolvedPairs.length}개</p>
      </section>
      <section aria-label="1개입고 업무" style={{ margin: "22px 0", padding: 18, border: "1px solid #dfe6dc", borderRadius: 12 }}>
        <strong>1개입고 총 대상 {completion.available ? completion.couponTotal.toLocaleString() : "확인 불가"}건</strong>
        <p style={{ marginBottom: 0, color: "#66736a" }}>{completion.available ? `쿠폰·광고 처리완료 ${completion.couponCompleted.toLocaleString()}건 · 현재 미처리 ${completion.couponPending.toLocaleString()}건` : "완료이력을 확인할 수 없습니다."}</p>
      </section>
      {calculation.noInboundEventOrderNumbers.length ? <p role="alert" style={{ color: "#9a492d" }}>입고데이터 미확인 발주서 {calculation.noInboundEventOrderNumbers.length}개: {calculation.noInboundEventOrderNumbers.join(", ")}</p> : null}
      {activeShortages.length ? <div style={{ overflowX: "auto" }}><table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}><caption style={{ textAlign: "left", padding: "0 0 10px", fontWeight: 700 }}>현재 미처리 실제미납</caption><thead><tr>{["입고예정일", "발주번호", "SKU ID", "상품명", "확정 발주수량", "실제 입고수량", "실제미납수량", "거래처", "처리상태"].map(label => <th key={label} scope="col" style={{ padding: 9, textAlign: "left", background: "#eef4eb", borderBottom: "1px solid #dfe6dc", whiteSpace: "nowrap" }}>{label}</th>)}</tr></thead><tbody>{activeShortages.map(item => { const product = catalogBySku.get(item.skuId); const values = [expectedDate(expectedDates.get(item.orderNo)) || "미확인", item.orderNo, item.skuId, item.skuName || product?.productName || "상품명 확인 필요", `${item.confirmedQuantity.toLocaleString()}개`, `${item.receivedQuantity.toLocaleString()}개`, `${item.shortageQuantity.toLocaleString()}개`, product?.vendorName || "거래처 확인 필요", completion.available ? "미처리" : "완료이력 확인 불가"]; return <tr key={pairKey(item.orderNo, item.skuId)}>{values.map((value, index) => <td key={index} style={{ padding: 9, borderBottom: "1px solid #edf0e8", whiteSpace: index === 3 ? "normal" : "nowrap" }}>{value}</td>)}</tr>; })}</tbody></table></div> : <p>현재 미처리 실제미납이 없습니다.</p>}
    </main>;
  } catch (error) {
    return <main style={{ padding: "40px 18px", fontFamily: "sans-serif", color: "#9a492d" }}><h1>입고결과 · 실제미납</h1><p role="alert">자료를 불러오지 못했습니다: {error instanceof Error ? error.message : "원본과 Supplier Hub 자료를 확인해 주세요."}</p></main>;
  }
}
