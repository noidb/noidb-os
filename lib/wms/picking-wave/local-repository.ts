import type { BasketAssignment, PickingWave, PickingWaveItem } from "./types";
import type { PickingWaveRepository } from "./repository";

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
}
