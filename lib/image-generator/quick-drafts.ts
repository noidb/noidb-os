import type { QuickDetailSection, QuickDetailStyle } from "./quick-detail";

export type QuickDraftResult = {
  dataUrl: string;
  sectionCount: number;
  width: number;
  height: number;
};

export type QuickDetailDraft = {
  id: string;
  savedAt: string;
  modelName: string;
  source: string;
  sourceName: string;
  headerUrl: string;
  headerName: string;
  footerUrl: string;
  footerName: string;
  style: QuickDetailStyle;
  originalSections: QuickDetailSection[];
  editedSections: QuickDetailSection[];
  finalSections: QuickDetailSection[];
  sectionActions: Record<string, "edit" | "original">;
  result: QuickDraftResult | null;
  scanSummary: { found: number; kept: number; excluded: number } | null;
  preview: string;
};

const DB_NAME = "noidb-quick-detail-drafts";
const STORE_NAME = "drafts";
const DB_VERSION = 1;
export const MAX_QUICK_DRAFTS = 10;

function openDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME, { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("임시저장 공간을 열지 못했습니다."));
  });
}

function waitForTransaction(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error("임시저장 중 문제가 생겼습니다."));
    transaction.onabort = () => reject(transaction.error || new Error("임시저장이 중단되었습니다."));
  });
}

export async function listQuickDrafts() {
  const db = await openDatabase();
  try {
    const transaction = db.transaction(STORE_NAME, "readonly");
    const request = transaction.objectStore(STORE_NAME).getAll();
    const drafts = await new Promise<QuickDetailDraft[]>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result as QuickDetailDraft[]);
      request.onerror = () => reject(request.error || new Error("임시저장 목록을 읽지 못했습니다."));
    });
    return drafts.sort((a, b) => b.savedAt.localeCompare(a.savedAt));
  } finally {
    db.close();
  }
}

export async function deleteQuickDraft(id: string) {
  const db = await openDatabase();
  try {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).delete(id);
    await waitForTransaction(transaction);
  } finally {
    db.close();
  }
}

export async function saveQuickDraft(draft: QuickDetailDraft) {
  const db = await openDatabase();
  try {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).put(draft);
    await waitForTransaction(transaction);
  } finally {
    db.close();
  }
  const drafts = await listQuickDrafts();
  await Promise.all(drafts.slice(MAX_QUICK_DRAFTS).map(item => deleteQuickDraft(item.id)));
  return listQuickDrafts();
}
