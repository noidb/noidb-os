"use client";

import { useEffect, useMemo, useState } from "react";
import { usePickingWaveRepository } from "@/lib/wms/picking-wave/context";
import { useVendorOrderRepository } from "@/lib/wms/vendor-order/context";
import {
  MANUAL_VENDOR_WORKSPACE_ID,
  UNASSIGNED_VENDOR_NAME,
  VENDOR_ORDER_STATUS_LABEL,
  type VendorOrderDraft,
  type VendorOrderDraftLine,
  type VendorOrderDraftStatus,
} from "@/lib/wms/vendor-order/types";
import type { PickingWave } from "@/lib/wms/picking-wave/types";
import { PICKING_WAVE_STATUS_LABEL } from "@/lib/wms/picking-wave/status-label";
import { WMS_MOBILE_WIDTH, wmsColors, wmsPrimaryButton, wmsGhostButton } from "@/lib/wms/ui-tokens";
import { useWmsUndo } from "@/lib/wms/undo-context";

/**
 * 전체 웨이브를 가로지르는 거래처 발주서 관리 목록 (2026-08-19 4차 실사용 테스트 신규).
 * 기존 웨이브별 거래처 발주서 화면(app/wms/picking/waves/[waveId]/vendor-orders)을 다시 만들지
 * 않고, 그 화면들의 목록만 여기서 한눈에 보여준다 — 발주서를 누르면 기존 화면으로 그대로 이동.
 * 저장소는 lib/wms/vendor-order의 listAllDrafts/listAllLines(이번에 추가한 조회 전용 메서드)만
 * 쓰고, 새로운 저장 로직은 전혀 추가하지 않았다.
 */
export default function VendorOrderManageListPage() {
  const waveRepository = usePickingWaveRepository();
  const vendorOrderRepository = useVendorOrderRepository();
  const { pushUndo } = useWmsUndo();

  const [loading, setLoading] = useState(true);
  const [waves, setWaves] = useState<PickingWave[]>([]);
  const [drafts, setDrafts] = useState<VendorOrderDraft[]>([]);
  const [lines, setLines] = useState<VendorOrderDraftLine[]>([]);
  const [selectedDraftIds, setSelectedDraftIds] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function reload() {
    const [loadedWaves, loadedDrafts, loadedLines] = await Promise.all([
      waveRepository.listWaves(), vendorOrderRepository.listAllDrafts(), vendorOrderRepository.listAllLines(),
    ]);
    setWaves(loadedWaves); setDrafts(loadedDrafts); setLines(loadedLines);
  }

  useEffect(() => {
    (async () => {
      try {
        await reload();
      } finally {
        setLoading(false);
      }
    })();
  }, [waveRepository, vendorOrderRepository]);

  const waveById = useMemo(() => new Map(waves.map(wave => [wave.id, wave])), [waves]);

  const rows = useMemo(() => {
    return drafts
      .map(draft => {
        const draftLines = lines.filter(line => line.draftId === draft.id);
        const totalQuantity = draftLines.reduce((sum, line) => sum + line.shortageQuantity, 0);
        const wave = draft.waveId === MANUAL_VENDOR_WORKSPACE_ID ? null : waveById.get(draft.waveId);
        return { draft, lineCount: draftLines.length, totalQuantity, wave };
      })
      .filter(row => row.lineCount > 0) // 라인이 하나도 없는(부족분이 0으로 회귀한) 자동 초안은 숨긴다
      .sort((a, b) => b.draft.updatedAt.localeCompare(a.draft.updatedAt));
  }, [drafts, lines, waveById]);

  async function deleteDrafts(draftIds: string[]) {
    if (draftIds.length === 0 || deleting) return;
    if (!window.confirm(`${draftIds.length}개 발주서를 삭제할까요? 삭제 후 상단 되돌리기로 복원할 수 있습니다.`)) return;
    const deletedDrafts = drafts.filter(draft => draftIds.includes(draft.id));
    const deletedLines = lines.filter(line => draftIds.includes(line.draftId));
    setDeleting(true);
    try {
      await Promise.all(draftIds.map(id => vendorOrderRepository.deleteDraft(id)));
      pushUndo("발주서 삭제", async () => {
        await Promise.all(deletedDrafts.map(draft => vendorOrderRepository.saveDraft(draft)));
        await Promise.all(deletedLines.map(line => vendorOrderRepository.saveLine(line)));
        await reload();
      });
      setSelectedDraftIds(new Set());
      setMessage(`${draftIds.length}개 발주서를 삭제했습니다.`);
      await reload();
    } finally { setDeleting(false); }
  }

  if (loading) {
    return (
      <main style={pageStyle}>
        <p style={{ color: wmsColors.muted }}>불러오는 중...</p>
      </main>
    );
  }

  return (
    <main style={pageStyle}>
      <h1 style={{ fontSize: "20px", margin: "0 0 4px" }}>거래처 발주서 생성</h1>
      <p style={{ fontSize: "12px", color: wmsColors.muted, margin: "0 0 16px" }}>
        전체 웨이브의 거래처 발주서를 한눈에 확인합니다. 각 발주서를 누르면 기존에 테스트한 초안·상세
        화면으로 바로 이동합니다.
      </p>

      <a href={`/wms/picking/waves/${MANUAL_VENDOR_WORKSPACE_ID}/vendor-orders`} style={{ display: "block", textDecoration: "none", marginBottom: "16px" }}>
        <button style={{ ...wmsPrimaryButton, width: "100%" }}>+ 웨이브 없이 새 거래처 발주서 만들기</button>
      </a>

      {rows.length === 0 ? (
        <p style={{ fontSize: "13px", color: wmsColors.muted }}>아직 거래처 발주서가 없습니다.</p>
      ) : (
        <>
          <div style={{ display: "flex", gap: "8px", marginBottom: "10px" }}>
            <button onClick={() => setSelectedDraftIds(selectedDraftIds.size === rows.length ? new Set() : new Set(rows.map(row => row.draft.id)))} style={{ ...wmsGhostButton, flex: 1, minHeight: "40px", fontSize: "12px" }}>{selectedDraftIds.size === rows.length ? "전체해제" : "전체선택"}</button>
            <button disabled={selectedDraftIds.size === 0 || deleting} onClick={() => deleteDrafts(Array.from(selectedDraftIds))} style={{ ...wmsGhostButton, flex: 1.3, minHeight: "40px", fontSize: "12px", background: "#f4dfd9", color: "#934633", opacity: selectedDraftIds.size ? 1 : 0.5 }}>선택 일괄삭제 ({selectedDraftIds.size})</button>
          </div>
          {message && <p style={{ fontSize: "12px", color: wmsColors.greenDark }}>{message}</p>}
          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          {rows.map((row, index) => (
              <div key={row.draft.id} style={{ border: `1px solid ${wmsColors.border}`, borderRadius: "16px", padding: "12px", background: index % 2 === 0 ? "#f7f4ef" : "#f1f5f2" }}>
                <div style={{ display: "flex", gap: "10px", alignItems: "flex-start" }}>
                  <input type="checkbox" checked={selectedDraftIds.has(row.draft.id)} onChange={event => setSelectedDraftIds(previous => { const next = new Set(previous); if (event.target.checked) next.add(row.draft.id); else next.delete(row.draft.id); return next; })} style={{ width: "23px", height: "23px", flexShrink: 0 }} />
                  <a href={`/wms/picking/waves/${row.draft.waveId}/vendor-orders`} style={{ flex: 1, minWidth: 0, textDecoration: "none", color: "inherit" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
                  <strong style={{ fontSize: "14px" }}>{row.draft.vendorName}</strong>
                  <StatusBadge status={row.draft.status} />
                </div>
                <div style={{ fontSize: "11px", color: wmsColors.muted }}>
                  {row.draft.waveId === MANUAL_VENDOR_WORKSPACE_ID ? (
                    "웨이브 없음 (수동)"
                  ) : (
                    <>
                      웨이브 {row.draft.waveId}
                      {row.wave ? ` · ${PICKING_WAVE_STATUS_LABEL[row.wave.status]}` : " · 삭제된 웨이브"}
                    </>
                  )}
                </div>
                <div style={{ fontSize: "12px", color: wmsColors.ink, marginTop: "4px" }}>
                  {row.lineCount}종 · 총 {row.totalQuantity}개
                  {row.draft.vendorName === UNASSIGNED_VENDOR_NAME && " · 거래처 확인 필요"}
                </div>
                  </a>
                </div>
                <button disabled={deleting} onClick={() => deleteDrafts([row.draft.id])} style={{ width: "100%", minHeight: "34px", marginTop: "10px", border: 0, borderRadius: "10px", background: "#f4dfd9", color: "#934633", fontWeight: 800 }}>삭제</button>
              </div>
          ))}
          </div>
        </>
      )}
    </main>
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

const pageStyle = {
  maxWidth: WMS_MOBILE_WIDTH,
  margin: "0 auto",
  padding: "12px 12px calc(12px + env(safe-area-inset-bottom))",
  fontFamily: "sans-serif",
  background: wmsColors.background,
  color: wmsColors.ink,
  minHeight: "100vh",
} as const;
