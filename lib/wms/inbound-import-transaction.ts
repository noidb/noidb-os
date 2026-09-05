import { buildInboundEventFingerprint } from "./inbound-import-safety";
import type { InboundImportContext } from "./inbound-import-context";

export class InboundCommitUncertainError extends Error {}
export interface InboundTransactionStore {
  hasReceipt(token: string): Promise<boolean>;
  acquire(): Promise<number>;
  release(lockId: number): Promise<void>;
  commit(context: InboundImportContext, lockId: number): Promise<void>;
  verify(context: InboundImportContext): Promise<void>;
}

/** All inbound writers use the same exclusive lock. Never expire an uncertain write's lock. */
export async function applyInboundTransaction(expectedToken: string, loadFresh: () => Promise<InboundImportContext>, store: InboundTransactionStore) {
  if (!/^[a-f0-9]{64}$/.test(expectedToken)) throw new Error("변경 내용을 먼저 확인해 주세요.");
  if (await store.hasReceipt(expectedToken)) return { applied: true, alreadyApplied: true };
  const lockId = await store.acquire();
  let needsRelease = true;
  try {
    // A previous call may have committed between receipt inspection and lock acquisition.
    if (await store.hasReceipt(expectedToken)) {
      needsRelease = false;
      await store.release(lockId);
      return { applied: true, alreadyApplied: true };
    }
    const fresh = await loadFresh();
    if (fresh.token !== expectedToken) throw new Error("확인 후 파일 또는 입고·발주·제품DB가 변경되었습니다. 새 입고파일 확인을 다시 눌러 주세요.");
    if (fresh.cellPreview.blockers.length) throw new Error("확인이 필요한 셀이 있습니다. 변경 내용을 다시 확인해 주세요.");
    if (!fresh.incoming.length) throw new Error("새로 반영할 입고가 없습니다.");
    needsRelease = false;
    await store.commit(fresh, lockId);
    await store.verify(fresh);
    return { applied: true, alreadyApplied: false, importedEvents: fresh.incoming.length, changedCells: fresh.cellPreview.changes.length };
  } catch (error) {
    // Once a commit is sent, retain the lock on an uncertain network/server response.
    // A successful atomic commit deletes it itself and creates its receipt.
    if (needsRelease) await store.release(lockId);
    throw error;
  }
}

export function inboundHistoryAppendRows(context: InboundImportContext, now: string) {
  return context.incoming.map(item => [buildInboundEventFingerprint(item), item.po, item.expectedDate, item.sku, item.name,
    item.totalInbound, item.outbound, item.netInbound, item.lastDate, item.previousSupplyDate, item.previousSupplyPrice,
    item.latestSupplyDate, item.latestSupplyPrice, now]);
}
