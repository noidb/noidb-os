"use client";
import { resizeProductPhoto } from "@/app/wms/inbound/weekly-client";
import { VENDOR_QUEUE_PREFIX } from "@/lib/wms/vendor-order/consolidate";
import { VendorQueueEditingContext } from "@/lib/wms/vendor-order/queue-editing-context";
import type { PickingWaveStoreSnapshot } from "@/lib/wms/picking-wave/shared-store-types";
import { deriveVendorOrderDrafts } from "@/lib/wms/vendor-order/derive-drafts";
import { mergeVendorRecords, vendorRecordChanged, type VendorEditConflict } from "@/lib/wms/vendor-order/merge-workspace";
import { requestVendorJson } from "@/lib/wms/vendor-order/request-json";
import { planNewVendorDraft } from "@/lib/wms/vendor-order/new-draft";
import { orderVendorDrafts } from "@/lib/wms/vendor-order/order-list";
import { mergeVendorImageResult } from "@/lib/wms/vendor-order/image-edit";
import { getVendorLineDeletionBlockReason } from "@/lib/wms/vendor-order/delete-lines";
import VendorNameSelect from "./VendorNameSelect";
import ProductVariantAddSheet from "./ProductVariantAddSheet";
import type { ProductCatalogItem } from "@/lib/wms/product-catalog";
import { resolveVendorOrderCatalog } from "@/lib/wms/vendor-order/resolve-catalog";
import { displayVendorOrderMemo } from "@/lib/wms/vendor-order/display-memo";

import { useContext, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { usePickingWaveRepository } from "@/lib/wms/picking-wave/context";
import { useVendorOrderRepository } from "@/lib/wms/vendor-order/context";
import { recalculateAutoVendorOrderLines } from "@/lib/wms/vendor-order/recalculate";
import { toVendorOrderQuantity } from "@/lib/wms/vendor-order/aggregate";
import {
  MANUAL_VENDOR_WORKSPACE_ID,
  UNASSIGNED_VENDOR_NAME,
  VENDOR_ORDER_STATUS_LABEL,
  type VendorOrderDraft,
  type VendorOrderDraftLine,
  type VendorOrderDraftStatus,
} from "@/lib/wms/vendor-order/types";
import type { PickingWave } from "@/lib/wms/picking-wave/types";
import { fetchLiveCatalogLookup, type LiveCatalogLookup } from "@/lib/wms/picking-wave/live-catalog";
import { WMS_MOBILE_WIDTH, wmsColors, wmsSageButton as wmsPrimaryButton, wmsSecondaryButton, wmsGhostButton, wmsSageButton as wmsSlateDarkButton, wmsWarnButton, wmsOuterCard } from "@/lib/wms/ui-tokens";
import { resolveDisplayNameAndOption } from "@/lib/wms/display-name";
import { deriveArchivedVendorOrderWorkspace } from "@/lib/wms/vendor-order/derive-drafts";
import { useReceivingDelays } from "@/lib/wms/vendor-order/use-receiving-delays";
import { receivingDelayDate, type ReceivingDelaySummary } from "@/lib/wms/vendor-order/receiving-delay";
import { normalizeSkuId } from "@/lib/wms/sku-normalize";
import ReceivingDelayDialog from "./ReceivingDelayDialog";
import { planVendorReassignment } from "@/lib/wms/vendor-order/reassign-vendor";
import VendorOrderExportPanel from "./ExportPanel";
import VendorOrderCardPreview from "./VendorOrderCardPreview";
import ProductSearchAddSheet from "./ProductSearchAddSheet";
import DeleteVendorOrderButton from "./DeleteVendorOrderButton";
import CompleteReceivingButton from "./CompleteReceivingButton";
import SentVendorChangeButton from "./SentVendorChangeButton";
import SentReorderButton from "./SentReorderButton";
import { isVendorLineResolved, vendorLineClassification } from "@/lib/wms/vendor-order/receiving-state";
import ImageEditSheet from "../ImageEditSheet";
import { ExternalLinkIcon } from "../../../../icons";

/**
 * 거래처별 부족분 발주서(초안) 화면. 완료된 통합 피킹(웨이브)의 부족 수량을 제품DB "거래처" 기준으로
 * 자동 그룹핑해 보여주고, 수량 수정·행 삭제·새 상품 추가·거래처 변경·메모 입력·임시저장·승인을
 * 지원한다. 이 화면은 자동으로 아무것도 발송하지 않는다 — 승인은 항상 사용자가 직접 누른다.
 */
export default function VendorOrdersPage({ params, sharedSnapshot, historyView = false, historyDraftId }: { params: { waveId: string }; sharedSnapshot?: PickingWaveStoreSnapshot | null; historyView?: boolean; historyDraftId?: string }) {
  const waveRepository = usePickingWaveRepository();
  const vendorOrderRepository = useVendorOrderRepository();

  /** 웨이브 없이 만든 수동 거래처 발주서 전용 가상 작업공간인지 (2026-08-19 4차 실사용 테스트 신규
   *  — 거래처 발주관리 허브의 "웨이브 없이 새로 만들기"에서 진입). 이 경우 실제 PickingWave가
   *  없어도 이 화면을 그대로 재사용한다(새 화면을 따로 만들지 않음). */
  const isManualWorkspace = params.waveId === MANUAL_VENDOR_WORKSPACE_ID || params.waveId.startsWith(VENDOR_QUEUE_PREFIX);

  const [rawWave, setWave] = useState<PickingWave | null>(null);
  const [loading, setLoading] = useState(true);
  const [lines, setLines] = useState<VendorOrderDraftLine[]>([]);
  const [draftsByVendor, setDraftsByVendor] = useState<Record<string, VendorOrderDraft>>({});
  const [removedLineIds, setRemovedLineIds] = useState<Set<string>>(new Set());
  const [dirty, setDirty] = useState(false);
  const lineBaselines = useRef(new Map<string, VendorOrderDraftLine>());
  const draftBaselines = useRef(new Map<string, string>());
  const draftBaselineRecords = useRef<VendorOrderDraft[]>([]);
  const lastSharedSnapshot = useRef(sharedSnapshot);
  const [editConflicts, setEditConflicts] = useState<VendorEditConflict[]>([]);
  const conflictsRef = useRef(editConflicts);
  conflictsRef.current = editConflicts;
  const saveInFlight = useRef(false);
  const allocatedDraftIds = useRef(new Map<string, string>());
  const [deletedDraftIds, setDeletedDraftIds] = useState<Record<string, string>>({});
  const vendorMoving = useRef(false);
  const [saving, setSaving] = useState(false);
  const [statusSavingVendor, setStatusSavingVendor] = useState<string | null>(null);
  const [photoWorkCount, setPhotoWorkCount] = useState(0);
  const reportQueueEditing = useContext(VendorQueueEditingContext);
  useEffect(() => { reportQueueEditing?.(dirty || saving || photoWorkCount > 0 || loading); return () => reportQueueEditing?.(false); }, [dirty, saving, photoWorkCount, loading, reportQueueEditing]);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [searchAddVendor, setSearchAddVendor] = useState<string | null>(null);
  const [variantTarget, setVariantTarget] = useState<{ skuId: string; vendorName: string } | null>(null);
  const [manualVendorNames, setManualVendorNames] = useState<string[]>([]);
  const [discardedDraftIds, setDiscardedDraftIds] = useState<Set<string>>(new Set());
  const [savedSentLines, setSavedSentLines] = useState<Record<string, VendorOrderDraftLine>>({});
  const [routedVendorLineIds, setRoutedVendorLineIds] = useState<Set<string>>(new Set());
  const [preview, setIsPreview] = useState(false);
  const isPreview = historyView || preview;
  const [addingManualVendor, setAddingManualVendor] = useState(false);
  const [newVendorNameInput, setNewVendorNameInput] = useState("");
  const [liveCatalogByProductCode, setLiveCatalogByProductCode] = useState<LiveCatalogLookup>(new Map());
  const [pendingReorderLines, setPendingReorderLines] = useState<VendorOrderDraftLine[]>([]);
  const [selectedLineIds, setSelectedLineIds] = useState<Set<string>>(new Set());
  const [excludedLineIds, setExcludedLineIds] = useState<Set<string>>(new Set());
  const [completionError, setCompletionError] = useState<string | null>(null);
  const [workspaceMoved, setWorkspaceMoved] = useState(false);
  const [partialCompletionSkus, setPartialCompletionSkus] = useState<Set<string>>(new Set());
  const [completionMessage, setCompletionMessage] = useState<string | null>(null);
  const [sentOrderProcessing, setSentOrderProcessing] = useState<Set<string>>(new Set());
  const [completedDiscontinueSkus, setCompletedDiscontinueSkus] = useState<Set<string>>(new Set());
  const linesRef = useRef(lines);
  linesRef.current = lines;
  const draftsRef = useRef(draftsByVendor);
  draftsRef.current = draftsByVendor;
  const completionRequest = useRef(0);
  const deletingLines = useRef(false);
  const receivingDelays = useReceivingDelays();
  const [delayTarget, setDelayTarget] = useState<{ line: VendorOrderDraftLine; previous?: ReceivingDelaySummary; sent?: boolean } | null>(null);
  const [sentDelaySaving, setSentDelaySaving] = useState(false);
  const sentDelay = (line: VendorOrderDraftLine): ReceivingDelaySummary => ({ skuId: line.skuId, active: Boolean(line.receivingDelayedAt && !line.receivingDelayReleasedAt), recentDelayedAt: line.receivingDelayedAt || "", lastActionAt: line.updatedAt, memo: line.receivingDelayMemo, vendorName: line.vendorName });
  const [delayError, setDelayError] = useState<string | null>(null);
  const [delayMessage, setDelayMessage] = useState<string | null>(null);
  const archivedWorkspace = useMemo(
    () => rawWave || isManualWorkspace ? null : deriveArchivedVendorOrderWorkspace(params.waveId, Object.values(draftsByVendor), lines),
    [draftsByVendor, isManualWorkspace, lines, params.waveId, rawWave],
  );

  /** 제품링크는 발주서 라인에 저장하지 않고 항상 제품DB에서 SKU 기준으로 최신값을 읽는다 —
   *  기존 웨이브/라인은 이 필드가 생기기 전에 만들어졌을 수 있어, 저장된 스냅샷 대신 실시간
   *  조회를 쓰면 예전 데이터에서도 바로 동작한다 (2026-08-19 5차 실사용 테스트 신규). */
  async function refreshLiveCatalog() {
    setLiveCatalogByProductCode(await fetchLiveCatalogLookup());
  }

  function draftIdFor(vendorName: string) {
    const existing = draftsRef.current[vendorName];
    if (existing && !deletedDraftIds[existing.id]) return existing.id;
    const key = params.waveId + "::" + vendorName;
    if (!allocatedDraftIds.current.has(key)) allocatedDraftIds.current.set(key, key + "::new-" + crypto.randomUUID());
    return allocatedDraftIds.current.get(key)!;
  }

  function notifyQueueChange() {
    try { window.localStorage.setItem("noidb_vendor_order_queue_changed", new Date().toISOString()); } catch { /* The shared server remains authoritative. */ }
  }

  async function assertCurrentWorkspace(signal?: AbortSignal) {
    if (historyView) return;
    if (!params.waveId.startsWith(VENDOR_QUEUE_PREFIX)) return;
    const response = await fetch("/api/wms/vendor-orders/queue", { cache: "no-store", signal });
    const data = await response.json();
    if (!response.ok || !data.success) throw new Error(data.error || "현재 발주대기를 확인하지 못했습니다. 다시 시도해 주세요.");
    const hasUnsent = Object.values(draftsRef.current).some(draft => draft.status !== "sent");
    if (data.queueId && data.queueId !== params.waveId && hasUnsent) {
      setWorkspaceMoved(true);
      throw new Error("다른 창에서 발주대기가 갱신되었습니다. 이 창의 입력은 보존했으니 최신 발주대기를 열어 확인해 주세요.");
    }
  }

  async function checkCompletion(candidates: VendorOrderDraftLine[] = linesRef.current, requireCurrent = false): Promise<VendorOrderDraftLine[]> {
    const request = ++completionRequest.current;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 15_000);
    try {
      await assertCurrentWorkspace(controller.signal);
      const candidateDraftIds = new Set(candidates.map(line => line.draftId));
      const response = await fetch("/api/wms/vendor-orders/completion", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ waveId: params.waveId, lines: candidates, expectedDraftUpdatedAtById: Object.fromEntries([...draftBaselines.current].filter(([id]) => candidateDraftIds.has(id))), expectedUpdatedAtByLineId: Object.fromEntries(candidates.filter(line => lineBaselines.current.has(line.id)).map(line => [line.id, lineBaselines.current.get(line.id)!.updatedAt])) }), cache: "no-store", signal: controller.signal });
      const data = await response.json();
      if (!response.ok || !data.success || !Array.isArray(data.excludedLineIds)) throw new Error(data.error || "단종·재발주 처리 상태를 확인하지 못했습니다. 다시 확인해 주세요.");
      const excluded = new Set<string>(data.excludedLineIds);
      const stopped = new Set<string>((data.scope?.discontinued || []).map((item: { skuId: string }) => normalizeSkuId(item.skuId)));
      for (const line of candidates) if (stopped.has(normalizeSkuId(line.skuId))) excluded.add(line.id);
      const active = candidates.filter(line => !excluded.has(line.id) && !isVendorLineResolved(line));
      if (request === completionRequest.current) {
        setCompletedDiscontinueSkus(stopped);
        setRoutedVendorLineIds(new Set(data.scope?.routedVendorLineIds || []));
        setExcludedLineIds(previous => new Set([...previous].filter(id => !candidates.some(line => line.id === id)).concat([...excluded])));
        setPartialCompletionSkus(new Set((data.partialCompletions || []).map((row: { skuId: string }) => row.skuId)));
        setCompletionError(null);
        const count = candidates.length - active.length;
        setCompletionMessage(count ? `단종·재발주 처리가 완료된 ${count}개 품목을 이번 발주에서 제외했습니다.` : null);
        setSelectedLineIds(previous => new Set([...previous].filter(id => !excluded.has(id))));
      }
      if (requireCurrent && request !== completionRequest.current) throw new Error("처리 상태가 갱신되었습니다. 다시 눌러 최신 발주를 확인해 주세요.");
      return active;
    } catch (error) {
      const message = error instanceof DOMException && error.name === "AbortError"
        ? "단종·재발주 완료 여부 확인이 15초 이상 지연됐습니다. 잠시 후 다시 눌러 주세요."
        : error instanceof Error ? error.message : "처리 상태를 확인하지 못했습니다.";
      if (request === completionRequest.current) setCompletionError(message);
      throw new Error(message);
    } finally {
      window.clearTimeout(timeout);
    }
  }

  useEffect(() => {
    (async () => {
      try {
        const [loadedWave, waveItems, loadedDrafts, loadedLines, allVendorLines] = await Promise.all([
          isManualWorkspace ? Promise.resolve(null) : waveRepository.getWave(params.waveId),
          isManualWorkspace ? Promise.resolve([]) : waveRepository.listItems(params.waveId),
          sharedSnapshot ? Promise.resolve(deriveVendorOrderDrafts(sharedSnapshot.vendorOrderDrafts, sharedSnapshot.vendorOrderLines).filter(d => d.waveId === params.waveId)) : vendorOrderRepository.listDrafts(params.waveId),
          sharedSnapshot ? Promise.resolve(sharedSnapshot.vendorOrderLines.filter(line => line.waveId === params.waveId)) : vendorOrderRepository.listLines(params.waveId),
          sharedSnapshot ? Promise.resolve(sharedSnapshot.vendorOrderLines) : vendorOrderRepository.listAllLines(),
        ]);
        const existingDrafts = loadedDrafts.filter(draft => historyView ? draft.status === "sent" && (!historyDraftId || draft.id === historyDraftId) : !draft.archivedAt);
        const visibleDraftIds = new Set(existingDrafts.map(d => d.id));
        const existingLines = loadedLines.filter(line => visibleDraftIds.has(line.draftId));
        draftBaselineRecords.current = existingDrafts;
        setPendingReorderLines(allVendorLines.filter(line => (line.reorderPendingQuantity || 0) > 0));
        setWave(loadedWave);
        lineBaselines.current = new Map(existingLines.map(line => [line.id, line]));
        setDraftsByVendor(Object.fromEntries(existingDrafts.map(draft => [draft.vendorName, draft])));

        const queueResponse = await fetch("/api/wms/vendor-orders/queue", { cache: "no-store" });
        const queueData = await queueResponse.json();
        if (!queueResponse.ok || !queueData.success) throw new Error(queueData.error || "취합된 발주 확인에 실패했습니다.");
        setDeletedDraftIds(queueData.deletedDraftIds || {});
        draftBaselines.current = new Map(existingDrafts.filter(draft => queueData.draftUpdatedAtById ? Object.hasOwn(queueData.draftUpdatedAtById, draft.id) : true).map(draft => [draft.id, queueData.draftUpdatedAtById?.[draft.id] || draft.updatedAt]));
        if (!historyView && params.waveId.startsWith(VENDOR_QUEUE_PREFIX) && queueData.queueId && queueData.queueId !== params.waveId && existingDrafts.some(draft => draft.status !== "sent")) {
          window.location.replace("/wms/vendor-orders/manage");
          return;
        }
        const consumed = new Set<string>(queueData.consumedLineIds || []);
        const activeWaveItems = waveItems.filter(item => !consumed.has(params.waveId + "::" + (item.vendorName || UNASSIGNED_VENDOR_NAME) + "::" + item.productCode));
        const now = new Date().toISOString();
        if (isManualWorkspace) {
          // 웨이브가 없으므로 재계산할 부족분 자체가 없다 — 저장된 수동 라인만 그대로 보여준다.
          setLines(existingLines);
          await checkCompletion(existingLines);
          setIsPreview(false);
        } else if (loadedWave) {
          // Opening a page is read-only. Preserve already sent rows and only propose
          // changes for editable drafts; a user save is the persistence boundary.
          const lockedDraftIds = new Set(existingDrafts.filter(draft => draft.status === "sent").map(draft => draft.id));
          const lockedLines = existingLines.filter(line => lockedDraftIds.has(line.draftId) || line.orderExclusion);
          const lockedSkuIds = new Set(lockedLines.map(line => line.skuId));
          const recalculated = recalculateAutoVendorOrderLines(params.waveId, activeWaveItems.filter(item => !lockedSkuIds.has(item.productCode)), existingLines.filter(line => !lockedDraftIds.has(line.draftId) && !line.orderExclusion), now);
          setLines([...lockedLines, ...recalculated.lines]);
          await checkCompletion([...lockedLines, ...recalculated.lines]);
          setRemovedLineIds(new Set(recalculated.removedLineIds));
          setDirty(Boolean(recalculated.removedLineIds.length || recalculated.addedProductCodes.length || recalculated.updatedProductCodes.length));
          // Shortages may be ordered while the rest of this same outbound work is still picked.
          setIsPreview(false);
        } else {
          // 원래 웨이브가 보관/삭제된 과거 발주서는 저장된 거래처 발주 품목을 그대로 복구한다.
          // 재계산할 원본 웨이브가 없으므로 기존 라인을 수정하거나 삭제하지 않는다.
          setLines(existingLines);
          await checkCompletion(existingLines);
          setIsPreview(false);
        }
      } catch (error) {
        setSaveError(error instanceof Error ? error.message : "거래처 발주서를 불러오지 못했습니다.");
      } finally {
        setLoading(false);
      }
    })();
    // 제품DB(구글시트) 조회는 로컬 데이터 로딩과 분리한다 — 느려지거나 실패해도 화면 진입을
    // 막지 않는다(2026-08-19 4차 실사용 테스트에서 확인된 무한로딩 버그와 같은 실수를 반복하지 않기 위함).
    refreshLiveCatalog();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.waveId]);

  useEffect(() => {
    if (!sharedSnapshot || loading || saving || statusSavingVendor || photoWorkCount || lastSharedSnapshot.current === sharedSnapshot) return;
    lastSharedSnapshot.current = sharedSnapshot;
    const remoteDrafts = deriveVendorOrderDrafts(sharedSnapshot.vendorOrderDrafts, sharedSnapshot.vendorOrderLines).filter(d => d.waveId === params.waveId && !d.archivedAt);
    const ids = new Set(remoteDrafts.map(d => d.id));
    const remoteLines = sharedSnapshot.vendorOrderLines.filter(line => ids.has(line.draftId));
    if (remoteLines.some(line => (lineBaselines.current.get(line.id)?.updatedAt || "") > line.updatedAt)
      || remoteDrafts.some(draft => (draftBaselines.current.get(draft.id) || "") > draft.updatedAt)) return;
    const mergedLines = mergeVendorRecords("line", [...lineBaselines.current.values()], linesRef.current, remoteLines, removedLineIds, conflictsRef.current);
    const mergedDrafts = mergeVendorRecords("draft", draftBaselineRecords.current, Object.values(draftsRef.current), remoteDrafts, new Set(), conflictsRef.current);
    for (const line of mergedLines.records) {
      const remote = remoteLines.find(row => row.id === line.id);
      if (remote && remoteDrafts.some(draft => draft.id === line.draftId && draft.status === "sent") && vendorRecordChanged(remote, line)) {
        const key = "line:" + line.id + ":__deleted";
        if (!mergedLines.conflicts.some(conflict => conflict.key === key)) mergedLines.conflicts.push({ key, kind: "line", id: line.id, vendorName: line.vendorName, field: "__deleted", local: line, remote });
      }
    }
    setLines(mergedLines.records);
    setDraftsByVendor(Object.fromEntries(mergedDrafts.records.map(d => [d.vendorName, d])));
    setEditConflicts([...mergedLines.conflicts, ...mergedDrafts.conflicts]);
    lineBaselines.current = new Map(remoteLines.map(line => [line.id, line]));
    draftBaselineRecords.current = remoteDrafts;
    draftBaselines.current = new Map(remoteDrafts.map(d => [d.id, d.updatedAt]));
    setDirty(removedLineIds.size > 0 || mergedLines.records.some(line => vendorRecordChanged(lineBaselines.current.get(line.id), line)) || mergedDrafts.records.some(d => vendorRecordChanged(remoteDrafts.find(r => r.id === d.id), d)));
  }, [sharedSnapshot, loading, saving, statusSavingVendor, photoWorkCount, params.waveId, removedLineIds]);

  function resolveEditConflict(conflict: VendorEditConflict, useMine: boolean) {
    if (!useMine) {
      if (conflict.kind === "line") setLines(previous => conflict.field === "__deleted"
        ? conflict.remote ? [...previous.filter(line => line.id !== conflict.id), conflict.remote as VendorOrderDraftLine] : previous.filter(line => line.id !== conflict.id)
        : previous.map(line => line.id === conflict.id ? { ...line, [conflict.field]: conflict.remote } : line));
      else setDraftsByVendor(previous => {
        const values = Object.values(previous).filter(d => conflict.field !== "__deleted" || d.id !== conflict.id).map(d => d.id === conflict.id ? { ...d, [conflict.field]: conflict.remote } : d);
        return Object.fromEntries(values.map(d => [d.vendorName, d]));
      });
      if (conflict.field === "__deleted") setRemovedLineIds(previous => { const next = new Set(previous); next.delete(conflict.id); return next; });
    }
    setEditConflicts(previous => previous.filter(item => item.key !== conflict.key));
  }

  useEffect(() => {
    if (historyView || loading || !liveCatalogByProductCode.size) return;
    const prepared = resolveVendorOrderCatalog({ lines: linesRef.current, drafts: Object.values(draftsRef.current), catalogItems: liveCatalogByProductCode.values(), deletedDraftIds, now: new Date().toISOString() });
    if (!prepared.changes.length) return;
    setLines(prepared.lines);
    setDraftsByVendor(Object.fromEntries(prepared.drafts.map(draft => [draft.vendorName, draft])));
    setDirty(true);
  }, [loading, liveCatalogByProductCode, draftsByVendor, deletedDraftIds]);

  const groups = useMemo(() => {
    const map = new Map<string, VendorOrderDraftLine[]>();
    const manualVendorPriority = new Map(manualVendorNames.map((vendorName, index) => [vendorName, index]));
    for (const line of lines) {
      const sent = Object.values(draftsByVendor).some(draft => draft.id === line.draftId && draft.status === "sent");
      if (excludedLineIds.has(line.id) || routedVendorLineIds.has(line.id) || vendorLineClassification(line) === "resolved" || (!sent && completedDiscontinueSkus.has(normalizeSkuId(line.skuId)))) continue;
      const vendor = line.vendorName || UNASSIGNED_VENDOR_NAME;
      const list = map.get(vendor) || [];
      list.push(line);
      map.set(vendor, list);
    }
    // 상품 없이 "발주서 수동 추가"로 막 만든 거래처도 빈 그룹으로 보여준다 (2026-08-19 신규).
    for (const vendorName of [...manualVendorNames, ...Object.values(draftsByVendor).filter(d => !d.archivedAt).map(d => d.vendorName), ...pendingReorderLines.map(line => line.vendorName || UNASSIGNED_VENDOR_NAME)]) {
      if (!map.has(vendorName)) map.set(vendorName, []);
    }
    return Array.from(map.entries())
      .map(([vendorName, groupLines]) => ({ vendorName, lines: [...groupLines].sort((a, b) => {
        const aManualGroup = a.manualListGroup || "";
        const bManualGroup = b.manualListGroup || "";
        if (Boolean(aManualGroup) !== Boolean(bManualGroup)) return aManualGroup ? 1 : -1;
        if (aManualGroup && bManualGroup && aManualGroup !== bManualGroup) return aManualGroup.localeCompare(bManualGroup);
        return (a.modelName || a.productName).localeCompare(b.modelName || b.productName, "ko", { numeric: true }) ||
        a.optionLabel.localeCompare(b.optionLabel, "ko", { numeric: true }) ||
        a.skuId.localeCompare(b.skuId, "ko", { numeric: true });
      }) }))
      .sort((a, b) => {
        const aPriority = manualVendorPriority.get(a.vendorName);
        const bPriority = manualVendorPriority.get(b.vendorName);
        if (aPriority !== undefined || bPriority !== undefined) {
          if (aPriority === undefined) return 1;
          if (bPriority === undefined) return -1;
          return aPriority - bPriority;
        }
        return a.vendorName === UNASSIGNED_VENDOR_NAME ? 1 : b.vendorName === UNASSIGNED_VENDOR_NAME ? -1 : a.vendorName.localeCompare(b.vendorName);
      });
  }, [lines, draftsByVendor, manualVendorNames, pendingReorderLines, excludedLineIds, completedDiscontinueSkus, routedVendorLineIds]);

  const orderEntries = useMemo(() => {
    type Entry = { id: string; vendorName: string; draft?: VendorOrderDraft; group?: typeof groups[number]; historyLines?: VendorOrderDraftLine[] };
    const entries: Entry[] = groups.map(group => ({ id: draftsByVendor[group.vendorName]?.id || `local:${group.vendorName}`, vendorName: group.vendorName, draft: draftsByVendor[group.vendorName], group }));
    if (!historyView && sharedSnapshot) {
      const activeIds = new Set(entries.map(entry => entry.id));
      for (const draft of deriveVendorOrderDrafts(sharedSnapshot.vendorOrderDrafts, sharedSnapshot.vendorOrderLines)) {
        if (activeIds.has(draft.id) || draft.status !== "sent") continue;
        const historyLines = sharedSnapshot.vendorOrderLines.map(line => savedSentLines[line.id] && savedSentLines[line.id].updatedAt >= line.updatedAt ? savedSentLines[line.id] : line).filter(line => line.draftId === draft.id && !sharedSnapshot.deletedVendorLineIds[line.id] && !excludedLineIds.has(line.id) && !routedVendorLineIds.has(line.id) && vendorLineClassification(line) !== "resolved");
        if (historyLines.length) entries.push({ id: draft.id, vendorName: draft.vendorName, draft, historyLines });
      }
    }
    const visibleEntries = entries.filter(entry => !discardedDraftIds.has(entry.id) && (entry.draft?.status !== "sent" || (entry.group?.lines || entry.historyLines || []).length > 0));
    // A completed transfer hides its resolved sent source card, but that order still
    // reserves its display number so the follow-up draft remains identifiable.
    const labelEntries: Entry[] = sharedSnapshot
      ? [...visibleEntries, ...deriveVendorOrderDrafts(sharedSnapshot.vendorOrderDrafts, sharedSnapshot.vendorOrderLines)
        .filter(draft => (draft.status === "sent" || draft.waveId === params.waveId) && !sharedSnapshot.deletedVendorDraftIds[draft.id] && !visibleEntries.some(entry => entry.id === draft.id))
        .map((draft): Entry => ({ id: draft.id, vendorName: draft.vendorName, draft }))]
      : visibleEntries;
    return orderVendorDrafts(visibleEntries, labelEntries);
  }, [groups, draftsByVendor, historyView, sharedSnapshot, completedDiscontinueSkus, discardedDraftIds, savedSentLines, excludedLineIds, routedVendorLineIds]);

  const variantSkuIds = useMemo(() => {
    const models = new Map<string, Set<string>>();
    for (const item of liveCatalogByProductCode.values()) {
      const model = item.modelName.trim().toLocaleLowerCase("ko"), sku = normalizeSkuId(item.skuId);
      if (!model || !sku) continue;
      const siblings = models.get(model) || new Set<string>(); siblings.add(sku); models.set(model, siblings);
    }
    return new Set([...models.values()].filter(skus => skus.size > 1).flatMap(skus => [...skus]));
  }, [liveCatalogByProductCode]);

  // 거래처 입력 자동완성 후보 — 이미 이 발주서에 존재하는 실제 거래처명만 쓴다(새 값을 임의로 만들지 않음).
  const knownVendorNames = useMemo(
    () => Array.from(new Set([
      ...groups.map(g => g.vendorName),
      ...Array.from(liveCatalogByProductCode.values()).map(item => item.vendorName),
    ].filter(name => name && name !== UNASSIGNED_VENDOR_NAME))).sort((a, b) => a.localeCompare(b, "ko")),
    [groups, liveCatalogByProductCode]
  );

  function statusOf(vendorName: string): VendorOrderDraftStatus {
    return draftsByVendor[vendorName]?.status ?? "draft";
  }

  function updateLine(id: string, patch: Partial<VendorOrderDraftLine>) {
    setLines(prev => prev.map(line => (line.id === id ? { ...line, ...patch, updatedAt: new Date().toISOString() } : line)));
    setDirty(true);
  }

  async function savePastedPhoto(lineId: string, imageUrl: string) {
    await assertCurrentWorkspace();
    const currentLines = linesRef.current;
    const current = currentLines.find(line => line.id === lineId);
    if (!current) throw new Error("사진을 저장할 상품을 찾지 못했습니다.");
    const baseline = lineBaselines.current.get(lineId);
    if (!baseline) {
      const nextLines = currentLines.map(line => line.id === lineId ? { ...line, imageUrl, updatedAt: new Date().toISOString() } : line);
      linesRef.current = nextLines;
      setLines(nextLines);
      setDirty(true);
      // 아직 서버에 한 번도 저장되지 않은 새 상품은 전체 발주서 버전과 묶어 자동저장하지 않는다.
      // 이미지는 제품DB에 저장됐고 화면에도 유지되며, 사용자가 '변경내용 저장'을 누를 때 새 상품의
      // 수량·메모와 함께 한 번에 저장된다. 다른 상품/탭의 변경 때문에 사진 등록이 막히지 않는다.
      return;
    }
    const response = await fetch("/api/wms/vendor-orders/queue", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "saveLineImage", lineId, imageUrl, expectedImageUrl: baseline.imageUrl || "" }) });
    const data = await response.json();
    if (!response.ok || !data.success || !data.line) throw new Error(data.error || "사진을 저장하지 못했습니다.");
    const saved: VendorOrderDraftLine = data.line;
    const nextLines = linesRef.current.map(line => line.id === lineId ? mergeVendorImageResult(line, baseline, saved) : line);
    linesRef.current = nextLines;
    lineBaselines.current.set(lineId, saved);
    setLines(nextLines);
    setDirty(Boolean(removedLineIds.size || nextLines.some(line => JSON.stringify(line) !== JSON.stringify(lineBaselines.current.get(line.id)))));
  }

  function removeLine(line: VendorOrderDraftLine) {
    void deleteLines([line], `"${line.productName || line.skuId}"를 발주 초안에서 삭제할까요?`);
  }

  async function changeVendor(lineId: string, vendorName: string) {
    if (saving || vendorMoving.current) throw new Error("발주서를 저장하고 있습니다. 잠시 기다려 주세요.");
    const line = linesRef.current.find(candidate => candidate.id === lineId);
    if (!line) throw new Error("이동할 발주 품목을 찾지 못했습니다.");
    vendorMoving.current = true; setSaving(true); setSaveError(null);
    let catalogSaved = false;
    try {
      await assertCurrentWorkspace();
      const latest = await requestVendorJson<{ snapshot: PickingWaveStoreSnapshot }>("/api/wms/picking-waves", { cache: "no-store" });
      if (!latest.response.ok || !latest.data.snapshot) throw new Error("최신 발주서를 확인하지 못했습니다.");
      const plan = planVendorReassignment({ snapshot: latest.data.snapshot, line, vendorName, baseline: lineBaselines.current.get(lineId), localLines: linesRef.current, operationId: crypto.randomUUID(), now: new Date().toISOString() });
      const response = await fetch("/api/wms/product-catalog/update", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ skuId: line.skuId, vendorName: plan.line.vendorName }) });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || "제품DB 거래처 저장에 실패했습니다.");
      catalogSaved = true;
      const saved = await requestVendorJson<{ ok: boolean; error?: string }>("/api/wms/picking-waves", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(plan.mutation) }, 45000);
      if (!saved.response.ok || !saved.data.ok) throw new Error(saved.data.error || "발주서 이동을 저장하지 못했습니다.");
      const archived = new Set(plan.archivedDraftIds);
      for (const [id, previous] of lineBaselines.current) if (archived.has(previous.draftId)) lineBaselines.current.delete(id);
      for (const id of archived) draftBaselines.current.delete(id);
      lineBaselines.current.set(plan.line.id, plan.line);
      draftBaselines.current.set(plan.draft.id, plan.draft.updatedAt);
      const nextLines = linesRef.current.filter(candidate => !archived.has(candidate.draftId)).map(candidate => candidate.id === lineId ? plan.line : candidate);
      linesRef.current = nextLines;
      draftsRef.current = { ...draftsRef.current, [plan.draft.vendorName]: plan.draft };
      draftBaselineRecords.current = draftBaselineRecords.current.filter(draft => draft.id !== plan.draft.id && !archived.has(draft.id)).concat(plan.draft);
      setLines(nextLines);
      setDraftsByVendor(previous => ({ ...previous, [plan.draft.vendorName]: plan.draft }));
      setLiveCatalogByProductCode(previous => { const next = new Map(previous); for (const [key, value] of next) if (value.skuId === line.skuId) next.set(key, { ...value, vendorName: plan.line.vendorName }); return next; });
      setDirty(Boolean(removedLineIds.size || nextLines.some(candidate => JSON.stringify(candidate) !== JSON.stringify(lineBaselines.current.get(candidate.id)))));
      notifyQueueChange();
    } catch (reason) {
      throw new Error(`${catalogSaved ? "제품DB 거래처는 저장됐지만 발주 초안 이동은 완료되지 않았습니다. 입력한 수량·메모를 유지했으니 다시 시도해 주세요. " : ""}${reason instanceof Error ? reason.message : "거래처 이동에 실패했습니다."}`);
    } finally { vendorMoving.current = false; setSaving(false); }
  }

  const selectableLines = orderEntries.flatMap(entry => {
    const status = entry.draft?.status || statusOf(entry.vendorName);
    return status !== "sent" || sentOrderProcessing.has(entry.id) ? (entry.group?.lines || entry.historyLines || []) : [];
  }).filter(line => !excludedLineIds.has(line.id) && !line.orderExclusion && !getVendorLineDeletionBlockReason(line, draftsByVendor[line.vendorName || UNASSIGNED_VENDOR_NAME], true));
  const selectedLines = selectableLines.filter(line => selectedLineIds.has(line.id));
  useEffect(() => {
    const eligible = new Set(selectableLines.map(line => line.id));
    setSelectedLineIds(previous => { const next = new Set([...previous].filter(id => eligible.has(id))); return next.size === previous.size ? previous : next; });
    // Selection follows current statuses and receiving records without modifying any draft fields.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines, draftsByVendor, excludedLineIds]);

  async function deleteLines(targets: VendorOrderDraftLine[], confirmation: string) {
    if (saving || isPreview || workspaceMoved || deletingLines.current || !targets.length) return;
    const blocked = targets.map(line => getVendorLineDeletionBlockReason(line, draftsByVendor[line.vendorName || UNASSIGNED_VENDOR_NAME], true)).find(Boolean);
    if (blocked) { setSaveError(blocked); return; }
    if (!window.confirm(confirmation)) return;
    deletingLines.current = true; setSaving(true); setSaveError(null);
    try {
      const saved = targets.filter(line => lineBaselines.current.has(line.id) || sharedSnapshot?.vendorOrderLines.some(row => row.id === line.id));
      for (const waveId of new Set(saved.map(line => line.waveId))) {
        const batch = saved.filter(line => line.waveId === waveId);
        const response = await fetch("/api/wms/picking-waves", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "deleteVendorLines", waveId, lineIds: batch.map(line => line.id), expectedUpdatedAtByLineId: Object.fromEntries(batch.map(line => [line.id, lineBaselines.current.get(line.id)?.updatedAt ?? line.updatedAt])), deletedAt: new Date().toISOString() }) });
        const data = await response.json();
        if (!response.ok || !data.ok) throw new Error(data.error || "해당 상품을 삭제하지 못했습니다. 남은 목록을 확인해 주세요.");
        const completed = new Set(batch.map(line => line.id));
        setRoutedVendorLineIds(previous => new Set([...previous, ...completed]));
        setLines(previous => previous.filter(line => !completed.has(line.id)));
        setSelectedLineIds(previous => new Set([...previous].filter(id => !completed.has(id))));
        for (const id of completed) lineBaselines.current.delete(id);
        notifyQueueChange();
      }
      const deleted = new Set(targets.map(line => line.id));
      setRoutedVendorLineIds(previous => new Set([...previous, ...deleted]));
      const nextLines = linesRef.current.filter(line => !deleted.has(line.id));
      const nextRemoved = new Set([...removedLineIds].filter(id => !deleted.has(id)));
      for (const id of deleted) lineBaselines.current.delete(id);
      setLines(nextLines); setRemovedLineIds(nextRemoved);
      setSelectedLineIds(previous => new Set([...previous].filter(id => !deleted.has(id))));
      setDirty(Boolean(nextRemoved.size || nextLines.some(line => JSON.stringify(line) !== JSON.stringify(lineBaselines.current.get(line.id)))));
      setCompletionMessage(`선택한 ${deleted.size}개 상품을 삭제하고 저장했습니다.`);
      notifyQueueChange();
    } catch (error) { setSaveError(error instanceof Error ? error.message : "선택한 상품을 삭제하지 못했습니다."); }
    finally { deletingLines.current = false; setSaving(false); }
  }

  function removeSelectedLines() {
    void deleteLines(selectedLines, `선택한 ${selectedLines.length}개 품목을 발주 초안에서 삭제할까요? 삭제는 즉시 저장됩니다.`);
  }

  function markVendorRevisionLocal(vendorName: string) {
    const now = new Date().toISOString();
    setDraftsByVendor(previous => {
      const current = previous[vendorName];
      if (!current || ["draft", "review", "resend_needed"].includes(current.status)) return previous;
      return { ...previous, [vendorName]: { ...current, status: "resend_needed", sentAt: undefined, statusBeforeSent: undefined, updatedAt: now } };
    });
    setDirty(true);
  }

  async function beginVendorRevision(vendorName: string): Promise<boolean> {
    if (saving || statusSavingVendor || workspaceMoved) return false;
    const current = draftsRef.current[vendorName];
    if (!current || ["draft", "review", "resend_needed"].includes(current.status)) return true;
    const expectedUpdatedAt = draftBaselines.current.get(current.id) ?? null;
    const revised: VendorOrderDraft = {
      ...current,
      status: "resend_needed",
      sentAt: undefined,
      statusBeforeSent: undefined,
      updatedAt: new Date().toISOString(),
    };
    setStatusSavingVendor(vendorName);
    setSaveError(null);
    try {
      await assertCurrentWorkspace();
      const response = await fetch("/api/wms/picking-waves", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "saveVendorDraft", draft: revised, expectedUpdatedAt }),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "발주서를 수정 상태로 전환하지 못했습니다.");
      draftBaselines.current.set(revised.id, revised.updatedAt);
      setDraftsByVendor(previous => ({ ...previous, [vendorName]: revised }));
      setCompletionMessage(`${vendorName} 발주서를 수정 상태로 전환했습니다. 사진과 발주내용을 바로 변경할 수 있습니다.`);
      notifyQueueChange();
      return true;
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "발주서를 수정 상태로 전환하지 못했습니다.");
      return false;
    } finally {
      setStatusSavingVendor(null);
    }
  }

  async function queueLineForDiscontinue(line: VendorOrderDraftLine) {
    if (saving || workspaceMoved) throw new Error("다른 저장이 끝난 뒤 다시 눌러 주세요.");
    const vendorName = line.vendorName || UNASSIGNED_VENDOR_NAME;
    const status = statusOf(vendorName);
    if (status === "sent") throw new Error("전송완료 발주서는 먼저 '발주내용 수정'을 눌러 수정 상태로 전환해 주세요.");
    await assertCurrentWorkspace();
    const response = await fetch("/api/wms/vendor-order-actions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "queue-discontinue",
        skuId: line.skuId,
        purchaseOrderNumber: line.relatedPurchaseOrderNumbers.join(","),
        operator: rawWave?.workerName || "WMS 거래처 발주",
      }),
    });
    const data = await response.json();
    if (!response.ok || !data.success) throw new Error(data.error || "단종대기에 추가하지 못했습니다.");

    // 단종대기에 넣은 상품은 같은 초안에서 다시 주문하지 않도록 즉시 삭제 이력을 남긴다.
    const baseline = lineBaselines.current.get(line.id);
    if (baseline) {
      const deletedAt = new Date().toISOString();
      const deleteResponse = await fetch("/api/wms/picking-waves", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "deleteVendorLines", waveId: params.waveId, lineIds: [line.id], expectedUpdatedAtByLineId: { [line.id]: baseline.updatedAt }, deletedAt }),
      });
      const deleteData = await deleteResponse.json();
      if (!deleteResponse.ok || !deleteData.ok) throw new Error(`단종대기에는 추가했지만 발주서에서 제외하지 못했습니다. ${deleteData.error || "목록을 새로 확인해 주세요."}`);
    }
    lineBaselines.current.delete(line.id);
    setLines(previous => previous.filter(item => item.id !== line.id));
    setSelectedLineIds(previous => { const next = new Set(previous); next.delete(line.id); return next; });
    setRemovedLineIds(previous => { const next = new Set(previous); next.delete(line.id); return next; });
    setCompletionMessage(`SKU ${line.skuId}를 단종대기에 추가하고 이번 발주서에서 제외했습니다.`);
    notifyQueueChange();
  }

  async function queueSentLineForDiscontinue(line: VendorOrderDraftLine) {
    const response = await fetch("/api/wms/vendor-order-actions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "queue-discontinue", sourceLineId: line.id, expectedUpdatedAt: line.updatedAt, skuId: line.skuId, purchaseOrderNumber: line.relatedPurchaseOrderNumbers.join(","), operator: rawWave?.workerName || "WMS 거래처 발주" }) });
    const data = await response.json();
    if (!response.ok || !data.success) throw new Error(data.error || "단종대기에 추가하지 못했습니다.");
    if (data.line) handleSentLineSaved(data.line);
    setExcludedLineIds(previous => new Set(previous).add(line.id));
    setCompletionMessage(`SKU ${line.skuId}를 단종대기에 추가했습니다. 전송·입고 이력은 보존됩니다.`);
    notifyQueueChange();
  }

  async function queueLineForReorder(line: VendorOrderDraftLine, preserveSentOrder = false) {
    if (line.isStockReplenishment) throw new Error("재고보충 상품은 쿠팡 미납분재발주요청 대상이 아닙니다.");
    if (saving || workspaceMoved) throw new Error("다른 저장이 끝난 뒤 다시 눌러 주세요.");
    await assertCurrentWorkspace();
    const response = await fetch("/api/wms/work-list-routing", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({source:"vendor",target:"reorder",ids:[line.id],preserveSentOrder,expectedUpdatedAtById:{[line.id]:preserveSentOrder ? line.updatedAt : lineBaselines.current.get(line.id)?.updatedAt}}) });
    const data = await response.json();
    if (!response.ok || !data.success) throw new Error(data.error || data.failed?.[0]?.error || "미납분재발주요청으로 이동하지 못했습니다.");
    if (preserveSentOrder) {
      setExcludedLineIds(previous => new Set(previous).add(line.id));
      setCompletionMessage(`SKU ${line.skuId}를 기존 미납분재발주요청 대기 목록에 취합했습니다. 전송·입고 이력은 보존됩니다.`);
      notifyQueueChange();
      return;
    }
    lineBaselines.current.delete(line.id); setLines(previous=>previous.filter(item=>item.id!==line.id));
    setSelectedLineIds(previous=>{const next=new Set(previous);next.delete(line.id);return next;});
    setRemovedLineIds(previous=>{const next=new Set(previous);next.delete(line.id);return next;});
    setCompletionMessage(`SKU ${line.skuId}를 미납분재발주요청 목록으로 이동했습니다.`); notifyQueueChange();
  }

  function handleSentLineSaved(saved: VendorOrderDraftLine, snapshot?: PickingWaveStoreSnapshot) {
    setSavedSentLines(previous => ({ ...previous, [saved.id]: saved }));
    if (lineBaselines.current.has(saved.id)) lineBaselines.current.set(saved.id, saved);
    const target = snapshot?.vendorOrderDrafts.find(draft => draft.id === saved.vendorTransfer?.targetDraftId && draft.waveId === params.waveId);
    if (snapshot && target) {
      // Apply the successful move response without reloading or replacing other local edits.
      const remoteLines = snapshot.vendorOrderLines.filter(line => line.draftId === target.id);
      const archivedIds = new Set(snapshot.vendorOrderDrafts.filter(draft => draft.vendorName === target.vendorName && draft.archivedAt && draft.id !== target.id).map(draft => draft.id));
      const mergedLines = mergeVendorRecords("line", [...lineBaselines.current.values()].filter(line => line.draftId === target.id), linesRef.current.filter(line => line.draftId === target.id), remoteLines, removedLineIds, conflictsRef.current);
      const mergedDrafts = mergeVendorRecords("draft", draftBaselineRecords.current.filter(draft => draft.id === target.id), Object.values(draftsRef.current).filter(draft => draft.id === target.id), [target], new Set(), conflictsRef.current);
      const nextLines = linesRef.current.filter(line => line.draftId !== target.id && !archivedIds.has(line.draftId)).map(line => line.id === saved.id ? saved : line).concat(mergedLines.records);
      const nextDrafts = { ...draftsRef.current, [target.vendorName]: mergedDrafts.records[0] };
      for (const [id, line] of lineBaselines.current) if (line.draftId === target.id || archivedIds.has(line.draftId)) lineBaselines.current.delete(id);
      for (const line of remoteLines) lineBaselines.current.set(line.id, line);
      draftBaselineRecords.current = draftBaselineRecords.current.filter(draft => draft.id !== target.id && !archivedIds.has(draft.id)).concat(target);
      for (const id of archivedIds) draftBaselines.current.delete(id);
      draftBaselines.current.set(target.id, target.updatedAt);
      linesRef.current = nextLines; setLines(nextLines);
      draftsRef.current = nextDrafts; setDraftsByVendor(nextDrafts);
      setEditConflicts([...mergedLines.conflicts, ...mergedDrafts.conflicts]);
      setDirty(removedLineIds.size > 0 || nextLines.some(line => vendorRecordChanged(lineBaselines.current.get(line.id), line)) || Object.values(nextDrafts).some(draft => vendorRecordChanged(draftBaselineRecords.current.find(row => row.id === draft.id), draft)));
    } else {
      const nextLines = linesRef.current.map(line => line.id === saved.id ? saved : line);
      linesRef.current = nextLines; setLines(nextLines);
    }
    notifyQueueChange();
  }

  function handleVendorOrderDeleted(draftId: string) {
    const removedDraft = Object.values(draftsRef.current).find(draft => draft.id === draftId);
    const ids = new Set([...linesRef.current, ...lineBaselines.current.values()].filter(line => line.draftId === draftId).map(line => line.id));
    for (const id of ids) lineBaselines.current.delete(id);
    draftBaselines.current.delete(draftId);
    draftBaselineRecords.current = draftBaselineRecords.current.filter(draft => draft.id !== draftId);
    const nextLines = linesRef.current.filter(line => line.draftId !== draftId);
    linesRef.current = nextLines; setLines(nextLines);
    const nextRemoved = new Set([...removedLineIds].filter(id => !ids.has(id)));
    setRemovedLineIds(nextRemoved);
    setSelectedLineIds(previous => new Set([...previous].filter(id => !ids.has(id))));
    if (removedDraft) {
      const nextDrafts = { ...draftsRef.current }; delete nextDrafts[removedDraft.vendorName]; draftsRef.current = nextDrafts;
      setDraftsByVendor(previous => Object.fromEntries(Object.entries(previous).filter(([, draft]) => draft.id !== draftId)));
      setManualVendorNames(previous => previous.filter(name => name !== removedDraft.vendorName));
    }
    setDiscardedDraftIds(previous => new Set(previous).add(draftId));
    setDirty(Boolean(nextRemoved.size || nextLines.some(line => vendorRecordChanged(lineBaselines.current.get(line.id), line))));
    setCompletionMessage("선택한 발주서를 삭제했습니다. 원본과 삭제 사유는 이력으로 보관했습니다.");
    notifyQueueChange();
  }

  async function deleteVendorOrder(vendorName: string, vendorLines: VendorOrderDraftLine[]) {
    if (saving || workspaceMoved) return;
    const draft = draftsRef.current[vendorName];
    if (draft?.status === "sent") { setSaveError("전송완료 발주서는 삭제할 수 없습니다. 완료 이력에서 확인해 주세요."); return; }
    const allDraftLines = draft ? linesRef.current.filter(line => line.draftId === draft.id) : vendorLines;
    const blocked = allDraftLines.map(line => getVendorLineDeletionBlockReason(line, draft)).find(Boolean);
    if (blocked) { setSaveError(blocked); return; }
    const itemText = vendorLines.length ? ` 포함 상품 ${vendorLines.length}개도 함께 삭제됩니다.` : "";
    if (!window.confirm(`'${vendorName}' 거래처 발주서를 삭제할까요?${itemText}`)) return;
    setSaving(true); setSaveError(null);
    try {
      await assertCurrentWorkspace();
      if (draft) {
        await vendorOrderRepository.deleteDraft(draft.id, {
          updatedAt: draftBaselines.current.get(draft.id) ?? null,
          lineIds: allDraftLines.filter(line => lineBaselines.current.has(line.id)).map(line => line.id),
        });
        draftBaselines.current.delete(draft.id);
      }
      const ids = new Set(allDraftLines.map(line => line.id));
      for (const id of ids) lineBaselines.current.delete(id);
      const nextLines = linesRef.current.filter(line => !ids.has(line.id) && (line.vendorName || UNASSIGNED_VENDOR_NAME) !== vendorName);
      const nextRemoved = new Set([...removedLineIds].filter(id => !ids.has(id)));
      setLines(nextLines);
      setDraftsByVendor(previous => { const next = { ...previous }; delete next[vendorName]; return next; });
      setManualVendorNames(previous => previous.filter(name => name !== vendorName));
      setSelectedLineIds(previous => new Set([...previous].filter(id => !ids.has(id))));
      setRemovedLineIds(nextRemoved);
      setDirty(Boolean(nextRemoved.size || nextLines.some(line => JSON.stringify(line) !== JSON.stringify(lineBaselines.current.get(line.id)))));
      setCompletionMessage(`${vendorName} 거래처 발주서를 삭제했습니다.`);
      notifyQueueChange();
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "거래처 발주서를 삭제하지 못했습니다.");
    } finally { setSaving(false); }
  }

  function addProductsFromSearch(
    vendorName: string,
    products: { skuId: string; modelName: string; category: string; productName: string; optionLabel: string; imageUrl: string; barcode: string; currentStock: string }[],
    manualListGroup?: string,
    isStockReplenishment = false
  ) {
    if (draftsRef.current[vendorName]?.status === "sent") { setSaveError("전송완료 발주서는 수정할 수 없습니다."); return; }
    const now = new Date().toISOString();
    const targetDraftId = draftIdFor(vendorName);
    const activeSkus = new Set(linesRef.current
      .filter(line => line.draftId === targetDraftId && !excludedLineIds.has(line.id) && !line.orderExclusion)
      .map(line => normalizeSkuId(line.skuId)));
    const added: VendorOrderDraftLine[] = [];
    for (const product of products) {
      const skuId = normalizeSkuId(product.skuId);
      if (!skuId || activeSkus.has(skuId)) continue;
      activeSkus.add(skuId);
      added.push({
        id: params.waveId + "::" + vendorName + "::manual-" + crypto.randomUUID(),
        draftId: draftIdFor(vendorName),
        waveId: params.waveId, vendorName, skuId,
        modelName: product.modelName, category: product.category || "",
        optionLabel: resolveDisplayNameAndOption(product.productName, "", product.optionLabel).option,
        productName: product.productName, imageUrl: product.imageUrl, barcode: product.barcode,
        actualShortageQuantity: 0, shortageQuantity: toVendorOrderQuantity(1, [product.category, product.modelName, product.productName].join(" ")), currentStock: product.currentStock,
        relatedPurchaseOrderNumbers: [], memo: "", isManuallyAdded: true, isStockReplenishment, manualListGroup, createdAt: now, updatedAt: now,
      });
    }
    if (added.length) {
      const nextLines = [...linesRef.current, ...added];
      linesRef.current = nextLines;
      setLines(nextLines);
      markVendorRevisionLocal(vendorName);
    } else setCompletionMessage("선택한 상품은 이미 발주 초안에 있습니다.");
    setSearchAddVendor(null); setVariantTarget(null);
  }

  function beginVariantAdd(line: VendorOrderDraftLine) {
    if (saving || workspaceMoved) return;
    const vendorName = line.vendorName || UNASSIGNED_VENDOR_NAME;
    setVariantTarget({ skuId: line.skuId, vendorName });
  }

  async function addPendingReorder(source: VendorOrderDraftLine) {
    const pendingQuantity = Math.max(0, source.reorderPendingQuantity || 0);
    if (pendingQuantity <= 0) return;
    const vendorName = source.vendorName || UNASSIGNED_VENDOR_NAME;
    const now = new Date().toISOString();
    const existing = lines.find(line => line.vendorName === vendorName && line.skuId === source.skuId);
    if (existing) {
      updateLine(existing.id, {
        actualShortageQuantity: (existing.actualShortageQuantity || 0) + pendingQuantity,
        shortageQuantity: toVendorOrderQuantity((existing.actualShortageQuantity || existing.shortageQuantity) + pendingQuantity, [existing.category, existing.modelName, existing.productName].join(" ")),
        memo: [existing.memo, `미입고 재발주 ${pendingQuantity}개`].filter(Boolean).join(" · "),
      });
    } else {
      setLines(prev => [...prev, {
        ...source,
        id: `${params.waveId}::${vendorName}::reorder-${Date.now()}`,
        draftId: draftIdFor(vendorName),
        waveId: params.waveId,
        actualShortageQuantity: pendingQuantity,
        shortageQuantity: toVendorOrderQuantity(pendingQuantity, [source.category, source.modelName, source.productName].join(" ")),
        receivedQuantity: 0,
        reorderPendingQuantity: undefined,
        reorderRequestedAt: undefined,
        relatedPurchaseOrderNumbers: source.relatedPurchaseOrderNumbers,
        memo: `미입고 재발주 ${pendingQuantity}개`,
        isManuallyAdded: true,
        createdAt: now,
        updatedAt: now,
      }]);
      setDirty(true);
    }
    await vendorOrderRepository.saveLine({ ...source, reorderPendingQuantity: 0, reorderRequestedAt: undefined, updatedAt: now });
    setPendingReorderLines(prev => prev.filter(line => line.id !== source.id));
  }

  async function createManualVendorOrder(requestedName?: string) {
    if (saving || statusSavingVendor || saveInFlight.current || historyView) return;
    const name = (requestedName || newVendorNameInput).trim();
    if (!name) {
      setSaveError("수동 발주서를 만들 거래처명을 입력해 주세요.");
      return;
    }
    const existing = draftsRef.current[name];
    if (!existing || existing.status === "sent") {
      setSaving(true); setSaveError(null);
      try {
        const latest = await requestVendorJson("/api/wms/picking-waves", { cache: "no-store" });
        if (!latest.response.ok || !latest.data.ok || !latest.data.snapshot) throw new Error(latest.data.error || "발주 목록을 확인하지 못했습니다.");
        const plan = planNewVendorDraft(latest.data.snapshot, params.waveId, name, crypto.randomUUID(), new Date().toISOString());
        const saved = await requestVendorJson("/api/wms/picking-waves", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(plan.mutation) }, 45000);
        if (!saved.response.ok || !saved.data.ok) throw new Error(saved.data.error || "새 발주서를 만들지 못했습니다.");
        const archived = new Set(plan.archivedDraftIds);
        setLines(previous => previous.filter(line => !archived.has(line.draftId)));
        for (const [id, line] of lineBaselines.current) if (archived.has(line.draftId)) lineBaselines.current.delete(id);
        for (const id of archived) draftBaselines.current.delete(id);
        draftBaselines.current.set(plan.draft.id, plan.draft.updatedAt);
        draftBaselineRecords.current = draftBaselineRecords.current.filter(d => d.vendorName !== name).concat(plan.draft);
        draftsRef.current = { ...draftsRef.current, [name]: plan.draft };
        setDraftsByVendor(previous => ({ ...previous, [name]: plan.draft }));
        notifyQueueChange();
      } catch (error) { setSaveError(error instanceof Error ? error.message : "새 발주서를 만들지 못했습니다."); return; }
      finally { setSaving(false); }
    }
    // 새 초안을 위에 표시하고 상품 검색을 연다. 전송했던 품목은 가져오지 않는다.
    setManualVendorNames(prev => [name, ...prev.filter(value => value !== name)]);
    setNewVendorNameInput("");
    setAddingManualVendor(false);
    setSaveError(null);
    setCompletionMessage(`${name} 발주서에 넣을 상품을 검색해 선택해 주세요.`);
    setSearchAddVendor(name);
  }

  function stepQuantity(line: VendorOrderDraftLine, delta: number) {
    updateLine(line.id, { shortageQuantity: Math.max(0, line.shortageQuantity + delta) });
  }

  /** 라인들을 저장(임시저장)한다 — draftId를 현재 vendorName 기준으로 다시 맞추고, 삭제된 라인을 반영한다. */
  async function persistAll(overrideStatus?: { vendorName: string; status: VendorOrderDraftStatus }, sourceLines?: VendorOrderDraftLine[], onlyVendor?: string) {
    if (saving || saveInFlight.current || workspaceMoved || historyView) return false;
    const targetVendor = overrideStatus?.vendorName || onlyVendor;
    const vendorNames = new Set<string>();
    const localLines = sourceLines || linesRef.current;
    if (targetVendor) vendorNames.add(targetVendor);
    else {
      for (const line of localLines) if (vendorRecordChanged(lineBaselines.current.get(line.id), line)) vendorNames.add(line.vendorName || UNASSIGNED_VENDOR_NAME);
      for (const id of removedLineIds) { const line = lineBaselines.current.get(id); if (line) vendorNames.add(line.vendorName || UNASSIGNED_VENDOR_NAME); }
      for (const draft of Object.values(draftsRef.current)) if (vendorRecordChanged(draftBaselineRecords.current.find(row => row.id === draft.id), draft)) vendorNames.add(draft.vendorName);
    }
    if (!vendorNames.size) return true;
    if (conflictsRef.current.some(conflict => vendorNames.has(conflict.vendorName))) { setSaveError("다른 기기와 겹친 변경사항을 먼저 확인해 주세요."); return false; }
    saveInFlight.current = true;
    if (targetVendor) setStatusSavingVendor(targetVendor); else setSaving(true);
    setSaveError(null);
    const baselineTimes = [...lineBaselines.current.values()].filter(line => vendorNames.has(line.vendorName)).map(line => Date.parse(line.updatedAt) + 1);
    const draftTimes = draftBaselineRecords.current.filter(draft => vendorNames.has(draft.vendorName)).map(draft => Date.parse(draft.updatedAt) + 1);
    const now = new Date(Math.max(Date.now(), ...baselineTimes.filter(Number.isFinite), ...draftTimes.filter(Number.isFinite))).toISOString();
    try {

    const activeLines = await checkCompletion(localLines.filter(line => vendorNames.has(line.vendorName || UNASSIGNED_VENDOR_NAME)), true);
    if (overrideStatus?.status === "sent" && !activeLines.some(line => (line.vendorName || UNASSIGNED_VENDOR_NAME) === overrideStatus.vendorName)) throw new Error("모든 품목이 처리되어 전송완료로 표시할 발주가 없습니다.");

    const removedLineIdsToSave = [...removedLineIds].filter(id => vendorNames.has(lineBaselines.current.get(id)?.vendorName || ""));

    const nextDraftsByVendor = { ...draftsRef.current };
    for (const vendorName of vendorNames) {
      const existing = nextDraftsByVendor[vendorName];
      const isOverride = overrideStatus?.vendorName === vendorName;
      const draft: VendorOrderDraft = existing
        ? {
            ...existing,
            status: isOverride ? overrideStatus!.status : existing.status,
            updatedAt: now,
            approvedAt: isOverride && overrideStatus!.status === "approved" ? now : existing.approvedAt,
            sentAt: isOverride ? (overrideStatus!.status === "sent" ? now : undefined) : existing.sentAt,
            statusBeforeSent: isOverride && overrideStatus!.status === "sent" && existing.status !== "sent" ? existing.status : existing.statusBeforeSent,
          }
        : {
            id: draftIdFor(vendorName),
            waveId: params.waveId,
            vendorName,
            status: isOverride ? overrideStatus!.status : "draft",
            createdAt: now,
            updatedAt: now,
            approvedAt: isOverride && overrideStatus!.status === "approved" ? now : undefined,
            sentAt: isOverride && overrideStatus!.status === "sent" ? now : undefined,
            statusBeforeSent: isOverride && overrideStatus!.status === "sent" ? "draft" : undefined,
          };
      nextDraftsByVendor[vendorName] = draft;
    }

    const linesToSave = activeLines.map(line => ({
      ...line,
      updatedAt: now,
      vendorName: line.vendorName || UNASSIGNED_VENDOR_NAME,
      draftId: nextDraftsByVendor[line.vendorName || UNASSIGNED_VENDOR_NAME]?.id || draftIdFor(line.vendorName || UNASSIGNED_VENDOR_NAME),
    }));
    const draftsToSave = [...vendorNames].map(vendorName => nextDraftsByVendor[vendorName]);
    const expectedUpdatedAtByLineId = Object.fromEntries([
      ...linesToSave.map(line => [line.id, lineBaselines.current.get(line.id)?.updatedAt ?? null] as const),
      ...removedLineIdsToSave.map(id => [id, lineBaselines.current.get(id)!.updatedAt] as const),
    ]);
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 45_000);
    let response: Response;
    let data;
    try {
      response = await fetch("/api/wms/picking-waves", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "saveVendorWorkspace",
          operationId: crypto.randomUUID(),
          waveId: params.waveId,
          lines: linesToSave,
          drafts: draftsToSave,
          removedLineIds: removedLineIdsToSave,
          expectedUpdatedAtByLineId,
          expectedUpdatedAtByDraftId: Object.fromEntries(draftsToSave.map(draft => [draft.id, draftBaselines.current.get(draft.id) ?? null])),
          expectedLineIdsByDraftId: Object.fromEntries(draftsToSave.map(draft => [draft.id, linesToSave.filter(line => line.draftId === draft.id && line.shortageQuantity > 0).map(line => line.id)])),
          now,
        }),
        signal: controller.signal,
      });
      data = await response.json();
    } finally {
      window.clearTimeout(timeout);
    }
    if (!response.ok || !data.ok) throw new Error(data.error || "발주서 저장에 실패했습니다. 입력한 내용은 그대로 유지됩니다.");
    for (const draft of draftsToSave) draftBaselines.current.set(draft.id, draft.updatedAt);
    setDraftsByVendor(previous => ({ ...previous, ...Object.fromEntries(draftsToSave.map(draft => [draft.vendorName, draft])) }));
    draftBaselineRecords.current = draftBaselineRecords.current.filter(draft => !vendorNames.has(draft.vendorName)).concat(draftsToSave);
    setLines(previous => previous.filter(line => !vendorNames.has(line.vendorName || UNASSIGNED_VENDOR_NAME)).concat(linesToSave));
    for (const [id, line] of lineBaselines.current) if (vendorNames.has(line.vendorName || UNASSIGNED_VENDOR_NAME)) lineBaselines.current.delete(id);
    for (const line of linesToSave) lineBaselines.current.set(line.id, line);
    setRemovedLineIds(previous => new Set([...previous].filter(id => !removedLineIdsToSave.includes(id))));
    setDirty(linesRef.current.some(line => !vendorNames.has(line.vendorName || UNASSIGNED_VENDOR_NAME) && vendorRecordChanged(lineBaselines.current.get(line.id), line)) || [...removedLineIds].some(id => !removedLineIdsToSave.includes(id)));
    notifyQueueChange();
    return true;
    } catch (error) {
      const message = error instanceof DOMException && error.name === "AbortError" ? "저장 응답이 45초 이상 지연되었습니다. 입력 내용은 유지됩니다. 새로고침해 반영 여부를 확인한 뒤 다시 저장해 주세요." : error instanceof Error ? error.message : "공용 저장에 실패했습니다. 입력한 내용은 유지되며 다시 저장할 수 있습니다.";
      setSaveError(message);
      return false;
    } finally { saveInFlight.current = false; setSaving(false); setStatusSavingVendor(null); }
  }

  async function markSent(vendorName: string) {
    setStatusSavingVendor(vendorName);
    try {
      await persistAll({ vendorName, status: "sent" });
    }
    finally { setStatusSavingVendor(null); }
  }

  async function saveReceivingDelay(memo: string) {
    if (!delayTarget) return;
    setDelayError(null);
    const { line, previous } = delayTarget;
    try {
      if (delayTarget.sent) {
        setSentDelaySaving(true);
        const response = await fetch("/api/wms/vendor-orders/delay", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ lineId: line.id, expectedUpdatedAt: line.updatedAt, delayed: !previous?.active, memo }) });
        const data = await response.json();
        if (!response.ok || !data.success || !data.line) throw new Error(data.error || "입고지연 저장에 실패했습니다.");
        handleSentLineSaved(data.line);
        setDelayMessage(previous?.active ? "입고지연 표시를 해제했습니다. 상품은 처리할 때까지 남습니다." : "입고지연으로 저장했습니다. 이 발주서에 남아 나중에 다시 처리할 수 있습니다.");
        setDelayTarget(null);
        return;
      }
      const live = liveCatalogByProductCode.get(line.skuId);
      const summary = await receivingDelays.save({
        skuId: line.skuId, modelSku: live?.modelSku || line.modelName,
        productName: line.productName, optionLabel: resolveDisplayNameAndOption(line.productName, line.optionLabel).option,
        vendorName: line.vendorName, purchaseOrderNumber: line.relatedPurchaseOrderNumbers.join(" / "),
        operator: rawWave?.workerName || "WMS 거래처 발주", delayed: !previous?.active,
        memo, expectedLastActionAt: previous?.lastActionAt || null,
      });
      setDelayMessage(`SKU ${line.skuId} ${summary.active ? "입고지연을 저장했습니다. 다음 출고작업에도 표시됩니다." : "입고지연을 해제했습니다."}`);
      setDelayTarget(null);
    } catch (reason) { setDelayError(reason instanceof Error ? reason.message : "입고지연 저장에 실패했습니다."); }
    finally { setSentDelaySaving(false); }
  }

  if (loading) {
    return (
      <main style={pageStyle}>
        <p style={{ color: wmsColors.muted }}>불러오는 중...</p>
      </main>
    );
  }

  if (!rawWave && !isManualWorkspace && !archivedWorkspace) {
    return (
      <main style={pageStyle}>
        <h1 style={{ fontSize: "18px" }}>거래처별 부족분 발주서</h1>
        <p style={{ color: "#c0392b", fontWeight: 700 }}>웨이브 정보를 찾을 수 없습니다.</p>
      </main>
    );
  }

  // 웨이브 없이 만든 수동 거래처 발주서 화면에서는 실제 PickingWave가 없으므로, 화면 표시에만 쓰는
  // 가상 웨이브 객체로 대신한다(저장소에는 어디에도 쓰지 않음 — 표시 전용 로컬 상수).
  const wave: PickingWave =
    rawWave ?? archivedWorkspace ??
    {
      id: params.waveId,
      status: "completed",
      sourcePurchaseOrderNumbers: [],
      completedGroupIds: [],
      productDbConfigured: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

  return (
    <main style={{ ...pageStyle, paddingBottom: selectedLines.length || dirty ? "170px" : undefined }}>
      {!sharedSnapshot && <h1 style={{ fontSize: "20px", margin: "0 0 16px" }}>{isManualWorkspace ? "수동 거래처 발주서" : "거래처 발주서"}</h1>}

      {receivingDelays.error && <p role="alert" style={{ color: "#b42318", fontSize: "12px" }}>{receivingDelays.error} <button type="button" onClick={() => void receivingDelays.refresh()} style={{ ...wmsGhostButton, minHeight: "36px" }}>지연 이력 다시 확인</button></p>}
      {delayMessage && <p role="status" style={{ color: wmsColors.greenDark, fontSize: "12px" }}>{delayMessage}</p>}
      {workspaceMoved && <p role="alert" style={{ color: "#b42318" }}>이 창은 이전 발주대기입니다. 입력한 내용은 유지했습니다. <a href="/wms/vendor-orders/manage" target="_blank" rel="noreferrer">최신 발주대기 열기</a></p>}
      {completionMessage && <p role="status" style={{ color: wmsColors.greenDark, fontSize: "12px" }}>{completionMessage}</p>}
      {completionError && <p role="alert" style={{ color: "#b42318", fontSize: "12px" }}>{completionError} <button type="button" onClick={() => void checkCompletion().catch(() => {})} style={wmsGhostButton}>처리 상태 다시 확인</button></p>}

      {isPreview && (
        <p style={{ fontSize: "12px", color: wmsColors.warn, background: wmsColors.warnSoft, borderRadius: "8px", padding: "8px 10px", marginBottom: "14px" }}>
          {historyView ? "전송한 발주 이력입니다. 당시 발주 내용을 확인하고 이미지를 받을 수 있습니다." : "이 웨이브는 아직 피킹 진행중입니다 — 지금까지 처리한 SKU 기준 미리보기이며, 저장되지 않습니다."}
          피킹을 완료하면 정식으로 저장·수정할 수 있습니다.
        </p>
      )}

      {!isPreview && (!addingManualVendor ? (
        <button onClick={() => setAddingManualVendor(true)} style={{ ...wmsGhostButton, width: "100%", marginBottom: "14px" }}>
          + 발주서 수동 추가
        </button>
      ) : (
        <form onSubmit={event => { event.preventDefault(); createManualVendorOrder(); }} style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginBottom: "14px", width: "100%" }}>
          <input
            autoFocus
            className="wms-input"
            value={newVendorNameInput}
            onChange={e => setNewVendorNameInput(e.target.value)}
            placeholder="거래처명 입력 (기존 거래처명도 가능)"
            style={{ ...inputStyle, flex: "1 1 140px", minWidth: 0, boxSizing: "border-box", fontSize: "16px", padding: "8px 10px" }}
          />
          <div style={{ display: "flex", gap: "6px", flexShrink: 0 }}>
            <button type="submit" style={{ ...wmsPrimaryButton, minHeight: "36px", fontSize: "12px", flexShrink: 0 }}>
              만들기
            </button>
            <button type="button" onClick={() => setAddingManualVendor(false)} style={{ ...wmsGhostButton, minHeight: "36px", fontSize: "12px", flexShrink: 0 }}>
              취소
            </button>
          </div>
        </form>
      ))}

      {orderEntries.length === 0 ? (
        <p style={{ fontSize: "13px", color: wmsColors.muted, whiteSpace: "pre-line" }}>
          {"현재 자동 생성된 부족분이 없습니다.\n위 [발주서 수동 추가]로 새 거래처 발주서를 만들 수 있습니다."}
        </p>
      ) : (
        <>
        <details style={{ marginBottom: "10px" }}>
          <summary style={{ cursor: "pointer", fontSize: "13px", fontWeight: 700 }}>여러 상품 선택</summary>
          <div style={{ display: "flex", gap: "6px", paddingTop: "8px" }}>
          <button type="button" disabled={saving || isPreview} onClick={() => setSelectedLineIds(new Set(selectableLines.map(line => line.id)))} style={{ ...wmsGhostButton, flex: 1, minHeight: "40px" }}>전체체크</button>
          <button type="button" onClick={() => setSelectedLineIds(new Set())} style={{ ...wmsSecondaryButton, flex: 1, minHeight: "40px" }}>전체해제</button>
          <button type="button" disabled={saving || !selectedLines.length} onClick={removeSelectedLines} style={{ ...wmsWarnButton, flex: 1, minHeight: "40px", opacity: selectedLines.length ? 1 : .5 }}>선택삭제 {selectedLines.length}</button>
          </div>
        </details>
        <div style={{ display: "flex", flexDirection: "column", gap: "16px", marginBottom: "20px" }}>
          {orderEntries.map(entry => {
            const historical = !entry.group;
            const group = entry.group || { vendorName: entry.vendorName, lines: entry.historyLines || [] };
            const status = entry.draft?.status || statusOf(group.vendorName);
            const processingSent = status === "sent" && sentOrderProcessing.has(entry.id) && !saving && !workspaceMoved;
            const editable = !historical && !isPreview && !workspaceMoved && !saving && statusSavingVendor !== group.vendorName && status !== "sent";
            const totalOrderQuantity = group.lines.reduce((sum, l) => sum + l.shortageQuantity, 0);
            const totalActualShortage = group.lines.reduce((sum, l) => sum + (l.actualShortageQuantity ?? l.shortageQuantity), 0);
            const pendingReorders = pendingReorderLines.filter(line => (line.vendorName || UNASSIGNED_VENDOR_NAME) === group.vendorName);
            const sentCollapsed = status === "sent" && !processingSent;
            const pendingClassificationCount = group.lines.filter(line => vendorLineClassification(line) === "pending").length;
            const delayedClassificationCount = group.lines.filter(line => vendorLineClassification(line) === "delayed").length;

            return (
              <div key={entry.id} data-vendor-group={group.vendorName} data-vendor-order-id={entry.id} style={cardStyle}>
                <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "center", gap: "6px", marginBottom: "10px" }}>
                  <h2 style={{ margin: 0, fontSize: "17px", minWidth: 0, overflowWrap: "anywhere" }}>
                    {entry.label}
                    <span style={{ marginLeft: "8px", fontSize: "12px", color: wmsColors.muted, fontWeight: 400 }}>
                      실제부족 {totalActualShortage}개 · 발주 {totalOrderQuantity}개 · {group.lines.length}종
                    </span>
                  </h2>
                  {entry.draft?.sentAt && <span style={{ color: wmsColors.muted, fontSize: "12px" }}>전송 {new Date(entry.draft.sentAt).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}</span>}
                  <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "6px", maxWidth: "100%" }}>
                    <StatusBadge status={status === "approved" ? "draft" : status} />
                    {status !== "sent" && entry.draft && (!isPreview || historyView) && <DeleteVendorOrderButton draft={entry.draft} label={entry.label} disabled={saving || workspaceMoved || Boolean(statusSavingVendor)} onDeleted={handleVendorOrderDeleted} />}
                    {!entry.draft && editable && <button type="button" onClick={() => void deleteVendorOrder(group.vendorName, group.lines)} style={{ ...wmsWarnButton, minHeight: "36px", fontSize: "12px" }}>발주서 삭제</button>}
                  </div>
                </div>
                {status === "sent" && <div style={{ marginBottom: "12px" }}>
                  <button
                    type="button"
                    disabled={saving || workspaceMoved}
                    aria-pressed={processingSent}
                    aria-controls={`vendor-order-${entry.id}`}
                    style={{ ...wmsPrimaryButton, minHeight: "44px", width: "100%" }}
                    onClick={() => {
                      setSentOrderProcessing(previous => { const next = new Set(previous); if (next.has(entry.id)) next.delete(entry.id); else next.add(entry.id); return next; });
                    }}
                  >발주결과처리</button>
                </div>}
                {!sentCollapsed && <div id={`vendor-order-${entry.id}`}>
                {status === "sent" && <p role="status" style={{ fontSize: "12px" }}>미처리 {pendingClassificationCount} · 입고지연 {delayedClassificationCount}</p>}
                {!historical && editConflicts.filter(conflict => conflict.vendorName === group.vendorName).map(conflict => <div key={conflict.key} role="alert" style={{ padding: 12, background: wmsColors.warnSoft, marginBottom: 10 }}>
                  <p>다른 기기에서도 같은 {conflict.field === "__deleted" ? "상품 또는 발주서가 삭제·변경되었습니다" : `항목(${conflict.field})을 변경했습니다`}.</p>
                  {conflict.field !== "__deleted" && <button type="button" onClick={() => resolveEditConflict(conflict, true)} style={wmsSecondaryButton}>내 입력 유지: {String(conflict.local ?? "")}</button>}
                  <button type="button" onClick={() => resolveEditConflict(conflict, false)} style={wmsSecondaryButton}>다른 기기 변경 적용{conflict.field === "__deleted" ? "" : `: ${String(conflict.remote ?? "")}`}</button>
                </div>)}
                <div style={{ fontSize: "11px", color: wmsColors.muted, marginBottom: "8px" }}>
                  발주일 {new Date(entry.draft?.createdAt || Date.now()).toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul" })}
                </div>

                <div style={params.waveId.startsWith(VENDOR_QUEUE_PREFIX) ? { marginBottom: "10px", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 360px), 1fr))", gap: 10 } : { marginBottom: "10px" }}>
                  {group.lines.map(line => (
                    <div key={line.id} style={{ display: "grid", gridTemplateColumns: "30px minmax(0,1fr)", gap: "6px", alignItems: "start" }}>
                    {status !== "sent" || processingSent ? <input type="checkbox" aria-label={`${line.productName} 선택`} checked={selectedLineIds.has(line.id)} disabled={saving || isPreview || workspaceMoved || Boolean(getVendorLineDeletionBlockReason(line, entry.draft, true))} title={getVendorLineDeletionBlockReason(line, entry.draft, true) || "삭제할 상품 선택"} onChange={() => setSelectedLineIds(prev => { const next = new Set(prev); if (next.has(line.id)) next.delete(line.id); else next.add(line.id); return next; })} style={{ width: "24px", height: "24px", marginTop: "12px" }} /> : <div />}
                    <VendorOrderLineCard
                      line={line}
                      orderDate={entry.draft?.createdAt || line.createdAt || wave.createdAt}
                      compact={params.waveId.startsWith(VENDOR_QUEUE_PREFIX)}
                      onReceivingSaved={saved => {
                        if (processingSent) { handleSentLineSaved(saved); return; }
                        const receipt = { isStockReplenishment:saved.isStockReplenishment, receivingCompletedAt:saved.receivingCompletedAt, receivingCompletionToken:saved.receivingCompletionToken, receivedQuantity:saved.receivedQuantity, receivedUnitPrice:saved.receivedUnitPrice, receivedVat:saved.receivedVat, receivedCostVatIncluded:saved.receivedCostVatIncluded, receivedUsedImmediatelyAt:saved.receivedUsedImmediatelyAt, receivedCostAppliedAt:saved.receivedCostAppliedAt, receivingHistory:saved.receivingHistory, updatedAt:saved.updatedAt };
                        setLines(previous => previous.map(item => item.id === saved.id ? {...item,...receipt} : item));
                        const baseline = lineBaselines.current.get(saved.id);
                        if(baseline) lineBaselines.current.set(saved.id,{...baseline,...receipt});
                      }}
                      editable={editable}
                      processingSent={processingSent}
                      onVendorMoved={handleSentLineSaved}
                      receivingReadOnly={(historical || historyView) && !processingSent}
                      deletionAvailable={!isPreview && !workspaceMoved}
                      knownVendorNames={knownVendorNames}
                      productLink={liveCatalogByProductCode.get(normalizeSkuId(line.skuId))?.productLink || ""}
                      delaySummary={status === "sent" ? sentDelay(line) : receivingDelays.summaries.get(normalizeSkuId(line.skuId))}
                      delayDisabled={((historical || historyView) && !processingSent) || (status === "sent" ? sentDelaySaving : receivingDelays.loading || receivingDelays.saving || Boolean(receivingDelays.error)) || saving}
                      onDelay={() => { setDelayError(null); setDelayTarget({ line, sent: status === "sent", previous: status === "sent" ? sentDelay(line) : receivingDelays.summaries.get(normalizeSkuId(line.skuId)) }); }}
                      onChange={patch => updateLine(line.id, patch)}
                      onPhotoWork={active => setPhotoWorkCount(count => Math.max(0, count + (active ? 1 : -1)))}
                      onSavePhoto={url => savePastedPhoto(line.id, url)}
                      onChangeVendor={name => changeVendor(line.id, name)}
                      onStep={delta => stepQuantity(line, delta)}
                      onAddOptions={editable && variantSkuIds.has(normalizeSkuId(line.skuId)) ? () => void beginVariantAdd(line) : undefined}
                      optionsBusy={saving}
                      partialCompletion={partialCompletionSkus.has(line.skuId)}
                      deleteBlockReason={getVendorLineDeletionBlockReason(line, draftsByVendor[group.vendorName], true)}
                      onRemove={() => removeLine(line)}
                      canQueueDiscontinue={editable || processingSent}
                      onQueueDiscontinue={() => processingSent ? queueSentLineForDiscontinue(line) : queueLineForDiscontinue(line)}
                      onQueueReorder={() => queueLineForReorder(line, processingSent)}
                      onCatalogStatusSaved={() => {
                        setExcludedLineIds(previous => new Set(previous).add(line.id));
                        setSelectedLineIds(previous => { const next = new Set(previous); next.delete(line.id); return next; });
                        setCompletionMessage(`과재고 처리된 SKU ${line.skuId}를 이번 발주에서 제외했습니다.`);
                      }}
                    />
                    </div>
                  ))}
                </div>

                {editable && pendingReorders.length > 0 && (
                  <div style={{ background: "#fff3e0", border: `1px solid ${wmsColors.warn}`, borderRadius: "10px", padding: "10px", marginBottom: "10px" }}>
                    <div style={{ fontSize: "12px", fontWeight: 800, color: wmsColors.warn, marginBottom: "6px" }}>이전 발주 미입고 재발주 대기</div>
                    {pendingReorders.map(source => (
                      <div key={source.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px", marginTop: "6px" }}>
                        <span style={{ minWidth: 0, fontSize: "11px" }}>{source.productName} · {source.optionLabel || "옵션 없음"} · 미입고 {source.reorderPendingQuantity}개</span>
                        <button onClick={() => addPendingReorder(source)} style={{ ...wmsPrimaryButton, minHeight: "30px", padding: "0 10px", fontSize: "11px", flexShrink: 0 }}>초안에 추가</button>
                      </div>
                    ))}
                  </div>
                )}

                {editable && (
                  <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                    <button onClick={() => setSearchAddVendor(group.vendorName)} style={{ ...wmsGhostButton, minHeight: "36px", fontSize: "12px" }}>
                      + 상품 검색 추가
                    </button>
                    <button onClick={() => persistAll(undefined, undefined, group.vendorName)} disabled={saving} style={{ ...wmsSecondaryButton, minHeight: "36px", fontSize: "12px" }}>
                      {saving ? "저장 중..." : "임시저장"}
                    </button>
                  </div>
                )}

                {!historical && !historyView && !isPreview && status !== "sent" && (
                  <VendorOrderExportPanel
                    wave={historical && entry.draft ? deriveArchivedVendorOrderWorkspace(entry.draft.waveId, [entry.draft], group.lines) || wave : wave}
                    vendorName={group.vendorName}
                    orderDate={entry.draft?.createdAt || group.lines[0]?.createdAt || wave.createdAt}
                    lines={group.lines}
                    status={status}
                    readOnly={historical || historyView}
                    busy={saving || workspaceMoved || photoWorkCount > 0 || Boolean(statusSavingVendor) || editConflicts.some(conflict => conflict.vendorName === group.vendorName)}
                    statusSaving={statusSavingVendor === group.vendorName}
                    onBeforeExport={async () => { const saved = await persistAll(undefined, undefined, group.vendorName); if (!saved) throw new Error("발주서를 저장하지 못했습니다."); return await checkCompletion(linesRef.current.filter(line => (line.vendorName || UNASSIGNED_VENDOR_NAME) === group.vendorName), true); }}
                    onMarkSent={() => markSent(group.vendorName)}
                  />
                )}
                </div>}
              </div>
            );
          })}
        </div>
        </>
      )}

      {(selectedLines.length > 0 || dirty) && !isPreview && !workspaceMoved && <div role="region" aria-label="선택 상품 작업" style={{ position: "fixed", bottom: "max(12px, env(safe-area-inset-bottom))", left: "50%", transform: "translateX(-50%)", width: "calc(100% - 24px)", maxWidth: "620px", boxSizing: "border-box", zIndex: 90, padding: "10px", borderRadius: "12px", background: "#fff", boxShadow: "0 3px 24px #0003", border: `1px solid ${wmsColors.border}` }}>
        {selectedLines.length > 0 && <div style={{ display: "flex", gap: "8px" }}>
          <button type="button" disabled={saving} onClick={() => setSelectedLineIds(new Set())} style={{ ...wmsSecondaryButton, minHeight: "44px", fontSize: "13px" }}>선택 해제</button>
          <button type="button" disabled={saving} onClick={removeSelectedLines} style={{ ...wmsWarnButton, flex: 1, minHeight: "44px", fontSize: "13px" }}>{saving ? "저장 중..." : `선택한 상품 삭제 (${selectedLines.length})`}</button>
        </div>}
        {dirty && <button type="button" disabled={saving} onClick={() => void persistAll()} style={{ ...wmsPrimaryButton, marginTop: selectedLines.length ? "8px" : 0, width: "100%", minHeight: "44px" }}>{saving ? "저장 중..." : "변경내용 저장"}</button>}
        {saveError && <p role="alert" style={{ margin: "8px 0 0", color: "#b42318", fontSize: "12px" }}>{saveError}</p>}
      </div>}
      {saveError && !(selectedLines.length || dirty) && <p role="alert" style={{ color: "#b42318", fontSize: "12px" }}>{saveError}</p>}
      {dirty && (
        <p style={{ fontSize: "11px", color: wmsColors.warn, marginBottom: "10px" }}>
          저장하지 않은 변경사항이 있습니다 — "임시저장"을 눌러야 반영됩니다.
        </p>
      )}


      {searchAddVendor && (
        <ProductSearchAddSheet
          existingSkuIds={groups.find(group => group.vendorName === searchAddVendor)?.lines.map(line => line.skuId) || []}
          onClose={() => setSearchAddVendor(null)}
          onSelect={(product, isStockReplenishment) => addProductsFromSearch(searchAddVendor, [product], new Date().toISOString() + "::" + crypto.randomUUID(), isStockReplenishment)}
        />
      )}
      {variantTarget && <ProductVariantAddSheet anchorSkuId={variantTarget.skuId} catalogItems={Array.from(liveCatalogByProductCode.values())} existingSkuIds={groups.find(group => group.vendorName === variantTarget.vendorName)?.lines.map(line => line.skuId) || []} onClose={() => setVariantTarget(null)} onSelect={(products: ProductCatalogItem[]) => {
        const anchor = linesRef.current.find(line => normalizeSkuId(line.skuId) === normalizeSkuId(variantTarget.skuId) && line.vendorName === variantTarget.vendorName);
        addProductsFromSearch(variantTarget.vendorName, products, anchor?.manualListGroup, anchor?.isStockReplenishment);
      }} />}
      {delayTarget && <ReceivingDelayDialog line={delayTarget.line} previous={delayTarget.previous} sentOrder={delayTarget.sent} busy={receivingDelays.saving || sentDelaySaving} error={delayError} onClose={() => setDelayTarget(null)} onSave={memo => void saveReceivingDelay(memo)} />}
    </main>
  );
}

/**
 * 거래처 발주서 상품 1건을 보여주는 카드 (2026-08-19 3차 실사용 테스트 반영).
 * 표시 우선순위: 상품 이미지(가장 크게) → 상품명 → 옵션명 → SKU(보조정보) → 수량 → 쿠팡 바코드
 * (참고용, 작게) → 거래처/메모/삭제. 모델명은 표시/입력하지 않는다(제품DB 원본 modelName 값
 * 자체는 삭제하지 않고 화면에서만 숨김). "이미지 미등록" 영역은 눌러서 바로 카메라/사진 보관함으로
 * 등록할 수 있고(기존 ImageEditSheet/Drive 업로드 구조 재사용), 거래처는 자동완성 후보와 함께
 * 직접 입력할 수 있으며 필요하면 제품DB에도 별도로 저장할 수 있다.
 */
function VendorOrderLineCard({
  line,
  orderDate,
  compact = false,
  onReceivingSaved,
  editable,
  processingSent = false,
  onVendorMoved,
  receivingReadOnly = false,
  deletionAvailable = false,
  knownVendorNames,
  productLink,
  delaySummary,
  delayDisabled,
  onDelay,
  onChange,
  onPhotoWork,
  onSavePhoto,
  onChangeVendor,
  onStep,
  onRemove,
  deleteBlockReason,
  partialCompletion,
  onAddOptions,
  optionsBusy,
  canQueueDiscontinue,
  onQueueDiscontinue,
  onQueueReorder,
  onCatalogStatusSaved,
}: {
  line: VendorOrderDraftLine;
  orderDate: string;
  onReceivingSaved: (line: VendorOrderDraftLine) => void;
  editable: boolean;
  processingSent?: boolean;
  onVendorMoved: (line: VendorOrderDraftLine, snapshot: PickingWaveStoreSnapshot) => void;
  receivingReadOnly?: boolean;
  deletionAvailable?: boolean;
  knownVendorNames: string[];
  /** 제품DB "제품링크" 실시간 조회값 — 없으면 "" (임의 URL 생성 금지, 2026-08-19 5차 실사용 테스트 신규) */
  productLink: string;
  delaySummary?: ReceivingDelaySummary;
  delayDisabled: boolean;
  onDelay: () => void;
  onChange: (patch: Partial<VendorOrderDraftLine>) => void;
  compact?: boolean;
  onPhotoWork: (active: boolean) => void;
  onSavePhoto: (url: string) => Promise<void>;
  onChangeVendor: (vendorName: string) => Promise<void>;
  onStep: (delta: number) => void;
  onRemove: () => void;
  deleteBlockReason?: string | null;
  partialCompletion?: boolean;
  onAddOptions?: () => void;
  optionsBusy?: boolean;
  canQueueDiscontinue: boolean;
  onQueueDiscontinue: () => Promise<void>;
  onQueueReorder: () => Promise<void>;
  onCatalogStatusSaved: () => void;
}) {
  const pasteUploading = useRef(false);
  const [imageEditOpen, setImageEditOpen] = useState(false);
  const [pendingImageUrl, setPendingImageUrl] = useState<string | null>(null);
  const [imageSaving, setImageSaving] = useState(false);
  const [imageSaveError, setImageSaveError] = useState<string | null>(null);
  const [imageDragActive, setImageDragActive] = useState(false);
  const [vendorSaving, setVendorSaving] = useState(false);
  const [vendorSaveError, setVendorSaveError] = useState<string | null>(null);
  const [editingVendor, setEditingVendor] = useState(false);
  const [statusSaving, setStatusSaving] = useState<"단종" | "과재고" | "재발주" | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const receiptShortage = line.shipmentReceiptDetails?.reduce((sum, detail) => sum + detail.shortageQuantity, 0);
  const suggestedOrderQuantity = receiptShortage && line.vendorName.trim() && line.vendorName !== UNASSIGNED_VENDOR_NAME
    ? line.vendorName.trim() === "창성" ? receiptShortage : toVendorOrderQuantity(receiptShortage) : undefined;

  /** 거래처명 입력은 로컬 draft로만 관리하고, blur(입력 완료) 시점에만 부모 lines 상태로
   *  올려보낸다 (2026-08-20 신규). 이전에는 onChange마다 곧바로 부모 lines를 갱신했는데, 부모의
   *  거래처별 그룹 목록(groups useMemo)이 vendorName을 그룹 key로 쓰고 있어 글자를 한 자
   *  입력할 때마다 이 카드가 속한 <div key={group.vendorName}>가 통째로 다른 key로 바뀌어
   *  input DOM 자체가 매번 새로 만들어졌다 — 이것이 커서 이동/포커스 풀림/한글 조합 끊김의
   *  근본 원인이었다. draft로만 값을 들고 있으면 입력 중에는 부모가 전혀 리렌더되지 않는다. */
  const [vendorDraft, setVendorDraft] = useState(line.vendorName);
  useEffect(() => {
    setVendorDraft(line.vendorName);
    // line.id가 바뀔 때(카드가 다른 라인을 가리키게 될 때)만 동기화한다 — 같은 카드가 그대로
    // 유지되는 동안은 부모의 line.vendorName 갱신(임시저장 등)이 입력 중인 draft를 덮어쓰지 않는다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [line.id]);

  const { option: displayOption } = resolveDisplayNameAndOption(line.productName, line.optionLabel);


  /** 이미지 업로드는 이미 성공했지만(구글드라이브), 제품DB 시트 쓰기가 실패했을 때 재시도할 수 있게
   *  업로드된 URL만 따로 기억해둔다 — 재시도 시 사진을 다시 고를 필요가 없다. */
  async function pastePhoto(file: File) {
    if (!editable || pasteUploading.current) return;
    pasteUploading.current = true; setImageSaving(true); setImageSaveError(null); onPhotoWork(true);
    try {
      const dataUrl = await resizeProductPhoto(file);
      const response = await fetch("/api/wms/weekly-work/image", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ dataUrl }) });
      const data = await response.json();
      if (!response.ok || !data.success || !data.imageUrl) throw new Error(data.error || "사진 저장 실패");
      // 붙여넣은 사진도 이미지 편집 화면에서 고른 사진과 동일하게 제품DB와 현재 발주 초안에
      // 함께 저장한다. 피킹 화면은 최신 제품DB를 SKU로 다시 읽으므로 이후 웨이브에서도 같은
      // 사진이 자동으로 표시된다.
      await persistImageUrl(data.imageUrl);
    } catch (e) { setImageSaveError(e instanceof Error ? e.message : "사진을 붙여넣지 못했습니다."); }
    finally { pasteUploading.current = false; setImageSaving(false); onPhotoWork(false); }
  }
  async function persistImageUrl(url: string) {
    setImageSaving(true);
    setImageSaveError(null);
    onPhotoWork(true);
    try {
      const response = await fetch("/api/wms/product-catalog/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ skuId: line.skuId, imageUrl: url }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        setImageSaveError(data.error || "제품DB 이미지 저장에 실패했습니다.");
        setPendingImageUrl(url);
        return;
      }
      await onSavePhoto(url);
      setPendingImageUrl(null);
    } catch (error) {
      setImageSaveError(error instanceof Error ? error.message : "제품DB 이미지 저장 중 오류가 발생했습니다.");
      setPendingImageUrl(url);
    } finally {
      setImageSaving(false);
      onPhotoWork(false);
    }
  }

  function handleImageUploaded(url: string) {
    setImageEditOpen(false);
    void persistImageUrl(url);
  }

  async function handleSaveVendorToCatalog() {
    const name = vendorDraft.trim();
    if (!name || name === UNASSIGNED_VENDOR_NAME) return;
    const confirmed = window.confirm(`거래처를 '${line.vendorName}'에서 '${name}'으로 수정하고 제품DB에도 저장할까요?`);
    if (!confirmed) return;
    setVendorSaving(true);
    setVendorSaveError(null);
    try {
      await onChangeVendor(name);
      setEditingVendor(false);
    } catch (error) {
      setVendorSaveError(error instanceof Error ? error.message : "제품DB 거래처 저장 중 오류가 발생했습니다.");
    } finally {
      setVendorSaving(false);
    }
  }

  async function handleSetCatalogStatus(status: "단종" | "과재고") {
    if (status === "단종") {
      if (!window.confirm(`SKU ${line.skuId}를 단종대기에 추가하고 이 발주서에서 제외할까요?`)) return;
      setStatusSaving(status);
      setStatusMessage(null);
      try {
        await onQueueDiscontinue();
        setStatusMessage("단종대기 이동 완료");
      } catch (error) {
        setStatusMessage(error instanceof Error ? error.message : "단종대기 이동 실패");
      } finally { setStatusSaving(null); }
      return;
    }
    if (!window.confirm(`SKU ${line.skuId}의 현재상태를 '${status}'로 저장할까요?`)) return;
    setStatusSaving(status);
    setStatusMessage(null);
    try {
      const response = await fetch("/api/wms/product-catalog/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ skuId: line.skuId, currentStatus: status }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || `${status} 저장 실패`);
      setStatusMessage(`${status} 저장완료`);
      onCatalogStatusSaved();
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : `${status} 저장 실패`);
    } finally {
      setStatusSaving(null);
    }
  }

  return (
    <div data-vendor-sku={line.skuId} tabIndex={editable ? 0 : -1} aria-label={line.skuId + " 상품 사진 붙여넣기"} onClick={event => {
      if (!editable || (event.target as HTMLElement).closest("input, textarea, select, button, a")) return;
      event.currentTarget.focus();
    }} onPaste={event => {
      const file = Array.from(event.clipboardData.files).find(file => file.type.startsWith("image/"));
      if (!editable) return;
      if (file) { event.preventDefault(); void pastePhoto(file); }
      else if (!(event.target as HTMLElement).closest("input, textarea, [contenteditable=true]")) { event.preventDefault(); setImageSaveError("이미지 파일을 복사하거나 끌어 놓아 주세요."); }
    }} onDragEnter={event => { event.preventDefault(); if (editable) setImageDragActive(true); }} onDragOver={event => { event.preventDefault(); event.dataTransfer.dropEffect = editable ? "copy" : "none"; }} onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setImageDragActive(false); }} onDrop={event => {
      event.preventDefault(); setImageDragActive(false);
      if (!editable) return;
      const images = Array.from(event.dataTransfer.files).filter(file => file.type.startsWith("image/"));
      if (images.length > 1) { setImageSaveError("한 상품에는 사진 한 장씩 끌어 놓아 주세요."); return; }
      if (images[0]) void pastePhoto(images[0]); else setImageSaveError("웹 링크 대신 이미지 파일을 끌어 놓거나 복사해 주세요.");
    }} style={{ ...wmsOuterCard, padding: "12px", marginBottom: "10px", height: compact ? "100%" : undefined, boxSizing: "border-box", display: compact ? "flex" : undefined, flexDirection: compact ? "column" : undefined, outline: imageDragActive ? `3px solid ${wmsColors.green}` : undefined, outlineOffset: imageDragActive ? "2px" : undefined }}>
      <VendorOrderCardPreview line={line} vendorName={line.vendorName} orderDate={orderDate} onEditImage={editable ? () => setImageEditOpen(true) : undefined} />
      {editable && <p style={{ margin: "8px 0 0", fontSize: 12, color: wmsColors.muted }}>사진을 끌어 놓거나 클릭 후 Ctrl+V</p>}
      {imageSaving && <p role="status">사진 저장 중…</p>}

      {imageSaveError && (
        <div role="alert" style={{ marginTop: "6px", fontSize: "11px", color: "#c0392b" }}>
          {imageSaveError}
          {pendingImageUrl && (
            <button onClick={() => persistImageUrl(pendingImageUrl)} style={{ ...wmsGhostButton, minHeight: "26px", padding: "0 8px", fontSize: "11px", marginLeft: "6px" }}>
              다시 시도
            </button>
          )}
        </div>
      )}

      {line.isStockReplenishment && <p data-stock-replenishment style={{ margin: "8px 0", padding: "8px", borderRadius: "8px", background: wmsColors.greenSoft, color: wmsColors.greenDark, textAlign: "center", fontSize: "13px", fontWeight: 700 }}>재고보충 · 쿠팡 미납분재발주요청 제외</p>}
      {editable && line.isManuallyAdded && <label style={{ display: "flex", alignItems: "center", gap: "8px", minHeight: "44px", fontSize: "12px" }}>
        <input type="checkbox" aria-label="재고보충" checked={Boolean(line.isStockReplenishment)} onChange={event => onChange({ isStockReplenishment: event.target.checked })} style={{ width: "22px", height: "22px" }} />
        재고보충으로 주문 (여유 재고)
      </label>}

      {/* 8-2: 옵션 입력박스 + 제품링크 — 카드 양쪽 끝에 붙지 않도록 max-width 92% + margin-inline:auto로
       *  카드 중앙 영역에 한 묶음처럼 배치한다. justify-content:space-between 대신 grid
       *  minmax(0,1fr)+auto 컬럼으로 옵션이 남는 공간을 쓰고 링크는 필요한 크기만 차지하며, 둘 다
       *  같은 높이로 수직 가운데 정렬한다(2026-08-20 실기기 추가 확인 4번). 실제 productLink만
       *  쓰고, 임의 URL을 만들지 않는다 — 이 화면의 입력값/수정사항에는 영향이 없다. */}
      <div
        style={{
          marginTop: "8px",
          width: "100%",
          maxWidth: "92%",
          marginInline: "auto",
          display: "grid",
          gridTemplateColumns: "minmax(0,1fr) auto",
          alignItems: "center",
          gap: "12px",
        }}
      >
        {editable ? (
          <input
            className="wms-input"
            value={line.optionLabel || displayOption}
            onChange={e => onChange({ optionLabel: e.target.value })}
            style={{ ...inputStyle, width: "100%", minWidth: 0, height: "34px", fontSize: "14px", fontWeight: 700, color: wmsColors.greenDark, boxSizing: "border-box" }}
          />
        ) : (
          <div style={{ minWidth: 0, height: "34px", display: "flex", alignItems: "center", fontSize: "14px", fontWeight: 700, color: wmsColors.greenDark, whiteSpace: "normal", wordBreak: "keep-all" }}>
            {displayOption || "옵션 없음"}
          </div>
        )}
        {productLink ? (
          <a href={productLink} target="_blank" rel="noopener noreferrer" style={{ textDecoration: "none", flexShrink: 0 }}>
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "5px",
                height: "34px",
                boxSizing: "border-box",
                padding: "0 10px",
                borderRadius: "8px",
                background: wmsColors.sand,
                color: wmsColors.sandText,
                border: `1px solid ${wmsColors.borderStrong}`,
                fontSize: "11px",
                fontWeight: 700,
                whiteSpace: "nowrap",
              }}
            >
              <ExternalLinkIcon size={12} />
              제품링크
            </span>
          </a>
        ) : null}
      </div>

      <div style={{ marginTop: "14px", display: editable ? "block" : "none" }}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "6px" }}>
          <div style={{ fontSize: "11px", color: wmsColors.muted, textAlign: "center" }}>주문수량</div>
          {editable ? (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "6px" }}>
              <button onClick={() => onStep(-1)} style={stepperButtonStyle}>
                −
              </button>
              <input
                className="wms-input"
                type="number"
                min={0}
                value={line.shortageQuantity}
                onChange={e => onChange({ shortageQuantity: Math.max(0, Number(e.target.value) || 0) })}
                style={{ ...inputStyle, width: "48px", textAlign: "center", fontSize: "16px", fontWeight: 800 }}
              />
              <button onClick={() => onStep(1)} style={stepperButtonStyle}>
                +
              </button>
            </div>
          ) : (
            <strong style={{ fontSize: "18px" }}>{line.shortageQuantity}개</strong>
          )}
          <div style={{ fontSize: "11px", color: wmsColors.warn, fontWeight: 700 }}>실제 부족수량 {line.actualShortageQuantity ?? line.shortageQuantity}개</div>
          {editable && suggestedOrderQuantity !== undefined && <div style={{ fontSize: "12px", textAlign: "center", lineHeight: 1.6 }}>
            {line.vendorName.trim() === "창성" ? "창성 · 미납수량 그대로" : "12개 단위 발주"} · 권장 {suggestedOrderQuantity}개
            {line.shortageQuantity !== suggestedOrderQuantity && <button type="button" style={{ ...wmsGhostButton, display: "block", margin: "6px auto 0", minHeight: 36 }} onClick={() => onChange({ shortageQuantity: suggestedOrderQuantity })}>권장 수량 적용</button>}
          </div>}
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: "8px", marginTop: "12px" }}>
        {delaySummary?.active && <span style={{ color: "#a33b2e", fontSize: "12px", fontWeight: 800 }}>입고지연 · {receivingDelayDate(delaySummary.recentDelayedAt)}</span>}
      </div>
      {delaySummary?.active && delaySummary.memo && <p style={{ margin: "6px 0 0", fontSize: "12px", color: wmsColors.muted, overflowWrap: "anywhere" }}>{delaySummary.memo}</p>}
      {processingSent && <div aria-label="상품 결과처리" style={{display:"grid",gridTemplateColumns:"repeat(3, minmax(0, 1fr))",gridAutoRows:"minmax(48px, 1fr)",gap:12,marginTop:12}}>
        <SentReorderButton line={line} onSaved={onReceivingSaved} disabled={line.isStockReplenishment} style={{height:"100%"}} />
        <button type="button" onClick={() => handleSetCatalogStatus("단종")} disabled={Boolean(statusSaving)} style={{...wmsWarnButton,width:"100%",height:"100%",minHeight:48,fontSize:13}}>{statusSaving === "단종" ? "단종으로 이동 중..." : "단종으로 이동"}</button>
        <SentVendorChangeButton line={line} options={knownVendorNames} onMoved={onVendorMoved} style={{height:"100%"}} />
        <CompleteReceivingButton line={line} stockOnly onSaved={onReceivingSaved} style={{height:"100%"}} />
        <button type="button" disabled={delayDisabled} onClick={onDelay} style={{...wmsSecondaryButton,width:"100%",height:"100%",minHeight:48,fontSize:13}}>{delaySummary?.active ? "입고지연 해제" : "입고지연"}</button>
        {deletionAvailable && <button type="button" onClick={onRemove} disabled={Boolean(deleteBlockReason) || optionsBusy} style={{...wmsWarnButton,width:"100%",height:"100%",minHeight:48,fontSize:13,opacity:deleteBlockReason ? .5 : 1}}>삭제</button>}
      </div>}
      {processingSent && statusMessage && <p role="status" style={{fontSize:12,color:wmsColors.warn}}>{statusMessage}</p>}
      {processingSent && deletionAvailable && deleteBlockReason && <p style={{fontSize:12,color:wmsColors.muted}}>{deleteBlockReason}</p>}

      {partialCompletion && <p style={{ color: wmsColors.warn, fontSize: "12px" }}>일부 미납분은 미납분재발주요청이 완료됐습니다. 남은 발주가 있어 상품을 유지했으니 실제 부족수량을 확인해 주세요.</p>}
      <div data-vendor-option-slot style={{ height: processingSent ? 0 : "44px", marginTop: processingSent ? 0 : "10px" }}>
        {onAddOptions && <button type="button" disabled={optionsBusy} onClick={onAddOptions} style={{ ...wmsSecondaryButton, width: "100%", height: "44px", fontSize: "13px" }}>+ 옵션 추가</button>}
      </div>
      {editable && (
        <div style={{ marginTop: "14px", display: "flex", flexDirection: "column", gap: "6px", paddingTop: "10px", borderTop: `1px dashed ${wmsColors.border}` }}>
          {!editingVendor ? (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px" }}>
              <span style={{ fontSize: "12px", fontWeight: 800 }}>거래처: {line.vendorName || UNASSIGNED_VENDOR_NAME}</span>
              <button type="button" onClick={() => { setVendorDraft(line.vendorName); setEditingVendor(true); setVendorSaveError(null); }} style={{ ...wmsGhostButton, minHeight: "34px", padding: "0 10px", fontSize: "11px" }}>거래처 수정</button>
            </div>
          ) : <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
            <VendorNameSelect value={vendorDraft} onChange={setVendorDraft} options={knownVendorNames} disabled={vendorSaving} />
            <button
              onClick={handleSaveVendorToCatalog}
              disabled={vendorSaving || !vendorDraft.trim() || vendorDraft.trim() === UNASSIGNED_VENDOR_NAME}
              style={{ ...wmsGhostButton, minHeight: "32px", padding: "0 8px", fontSize: "10px", flexShrink: 0, opacity: vendorSaving ? 0.6 : 1 }}
            >
              {vendorSaving ? "저장 중" : "수정 저장"}
            </button>
            <button type="button" onClick={() => { setVendorDraft(line.vendorName); setEditingVendor(false); }} style={{ ...wmsSecondaryButton, minHeight: "32px", padding: "0 8px", fontSize: "10px" }}>취소</button>
          </div>}
          {vendorSaveError && <p style={{ fontSize: "10px", color: "#c0392b", margin: 0 }}>{vendorSaveError}</p>}
          <input className="wms-input" value={displayVendorOrderMemo(line.memo)} placeholder="메모" onChange={e => onChange({ memo: e.target.value })} style={inputStyle} />
          {statusMessage && <div style={{ fontSize: "10px", color: statusMessage.includes("완료") ? wmsColors.greenDark : "#c0392b" }}>{statusMessage}</div>}
        </div>
      )}

      {!editable && !processingSent && canQueueDiscontinue && (
        <div style={{ marginTop: "10px" }}>
          {!line.isStockReplenishment && <SentReorderButton line={line} onSaved={onReceivingSaved} />}
          <button type="button" onClick={() => handleSetCatalogStatus("단종")} disabled={Boolean(statusSaving)} style={{ ...wmsWarnButton, width: "100%", minHeight: "40px", fontSize: "12px" }}>
            {statusSaving === "단종" ? "단종대기로 이동 중..." : "단종대기로 이동"}
          </button>
          {statusMessage && <div style={{ marginTop: "6px", fontSize: "10px", color: statusMessage.includes("완료") ? wmsColors.greenDark : "#c0392b" }}>{statusMessage}</div>}
        </div>
      )}

      {deletionAvailable && !processingSent && <div style={{ marginTop: 12 }}>
        <button type="button" onClick={onRemove} disabled={Boolean(deleteBlockReason) || optionsBusy} style={{ ...wmsWarnButton, width: "100%", minHeight: 44, fontSize: 13, opacity: deleteBlockReason ? .5 : 1 }}>상품 삭제</button>
        {deleteBlockReason && <p style={{ fontSize: 12, color: wmsColors.muted }}>{deleteBlockReason}</p>}
      </div>}
      {imageEditOpen && (
        <ImageEditSheet skuId={line.skuId} currentImageUrl={line.imageUrl} onClose={() => setImageEditOpen(false)} onSaved={handleImageUploaded} />
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: VendorOrderDraftStatus }) {
  const colorMap: Record<VendorOrderDraftStatus, { bg: string; text: string }> = {
    draft: { bg: wmsColors.surfaceBeige, text: wmsColors.muted },
    review: { bg: "#fff3e0", text: "#a6614e" },
    approved: { bg: wmsColors.greenSoft, text: wmsColors.greenDark },
    sent: { bg: wmsColors.green, text: "#ffffff" },
    resend_needed: { bg: wmsColors.warnSoft, text: wmsColors.warn },
  };
  const color = colorMap[status];
  return (
    <span style={{ fontSize: "11px", fontWeight: 700, padding: "3px 10px", borderRadius: "999px", background: color.bg, color: color.text }}>
      {VENDOR_ORDER_STATUS_LABEL[status]}
    </span>
  );
}

const pageStyle: CSSProperties = {
  maxWidth: WMS_MOBILE_WIDTH,
  margin: "0 auto",
  padding: "12px 12px calc(12px + env(safe-area-inset-bottom))",
  fontFamily: "sans-serif",
  background: wmsColors.background,
  color: wmsColors.ink,
  minHeight: "100vh",
};

const cardStyle: CSSProperties = {
  ...wmsOuterCard,
  padding: "14px",
};

const inputStyle: CSSProperties = {
  width: "100%",
  minWidth: "60px",
  fontSize: "12px",
  padding: "4px 6px",
  borderRadius: "6px",
  border: `1px solid ${wmsColors.border}`,
};

const stepperButtonStyle: CSSProperties = {
  width: "24px",
  height: "24px",
  flexShrink: 0,
  borderRadius: "6px",
  border: `1px solid ${wmsColors.borderStrong}`,
  background: "#ffffff",
  fontSize: "14px",
  fontWeight: 700,
  cursor: "pointer",
  lineHeight: 1,
};
