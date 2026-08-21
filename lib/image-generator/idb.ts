import type { GeneratorSession } from "./types";

const DB_NAME = "noidb-image-generator";
const STORE = "sessions";
const VERSION = 1;

function openDb() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function saveGeneratorSession(session: GeneratorSession) {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(session, "current");
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function loadGeneratorSession(): Promise<GeneratorSession | null> {
  const db = await openDb();
  const result = await new Promise<GeneratorSession | null>((resolve, reject) => {
    const request = db.transaction(STORE, "readonly").objectStore(STORE).get("current");
    request.onsuccess = () => resolve((request.result as GeneratorSession) || null);
    request.onerror = () => reject(request.error);
  });
  db.close();
  return result;
}

export async function clearGeneratorSession() {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete("current");
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}
