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

type ReceivingStatus = "미입고" | "부분입고" | "전량입고";

function computeReceivingStatus(lines: VendorOrderDraftLine[]): ReceivingStatus {
  const totalOrdered = lines.reduce((sum, line) => sum + line.shortageQuantity, 0);
  const totalReceived = lines.reduce((sum, line) => sum + Math.min(line.receivedQuantity || 0, line.shortageQuantity), 0);
  if (totalReceived <= 0) return "미입고";
  if (totalReceived >= totalOrdered) return "전량입고";
  return "부분입고";
}

export default function VendorOrderReceivingPage() {
  const waveRepository = usePickingWaveRepository();
  const vendorOrderRepository = useVendorOrderRepository();

  const [loading, setLoading] = useState(true);
  const [waves, setWaves] = useState<PickingWave[]>([]);
  const [drafts, setDrafts] = useState<VendorOrderDraft[]>([]);
  const [lines, setLines] = useState<VendorOrderDraftLine[]>([]);
  const [openDraftId, setOpenDraftId] = useState<string | null>(null);
  const [editValues, setEditValues] = useState<Record<string, number>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [selectedLineIds, setSelectedLineIds] = useState<Set<string>>(new Set());
  const [liveCatalog, setLiveCatalog] = useState<LiveCatalogLookup>(new Map());

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
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
        return {
          ...line,
          receivedQuantity,
          reorderPendingQuantity: receivedQuantity >= line.shortageQuantity ? 0 : line.reorderPendingQuantity,
          reorderRequestedAt: receivedQuantity >= line.shortageQuantity ? undefined : line.reorderRequestedAt,
          updatedAt: now,
        };
      });
      await Promise.all(updatedLines.map(line => vendorOrderRepository.saveLine(line)));
      setLines(prev => prev.map(line => updatedLines.find(u => u.id === line.id) ?? line));
      setSaveMessage("입고수량을 저장했습니다.");
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
      setSaveMessage(message);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "입고 처리 저장에 실패했습니다.");
    } finally {
      setSaving(false);
    }
  }

  async function receiveAll(linesToReceive: VendorOrderDraftLine[]) {
    const now = new Date().toISOString();
    await saveUpdatedLines(linesToReceive.map(line => ({
      ...line,
      receivedQuantity: line.shortageQuantity,
      reorderPendingQuantity: 0,
      reorderRequestedAt: undefined,
      updatedAt: now,
    })), "전량입고 처리했습니다.");
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
        <p style={{ fontSize: "11px", color: wmsColors.warn, background: wmsColors.warnSoft, borderRadius: "8px", padding: "8px 10px", margin: "8px 0 14px" }}>
          여기서 저장한 입고수량은 제품DB(구글시트) 현재고에 자동으로 반영되지 않습니다 — 발주서별 입고 기록만 저장합니다.
        </p>

        <button onClick={() => receiveAll(openRow.draftLines)} disabled={saving} style={{ ...wmsPrimaryButton, width: "100%", marginBottom: "12px", opacity: saving ? 0.6 : 1 }}>
          전체 상품 전량입고
        </button>

        <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginBottom: "16px" }}>
          {openRow.draftLines.map(line => {
            const { name, option } = resolveDisplayNameAndOption(line.productName, line.optionLabel);
            const received = editValues[line.id] ?? 0;
            const remaining = Math.max(0, line.shortageQuantity - received);
            const live = liveCatalog.get(line.skuId);
            const driveFallbackUrl = `/api/wms/product-image/from-drive?model=${encodeURIComponent(live?.modelName || line.modelName || line.skuId)}`;
            const imageUrl = getWmsDisplayImageUrl(live?.imageUrl || line.imageUrl) || driveFallbackUrl;
            return (
              <div key={line.id} style={{ border: `1px solid ${wmsColors.border}`, borderRadius: "12px", padding: "10px", background: "#ffffff" }}>
                <div style={{ display: "flex", gap: "10px" }}>
                  <input
                    type="checkbox"
                    aria-label={`${name} 미입고 재발주 선택`}
                    checked={selectedLineIds.has(line.id)}
                    disabled={remaining <= 0}
                    onChange={event => setSelectedLineIds(prev => {
                      const next = new Set(prev);
                      if (event.target.checked) next.add(line.id); else next.delete(line.id);
                      return next;
                    })}
                    style={{ width: "22px", height: "22px", alignSelf: "center", flexShrink: 0 }}
                  />
                  <img
                    src={imageUrl}
                    alt={name}
                    width={56}
                    height={56}
                    onError={event => {
                      if (!event.currentTarget.src.includes("/api/wms/product-image/from-drive")) event.currentTarget.src = driveFallbackUrl;
                    }}
                    style={{ width: "56px", height: "56px", borderRadius: "8px", objectFit: "cover", flexShrink: 0, background: wmsColors.surfaceBeige }}
                  />
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: "13px", fontWeight: 700, whiteSpace: "normal", wordBreak: "keep-all", lineHeight: 1.3 }}>{name}</div>
                    <div style={{ fontSize: "12px", fontWeight: 700, color: wmsColors.greenDark, marginTop: "2px" }}>{option || "옵션 없음"}</div>
                    <div style={{ fontSize: "10px", color: wmsColors.muted, marginTop: "2px" }}>SKU {line.skuId}</div>
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
                <button onClick={() => receiveAll([line])} disabled={saving || remaining === 0} style={{ ...wmsGhostButton, width: "100%", minHeight: "34px", marginTop: "8px", opacity: remaining === 0 ? 0.5 : 1 }}>
                  {remaining === 0 ? "전량입고 완료" : "전량입고"}
                </button>
              </div>
            );
          })}
        </div>

        {saveError && <p style={{ fontSize: "12px", color: "#c0392b", marginBottom: "8px" }}>{saveError}</p>}
        {saveMessage && <p style={{ fontSize: "12px", color: wmsColors.greenDark, marginBottom: "8px" }}>{saveMessage}</p>}

        <button onClick={handleSave} disabled={saving} style={{ ...wmsPrimaryButton, width: "100%", opacity: saving ? 0.6 : 1 }}>
          {saving ? "저장 중..." : "입고수량 저장"}
        </button>
        <button onClick={queueSelectedReorders} disabled={saving || selectedLineIds.size === 0} style={{ ...wmsGhostButton, width: "100%", marginTop: "8px", opacity: selectedLineIds.size === 0 ? 0.5 : 1 }}>
          선택 미입고분 발주서 생성하기 ({selectedLineIds.size}종)
        </button>
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
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          {rows.map(row => (
            <button
              key={row.draft.id}
              onClick={() => openDetail(row.draft.id, row.draftLines)}
              style={{ display: "block", width: "100%", textAlign: "left", border: `1px solid ${wmsColors.border}`, borderRadius: "12px", padding: "12px", background: "#ffffff", cursor: "pointer" }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
                <strong style={{ fontSize: "14px" }}>{row.draft.vendorName}</strong>
                <ReceivingStatusBadge status={row.receivingStatus} />
              </div>
              <div style={{ fontSize: "11px", color: wmsColors.muted }}>
                {row.draft.waveId === MANUAL_VENDOR_WORKSPACE_ID ? "웨이브 없음" : `웨이브 ${row.draft.waveId}`}
                {row.wave ? ` · ${new Date(row.draft.approvedAt || row.draft.createdAt).toLocaleDateString("ko-KR")} 발주` : ""}
                {" · "}
                {row.draft.status === "sent" ? "전송완료" : "승인완료"}
              </div>
              <div style={{ fontSize: "12px", color: wmsColors.ink, marginTop: "4px" }}>
                {row.lineCount}종 · 총 발주수량 {row.totalQuantity}개
              </div>
            </button>
          ))}
        </div>
      )}
    </main>
  );
}

function ReceivingStatusBadge({ status }: { status: ReceivingStatus }) {
  const colorMap: Record<ReceivingStatus, { bg: string; text: string }> = {
    미입고: { bg: wmsColors.warnSoft, text: wmsColors.warn },
    부분입고: { bg: "#fff3e0", text: "#a6614e" },
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
