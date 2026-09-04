"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useShipmentRepository } from "@/lib/wms/shipment/context";
import type { Shipment } from "@/lib/wms/shipment/types";
import { wmsColors, wmsGhostButton, wmsOuterCard } from "@/lib/wms/ui-tokens";
import ShipmentWorkflow from "./ShipmentWorkflow";

export default function ShipmentDetailPage({ params }: { params: { shipmentId: string } }) {
  const repository = useShipmentRepository();
  const [shipment, setShipment] = useState<Shipment | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    repository.getShipment(params.shipmentId).then(setShipment).catch(reason => setError(reason instanceof Error ? reason.message : "Shipment를 불러오지 못했습니다."));
  }, [params.shipmentId, repository]);

  if (shipment === undefined) return <main style={{ padding: "20px" }}>불러오는 중...</main>;
  if (!shipment || error) return <main style={{ padding: "20px" }}><p>{error || "Shipment를 찾지 못했습니다."}</p><Link href="/wms/shipment">목록으로</Link></main>;
  const first = shipment.purchaseOrders[0];
  return <main style={{ maxWidth: "760px", margin: "0 auto", padding: "18px 14px 40px", fontFamily: "sans-serif", color: wmsColors.ink }}>
    <Link href="/wms/shipment" style={{ ...wmsGhostButton, minHeight: "38px", display: "inline-flex", alignItems: "center", textDecoration: "none", marginBottom: "12px" }}>← Shipment 목록</Link>
    <section style={{ ...wmsOuterCard, padding: "14px", marginBottom: "14px" }}><h1 style={{ fontSize: "21px", margin: "0 0 4px" }}>{shipment.name}</h1><div style={{ color: wmsColors.muted, fontSize: "12px", lineHeight: 1.6 }}>{shipment.id}<br />발주서 {shipment.purchaseOrders.length}건 · SKU {shipment.purchaseOrders.reduce((sum, order) => sum + order.skuCount, 0)}종 · 총 {shipment.purchaseOrders.reduce((sum, order) => sum + order.totalQuantity, 0)}개<br />{first?.fulfillmentCenter} · {first?.expectedDate}</div></section>
    <ShipmentWorkflow initialShipment={shipment} />
  </main>;
}
