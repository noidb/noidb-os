import type { BasketAssignment, PickingWave, PickingWaveItem } from "./types";
import type { PickingWaveRepository } from "./repository";
import {
  PO_CONFIRMATION_STORAGE_KEY,
  parsePoConfirmationRecords,
  removeTransientPoConfirmationRecordsForWave,
  serializePoConfirmationRecords,
} from "../po-confirm-state";

/**
 * localStorage 기반 임시 저장소. lib/warehouse/local-repository.ts와 동일한 패턴이다.
 * 키는 전부 noidb_picking_wave_ 접두어를 써서 다른 기능(창고 위치, 샘플 피킹 등)의 저장 공간과
 * 겹치지 않게 한다.
 */

const KEYS = {
  waves: "noidb_picking_wave_waves",
  items: "noidb_picking_wave_items",
  baskets: "noidb_picking_wave_baskets",
} as const;

function isBrowser(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function readList<T>(key: string): T[] {
  if (!isBrowser()) return [];
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

function writeList<T>(key: string, list: T[]): void {
  if (!isBrowser()) return;
  window.localStorage.setItem(key, JSON.stringify(list));
}

function isObjectWithStringFields(value: unknown, fields: readonly string[]): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return fields.every(field => typeof candidate[field] === "string" && String(candidate[field]).trim().length > 0);
}

/**
 * 조회 화면은 과거처럼 손상값을 빈 목록으로 처리하지만, 삭제는 같은 방식으로 진행하면 손상된 전체
 * 저장값을 []로 덮어쓸 수 있다. 따라서 파괴 작업에서만 엄격히 읽고 하나라도 이상하면 쓰기 전에
 * 중단한다.
 */
function readListStrict<T>(raw: string | null, key: string, validate: (value: unknown) => boolean): T[] {
  if (raw === null) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`${key} 저장값이 손상되어 웨이브 삭제를 중단했습니다.`);
  }
  if (!Array.isArray(parsed) || !parsed.every(validate)) {
    throw new Error(`${key} 저장값의 형식이 올바르지 않아 웨이브 삭제를 중단했습니다.`);
  }
  return parsed as T[];
}

function restoreStorageSnapshot(entries: readonly (readonly [string, string | null])[]): string[] {
  const failures: string[] = [];
  for (const [key, raw] of entries) {
    try {
      if (raw === null) window.localStorage.removeItem(key);
      else window.localStorage.setItem(key, raw);
    } catch {
      failures.push(key);
    }
  }
  return failures;
}

export class LocalPickingWaveRepository implements PickingWaveRepository {
  async listWaves(): Promise<PickingWave[]> {
    return readList<PickingWave>(KEYS.waves).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async getWave(waveId: string): Promise<PickingWave | null> {
    const list = readList<PickingWave>(KEYS.waves);
    return list.find(wave => wave.id === waveId) || null;
  }

  async saveWave(wave: PickingWave): Promise<void> {
    const list = readList<PickingWave>(KEYS.waves);
    const index = list.findIndex(item => item.id === wave.id);
    if (index >= 0) list[index] = wave;
    else list.push(wave);
    writeList(KEYS.waves, list);
  }

  async deleteWave(waveId: string): Promise<void> {
    if (!isBrowser()) return;
    const targetWaveId = waveId.trim();
    if (!targetWaveId) throw new Error("삭제할 웨이브 ID가 없습니다.");

    const snapshots = [
      [KEYS.waves, window.localStorage.getItem(KEYS.waves)],
      [KEYS.items, window.localStorage.getItem(KEYS.items)],
      [KEYS.baskets, window.localStorage.getItem(KEYS.baskets)],
      [PO_CONFIRMATION_STORAGE_KEY, window.localStorage.getItem(PO_CONFIRMATION_STORAGE_KEY)],
    ] as const;

    // 모든 키를 먼저 검증한다. 이 단계가 끝나기 전에는 localStorage에 아무 것도 쓰지 않는다.
    const waves = readListStrict<PickingWave>(snapshots[0][1], KEYS.waves, value => isObjectWithStringFields(value, ["id"]));
    const items = readListStrict<PickingWaveItem>(snapshots[1][1], KEYS.items, value => isObjectWithStringFields(value, ["id", "waveId"]));
    const baskets = readListStrict<BasketAssignment>(snapshots[2][1], KEYS.baskets, value => isObjectWithStringFields(value, ["waveId", "basketNumber"]));
    const confirmationRecords = parsePoConfirmationRecords(snapshots[3][1]);

    const nextValues = [
      [KEYS.waves, JSON.stringify(waves.filter(wave => wave.id !== targetWaveId))],
      [KEYS.items, JSON.stringify(items.filter(item => item.waveId !== targetWaveId))],
      [KEYS.baskets, JSON.stringify(baskets.filter(basket => basket.waveId !== targetWaveId))],
      [
        PO_CONFIRMATION_STORAGE_KEY,
        serializePoConfirmationRecords(removeTransientPoConfirmationRecordsForWave(confirmationRecords, targetWaveId)),
      ],
    ] as const;

    try {
      for (const [key, value] of nextValues) window.localStorage.setItem(key, value);
    } catch (error) {
      const rollbackFailures = restoreStorageSnapshot(snapshots);
      if (rollbackFailures.length > 0) {
        throw new Error(
          `웨이브 삭제 중 오류가 발생했고 저장값 복원에도 실패했습니다(${rollbackFailures.join(", ")}). 브라우저 저장공간을 확인해주세요.`
        );
      }
      throw new Error(
        `웨이브 삭제에 실패해 원래 상태로 복원했습니다: ${error instanceof Error ? error.message : "알 수 없는 저장 오류"}`
      );
    }
  }

  async listItems(waveId: string): Promise<PickingWaveItem[]> {
    return readList<PickingWaveItem>(KEYS.items).filter(item => item.waveId === waveId);
  }

  async saveItem(item: PickingWaveItem): Promise<void> {
    const list = readList<PickingWaveItem>(KEYS.items);
    const index = list.findIndex(existing => existing.id === item.id);
    if (index >= 0) list[index] = item;
    else list.push(item);
    writeList(KEYS.items, list);
  }

  async deleteItem(itemId: string): Promise<void> {
    writeList(KEYS.items, readList<PickingWaveItem>(KEYS.items).filter(item => item.id !== itemId));
  }

  async listBaskets(waveId: string): Promise<BasketAssignment[]> {
    return readList<BasketAssignment>(KEYS.baskets).filter(basket => basket.waveId === waveId);
  }

  async saveBasket(basket: BasketAssignment): Promise<void> {
    const list = readList<BasketAssignment>(KEYS.baskets);
    const index = list.findIndex(
      existing => existing.waveId === basket.waveId && existing.basketNumber === basket.basketNumber
    );
    if (index >= 0) list[index] = basket;
    else list.push(basket);
    writeList(KEYS.baskets, list);
  }

  async deleteBasket(waveId: string, basketNumber: string): Promise<void> {
    writeList(
      KEYS.baskets,
      readList<BasketAssignment>(KEYS.baskets).filter(basket => !(basket.waveId === waveId && basket.basketNumber === basketNumber))
    );
  }
}
