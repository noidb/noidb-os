"use client";
import SimpleReceiving from "@/app/wms/vendor-orders/SimpleReceiving";
import { resizeProductPhoto } from "@/app/wms/inbound/weekly-client";
import { VENDOR_QUEUE_PREFIX } from "@/lib/wms/vendor-order/consolidate";
import { VendorQueueEditingContext } from "@/lib/wms/vendor-order/queue-editing-context";
import { mergeVendorImageResult } from "@/lib/wms/vendor-order/image-edit";
import { getVendorLineDeletionBlockReason } from "@/lib/wms/vendor-order/delete-lines";
import VendorNameSelect from "./VendorNameSelect";
import ProductVariantAddSheet from "./ProductVariantAddSheet";
import type { ProductCatalogItem } from "@/lib/wms/product-catalog";
import { resolveVendorOrderCatalog } from "@/lib/wms/vendor-order/resolve-catalog";

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
import { WMS_MOBILE_WIDTH, wmsColors, wmsPrimaryButton, wmsSecondaryButton, wmsGhostButton, wmsSlateDarkButton, wmsWarnButton, wmsOuterCard } from "@/lib/wms/ui-tokens";
import { resolveDisplayNameAndOption } from "@/lib/wms/display-name";
import { getWmsDisplayImageUrl } from "@/lib/wms/image-display-url";
import { deriveArchivedVendorOrderWorkspace } from "@/lib/wms/vendor-order/derive-drafts";
import { useReceivingDelays } from "@/lib/wms/vendor-order/use-receiving-delays";
import { receivingDelayDate, type ReceivingDelaySummary } from "@/lib/wms/vendor-order/receiving-delay";
import { normalizeSkuId } from "@/lib/wms/sku-normalize";
import ReceivingDelayDialog from "./ReceivingDelayDialog";
import { prepareVendorReassignment } from "@/lib/wms/vendor-order/reassign-vendor";
import Barcode from "./Barcode";
import VendorOrderExportPanel from "./ExportPanel";
import ProductSearchAddSheet from "./ProductSearchAddSheet";
import WmsExitNav from "../../WmsExitNav";
import ImageEditSheet from "../ImageEditSheet";
import { CameraIcon, ExternalLinkIcon } from "../../../../icons";

/**
 * 거래처별 부족분 발주서(초안) 화면. 완료된 통합 피킹(웨이브)의 부족 수량을 제품DB "거래처" 기준으로
 * 자동 그룹핑해 보여주고, 수량 수정·행 삭제·새 상품 추가·거래처 변경·메모 입력·임시저장·승인을
 * 지원한다. 이 화면은 자동으로 아무것도 발송하지 않는다 — 승인은 항상 사용자가 직접 누른다.
 */
export default function VendorOrdersPage({ params }: { params: { waveId: string } }) {
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
  const allocatedDraftIds = useRef(new Map<string, string>());
  const [deletedDraftIds, setDeletedDraftIds] = useState<Record<string, string>>({});
  const vendorMoving = useRef(false);
  const [saving, setSaving] = useState(false);
  const [photoWorkCount, setPhotoWorkCount] = useState(0);
  const reportQueueEditing = useContext(VendorQueueEditingContext);
  useEffect(() => { reportQueueEditing?.(dirty || saving || photoWorkCount > 0 || loading); return () => reportQueueEditing?.(false); }, [dirty, saving, photoWorkCount, loading, reportQueueEditing]);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [searchAddVendor, setSearchAddVendor] = useState<string | null>(null);
  const [variantTarget, setVariantTarget] = useState<{ skuId: string; vendorName: string } | null>(null);
  const [manualVendorNames, setManualVendorNames] = useState<string[]>([]);
  const [isPreview, setIsPreview] = useState(false);
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
  const linesRef = useRef(lines);
  linesRef.current = lines;
  const draftsRef = useRef(draftsByVendor);
  draftsRef.current = draftsByVendor;
  const completionRequest = useRef(0);
  const deletingLines = useRef(false);
  const receivingDelays = useReceivingDelays();
  const [delayTarget, setDelayTarget] = useState<{ line: VendorOrderDraftLine; previous?: ReceivingDelaySummary } | null>(null);
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

  async function assertCurrentWorkspace() {
    if (!params.waveId.startsWith(VENDOR_QUEUE_PREFIX)) return;
    const response = await fetch("/api/wms/vendor-orders/queue", { cache: "no-store" });
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
      await assertCurrentWorkspace();
      const response = await fetch("/api/wms/vendor-orders/completion", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ waveId: params.waveId, lines: candidates, expectedDraftUpdatedAtById: Object.fromEntries(draftBaselines.current), expectedUpdatedAtByLineId: Object.fromEntries(candidates.filter(line => lineBaselines.current.has(line.id)).map(line => [line.id, lineBaselines.current.get(line.id)!.updatedAt])) }), cache: "no-store", signal: controller.signal });
      const data = await response.json();
      if (!response.ok || !data.success || !Array.isArray(data.excludedLineIds)) throw new Error(data.error || "단종·재발주 처리 상태를 확인하지 못했습니다. 다시 확인해 주세요.");
      const excluded = new Set<string>(data.excludedLineIds);
      const active = candidates.filter(line => !excluded.has(line.id) && !line.orderExclusion);
      if (request === completionRequest.current) {
        setExcludedLineIds(excluded);
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
    if (loading) return;
    const refresh = () => { if (document.visibilityState === "visible") { void checkCompletion().catch(() => {}); void refreshLiveCatalog(); } };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    const timer = window.setInterval(refresh, 60000);
    return () => { window.removeEventListener("focus", refresh); document.removeEventListener("visibilitychange", refresh); window.clearInterval(timer); };
    // Current editable lines are read through linesRef, so refreshing never replaces unsaved fields.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, params.waveId]);

  useEffect(() => {
    (async () => {
      try {
        const [loadedWave, waveItems, existingDrafts, existingLines, allVendorLines] = await Promise.all([
          isManualWorkspace ? Promise.resolve(null) : waveRepository.getWave(params.waveId),
          isManualWorkspace ? Promise.resolve([]) : waveRepository.listItems(params.waveId),
          vendorOrderRepository.listDrafts(params.waveId),
          vendorOrderRepository.listLines(params.waveId),
          vendorOrderRepository.listAllLines(),
        ]);
        setPendingReorderLines(allVendorLines.filter(line => (line.reorderPendingQuantity || 0) > 0));
        setWave(loadedWave);
        lineBaselines.current = new Map(existingLines.map(line => [line.id, line]));
        setDraftsByVendor(Object.fromEntries(existingDrafts.map(draft => [draft.vendorName, draft])));

        const queueResponse = await fetch("/api/wms/vendor-orders/queue", { cache: "no-store" });
        const queueData = await queueResponse.json();
        if (!queueResponse.ok || !queueData.success) throw new Error(queueData.error || "취합된 발주 확인에 실패했습니다.");
        setDeletedDraftIds(queueData.deletedDraftIds || {});
        draftBaselines.current = new Map(existingDrafts.filter(draft => queueData.draftUpdatedAtById ? Object.hasOwn(queueData.draftUpdatedAtById, draft.id) : true).map(draft => [draft.id, queueData.draftUpdatedAtById?.[draft.id] || draft.updatedAt]));
        if (params.waveId.startsWith(VENDOR_QUEUE_PREFIX) && queueData.queueId && queueData.queueId !== params.waveId && existingDrafts.some(draft => draft.status !== "sent")) {
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
          // Opening a page is read-only. Preserve already approved/sent rows and only propose
          // changes for editable drafts; a user save is the persistence boundary.
          const lockedDraftIds = new Set(existingDrafts.filter(draft => draft.status === "approved" || draft.status === "sent").map(draft => draft.id));
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
    if (loading || !liveCatalogByProductCode.size) return;
    const prepared = resolveVendorOrderCatalog({ lines: linesRef.current, drafts: Object.values(draftsRef.current), catalogItems: liveCatalogByProductCode.values(), deletedDraftIds, now: new Date().toISOString() });
    if (!prepared.changes.length) return;
    setLines(prepared.lines);
    setDraftsByVendor(Object.fromEntries(prepared.drafts.map(draft => [draft.vendorName, draft])));
    setDirty(true);
  }, [loading, liveCatalogByProductCode, draftsByVendor, deletedDraftIds]);

  const groups = useMemo(() => {
    const map = new Map<string, VendorOrderDraftLine[]>();
    for (const line of lines) {
      if (excludedLineIds.has(line.id) || line.orderExclusion) continue;
      const vendor = line.vendorName || UNASSIGNED_VENDOR_NAME;
      const list = map.get(vendor) || [];
      list.push(line);
      map.set(vendor, list);
    }
    // 상품 없이 "발주서 수동 추가"로 막 만든 거래처도 빈 그룹으로 보여준다 (2026-08-19 신규).
    for (const vendorName of [...manualVendorNames, ...pendingReorderLines.map(line => line.vendorName || UNASSIGNED_VENDOR_NAME)]) {
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
      .sort((a, b) => (a.vendorName === UNASSIGNED_VENDOR_NAME ? 1 : b.vendorName === UNASSIGNED_VENDOR_NAME ? -1 : a.vendorName.localeCompare(b.vendorName)));
  }, [lines, manualVendorNames, pendingReorderLines, excludedLineIds]);

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
    const line = lines.find(candidate => candidate.id === lineId);
    if (!line) throw new Error("이동할 발주 품목을 찾지 못했습니다.");
    vendorMoving.current = true; setSaving(true); setSaveError(null);
    let catalogSaved = false;
    try {
      await assertCurrentWorkspace();
      const [latestLines, latestDrafts] = await Promise.all([vendorOrderRepository.listLines(params.waveId), vendorOrderRepository.listDrafts(params.waveId)]);
      const plan = prepareVendorReassignment({ line, vendorName, baseline: lineBaselines.current.get(lineId), latestLines, latestDrafts, now: new Date().toISOString() });
      const response = await fetch("/api/wms/product-catalog/update", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ skuId: line.skuId, vendorName: plan.line.vendorName }) });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || "제품DB 거래처 저장에 실패했습니다.");
      catalogSaved = true;
      if (plan.createDraft) await vendorOrderRepository.saveDraft(plan.draft);
      await vendorOrderRepository.saveLine(plan.line, latestLines.find(item => item.id === lineId)?.updatedAt ?? null);
      lineBaselines.current.set(plan.line.id, plan.line);
      draftBaselines.current.set(plan.draft.id, plan.draft.updatedAt);
      const nextLines = lines.map(candidate => candidate.id === lineId ? plan.line : candidate);
      setLines(nextLines);
      setDraftsByVendor(previous => ({ ...previous, [plan.draft.vendorName]: plan.draft }));
      setLiveCatalogByProductCode(previous => { const next = new Map(previous); for (const [key, value] of next) if (value.skuId === line.skuId) next.set(key, { ...value, vendorName: plan.line.vendorName }); return next; });
      setDirty(Boolean(removedLineIds.size || nextLines.some(candidate => JSON.stringify(candidate) !== JSON.stringify(lineBaselines.current.get(candidate.id)))));
    } catch (reason) {
      throw new Error(`${catalogSaved ? "제품DB 거래처는 저장됐지만 발주 초안 이동은 완료되지 않았습니다. 입력한 수량·메모를 유지했으니 다시 시도해 주세요. " : ""}${reason instanceof Error ? reason.message : "거래처 이동에 실패했습니다."}`);
    } finally { vendorMoving.current = false; setSaving(false); }
  }

  const selectableLines = lines.filter(line => !excludedLineIds.has(line.id) && !line.orderExclusion && !getVendorLineDeletionBlockReason(line, draftsByVendor[line.vendorName || UNASSIGNED_VENDOR_NAME]));
  const selectedLines = selectableLines.filter(line => selectedLineIds.has(line.id));
  useEffect(() => {
    const eligible = new Set(selectableLines.map(line => line.id));
    setSelectedLineIds(previous => { const next = new Set([...previous].filter(id => eligible.has(id))); return next.size === previous.size ? previous : next; });
    // Selection follows current statuses and receiving records without modifying any draft fields.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines, draftsByVendor, excludedLineIds]);

  async function deleteLines(targets: VendorOrderDraftLine[], confirmation: string) {
    if (saving || isPreview || workspaceMoved || deletingLines.current || !targets.length) return;
    const blocked = targets.map(line => getVendorLineDeletionBlockReason(line, draftsByVendor[line.vendorName || UNASSIGNED_VENDOR_NAME])).find(Boolean);
    if (blocked) { setSaveError(blocked); return; }
    if (!window.confirm(confirmation)) return;
    deletingLines.current = true; setSaving(true); setSaveError(null);
    try {
      await assertCurrentWorkspace();
      const saved = targets.filter(line => lineBaselines.current.has(line.id));
      if (saved.length) {
        const response = await fetch("/api/wms/picking-waves", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "deleteVendorLines", waveId: params.waveId, lineIds: saved.map(line => line.id), expectedUpdatedAtByLineId: Object.fromEntries(saved.map(line => [line.id, lineBaselines.current.get(line.id)!.updatedAt])), deletedAt: new Date().toISOString() }) });
        const data = await response.json();
        if (!response.ok || !data.ok) throw new Error(data.error || "선택한 상품을 삭제하지 못했습니다. 목록을 유지했으니 다시 시도해 주세요.");
      }
      const deleted = new Set(targets.map(line => line.id));
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

  function beginVendorRevision(vendorName: string) {
    const now = new Date().toISOString();
    setDraftsByVendor(previous => {
      const current = previous[vendorName];
      if (!current || current.status === "resend_needed") return previous;
      return { ...previous, [vendorName]: { ...current, status: "resend_needed", updatedAt: now } };
    });
    setDirty(true);
  }

  function addProductsFromSearch(
    vendorName: string,
    products: { skuId: string; modelName: string; category: string; productName: string; optionLabel: string; imageUrl: string; barcode: string; currentStock: string }[],
    manualListGroup?: string
  ) {
    const now = new Date().toISOString();
    const activeSkus = new Set(linesRef.current.filter(line => !excludedLineIds.has(line.id) && !line.orderExclusion).map(line => normalizeSkuId(line.skuId)));
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
        relatedPurchaseOrderNumbers: [], memo: "", isManuallyAdded: true, manualListGroup, createdAt: now, updatedAt: now,
      });
    }
    if (added.length) {
      setLines(previous => [...previous, ...added]);
      beginVendorRevision(vendorName);
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

  function createManualVendorOrder() {
    const name = newVendorNameInput.trim();
    if (!name) return;
    setManualVendorNames(prev => (prev.includes(name) ? prev : [...prev, name]));
    setNewVendorNameInput("");
    setAddingManualVendor(false);
  }

  function stepQuantity(line: VendorOrderDraftLine, delta: number) {
    updateLine(line.id, { shortageQuantity: Math.max(0, line.shortageQuantity + delta) });
  }

  /** 라인들을 저장(임시저장)한다 — draftId를 현재 vendorName 기준으로 다시 맞추고, 삭제된 라인을 반영한다. */
  async function persistAll(overrideStatus?: { vendorName: string; status: VendorOrderDraftStatus }, sourceLines?: VendorOrderDraftLine[]) {
    if (saving || workspaceMoved) return false;
    setSaving(true);
    setSaveError(null);
    const now = new Date().toISOString();
    try {

    const activeLines = await checkCompletion(sourceLines, true);
    if (overrideStatus?.status === "sent" && !activeLines.some(line => (line.vendorName || UNASSIGNED_VENDOR_NAME) === overrideStatus.vendorName)) throw new Error("모든 품목이 처리되어 전송완료로 표시할 발주가 없습니다.");

    const removedLineIdsToSave = [...removedLineIds].filter(id => lineBaselines.current.has(id));
    const vendorNames = new Set(activeLines.map(line => line.vendorName || UNASSIGNED_VENDOR_NAME));
    if (overrideStatus) vendorNames.add(overrideStatus.vendorName);

    const nextDraftsByVendor = { ...draftsByVendor };
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
    } finally {
      window.clearTimeout(timeout);
    }
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error(data.error || "발주서 저장에 실패했습니다. 입력한 내용은 그대로 유지됩니다.");
    for (const draft of draftsToSave) draftBaselines.current.set(draft.id, draft.updatedAt);
    setDraftsByVendor(nextDraftsByVendor);
    setLines(linesToSave);
    lineBaselines.current = new Map(linesToSave.map(line => [line.id, line]));

    setRemovedLineIds(new Set());
    setDirty(false);
    notifyQueueChange();
    return true;
    } catch (error) {
      const message = error instanceof DOMException && error.name === "AbortError" ? "저장 응답이 45초 이상 지연되었습니다. 입력 내용은 유지됩니다. 새로고침해 반영 여부를 확인한 뒤 다시 저장해 주세요." : error instanceof Error ? error.message : "공용 저장에 실패했습니다. 입력한 내용은 유지되며 다시 저장할 수 있습니다.";
      setSaveError(message);
      return false;
    } finally { setSaving(false); }
  }

  async function handleApprove(vendorName: string) {
    await persistAll({ vendorName, status: "approved" });
  }

  async function toggleSent(vendorName: string) {
    const draft = draftsByVendor[vendorName];
    await persistAll({ vendorName, status: draft?.status === "sent" ? (draft.statusBeforeSent || "approved") : "sent" });
  }

  async function saveReceivingDelay(memo: string) {
    if (!delayTarget) return;
    setDelayError(null);
    const { line, previous } = delayTarget;
    try {
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
        <WmsExitNav />
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
      <WmsExitNav />
      <h1 style={{ fontSize: "20px", margin: "0 0 4px" }}>{params.waveId.startsWith(VENDOR_QUEUE_PREFIX) ? "거래처별 통합 발주서" : isManualWorkspace ? "수동 거래처 발주서" : "거래처별 부족분 발주서"}</h1>
      <p style={{ fontSize: "12px", color: wmsColors.muted, margin: "0 0 16px" }}>
        {params.waveId.startsWith(VENDOR_QUEUE_PREFIX) ? "사진을 붙여넣고 거래처·수량을 수정한 뒤 발주 승인 → 카카오톡 공유로 보내세요." : isManualWorkspace
          ? '웨이브 없이 수동으로 만든 거래처 발주서입니다. "+ 발주서 수동 추가"와 "상품 검색 추가"로 상품을 넣어주세요.'
          : archivedWorkspace
            ? `${params.waveId} · 원래 출고작업과 분리된 과거 거래처 발주 데이터입니다. 저장된 품목과 상태는 그대로 보존되었습니다.`
          : `${wave.displayName || wave.id} · 부족 수량을 제품DB "거래처" 기준으로 자동 분리했습니다. 거래처 정보가 없는 SKU는 "${UNASSIGNED_VENDOR_NAME}"로 별도 표시됩니다. 자동 발송은 없으며, 승인은 직접 눌러야 합니다.`}
      </p>

      {receivingDelays.error && <p role="alert" style={{ color: "#b42318", fontSize: "12px" }}>{receivingDelays.error} <button type="button" onClick={() => void receivingDelays.refresh()} style={{ ...wmsGhostButton, minHeight: "36px" }}>지연 이력 다시 확인</button></p>}
      {delayMessage && <p role="status" style={{ color: wmsColors.greenDark, fontSize: "12px" }}>{delayMessage}</p>}
      {workspaceMoved && <p role="alert" style={{ color: "#b42318" }}>이 창은 이전 발주대기입니다. 입력한 내용은 유지했습니다. <a href="/wms/vendor-orders/manage" target="_blank" rel="noreferrer">최신 발주대기 열기</a></p>}
      {completionMessage && <p role="status" style={{ color: wmsColors.greenDark, fontSize: "12px" }}>{completionMessage}</p>}
      {completionError && <p role="alert" style={{ color: "#b42318", fontSize: "12px" }}>{completionError} <button type="button" onClick={() => void checkCompletion().catch(() => {})} style={wmsGhostButton}>처리 상태 다시 확인</button></p>}

      {isPreview && (
        <p style={{ fontSize: "12px", color: wmsColors.warn, background: wmsColors.warnSoft, borderRadius: "8px", padding: "8px 10px", marginBottom: "14px" }}>
          이 웨이브는 아직 피킹 진행중입니다 — 지금까지 처리한 SKU 기준 미리보기이며, 저장되지 않습니다.
          피킹을 완료하면 정식으로 저장·수정할 수 있습니다.
        </p>
      )}

      {!isPreview && (!addingManualVendor ? (
        <button onClick={() => setAddingManualVendor(true)} style={{ ...wmsGhostButton, width: "100%", marginBottom: "14px" }}>
          + 발주서 수동 추가
        </button>
      ) : (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginBottom: "14px", width: "100%" }}>
          <input
            autoFocus
            className="wms-input"
            value={newVendorNameInput}
            onChange={e => setNewVendorNameInput(e.target.value)}
            placeholder="거래처명 입력 (기존 거래처명도 가능)"
            style={{ ...inputStyle, flex: "1 1 140px", minWidth: 0, boxSizing: "border-box", fontSize: "16px", padding: "8px 10px" }}
          />
          <div style={{ display: "flex", gap: "6px", flexShrink: 0 }}>
            <button onClick={createManualVendorOrder} style={{ ...wmsPrimaryButton, minHeight: "36px", fontSize: "12px", flexShrink: 0 }}>
              만들기
            </button>
            <button onClick={() => setAddingManualVendor(false)} style={{ ...wmsGhostButton, minHeight: "36px", fontSize: "12px", flexShrink: 0 }}>
              취소
            </button>
          </div>
        </div>
      ))}

      {groups.length === 0 ? (
        <p style={{ fontSize: "13px", color: wmsColors.muted, whiteSpace: "pre-line" }}>
          {"현재 자동 생성된 부족분이 없습니다.\n위 [발주서 수동 추가]로 새 거래처 발주서를 만들 수 있습니다."}
        </p>
      ) : (
        <>
        <div style={{ display: "flex", gap: "6px", marginBottom: "10px", position: "sticky", top: 0, zIndex: 5, background: "rgba(255,255,255,.96)", padding: "6px 0" }}>
          <button type="button" disabled={saving || isPreview} onClick={() => setSelectedLineIds(new Set(selectableLines.map(line => line.id)))} style={{ ...wmsGhostButton, flex: 1, minHeight: "40px" }}>전체체크</button>
          <button type="button" onClick={() => setSelectedLineIds(new Set())} style={{ ...wmsSecondaryButton, flex: 1, minHeight: "40px" }}>전체해제</button>
          <button type="button" disabled={saving || !selectedLines.length} onClick={removeSelectedLines} style={{ ...wmsWarnButton, flex: 1, minHeight: "40px", opacity: selectedLines.length ? 1 : .5 }}>선택삭제 {selectedLines.length}</button>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: "16px", marginBottom: "20px" }}>
          {groups.map(group => {
            const status = statusOf(group.vendorName);
            const editable = !isPreview && !workspaceMoved && !saving && (status === "draft" || status === "review" || status === "resend_needed");
            const totalOrderQuantity = group.lines.reduce((sum, l) => sum + l.shortageQuantity, 0);
            const totalActualShortage = group.lines.reduce((sum, l) => sum + (l.actualShortageQuantity ?? l.shortageQuantity), 0);
            const pendingReorders = pendingReorderLines.filter(line => (line.vendorName || UNASSIGNED_VENDOR_NAME) === group.vendorName);

            return (
              <div key={group.vendorName} data-vendor-group={group.vendorName} style={cardStyle}>
                <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "center", gap: "6px", marginBottom: "10px" }}>
                  <h2 style={{ margin: 0, fontSize: "17px", minWidth: 0, overflowWrap: "anywhere" }}>
                    {group.vendorName}
                    <span style={{ marginLeft: "8px", fontSize: "12px", color: wmsColors.muted, fontWeight: 400 }}>
                      실제부족 {totalActualShortage}개 · 발주 {totalOrderQuantity}개 · {group.lines.length}종
                    </span>
                  </h2>
                  <StatusBadge status={status} />
                </div>
                <div style={{ fontSize: "11px", color: wmsColors.muted, marginBottom: "8px" }}>
                  발주일 {new Date().toLocaleDateString("ko-KR")}
                </div>

                <div style={params.waveId.startsWith(VENDOR_QUEUE_PREFIX) ? { marginBottom: "10px", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 360px), 1fr))", gap: 10 } : { marginBottom: "10px" }}>
                  {group.lines.map(line => (
                    <div key={line.id} style={{ display: "grid", gridTemplateColumns: "30px minmax(0,1fr)", gap: "6px", alignItems: "start" }}>
                    <input type="checkbox" aria-label={`${line.productName} 선택`} checked={selectedLineIds.has(line.id)} disabled={saving || isPreview || Boolean(getVendorLineDeletionBlockReason(line, draftsByVendor[group.vendorName]))} title={getVendorLineDeletionBlockReason(line, draftsByVendor[group.vendorName]) || "삭제할 상품 선택"} onChange={() => setSelectedLineIds(prev => { const next = new Set(prev); if (next.has(line.id)) next.delete(line.id); else next.add(line.id); return next; })} style={{ width: "24px", height: "24px", marginTop: "12px" }} />
                    <VendorOrderLineCard
                      line={line}
                      compact={params.waveId.startsWith(VENDOR_QUEUE_PREFIX)}
                      onReceivingSaved={saved => {
                        const receipt = { receivedQuantity:saved.receivedQuantity, receivedUnitPrice:saved.receivedUnitPrice, receivedVat:saved.receivedVat, receivedCostVatIncluded:saved.receivedCostVatIncluded, receivedUsedImmediatelyAt:saved.receivedUsedImmediatelyAt, receivedCostAppliedAt:saved.receivedCostAppliedAt, receivingHistory:saved.receivingHistory, updatedAt:saved.updatedAt };
                        setLines(previous => previous.map(item => item.id === saved.id ? {...item,...receipt} : item));
                        const baseline = lineBaselines.current.get(saved.id);
                        if(baseline) lineBaselines.current.set(saved.id,{...baseline,...receipt});
                      }}
                      editable={editable}
                      knownVendorNames={knownVendorNames}
                      productLink={liveCatalogByProductCode.get(normalizeSkuId(line.skuId))?.productLink || ""}
                      delaySummary={receivingDelays.summaries.get(normalizeSkuId(line.skuId))}
                      delayDisabled={receivingDelays.loading || receivingDelays.saving || Boolean(receivingDelays.error) || saving}
                      onDelay={() => { setDelayError(null); setDelayTarget({ line, previous: receivingDelays.summaries.get(normalizeSkuId(line.skuId)) }); }}
                      onChange={patch => updateLine(line.id, patch)}
                      onPhotoWork={active => setPhotoWorkCount(count => Math.max(0, count + (active ? 1 : -1)))}
                      onSavePhoto={url => savePastedPhoto(line.id, url)}
                      onChangeVendor={name => changeVendor(line.id, name)}
                      onStep={delta => stepQuantity(line, delta)}
                      onAddOptions={status !== "sent" && !workspaceMoved && variantSkuIds.has(normalizeSkuId(line.skuId)) ? () => void beginVariantAdd(line) : undefined}
                      optionsBusy={saving}
                      partialCompletion={partialCompletionSkus.has(line.skuId)}
                      deleteBlockReason={getVendorLineDeletionBlockReason(line, draftsByVendor[group.vendorName])}
                      onRemove={() => removeLine(line)}
                      onCatalogStatusSaved={() => {
                        setExcludedLineIds(previous => new Set(previous).add(line.id));
                        setSelectedLineIds(previous => { const next = new Set(previous); next.delete(line.id); return next; });
                        setCompletionMessage(`단종·과재고 처리된 SKU ${line.skuId}를 이번 발주에서 제외했습니다.`);
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
                    <button onClick={() => persistAll()} disabled={saving} style={{ ...wmsSecondaryButton, minHeight: "36px", fontSize: "12px" }}>
                      {saving ? "저장 중..." : "임시저장"}
                    </button>
                    <button
                      onClick={() => handleApprove(group.vendorName)}
                      disabled={saving || group.lines.length === 0}
                      style={{ ...wmsSlateDarkButton, minHeight: "36px", fontSize: "12px" }}
                    >
                      승인
                    </button>
                  </div>
                )}

                {status === "approved" && !workspaceMoved && <button type="button" disabled={saving} onClick={() => setSearchAddVendor(group.vendorName)} style={{ ...wmsGhostButton, minHeight: "44px", width: "100%", fontSize: "13px" }}>+ 상품 추가</button>}
                {(status === "approved" || status === "sent") && (
                  <VendorOrderExportPanel
                    wave={wave}
                    vendorName={group.vendorName}
                    lines={group.lines}
                    status={status}
                    busy={saving || workspaceMoved}
                    onBeforeExport={async () => (await checkCompletion(undefined, true)).filter(line => (line.vendorName || UNASSIGNED_VENDOR_NAME) === group.vendorName)}
                    onMarkSent={() => toggleSent(group.vendorName)}
                    onReviseAgain={() => beginVendorRevision(group.vendorName)}
                  />
                )}
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

      {isManualWorkspace ? (
        <a href="/wms/vendor-orders" style={{ display: "block", textDecoration: "none" }}>
          <button style={{ ...wmsGhostButton, width: "100%" }}>거래처 발주관리로</button>
        </a>
      ) : (
        <a href={`/wms/picking/waves/${wave.id}/complete`} style={{ display: "block", textDecoration: "none" }}>
          <button style={{ ...wmsGhostButton, width: "100%" }}>피킹 완료 화면으로</button>
        </a>
      )}

      {searchAddVendor && (
        <ProductSearchAddSheet
          existingSkuIds={groups.flatMap(group => group.lines.map(line => line.skuId))}
          onClose={() => setSearchAddVendor(null)}
          onSelect={product => addProductsFromSearch(searchAddVendor, [product], new Date().toISOString() + "::" + crypto.randomUUID())}
        />
      )}
      {variantTarget && <ProductVariantAddSheet anchorSkuId={variantTarget.skuId} catalogItems={Array.from(liveCatalogByProductCode.values())} existingSkuIds={groups.flatMap(group => group.lines.map(line => line.skuId))} onClose={() => setVariantTarget(null)} onSelect={(products: ProductCatalogItem[]) => addProductsFromSearch(variantTarget.vendorName, products, linesRef.current.find(line => normalizeSkuId(line.skuId) === normalizeSkuId(variantTarget.skuId))?.manualListGroup)} />}
      {delayTarget && <ReceivingDelayDialog line={delayTarget.line} previous={delayTarget.previous} busy={receivingDelays.saving} error={delayError} onClose={() => setDelayTarget(null)} onSave={memo => void saveReceivingDelay(memo)} />}
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
  compact = false,
  onReceivingSaved,
  editable,
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
  onCatalogStatusSaved,
}: {
  line: VendorOrderDraftLine;
  onReceivingSaved: (line: VendorOrderDraftLine) => void;
  editable: boolean;
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
  onCatalogStatusSaved: () => void;
}) {
  const pasteUploading = useRef(false);
  const [imageEditOpen, setImageEditOpen] = useState(false);
  const [pendingImageUrl, setPendingImageUrl] = useState<string | null>(null);
  const [imageSaving, setImageSaving] = useState(false);
  const [imageSaveError, setImageSaveError] = useState<string | null>(null);
  const [vendorSaving, setVendorSaving] = useState(false);
  const [vendorSaveError, setVendorSaveError] = useState<string | null>(null);
  const [editingVendor, setEditingVendor] = useState(false);
  const [statusSaving, setStatusSaving] = useState<"단종" | "과재고" | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  /** 화면 표시 전용 URL — line.imageUrl(데이터/Sheets 저장/Canvas·카카오 공유용 원본)은 그대로
   *  두고, 이 카드의 <img src>에만 적용한다(2026-08-20 신규 — Google Drive 이미지를 화면에
   *  직접 로드하면 실기기에서 실패하는 문제 수정, image-proxy로 표시). */
  const displayImageSrc = getWmsDisplayImageUrl(line.imageUrl);
  const [imageLoadFailed, setImageLoadFailed] = useState(false);
  useEffect(() => {
    setImageLoadFailed(false);
  }, [displayImageSrc]);

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

  const { name: displayName, option: displayOption } = resolveDisplayNameAndOption(line.productName, line.optionLabel);


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
    <div data-vendor-sku={line.skuId} tabIndex={editable ? 0 : -1} aria-label={line.skuId + " 상품 사진 붙여넣기"} onPaste={event => {
      const file = Array.from(event.clipboardData.files).find(file => file.type.startsWith("image/"));
      if (file && editable) { event.preventDefault(); void pastePhoto(file); }
    }} style={{ ...wmsOuterCard, padding: "12px", marginBottom: "10px", height: compact ? "100%" : undefined, boxSizing: "border-box", display: compact ? "flex" : undefined, flexDirection: compact ? "column" : undefined }}>
      {editable && <button type="button" style={{ ...wmsGhostButton, width: "100%", marginBottom: 8 }} onClick={event => event.currentTarget.focus()}>여기를 누르고 사진 붙여넣기 · Ctrl+V · 자동 저장</button>}
      <button
        type="button"
        onClick={() => editable && setImageEditOpen(true)}
        disabled={!editable}
        style={{
          width: "100%",
          aspectRatio: "1",
          maxHeight: compact ? 240 : undefined,
          padding: 0,
          border: `1px solid ${wmsColors.border}`,
          borderRadius: "10px",
          background: line.imageUrl ? "#ffffff" : wmsColors.warnSoft,
          cursor: editable ? "pointer" : "default",
          display: "block",
          position: "relative",
          overflow: "hidden",
        }}
      >
        {displayImageSrc && !imageLoadFailed ? (
          <>
            {/* iPhone Safari에서 <img>를 직접 탭하면 길게 눌렀을 때 뜨는 "사진에 저장" 콜아웃이나
             *  드래그 제스처가 탭을 가로채 버튼의 onClick이 아예 발생하지 않는 문제가 있었다
             *  (2026-08-20 확인된 근본 원인 — 이미지가 없을 때는 <img> 자체가 없어 이 문제가
             *  없었고, 있을 때만 "눌러도 반응 없음"으로 보였다). pointer-events:none으로 이미지를
             *  터치/클릭 대상에서 완전히 제외해, 이미지 위 어디를 눌러도 항상 버튼 자체가 받도록
             *  한다. */}
            <img
              src={displayImageSrc}
              alt=""
              draggable={false}
              onError={() => setImageLoadFailed(true)}
              style={{
                width: "100%",
                height: "100%",
                objectFit: "contain",
                background: "#ffffff",
                display: "block",
                pointerEvents: "none",
                WebkitTouchCallout: "none",
                WebkitUserSelect: "none",
                userSelect: "none",
              }}
            />
            {editable && (
              // 상품 디자인을 가리지 않도록 이미지 하단에 작은 반투명 안내만 표시한다 — 확대와
              // 혼동되지 않게 "이미지 변경" 문구와 카메라 아이콘을 함께 쓴다(2026-08-19 5차 실사용
              // 테스트 신규). 클릭 대상은 이 버튼 전체(이미지 영역)이며 카드 전체가 아니다.
              <div
                style={{
                  position: "absolute",
                  left: "50%",
                  bottom: "8px",
                  transform: "translateX(-50%)",
                  display: "flex",
                  alignItems: "center",
                  gap: "4px",
                  background: "rgba(37,37,37,0.55)",
                  color: "#ffffff",
                  fontSize: "10px",
                  fontWeight: 700,
                  padding: "3px 9px",
                  borderRadius: "999px",
                }}
              >
                <CameraIcon size={11} color="#ffffff" />
                이미지 변경
              </div>
            )}
          </>
        ) : (
          <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: wmsColors.warn, fontWeight: 700, fontSize: "14px", flexDirection: "column", gap: "4px" }}>
            <span>{displayImageSrc && imageLoadFailed ? "이미지 불러오기 실패" : "이미지 미등록"}</span>
            {editable && <span style={{ fontSize: "11px", fontWeight: 400 }}>탭해서 사진 {displayImageSrc && imageLoadFailed ? "교체" : "등록"}</span>}
          </div>
        )}
        {imageSaving && (
          <div style={{ position: "absolute", inset: 0, background: "rgba(255,255,255,0.85)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "12px", color: wmsColors.ink, fontWeight: 700 }}>
            저장 중...
          </div>
        )}
      </button>

      {imageSaveError && (
        <div style={{ marginTop: "6px", fontSize: "11px", color: "#c0392b" }}>
          {imageSaveError}
          {pendingImageUrl && (
            <button onClick={() => persistImageUrl(pendingImageUrl)} style={{ ...wmsGhostButton, minHeight: "26px", padding: "0 8px", fontSize: "11px", marginLeft: "6px" }}>
              다시 시도
            </button>
          )}
        </div>
      )}

      {/* 8-1: 상품명 — 카드 중앙 정렬, 여러 줄 줄바꿈 허용, 잘림 없음(2026-08-20 재배치). */}
      <div style={{ marginTop: "12px", fontSize: "16px", fontWeight: 800, color: wmsColors.ink, textAlign: "center", whiteSpace: "normal", wordBreak: "keep-all", overflowWrap: "anywhere", lineHeight: 1.35 }}>
        {displayName}
      </div>

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
        ) : (
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "5px",
              height: "34px",
              boxSizing: "border-box",
              padding: "0 10px",
              borderRadius: "8px",
              background: "#ffffff",
              color: wmsColors.muted,
              border: `1px solid ${wmsColors.border}`,
              fontSize: "11px",
              fontWeight: 700,
              flexShrink: 0,
              whiteSpace: "nowrap",
            }}
          >
            <ExternalLinkIcon size={12} />
            제품링크 미등록
          </span>
        )}
      </div>

      {/* 8-3: 수량(왼쪽) / SKU·바코드(오른쪽) 균형 잡힌 2열 grid — 동일 가로 비율, 동일 높이.
       *  왼쪽은 "수량" 라벨과 스테퍼를 전체 중앙 정렬, 오른쪽은 SKU/바코드 그래픽/바코드 번호
       *  3줄 구조로 균일하게 배치한다(2026-08-20 재배치, 8-3 요구사항). */}
      <div style={{ marginTop: "14px", display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)", alignItems: "stretch", columnGap: "10px" }}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "6px" }}>
          <div style={{ fontSize: "11px", color: wmsColors.muted, textAlign: "center" }}>발주수량</div>
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
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "4px", minWidth: 0 }}>
          <div style={{ fontSize: "17px", fontWeight: 800, color: wmsColors.ink, textAlign: "center" }}>SKU {line.skuId}</div>
          <div style={{ display: "flex", justifyContent: "center", width: "100%" }}>
            <div style={{ maxWidth: "85%" }}>
              <Barcode value={line.barcode} height={16} moduleWidth={0.6} valueFontSize={10} />
            </div>
          </div>
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: "8px", marginTop: "12px" }}>
        {delaySummary?.active && <span style={{ color: "#a33b2e", fontSize: "12px", fontWeight: 800 }}>입고지연 · {receivingDelayDate(delaySummary.recentDelayedAt)}</span>}
        <button type="button" disabled={delayDisabled} onClick={onDelay} style={{ ...wmsGhostButton, minHeight: "40px", fontSize: "12px", color: delaySummary?.active ? "#a33b2e" : wmsColors.ink }}>{delaySummary?.active ? "입고지연 해제" : "입고지연"}</button>
      </div>
      {delaySummary?.active && delaySummary.memo && <p style={{ margin: "6px 0 0", fontSize: "12px", color: wmsColors.muted, overflowWrap: "anywhere" }}>{delaySummary.memo}</p>}

      {partialCompletion && <p style={{ color: wmsColors.warn, fontSize: "12px" }}>일부 미납분은 재발주요청이 완료됐습니다. 남은 발주가 있어 상품을 유지했으니 실제 부족수량을 확인해 주세요.</p>}
      <SimpleReceiving lineId={line.id} onSaved={onReceivingSaved} />
      {onAddOptions && <button type="button" disabled={optionsBusy} onClick={onAddOptions} style={{ ...wmsSecondaryButton, width: "100%", minHeight: "44px", marginTop: "10px", fontSize: "13px" }}>+ 옵션 추가</button>}
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
          <input className="wms-input" value={line.memo} placeholder="메모" onChange={e => onChange({ memo: e.target.value })} style={inputStyle} />
          <div style={{ display: "flex", gap: "6px" }}>
            <button onClick={() => handleSetCatalogStatus("단종")} disabled={Boolean(statusSaving)} style={{ ...wmsWarnButton, flex: 1, minHeight: "34px", fontSize: "11px" }}>
              {statusSaving === "단종" ? "저장 중..." : "단종"}
            </button>
            <button onClick={() => handleSetCatalogStatus("과재고")} disabled={Boolean(statusSaving)} style={{ ...wmsSecondaryButton, flex: 1, minHeight: "34px", fontSize: "11px" }}>
              {statusSaving === "과재고" ? "저장 중..." : "과재고"}
            </button>
          </div>
          {statusMessage && <div style={{ fontSize: "10px", color: statusMessage.includes("완료") ? wmsColors.greenDark : "#c0392b" }}>{statusMessage}</div>}
          <div style={{ fontSize: "10px", color: wmsColors.muted }}>
            현재고 {line.currentStock || "미입력"} · 관련 발주서 {line.relatedPurchaseOrderNumbers.join(", ") || (line.isManuallyAdded ? "수동추가" : "-")}
          </div>
          <button onClick={onRemove} disabled={Boolean(deleteBlockReason)} title={deleteBlockReason || undefined} style={{ ...wmsWarnButton, minHeight: "32px", fontSize: "11px", opacity: deleteBlockReason ? .5 : 1 }}>
            삭제
          </button>
        </div>
      )}

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
