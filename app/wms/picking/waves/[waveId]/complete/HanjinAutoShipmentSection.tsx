"use client";

import { useEffect, useState } from "react";
import type { ShipmentOutputGeneration } from "@/lib/wms/picking-wave/types";
import type { AutoShipmentTrackingPreview } from "@/lib/wms/hanjin-shipment-auto";
import { wmsColors, wmsPrimaryButton } from "@/lib/wms/ui-tokens";
import { closeReservedDownloadTarget, downloadBlobPreservingPage, reserveDownloadTarget } from "@/lib/wms/download-client";

interface Props {
  generation?: ShipmentOutputGeneration;
  generationLabel?: string;
  blockedByGeneration?: string;
  onGenerated?: (generationId: string, fileName: string) => Promise<void> | void;
}

const TRACKING_PREVIEW_SESSION_TTL_MS = 60 * 1000;

function trackingPreviewKey(generation: ShipmentOutputGeneration) {
  return `noidb:wms:shipment-preview:${[...generation.purchaseOrderNumbers].sort().join("|")}`;
}

function readTrackingPreview(key: string): AutoShipmentTrackingPreview | null {
  try {
    const cached = JSON.parse(sessionStorage.getItem(key) || "null") as { savedAt?: number; preview?: AutoShipmentTrackingPreview } | null;
    return cached?.preview && Date.now() - Number(cached.savedAt || 0) < TRACKING_PREVIEW_SESSION_TTL_MS ? cached.preview : null;
  } catch { return null; }
}

export default function HanjinAutoShipmentSection({ generation, generationLabel, blockedByGeneration, onGenerated }: Props) {
  const [generating, setGenerating] = useState(false);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reasons, setReasons] = useState<string[] | null>(null);
  const [resultMessage, setResultMessage] = useState<string | null>(null);
  const [preview, setPreview] = useState<AutoShipmentTrackingPreview | null>(null);
  const [selectedReprintFileName, setSelectedReprintFileName] = useState<string | null>(null);

  useEffect(() => {
    if (!generation) { setPreview(null); setSelectedReprintFileName(null); return; }
    const sessionKey = trackingPreviewKey(generation);
    const cached = readTrackingPreview(sessionKey);
    if (cached) {
      setPreview(cached);
      setSelectedReprintFileName(cached.selectedReprintFileName ?? null);
      setChecking(false);
      setError(null);
      return;
    }
    const controller = new AbortController();
    let active = true;
    setChecking(true); setError(null); setPreview(null);
    fetch("/api/wms/hanjin-upload/shipment-preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ purchaseOrderNumbers: generation.purchaseOrderNumbers }),
      signal: controller.signal,
    }).then(async response => {
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "운송장 확인에 실패했습니다.");
      if (active) {
        const nextPreview = data.preview as AutoShipmentTrackingPreview;
        setPreview(nextPreview);
        setSelectedReprintFileName(nextPreview.selectedReprintFileName ?? null);
        try { sessionStorage.setItem(sessionKey, JSON.stringify({ savedAt: Date.now(), preview: nextPreview })); } catch { /* 다음 진입 때 다시 확인 */ }
      }
    }).catch(cause => {
      if (active && !(cause instanceof DOMException && cause.name === "AbortError")) setError(cause instanceof Error ? cause.message : "운송장 확인에 실패했습니다.");
    }).finally(() => { if (active) setChecking(false); });
    return () => { active = false; controller.abort(); };
  }, [generation]);

  async function handleGenerate() {
    const selectedCandidate = preview?.candidateFiles?.find(candidate => candidate.fileName === selectedReprintFileName);
    if (!generation || (!preview?.canGenerate && !selectedCandidate?.exactMatch) || blockedByGeneration) return;
    const downloadTarget = reserveDownloadTarget();
    setGenerating(true); setError(null); setReasons(null); setResultMessage(null);
    try {
      const response = await fetch("/api/wms/hanjin-upload/build-shipment-auto", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ purchaseOrderNumbers: generation.purchaseOrderNumbers, selectedReprintFileName }),
      });
      if (!response.ok) {
        closeReservedDownloadTarget(downloadTarget);
        const data = await response.json().catch(() => ({}));
        setError(data.error || "쉽먼트파일 생성에 실패했습니다.");
        setReasons(Array.isArray(data.reasons) ? data.reasons : null);
        return;
      }
      const includedPoNumbers = decodeURIComponent(response.headers.get("X-Included-Po-Numbers") || "").split(",").filter(Boolean).sort();
      const generationPoNumbers = [...generation.purchaseOrderNumbers].sort();
      if (JSON.stringify(includedPoNumbers) !== JSON.stringify(generationPoNumbers)) throw new Error("generation과 Shipment 결과의 발주번호 집합이 달라 다운로드를 차단했습니다.");
      const disposition = response.headers.get("Content-Disposition") || "";
      const fileNameMatch = disposition.match(/filename\*=UTF-8''(.+)$/);
      const fileName = fileNameMatch ? decodeURIComponent(fileNameMatch[1]) : "쉽먼트생성_업로드파일.xlsx";
      downloadBlobPreservingPage(await response.blob(), fileName, downloadTarget);
      setResultMessage(`${generationLabel || "현재 묶음"}의 발주 ${generation.purchaseOrderNumbers.length}건만 Shipment로 생성했습니다.`);
      await onGenerated?.(generation.generationId, fileName);
    } catch (cause) {
      closeReservedDownloadTarget(downloadTarget);
      setError(cause instanceof Error ? cause.message : "쉽먼트파일 생성 중 오류가 발생했습니다.");
    } finally { setGenerating(false); }
  }

  if (!generation) return <p style={{ margin: 0, fontSize: "11px", color: wmsColors.muted }}>먼저 송장파일을 생성하면 그때 선택한 발주 집합이 Shipment 대상으로 연결됩니다.</p>;
  const total = generation.purchaseOrderNumbers.length;
  const matched = preview?.matchedPurchaseOrderCount || 0;
  const missing = preview?.missingPurchaseOrderNumbers.length || 0;
  const exactCandidates = preview?.candidateFiles?.filter(candidate => candidate.exactMatch) ?? [];
  const selectedCandidate = exactCandidates.find(candidate => candidate.fileName === selectedReprintFileName);
  const canGenerate = Boolean(preview?.canGenerate || selectedCandidate);

  return <div>
    <div style={{ marginBottom: "8px", padding: "9px", borderRadius: "8px", background: wmsColors.surfaceBeige, fontSize: "12px", lineHeight: 1.6 }}>
      <strong>현재 Shipment 대상 · {generationLabel || "현재 묶음"} · 발주 {total}건</strong><br />
      {checking ? "운송장 확인 중..." : `운송장 확인 ${matched}/${total} · 미확인 ${missing}`}
      {!checking && canGenerate && <><br /><span style={{ color: wmsColors.greenDark, fontWeight: 800 }}>Shipment 생성 가능</span></>}
    </div>
    {!checking && exactCandidates.length > 1 && <div style={{ marginBottom: "8px", display: "grid", gap: "6px" }}>
      <strong style={{ fontSize: "12px" }}>정확히 일치하는 한진 결과파일을 선택해 주세요.</strong>
      {exactCandidates.map(candidate => <button
        key={candidate.fileName}
        type="button"
        onClick={() => setSelectedReprintFileName(candidate.fileName)}
        style={{ padding: "9px 10px", borderRadius: "8px", border: `1px solid ${selectedReprintFileName === candidate.fileName ? wmsColors.greenDark : wmsColors.border}`, background: selectedReprintFileName === candidate.fileName ? wmsColors.greenSoft : wmsColors.surface, textAlign: "left", fontSize: "11px", cursor: "pointer" }}
      >
        {candidate.fileName}<br />
        {candidate.modifiedTime ? `${new Date(candidate.modifiedTime).toLocaleString("ko-KR")} · ` : ""}일치 {candidate.matchedPurchaseOrderCount} · 누락 0
      </button>)}
    </div>}
    {blockedByGeneration && <p style={{ fontSize: "11px", color: "#c0392b" }}>{blockedByGeneration}</p>}
    {error && <div style={{ fontSize: "12px", color: "#c0392b", marginBottom: "8px" }}><p style={{ margin: "0 0 4px", fontWeight: 700 }}>{error}</p>{reasons?.length ? <ul style={{ margin: 0, paddingLeft: "18px" }}>{reasons.map((reason, index) => <li key={index}>{reason}</li>)}</ul> : null}</div>}
    {resultMessage && <p style={{ fontSize: "12px", color: wmsColors.greenDark, marginBottom: "8px" }}>{resultMessage}</p>}
    <button onClick={handleGenerate} disabled={generating || checking || !canGenerate || Boolean(blockedByGeneration)} style={{ ...wmsPrimaryButton, width: "100%", opacity: generating || checking || !canGenerate || blockedByGeneration ? 0.6 : 1 }}>
      {generating ? "생성 중..." : generation.shipmentFileName ? "Shipment 파일 재생성" : "Shipment 파일 생성"}
    </button>
  </div>;
}
