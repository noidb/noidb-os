import type { ShipmentOutputGeneration } from "./picking-wave/types";

export interface OutputGenerationProgress {
  total: number;
  completed: number;
  pending: number;
  superseded: number;
  purchaseOrderTotal: number;
  completedPurchaseOrders: number;
  pendingPurchaseOrders: number;
}

export function summarizeOutputGenerations(generations: readonly ShipmentOutputGeneration[], sourcePurchaseOrderNumbers?: readonly string[]): OutputGenerationProgress {
  const allPurchaseOrders = new Set(sourcePurchaseOrderNumbers ?? generations.flatMap(generation => generation.purchaseOrderNumbers));
  const completedPurchaseOrderSet = new Set(generations
    .filter(generation => generation.status === "shipment_generated")
    .flatMap(generation => generation.purchaseOrderNumbers).filter(po => allPurchaseOrders.has(po)));
  const completed = generations.filter(generation => generation.status === "shipment_generated").length;
  const unfinished = generations.filter(generation => generation.status !== "shipment_generated");
  const superseded = unfinished.filter(generation => generation.purchaseOrderNumbers.every(po => completedPurchaseOrderSet.has(po))).length;
  const pending = unfinished.length - superseded;
  return {
    total: completed + pending,
    completed,
    pending,
    superseded,
    purchaseOrderTotal: allPurchaseOrders.size,
    completedPurchaseOrders: completedPurchaseOrderSet.size,
    pendingPurchaseOrders: [...allPurchaseOrders].filter(po => !completedPurchaseOrderSet.has(po)).length,
  };
}

export function isSupersededOutputGeneration(
  generation: ShipmentOutputGeneration,
  generations: readonly ShipmentOutputGeneration[],
): boolean {
  if (generation.status === "shipment_generated") return false;
  const completedPurchaseOrders = new Set(generations
    .filter(item => item.status === "shipment_generated")
    .flatMap(item => item.purchaseOrderNumbers));
  return generation.purchaseOrderNumbers.every(po => completedPurchaseOrders.has(po));
}

export function chooseOutputGenerationId(
  generations: readonly ShipmentOutputGeneration[],
  sharedId?: string,
  sessionId?: string | null,
): string | null {
  const actionable = generations.filter(generation => !isSupersededOutputGeneration(generation, generations));
  const shared = actionable.find(generation => generation.generationId === sharedId);
  const session = actionable.find(generation => generation.generationId === sessionId);
  if (shared && shared.status !== "shipment_generated") return shared.generationId;
  if (session && session.status !== "shipment_generated") return session.generationId;
  const firstIncomplete = actionable.find(generation => generation.status !== "shipment_generated");
  if (firstIncomplete) return firstIncomplete.generationId;
  return shared?.generationId || session?.generationId || actionable.at(-1)?.generationId || null;
}
