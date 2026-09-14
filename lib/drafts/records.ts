import type { ProductDraftRecord } from "./idb";

export type ListedProductDraft = ProductDraftRecord & { localCopy?: ProductDraftRecord };

function isLocalDraft(record: ProductDraftRecord) {
  return !(record.data as { cloudOnly?: boolean } | null)?.cloudOnly;
}

/** Keep cloud and local revisions separate so loading metadata cannot erase local images. */
export function mergeProductDrafts(...groups: ListedProductDraft[][]): ListedProductDraft[] {
  const records = new Map<string, ProductDraftRecord>();
  const localCopies = new Map<string, ProductDraftRecord>();
  const consider = (record: ListedProductDraft) => {
    if (!record?.model || !Number.isFinite(record.savedAt)) return;
    // A previously merged result may carry a backup; never nest backups in a record.
    const plain = record.localCopy ? { model: record.model, savedAt: record.savedAt, data: record.data } : record;
    const local = isLocalDraft(record);
    const previous = records.get(record.model);
    if (!previous || record.savedAt > previous.savedAt || (record.savedAt === previous.savedAt && local)) {
      records.set(record.model, plain);
    }
    const previousLocal = localCopies.get(record.model);
    if (local && (!previousLocal || record.savedAt >= previousLocal.savedAt)) localCopies.set(record.model, plain);
  };
  for (const group of groups) for (const record of group) {
    consider(record);
    const backup = record?.localCopy;
    if (backup && backup.model === record.model && isLocalDraft(backup)) consider(backup);
  }
  return [...records.values()]
    .sort((a, b) => b.savedAt - a.savedAt)
    .slice(0, 20)
    .map(record => {
      const localCopy = localCopies.get(record.model);
      return !isLocalDraft(record) && localCopy ? { ...record, localCopy } : record;
    });
}

export async function readDraftResponse(response: Response): Promise<Record<string, any>> {
  const data = await response.json();
  if (!response.ok || data.error || data.ok === false || data.configured === false) {
    throw new Error(data.error || "다른 기기 동기화에 연결하지 못했습니다.");
  }
  return data;
}
