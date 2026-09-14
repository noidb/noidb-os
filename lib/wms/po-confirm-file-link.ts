import { createHash } from "node:crypto";
import type { PickingWaveStoreSnapshot } from "./picking-wave/shared-store-types";
import type { PoConfirmationRecord } from "./po-confirm-state";
import type { PurchaseOrderIndex } from "./purchase-order-source/types";
import { resolveConfirmedQuantityRowsForShipment, type ConfirmedQuantitySourceFile } from "./hanjin-shipment-auto";

export interface ConfirmedFileLinkCandidate {
  token: string;
  fileName: string;
  modifiedTime?: string;
  purchaseOrderCount: number;
  rowCount: number;
  totalConfirmedQuantity: number;
  quantityChanges: Array<{ poNumber: string; skuId: string; ordered: number; confirmed: number }>;
}
export interface ConfirmedFileLinkGroup {
  previousFileName: string;
  purchaseOrderNumbers: string[];
  candidates: ConfirmedFileLinkCandidate[];
}

const nameKey = (name: string) => name.trim().normalize("NFC");
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

/** Read-only recovery proposal. A candidate must contain exactly the complete original
 * confirmation batch, not just today's Shipment subset. Never guesses by date or count. */
export function inspectConfirmedFileLinks(
  snapshot: PickingWaveStoreSnapshot, waveId: string, index: PurchaseOrderIndex,
  files: readonly ConfirmedQuantitySourceFile[],
): ConfirmedFileLinkGroup[] {
  const wave = snapshot.waves.find(item => item.id === waveId);
  if (!wave) throw new Error("저장된 출고작업을 찾지 못했습니다.");
  const poSet = new Set(wave.sourcePurchaseOrderNumbers);
  const byName = new Map<string, PoConfirmationRecord[]>();
  for (const record of snapshot.poConfirmationRecords) {
    if (!poSet.has(record.poNumber) || record.waveId !== waveId || !record.generatedFileName) continue;
    const key = nameKey(record.generatedFileName);
    byName.set(key, [...(byName.get(key) || []), record]);
  }
  const groups: ConfirmedFileLinkGroup[] = [];
  for (const [previousFileName, records] of byName) {
    // Existing named files, including broken/duplicate ones, stay fail-closed in the normal path.
    if (files.some(file => nameKey(file.name) === previousFileName)) continue;
    const purchaseOrderNumbers = records.map(record => record.poNumber).sort();
    const group: ConfirmedFileLinkGroup = { previousFileName, purchaseOrderNumbers, candidates: [] };
    groups.push(group);
    if (new Set(purchaseOrderNumbers).size !== records.length) continue;
    if (records.some(record => !record.sourceFileHash || record.selectedRowCount <= 0
      || snapshot.poConfirmationRecords.filter(row => row.poNumber === record.poNumber).length !== 1)) continue;
    const documents = purchaseOrderNumbers.map(po => index.byPurchaseOrderNumber.get(po));
    if (documents.some(document => !document) || index.conflicts.some(conflict => purchaseOrderNumbers.includes(conflict.purchaseOrderNumber))) continue;
    const sourceRecords = documents.flatMap(document => document!.records);
    if (records.some(record => sourceRecords.filter(row => row.purchaseOrderNumber === record.poNumber).length !== record.selectedRowCount)) continue;
    const requests = documents.map(document => ({ purchaseOrderNumber: document!.purchaseOrderNumber, fulfillmentCenter: document!.fulfillmentCenterName, expectedDate: document!.expectedArrivalDate }));
    for (const file of files) {
      if (!file.rows?.length || !file.contentHash || files.filter(other => nameKey(other.name) === nameKey(file.name)).length !== 1) continue;
      const included = [...new Set(file.rows.map(row => row.purchaseOrderNumber.trim()))].sort();
      if (JSON.stringify(included) !== JSON.stringify(purchaseOrderNumbers)) continue;
      try {
        const resolved = resolveConfirmedQuantityRowsForShipment(requests, sourceRecords, [file], Object.fromEntries(purchaseOrderNumbers.map(po => [po, file.name])));
        group.candidates.push({
          token: digest({ records: [...records].sort((a,b) => a.poNumber.localeCompare(b.poNumber)), sourceRecords, fileName: nameKey(file.name), contentHash: file.contentHash }),
          fileName: file.name, modifiedTime: file.modifiedTime,
          purchaseOrderCount: included.length, rowCount: resolved.rows.length,
          totalConfirmedQuantity: resolved.rows.reduce((sum, row) => sum + Number(row.confirmedQuantity), 0),
          quantityChanges: file.rows.filter(row => Number(row.orderedQuantity) !== Number(row.confirmedQuantity)).map(row => ({ poNumber: row.purchaseOrderNumber, skuId: row.skuId, ordered: Number(row.orderedQuantity), confirmed: Number(row.confirmedQuantity) })),
        });
      } catch { /* Not a fully matching candidate; never partially accept it. */ }
    }
  }
  return groups;
}

/** Atomic, narrowly scoped association update. The previous complete records are retained
 * as backups. Picking, quantities, external confirmation state and Shipments are untouched. */
export function repairConfirmedFileLinks(
  current: readonly PoConfirmationRecord[], before: readonly PoConfirmationRecord[],
  fileName: string, contentHash: string, now: string,
): PoConfirmationRecord[] {
  if (!before.length || new Set(before.map(record => record.poNumber)).size !== before.length || !fileName.trim() || !/^[a-f0-9]{64}$/.test(contentHash)) throw new Error("확정파일 연결 정보가 올바르지 않습니다.");
  const byPo = new Map(before.map(record => [record.poNumber, record]));
  for (const record of before) {
    const actual = current.filter(row => row.poNumber === record.poNumber);
    if (actual.length !== 1 || JSON.stringify(actual[0]) !== JSON.stringify(record)) throw new Error("다른 기기에서 발주확정 정보가 변경되었습니다. 다시 확인해 주세요.");
  }
  return current.map(record => {
    if (!byPo.has(record.poNumber)) return record;
    const { fileLinkBackups, ...backup } = record;
    return { ...record, generatedFileName: fileName, generatedFileHash: contentHash, updatedAt: now,
      fileLinkBackups: [...(fileLinkBackups || []), { savedAt: now, record: backup }] };
  });
}
