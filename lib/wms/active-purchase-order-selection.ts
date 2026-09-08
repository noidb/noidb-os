import { projectWaveDispatchedPurchaseOrders } from "./dispatched-purchase-orders";
import type { PickingWaveStoreSnapshot } from "./picking-wave/shared-store-types";

/** Recheck the source wave immediately before generating a new operational file. */
export function assertActivePurchaseOrderSelection(snapshot: PickingWaveStoreSnapshot, waveId: string, numbers: string[]): void {
  const wave = snapshot.waves.find(candidate => candidate.id === waveId);
  if (!wave) throw new Error("작업 웨이브를 찾을 수 없습니다. 작업센터에서 다시 열어 주세요.");
  const scope = projectWaveDispatchedPurchaseOrders(snapshot, waveId);
  const requested = numbers.map(number => number.trim()).filter(Boolean);
  if (requested.some(number => !wave.sourcePurchaseOrderNumbers.includes(number))) throw new Error("선택 발주서가 현재 작업과 일치하지 않습니다. 새로고침해 주세요.");
  const completed = requested.filter(number => scope.completedPurchaseOrderNumbers.includes(number));
  if (completed.length) throw new Error(`다른 작업에서 출고완료한 발주서 ${completed.join(", ")}가 포함되어 있습니다. 새로고침하면 남은 발주서만 표시됩니다.`);
}

export async function verifyActivePurchaseOrderSelection(waveId: string, numbers: string[]): Promise<void> {
  const { readPickingWaveStore } = await import("./picking-wave/server-store");
  assertActivePurchaseOrderSelection(await readPickingWaveStore(), waveId, numbers);
}
