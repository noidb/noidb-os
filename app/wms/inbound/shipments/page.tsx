"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { summarizeShipmentReceipt } from "@/lib/wms/shipment-receipts";

type Summary = ReturnType<typeof summarizeShipmentReceipt>;
export default function ShipmentReceiptsPage() {
  const [orders, setOrders] = useState<Summary[]>([]);
  const [purchaseOrders, setPurchaseOrders] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  async function load() {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/wms/vendor-orders/shipment-receipts", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "쉽먼트 자료를 읽지 못했습니다.");
      setOrders(data.orders);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "쉽먼트 자료를 읽지 못했습니다."); }
    finally { setBusy(false); }
  }
  useEffect(() => { void load(); }, []);
  const poNumbers = [...new Set(purchaseOrders.trim().split(/[\s,]+/).filter(Boolean))];
  const valid = poNumbers.length > 0 && poNumbers.length <= 200 && poNumbers.every(po => /^\d{1,20}$/.test(po));
  async function importFile(file: File) {
    setBusy(true); setError(""); setMessage("");
    try {
      if (file.size > 2_000_000) throw new Error("자료 파일은 2MB 이하로 나누어 가져와 주세요.");
      const response = await fetch("/api/wms/vendor-orders/shipment-receipts", { method: "POST", headers: { "Content-Type": "application/json" }, body: await file.text() });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "자료를 저장하지 못했습니다.");
      setOrders(previous => [...previous.filter(order => !data.orders.some((fresh: Summary) => fresh.purchaseOrderNumber === order.purchaseOrderNumber)), ...data.orders]);
      setMessage(`발주 ${data.orders.length}건의 쉽먼트 입고결과를 저장했습니다.`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "자료를 저장하지 못했습니다."); }
    finally { setBusy(false); }
  }
  return <main className="shell" style={{ padding: 20, maxWidth: 1000, margin: "0 auto" }}>
    <h1>쉽먼트 입고결과</h1>
    <p>출고한 발주번호로 조회합니다. 연결된 쉽먼트가 전부 마감되어야 최종 입고수량을 확인할 수 있습니다.</p>
    <label style={{ display: "block" }}>확인할 발주번호
      <textarea value={purchaseOrders} onChange={event => setPurchaseOrders(event.target.value)} rows={3} style={{ display: "block", width: "100%" }} placeholder="발주번호를 줄바꿈 또는 쉼표로 구분해 주세요." />
    </label>
    {valid && <a href={`https://supplier.coupang.com/ibs/asn/active#noidb-po=${encodeURIComponent(poNumbers.join(","))}`} target="_blank" rel="noreferrer" style={{ display: "inline-block", padding: 12 }}>쿠팡에서 {poNumbers.length}건 가져오기 →</a>}
    <p>쿠팡 쉽먼트 화면의 ‘쉽먼트 입고결과 가져오기’ → ‘NOID-B로 전송’을 누른 뒤 이 화면에서 새로고침하세요.</p>
    <p>수집 버튼은 NOID-B 확장프로그램 0.9.3부터 표시됩니다. 파일로 저장했다면 아래에서 가져올 수도 있습니다.</p>
    <label>수집 자료 파일 가져오기 <input type="file" accept=".json,application/json" disabled={busy} onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void importFile(file); }} /></label>
    <button type="button" disabled={busy} onClick={() => void load()} style={{ margin: 12, padding: 10 }}>{busy ? "처리 중…" : "새로고침"}</button>
    {error && <p role="alert" style={{ color: "#a22" }}>{error}</p>}
    {message && <p role="status">{message}</p>}
    <p>9월 17일 당시 완료한 쉽먼트는 날짜로 추정하지 않습니다. 이 화면은 조회한 입고결과를 보관하며, 미납 분류·과거 완료처리를 자동 실행하지 않습니다.</p>
    {orders.length === 0 && !busy && !error && <p>아직 가져온 쉽먼트 자료가 없습니다.</p>}
    {[...orders].sort((a, b) => b.collectedAt.localeCompare(a.collectedAt)).map(order => <section key={order.purchaseOrderNumber} style={{ border: "1px solid #d6ddd6", borderRadius: 10, padding: 16, marginBottom: 12 }}>
      <h2 style={{ fontSize: 18 }}>발주 {order.purchaseOrderNumber} · {order.complete ? "전체 쉽먼트 마감" : "확인 대기"}</h2>
      <p>쉽먼트 {order.shipmentCount}건 중 마감 {order.closedCount}건 · 조회 {new Date(order.collectedAt).toLocaleString("ko-KR")}</p>
      {!order.shipmentCount && <p>연결된 쉽먼트를 찾지 못했습니다. 입고 0개로 확정하지 않습니다.</p>}
      {!!order.pendingShipmentNumbers.length && <p>마감 전: {order.pendingShipmentNumbers.join(", ")}</p>}
      {order.complete && <table style={{ width: "100%", textAlign: "left" }}><thead><tr><th>SKU</th><th>최종 입고수량</th></tr></thead><tbody>{Object.entries(order.receivedBySku).map(([sku, count]) => <tr key={sku}><td>{sku}</td><td>{count}</td></tr>)}</tbody></table>}
    </section>)}
    <Link href="/wms/work-center">작업센터로</Link>
  </main>;
}
