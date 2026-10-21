/**
 * 화면을 열자마자 마지막으로 본 목록을 보여 주기 위한 이 브라우저 저장소(2026-10-21).
 * 자료가 커서 localStorage 대신 IndexedDB에 둔다. 못 쓰는 환경이면 조용히 건너뛴다(화면은 서버 자료로 그대로 뜸).
 */
const DB_NAME = "noidb-last-view";
const STORE = "views";

function open(): Promise<IDBDatabase | null> {
  return new Promise(resolve => {
    try {
      if (typeof indexedDB === "undefined") { resolve(null); return; }
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => { request.result.createObjectStore(STORE); };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
    } catch { resolve(null); }
  });
}

export async function readLastView<T>(key: string): Promise<{ savedAt: string; data: T } | null> {
  const db = await open();
  if (!db) return null;
  return new Promise(resolve => {
    try {
      const request = db.transaction(STORE, "readonly").objectStore(STORE).get(key);
      request.onsuccess = () => resolve((request.result as { savedAt: string; data: T } | undefined) || null);
      request.onerror = () => resolve(null);
    } catch { resolve(null); }
  });
}

export async function saveLastView(key: string, data: unknown): Promise<void> {
  const db = await open();
  if (!db) return;
  await new Promise<void>(resolve => {
    try {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put({ savedAt: new Date().toISOString(), data }, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch { resolve(); }
  });
}
