import { missingInvoiceGroupDispatchRequirements, type InvoiceGroup } from "./types";

/**
 * 출력세트를 만든 뒤 묶음에 남기는 기록(바코드 파일·출력세트 생성 시각).
 * 반드시 쉽먼트번호를 자동으로 채운 "최신 묶음"에 얹어야 한다 — 낡은 묶음에 얹으면
 * 방금 채운 쉽먼트번호·등록 기록이 빈 값으로 덮어써져 출고완료 버튼이 잠긴다(2026-10-27).
 */
export function applyOutputSetRecord(group: InvoiceGroup, barcodeFileName: string, now: string): InvoiceGroup {
  const candidate: InvoiceGroup = { ...group, barcodeFileName, barcodeGeneratedAt: now, outputSetGeneratedAt: now, updatedAt: now };
  return candidate.stage === "new" && missingInvoiceGroupDispatchRequirements(candidate).length === 0
    ? { ...candidate, stage: "shipment_completed" }
    : candidate;
}

/** 출고완료 버튼이 잠겼을 때 보여줄 빠진 항목(아직 준비 안 된 묶음 기준, 중복 없이). */
export function pendingDispatchRequirements(groups: InvoiceGroup[]): string[] {
  return [...new Set(groups.flatMap(missingInvoiceGroupDispatchRequirements))];
}
