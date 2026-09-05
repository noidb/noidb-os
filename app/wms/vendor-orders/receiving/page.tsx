"use client";

import { useEffect, useMemo, useState } from "react";
import { usePickingWaveRepository } from "@/lib/wms/picking-wave/context";
import { useVendorOrderRepository } from "@/lib/wms/vendor-order/context";
import {
  MANUAL_VENDOR_WORKSPACE_ID,
  type VendorOrderDraft,
  type VendorOrderDraftLine,
  type VendorOrderDraftStatus,
} from "@/lib/wms/vendor-order/types";
import type { PickingWave } from "@/lib/wms/picking-wave/types";
import { resolveDisplayNameAndOption } from "@/lib/wms/display-name";
import { fetchLiveCatalogLookup, type LiveCatalogLookup } from "@/lib/wms/picking-wave/live-catalog";
import { getWmsDisplayImageUrl } from "@/lib/wms/image-display-url";
import { WMS_MOBILE_WIDTH, wmsColors, wmsPrimaryButton, wmsGhostButton } from "@/lib/wms/ui-tokens";
import { useWmsUndo } from "@/lib/wms/undo-context";
import type { ReceivingDelaySummary } from "@/lib/wms/vendor-order-actions";

/**
 * 발주 입고처리 화면 (2026-08-19 4차 실사용 테스트 신규).
 *
 * 승인·전송완료된 거래처 발주서를 대상으로 입고수량만 기록한다. 안전 조건(사용자 명시):
 * - 이번 단계에서는 제품DB(구글시트) 현재고를 자동으로 가산하지 않는다 — 저장은 오직
 *   VendorOrderDraftLine.receivedQuantity(이번에 추가한 필드)에만 이루어진다.
 * - 발주수량(shortageQuantity)보다 큰 입고수량은 저장하지 않는다(클램프).
 * - 음수 저장 금지, 부분입고/전량입고 상태는 receivedQuantity와 shortageQuantity 비교로만
 *   계산한다(별도 상태 필드를 추가로 두면 두 값이 어긋날 수 있어 파생값으로만 계산).
 */

type ReceivingStatus = "미입고" | "부분입고" | "입고지연" | "전량입고";

function computeReceivingStatus(lines: VendorOrderDraftLine[]): ReceivingStatus {
  const totalOrdered = lines.reduce((sum, line) => sum + line.shortageQuantity, 0);
  const totalReceived = lines.reduce((sum, line) => sum + Math.min(line.receivedQuantity || 0, line.shortageQuantity), 0);
  const hasDelayedRemainder = lines.some(line => Boolean(line.receivingDelayedAt) && !line.receivingDelayReleasedAt && (line.receivedQuantity || 0) < line.shortageQuantity);
  if (hasDelayedRemainder) return "입고지연";
  if (totalReceived <= 0) return "미입고";
  if (totalReceived >= totalOrdered) return "전량입고";
  return "부분입고";
}

export default function VendorOrderReceivingPage() {
  const waveRepository = usePickingWaveRepository();
  const vendorOrderRepository = useVendorOrderRepository();
  const { pushUndo } = useWmsUndo();

  const [loading, setLoading] = useState(true);
  const [waves, setWaves] = useState<PickingWave[]>([]);
  const [drafts, setDrafts] = useState<VendorOrderDraft[]>([]);
  const [lines, setLines] = useState<VendorOrderDraftLine[]>([]);
  const [openDraftId, setOpenDraftId] = useState<string | null>(null);
  const [editValues, setEditValues] = useState<Record<string, number>>({});
  const [unitPriceValues, setUnitPriceValues] = useState<Record<string, number>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [selectedLineIds, setSelectedLineIds] = useState<Set<string>>(new Set());
  const [selectedDraftIds, setSelectedDraftIds] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);
  const [liveCatalog, setLiveCatalog] = useState<LiveCatalogLookup>(new Map());
  const [lastReceiveAllSnapshot, setLastReceiveAllSnapshot] = useState<VendorOrderDraftLine[] | null>(null);
  const [operator, setOperator] = useState("");
  const [delaySummaries, setDelaySummaries] = useState<Map<string, ReceivingDelaySummary>>(new Map());

  async function reload() {
    setLoading(true);
    try {
      const [loadedWaves, loadedDrafts, loadedLines] = await Promise.all([
        waveRepository.listWaves(),
        vendorOrderRepository.listAllDrafts(),
        vendorOrderRepository.listAllLines(),
      ]);
      setWaves(loadedWaves);
      setDrafts(loadedDrafts.filter(draft => draft.status === "approved" || draft.status === "sent"));
      setLines(loadedLines);
      setLiveCatalog(await fetchLiveCatalogLookup());
      try {
        const response = await fetch("/api/wms/vendor-order-actions", { cache: "no-store" });
        const data = await response.json();
        if (response.ok && data.success) {
          setDelaySummaries(new Map((data.delaySummaries || []).map((item: ReceivingDelaySummary) => [item.skuId, item])));
        }
      } catch {
        // 영구 이력 조회가 일시 실패해도 기존 발주서 입고수량 화면 자체는 계속 사용할 수 있다.
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setOperator(window.localStorage.getItem("noidb_wms_operator") || "");
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function updateOperator(value: string) {
    setOperator(value);
    window.localStorage.setItem("noidb_wms_operator", value);
  }

  async function postPermanentAction(body: Record<string, unknown>) {
    if (!operator.trim()) throw new Error("처리자 이름을 먼저 입력해주세요.");
    const response = await fetch("/api/wms/vendor-order-actions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, operator: operator.trim() }),
    });
    const data = await response.json();
    if (!response.ok || !data.success) throw new Error(data.error || "영구 이력 저장에 실패했습니다.");
    return data;
  }

  const waveById = useMemo(() => new Map(waves.map(wave => [wave.id, wave])), [waves]);

  const rows = useMemo(() => {
    return drafts
      .map(draft => {
        const draftLines = lines.filter(line => line.draftId === draft.id);
        const totalQuantity = draftLines.reduce((sum, line) => sum + line.shortageQuantity, 0);
        const wave = draft.waveId === MANUAL_VENDOR_WORKSPACE_ID ? null : waveById.get(draft.waveId);
        return { draft, draftLines, lineCount: draftLines.length, totalQuantity, wave, receivingStatus: computeReceivingStatus(draftLines) };
      })
      .filter(row => row.lineCount > 0)
      .sort((a, b) => (b.draft.approvedAt || b.draft.updatedAt).localeCompare(a.draft.approvedAt || a.draft.updatedAt));
  }, [drafts, lines, waveById]);

  const openRow = rows.find(row => row.draft.id === openDraftId) || null;

  function openDetail(draftId: string, draftLines: VendorOrderDraftLine[]) {
    setOpenDraftId(draftId);
    setEditValues(Object.fromEntries(draftLines.map(line => [line.id, line.receivedQuantity || 0])));
    setUnitPriceValues(Object.fromEntries(draftLines.map(line => [line.id, line.receivedUnitPrice || 0])));
    setSaveError(null);
    setSaveMessage(null);
    setSelectedLineIds(new Set());
  }

  function updateReceived(line: VendorOrderDraftLine, value: number) {
    const clamped = Math.max(0, Math.min(line.shortageQuantity, Math.round(value) || 0));
    setEditValues(prev => ({ ...prev, [line.id]: clamped }));
  }

  async function handleSave() {
    if (!openRow) return;
    setSaving(true);
    setSaveError(null);
    setSaveMessage(null);
    try {
      const now = new Date().toISOString();
      const updatedLines = openRow.draftLines.map(line => {
        const receivedQuantity = editValues[line.id] ?? line.receivedQuantity ?? 0;
        const receivedUnitPrice = Math.max(0, Math.round(unitPriceValues[line.id] ?? line.receivedUnitPrice ?? 0));
        const receivedVat = Math.round(receivedUnitPrice * 0.1);
        return {
          ...line,
          receivedQuantity,
          receivedUnitPrice,
          receivedVat,
          receivedCostVatIncluded: receivedUnitPrice + receivedVat,
          reorderPendingQuantity: receivedQuantity >= line.shortageQuantity ? 0 : line.reorderPendingQuantity,
          reorderRequestedAt: receivedQuantity >= line.shortageQuantity ? undefined : line.reorderRequestedAt,
          updatedAt: now,
        };
      });
      for (const line of updatedLines) {
        if ((line.receivedQuantity || 0) <= 0 || (line.receivedUnitPrice || 0) <= 0) continue;
        await postPermanentAction({
          action: "receiving-cost",
          draftId: openRow.draft.id,
          lineId: line.id,
          purchaseOrderNumber: openRow.draft.id,
          skuId: line.skuId,
          unitPriceExVat: line.receivedUnitPrice,
          receivedQuantity: line.receivedQuantity,
        });
        line.receivedCostAppliedAt = now;
      }
      await Promise.all(updatedLines.map(line => vendorOrderRepository.saveLine(line)));
      setLines(prev => prev.map(line => updatedLines.find(u => u.id === line.id) ?? line));
      setSaveMessage("입고수량을 저장하고, 수량이 1개 이상인 입력 단가는 제품DB 원가와 영구 이력에 반영했습니다.");
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "입고수량 저장에 실패했습니다.");
    } finally {
      setSaving(false);
    }
  }

  async function saveUpdatedLines(updatedLines: VendorOrderDraftLine[], message: string) {
    setSaving(true);
    setSaveError(null);
    setSaveMessage(null);
    try {
      await Promise.all(updatedLines.map(line => vendorOrderRepository.saveLine(line)));
      setLines(prev => prev.map(line => updatedLines.find(updated => updated.id === line.id) ?? line));
      setEditValues(prev => ({ ...prev, ...Object.fromEntries(updatedLines.map(line => [line.id, line.receivedQuantity || 0])) }));
      setUnitPriceValues(prev => ({ ...prev, ...Object.fromEntries(updatedLines.map(line => [line.id, line.receivedUnitPrice || 0])) }));
      setSaveMessage(message);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "입고 처리 저장에 실패했습니다.");
    } finally {
      setSaving(false);
    }
  }

  async function restoreLines(snapshot: VendorOrderDraftLine[]) {
    await Promise.all(snapshot.map(line => vendorOrderRepository.saveLine(line)));
    setLines(previous => previous.map(line => snapshot.find(saved => saved.id === line.id) || line));
    setEditValues(previous => ({ ...previous, ...Object.fromEntries(snapshot.map(line => [line.id, line.receivedQuantity || 0])) }));
    setUnitPriceValues(previous => ({ ...previous, ...Object.fromEntries(snapshot.map(line => [line.id, line.receivedUnitPrice || 0])) }));
  }

  async function receiveAll(linesToReceive: VendorOrderDraftLine[], rememberAsWhole = false) {
    const snapshot = linesToReceive.map(line => ({ ...line }));
    const now = new Date().toISOString();
    await saveUpdatedLines(linesToReceive.map(line => ({
      ...line,
      receivedQuantity: line.shortageQuantity,
      reorderPendingQuantity: 0,
      reorderRequestedAt: undefined,
      updatedAt: now,
    })), "전량입고 처리했습니다.");
    if (rememberAsWhole) setLastReceiveAllSnapshot(snapshot);
    pushUndo("전량입고", () => restoreLines(snapshot));
  }

  async function releaseWholeReceive() {
    if (!lastReceiveAllSnapshot) return;
    const current = openRow?.draftLines.map(line => ({ ...line, receivedQuantity: editValues[line.id] ?? line.receivedQuantity ?? 0 })) || [];
    await restoreLines(lastReceiveAllSnapshot);
    pushUndo("전량입고 해제", () => restoreLines(current));
    setLastReceiveAllSnapshot(null);
    setSaveMessage("전체 전량입고 전 수량으로 복원했습니다.");
  }

  async function deleteSelectedLines(lineIds: string[]) {
    if (lineIds.length === 0 || !openRow) return;
    if (!window.confirm(`${lineIds.length}개 상품을 발주서에서 삭제할까요?`)) return;
    const snapshot = openRow.draftLines.filter(line => lineIds.includes(line.id)).map(line => ({ ...line }));
    await Promise.all(lineIds.map(id => vendorOrderRepository.deleteLine(id)));
    setLines(previous => previous.filter(line => !lineIds.includes(line.id)));
    setSelectedLineIds(new Set());
    pushUndo("입고상품 삭제", async () => {
      await Promise.all(snapshot.map(line => vendorOrderRepository.saveLine(line)));
      await reload();
    });
    setSaveMessage(`${lineIds.length}개 상품을 삭제했습니다.`);
  }

  async function updateSelectedCatalog(kind: "단종" | "단종해제" | "품절", explicitTargets?: VendorOrderDraftLine[]) {
    if (!openRow) return;
    const targets = explicitTargets || openRow.draftLines.filter(line => selectedLineIds.has(line.id));
    if (targets.length === 0) return;
    if (!window.confirm(`선택한 ${targets.length}개 상품을 ${kind} 처리할까요?`)) return;
    const snapshots = targets.map(line => {
      const live = liveCatalog.get(line.skuId);
      return { skuId: line.skuId, currentStock: live?.currentStock || "", currentStatus: live?.currentStatus || "" };
    });
    const patch: Record<string, string> = { currentStock: "0" };
    const update = async (skuId: string, fields: Record<string, string>) => {
      const response = await fetch("/api/wms/product-catalog/update", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ skuId, ...fields }) });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || `${kind} 처리에 실패했습니다.`);
    };
    setSaving(true);
    try {
      if (kind === "품절") {
        await Promise.all(targets.map(line => update(line.skuId, patch)));
        pushUndo("선택상품 품절", async () => {
          await Promise.all(snapshots.map(snapshot => update(snapshot.skuId, { currentStock: snapshot.currentStock })));
          await reload();
        });
        setSaveMessage("선택상품의 현재고를 0으로 저장했습니다.");
      } else {
        for (const line of targets) {
          await postPermanentAction({
            action: "queue-status",
            skuId: line.skuId,
            requestType: kind,
            purchaseOrderNumber: openRow.draft.id,
          });
        }
        setSaveMessage(kind === "단종"
          ? "선택상품을 단종 대기에 추가했습니다. 제품DB는 변경하지 않았습니다."
          : "선택상품을 단종해제 대기에 추가했습니다. 제품DB는 변경하지 않았습니다.");
      }
      await reload();
    } catch (error) { setSaveError(error instanceof Error ? error.message : `${kind} 처리에 실패했습니다.`); }
    finally { setSaving(false); }
  }

  async function setReceivingDelay(targets: VendorOrderDraftLine[], delayed: boolean) {
    if (targets.length === 0) return;
    const snapshot = targets.map(line => ({ ...line }));
    const now = new Date().toISOString();
    setSaving(true);
    setSaveError(null);
    try {
      for (const line of targets) {
        const live = liveCatalog.get(line.skuId);
        await postPermanentAction({
          action: "delay",
          skuId: line.skuId,
          modelSku: live?.modelSku || line.modelName,
          productName: live?.productName || line.productName,
          optionLabel: live?.optionLabel || line.optionLabel,
          vendorName: line.vendorName,
          purchaseOrderNumber: openRow?.draft.id || line.draftId,
          delayed,
        });
      }
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "입고지연 이력 저장에 실패했습니다.");
      setSaving(false);
      return;
    }
    const updated = targets.map(line => ({
      ...line,
      receivingDelayedAt: delayed ? now : line.receivingDelayedAt,
      receivingDelayReleasedAt: delayed ? undefined : now,
      updatedAt: now,
    }));
    await saveUpdatedLines(updated, delayed ? `${updated.length}개 상품을 입고지연으로 표시했습니다.` : `${updated.length}개 상품의 입고지연을 해제했습니다.`);
    pushUndo(delayed ? "입고지연" : "입고지연 해제", async () => {
      for (const line of targets) {
        const live = liveCatalog.get(line.skuId);
        await postPermanentAction({
          action: "delay", skuId: line.skuId, modelSku: live?.modelSku || line.modelName,
          productName: live?.productName || line.productName, optionLabel: live?.optionLabel || line.optionLabel,
          vendorName: line.vendorName, purchaseOrderNumber: openRow?.draft.id || line.draftId, delayed: !delayed,
        });
      }
      await restoreLines(snapshot);
      await reload();
    });
    await reload();
  }

  async function queueSelectedReorders() {
    if (!openRow) return;
    const now = new Date().toISOString();
    const selected = openRow.draftLines.filter(line => selectedLineIds.has(line.id));
    const updated = selected.map(line => ({
      ...line,
      receivedQuantity: editValues[line.id] ?? line.receivedQuantity ?? 0,
      reorderPendingQuantity: Math.max(0, line.shortageQuantity - (editValues[line.id] ?? line.receivedQuantity ?? 0)),
      reorderRequestedAt: now,
      updatedAt: now,
    })).filter(line => (line.reorderPendingQuantity || 0) > 0);
    if (updated.length === 0) return;
    await saveUpdatedLines(updated, `선택한 미입고 ${updated.length}종을 다음 발주 대기목록에 추가했습니다.`);
    setSelectedLineIds(new Set());
  }

  async function deleteDrafts(draftIds: string[]) {
    if (draftIds.length === 0 || deleting) return;
    const targetNames = rows.filter(row => draftIds.includes(row.draft.id)).map(row => row.draft.vendorName);
    const description = draftIds.length === 1 ? targetNames[0] : `${draftIds.length}개 발주서`;
    if (!window.confirm(`${description}를 삭제할까요?\n삭제 후 상단 되돌리기로 복원할 수 있습니다.`)) return;
    const deletedDrafts = drafts.filter(draft => draftIds.includes(draft.id)).map(draft => ({ ...draft }));
    const deletedLines = lines.filter(line => draftIds.includes(line.draftId)).map(line => ({ ...line }));
    setDeleting(true);
    setSaveError(null);
    try {
      await Promise.all(draftIds.map(draftId => vendorOrderRepository.deleteDraft(draftId)));
      pushUndo("입고 발주서 삭제", async () => {
        await Promise.all(deletedDrafts.map(draft => vendorOrderRepository.saveDraft(draft)));
        await Promise.all(deletedLines.map(line => vendorOrderRepository.saveLine(line)));
        await reload();
      });
      setSelectedDraftIds(new Set());
      setSaveMessage(`${description}를 삭제했습니다.`);
      await reload();
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "발주서 삭제에 실패했습니다.");
    } finally {
      setDeleting(false);
    }
  }

  if (loading) {
    return (
      <main style={pageStyle}>
        <p style={{ color: wmsColors.muted }}>불러오는 중...</p>
      </main>
    );
  }

  if (openRow) {
    return (
      <main style={pageStyle}>
        <button onClick={() => setOpenDraftId(null)} style={{ ...wmsGhostButton, marginBottom: "12px" }}>
          ← 입고처리 목록으로
        </button>
        <h1 style={{ fontSize: "18px", margin: "0 0 4px" }}>{openRow.draft.vendorName}</h1>
        <p style={{ fontSize: "12px", color: wmsColors.muted, margin: "0 0 4px" }}>
          {openRow.draft.waveId === MANUAL_VENDOR_WORKSPACE_ID ? "웨이브 없음(수동)" : `웨이브 ${openRow.draft.waveId}`}
        </p>
        <label style={{ display: "block", margin: "8px 0" }}>
          <span style={{ display: "block", fontSize: "11px", color: wmsColors.muted, marginBottom: "3px" }}>처리자 (영구 이력 기록용)</span>
          <input value={operator} onChange={event => updateOperator(event.target.value)} placeholder="처리자 이름" style={{ width: "100%", minHeight: "40px", boxSizing: "border-box", border: `1px solid ${wmsColors.borderStrong}`, borderRadius: "9px", padding: "8px 10px", fontSize: "14px" }} />
        </label>
        <p style={{ fontSize: "11px", color: wmsColors.warn, background: wmsColors.warnSoft, borderRadius: "8px", padding: "8px 10px", margin: "8px 0 14px" }}>
          여기서 저장한 입고수량은 제품DB(구글시트) 현재고에 자동으로 반영되지 않습니다 — 발주서별 입고 기록만 저장합니다.
        </p>

        <button onClick={() => receiveAll(openRow.draftLines, true)} disabled={saving} style={{ ...wmsPrimaryButton, width: "100%", marginBottom: "8px", opacity: saving ? 0.6 : 1 }}>
          전체 상품 전량입고
        </button>
        <button onClick={releaseWholeReceive} disabled={saving || !lastReceiveAllSnapshot} style={{ ...wmsGhostButton, width: "100%", marginBottom: "12px", opacity: lastReceiveAllSnapshot ? 1 : 0.45 }}>
          전체 상품 전량입고 해제
        </button>

        <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginBottom: "16px" }}>
          {openRow.draftLines.map(line => {
            const { name, option } = resolveDisplayNameAndOption(line.productName, line.optionLabel);
            const received = editValues[line.id] ?? 0;
            const remaining = Math.max(0, line.shortageQuantity - received);
            const unitPrice = unitPriceValues[line.id] ?? line.receivedUnitPrice ?? 0;
            const live = liveCatalog.get(line.skuId);
            const delaySummary = delaySummaries.get(line.skuId);
            const delayActive = delaySummary ? delaySummary.active : Boolean(line.receivingDelayedAt && !line.receivingDelayReleasedAt);
            const driveFallbackUrl = `/api/wms/product-image/from-drive?model=${encodeURIComponent(live?.modelSku || live?.modelName || line.modelName || line.skuId)}`;
            const imageUrl = getWmsDisplayImageUrl(live?.imageUrl || line.imageUrl) || driveFallbackUrl;
            return (
              <div key={line.id} style={{ border: `1px solid ${wmsColors.border}`, borderRadius: "12px", padding: "10px", background: "#ffffff" }}>
                <div style={{ display: "flex", gap: "10px" }}>
                  <input
                    type="checkbox"
                    aria-label={`${name} 상품 선택`}
                    checked={selectedLineIds.has(line.id)}
                    onChange={event => setSelectedLineIds(prev => {
                      const next = new Set(prev);
                      if (event.target.checked) next.add(line.id); else next.delete(line.id);
                      return next;
                    })}
                    style={{ width: "22px", height: "22px", alignSelf: "center", flexShrink: 0 }}
                  />
                  <a href={`/wms/products/${encodeURIComponent(line.skuId)}`} title="상품정보입력 열기" style={{ lineHeight: 0, flexShrink: 0 }}>
                    <img
                      src={imageUrl}
                      alt={`${name} 상품정보입력 열기`}
                      width={56}
                      height={56}
                      onError={event => {
                        if (!event.currentTarget.src.includes("/api/wms/product-image/from-drive")) event.currentTarget.src = driveFallbackUrl;
                      }}
                      style={{ width: "56px", height: "56px", borderRadius: "8px", objectFit: "cover", background: wmsColors.surfaceBeige }}
                    />
                  </a>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: "13px", fontWeight: 700, whiteSpace: "normal", wordBreak: "keep-all", lineHeight: 1.3 }}>{name}</div>
                    <div style={{ fontSize: "12px", fontWeight: 700, color: wmsColors.greenDark, marginTop: "2px" }}>{option || "옵션 없음"}</div>
                    <div style={{ fontSize: "10px", color: wmsColors.muted, marginTop: "2px" }}>SKU {line.skuId}</div>
                    {delaySummary?.recentDelayedAt || line.receivingDelayedAt ? <div style={{ marginTop: "3px", color: delayActive ? "#a33b2e" : wmsColors.warn, fontSize: "11px", fontWeight: 900 }}>⚠ {new Date(delaySummary?.recentDelayedAt || line.receivingDelayedAt || "").toLocaleDateString("ko-KR")} 입고지연{delayActive ? " · 진행중" : " · 이력"}</div> : null}
                    {live?.productLink ? (
                      <a href={live.productLink} target="_blank" rel="noopener noreferrer" style={{ display: "inline-block", marginTop: "4px", fontSize: "11px", color: wmsColors.slateDark }}>제품링크 ↗</a>
                    ) : <span style={{ display: "block", marginTop: "4px", fontSize: "10px", color: wmsColors.muted }}>제품링크 없음</span>}
                  </div>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "6px", marginTop: "10px", textAlign: "center" }}>
                  <InfoTile label="발주수량" value={line.shortageQuantity} />
                  <div>
                    <div style={{ fontSize: "11px", color: wmsColors.muted, marginBottom: "2px" }}>입고수량</div>
                    <input
                      type="number"
                      min={0}
                      max={line.shortageQuantity}
                      value={received}
                      onChange={e => updateReceived(line, Number(e.target.value))}
                      style={{ width: "100%", textAlign: "center", fontSize: "15px", fontWeight: 800, padding: "6px 4px", borderRadius: "8px", border: `1px solid ${wmsColors.borderStrong}` }}
                    />
                  </div>
                  <InfoTile label="미입고수량" value={remaining} highlight={remaining > 0} />
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)", gap: "6px", marginTop: "8px" }}>
                  <label style={{ minWidth: 0 }}>
                    <span style={{ display: "block", fontSize: "11px", color: wmsColors.muted, marginBottom: "2px" }}>입고단가(부가세 별도)</span>
                    <input
                      type="number"
                      min={0}
                      step={1}
                      inputMode="numeric"
                      value={unitPrice}
                      onChange={event => setUnitPriceValues(previous => ({ ...previous, [line.id]: Math.max(0, Math.round(Number(event.target.value) || 0)) }))}
                      style={{ width: "100%", boxSizing: "border-box", textAlign: "right", fontSize: "15px", fontWeight: 800, padding: "7px 8px", borderRadius: "8px", border: `1px solid ${wmsColors.borderStrong}` }}
                    />
                  </label>
                  <div style={{ display: "grid", gap: "3px", alignContent: "center", textAlign: "right" }}>
                    <div style={{ fontSize: "11px", color: wmsColors.muted }}>부가세 10% <strong>{Math.round(unitPrice * 0.1).toLocaleString()}원</strong></div>
                    <div style={{ fontSize: "12px", color: wmsColors.ink }}>원가(포함) <strong>{(unitPrice + Math.round(unitPrice * 0.1)).toLocaleString()}원</strong></div>
                  </div>
                </div>
                <button onClick={() => receiveAll([line])} disabled={saving || remaining === 0} style={{ ...wmsGhostButton, width: "100%", minHeight: "34px", marginTop: "8px", opacity: remaining === 0 ? 0.5 : 1 }}>
                  {remaining === 0 ? "전량입고 완료" : "전량입고"}
                </button>
                <button onClick={() => setReceivingDelay([line], !delayActive)} disabled={saving || remaining === 0} style={{ ...wmsGhostButton, width: "100%", minHeight: "34px", marginTop: "6px", color: delayActive ? wmsColors.greenDark : wmsColors.warn, opacity: remaining === 0 ? 0.5 : 1 }}>
                  {delayActive ? "입고지연 해제" : "거래처 입고지연"}
                </button>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px", marginTop: "6px" }}>
                  <button onClick={() => updateSelectedCatalog("단종", [line])} disabled={saving} style={{ ...wmsGhostButton, minHeight: "34px", background: "#f4dfd9", color: "#934633", fontSize: "12px" }}>단종대기</button>
                  <button onClick={() => updateSelectedCatalog("단종해제", [line])} disabled={saving} style={{ ...wmsGhostButton, minHeight: "34px", color: wmsColors.greenDark, fontSize: "12px" }}>해제대기</button>
                </div>
                <button onClick={() => deleteSelectedLines([line.id])} disabled={saving} style={{ width: "100%", minHeight: "34px", marginTop: "6px", border: 0, borderRadius: "9px", background: "#f4dfd9", color: "#934633", fontWeight: 800 }}>삭제</button>
              </div>
            );
          })}
        </div>

        {saveError && <p style={{ fontSize: "12px", color: "#c0392b", marginBottom: "8px" }}>{saveError}</p>}
        {saveMessage && <p style={{ fontSize: "12px", color: wmsColors.greenDark, marginBottom: "8px" }}>{saveMessage}</p>}

        <button onClick={handleSave} disabled={saving} style={{ ...wmsPrimaryButton, width: "100%", opacity: saving ? 0.6 : 1 }}>
          {saving ? "저장 중..." : "입고수량·단가 저장"}
        </button>
        <button onClick={queueSelectedReorders} disabled={saving || selectedLineIds.size === 0} style={{ ...wmsGhostButton, width: "100%", marginTop: "8px", opacity: selectedLineIds.size === 0 ? 0.5 : 1 }}>
          선택 미입고분 발주서 생성하기 ({selectedLineIds.size}종)
        </button>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", marginTop: "8px" }}>
          <button onClick={() => updateSelectedCatalog("단종")} disabled={saving || selectedLineIds.size === 0} style={{ ...wmsGhostButton, minHeight: "40px", background: "#f4dfd9", color: "#934633", opacity: selectedLineIds.size ? 1 : 0.45 }}>선택 단종대기</button>
          <button onClick={() => updateSelectedCatalog("단종해제")} disabled={saving || selectedLineIds.size === 0} style={{ ...wmsGhostButton, minHeight: "40px", color: wmsColors.greenDark, opacity: selectedLineIds.size ? 1 : 0.45 }}>선택 해제대기</button>
          <button onClick={() => setReceivingDelay(openRow.draftLines.filter(line => selectedLineIds.has(line.id)), true)} disabled={saving || selectedLineIds.size === 0} style={{ ...wmsGhostButton, minHeight: "40px", color: wmsColors.warn, opacity: selectedLineIds.size ? 1 : 0.45 }}>선택 입고지연</button>
          <button onClick={() => setReceivingDelay(openRow.draftLines.filter(line => selectedLineIds.has(line.id)), false)} disabled={saving || selectedLineIds.size === 0} style={{ ...wmsGhostButton, minHeight: "40px", color: wmsColors.greenDark, opacity: selectedLineIds.size ? 1 : 0.45 }}>선택 지연해제</button>
          <button onClick={() => updateSelectedCatalog("품절")} disabled={saving || selectedLineIds.size === 0} style={{ ...wmsGhostButton, minHeight: "40px", gridColumn: "1 / -1", opacity: selectedLineIds.size ? 1 : 0.45 }}>선택상품 현재고 0</button>
        </div>
        <button onClick={() => deleteSelectedLines(Array.from(selectedLineIds))} disabled={saving || selectedLineIds.size === 0} style={{ width: "100%", minHeight: "40px", marginTop: "8px", border: 0, borderRadius: "10px", background: "#f4dfd9", color: "#934633", fontWeight: 900, opacity: selectedLineIds.size ? 1 : 0.45 }}>선택상품 삭제 ({selectedLineIds.size})</button>
      </main>
    );
  }

  return (
    <main style={pageStyle}>
      <h1 style={{ fontSize: "20px", margin: "0 0 4px" }}>거래처 발주서 입고</h1>
      <p style={{ fontSize: "12px", color: wmsColors.muted, margin: "0 0 16px" }}>
        승인·전송완료된 거래처 발주서의 입고수량을 기록합니다. 제품DB 현재고는 자동으로 바뀌지 않습니다.
      </p>

      {rows.length === 0 ? (
        <p style={{ fontSize: "13px", color: wmsColors.muted }}>아직 승인되거나 전송완료된 거래처 발주서가 없습니다.</p>
      ) : (
        <>
          <div style={{ display: "flex", gap: "8px", marginBottom: "10px" }}>
            <button type="button" onClick={() => setSelectedDraftIds(selectedDraftIds.size === rows.length ? new Set() : new Set(rows.map(row => row.draft.id)))} style={{ ...wmsGhostButton, flex: 1, minHeight: "40px", fontSize: "12px" }}>
              {selectedDraftIds.size === rows.length ? "전체선택 해제" : "전체선택"}
            </button>
            <button type="button" disabled={deleting || selectedDraftIds.size === 0} onClick={() => deleteDrafts(Array.from(selectedDraftIds))} style={{ ...wmsGhostButton, flex: 1.4, minHeight: "40px", fontSize: "12px", color: "#934633", background: "#f4dfd9", opacity: selectedDraftIds.size === 0 ? 0.5 : 1 }}>
              선택 일괄삭제 ({selectedDraftIds.size})
            </button>
          </div>
          {saveError && <p style={{ fontSize: "12px", color: "#c0392b", margin: "0 0 8px" }}>{saveError}</p>}
          {saveMessage && <p style={{ fontSize: "12px", color: wmsColors.greenDark, margin: "0 0 8px" }}>{saveMessage}</p>}
          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            {rows.map((row, index) => (
              <div key={row.draft.id} style={{ border: `1px solid ${wmsColors.border}`, borderRadius: "16px", padding: "12px", background: index % 2 === 0 ? "#f7f4ef" : "#f1f5f2", boxShadow: "0 2px 8px rgba(60,55,48,0.05)" }}>
                <div style={{ display: "flex", alignItems: "flex-start", gap: "10px" }}>
                  <input type="checkbox" aria-label={`${row.draft.vendorName} 발주서 선택`} checked={selectedDraftIds.has(row.draft.id)} onChange={event => setSelectedDraftIds(prev => {
                    const next = new Set(prev);
                    if (event.target.checked) next.add(row.draft.id); else next.delete(row.draft.id);
                    return next;
                  })} style={{ width: "23px", height: "23px", marginTop: "2px", flexShrink: 0 }} />
                  <button type="button" onClick={() => openDetail(row.draft.id, row.draftLines)} style={{ flex: 1, minWidth: 0, padding: 0, border: 0, background: "transparent", textAlign: "left", cursor: "pointer" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
                      <strong style={{ fontSize: "14px", color: "#2685e8" }}>{row.draft.vendorName}</strong>
                      <ReceivingStatusBadge status={row.receivingStatus} />
                    </div>
                    <div style={{ fontSize: "11px", color: wmsColors.muted }}>
                      {row.draft.waveId === MANUAL_VENDOR_WORKSPACE_ID ? "웨이브 없음" : `웨이브 ${row.draft.waveId}`}
                      {row.wave ? ` · ${new Date(row.draft.approvedAt || row.draft.createdAt).toLocaleDateString("ko-KR")} 발주` : ""}
                      {" · "}{row.draft.status === "sent" ? "전송완료" : "승인완료"}
                    </div>
                    <div style={{ fontSize: "12px", fontWeight: 700, color: wmsColors.ink, marginTop: "4px" }}>{row.lineCount}종 · 총 발주수량 {row.totalQuantity}개</div>
                  </button>
                </div>
                <button type="button" disabled={deleting} onClick={() => deleteDrafts([row.draft.id])} style={{ width: "100%", minHeight: "34px", marginTop: "10px", border: 0, borderRadius: "10px", background: "#f4dfd9", color: "#934633", fontSize: "12px", fontWeight: 800, cursor: "pointer", opacity: deleting ? 0.5 : 1 }}>삭제</button>
              </div>
            ))}
          </div>
        </>
      )}
    </main>
  );
}

function ReceivingStatusBadge({ status }: { status: ReceivingStatus }) {
  const colorMap: Record<ReceivingStatus, { bg: string; text: string }> = {
    미입고: { bg: wmsColors.warnSoft, text: wmsColors.warn },
    부분입고: { bg: "#fff3e0", text: "#a6614e" },
    입고지연: { bg: "#f4dfd9", text: "#934633" },
    전량입고: { bg: wmsColors.greenSoft, text: wmsColors.greenDark },
  };
  const color = colorMap[status];
  return (
    <span style={{ fontSize: "11px", fontWeight: 700, padding: "3px 10px", borderRadius: "999px", background: color.bg, color: color.text }}>
      {status}
    </span>
  );
}

function InfoTile({ label, value, highlight }: { label: string; value: number; highlight?: boolean }) {
  return (
    <div>
      <div style={{ fontSize: "11px", color: wmsColors.muted, marginBottom: "2px" }}>{label}</div>
      <div style={{ fontSize: "15px", fontWeight: 800, color: highlight ? wmsColors.warn : wmsColors.ink }}>{value}</div>
    </div>
  );
}

const pageStyle = {
  maxWidth: WMS_MOBILE_WIDTH,
  margin: "0 auto",
  padding: "12px 12px calc(12px + env(safe-area-inset-bottom))",
  fontFamily: "sans-serif",
  background: wmsColors.background,
  color: wmsColors.ink,
  minHeight: "100vh",
} as const;
