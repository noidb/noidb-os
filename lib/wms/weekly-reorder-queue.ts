import { createHash } from "node:crypto";
import { weeklyReorderRows } from "./weekly-work-state";
import { savedWeeklyMaterial } from "./saved-weekly-material";
import { logisticsReorderLines, logisticsReorderMaterial } from "./logistics-reorder-material";
import type { WeeklyWorkspace, WeeklySnapshot } from "./weekly-work-types";
import type { WeeklyReorderRow } from "./weekly-reorder-files";

export const reorderPair = (row: Pick<WeeklyReorderRow, "purchaseOrderNumber" | "skuId">) => JSON.stringify([row.purchaseOrderNumber, row.skuId]);
export const reorderDigest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export function pendingReorderQueue(workspace: WeeklyWorkspace) {
  const requested = new Set(workspace.runs.filter(run => !logisticsReorderLines(run).length && (run.reorderRequestedAt || run.reorderQueuePartialRequestedAt)).flatMap(run => (run.reorderRequestedLines || []).map(reorderPair)));
  const rows = new Map<string, WeeklyReorderRow>();
  const sources: Array<{ id: string; revision: number; pairs: string[]; hasIssues: boolean; kind?: "logistics"; lineKey?: string; rows?: WeeklyReorderRow[] }> = [];
  const unresolved = new Map<string, { skuId: string; productName: string; purchaseOrderNumbers: string[]; message: string }>();
  const logistics = new Map<string, { rows: WeeklyReorderRow[]; sources: Array<{ id: string; revision: number; lineKey: string; row: WeeklyReorderRow }> }>();
  const completedLegacyPairs = new Set(workspace.runs.filter(run => !logisticsReorderLines(run).length && (run.reorderRequestedAt || run.reorderQueuePartialRequestedAt)).flatMap(run => (run.reorderRequestedLines || []).map(reorderPair)));
  const completedLogisticsLines = new Set(workspace.runs.flatMap(run => run.reorderRequestedShipmentLineKeys || (logisticsReorderLines(run).length === 1 && (run.reorderRequestedAt || run.reorderQueuePartialRequestedAt) ? logisticsReorderLines(run).map(line => line.lineKey) : [])));
  const seenLogisticsLines = new Set<string>(completedLogisticsLines);
  for (const run of [...workspace.runs].sort((a,b) => b.snapshot.createdAt.localeCompare(a.snapshot.createdAt) || a.id.localeCompare(b.id))) {
    if (run.reorderRequestedAt || run.completedAt) continue;
    const shipmentLines = logisticsReorderLines(run);
    if (shipmentLines.length) {
      for (const line of shipmentLines) {
        if (run.reviews[line.skuId]?.decision !== "reorder" || run.routedElsewhereSkuIds?.includes(line.skuId) || completedLogisticsLines.has(line.lineKey)) continue;
        if (seenLogisticsLines.has(line.lineKey)) {
          // Neither copy is eligible when two active tasks claim the same source.
          for (const [pair, group] of logistics) {
            const existing = group.sources.findIndex(source => source.lineKey === line.lineKey);
            if (existing >= 0) { group.sources.splice(existing, 1); group.rows.splice(existing, 1); if (!group.sources.length) logistics.delete(pair); }
          }
          unresolved.set(`duplicate:${line.lineKey}`, { skuId: line.skuId, productName: run.snapshot.vendorItems.find(item => item.skuId === line.skuId)?.productName || `SKU ${line.skuId}`,
            purchaseOrderNumbers: [line.purchaseOrderNumber], message: "같은 쉽먼트 미납 출처가 여러 업무에 연결돼 재검토가 필요합니다." });
          continue;
        }
        seenLogisticsLines.add(line.lineKey);
        try {
          const material = logisticsReorderMaterial(workspace, run, line), pair = reorderPair(material.row);
          const group = logistics.get(pair) || { rows: [], sources: [] };
          group.rows.push(material.row); group.sources.push({ id: run.id, revision: run.revision, lineKey: line.lineKey, row: material.row }); logistics.set(pair, group);
        } catch (error) {
          unresolved.set(`logistics:${line.lineKey}`, { skuId: line.skuId, productName: run.snapshot.vendorItems.find(item => item.skuId === line.skuId)?.productName || `SKU ${line.skuId}`,
            purchaseOrderNumbers: [line.purchaseOrderNumber], message: error instanceof Error ? error.message : "물류 쉽먼트 미납 출처를 확인하지 못했습니다." });
        }
      }
      continue;
    }
    const lines: WeeklyReorderRow[] = [];
    let hasIssues = false;
    for (const review of Object.values(run.reviews).filter(row=>row.decision === "reorder" && !run.routedElsewhereSkuIds?.includes(row.skuId))) {
      const item = run.snapshot.vendorItems.find(row=>row.skuId===review.skuId);
      const pos = [...new Set(item?.relatedPurchaseOrderNumbers || [])];
      if (pos.length && pos.every(po=>requested.has(reorderPair({purchaseOrderNumber:po,skuId:review.skuId})))) continue;
      const selected = { ...run, reviews: { [review.skuId]: review } };
      try {
        let selectedRows: WeeklyReorderRow[];
        try { selectedRows = weeklyReorderRows(selected); }
        catch {
          const material = savedWeeklyMaterial(workspace, review.skuId, pos);
          selectedRows = weeklyReorderRows({ ...selected, snapshot: { ...selected.snapshot, vendorItems: [material.item] } });
        }
        lines.push(...selectedRows.filter(row=>!requested.has(reorderPair(row))));
      } catch {
        hasIssues = true;
        const issue = { skuId: review.skuId, productName: item?.productName || `SKU ${review.skuId}`, purchaseOrderNumbers: pos,
          message: "저장된 자료에서 발주번호별 미납수량을 확인할 수 없어 파일에서 제외됩니다." };
        unresolved.set(JSON.stringify([review.skuId,[...pos].sort()]),issue);
      }
    }
    if (!lines.length) continue;
    sources.push({ id: run.id, revision: run.revision, pairs: lines.map(reorderPair).sort(), hasIssues });
    for (const row of lines) if (!rows.has(reorderPair(row))) rows.set(reorderPair(row), row);
  }
  const logisticsPairs = new Set(logistics.keys());
  for (const pair of logisticsPairs) {
    if (rows.has(pair) || completedLegacyPairs.has(pair)) {
      const [purchaseOrderNumber, skuId] = JSON.parse(pair) as [string, string];
      unresolved.set(`overlap:${pair}`, { skuId, productName: rows.get(pair)?.productName || logistics.get(pair)!.rows[0].productName, purchaseOrderNumbers: [purchaseOrderNumber], message: "기존 재발주 자료와 물류 쉽먼트 미납이 같은 발주·SKU입니다. 수량을 합치지 않고 재검토가 필요합니다." });
      rows.delete(pair); logistics.delete(pair);
      continue;
    }
    const group = logistics.get(pair)!;
    const first = group.rows[0];
    const quantity = group.rows.reduce((sum, row) => sum + row.shortageQuantity, 0);
    if (!Number.isSafeInteger(quantity) || quantity <= 0) {
      unresolved.set(`logistics:${group.sources.map(source => source.lineKey).join(",")}`, { skuId: first.skuId, productName: first.productName, purchaseOrderNumbers: [first.purchaseOrderNumber], message: "쉽먼트 미납수량 합계를 안전하게 계산하지 못했습니다." });
      logistics.delete(pair);
      continue;
    }
    rows.set(pair, { ...first, shortageQuantity: quantity });
    for (const source of group.sources) sources.push({ id: source.id, revision: source.revision, pairs: [pair], hasIssues: false, kind: "logistics", lineKey: source.lineKey, rows: [source.row] });
  }
  const items = [...rows.values()].sort((a,b) => reorderPair(a).localeCompare(reorderPair(b)));
  const activeSources = sources.map(source => source.kind === "logistics" ? source : { ...source, pairs: source.pairs.filter(pair => rows.has(pair)) }).filter(source => source.pairs.length);
  const discarded = new Set(workspace.runs.flatMap(run => (run.reorderDiscardedIssues || []).map(issue => JSON.stringify([issue.skuId, [...issue.purchaseOrderNumbers].sort()]))));
  const issues = [...unresolved.entries()].filter(([key, issue]) => !discarded.has(JSON.stringify([issue.skuId, [...issue.purchaseOrderNumbers].sort()]))
    && (key.startsWith("logistics:") || key.startsWith("overlap:") || key.startsWith("duplicate:") || !issue.purchaseOrderNumbers.length || !issue.purchaseOrderNumbers.every(po=>rows.has(reorderPair({purchaseOrderNumber:po,skuId:issue.skuId}))))).map(([, issue]) => issue);
  return { rows: items, sources: activeSources, issues, logisticsPairs: [...logisticsPairs].filter(pair => rows.has(pair)).sort(), token: reorderDigest([activeSources, items, issues]) };
}

/** Only selected PO+SKU pairs may enter the export; fresh unrelated candidates cannot. */
export function currentReorderRows(pending: WeeklyReorderRow[], snapshot: WeeklySnapshot): WeeklyReorderRow[] {
  if (!snapshot.operationalToken || snapshot.blockers.length) throw new Error("현재 발주·입고 원문을 확인하지 못했습니다. 자료 연결을 확인한 뒤 다시 시도해 주세요.");
  return pending.map(row => {
    const matches = snapshot.vendorItems.filter(item => item.skuId === row.skuId);
    const item = matches.length === 1 ? matches[0] : undefined;
    const details = item?.shortageDetails?.filter(detail => detail.purchaseOrderNumber === row.purchaseOrderNumber);
    const detail = details?.length === 1 ? details[0] : undefined;
    if (!detail || item?.discontinued || !Number.isSafeInteger(detail.confirmedQuantity) || !Number.isSafeInteger(detail.receivedQuantity)
      || detail.receivedQuantity < 0 || !Number.isSafeInteger(detail.shortageQuantity) || detail.shortageQuantity <= 0
      || detail.confirmedQuantity - detail.receivedQuantity !== detail.shortageQuantity) {
      throw new Error(`발주 ${row.purchaseOrderNumber} · SKU ${row.skuId}의 현재 미납수량을 확인해 주세요. 입고완료·단종 또는 원문 누락 여부 확인이 필요합니다.`);
    }
    return { ...row, productName: item!.productName, shortageQuantity: detail.shortageQuantity };
  });
}
