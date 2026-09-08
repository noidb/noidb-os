import { inspectShipmentPdf } from "../lib/wms/shipment-print-client";
import { buildPackingCenterTargets } from "../lib/wms/packing-center-targets";

const baseUrl = "https://noidb-os.vercel.app";
const waveId = "WAVE-20260902-926d76fa";

function decodePdf(source: { name: string; base64: string }) {
  return new File([Buffer.from(source.base64, "base64")], source.name, { type: "application/pdf" });
}

async function main() {
  const response = await fetch(`${baseUrl}/api/wms/picking-waves`);
  const body = await response.json();
  if (!response.ok || !body.ok) throw new Error(body.error || "Production snapshot failed");
  const snapshot = body.snapshot;
  const wave = snapshot.waves.find((entry: { id: string }) => entry.id === waveId);
  if (!wave) throw new Error("Wave not found");
  const items = snapshot.items.filter((item: { waveId: string }) => item.waveId === waveId);
  const dispatched = new Set<string>(snapshot.packingProgress?.[waveId]?.dispatchedShipmentNumbers || []);
  const generations = (wave.outputGenerations || []).filter((generation: { supersededByGenerationId?: string; status: string; shipmentFileName?: string }) => !generation.supersededByGenerationId && generation.status === "shipment_generated" && generation.shipmentFileName);
  const results = [];

  for (const generation of generations) {
    try {
      const expected = new Set<string>(generation.purchaseOrderNumbers.map(String));
      const dateTokens = [...new Set<string>(items.flatMap((item: { sources: { purchaseOrderNumber: string; shippingGroupKey?: string }[] }) => item.sources)
        .filter((source: { purchaseOrderNumber: string }) => expected.has(String(source.purchaseOrderNumber)))
        .map((source: { shippingGroupKey?: string }) => String(source.shippingGroupKey || "").split("\u0000")[0].replace(/\D/g, ""))
        .filter((value: string) => /^20\d{6}$/.test(value)))];
      const sourceResponse = await fetch(`${baseUrl}/api/wms/shipment-print/auto-source`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ waveId, dateTokens, expectedPurchaseOrderNumbers: [...expected], expectedWorkbookName: generation.shipmentFileName }),
      });
      const source = await sourceResponse.json();
      if (!sourceResponse.ok || source.error) throw new Error(source.error || `HTTP ${sourceResponse.status}`);
      const labels = await Promise.all((source.labels as { name: string; base64: string }[]).map((entry) => inspectShipmentPdf(decodePdf(entry), "label")));
      const relevant = labels.filter((label) => label.purchaseOrderNumbers.some((po) => expected.has(po)));
      const matchedPurchaseOrders = new Set(relevant.flatMap((label) => label.purchaseOrderNumbers).filter((po) => expected.has(po)));
      const shipmentNumbers = [...new Set(relevant.map((label) => label.shipmentNumber))];
      results.push({
        generationId: generation.generationId,
        purchaseOrders: [...expected],
        centers: [...new Set(relevant.map((label) => label.fulfillmentCenter))],
        expectedDates: [...new Set(relevant.map((label) => label.expectedDate))],
        shipmentNumbers,
        poComplete: matchedPurchaseOrders.size === expected.size && [...expected].every((po) => matchedPurchaseOrders.has(po)),
        complete: shipmentNumbers.length > 0 && shipmentNumbers.every((number) => dispatched.has(number)),
      });
    } catch (error) {
      results.push({ generationId: generation.generationId, error: error instanceof Error ? error.message : String(error) });
    }
  }

  const shipmentNumbersByGeneration = Object.fromEntries(results
    .filter((result): result is typeof result & { generationId: string; shipmentNumbers: string[] } => "shipmentNumbers" in result)
    .map(result => [result.generationId, result.shipmentNumbers]));
  const targets = buildPackingCenterTargets(generations, wave.shippingGroups || [], shipmentNumbersByGeneration, dispatched);
  console.log(JSON.stringify({
    revision: snapshot.revision,
    dispatched: [...dispatched],
    results,
    hiddenCompletedTargets: targets.filter(target => target.complete).map(target => target.label),
    visiblePendingTargets: targets.filter(target => !target.complete).map(target => target.label),
  }, null, 2));
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
