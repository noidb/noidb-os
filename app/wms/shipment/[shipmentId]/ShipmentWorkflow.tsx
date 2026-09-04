"use client";

import { useEffect, useMemo, useState } from "react";
import { usePickingWaveRepository } from "@/lib/wms/picking-wave/context";
import type { BasketAssignment, PickingWaveItem, ShipmentOutputGeneration } from "@/lib/wms/picking-wave/types";
import { useShipmentRepository } from "@/lib/wms/shipment/context";
import type { Shipment } from "@/lib/wms/shipment/types";
import { wmsColors } from "@/lib/wms/ui-tokens";
import HanjinUploadSection, { type HanjinGenerationResult } from "@/app/wms/picking/waves/[waveId]/complete/HanjinUploadSection";
import HanjinAutoShipmentSection from "@/app/wms/picking/waves/[waveId]/complete/HanjinAutoShipmentSection";
import ShipmentOutputSetSection from "@/app/wms/picking/waves/[waveId]/complete/ShipmentOutputSetSection";

export default function ShipmentWorkflow({ initialShipment }: { initialShipment: Shipment }) {
  const shipmentRepository = useShipmentRepository();
  const waveRepository = usePickingWaveRepository();
  const [shipment, setShipment] = useState(initialShipment);
  const [items, setItems] = useState<PickingWaveItem[]>([]);
  const [loadingItems, setLoadingItems] = useState(true);
  const orders = shipment.purchaseOrders;
  const expectedPurchaseOrders = useMemo(() => new Set(orders.map(order => order.purchaseOrderNumber)), [orders]);
  const generations = shipment.outputGeneration ? [shipment.outputGeneration] : [];

  useEffect(() => {
    let active = true;
    const waveIds = [...new Set(orders.map(order => order.sourceWaveId))];
    Promise.all(waveIds.map(waveId => waveRepository.listItems(waveId)))
      .then(groups => {
        if (!active) return;
        setItems(groups.flat().filter(item => item.sources.some(source => expectedPurchaseOrders.has(source.purchaseOrderNumber))));
      })
      .finally(() => { if (active) setLoadingItems(false); });
    return () => { active = false; };
  }, [expectedPurchaseOrders, orders, waveRepository]);

  const baskets: BasketAssignment[] = orders.map(order => ({
    basketNumber: order.basketNumber,
    purchaseOrderNumber: order.purchaseOrderNumber,
    fulfillmentCenter: order.fulfillmentCenter,
    shipmentNumber: shipment.id,
    waveId: order.sourceWaveId,
    status: "completed",
    createdAt: shipment.createdAt,
    updatedAt: shipment.updatedAt,
  }));

  async function saveInvoiceGeneration(result: HanjinGenerationResult) {
    const now = new Date().toISOString();
    const existing = shipment.outputGeneration;
    const generation: ShipmentOutputGeneration = {
      generationId: existing?.generationId || crypto.randomUUID(),
      waveId: shipment.id,
      purchaseOrderNumbers: [...result.purchaseOrderNumbers],
      createdAt: existing?.createdAt || now,
      updatedAt: now,
      expectedShippingGroupCount: result.preview.shippingGroupCount,
      invoiceFileName: result.fileName,
      status: "invoice_generated",
    };
    const updated = await shipmentRepository.updateShipmentGeneration(shipment.id, generation);
    setShipment(await shipmentRepository.updateShipmentStatus(updated.id, "invoice_generated"));
  }

  async function markShipmentGenerated(generationId: string, fileName: string) {
    const current = shipment.outputGeneration;
    if (!current || current.generationId !== generationId) return;
    const generation: ShipmentOutputGeneration = { ...current, shipmentFileName: fileName, status: "shipment_generated", updatedAt: new Date().toISOString() };
    const updated = await shipmentRepository.updateShipmentGeneration(shipment.id, generation);
    setShipment(await shipmentRepository.updateShipmentStatus(updated.id, "upload_generated"));
  }

  if (loadingItems) return <p style={{ margin: 0, color: wmsColors.muted, fontSize: "12px" }}>Shipment 상품을 불러오는 중...</p>;

  return <div style={{ display: "grid", gap: "10px" }}>
    <Step number={1} title="송장출력용 파일 생성">
      <HanjinUploadSection baskets={baskets} items={items} generations={generations} onGenerated={saveInvoiceGeneration} />
    </Step>
    <Step number={2} title="Shipment 파일 생성">
      <HanjinAutoShipmentSection generation={shipment.outputGeneration} onGenerated={markShipmentGenerated} />
    </Step>
    <Step number={3} title="Shipment 출력세트 생성">
      <ShipmentOutputSetSection waveId={shipment.id} items={items} generation={shipment.outputGeneration} generationLabel={shipment.name} />
    </Step>
  </div>;
}

function Step({ number, title, children }: { number: number; title: string; children: React.ReactNode }) {
  return <section style={{ border: `1px solid ${wmsColors.border}`, borderRadius: "12px", padding: "13px", background: "#fff" }}>
    <h2 style={{ margin: "0 0 10px", fontSize: "15px" }}>{number}. {title}</h2>
    {children}
  </section>;
}
