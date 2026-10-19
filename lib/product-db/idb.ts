const DB_NAME = "laura-product-db";
const LEGACY_DB_NAME = ["noi", "db-product-db"].join("");
const DB_VERSION = 1;
const STORE = "handles";
const ROOT_KEY = "product-db-root";

function openNamedDb(name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(name, DB_VERSION);
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

function openDb() {
  return openNamedDb(DB_NAME);
}

let legacyMigration: Promise<void> | null = null;
function migrateLegacyHandle() {
  if (legacyMigration) return legacyMigration;
  legacyMigration = (async () => {
    const current = await openDb();
    const currentHandle = await new Promise<FileSystemDirectoryHandle | null>((resolve, reject) => {
      const req = current.transaction(STORE, "readonly").objectStore(STORE).get(ROOT_KEY);
      req.onsuccess = () => resolve((req.result as FileSystemDirectoryHandle) || null);
      req.onerror = () => reject(req.error);
    });
    if (!currentHandle) {
      const legacy = await openNamedDb(LEGACY_DB_NAME);
      const legacyHandle = await new Promise<FileSystemDirectoryHandle | null>((resolve, reject) => {
        const req = legacy.transaction(STORE, "readonly").objectStore(STORE).get(ROOT_KEY);
        req.onsuccess = () => resolve((req.result as FileSystemDirectoryHandle) || null);
        req.onerror = () => reject(req.error);
      });
      legacy.close();
      if (legacyHandle) {
        await new Promise<void>((resolve, reject) => {
          const tx = current.transaction(STORE, "readwrite");
          tx.objectStore(STORE).put(legacyHandle, ROOT_KEY);
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        });
      }
    }
    current.close();
    indexedDB.deleteDatabase(LEGACY_DB_NAME);
  })().catch(() => undefined);
  return legacyMigration;
}

export async function saveDirectoryHandle(handle: FileSystemDirectoryHandle) {
  await migrateLegacyHandle();
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
  await migrateLegacyHandle();
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

// 상품이미지DB 폴더와 따로 기억하는 폴더(예: 8번 썸네일·라벨을 넣는 "상품수정" 폴더).
const EDIT_FOLDER_KEY = "product-edit-folder";

export async function saveEditFolderHandle(handle: FileSystemDirectoryHandle) {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(handle, EDIT_FOLDER_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error("핸들 저장 실패"));
  });
  db.close();
}

export async function loadEditFolderHandle(): Promise<FileSystemDirectoryHandle | null> {
  const db = await openDb();
  const handle = await new Promise<FileSystemDirectoryHandle | null>((resolve, reject) => {
    const req = db.transaction(STORE, "readonly").objectStore(STORE).get(EDIT_FOLDER_KEY);
    req.onsuccess = () => resolve((req.result as FileSystemDirectoryHandle) || null);
    req.onerror = () => reject(req.error || new Error("핸들 불러오기 실패"));
  });
  db.close();
  return handle;
}
