"use client";

import { useEffect, useState } from "react";
import JSZip from "jszip";
import { buildPoConfirmRows } from "@/lib/wms/picking-wave/po-confirm-rows";
import { readFileAsBase64 } from "@/lib/wms/file-base64";
import type { PickingWave, PickingWaveItem } from "@/lib/wms/picking-wave/types";
import { wmsColors, wmsPrimaryButton, wmsGhostButton } from "@/lib/wms/ui-tokens";

interface Props {
  wave: PickingWave;
  items: PickingWaveItem[];
}

interface FailedPo {
  poNumber: string;
  message: string;
}

interface UploadState {
  fileName: string;
  base64: string;
  checking: boolean;
  foundPoNumber: string | null;
  matches: boolean;
  error: string | null;
}

type FolderPoStatus = "found" | "missing" | "duplicate" | "error";

interface FolderStatusEntry {
  poNumber: string;
  status: FolderPoStatus;
  fileName?: string;
  duplicateFileNames?: string[];
  errorMessage?: string;
}

/**
 * 발주서별로 하나씩 눌러야 했던 [발주확정 서류 생성]을 웨이브 전체 기준으로 한 번에 실행하는
 * 버튼 (2026-08-19 4차 실사용 테스트 신규). 기존 개별 생성 API(/api/wms/po-confirm/generate)와
 * 행 계산 로직(buildPoConfirmRows)을 그대로 재사용하며, 새 서버 로직은 추가하지 않았다 —
 * 발주서마다 기존과 동일한 xlsx를 순서대로 받아 브라우저에서 jszip(기존 의존성, 새 설치 없음)으로
 * 묶기만 한다. 하나라도 실패하면(원본 템플릿 없음 등) 그 어떤 파일도 다운로드하지 않고 실패
 * 목록만 보여준다 — 일부만 조용히 받아지는 것을 막기 위함이다. 원본 PO_FOR_CONFIRM 템플릿과
 * 발주확정 상태(order_confirmed 등)는 이 버튼이 전혀 건드리지 않는다(서류 생성 전용).
 *
 * 2026-08-20 전면 개편 — 모바일에서 발주서마다 원본을 하나씩 업로드해야 했던 불편을 없앴다.
 * 서버가 /api/wms/po-confirm/folder-status로 Google Drive 동기화 폴더(기본
 * "G:\내 드라이브\쿠팡데이터\발주서업로드양식", WMS_PO_FOR_CONFIRM_DIR로 재정의 가능)를 자동
 * 검색해 발주서별 원본 확인 상태(확인됨/누락/중복/오류)를 보여준다. 개별 업로드 카드는 기본
 * 화면에서 없앴고, 자동검색이 실패한 발주서에 한해서만 "고급: 수동 원본 업로드" 접이 영역에서
 * 보조로 쓸 수 있다 — 자동검색된 발주서는 항상 자동검색 파일이 우선이며 수동 업로드로 덮이지
 * 않는다.
 */
export default function GenerateAllPoConfirmButton({ wave, items }: Props) {
  const [generating, setGenerating] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [failures, setFailures] = useState<FailedPo[] | null>(null);
  const [successResult, setSuccessResult] = useState<{ fileCount: number; shortageRowCount: number; reasonAppliedCount: number } | null>(null);

  const [checkingFolder, setCheckingFolder] = useState(true);
  const [primaryDir, setPrimaryDir] = useState<string | null>(null);
  const [folderAccessible, setFolderAccessible] = useState(true);
  const [statusByPo, setStatusByPo] = useState<Record<string, FolderStatusEntry>>({});
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);
  const [showManualUpload, setShowManualUpload] = useState(false);
  const [uploadsByPo, setUploadsByPo] = useState<Record<string, UploadState>>({});

  const poNumbers = wave.sourcePurchaseOrderNumbers;
  const rowsByPo = poNumbers.map(poNumber => ({ poNumber, rows: buildPoConfirmRows(items, poNumber) }));
  const totalSkuCount = rowsByPo.reduce((sum, entry) => sum + entry.rows.length, 0);
  const totalConfirmedQuantity = rowsByPo.reduce((sum, entry) => sum + entry.rows.reduce((s, row) => s + row.foundQuantity, 0), 0);

  async function checkFolderStatus() {
    setCheckingFolder(true);
    try {
      const response = await fetch("/api/wms/po-confirm/folder-status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ poNumbers }),
      });
      const data = await response.json();
      if (!response.ok) {
        setFolderAccessible(false);
        setStatusByPo({});
        return;
      }
      setPrimaryDir(data.primaryDir);
      setFolderAccessible(Boolean(data.folderAccessible));
      const map: Record<string, FolderStatusEntry> = {};
      for (const entry of (data.entries || []) as FolderStatusEntry[]) map[entry.poNumber] = entry;
      setStatusByPo(map);
    } catch {
      setFolderAccessible(false);
      setStatusByPo({});
    } finally {
      setCheckingFolder(false);
    }
  }

  useEffect(() => {
    checkFolderStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wave.id]);

  const foundCount = poNumbers.filter(po => statusByPo[po]?.status === "found").length;
  const missingPoNumbers = poNumbers.filter(po => statusByPo[po]?.status === "missing" || !statusByPo[po]);
  const duplicatePoNumbers = poNumbers.filter(po => statusByPo[po]?.status === "duplicate");
  const errorPoNumbers = poNumbers.filter(po => statusByPo[po]?.status === "error");
  const needsManualPoNumbers = poNumbers.filter(po => statusByPo[po]?.status !== "found");

  const allReady =
    !checkingFolder &&
    folderAccessible &&
    poNumbers.every(po => statusByPo[po]?.status === "found" || uploadsByPo[po]?.matches === true);

  async function handleCopyFolderPath() {
    if (!primaryDir) return;
    try {
      await navigator.clipboard.writeText(primaryDir);
      setCopyFeedback("복사했습니다");
    } catch {
      setCopyFeedback("복사에 실패했습니다 — 경로를 직접 선택해 복사해주세요.");
    }
    setTimeout(() => setCopyFeedback(null), 2500);
  }

  async function handleFileSelected(poNumber: string, e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setUploadsByPo(prev => ({ ...prev, [poNumber]: { fileName: file.name, base64: "", checking: true, foundPoNumber: null, matches: false, error: null } }));
    try {
      const base64 = await readFileAsBase64(file);
      const response = await fetch("/api/wms/po-confirm/inspect-upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileBase64: base64, expectedPoNumber: poNumber }),
      });
      const data = await response.json();
      if (!response.ok) {
        setUploadsByPo(prev => ({ ...prev, [poNumber]: { fileName: file.name, base64, checking: false, foundPoNumber: null, matches: false, error: data.error || "파일을 확인하지 못했습니다." } }));
        return;
      }
      setUploadsByPo(prev => ({ ...prev, [poNumber]: { fileName: file.name, base64, checking: false, foundPoNumber: data.foundPoNumber, matches: data.matches, error: null } }));
    } catch (err) {
      setUploadsByPo(prev => ({
        ...prev,
        [poNumber]: { fileName: file.name, base64: "", checking: false, foundPoNumber: null, matches: false, error: err instanceof Error ? err.message : "파일을 확인하는 중 오류가 발생했습니다." },
      }));
    }
  }

  async function handleGenerateAll() {
    if (generating || poNumbers.length === 0 || !allReady) return;
    setGenerating(true);
    setFailures(null);
    setSuccessResult(null);
    setProgress({ done: 0, total: poNumbers.length });

    const succeeded: { fileName: string; blob: Blob }[] = [];
    const failed: FailedPo[] = [];
    let totalShortageRowCount = 0;
    let totalReasonAppliedCount = 0;

    for (const { poNumber, rows } of rowsByPo) {
      if (rows.length === 0) {
        failed.push({ poNumber, message: "이 웨이브 안에서 이 발주서에 해당하는 SKU를 찾을 수 없습니다." });
        setProgress(prev => (prev ? { ...prev, done: prev.done + 1 } : prev));
        continue;
      }
      try {
        // 자동검색된 발주서는 항상 자동검색 파일을 우선 쓴다 — 수동 업로드가 있어도 무시한다
        // (2026-08-20, "동일 발주번호는 자동검색 파일을 우선 사용" 요구사항).
        const useAutoSearch = statusByPo[poNumber]?.status === "found";
        const response = await fetch("/api/wms/po-confirm/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            poNumber,
            confirmedQuantities: rows.map(row => ({ skuId: row.skuId, confirmedQuantity: row.foundQuantity })),
            uploadedFileBase64: useAutoSearch ? undefined : uploadsByPo[poNumber]?.base64,
          }),
        });
        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          failed.push({ poNumber, message: data.error || `HTTP ${response.status}` });
        } else {
          const disposition = response.headers.get("Content-Disposition") || "";
          const fileNameMatch = disposition.match(/filename\*=UTF-8''(.+)$/);
          const fileName = fileNameMatch ? decodeURIComponent(fileNameMatch[1]) : `PO_FOR_CONFIRM(${poNumber}).xlsx`;
          totalShortageRowCount += Number(response.headers.get("X-Shortage-Row-Count") || 0);
          totalReasonAppliedCount += Number(response.headers.get("X-Reason-Applied-Count") || 0);
          succeeded.push({ fileName, blob: await response.blob() });
        }
      } catch (error) {
        failed.push({ poNumber, message: error instanceof Error ? error.message : "요청 중 오류가 발생했습니다." });
      }
      setProgress(prev => (prev ? { ...prev, done: prev.done + 1 } : prev));
    }

    if (failed.length > 0) {
      // 일부 발주서만 조용히 다운로드되지 않도록, 실패가 하나라도 있으면 전체를 내려받지 않는다.
      setFailures(failed);
      setGenerating(false);
      setProgress(null);
      return;
    }

    const zip = new JSZip();
    for (const file of succeeded) zip.file(file.fileName, file.blob);
    const zipBlob = await zip.generateAsync({ type: "blob" });

    const now = new Date();
    const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\..+/, "").replace("T", "_");
    const zipName = `전체_발주확정서류_${wave.id}_${stamp}.zip`;

    const url = URL.createObjectURL(zipBlob);
    const a = document.createElement("a");
    a.href = url;
    a.download = zipName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);

    setSuccessResult({ fileCount: succeeded.length, shortageRowCount: totalShortageRowCount, reasonAppliedCount: totalReasonAppliedCount });
    setGenerating(false);
    setProgress(null);
  }

  if (poNumbers.length === 0) return null;

  return (
    <div style={{ border: `1px solid ${wmsColors.borderStrong}`, borderRadius: "14px", boxShadow: "0 4px 16px rgba(30,28,25,.045)", padding: "14px", marginBottom: "16px", background: wmsColors.surfaceBeige }}>
      <h3 style={{ margin: "0 0 6px", fontSize: "14px" }}>전체 발주확정 서류 생성</h3>
      <p style={{ margin: "0 0 4px", fontSize: "11px", color: wmsColors.muted }}>
        대상 발주서 {poNumbers.length}건 · 전체 SKU {totalSkuCount}개 · 전체 확정수량 {totalConfirmedQuantity}개
      </p>
      <p style={{ margin: "0 0 10px", fontSize: "10px", color: wmsColors.muted }}>
        확정수량이 발주수량보다 적은 상품에는 "협력사 재고부족 - 재고 할당정책"이 자동 입력됩니다.
      </p>

      <div style={{ background: "#ffffff", border: `1px solid ${wmsColors.border}`, borderRadius: "10px", padding: "10px 12px", marginBottom: "10px" }}>
        <div style={{ fontSize: "11px", color: wmsColors.muted, marginBottom: "4px" }}>원본파일 폴더</div>
        <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "8px" }}>
          <code style={{ fontSize: "11px", flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", background: wmsColors.surfaceBeige, borderRadius: "6px", padding: "4px 6px" }}>
            {primaryDir || "확인 중..."}
          </code>
          <button onClick={handleCopyFolderPath} disabled={!primaryDir} style={{ ...wmsGhostButton, minHeight: "28px", fontSize: "10px", padding: "0 8px", flexShrink: 0 }}>
            폴더 경로 복사
          </button>
        </div>
        {copyFeedback && <p style={{ fontSize: "10px", color: wmsColors.greenDark, margin: "0 0 8px" }}>{copyFeedback}</p>}

        {checkingFolder ? (
          <p style={{ fontSize: "11px", color: wmsColors.muted, margin: 0 }}>발주서별 원본 파일 확인 중...</p>
        ) : !folderAccessible ? (
          <p style={{ fontSize: "11px", color: wmsColors.warnText, margin: 0 }}>
            원본파일 폴더를 찾을 수 없습니다 — Google Drive 동기화가 완료됐는지, PC에서 이 폴더가 정상적으로 열리는지 확인한 뒤 다시 시도해주세요.
          </p>
        ) : (
          <>
            <div style={{ fontSize: "11px", lineHeight: 1.8 }}>
              <div>대상 발주서: {poNumbers.length}건</div>
              <div style={{ color: wmsColors.greenDark, fontWeight: 700 }}>원본파일 확인: {foundCount}건</div>
              {missingPoNumbers.length > 0 && <div style={{ color: wmsColors.warnText, fontWeight: 700 }}>누락: {missingPoNumbers.length}건</div>}
              {duplicatePoNumbers.length > 0 && <div style={{ color: wmsColors.warnText, fontWeight: 700 }}>중복: {duplicatePoNumbers.length}건</div>}
              {errorPoNumbers.length > 0 && <div style={{ color: "#c0392b", fontWeight: 700 }}>오류: {errorPoNumbers.length}건</div>}
            </div>

            {missingPoNumbers.length > 0 && (
              <div style={{ fontSize: "11px", color: wmsColors.warnText, margin: "8px 0 0" }}>
                아래 발주번호의 원본파일을 폴더에 넣어주세요.
                <ul style={{ margin: "4px 0 0", paddingLeft: "18px" }}>
                  {missingPoNumbers.map(po => (
                    <li key={po}>{po}</li>
                  ))}
                </ul>
              </div>
            )}
            {duplicatePoNumbers.length > 0 && (
              <div style={{ fontSize: "11px", color: wmsColors.warnText, margin: "8px 0 0" }}>
                {duplicatePoNumbers.map(po => (
                  <div key={po}>
                    발주서 {po}: 동일 발주번호 파일이 여러 개입니다 — {(statusByPo[po]?.duplicateFileNames || []).join(", ")} (폴더에서 정리해주세요)
                  </div>
                ))}
              </div>
            )}
            {errorPoNumbers.length > 0 && (
              <div style={{ fontSize: "11px", color: "#c0392b", margin: "8px 0 0" }}>
                {errorPoNumbers.map(po => (
                  <div key={po}>
                    발주서 {po}: {statusByPo[po]?.errorMessage}
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        <button onClick={checkFolderStatus} disabled={checkingFolder} style={{ ...wmsGhostButton, width: "100%", minHeight: "34px", fontSize: "12px", marginTop: "10px", opacity: checkingFolder ? 0.6 : 1 }}>
          원본파일 다시 확인
        </button>
      </div>

      {needsManualPoNumbers.length > 0 && (
        <div style={{ marginBottom: "10px" }}>
          <button
            onClick={() => setShowManualUpload(prev => !prev)}
            style={{ ...wmsGhostButton, width: "100%", minHeight: "34px", fontSize: "11px" }}
          >
            {showManualUpload ? "고급: 수동 원본 업로드 접기" : `고급: 수동 원본 업로드 (자동검색 실패 ${needsManualPoNumbers.length}건)`}
          </button>

          {showManualUpload && (
            <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginTop: "8px" }}>
              {needsManualPoNumbers.map(poNumber => {
                const upload = uploadsByPo[poNumber];
                return (
                  <div key={poNumber} style={{ background: wmsColors.warnSoft, borderRadius: "8px", padding: "8px 10px" }}>
                    <div style={{ fontSize: "11px", fontWeight: 700, color: wmsColors.warnText, marginBottom: "6px" }}>발주서 {poNumber}</div>
                    <label
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        minHeight: "42px",
                        border: `1px dashed ${wmsColors.warnSoftBorder}`,
                        borderRadius: "8px",
                        background: "#ffffff",
                        color: wmsColors.warnText,
                        fontSize: "11px",
                        fontWeight: 700,
                        cursor: "pointer",
                      }}
                    >
                      {upload?.fileName || "원본 PO_FOR_CONFIRM 파일 선택 (xlsx)"}
                      <input type="file" accept=".xlsx" onChange={e => handleFileSelected(poNumber, e)} style={{ display: "none" }} />
                    </label>
                    {upload?.checking && <p style={{ fontSize: "10px", color: wmsColors.muted, margin: "6px 0 0" }}>발주번호 확인 중...</p>}
                    {upload?.error && <p style={{ fontSize: "10px", color: "#c0392b", margin: "6px 0 0" }}>{upload.error}</p>}
                    {upload && !upload.checking && !upload.error && (
                      <p style={{ fontSize: "10px", margin: "6px 0 0", fontWeight: 700, color: upload.matches ? wmsColors.greenDark : "#c0392b" }}>
                        {upload.matches ? `발주번호 확인됨(${upload.foundPoNumber})` : `발주번호 불일치: ${upload.foundPoNumber || "확인 불가"}`}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      <button
        onClick={handleGenerateAll}
        disabled={generating || !allReady}
        style={{ ...wmsPrimaryButton, width: "100%", opacity: generating || !allReady ? 0.5 : 1 }}
      >
        {generating
          ? progress
            ? `${progress.total}건 중 ${progress.done}건 생성 중...`
            : "생성 중..."
          : allReady
            ? "전체 발주확정 서류 생성 (ZIP)"
            : "원본 파일을 모두 준비하면 생성할 수 있습니다"}
      </button>

      {successResult && (
        <div style={{ marginTop: "8px", background: "#ffffff", border: `1px solid ${wmsColors.green}`, borderRadius: "10px", padding: "10px 12px", fontSize: "12px" }}>
          <p style={{ margin: "0 0 4px", color: wmsColors.greenDark, fontWeight: 700 }}>ZIP 파일이 다운로드되었습니다.</p>
          <ul style={{ margin: 0, paddingLeft: "16px", color: wmsColors.ink, lineHeight: 1.7 }}>
            <li>생성 파일: {successResult.fileCount}개</li>
            <li>부족수량 발생 행: {successResult.shortageRowCount}개</li>
            <li>납품부족사유 자동입력: {successResult.reasonAppliedCount}건</li>
            <li>부족사유 누락: 0건</li>
          </ul>
        </div>
      )}

      {failures && failures.length > 0 && (
        <div style={{ marginTop: "10px" }}>
          <p style={{ fontSize: "12px", color: "#c0392b", fontWeight: 700, margin: "0 0 6px" }}>
            아래 발주서에 문제가 있어 아무 파일도 내려받지 않았습니다. 수정 후 다시 시도해주세요.
          </p>
          <ul style={{ margin: 0, paddingLeft: "18px" }}>
            {failures.map(f => (
              <li key={f.poNumber} style={{ fontSize: "11px", color: "#c0392b" }}>
                발주서 {f.poNumber}: {f.message}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
