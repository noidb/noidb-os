import type { PickingWave } from "./picking-wave/types";

/** Only current, non-superseded output sets may cover the remaining POs. */
export function shipmentDocumentsReady(wave: PickingWave): boolean {
  const orders = new Set(wave.sourcePurchaseOrderNumbers);
  const covered = new Set((wave.outputGenerations || []).filter(g =>
    !g.supersededByGenerationId && g.status === "shipment_generated"
    && g.shipmentFileName && g.outputSetFileName && g.outputSetGeneratedAt
    && g.purchaseOrderNumbers.every(po => orders.has(po))
  ).flatMap(g => g.purchaseOrderNumbers));
  return orders.size > 0 && [...orders].every(po => covered.has(po));
}
