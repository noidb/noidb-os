"use client";

import { useState } from "react";
import { readFileAsBase64 } from "@/lib/wms/file-base64";
import { wmsColors } from "@/lib/wms/ui-tokens";

/**
 * 발주확정 다음 단계 4단계 — Supplier Hub 처리 후 쉽먼트번호가 들어간 결과 파일을 불러온다.
 * 아직 이 파일의 실제 컬럼 구조를 확인하지 못해(2026-08-19 기준 실제 샘플 없음), 특정 컬럼을
 * "쉽먼트번호"라고 임의로 단정하지 않고 시트명·헤더·미리보기만 그대로 보여준다 — 값을 어디에도
 * 저장하지 않는다. 실제 샘플이 확인되면 전용 파서로 교체할 수 있다.
 */
export default function HanjinShipmentResultUploadSection({ onLoaded }: { onLoaded?: () => void }) {
  const [fileName, setFileName] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ sheetNames: string[]; headers: string[]; previewRows: string[][]; rowCount: number } | null>(null);

  async function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setFileName(file.name);
    setError(null);
    setPreview(null);
    setChecking(true);
    try {
      const base64 = await readFileAsBase64(file);
      const response = await fetch("/api/wms/hanjin-upload/inspect-generic", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileBase64: base64 }),
      });
      const data = await response.json();
      if (!response.ok) {
        setError(data.error || "파일을 불러오지 못했습니다.");
        return;
      }
      setPreview(data);
      onLoaded?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "파일을 불러오는 중 오류가 발생했습니다.");
    } finally {
      setChecking(false);
    }
  }

  return (
    <div>
      <p style={{ fontSize: "11px", color: wmsColors.muted, margin: "0 0 10px" }}>
        Supplier Hub에서 쉽먼트 처리가 끝난 뒤 받는 결과 파일을 선택하면 내용을 미리 볼 수 있습니다.
        이 파일을 어디에도 자동 반영하지 않습니다 — 확인용입니다.
      </p>

      <label
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          minHeight: "48px",
          border: `1px dashed ${wmsColors.borderStrong}`,
          borderRadius: "10px",
          background: "#ffffff",
          color: wmsColors.ink,
          fontSize: "13px",
          fontWeight: 700,
          cursor: "pointer",
          marginBottom: "10px",
        }}
      >
        {fileName || "쉽먼트 결과 파일 선택 (xlsx)"}
        <input type="file" accept=".xlsx" onChange={handleFileSelected} style={{ display: "none" }} />
      </label>

      {checking && <p style={{ fontSize: "12px", color: wmsColors.muted }}>불러오는 중...</p>}
      {error && <p style={{ fontSize: "12px", color: "#c0392b" }}>{error}</p>}

      {preview && (
        <div>
          <p style={{ fontSize: "11px", color: wmsColors.muted, margin: "0 0 6px" }}>
            시트: {preview.sheetNames.join(", ")} · 전체 {preview.rowCount}행
          </p>
          <div style={{ overflowX: "auto" }}>
            <table style={{ borderCollapse: "collapse", fontSize: "10px", width: "100%" }}>
              <thead>
                <tr>
                  {preview.headers.map((h, i) => (
                    <th key={i} style={{ padding: "4px 6px", border: `1px solid ${wmsColors.border}`, background: wmsColors.surfaceBeige, whiteSpace: "nowrap" }}>
                      {h || `열${i + 1}`}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {preview.previewRows.map((row, ri) => (
                  <tr key={ri}>
                    {row.map((cell, ci) => (
                      <td key={ci} style={{ padding: "4px 6px", border: `1px solid ${wmsColors.border}`, whiteSpace: "nowrap" }}>
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
