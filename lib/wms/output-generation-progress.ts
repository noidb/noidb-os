import type { ShipmentOutputGeneration } from "./picking-wave/types";

export interface OutputGenerationProgress {
  total: number;
  completed: number;
  pending: number;
}

export function summarizeOutputGenerations(generations: readonly ShipmentOutputGeneration[]): OutputGenerationProgress {
  let completed = 0;
  for (const generation of generations) {
    if (generation.status === "shipment_generated") completed += 1;
  }
  return { total: generations.length, completed, pending: generations.length - completed };
}

export function chooseOutputGenerationId(
  generations: readonly ShipmentOutputGeneration[],
  sharedId?: string,
  sessionId?: string | null,
): string | null {
  const shared = generations.find(generation => generation.generationId === sharedId);
  const session = generations.find(generation => generation.generationId === sessionId);
  if (shared && shared.status !== "shipment_generated") return shared.generationId;
  if (session && session.status !== "shipment_generated") return session.generationId;
  const firstIncomplete = generations.find(generation => generation.status !== "shipment_generated");
  if (firstIncomplete) return firstIncomplete.generationId;
  return shared?.generationId || session?.generationId || generations.at(-1)?.generationId || null;
}
