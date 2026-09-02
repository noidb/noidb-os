"use client";

import { useState } from "react";
import type { PoConfirmRow } from "@/lib/wms/picking-wave/po-confirm-rows";
import type { PoConfirmationStage } from "@/lib/wms/po-confirm-state";
import { cleanDisplayProductName } from "@/lib/wms/display-name";
import {
  wmsColors,
  wmsOuterCard,
  wmsPrimaryButton,
  wmsSageButton,
} from "@/lib/wms/ui-tokens";

/** 320px 화면에서도 상품명이 남을 수 있도록 수량 열만 고정 폭으로 둔다. */
const CONFIRM_GRID_COLUMNS = "minmax(0,1fr) 38px 38px 38px 50px";

export type PoConfirmCardStage = "eligible" | PoConfirmationStage;

export interface PoConfirmSourceSummary {
  rowCount: number;
  skuCount: number;
  totalOrderedQuantity: number;
  statusValues: string[];
  fulfillmentCenters: string[];
  sourceConfirmed: boolean;
}

interface Props {
  purchaseOrderNumber: string;
  fulfillmentCenter: string;
  rows: PoConfirmRow[];
  sourceSummary?: PoConfirmSourceSummary;
  checked: boolean;
  disabled: boolean;
  stage: PoConfirmCardStage;
  errorMessages: string[];
  confirmedQuantities: Record<string, number>;
  onToggle: () => void;
  onConfirmedQuantityChange: (skuId: string, value: number) => void;
  onMarkUploaded: () => void;
  onConfirmCompleted: () => void;
}

const STAGE_LABEL: Record<PoConfirmCardStage, string> = {
  eligible: "발주확정 가능",
  document_generated: "발주확정 서류 생성 완료",
  uploaded: "사용자가 쿠팡에 업로드함",
  confirmed: "발주확정 완료 확인",
  error: "오류",
};

function QtyHeaderCell({ top, bottom }: { top: string; bottom: string }) {
  return (
    <div style={{ textAlign: "center", lineHeight: 1.25 }}>
      <div>{top}</div>
      <div>{bottom}</div>
    </div>
  );
}

/**
 * 통합 발주확정 패널 안의 발주 1건 카드. 선택과 파일 생성은 부모에서 한 번만 수행하며,
 * 이 컴포넌트는 행 확인·확정수량 편집·명시적 상태 전이만 담당한다.
 */
export default function PoConfirmSection({
  purchaseOrderNumber,
  fulfillmentCenter,
  rows,
  sourceSummary,
  checked,
  disabled,
  stage,
  errorMessages,
  confirmedQuantities,
  onToggle,
  onConfirmedQuantityChange,
  onMarkUploaded,
  onConfirmCompleted,
}: Props) {
  const [expanded, setExpanded] = useState(false);
  const badgeColor = stage === "error"
    ? "#c0392b"
    : stage === "confirmed"
      ? wmsColors.greenDark
      : stage === "uploaded" || stage === "document_generated"
        ? wmsColors.slateDark
        : wmsColors.muted;

  return (
    <section
      style={{
        ...wmsOuterCard,
        padding: "12px",
        marginBottom: "10px",
        borderColor: checked ? wmsColors.slate : undefined,
        background: disabled ? wmsColors.surfaceBeige : "#ffffff",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          gap: "10px",
          minHeight: "48px",
          cursor: "default",
        }}
      >
        <input
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={onToggle}
          aria-label={`발주서 ${purchaseOrderNumber} 선택`}
          style={{ width: "22px", height: "22px", margin: "1px 0 0", flexShrink: 0 }}
        />
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", gap: "4px 8px" }}>
            <strong style={{ fontSize: "14px", overflowWrap: "anywhere" }}>발주서 {purchaseOrderNumber}</strong>
            <span style={{ color: badgeColor, fontSize: "11px", fontWeight: 800 }}>{STAGE_LABEL[stage]}</span>
          </span>
          <span style={{ display: "block", marginTop: "3px", color: wmsColors.muted, fontSize: "11px", lineHeight: 1.45, overflowWrap: "anywhere" }}>
            {fulfillmentCenter || "물류센터 미확인"}
            {sourceSummary
              ? ` · 원본 ${sourceSummary.rowCount}행 · SKU ${sourceSummary.skuCount}개 · 발주수량 ${sourceSummary.totalOrderedQuantity}개`
              : " · 통합 원본에서 찾지 못함"}
          </span>
        </span>
        <button type="button" onClick={() => setExpanded(value => !value)} aria-expanded={expanded} aria-label={`발주서 ${purchaseOrderNumber} 상세 ${expanded ? "접기" : "펼치기"}`} style={{ border: 0, background: "transparent", width: "36px", height: "36px", fontSize: "18px", cursor: "pointer", flexShrink: 0 }}>
          {expanded ? "▲" : "▼"}
        </button>
      </div>

      {expanded && sourceSummary?.sourceConfirmed ? (
        <p style={{ margin: "4px 0 8px 32px", fontSize: "11px", color: wmsColors.greenDark, fontWeight: 800 }}>
          원본 발주상태에서 이미 확정된 발주입니다.
        </p>
      ) : null}

      {expanded && errorMessages.length > 0 ? (
        <ul style={{ margin: "4px 0 10px 32px", paddingLeft: "16px", color: "#c0392b", fontSize: "11px", lineHeight: 1.5 }}>
          {errorMessages.map(message => <li key={message}>{message}</li>)}
        </ul>
      ) : null}

      {expanded && rows.length > 0 ? (
        <div style={{ width: "100%", minWidth: 0, marginTop: "4px", fontSize: "11px" }}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: CONFIRM_GRID_COLUMNS,
              gap: "3px",
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
                gap: "3px",
                alignItems: "center",
                padding: "7px 0",
                borderBottom: "1px solid #eee",
              }}
            >
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 700, overflowWrap: "anywhere" }}>{row.skuId}</div>
                <div style={{ color: wmsColors.muted, whiteSpace: "normal", wordBreak: "keep-all", overflowWrap: "anywhere", lineHeight: 1.35 }}>
                  {cleanDisplayProductName(row.productName)}
                </div>
              </div>
              <div style={{ textAlign: "center", fontVariantNumeric: "tabular-nums" }}>{row.originalQuantity}</div>
              <div style={{ textAlign: "center", fontVariantNumeric: "tabular-nums" }}>{row.foundQuantity}</div>
              <div style={{ textAlign: "center", color: row.shortageQuantity > 0 ? wmsColors.warn : wmsColors.muted, fontWeight: row.shortageQuantity > 0 ? 700 : 400 }}>
                {row.shortageQuantity}
              </div>
              <input
                type="number"
                min={0}
                max={row.originalQuantity}
                disabled={disabled || stage === "confirmed"}
                value={confirmedQuantities[row.skuId] ?? row.foundQuantity}
                onChange={event => onConfirmedQuantityChange(row.skuId, Math.min(row.originalQuantity, Math.max(0, Number(event.target.value) || 0)))}
                aria-label={`발주서 ${purchaseOrderNumber} SKU ${row.skuId} 확정수량`}
                style={{ width: "100%", minWidth: 0, boxSizing: "border-box", fontSize: "11px", padding: "5px 2px", borderRadius: "4px", border: `1px solid ${wmsColors.border}`, textAlign: "center" }}
              />
            </div>
          ))}
        </div>
      ) : null}

      {expanded && stage === "document_generated" ? (
        <button type="button" onClick={onMarkUploaded} style={{ ...wmsSageButton, width: "100%", minHeight: "44px", marginTop: "10px" }}>
          쿠팡에 업로드함
        </button>
      ) : null}
      {expanded && stage === "uploaded" ? (
        <button type="button" onClick={onConfirmCompleted} style={{ ...wmsPrimaryButton, width: "100%", minHeight: "44px", marginTop: "10px" }}>
          발주확정 완료 확인
        </button>
      ) : null}
    </section>
  );
}
