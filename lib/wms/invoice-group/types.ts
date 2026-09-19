/**
 * "발주묶음/생성이력"(InvoiceGroup) 전용 타입 (2026-09-18 신규).
 *
 * 기존 웨이브(PickingWave) 시스템과 완전히 독립된 저장소다. 웨이브·창고위치·Shipment분할
 * 시스템은 물류직원이 있던 시절의 잔재로 삭제 대상이 됐고, 1인 운영 체제의 실제 업무는
 * "발주확정 → 한진 송장생성 → 쉽먼트 업로드 → 바코드/출력세트 생성"이 전부다. 이 파이프라인이
 * 공유하는 유일한 단위가 "발주묶음"이라 여기서만 상태를 추적한다.
 *
 * 발주묶음 = 입고예정일·물류센터가 같아 하나의 한진 송장(1행)으로 합배송 처리하는 발주서 집합.
 * PO 1개짜리 묶음도 있고, 여러 PO가 합쳐진 묶음도 있다(mergedFromMultiplePo).
 */

/**
 * 발주묶음 진행 단계 (2026-09-18 신규 — 사용자 확정).
 *
 * 실제 업무는 "신규 → 쉽먼트완료 → 출고완료 → 쉽먼트마감 → 입고결과처리(쿠폰·광고 등록/미납SKU
 * 재발주요청/거래처발주 전부 완료) → 최종삭제"를 거친다. 각 단계 전환은 전부 사용자가 화면에서
 * 직접 버튼을 눌러 처리한다(자동 진행 없음). "쉽먼트마감"이 되면 "신규발주서 검색" 목록에서는
 * 빠지지만(더 이상 "신규"가 아니므로) 레코드 자체는 지워지지 않는다 — 입고결과처리 후속 작업이
 * 걸려 있는 채로 남아 있어야 한다. 최종삭제는 후속 작업이 다 끝나도 시스템이 자동으로 하지
 * 않고, 사용자가 직접 확인하고 삭제 버튼을 눌러야만 일어난다(InvoiceGroupRepository.delete).
 *
 * "입고결과처리"의 세부 완료 여부(쿠폰·광고/미납재발주/거래처발주)는 아직 만들지 않은 후속
 * 화면의 몫이라 이 타입에는 넣지 않는다 — 그 화면을 만들 때 이 그룹에 필드를 추가한다.
 */
export type InvoiceGroupStage = "new" | "shipment_completed" | "dispatched" | "shipment_closed";

export const INVOICE_GROUP_STAGE_ORDER: InvoiceGroupStage[] = ["new", "shipment_completed", "dispatched", "shipment_closed"];

export const INVOICE_GROUP_STAGE_LABEL: Record<InvoiceGroupStage, string> = {
  new: "신규",
  shipment_completed: "출고준비완료",
  dispatched: "출고완료",
  shipment_closed: "쉽먼트마감",
};

/** 다음 단계. 이미 마지막 단계(쉽먼트마감)면 null — 그 다음은 입고결과처리 화면(미구현)의 몫. */
export function nextInvoiceGroupStage(stage: InvoiceGroupStage): InvoiceGroupStage | null {
  const index = INVOICE_GROUP_STAGE_ORDER.indexOf(stage);
  return index >= 0 && index < INVOICE_GROUP_STAGE_ORDER.length - 1 ? INVOICE_GROUP_STAGE_ORDER[index + 1] : null;
}

/**
 * A generated file is evidence only of a local download.  It must never be
 * treated as evidence that Supplier Hub or Hanjin accepted it.  Keep the
 * checks here so every screen applies the same, deliberately narrow, gate.
 */
export function missingInvoiceGroupDispatchRequirements(group: InvoiceGroup): string[] {
  const missing: string[] = [];
  const poSet = new Set(group.purchaseOrderNumbers);
  const confirmed = new Set(group.poConfirmations.map(entry => entry.purchaseOrderNumber));
  if (confirmed.size !== poSet.size || [...poSet].some(po => !confirmed.has(po))) missing.push("발주확정 기록");
  if (!group.invoiceFileName || !group.invoiceGeneratedAt) missing.push("한진 업로드파일 생성");
  const invoicePoSet = new Set(group.shipmentInvoiceNumbers.filter(entry => entry.invoiceNumber.trim()).map(entry => entry.purchaseOrderNumber));
  if (invoicePoSet.size !== poSet.size || [...poSet].some(po => !invoicePoSet.has(po))) missing.push("PO별 한진 송장번호");
  if (!group.shipmentFileName || !group.shipmentRegisteredAt) missing.push("Supplier Hub 쉽먼트 등록 기록");
  if (!group.shipmentNumbers.some(value => /^\d{8}$/.test(value.trim()))) missing.push("8자리 Supplier Hub 쉽먼트번호");
  if (!group.barcodeFileName || !group.barcodeGeneratedAt) missing.push("바코드 파일 생성");
  if (!group.outputSetGeneratedAt) missing.push("출력세트 생성");
  return missing;
}

export function canMarkInvoiceGroupDispatched(group: InvoiceGroup): boolean {
  return group.stage === "shipment_completed" && missingInvoiceGroupDispatchRequirements(group).length === 0;
}

export function canMarkInvoiceGroupShipmentPrepared(group: InvoiceGroup): boolean {
  return group.stage === "new" && missingInvoiceGroupDispatchRequirements(group).length === 0;
}

/** PO별 "발주확정" 기록 — Supplier Hub 표준양식을 그대로 재업로드한 결과를 기록만 한다
 *  (NOID-B OS가 파일을 생성/편집하지 않는다, 2026-09-18 사용자 확정). 발주묶음(합배송)이
 *  만들어지기 전 단계라 그룹과 별개로 PO 단위 리스트로 둔다. */
export interface PoConfirmationEntry {
  purchaseOrderNumber: string;
  confirmedFileName: string;
  confirmedFilePath: string;
  confirmedAt: string;
}

/** n-Focus에서 발급된 12자리 송장번호. 쉽먼트 업로드파일(상품목록 I열)에 그대로 들어간다. */
export interface ShipmentInvoiceNumberEntry {
  purchaseOrderNumber: string;
  invoiceNumber: string;
}

/** Shipment 출력세트 5종 파일 경로 (기존 ShipmentOutputSetSection과 동일한 구성). */
export interface InvoiceGroupOutputSetFiles {
  labelPdfPath?: string;
  manifestPdfPath?: string;
  barcodeXlsxPath?: string;
  centerLabelXlsxPath?: string;
  transactionPdfPath?: string;
}

export interface InvoiceGroup {
  /** 그룹 고유ID. */
  id: string;

  // --- 식별 · 소스 ---
  purchaseOrderNumbers: string[];
  /** 입고예정일(YYYY-MM-DD) — 합배송 묶음 기준값. */
  expectedDate: string;
  /** 물류센터명 — 합배송 묶음 기준값. */
  fulfillmentCenter: string;
  /** PO 2개 이상이 합배송으로 묶였는지. */
  mergedFromMultiplePo: boolean;
  /** 재생성 시 이전 기록을 대체한 경우, 그 새 그룹의 id. 없으면 이 그룹이 최신. */
  supersededByGroupId?: string;
  /** 신규 → 쉽먼트완료 → 출고완료 → 쉽먼트마감. 사용자가 직접 버튼으로 전환한다. */
  stage: InvoiceGroupStage;

  // --- 물류센터 스냅샷 (한진 송장 AC/AD/AE열) ---
  fulfillmentCenterPhone: string;
  fulfillmentCenterZip: string;
  fulfillmentCenterAddress: string;

  // --- 발주확정 기록 (①단계, 경량화) ---
  poConfirmations: PoConfirmationEntry[];

  // --- 요약 수치 ---
  skuCount: number;
  totalQuantity: number;

  // --- 단계별 진행 시각 (재생성 가능하므로 timestamp만 최신값을 유지) ---
  invoiceGeneratedAt?: string;
  shipmentRegisteredAt?: string;
  barcodeGeneratedAt?: string;
  outputSetGeneratedAt?: string;

  // --- 한진 송장(②) ---
  invoiceFileName?: string;
  invoiceFilePath?: string;

  // --- 쉽먼트(③) ---
  shipmentInvoiceNumbers: ShipmentInvoiceNumberEntry[];
  shipmentFileName?: string;
  shipmentFilePath?: string;
  /** Local Shipment upload-file generation only; this is not external registration evidence. */
  shipmentFileGeneratedAt?: string;
  /** Supplier Hub가 발급한 쉽먼트번호. 묶음이 등록 중 쪼개지면 여러 개일 수 있다. */
  shipmentNumbers: string[];
  /** 발송일(작업일+1) — 입고결과처리 단계에서 대조용으로도 쓴다. */
  dispatchDate?: string;

  // --- 바코드(④) ---
  barcodeFileName?: string;
  barcodeFilePath?: string;

  // --- 출력세트(⑤) ---
  outputSetFiles?: InvoiceGroupOutputSetFiles;

  // --- 메타 ---
  notes?: string;
  createdAt: string;
  updatedAt: string;
}
