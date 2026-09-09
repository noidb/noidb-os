import { createHash } from "node:crypto";
import { buildWeeklySnapshot, validateWeeklyPeriod, weeklyOperationalToken } from "./weekly-work-analysis";
import { readInboundWorkbook } from "./inbound-import-context";
import { parseInboundSourceRows, type InboundImportDataset } from "./inbound-import-safety";
import { downloadOAuthDriveFile, listOAuthDriveFolderFiles, resolveDriveFolderPath } from "./google-drive-oauth-reader";
import { fetchSheetRows } from "./google-sheets";
import { fetchProductCatalog } from "./product-catalog";
import { readPickingWaveStore } from "./picking-wave/server-store";
import { emptyPickingWaveStoreSnapshot } from "./picking-wave/shared-store-types";
import { createParsedFileCache } from "./parsed-file-cache";
import { readWeeklyWorkspace } from "./weekly-work-store";
import { mergeWeeklyPurchaseRows, readWeeklyPurchaseFiles, readWeeklyPurchaseManifest, weeklyOperationsWithPurchaseFiles } from "./weekly-purchase-source";
import type { WeeklyBrowserSource, WeeklyPeriod, WeeklySnapshot, WeeklyWorkspace } from "./weekly-work-types";

// A performance-only memory cache: analysis never writes a Sheet, Drive file, or Blob.
const cached = createParsedFileCache({ read: async () => null, write: async () => undefined });
const validDataset = (value: unknown): value is InboundImportDataset => Boolean(value && typeof value === "object"
  && typeof (value as InboundImportDataset).fingerprint === "string" && Array.isArray((value as InboundImportDataset).items));
const clean = (value: unknown) => String(value ?? "").replace(/\s+/g, " ").trim();

/** Retry temporary read outages; missing/ambiguous business data still fails closed. */
export async function retryWeeklySourceRead<T>(read: () => Promise<T>, pause: (ms: number) => Promise<void> = ms => new Promise(resolve => setTimeout(resolve, ms))): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try { return await read(); }
    catch (error) {
      if (attempt >= 2 || !/service is currently unavailable|temporarily unavailable|HTTP 50[0234]|HTTP 429|rate.?limit|fetch failed|ECONNRESET|ETIMEDOUT/i.test(String(error))) throw error;
      await pause(300 * (attempt + 1));
    }
  }
}

/** The browser transfer must cover every row of precisely the requested period. */
export function parseWeeklyBrowserSource(source: WeeklyBrowserSource, period: WeeklyPeriod): InboundImportDataset {
  validateWeeklyPeriod(period);
  if (source.coverageComplete !== true || source.startDate !== period.startDate || source.endDate !== period.endDate
    || !Number.isSafeInteger(source.totalCount) || source.totalCount < 0 || source.rows.length !== source.totalCount
    || !source.transferId?.trim() || !Number.isFinite(Date.parse(source.collectedAt))) {
    throw new Error("서플라이 허브의 선택 기간 전체 행을 확인한 뒤 다시 연결해 주세요.");
  }
  const canonical = (header: string) => {
    const value = clean(header).replace(/\s/g, "");
    if (["입고/반출일자", "입고/반출시각", "입고/반출일시", "입고일", "입고일시"].includes(value)) return "입고/반출시각";
    if (["발주번호", "발주서번호", "번호"].includes(value)) return "발주번호";
    if (["SKUID", "SKU번호", "SKU"].includes(value)) return "SKU ID";
    if (["SKU명", "SKU이름", "상품명"].includes(value)) return "SKU명";
    if (["수량", "입고수량"].includes(value)) return "수량";
    if (["입고예정일", "입고예정일시"].includes(value)) return "입고예정일";
    return clean(header);
  };
  const headers = source.headers.map(canonical);
  const required = ["발주번호", "SKU ID", "구분", "입고/반출시각", "수량"];
  if (required.some(header => headers.filter(value => value === header).length !== 1)) throw new Error("서플라이 허브 입고상세내역의 날짜·발주번호·SKU·구분·수량 열을 확인해 주세요.");
  if (source.rows.some(row => row.length !== headers.length)) throw new Error("서플라이 허브 입고상세내역의 열 수가 일치하지 않습니다.");
  const rows = source.rows.map(row => Object.fromEntries(headers.map((header, index) => [header, clean(row[index])])));
  const sourceFile = `서플라이허브_입고상세내역_${source.startDate}_${source.endDate}_${source.transferId}`;
  const items = rows.length ? parseInboundSourceRows(rows, sourceFile) : [];
  if (items.some(item => item.actualDate < period.startDate || item.actualDate > period.endDate)) throw new Error("브라우저 자료에 선택 기간 밖 입고가 포함되어 있습니다. 검색 기간을 다시 확인해 주세요.");
  return { sourceFile, items, fingerprint: createHash("sha256").update(JSON.stringify(source)).digest("hex") };
}

async function readDriveDatasets(): Promise<InboundImportDataset[]> {
  const folder = await resolveDriveFolderPath(["쿠팡데이터", "입고상세내역 다운로드"]);
  const files = (await listOAuthDriveFolderFiles(folder)).filter(file => /\.xlsx$/i.test(file.name)).sort((a, b) => a.id.localeCompare(b.id));
  const results: InboundImportDataset[] = [];
  for (const file of files) {
    results.push(await cached("weekly-inbound-event-v1", [file.id, file.name, file.modifiedTime, file.size], async () => {
      const value = await readInboundWorkbook(await downloadOAuthDriveFile(file.id), file.name);
      return { value, contentHash: value.fingerprint, purchaseOrders: [...new Set(value.items.map(item => item.po))], actualDates: [...new Set(value.items.map(item => item.actualDate))] };
    }, validDataset));
  }
  return results;
}

export async function readWeeklyOperationalToken(): Promise<string> {
  const [historyRows, purchaseRows, catalog, pickingStore, manifest] = await Promise.all([
    retryWeeklySourceRead(() => fetchSheetRows("_입고요약")), retryWeeklySourceRead(() => fetchSheetRows("_발주이력")), retryWeeklySourceRead(fetchProductCatalog), readPickingWaveStore(), readWeeklyPurchaseManifest(),
  ]);
  if (!catalog.configured) throw new Error("제품DB 연결을 확인한 뒤 다시 분석해 주세요.");
  return weeklyOperationsWithPurchaseFiles(weeklyOperationalToken({ historyRows, purchaseRows, catalogItems: catalog.items, pickingStore }), manifest.token);
}

/** Carry candidates only from explicitly open work. buildWeeklySnapshot must
 * recheck positive receipt evidence; an old review is not proof of actual receipt. */
export function weeklyCarryPurchaseOrders(workspace: WeeklyWorkspace): string[] {
  const purchaseOrders = new Set<string>();
  const resolvedPairs = new Set<string>();
  const requestedPairs = new Set(workspace.runs.filter(run => run.reorderRequestedAt).flatMap(run => (run.reorderRequestedLines || []).map(line => JSON.stringify([line.purchaseOrderNumber, line.skuId]))));
  const timestamp = (value: string) => Number.isFinite(Date.parse(value)) ? Date.parse(value) : 0;
  // Snapshot creation orders analyses. Updating an old run's coupon status must not
  // revive its stale hold after a newer analysis has recorded the order as sent.
  const runs = [...workspace.runs].sort((a, b) => timestamp(b.snapshot.createdAt) - timestamp(a.snapshot.createdAt)
    || timestamp(b.updatedAt) - timestamp(a.updatedAt) || a.id.localeCompare(b.id));
  for (const run of runs) for (const review of Object.values(run.reviews)) {
    const item = run.snapshot.vendorItems.find(item => item.skuId === review.skuId);
    for (const rawPo of item?.relatedPurchaseOrderNumbers || []) {
      const po = rawPo.trim(), pair = JSON.stringify([po, review.skuId]);
      if (!po || resolvedPairs.has(pair) || requestedPairs.has(pair)) continue;
      resolvedPairs.add(pair);
      if (review.decision === "discontinue" || workspace.productOverrides[review.skuId]?.discontinued || item?.discontinued) continue;
      if (review.decision === "hold" || (review.decision === "reorder" && !run.reorderRequestedAt) || (review.decision === "order" && !run.sentVendors[review.vendorName])) purchaseOrders.add(po);
    }
  }
  return [...purchaseOrders].sort();
}

export function mergeWeeklySourceDatasets(drive: InboundImportDataset[], primary: InboundImportDataset[], authoritativePeriod?: WeeklyPeriod): InboundImportDataset[] {
  const historical = authoritativePeriod ? drive.map(dataset => ({ ...dataset,
    items: dataset.items.filter(item => item.actualDate < authoritativePeriod.startDate || item.actualDate > authoritativePeriod.endDate),
  })) : drive;
  return [...historical, ...primary];
}

export async function loadWeeklySnapshot(period: WeeklyPeriod, options?: { browserSource?: WeeklyBrowserSource; uploadedDatasets?: InboundImportDataset[] }): Promise<WeeklySnapshot> {
  validateWeeklyPeriod(period);
  const primary = options?.browserSource ? [parseWeeklyBrowserSource(options.browserSource, period)] : options?.uploadedDatasets || [];
  const [drive, history, purchases, catalog, picking, workspace, manifest] = await Promise.allSettled([
    readDriveDatasets(), retryWeeklySourceRead(() => fetchSheetRows("_입고요약")), retryWeeklySourceRead(() => fetchSheetRows("_발주이력")), retryWeeklySourceRead(fetchProductCatalog), readPickingWaveStore(), readWeeklyWorkspace(), readWeeklyPurchaseManifest(),
  ]);
  if (drive.status === "rejected" && !primary.length) throw new Error("입고상세내역 파일을 읽지 못했습니다. Drive 연결을 확인하거나 서플라이 허브 자료를 연결해 주세요.");
  const datasets = mergeWeeklySourceDatasets(drive.status === "fulfilled" ? drive.value : [], primary, options?.browserSource ? period : undefined);
  if (!datasets.length) throw new Error("분석할 입고상세내역이 없습니다. 서플라이 허브 자료를 연결하거나 입고상세내역 파일을 추가해 주세요.");
  const historyRows = history.status === "fulfilled" ? history.value : [];
  const purchaseRows = purchases.status === "fulfilled" ? purchases.value : [];
  const catalogItems = catalog.status === "fulfilled" ? catalog.value.items : [];
  const pickingStore = picking.status === "fulfilled" ? picking.value : emptyPickingWaveStoreSnapshot();
  // Prior work stays in its processing screen, outside new receipt analysis.
  const carryPurchaseOrders: string[] = [];
  const targetPos = [...new Set([...datasets.flatMap(dataset => dataset.items.filter(item => item.kind === "inbound" && item.totalInbound > 0
    && item.actualDate >= period.startDate && item.actualDate <= period.endDate).map(item => item.po)), ...carryPurchaseOrders])].sort();
  let mergedPurchaseRows = purchaseRows;
  let purchaseFileFailure = manifest.status === "rejected";
  let purchaseFileIssue = "발주서 원문 연결을 확인할 수 없습니다.";
  let purchaseFileWarnings: string[] = [];
  let purchaseFiles: string[] = [];
  let supplementedPurchaseRows = 0;
  if (manifest.status === "fulfilled") {
    try {
      const source = await readWeeklyPurchaseFiles(manifest.value, targetPos);
      const merged = mergeWeeklyPurchaseRows(purchaseRows, source);
      mergedPurchaseRows = merged.rows;
      supplementedPurchaseRows = merged.addedCount;
      purchaseFiles = [...new Set(source.sourceFiles.map(file => file.name))].sort();
      purchaseFileWarnings = [...new Set(source.errors.map(error => `발주 ${error.purchaseOrderNumber || "확인 필요"}: ${error.message} (${error.sourceFile})`))].sort();
    } catch (error) {
      purchaseFileFailure = true;
      purchaseFileIssue = error instanceof Error ? error.message : "발주서 원문 연결을 확인할 수 없습니다.";
    }
  }
  const snapshot = buildWeeklySnapshot({ period, datasets, historyRows,
    purchaseRows: mergedPurchaseRows, catalogItems, pickingStore,
    carryPurchaseOrders,
    mode: options?.browserSource ? "browser" : options?.uploadedDatasets?.length ? "upload" : "drive" });
  const issues: string[] = [];
  if (purchaseFileFailure) issues.push(manifest.status === "rejected" ? "업로드된 발주서 원문을 읽지 못해 미납 대상을 표시하지 않았습니다. Drive 연결을 확인한 뒤 다시 분석해 주세요." : purchaseFileIssue);
  if (drive.status === "rejected") issues.push("보관된 Drive 원문을 대조하지 못했습니다. 이전 입고와 추가 발주 수량을 확인해 주세요.");
  if (history.status === "rejected") issues.push("누적 입고이력을 읽지 못했습니다. 거래처 발주 수량 확인이 필요합니다.");
  if (purchases.status === "rejected") issues.push("발주이력을 읽지 못해 미입고 대상을 확인할 수 없습니다.");
  if (catalog.status === "rejected" || (catalog.status === "fulfilled" && !catalog.value.configured)) issues.push("제품DB를 읽지 못해 거래처·이미지·단종 상태 확인이 필요합니다.");
  if (picking.status === "rejected") issues.push("기존 거래처 발주·배송 상태를 읽지 못했습니다. 중복 발주를 확인해 주세요.");
  if (workspace.status === "rejected") issues.push("지난 주간 업무를 읽지 못해 보류·미발송 발주를 확인하지 못했습니다. 최신 업무 이력을 확인한 뒤 다시 준비해 주세요.");
  snapshot.warnings = [...new Set([...snapshot.warnings, ...purchaseFileWarnings, ...issues])];
  snapshot.source.purchaseFiles = purchaseFiles;
  snapshot.source.supplementedPurchaseRows = supplementedPurchaseRows;
  const receiptSourceIncomplete = drive.status === "rejected" || history.status === "rejected" || purchases.status === "rejected" || purchaseFileFailure;
  if (receiptSourceIncomplete) {
    snapshot.unresolvedItems = [...(snapshot.unresolvedItems || []), ...snapshot.vendorItems.map(item => ({ skuId: item.skuId, productName: item.productName,
      relatedPurchaseOrderNumbers: item.relatedPurchaseOrderNumbers, issues: [...new Set([...item.issues, ...issues])] }))];
    snapshot.vendorItems = [];
  } else if (issues.length) snapshot.vendorItems = snapshot.vendorItems.map(item => ({ ...item, suggestedQuantity: 0, issues: [...new Set([...item.issues, ...issues])] }));
  const failedChannels = [drive.status === "rejected" ? "drive" : "", history.status === "rejected" ? "history" : "", purchases.status === "rejected" ? "purchases" : "",
    catalog.status === "rejected" || (catalog.status === "fulfilled" && !catalog.value.configured) ? "catalog" : "", picking.status === "rejected" ? "picking" : "", workspace.status === "rejected" ? "workspace" : "", purchaseFileFailure ? "purchase-files" : ""].filter(Boolean);
  const fileToken = manifest.status === "fulfilled" ? manifest.value.token : "unavailable";
  snapshot.operationalToken = failedChannels.length ? undefined : weeklyOperationsWithPurchaseFiles(weeklyOperationalToken({ historyRows, purchaseRows, catalogItems, pickingStore }), fileToken);
  snapshot.sourceToken = createHash("sha256").update(JSON.stringify([snapshot.sourceToken, "weekly-new-receipt-scope-v1", "weekly-purchase-files-v1", fileToken, failedChannels, purchaseFileWarnings])).digest("hex");
  snapshot.id = `WEEKLY-${snapshot.sourceToken.slice(0,20)}`;
  return snapshot;
}
