"use client";

import { useEffect, useMemo, useState } from "react";
import type { PickingWaveItem } from "@/lib/wms/picking-wave/types";
import { buildPoConfirmRows } from "@/lib/wms/picking-wave/po-confirm-rows";
import { readFileAsBase64 } from "@/lib/wms/file-base64";
import { wmsColors, wmsPrimaryButton, wmsOuterCard } from "@/lib/wms/ui-tokens";
import { cleanDisplayProductName } from "@/lib/wms/display-name";

/** 상품명 열은 넓게, 수량 4개 열은 좁고 동일한 너비로 — 화면 밖으로 밀리지 않게 CSS grid를
 *  쓴다(2026-08-20 실기기 테스트 반영, 5번 요구사항: 발주확정 최종 확인 리스트 레이아웃). */
const CONFIRM_GRID_COLUMNS = "minmax(0,1fr) 40px 40px 40px 52px";

function QtyHeaderCell({ top, bottom }: { top: string; bottom: string }) {
  return (
    <div style={{ textAlign: "center", lineHeight: 1.25 }}>
      <div>{top}</div>
      <div>{bottom}</div>
    </div>
  );
}

interface Props {
  purchaseOrderNumber: string;
  fulfillmentCenter: string;
  items: PickingWaveItem[];
}

/**
 * 발주서(PO) 1건 단위로 실제 찾은 수량을 확인하고, 필요하면 확정수량을 직접 고쳐서
 * PO_FOR_CONFIRM 원본 템플릿에 반영한 서류를 생성하는 카드. 외부 Supplier Hub에는
 * 아무것도 자동 업로드하지 않는다 — 파일만 만들어 다운로드시킨다 (2026-08-19 신규).
 * 행 계산 로직은 lib/wms/picking-wave/po-confirm-rows.ts로 옮겨 "전체 발주확정 서류 생성"
 * 버튼과 공유한다(2026-08-19 4차 실사용 테스트 반영 — 중복 계산 제거).
 *
 * 2026-08-19 5차 실사용 테스트 반영: lib/wms/data/po-for-confirm 폴더와 실제 원본 보관 폴더
 * 어디에도 원본이 없으면(신규 발주서 대부분이 이 상태) "생성" 버튼 대신 원본 업로드 영역을
 * 보여준다. 업로드한 파일의 실제 발주번호를 서버에서 읽어 이 발주서와 일치하는지 먼저 확인하고,
 * 일치할 때만 생성 버튼을 활성화한다.
 */
export default function PoConfirmSection({ purchaseOrderNumber, fulfillmentCenter, items }: Props) {
  const rows = useMemo(() => buildPoConfirmRows(items, purchaseOrderNumber), [items, purchaseOrderNumber]);

  const [confirmedByskuId, setConfirmedByskuId] = useState<Record<string, number>>(() =>
    Object.fromEntries(rows.map(row => [row.skuId, row.foundQuantity]))
  );
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resultMessage, setResultMessage] = useState<string | null>(null);

  const [checkingAvailability, setCheckingAvailability] = useState(true);
  const [available, setAvailable] = useState<boolean | null>(null);

  const [uploadedFile, setUploadedFile] = useState<{ fileName: string; base64: string } | null>(null);
  const [checkingUpload, setCheckingUpload] = useState(false);
  const [uploadCheck, setUploadCheck] = useState<{ foundPoNumber: string | null; matches: boolean } | null>(null);
  const [uploadCheckError, setUploadCheckError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setCheckingAvailability(true);
      try {
        const response = await fetch("/api/wms/po-confirm/availability", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ poNumbers: [purchaseOrderNumber] }),
        });
        const data = await response.json();
        if (!cancelled) setAvailable(Boolean(data.results?.[0]?.available));
      } catch {
        if (!cancelled) setAvailable(false);
      } finally {
        if (!cancelled) setCheckingAvailability(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [purchaseOrderNumber]);

  function updateConfirmed(skuId: string, value: number) {
    setConfirmedByskuId(prev => ({ ...prev, [skuId]: Math.max(0, value) }));
  }

  async function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setUploadCheck(null);
    setUploadCheckError(null);
    setCheckingUpload(true);
    try {
      const base64 = await readFileAsBase64(file);
      setUploadedFile({ fileName: file.name, base64 });
      const response = await fetch("/api/wms/po-confirm/inspect-upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileBase64: base64, expectedPoNumber: purchaseOrderNumber }),
      });
      const data = await response.json();
      if (!response.ok) {
        setUploadCheckError(data.error || "파일을 확인하지 못했습니다.");
        return;
      }
      setUploadCheck({ foundPoNumber: data.foundPoNumber, matches: data.matches });
    } catch (err) {
      setUploadCheckError(err instanceof Error ? err.message : "파일을 확인하는 중 오류가 발생했습니다.");
    } finally {
      setCheckingUpload(false);
    }
  }

  async function handleGenerate() {
    setGenerating(true);
    setError(null);
    setResultMessage(null);
    try {
      const response = await fetch("/api/wms/po-confirm/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          poNumber: purchaseOrderNumber,
          confirmedQuantities: rows.map(row => ({ skuId: row.skuId, confirmedQuantity: confirmedByskuId[row.skuId] ?? row.foundQuantity })),
          uploadedFileBase64: available ? undefined : uploadedFile?.base64,
        }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        setError(data.error || "발주확정 서류 생성에 실패했습니다.");
        return;
      }

      const matchedCount = response.headers.get("X-Matched-Sku-Count");
      const unmatchedRaw = response.headers.get("X-Unmatched-Sku-Ids");
      const unmatched = unmatchedRaw ? decodeURIComponent(unmatchedRaw).split(",").filter(Boolean) : [];
      const shortageRowCount = response.headers.get("X-Shortage-Row-Count") || "0";

      const disposition = response.headers.get("Content-Disposition") || "";
      const fileNameMatch = disposition.match(/filename\*=UTF-8''(.+)$/);
      // 휴대폰에서도 파일명이 한글로 명확히 보이도록 서버가 만든 실제 파일명을 그대로 쓴다.
      const fileName = fileNameMatch ? decodeURIComponent(fileNameMatch[1]) : `PO_FOR_CONFIRM(${purchaseOrderNumber}).xlsx`;

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      setResultMessage(
        `${matchedCount}개 SKU 확정수량 반영 완료 · 납품부족사유 자동입력 ${shortageRowCount}건` +
          (unmatched.length > 0 ? ` (원본에서 못 찾은 SKU: ${unmatched.join(", ")})` : "")
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "발주확정 서류 생성 중 오류가 발생했습니다.");
    } finally {
      setGenerating(false);
    }
  }

  if (rows.length === 0) return null;

  const canGenerate = available === true || (available === false && uploadCheck?.matches === true);

  return (
    <div style={{ ...wmsOuterCard, padding: "12px", marginBottom: "10px" }}>
      <h3 style={{ margin: "0 0 8px", fontSize: "13px" }}>
        발주서 {purchaseOrderNumber} <span style={{ color: wmsColors.muted, fontWeight: 400 }}>· {fulfillmentCenter}</span>
      </h3>
      <div style={{ width: "100%", minWidth: 0, marginBottom: "10px", fontSize: "11px" }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: CONFIRM_GRID_COLUMNS,
            gap: "4px",
            padding: "0 0 6px",
            borderBottom: `1px solid ${wmsColors.border}`,
            color: wmsColors.muted,
            fontWeight: 700,
          }}
        >
          <div>상품명</div>
          <QtyHeaderCell top="발주" bottom="수량" />
          <QtyHeaderCell top="찾은" bottom="수량" />
          <QtyHeaderCell top="부족" bottom="수량" />
          <QtyHeaderCell top="확정" bottom="수량" />
        </div>
        {rows.map(row => (
          <div
            key={row.skuId}
            style={{
              display: "grid",
              gridTemplateColumns: CONFIRM_GRID_COLUMNS,
              gap: "4px",
              alignItems: "center",
              padding: "6px 0",
              borderBottom: "1px solid #eee",
            }}
          >
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 700 }}>{row.skuId}</div>
              <div style={{ color: wmsColors.muted, whiteSpace: "normal", wordBreak: "keep-all", overflowWrap: "anywhere", lineHeight: 1.35 }}>
                {cleanDisplayProductName(row.productName)}
              </div>
            </div>
            <div style={{ textAlign: "center", fontVariantNumeric: "tabular-nums" }}>{row.originalQuantity}</div>
            <div style={{ textAlign: "center", fontVariantNumeric: "tabular-nums" }}>{row.foundQuantity}</div>
            <div
              style={{
                textAlign: "center",
                fontVariantNumeric: "tabular-nums",
                color: row.shortageQuantity > 0 ? wmsColors.warn : wmsColors.muted,
                fontWeight: row.shortageQuantity > 0 ? 700 : 400,
              }}
            >
              {row.shortageQuantity}
            </div>
            <div>
              <input
                type="number"
                min={0}
                value={confirmedByskuId[row.skuId] ?? row.foundQuantity}
                onChange={e => updateConfirmed(row.skuId, Number(e.target.value) || 0)}
                style={{
                  width: "100%",
                  minWidth: 0,
                  boxSizing: "border-box",
                  fontSize: "11px",
                  padding: "3px 2px",
                  borderRadius: "4px",
                  border: `1px solid ${wmsColors.border}`,
                  textAlign: "center",
                  fontVariantNumeric: "tabular-nums",
                }}
              />
            </div>
          </div>
        ))}
      </div>

      {checkingAvailability && <p style={{ fontSize: "11px", color: wmsColors.muted, marginBottom: "8px" }}>원본 파일 확인 중...</p>}

      {!checkingAvailability && available === false && (
        <div style={{ background: wmsColors.warnSoft, borderRadius: "8px", padding: "10px", marginBottom: "10px" }}>
          <p style={{ fontSize: "11px", color: wmsColors.warnText, margin: "0 0 8px", fontWeight: 700 }}>
            이 발주서의 원본 PO_FOR_CONFIRM 파일을 자동으로 찾지 못했습니다 — 원본 파일을 직접 업로드해주세요.
          </p>
          <label
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              minHeight: "44px",
              border: `1px dashed ${wmsColors.warnSoftBorder}`,
              borderRadius: "8px",
              background: "#ffffff",
              color: wmsColors.warnText,
              fontSize: "12px",
              fontWeight: 700,
              cursor: "pointer",
              marginBottom: "6px",
            }}
          >
            {uploadedFile ? uploadedFile.fileName : "원본 PO_FOR_CONFIRM 파일 선택 (xlsx)"}
            <input type="file" accept=".xlsx" onChange={handleFileSelected} style={{ display: "none" }} />
          </label>
          {checkingUpload && <p style={{ fontSize: "11px", color: wmsColors.muted, margin: 0 }}>발주번호 확인 중...</p>}
          {uploadCheckError && <p style={{ fontSize: "11px", color: "#c0392b", margin: 0 }}>{uploadCheckError}</p>}
          {uploadCheck && (
            <p style={{ fontSize: "11px", margin: 0, fontWeight: 700, color: uploadCheck.matches ? wmsColors.greenDark : "#c0392b" }}>
              {uploadCheck.matches
                ? `발주번호 확인됨(${uploadCheck.foundPoNumber}) — 이 발주서와 일치합니다.`
                : `발주번호 불일치: 업로드한 파일은 ${uploadCheck.foundPoNumber || "확인 불가"}용입니다. 이 발주서(${purchaseOrderNumber})와 다릅니다.`}
            </p>
          )}
        </div>
      )}

      <p style={{ fontSize: "10px", color: wmsColors.muted, margin: "0 0 8px" }}>
        확정수량이 발주수량보다 적은 상품에는 "협력사 재고부족 - 재고 할당정책"이 자동 입력됩니다.
      </p>

      {error && <p style={{ fontSize: "11px", color: "#c0392b", marginBottom: "8px" }}>{error}</p>}
      {resultMessage && <p style={{ fontSize: "11px", color: wmsColors.greenDark, marginBottom: "8px" }}>{resultMessage}</p>}

      <button
        onClick={handleGenerate}
        disabled={generating || checkingAvailability || !canGenerate}
        style={{ ...wmsPrimaryButton, width: "100%", minHeight: "36px", fontSize: "12px", opacity: generating || checkingAvailability || !canGenerate ? 0.5 : 1 }}
      >
        {generating ? "생성 중..." : "발주확정 서류 생성"}
      </button>
    </div>
  );
}
