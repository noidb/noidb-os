"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useVendorOrderRepository } from "@/lib/wms/vendor-order/context";
import { MANUAL_VENDOR_WORKSPACE_ID, UNASSIGNED_VENDOR_NAME, type VendorOrderDraft, type VendorOrderDraftLine } from "@/lib/wms/vendor-order/types";
import type { ActualInboundShortageLine } from "@/lib/wms/vendor-order/actual-inbound-shortage";
import { WMS_MOBILE_WIDTH, wmsColors, wmsPrimaryButton, wmsGhostButton } from "@/lib/wms/ui-tokens";

/**
 * needsConfirmation: 발주서리스트가 입고예정일보다 24시간 이상 지난 뒤 재확인된 적이 없는 라인은
 * 진짜 미납인지 단정할 수 없다("확인필요") — API(actual-inbound-shortage/route.ts)에서 계산해
 * 붙여준다. 계산 로직 자체(ActualInboundShortageLine)는 변경하지 않고 API 응답에서만 확장한다.
 */
type ShortageLine = ActualInboundShortageLine & { needsConfirmation: boolean };
type Classification = "vendor" | "discontinue" | "reorder";
type SnapshotConflict = { purchaseOrderNumber: string; snapshotTime: string; sourceFileNames: string[] };

/**
 * "실제 미납 처리" 화면 (2026-09-11 신규).
 *
 * Supplier Hub 발주서리스트의 실제 입고결과(확정수량-실제입고수량)로 계산한 진짜 미납 SKU를
 * 보여주고, 선택한 라인을 거래처별 발주서 초안(웨이브 없는 수동 작업공간, MANUAL_VENDOR_WORKSPACE_ID)
 * 으로 보낸다. 기존 picking shortage 자동계산(aggregate.ts/recalculate.ts)과는 완전히 분리된
 * 별도 경로이며, 12개 단위 올림도 적용하지 않는다. 이후 카카오톡 이미지 공유·엑셀 다운로드·승인은
 * 기존 거래처 발주서 화면(app/wms/picking/waves/[waveId]/vendor-orders)을 그대로 재사용한다.
 *
 * 2026-09-11(2차): 각 라인에 "단종 처리" 버튼을 추가 — 새 단종 시스템을 만들지 않고 기존
 * receiving/status-requests 화면과 완전히 같은 API(vendor-order-actions, action:"status")를
 * 그대로 호출한다. 단종 처리된 SKU는 computeActualInboundShortageLines가 제품DB 현재상태로
 * 걸러내 다음부터 이 목록/거래처 발주 대상에 다시 나타나지 않는다.
 */
function keyOf(purchaseOrderNumber: string, productCode: string): string {
  return `${purchaseOrderNumber}::${productCode}`;
}

export default function ActualInboundShortage({ pendingOnly = false }: { pendingOnly?: boolean }) {
  const vendorOrderRepository = useVendorOrderRepository();

  const [lines, setLines] = useState<ShortageLine[]>([]);
  const [existingKeys, setExistingKeys] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [classifications, setClassifications] = useState<Record<string, Classification>>({});
  const [failures, setFailures] = useState<Record<string, string>>({});
  const [creating, setCreating] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [sourceFile, setSourceFile] = useState<string | null>(null);
  const [snapshotConflicts, setSnapshotConflicts] = useState<SnapshotConflict[]>([]);
  /** 발주서 생성 성공 후 다음 화면으로 바로 넘어갈 수 있는 버튼을 보여줄지 (2026-09-11 신규 —
   *  생성 후 문구만 나오고 다음 동작이 안 보여 "멈춘 것처럼" 보인다는 피드백 반영). */
  const [justCreated, setJustCreated] = useState(false);
  /** 단종 처리 진행 중인 라인 키(중복 클릭 방지, 2026-09-11 신규). */
  const [discontinuing, setDiscontinuing] = useState<Set<string>>(new Set());
  /** NOID-B OS는 1인 운영 시스템이라 매번 처리자 이름을 입력받지 않는다(2026-09-11 제거) —
   *  이력 기록용 고정값만 채운다. */
  const DISCONTINUE_OPERATOR = "자동";

  async function reload() {
    setLoading(true);
    setError(null);
    try {
      const [response, allLines] = await Promise.all([
        fetch(`/api/wms/vendor-orders/actual-inbound-shortage${pendingOnly ? "?pending=1" : ""}`, { cache: "no-store" }),
        vendorOrderRepository.listAllLines(),
      ]);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "실제 미납 목록을 불러오지 못했습니다.");
      setLines(data.lines || []);
      setSourceFile(data.inboundHistorySourceFile || null);
      setSnapshotConflicts(data.snapshotConflicts || []);
      setExistingKeys(new Set(
        allLines
          .filter(line => line.sourceType === "actual-inbound-shortage")
          .flatMap(line => line.relatedPurchaseOrderNumbers.map(po => keyOf(po, line.skuId)))
      ));
      setSelected(new Set());
      setClassifications({});
      setFailures({});
    } catch (err) {
      setError(err instanceof Error ? err.message : "실제 미납 목록을 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * 단종 처리 (2026-09-11 신규) — 새 단종 시스템을 만들지 않고 기존 receiving/status-requests
   * 화면이 쓰는 것과 완전히 같은 API(/api/wms/vendor-order-actions, action:"status")를 그대로
   * 호출한다. 제품DB(구글시트) "현재상태"를 즉시 "단종"으로 바꾸고, Supply Hub 발주중단
   * "처리대기" 이력을 남긴다 — Supplier Hub(쿠팡)에는 아무것도 쓰지 않는다(그런 쓰기 기능
   * 자체가 이 코드베이스에 없음). 이후 실제 쿠팡 발주중단은 사용자가 Supply Hub에서 직접
   * 처리하고, "단종/해제 SKU" 화면(status-requests)에서 처리완료로 표시한다.
   * 단종 처리된 SKU는 computeActualInboundShortageLines가 제품DB 현재상태로 걸러내므로
   * 다음 새로고침부터 이 목록/거래처 발주 대상에 다시 나타나지 않는다.
   *
   * 2026-09-11(정정): 단종 이력은 미납 lineage(원발주번호/실제미납수량)와 연결하지 않는다 —
   * 단종은 "미납분 재발주요청" 대상이 아니라는 사용자 확정 규칙에 따라, 이 호출은 SKU 기준
   * 단종 처리만 요청한다(기존 receiving 화면의 단종 버튼과 완전히 동일한 최소 요청).
   */
  async function handleDiscontinue(row: ActualInboundShortageLine) {
    const key = keyOf(row.purchaseOrderNumber, row.productCode);
    setDiscontinuing(previous => new Set(previous).add(key));
    setMessage(null);
    try {
      const response = await fetch("/api/wms/vendor-order-actions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "status",
          skuId: row.productCode,
          requestType: "단종",
          operator: DISCONTINUE_OPERATOR,
        }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || "단종 처리에 실패했습니다.");
      return;
    } catch (err) {
      throw err instanceof Error ? err : new Error("단종 처리 중 오류가 발생했습니다.");
    } finally {
      setDiscontinuing(previous => {
        const next = new Set(previous);
        next.delete(key);
        return next;
      });
    }
  }

  const rows = useMemo(
    () => lines.filter(row => !existingKeys.has(keyOf(row.purchaseOrderNumber, row.productCode))).sort((a, b) => a.vendorName.localeCompare(b.vendorName, "ko") || a.productCode.localeCompare(b.productCode)),
    [lines, existingKeys]
  );

  const counts = useMemo(() => rows.reduce((result, row) => {
    const classification = classifications[keyOf(row.purchaseOrderNumber, row.productCode)];
    if (classification) result[classification]++;
    else if (!row.needsConfirmation) result.unclassified++;
    return result;
  }, { vendor: 0, discontinue: 0, reorder: 0, unclassified: 0 }), [rows, classifications]);

  function toggle(key: string, alreadyAdded: boolean, needsConfirmation: boolean) {
    if (alreadyAdded || needsConfirmation) return;
    setSelected(previous => {
      const next = new Set(previous);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function classify(keys: Iterable<string>, classification: Classification) {
    setClassifications(previous => {
      const next = { ...previous };
      for (const key of keys) next[key] = classification;
      return next;
    });
  }

  async function createVendorOrders(targets: ShortageLine[]) {
    if (targets.length === 0) return;
    const now = new Date().toISOString();
      const existingDrafts = await vendorOrderRepository.listDrafts(MANUAL_VENDOR_WORKSPACE_ID);
      const draftByVendor = new Map(existingDrafts.map(draft => [draft.vendorName, draft]));

      const vendorNames = new Set(targets.map(row => row.vendorName || UNASSIGNED_VENDOR_NAME));
      for (const vendorName of vendorNames) {
        if (draftByVendor.has(vendorName)) continue;
        const draft: VendorOrderDraft = {
          id: `${MANUAL_VENDOR_WORKSPACE_ID}::${vendorName}`,
          waveId: MANUAL_VENDOR_WORKSPACE_ID,
          vendorName,
          status: "draft",
          createdAt: now,
          updatedAt: now,
        };
        await vendorOrderRepository.saveDraft(draft);
        draftByVendor.set(vendorName, draft);
      }

      for (const row of targets) {
        const vendorName = row.vendorName || UNASSIGNED_VENDOR_NAME;
        const draftId = `${MANUAL_VENDOR_WORKSPACE_ID}::${vendorName}`;
        const line: VendorOrderDraftLine = {
          id: `${draftId}::actual::${row.purchaseOrderNumber}::${row.productCode}`,
          draftId,
          waveId: MANUAL_VENDOR_WORKSPACE_ID,
          vendorName,
          skuId: row.productCode,
          modelName: row.modelName,
          category: row.category,
          optionLabel: row.optionLabel,
          productName: row.productName,
          imageUrl: row.imageUrl,
          barcode: row.barcode,
          actualShortageQuantity: row.shortageQuantity,
          shortageQuantity: row.shortageQuantity, // 실제 미납수량 그대로 — 12개 단위 올림 미적용
          currentStock: "",
          relatedPurchaseOrderNumbers: [row.purchaseOrderNumber],
          memo: "",
          isManuallyAdded: true,
          sourceType: "actual-inbound-shortage",
          coupangConfirmedQuantity: row.confirmedQuantity,
          coupangReceivedQuantity: row.receivedQuantity,
          createdAt: now,
          updatedAt: now,
        };
        await vendorOrderRepository.saveLine(line);
      }

    setJustCreated(true);
  }

  async function queueReorder(row: ShortageLine) {
    const response = await fetch("/api/wms/vendor-orders/actual-inbound-shortage", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "reorder", purchaseOrderNumber: row.purchaseOrderNumber, skuId: row.productCode }),
    });
    const data = await response.json();
    if (!response.ok || !data.success) throw new Error(data.error || "미납분 재발주 연결에 실패했습니다.");
  }

  async function executeClassifications() {
    const targets = rows.filter(row => classifications[keyOf(row.purchaseOrderNumber, row.productCode)] && !row.needsConfirmation);
    if (!targets.length) return;
    setCreating(true); setMessage(null); setFailures({}); setJustCreated(false);
    const failed: Record<string, string> = {};
    let completed = 0;
    try {
      const vendorTargets = targets.filter(row => classifications[keyOf(row.purchaseOrderNumber, row.productCode)] === "vendor");
      if (vendorTargets.length) {
        try { await createVendorOrders(vendorTargets); completed += vendorTargets.length; }
        catch (error) { for (const row of vendorTargets) failed[keyOf(row.purchaseOrderNumber, row.productCode)] = error instanceof Error ? error.message : "거래처 발주서 생성 실패"; }
      }
      const discontinuedBySku = new Map<string, ShortageLine>();
      for (const row of targets.filter(row => classifications[keyOf(row.purchaseOrderNumber, row.productCode)] === "discontinue")) if (!discontinuedBySku.has(row.productCode)) discontinuedBySku.set(row.productCode, row);
      for (const row of discontinuedBySku.values()) {
        const sameSku = targets.filter(item => item.productCode === row.productCode && classifications[keyOf(item.purchaseOrderNumber, item.productCode)] === "discontinue");
        try { await handleDiscontinue(row); completed += sameSku.length; }
        catch (error) { for (const item of sameSku) failed[keyOf(item.purchaseOrderNumber, item.productCode)] = error instanceof Error ? error.message : "단종 처리 실패"; }
      }
      for (const row of targets.filter(row => classifications[keyOf(row.purchaseOrderNumber, row.productCode)] === "reorder")) {
        const key = keyOf(row.purchaseOrderNumber, row.productCode);
        try {
          await queueReorder(row);
          completed++;
        } catch (error) { failed[key] = error instanceof Error ? error.message : "처리 실패"; }
      }
      setFailures(failed);
      setMessage(Object.keys(failed).length ? `${completed}건 처리, ${Object.keys(failed).length}건 실패했습니다. 실패 사유를 확인해 주세요.` : `${completed}건을 분류대로 처리했습니다.`);
      await reload();
      if (Object.keys(failed).length) {
        setFailures(failed);
        setClassifications(Object.fromEntries(Object.keys(failed).map(key => [key, classifications[key]])) as Record<string, Classification>);
      }
    } finally { setCreating(false); }
  }

  return (
    <main style={{ maxWidth: WMS_MOBILE_WIDTH, margin: "0 auto", padding: "12px 12px calc(12px + env(safe-area-inset-bottom))", fontFamily: "sans-serif", background: wmsColors.background, color: wmsColors.ink, minHeight: "100vh" }}>
      <Link href="/wms/vendor-orders" style={{ color: wmsColors.slateDark, fontSize: "13px" }}>← 거래처 발주관리</Link>
      <h1 style={{ fontSize: "20px", margin: "10px 0 4px" }}>{pendingOnly ? "과거청산 · 미처리 미납 SKU 분류" : "실제 미납 처리"}</h1>
      <p style={{ fontSize: "12px", color: wmsColors.muted, margin: "0 0 14px" }}>
        Supplier Hub 발주서리스트의 확정수량-실제입고수량 기준 실제 미납 SKU입니다. 피킹 부족분과는
        별개입니다. 각 SKU를 거래처발주·단종·미납분 재발주 중 하나로 먼저 분류하며, 미분류 SKU는 처리하지 않습니다.
        {sourceFile && <><br />입고상세내역 반영 파일: {sourceFile}</>}
      </p>
      {snapshotConflicts.map(conflict => <p key={conflict.purchaseOrderNumber} style={{ padding: "9px", borderRadius: "8px", background: "#fff2dc", color: "#8a6100", fontSize: "11px", lineHeight: 1.6 }}>
        확인필요 · 발주 {conflict.purchaseOrderNumber}의 동일 시각 원본 내용이 다릅니다: {conflict.sourceFileNames.join(" / ")}
      </p>)}

      {loading ? (
        <p style={{ color: wmsColors.muted, fontSize: "13px" }}>불러오는 중...</p>
      ) : error ? (
        <p style={{ color: "#c0392b", fontSize: "13px" }}>{error}</p>
      ) : rows.length === 0 ? (
        <p style={{ color: wmsColors.muted, fontSize: "13px" }}>현재 실제 미납으로 확인된 SKU가 없습니다.</p>
      ) : (
        <>
          {message && <p style={{ fontSize: "12px", color: wmsColors.greenDark, marginBottom: "8px" }}>{message}</p>}
          {justCreated && (
            <Link href={`/wms/picking/waves/${MANUAL_VENDOR_WORKSPACE_ID}/vendor-orders`} style={{ display: "block", textDecoration: "none", marginBottom: "14px" }}>
              <button type="button" style={{ ...wmsPrimaryButton, width: "100%" }}>거래처 발주서 확인하러 가기 →</button>
            </Link>
          )}
          <div style={{ padding: "10px", border: `1px solid ${wmsColors.border}`, borderRadius: "10px", background: "#fff", marginBottom: "10px", fontSize: "12px", lineHeight: 1.7 }}>
            <strong>실행 전 분류 확인</strong><br />
            거래처발주 {counts.vendor}건 · 단종 {counts.discontinue}건 · 미납분 재발주 {counts.reorder}건 · 미분류 {counts.unclassified}건
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "6px", marginTop: "8px" }}>
              <button type="button" disabled={!selected.size || creating} onClick={() => classify(selected, "vendor")} style={{ ...wmsGhostButton, padding: "8px 3px", fontSize: "11px" }}>선택 → 거래처발주</button>
              <button type="button" disabled={!selected.size || creating} onClick={() => classify(selected, "discontinue")} style={{ ...wmsGhostButton, padding: "8px 3px", fontSize: "11px" }}>선택 → 단종</button>
              <button type="button" disabled={!selected.size || creating} onClick={() => classify(selected, "reorder")} style={{ ...wmsGhostButton, padding: "8px 3px", fontSize: "11px" }}>선택 → 미납분 재발주</button>
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginBottom: "14px" }}>
            {rows.map(row => {
              const key = keyOf(row.purchaseOrderNumber, row.productCode);
              const alreadyAdded = existingKeys.has(key);
              const needsConfirmation = row.needsConfirmation;
              return (
                <label
                  key={key}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "24px 1fr",
                    gap: "10px",
                    alignItems: "flex-start",
                    padding: "10px",
                    border: needsConfirmation ? `1px solid #d8b26a` : `1px solid ${wmsColors.border}`,
                    borderRadius: "12px",
                    background: needsConfirmation ? "#fff8ea" : alreadyAdded ? wmsColors.surfaceBeige : "#fff",
                    opacity: alreadyAdded ? 0.6 : 1,
                  }}
                >
                  <input
                    type="checkbox"
                    checked={selected.has(key)}
                    disabled={alreadyAdded || needsConfirmation}
                    onChange={() => toggle(key, alreadyAdded, needsConfirmation)}
                    style={{ width: "20px", height: "20px", marginTop: "2px" }}
                  />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: "11px", color: wmsColors.muted }}>원발주번호 {row.purchaseOrderNumber} · SKU {row.productCode}</div>
                    <div style={{ fontSize: "13px", fontWeight: 700, marginTop: "2px" }}>{row.productName}{row.optionLabel ? ` · ${row.optionLabel}` : ""}</div>
                    <div style={{ fontSize: "12px", marginTop: "4px" }}>
                      확정 <strong>{row.confirmedQuantity}</strong> · 실제입고 <strong>{row.receivedQuantity}</strong> · 미납 <strong style={{ color: wmsColors.warn }}>{row.shortageQuantity}</strong>
                    </div>
                    <div style={{ fontSize: "11px", color: wmsColors.slateDark, marginTop: "2px" }}>
                      거래처 {row.vendorName}{alreadyAdded ? " · 이미 발주서에 추가됨" : ""}
                    </div>
                    {needsConfirmation && (
                      <div style={{ fontSize: "11px", color: "#8a6100", fontWeight: 700, marginTop: "4px" }}>
                        ⚠ 확인필요 — 입고예정일 이후 재확인된 최신 발주서 스냅샷이 없어 자동 처리 대상에서 제외됨
                      </div>
                    )}
                    {!needsConfirmation && <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "5px", marginTop: "8px" }}>
                      {([['vendor','거래처발주'],['discontinue','단종'],['reorder','미납분 재발주']] as Array<[Classification,string]>).map(([value, label]) => <button
                        key={value} type="button" disabled={creating || discontinuing.has(key)}
                        onClick={event => { event.preventDefault(); event.stopPropagation(); classify([key], value); }}
                        style={{ minHeight: "36px", padding: "4px", border: classifications[key] === value ? `2px solid ${wmsColors.greenDark}` : `1px solid ${wmsColors.border}`, borderRadius: "8px", background: classifications[key] === value ? wmsColors.surfaceBeige : "#fff", color: wmsColors.ink, fontSize: "10px", fontWeight: 800 }}
                      >{label}</button>)}
                    </div>}
                    {failures[key] && <div style={{ marginTop: "6px", color: "#c0392b", fontSize: "11px", fontWeight: 700 }}>실패: {failures[key]}</div>}
                  </div>
                </label>
              );
            })}
          </div>
          <button
            type="button"
            disabled={creating || counts.vendor + counts.discontinue + counts.reorder === 0}
            onClick={() => void executeClassifications()}
            style={{ ...wmsPrimaryButton, width: "100%", opacity: creating || counts.vendor + counts.discontinue + counts.reorder === 0 ? 0.5 : 1 }}
          >
            {creating ? "처리 중..." : `분류대로 실행 (${counts.vendor + counts.discontinue + counts.reorder})`}
          </button>
          <button type="button" onClick={() => void reload()} disabled={loading} style={{ ...wmsGhostButton, width: "100%", marginTop: "8px" }}>
            새로고침
          </button>
        </>
      )}
    </main>
  );
}
