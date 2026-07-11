const DB_NAME = "noidb-product-db";
const DB_VERSION = 1;
const STORE = "handles";
const ROOT_KEY = "product-db-root";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error("IndexedDB 열기 실패"));
  });
}

export async function saveDirectoryHandle(handle: FileSystemDirectoryHandle) {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(handle, ROOT_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error("핸들 저장 실패"));
  });
  db.close();
}

export async function loadDirectoryHandle(): Promise<FileSystemDirectoryHandle | null> {
  const db = await openDb();
  const handle = await new Promise<FileSystemDirectoryHandle | null>((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).get(ROOT_KEY);
    req.onsuccess = () => resolve((req.result as FileSystemDirectoryHandle) || null);
    req.onerror = () => reject(req.error || new Error("핸들 불러오기 실패"));
  });
  db.close();
  return handle;
}

export async function ensureReadWritePermission(
  handle: FileSystemDirectoryHandle
): Promise<boolean> {
  const opts = { mode: "readwrite" as const };
  if ((await handle.queryPermission(opts)) === "granted") return true;
  if ((await handle.requestPermission(opts)) === "granted") return true;
  return false;
}

export function supportsDirectoryPicker() {
  return typeof window !== "undefined" && "showDirectoryPicker" in window;
}
