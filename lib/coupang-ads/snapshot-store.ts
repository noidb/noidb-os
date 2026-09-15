import type { CoupangAdsParsedSnapshot, CoupangAdsSnapshotSource } from "./types";

const DATABASE = "noidb-coupang-ads";
const STORE = "snapshots";
const VERSION = 1;

export interface StoredCoupangAdsSnapshot {
  id: string;
  groupId: string;
  startDate: string;
  endDate: string;
  downloadedAt: string;
  savedAt: string;
  expectedTotalCount: number;
  collectedCount: number;
  uniqueCount: number;
  raw: CoupangAdsSnapshotSource;
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE)) database.createObjectStore(STORE, { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("광고 snapshot 저장소를 열지 못했습니다."));
  });
}

function snapshotId(parsed: CoupangAdsParsedSnapshot): string {
  return `${parsed.groupId || "unknown"}:${parsed.startDate || "start"}:${parsed.endDate || "end"}:${parsed.downloadedAt || Date.now()}`;
}

export async function saveCoupangAdsSnapshot(parsed: CoupangAdsParsedSnapshot): Promise<StoredCoupangAdsSnapshot> {
  const record: StoredCoupangAdsSnapshot = {
    id: snapshotId(parsed),
    groupId: parsed.groupId,
    startDate: parsed.startDate,
    endDate: parsed.endDate,
    downloadedAt: parsed.downloadedAt,
    savedAt: new Date().toISOString(),
    expectedTotalCount: parsed.expectedTotalCount,
    collectedCount: parsed.collectedCount,
    uniqueCount: parsed.uniqueCount,
    raw: parsed.source,
  };
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE, "readwrite");
    transaction.objectStore(STORE).put(record);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error("광고 snapshot을 저장하지 못했습니다."));
  });
  database.close();
  return record;
}

export async function listCoupangAdsSnapshots(): Promise<StoredCoupangAdsSnapshot[]> {
  const database = await openDatabase();
  const records = await new Promise<StoredCoupangAdsSnapshot[]>((resolve, reject) => {
    const request = database.transaction(STORE, "readonly").objectStore(STORE).getAll();
    request.onsuccess = () => resolve(request.result as StoredCoupangAdsSnapshot[]);
    request.onerror = () => reject(request.error || new Error("광고 snapshot 목록을 읽지 못했습니다."));
  });
  database.close();
  return records.sort((a, b) => b.savedAt.localeCompare(a.savedAt));
}
