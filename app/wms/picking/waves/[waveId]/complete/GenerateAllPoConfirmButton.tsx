"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { readFileAsBase64 } from "@/lib/wms/file-base64";
import { buildDefaultConfirmedQuantities, buildPoConfirmRows, type PoConfirmRow } from "@/lib/wms/picking-wave/po-confirm-rows";
import { useActivePickingWaveRepository } from "@/lib/wms/picking-wave/context";
import type { BasketAssignment, PickingWave, PickingWaveItem } from "@/lib/wms/picking-wave/types";
import {
  clearPoConfirmationErrors,
  collectConfirmedPurchaseOrderNumbers,
  listPoConfirmationRecords,
  upsertPoConfirmationRecords,
  type PoConfirmationRecord,
} from "@/lib/wms/po-confirm-state";
import { wmsColors, wmsPrimaryButton, wmsSecondaryButton } from "@/lib/wms/ui-tokens";
import PoConfirmSection, { type PoConfirmCardStage, type PoConfirmSourceSummary } from "./PoConfirmSection";
import { closeReservedDownloadTarget, downloadBlobPreservingPage, reserveDownloadTarget } from "@/lib/wms/download-client";

interface Props {
  wave: PickingWave;
  items: PickingWaveItem[];
  baskets: BasketAssignment[];
  onWaveChange: (wave: PickingWave) => Promise<void>;
}

interface InspectedPurchaseOrder extends PoConfirmSourceSummary {
  purchaseOrderNumber: string;
  errorMessages: string[];
}

interface InspectedSource {
  fileName: string;
  fileHash: string;
  source: string;
  totalPurchaseOrderCount: number;
  totalRowCount: number;
  sheetNames: string[];
  purchaseOrders: InspectedPurchaseOrder[];
}

interface InspectSourceResponse {
  primaryDir?: string;
  folderAccessible?: boolean;
  source?: InspectedSource | null;
  error?: string;
  code?: "SOURCE_NOT_FOUND" | "SOURCE_CONFLICT" | "SOURCE_INVALID" | "SOURCE_CHECK_FAILED";
}

interface CardState {
  poNumber: string;
  rows: PoConfirmRow[];
  sourceSummary?: InspectedPurchaseOrder;
  fulfillmentCenter: string;
  record?: PoConfirmationRecord;
  stage: PoConfirmCardStage;
  errors: string[];
  eligible: boolean;
  needsTemplate: boolean;
}

/** Missing files are preparation work; malformed data and transport errors remain separate. */
export function poConfirmSourcePreparation(source: Pick<InspectedSource, "purchaseOrders"> | null, targetPoNumbers: string[], inspecting: boolean, sourceMissing: boolean) {
  const present = new Set(source?.purchaseOrders.map(order => order.purchaseOrderNumber) || []);
  const missingPoNumbers = targetPoNumbers.filter(po => !present.has(po));
  const needsTemplate = !inspecting && (sourceMissing || Boolean(source && missingPoNumbers.length));
  return { missingPoNumbers, needsTemplate, label: inspecting ? "양식 확인 중" : needsTemplate ? "양식 필요" : "원본 확인 필요" };
}

function responseFileName(response: Response, fallback: string): string {
  const disposition = response.headers.get("Content-Disposition") || "";
  const encoded = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  if (!encoded) return fallback;
  try {
    return decodeURIComponent(encoded.replace(/^"|"$/g, ""));
  } catch {
    return fallback;
  }
}

function SummaryTile({ label, value, highlight }: { label: string; value: number; highlight?: boolean }) {
  return (
    <div style={{ border: `1px solid ${wmsColors.border}`, borderRadius: "10px", background: "#ffffff", padding: "9px 6px", textAlign: "center", minWidth: 0 }}>
      <div style={{ fontSize: "20px", lineHeight: 1.1, fontWeight: 900, color: highlight && value > 0 ? wmsColors.warn : wmsColors.ink }}>{value}</div>
      <div style={{ marginTop: "3px", fontSize: "10px", color: wmsColors.muted, overflowWrap: "anywhere" }}>{label}</div>
    </div>
  );
}

/**
 * 하나의 쿠팡 원본 파일을 내부 발주번호 전체로 검사하고, 사용자가 고른 발주만 원본 형식의 XLSX
 * 한 개로 만든다. 파일 생성·쿠팡 업로드·최종 확인 상태를 서로 분리해 저장한다.
 */
export default function GenerateAllPoConfirmButton({ wave, items, baskets, onWaveChange }: Props) {
  const waveRepository = useActivePickingWaveRepository();
  const [source, setSource] = useState<InspectedSource | null>(null);
  const [primaryDir, setPrimaryDir] = useState<string | null>(null);
  const [folderAccessible, setFolderAccessible] = useState(true);
  const [inspecting, setInspecting] = useState(true);
  const [inspectError, setInspectError] = useState<string | null>(null);
  const [sourceMissing, setSourceMissing] = useState(false);
  const uploadInput = useRef<HTMLInputElement>(null);
  const [manualFile, setManualFile] = useState<{ fileName: string; base64: string } | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmedByPo, setConfirmedByPo] = useState<Record<string, Record<string, number>>>({});
  const [records, setRecords] = useState<PoConfirmationRecord[]>([]);
  const [allWaves, setAllWaves] = useState<PickingWave[]>([]);
  const [generating, setGenerating] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const rowsByPo = useMemo(() => {
    const result = new Map<string, PoConfirmRow[]>();
    for (const poNumber of wave.sourcePurchaseOrderNumbers) {
      result.set(poNumber, buildPoConfirmRows(items, poNumber));
    }
    return result;
  }, [items, wave.sourcePurchaseOrderNumbers]);

  useEffect(() => {
    const initial: Record<string, Record<string, number>> = {};
    for (const [poNumber, rows] of rowsByPo) {
      // 발주확정 서류는 실물 피킹과 독립한다. 기본 확정수량은 발주수량이며 예외만 사용자가 수정한다.
      initial[poNumber] = buildDefaultConfirmedQuantities(rows);
    }
    setConfirmedByPo(initial);
  }, [rowsByPo]);

  async function refreshStoredState() {
    try {
      const loadedWaves = await waveRepository.listWaves();
      setAllWaves(loadedWaves);
      setRecords(listPoConfirmationRecords());
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "저장된 발주확정 상태를 읽지 못했습니다.");
    }
  }

  async function inspectCombinedSource(uploadedFileBase64?: string, uploadedFileName?: string) {
    setInspecting(true);
    setInspectError(null);
    setSourceMissing(false);
    setSource(null);
    setSelected(new Set());
    setActionError(null);
    setSuccessMessage(null);
    if (!uploadedFileBase64) setManualFile(null);
    try {
      const response = await fetch("/api/wms/po-confirm/inspect-source", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          expectedPoNumbers: wave.sourcePurchaseOrderNumbers,
          uploadedFileBase64,
          uploadedFileName,
        }),
      });
      const data = await response.json().catch(() => ({})) as InspectSourceResponse;
      setPrimaryDir(data.primaryDir || null);
      setFolderAccessible(data.folderAccessible !== false);
      if (!response.ok || !data.source) {
        setSource(null);
        setSelected(new Set());
        const missing = response.status === 404 && data.code === "SOURCE_NOT_FOUND";
        setSourceMissing(missing);
        setInspectError(missing ? null : data.error || "발주서 업로드 양식을 확인하지 못했습니다. 다시 확인해 주세요.");
        return;
      }

      setSource(data.source);
      setSelected(new Set());
      // 생성 실패로 남은 error만 지운다. 생성·업로드·확정 이력은 그대로 유지된다.
      setRecords(clearPoConfirmationErrors(wave.sourcePurchaseOrderNumbers, wave.id));
    } catch (error) {
      setSource(null);
      setSelected(new Set());
      setInspectError(error instanceof Error ? error.message : "통합 발주확정 원본을 확인하지 못했습니다.");
    } finally {
      setInspecting(false);
    }
  }

  useEffect(() => {
    void refreshStoredState();
    void inspectCombinedSource();
    // 웨이브가 바뀔 때만 원본과 로컬 진행상태를 새로 읽는다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wave.id]);

  const recordByPo = useMemo(() => new Map(records.map(record => [record.poNumber, record])), [records]);
  const confirmedPoNumbers = useMemo(
    () => collectConfirmedPurchaseOrderNumbers(allWaves, records),
    [allWaves, records]
  );
  const sourceByPo = useMemo(
    () => new Map((source?.purchaseOrders || []).map(order => [order.purchaseOrderNumber, order])),
    [source]
  );

  const cardStates = useMemo<CardState[]>(() => {
    // An unavailable source is a preparation step, not ten independently invalid POs.
    if (!source) return [];
    const inWave = new Set(wave.sourcePurchaseOrderNumbers);
    const allPoNumbers = [
      ...wave.sourcePurchaseOrderNumbers,
      ...(source?.purchaseOrders || []).map(order => order.purchaseOrderNumber).filter(poNumber => !inWave.has(poNumber) && !wave.workScope?.excludedPurchaseOrderNumbers.includes(poNumber)),
    ];

    return allPoNumbers.map(poNumber => {
      const rows = rowsByPo.get(poNumber) || [];
      const sourceSummary = sourceByPo.get(poNumber);
      const record = recordByPo.get(poNumber);
      const errors: string[] = [];
      if (!inWave.has(poNumber)) errors.push("현재 웨이브에 포함되지 않은 발주입니다.");
      const needsTemplate = inWave.has(poNumber) && !sourceSummary;
      if (inWave.has(poNumber) && rows.length === 0) errors.push("이 웨이브의 피킹 결과에서 발주 품목을 찾을 수 없습니다.");
      if (sourceSummary) errors.push(...sourceSummary.errorMessages);
      if (sourceSummary && rows.length > 0 && sourceSummary.rowCount !== rows.length) {
        errors.push(`원본 행 수(${sourceSummary.rowCount})와 웨이브 품목 수(${rows.length})가 다릅니다.`);
      }
      const sourceConfirmed = sourceSummary?.sourceConfirmed === true;
      const confirmed = confirmedPoNumbers.has(poNumber) || sourceConfirmed;
      if (
        !confirmed &&
        record &&
        record.waveId !== wave.id &&
        (record.stage === "document_generated" || record.stage === "uploaded")
      ) {
        errors.push(`다른 웨이브(${record.waveId})에서 이미 서류 생성 또는 업로드 단계가 진행 중입니다.`);
      }
      if (record?.stage === "error" && record.waveId === wave.id && record.errorMessage) errors.push(record.errorMessage);

      const stage: PoConfirmCardStage = confirmed
        ? "confirmed"
        : errors.length > 0
          ? "error"
          : record?.stage || "eligible";
      // 이미 확정된 발주도 같은 원본으로 파일을 잃어버렸을 때 재생성할 수 있다.
      // 입력 필드는 stage=confirmed에서 계속 잠그므로 확정수량/업무상태는 바뀌지 않는다.
      const eligible = inWave.has(poNumber) && Boolean(sourceSummary) && rows.length > 0 && errors.length === 0;
      const basketCenter = baskets.find(basket => basket.purchaseOrderNumber === poNumber)?.fulfillmentCenter || "";

      return {
        poNumber,
        rows,
        sourceSummary,
        record,
        stage,
        needsTemplate,
        errors: [...new Set(errors)],
        eligible,
        fulfillmentCenter: sourceSummary?.fulfillmentCenters[0] || basketCenter || "-",
      };
    });
  }, [baskets, confirmedPoNumbers, recordByPo, rowsByPo, source, sourceByPo, wave.id, wave.sourcePurchaseOrderNumbers, wave.workScope]);

  const eligiblePoNumbers = useMemo(
    () => cardStates.filter(card => card.eligible).map(card => card.poNumber),
    [cardStates]
  );

  useEffect(() => {
    const eligible = new Set(eligiblePoNumbers);
    setSelected(previous => {
      const retained = new Set([...previous].filter(poNumber => eligible.has(poNumber)));
      return previous.size === 0 ? eligible : retained;
    });
  }, [eligiblePoNumbers]);

  const allEligibleSelected = eligiblePoNumbers.length > 0 && eligiblePoNumbers.every(poNumber => selected.has(poNumber));
  const confirmedCount = source ? cardStates.filter(card => card.stage === "confirmed").length
    : wave.sourcePurchaseOrderNumbers.filter(po => confirmedPoNumbers.has(po)).length;
  const displayedPoCount = source ? cardStates.length : wave.sourcePurchaseOrderNumbers.length;
  const errorCount = cardStates.filter(card => card.stage === "error").length;

  function toggleAllEligible() {
    setSelected(allEligibleSelected ? new Set() : new Set(eligiblePoNumbers));
  }

  function toggleOne(poNumber: string) {
    setSelected(previous => {
      const next = new Set(previous);
      if (next.has(poNumber)) next.delete(poNumber);
      else next.add(poNumber);
      return next;
    });
  }

  function updateConfirmedQuantity(poNumber: string, skuId: string, value: number) {
    setConfirmedByPo(previous => ({
      ...previous,
      [poNumber]: { ...previous[poNumber], [skuId]: value },
    }));
  }

  async function handleManualFileSelected(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setSourceMissing(false);
    setSource(null);
    setSelected(new Set());
    try {
      const base64 = await readFileAsBase64(file);
      setManualFile({ fileName: file.name, base64 });
      await inspectCombinedSource(base64, file.name);
      setManualFile({ fileName: file.name, base64 });
    } catch (error) {
      setInspectError(error instanceof Error ? error.message : "업로드한 원본 파일을 읽지 못했습니다.");
    }
  }

  function buildRecord(
    poNumber: string,
    stage: PoConfirmationRecord["stage"],
    now: string,
    options: { generatedFileName?: string; errorMessage?: string } = {}
  ): PoConfirmationRecord {
    const previous = recordByPo.get(poNumber);
    const selectedRowCount = sourceByPo.get(poNumber)?.rowCount || rowsByPo.get(poNumber)?.length || 0;
    return {
      poNumber,
      waveId: wave.id,
      stage,
      sourceFileName: source?.fileName || manualFile?.fileName || previous?.sourceFileName || "",
      sourceFileHash: source?.fileHash || previous?.sourceFileHash || "",
      sourcePurchaseOrderCount: source?.totalPurchaseOrderCount || previous?.sourcePurchaseOrderCount || 0,
      sourceRowCount: source?.totalRowCount || previous?.sourceRowCount || 0,
      selectedRowCount,
      generatedFileName: options.generatedFileName || previous?.generatedFileName,
      documentGeneratedAt: stage === "document_generated" ? now : previous?.documentGeneratedAt,
      uploadedAt: stage === "uploaded" || stage === "confirmed" ? previous?.uploadedAt || now : previous?.uploadedAt,
      confirmedAt: stage === "confirmed" ? now : previous?.confirmedAt,
      errorMessage: options.errorMessage,
      updatedAt: now,
    };
  }

  async function handleGenerateSelected() {
    if (!source || generating || selected.size === 0) return;
    const selectedPoNumbers = cardStates.filter(card => selected.has(card.poNumber) && card.eligible).map(card => card.poNumber);
    if (selectedPoNumbers.length !== selected.size || selectedPoNumbers.length === 0) {
      setActionError("선택 상태가 변경되었습니다. 오류·확정 발주를 제외하고 다시 선택해주세요.");
      return;
    }

    const downloadTarget = reserveDownloadTarget();
    setGenerating(true);
    setActionError(null);
    setSuccessMessage(null);
    try {
      const response = await fetch("/api/wms/po-confirm/generate-selected", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          waveId: wave.id,
          selectedPoNumbers,
          confirmedQuantitiesByPo: selectedPoNumbers.map(poNumber => ({
            poNumber,
            quantities: (rowsByPo.get(poNumber) || []).map(row => ({
              skuId: row.skuId,
              confirmedQuantity: confirmedByPo[poNumber]?.[row.skuId] ?? row.originalQuantity,
            })),
          })),
          expectedSourceHash: source.fileHash,
          uploadedFileBase64: manualFile?.base64,
          uploadedFileName: manualFile?.fileName,
        }),
      });

      if (!response.ok) {
        closeReservedDownloadTarget(downloadTarget);
        const data = await response.json().catch(() => ({}));
        const message = data.error || `발주확정 통합 파일 생성에 실패했습니다(HTTP ${response.status}).`;
        const now = new Date().toISOString();
        setRecords(upsertPoConfirmationRecords(selectedPoNumbers.map(poNumber => buildRecord(poNumber, "error", now, { errorMessage: message }))));
        setActionError(message);
        return;
      }

      const fallback = `PO_FOR_CONFIRM_선택발주_${selectedPoNumbers.length}건.xlsx`;
      const fileName = responseFileName(response, fallback);
      const driveSaved = response.headers.get("X-NOIDB-Drive-Saved") === "true";
      const driveFileName = decodeURIComponent(response.headers.get("X-NOIDB-Drive-File-Name") || "");
      const driveWarning = decodeURIComponent(response.headers.get("X-NOIDB-Drive-Save-Warning") || "");
      downloadBlobPreservingPage(await response.blob(), fileName, downloadTarget);

      const now = new Date().toISOString();
      setRecords(
        upsertPoConfirmationRecords(
          selectedPoNumbers.map(poNumber =>
            buildRecord(poNumber, "document_generated", now, { generatedFileName: driveSaved && driveFileName ? driveFileName : fileName })
          )
        )
      );
      setSuccessMessage(`${selectedPoNumbers.length}개 발주의 통합 파일 1개가 생성되었습니다.${driveSaved ? " Drive 자동저장도 완료했습니다." : driveWarning ? ` ${driveWarning}` : ""} 쿠팡 업로드 전까지 발주확정 완료로 처리되지 않습니다.`);
    } catch (error) {
      closeReservedDownloadTarget(downloadTarget);
      const message = error instanceof Error ? error.message : "발주확정 통합 파일 생성 중 오류가 발생했습니다.";
      const now = new Date().toISOString();
      const selectedPoNumbers = [...selected];
      if (source && selectedPoNumbers.length > 0) {
        setRecords(upsertPoConfirmationRecords(selectedPoNumbers.map(poNumber => buildRecord(poNumber, "error", now, { errorMessage: message }))));
      }
      setActionError(message);
    } finally {
      setGenerating(false);
    }
  }

  function handleMarkUploaded(poNumber: string) {
    try {
      const now = new Date().toISOString();
      setRecords(upsertPoConfirmationRecords(buildRecord(poNumber, "uploaded", now)));
      setActionError(null);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "쿠팡 업로드 상태를 저장하지 못했습니다.");
    }
  }

  async function handleConfirmCompleted(poNumber: string) {
    if (!window.confirm(`발주서 ${poNumber}가 쿠팡 서플라이허브에서 정상적으로 발주확정 완료된 것을 확인했습니까?`)) return;
    try {
      const now = new Date().toISOString();
      const nextRecords = upsertPoConfirmationRecords(buildRecord(poNumber, "confirmed", now));
      setRecords(nextRecords);

      const confirmed = collectConfirmedPurchaseOrderNumbers(allWaves, nextRecords);
      for (const card of cardStates) {
        if (card.sourceSummary?.sourceConfirmed) confirmed.add(card.poNumber);
      }
      const allCurrentWaveConfirmed = wave.sourcePurchaseOrderNumbers.every(currentPo => confirmed.has(currentPo));
      const pickingFinished = wave.status !== "in_progress";
      const updatedWave: PickingWave = {
        ...wave,
        // 서류를 먼저 처리해도 실물 피킹 상태를 강제로 완료시키지 않는다.
        status: pickingFinished ? (allCurrentWaveConfirmed ? "order_confirmed" : wave.status) : "in_progress",
        orderConfirmedAt: allCurrentWaveConfirmed ? now : undefined,
        updatedAt: now,
      };
      await onWaveChange(updatedWave);
      setAllWaves(previous => {
        const exists = previous.some(existing => existing.id === updatedWave.id);
        return exists
          ? previous.map(existing => existing.id === updatedWave.id ? updatedWave : existing)
          : [...previous, updatedWave];
      });
      setActionError(null);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "발주확정 완료 상태를 저장하지 못했습니다.");
    }
  }

  const sourceHasInspectionErrors = source !== null && (
    source.purchaseOrders.some(order => order.errorMessages.length > 0) ||
    wave.sourcePurchaseOrderNumbers.some(poNumber => !sourceByPo.has(poNumber))
  );
  const preparation = poConfirmSourcePreparation(source, wave.sourcePurchaseOrderNumbers, inspecting, sourceMissing);
  const manualUploadNeeded = !inspecting && (!source || !folderAccessible || Boolean(inspectError) || sourceHasInspectionErrors);

  return (
    <div>
      {inspecting || manualUploadNeeded ? <section aria-label="발주서 업로드 양식 안내" aria-busy={inspecting} style={{ border: `1px solid ${preparation.needsTemplate || inspecting ? wmsColors.border : wmsColors.warnSoftBorder}`, borderRadius: "9px", background: preparation.needsTemplate || inspecting ? wmsColors.surfaceBeige : wmsColors.warnSoft, padding: "12px", marginBottom: "10px" }}>
        <p role={inspecting || preparation.needsTemplate ? "status" : "alert"} style={{ margin: "0 0 8px", fontSize: "14px", fontWeight: 800, color: preparation.needsTemplate || inspecting ? wmsColors.ink : wmsColors.warnText, lineHeight: 1.5 }}>
          {inspecting ? "발주서 업로드 양식을 확인하고 있습니다." : preparation.needsTemplate ? "발주서 업로드 양식을 다운로드해 주세요." : inspectError || "선택한 발주에 맞는 업로드 양식을 확인해 주세요."}
        </p>
        {preparation.needsTemplate && <>
          <p style={{ margin: "0 0 10px", fontSize: "12px", lineHeight: 1.6 }}>쿠팡에서 이 작업의 발주서 업로드 양식을 다운로드해 주세요. 다운로드한 양식을 연결하면 선택한 발주를 자동 확인합니다.</p>
          <a href="https://supplier.coupang.com" target="_blank" rel="noreferrer" style={{ ...wmsSecondaryButton, display: "flex", alignItems: "center", justifyContent: "center", minHeight: "44px", width: "100%", boxSizing: "border-box", textDecoration: "none", marginBottom: "8px" }}>쿠팡 서플라이 허브 열기 ↗</a>
        </>}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: "8px" }}>
          <button type="button" disabled={inspecting || generating} onClick={() => uploadInput.current?.click()} style={{ ...wmsSecondaryButton, minHeight: "44px", width: "100%", fontSize: "12px", overflowWrap: "anywhere" }}>다운로드한 양식 선택</button>
          <button type="button" disabled={inspecting || generating} onClick={() => void inspectCombinedSource()} style={{ ...wmsSecondaryButton, minHeight: "44px", width: "100%", fontSize: "12px" }}>폴더 양식 다시 확인</button>
        </div>
        <input ref={uploadInput} type="file" accept=".xlsx" aria-label="다운로드한 발주서 업로드 양식 선택" onChange={handleManualFileSelected} hidden />
        {manualFile && <p style={{ margin: "8px 0 0", fontSize: "12px", overflowWrap: "anywhere" }}>선택한 파일: {manualFile.fileName}</p>}
        {preparation.needsTemplate && <p style={{ margin: "8px 0 0", fontSize: "12px", lineHeight: 1.6 }}>연결된 Drive의 ‘발주서업로드양식’ 폴더에 저장했다면 ‘폴더 양식 다시 확인’을 눌러 주세요.</p>}
      </section> : null}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: "7px", marginBottom: "10px" }}>
        <SummaryTile label="전체 발주" value={displayedPoCount} />
        <SummaryTile label="확정 가능" value={eligiblePoNumbers.length} />
        <SummaryTile label="선택됨" value={selected.size} />
        <SummaryTile label="이미 확정됨(재생성 가능)" value={confirmedCount} />
        {source && preparation.missingPoNumbers.length > 0 && <div style={{ gridColumn: "1 / -1" }}><SummaryTile label="양식 필요" value={preparation.missingPoNumbers.length} /></div>}
        <div style={{ gridColumn: "1 / -1" }}>{source
          ? <SummaryTile label="오류 발주" value={errorCount} highlight />
          : <SummaryTile label={preparation.label} value={wave.sourcePurchaseOrderNumbers.length} />}</div>
      </div>

      <label style={{ display: "flex", alignItems: "center", gap: "10px", minHeight: "48px", border: `1px solid ${wmsColors.borderStrong}`, borderRadius: "10px", background: "#ffffff", padding: "0 12px", marginBottom: "8px", cursor: eligiblePoNumbers.length === 0 ? "default" : "pointer", opacity: eligiblePoNumbers.length === 0 ? 0.55 : 1 }}>
        <input type="checkbox" checked={allEligibleSelected} disabled={eligiblePoNumbers.length === 0} onChange={toggleAllEligible} style={{ width: "22px", height: "22px", flexShrink: 0 }} />
        <strong style={{ fontSize: "13px" }}>발주 전체 선택/해제</strong>
      </label>

      <button type="button" onClick={handleGenerateSelected} disabled={inspecting || generating || selected.size === 0 || !source} style={{ ...wmsPrimaryButton, width: "100%", minHeight: "50px", marginBottom: "10px", opacity: generating || selected.size === 0 || !source ? 0.5 : 1 }}>
        {generating ? "통합 파일 검증·생성 중..." : "선택 발주확정 서류 생성"}
      </button>

      {actionError ? <p style={{ margin: "0 0 10px", padding: "9px", borderRadius: "8px", background: wmsColors.warnSoft, color: "#c0392b", fontSize: "11px", lineHeight: 1.5 }}>{actionError}</p> : null}
      {successMessage ? <p style={{ margin: "0 0 10px", padding: "9px", borderRadius: "8px", background: wmsColors.greenSoft, color: wmsColors.greenDark, fontSize: "11px", fontWeight: 700, lineHeight: 1.5 }}>{successMessage}</p> : null}

      <details style={{ border: `1px solid ${wmsColors.border}`, borderRadius: "9px", background: "#fff", overflow: "hidden" }}>
        <summary style={{ cursor: "pointer", padding: "12px", fontSize: "13px", fontWeight: 800, listStylePosition: "inside" }}>
          발주서 목록 · {displayedPoCount}건
        </summary>
        <div style={{ padding: "0 8px 8px" }}>
        {!source && wave.sourcePurchaseOrderNumbers.map(poNumber => <div key={poNumber} style={{ padding: "12px", marginBottom: "8px", border: `1px solid ${wmsColors.border}`, borderRadius: "8px", background: wmsColors.surfaceBeige, fontSize: "12px", overflowWrap: "anywhere" }}>
          <strong>발주서 {poNumber}</strong>
          <span style={{ display: "block", marginTop: "4px", color: wmsColors.muted }}>{inspecting ? "양식 확인 중" : sourceMissing ? "양식 필요 · 다운로드한 양식을 연결해 주세요." : "원본 확인 필요 · 위 안내를 확인해 주세요."}</span>
        </div>)}
        {cardStates.map(card => card.needsTemplate && card.errors.length === 0 ? <div key={card.poNumber} style={{ padding: "12px", marginBottom: "8px", border: `1px solid ${wmsColors.border}`, borderRadius: "8px", background: wmsColors.surfaceBeige, fontSize: "12px", overflowWrap: "anywhere" }}>
          <strong>발주서 {card.poNumber}</strong>
          <span style={{ display: "block", marginTop: "4px", color: wmsColors.muted }}>양식 필요 · 이 발주가 포함된 업로드 양식을 연결해 주세요.</span>
        </div> : (
          <PoConfirmSection
            key={card.poNumber}
            purchaseOrderNumber={card.poNumber}
            fulfillmentCenter={card.fulfillmentCenter}
            rows={card.rows}
            sourceSummary={card.sourceSummary}
            checked={selected.has(card.poNumber)}
            disabled={!card.eligible}
            stage={card.stage}
            errorMessages={card.errors}
            confirmedQuantities={confirmedByPo[card.poNumber] || {}}
            onToggle={() => toggleOne(card.poNumber)}
            onConfirmedQuantityChange={(skuId, value) => updateConfirmedQuantity(card.poNumber, skuId, value)}
            onMarkUploaded={() => handleMarkUploaded(card.poNumber)}
            onConfirmCompleted={() => void handleConfirmCompleted(card.poNumber)}
          />
        ))}
        </div>
      </details>
    </div>
  );
}
