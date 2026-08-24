"use client";

import { useState } from "react";
import { wmsColors, wmsBronzeButton, wmsGhostButton } from "@/lib/wms/ui-tokens";

/**
 * "발주확정 서류 생성" 버튼 + 안내 패널 — 1단계(버튼·화면 연결만) 전용.
 *
 * 2026-08-24 재구현 1단계: 실제 엑셀 생성/파일 업로드/API 호출은 이 컴포넌트에서 절대 하지
 * 않는다. 버튼을 눌렀을 때 같은 페이지 안에서 안내 패널만 열고 닫는다 — 이후 단계에서 이
 * 패널 안에 실제 기능(원본 파일 선택 → 생성 → 다운로드)을 채워 넣을 예정이다.
 *
 * 기존 완료 화면의 PoConfirmSection/GenerateAllPoConfirmButton(실제 API 호출)과는 완전히
 * 별개이며, 그 코드를 재사용하거나 호출하지 않는다 — 이번 단계 범위 밖이기 때문이다.
 */
export default function PoConfirmEntryButton({ itemCount }: { itemCount: number }) {
  const [showPanel, setShowPanel] = useState(false);
  const disabled = itemCount === 0;

  return (
    <div style={{ marginBottom: "14px" }}>
      <button
        type="button"
        onClick={() => setShowPanel(true)}
        disabled={disabled}
        style={{
          ...wmsBronzeButton,
          width: "100%",
          minHeight: "48px",
          fontSize: "15px",
          opacity: disabled ? 0.5 : 1,
          cursor: disabled ? "not-allowed" : "pointer",
        }}
      >
        발주확정 서류 생성
      </button>
      {disabled && (
        <p style={{ margin: "6px 0 0", fontSize: "12px", color: wmsColors.muted, textAlign: "center" }}>
          웨이브 상품이 없습니다
        </p>
      )}

      {showPanel && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="발주확정 서류 만들기"
          onClick={() => setShowPanel(false)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(37,37,37,0.5)",
            display: "flex",
            alignItems: "flex-end",
            justifyContent: "center",
            zIndex: 100,
          }}
        >
          <div
            onClick={event => event.stopPropagation()}
            style={{
              width: "100%",
              maxWidth: "480px",
              background: "#ffffff",
              borderTopLeftRadius: "16px",
              borderTopRightRadius: "16px",
              padding: "20px 18px calc(20px + env(safe-area-inset-bottom))",
              boxShadow: "0 -4px 16px rgba(30,28,25,.12)",
            }}
          >
            <h2 style={{ margin: "0 0 10px", fontSize: "17px", color: wmsColors.ink }}>발주확정 서류 만들기</h2>
            <p style={{ margin: "0 0 10px", fontSize: "14px", color: wmsColors.ink, lineHeight: 1.5 }}>
              현재 웨이브의 확정수량을 기준으로 쿠팡 발주확정 업로드 파일을 만들 수 있습니다.
            </p>
            <p style={{ margin: "0 0 18px", fontSize: "13px", color: wmsColors.muted, lineHeight: 1.5 }}>
              다음 단계에서 쿠팡 원본 발주파일 업로드 기능을 연결합니다.
            </p>
            <button
              type="button"
              onClick={() => setShowPanel(false)}
              style={{ ...wmsGhostButton, width: "100%", minHeight: "48px", fontSize: "15px" }}
            >
              닫기
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
