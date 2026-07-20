const DB_NAME = "laura-product-drafts";
const LEGACY_DB_NAME = ["noi", "db-product-drafts"].join("");
const STORE_NAME = "drafts";
const DB_VERSION = 1;
const MAX_DRAFTS = 20;

export type ProductDraftRecord = {
  model: string;
  savedAt: number;
  data: unknown;
};

function openNamedDraftDb(name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "model" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function openDraftDb() {
  return openNamedDraftDb(DB_NAME);
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

let legacyMigration: Promise<void> | null = null;
function migrateLegacyDraftDb() {
  if (legacyMigration) return legacyMigration;
  legacyMigration = (async () => {
    const legacy = await openNamedDraftDb(LEGACY_DB_NAME);
    const legacyRows = await requestResult(legacy.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).getAll()) as ProductDraftRecord[];
    legacy.close();
    if (legacyRows.length) {
      const current = await openDraftDb();
      const existingKeys = await requestResult(current.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).getAllKeys());
      const known = new Set(existingKeys.map(String));
      const tx = current.transaction(STORE_NAME, "readwrite");
      const done = new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
      legacyRows.forEach(row => { if (!known.has(row.model)) tx.objectStore(STORE_NAME).put(row); });
      await done;
      current.close();
    }
    indexedDB.deleteDatabase(LEGACY_DB_NAME);
  })().catch(() => undefined);
  return legacyMigration;
}

export async function listProductDrafts(): Promise<ProductDraftRecord[]> {
  await migrateLegacyDraftDb();
  const db = await openDraftDb();
  const tx = db.transaction(STORE_NAME, "readonly");
  const rows = await requestResult(tx.objectStore(STORE_NAME).getAll());
  db.close();
  return (rows as ProductDraftRecord[]).sort((a, b) => b.savedAt - a.savedAt);
}

export async function saveProductDraft(record: ProductDraftRecord) {
  await migrateLegacyDraftDb();
  const db = await openDraftDb();
  const tx = db.transaction(STORE_NAME, "readwrite");
  const done = new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
  const store = tx.objectStore(STORE_NAME);
  await requestResult(store.put(record));
  const rows = (await requestResult(store.getAll()) as ProductDraftRecord[])
    .sort((a, b) => b.savedAt - a.savedAt);
  for (const old of rows.slice(MAX_DRAFTS)) {
    await requestResult(store.delete(old.model));
  }
  await done;
  db.close();
}

export async function deleteProductDraft(model: string) {
  await migrateLegacyDraftDb();
  const db = await openDraftDb();
  const tx = db.transaction(STORE_NAME, "readwrite");
  await requestResult(tx.objectStore(STORE_NAME).delete(model));
  db.close();
}
