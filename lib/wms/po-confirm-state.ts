import type { PickingWave } from "./picking-wave/types";

/**
 * 발주확정 서류 생성 이후의 진행상태는 웨이브 전체 상태와 분리해 발주번호별로 보관한다.
 * "파일을 만들었다"와 "쿠팡에서 발주확정이 확인됐다"를 같은 상태로 취급하지 않기 위함이다.
 */
export type PoConfirmationStage = "document_generated" | "uploaded" | "confirmed" | "error";

export interface PoConfirmationRecord {
  poNumber: string;
  waveId: string;
  stage: PoConfirmationStage;
  sourceFileName: string;
  sourceFileHash: string;
  sourcePurchaseOrderCount: number;
  sourceRowCount: number;
  selectedRowCount: number;
  /** 브라우저로 내려받은 통합 서류의 표시 파일명. 실제 파일 bytes나 원본 경로는 저장하지 않는다. */
  generatedFileName?: string;
  documentGeneratedAt?: string;
  uploadedAt?: string;
  confirmedAt?: string;
  errorMessage?: string;
  updatedAt: string;
}

export const PO_CONFIRMATION_STORAGE_KEY = "noidb_po_confirmation_records";

const STAGES = new Set<PoConfirmationStage>(["document_generated", "uploaded", "confirmed", "error"]);

function isBrowser(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === "string";
}

/** 파괴 작업 전에도 재사용할 수 있는 엄격 검증. 잘못된 레코드는 빈 목록으로 숨기지 않는다. */
export function isPoConfirmationRecord(value: unknown): value is PoConfirmationRecord {
  if (!isObject(value)) return false;
  return (
    typeof value.poNumber === "string" && value.poNumber.trim().length > 0 &&
    typeof value.waveId === "string" && value.waveId.trim().length > 0 &&
    typeof value.stage === "string" && STAGES.has(value.stage as PoConfirmationStage) &&
    typeof value.sourceFileName === "string" &&
    typeof value.sourceFileHash === "string" &&
    isNonNegativeInteger(value.sourcePurchaseOrderCount) &&
    isNonNegativeInteger(value.sourceRowCount) &&
    isNonNegativeInteger(value.selectedRowCount) &&
    isOptionalString(value.generatedFileName) &&
    isOptionalString(value.documentGeneratedAt) &&
    isOptionalString(value.uploadedAt) &&
    isOptionalString(value.confirmedAt) &&
    isOptionalString(value.errorMessage) &&
    typeof value.updatedAt === "string" && value.updatedAt.trim().length > 0
  );
}

function normalizeRecord(record: PoConfirmationRecord): PoConfirmationRecord {
  return {
    ...record,
    poNumber: record.poNumber.trim(),
    waveId: record.waveId.trim(),
    sourceFileName: record.sourceFileName.trim(),
    sourceFileHash: record.sourceFileHash.trim(),
    generatedFileName: record.generatedFileName?.trim() || undefined,
    errorMessage: record.errorMessage?.trim() || undefined,
    updatedAt: record.updatedAt.trim(),
  };
}

/** null(아직 저장한 적 없음)은 빈 목록, 그 외 잘못된 JSON/구조는 오류로 처리한다. */
export function parsePoConfirmationRecords(raw: string | null): PoConfirmationRecord[] {
  if (raw === null) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("발주확정 상태 저장값이 손상되어 작업을 중단했습니다.");
  }
  if (!Array.isArray(parsed) || !parsed.every(isPoConfirmationRecord)) {
    throw new Error("발주확정 상태 저장값의 형식이 올바르지 않아 작업을 중단했습니다.");
  }
  return parsed.map(normalizeRecord);
}

export function serializePoConfirmationRecords(records: readonly PoConfirmationRecord[]): string {
  const normalized = records.map(record => {
    if (!isPoConfirmationRecord(record)) {
      throw new Error("저장할 발주확정 상태의 형식이 올바르지 않습니다.");
    }
    return normalizeRecord(record);
  });
  return JSON.stringify(normalized);
}

export function replaceLocalPoConfirmationRecords(records: readonly PoConfirmationRecord[]): void {
  if (!isBrowser()) return;
  window.localStorage.setItem(PO_CONFIRMATION_STORAGE_KEY, serializePoConfirmationRecords(records));
}

async function syncPoConfirmationMutation(mutation: Record<string, unknown>): Promise<void> {
  if (!isBrowser()) return;
  try {
    const response = await fetch("/api/wms/picking-waves", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(mutation),
      cache: "no-store",
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.ok || !result.snapshot) throw new Error(result.error || `HTTP ${response.status}`);
    replaceLocalPoConfirmationRecords(result.snapshot.poConfirmationRecords || []);
  } catch (error) {
    if (process.env.NODE_ENV !== "production") console.warn("[po-confirm-sync] 서버 저장 실패 — localStorage 복구본을 유지합니다.", error);
  }
}

/**
 * 발주번호당 최신 레코드 하나만 유지한다. confirmed는 외부 업로드 확인까지 끝난 종결상태이므로
 * 비확정 상태로 실수로 되돌리는 쓰기는 무시한다. confirmed 레코드끼리는 최신 메타데이터로 갱신한다.
 */
export function mergePoConfirmationRecords(
  existing: readonly PoConfirmationRecord[],
  incoming: readonly PoConfirmationRecord[]
): PoConfirmationRecord[] {
  const merged = existing.map(normalizeRecord);
  const indexByPo = new Map(merged.map((record, index) => [record.poNumber, index]));

  for (const candidate of incoming) {
    if (!isPoConfirmationRecord(candidate)) {
      throw new Error("저장할 발주확정 상태의 형식이 올바르지 않습니다.");
    }
    const next = normalizeRecord(candidate);
    const index = indexByPo.get(next.poNumber);
    if (index === undefined) {
      indexByPo.set(next.poNumber, merged.length);
      merged.push(next);
      continue;
    }
    if (merged[index].stage === "confirmed" && next.stage !== "confirmed") continue;
    merged[index] = next;
  }
  return merged;
}

/** 웨이브 삭제 시 임시 진행상태만 제거하고, 확정 완료 이력은 웨이브와 독립적으로 보존한다. */
export function removeTransientPoConfirmationRecordsForWave(
  records: readonly PoConfirmationRecord[],
  waveId: string
): PoConfirmationRecord[] {
  const target = waveId.trim();
  return records.filter(record => record.waveId !== target || record.stage === "confirmed");
}

export function listPoConfirmationRecords(): PoConfirmationRecord[] {
  if (!isBrowser()) return [];
  return parsePoConfirmationRecords(window.localStorage.getItem(PO_CONFIRMATION_STORAGE_KEY));
}

export function upsertPoConfirmationRecords(
  records: PoConfirmationRecord | readonly PoConfirmationRecord[]
): PoConfirmationRecord[] {
  if (!isBrowser()) return [];
  const incoming = Array.isArray(records) ? records : [records];
  const next = mergePoConfirmationRecords(listPoConfirmationRecords(), incoming);
  window.localStorage.setItem(PO_CONFIRMATION_STORAGE_KEY, serializePoConfirmationRecords(next));
  void syncPoConfirmationMutation({ action: "upsertPoConfirmationRecords", records: incoming });
  return next;
}

export function getPoConfirmationRecord(poNumber: string): PoConfirmationRecord | null {
  const target = poNumber.trim();
  if (!target) return null;
  return listPoConfirmationRecords().find(record => record.poNumber === target) || null;
}

/**
 * 원본을 다시 검사해 정상으로 돌아온 발주가 이전 error 기록 때문에 계속 막히지 않도록 한다.
 * 생성·업로드·확정 이력은 절대 지우지 않고, 지정한 발주번호의 error만 제거한다.
 */
export function clearPoConfirmationErrors(
  poNumbers: readonly string[],
  waveId?: string
): PoConfirmationRecord[] {
  if (!isBrowser()) return [];
  const targets = new Set(poNumbers.map(poNumber => poNumber.trim()).filter(Boolean));
  const targetWaveId = waveId?.trim();
  const next = listPoConfirmationRecords().filter(record => {
    if (record.stage !== "error" || !targets.has(record.poNumber)) return true;
    return Boolean(targetWaveId) && record.waveId !== targetWaveId;
  });
  window.localStorage.setItem(PO_CONFIRMATION_STORAGE_KEY, serializePoConfirmationRecords(next));
  void syncPoConfirmationMutation({ action: "clearPoConfirmationErrors", poNumbers: [...targets], waveId: targetWaveId, deletedAt: new Date().toISOString() });
  return next;
}

/**
 * 신규 발주번호별 confirmed 레코드와 기존 웨이브의 order_confirmed 상태를 함께 읽는다.
 * 기존 저장 데이터를 마이그레이션하지 않아도 이미 확정된 발주가 다시 선택되는 것을 막는다.
 */
export function collectConfirmedPurchaseOrderNumbers(
  waves: readonly Pick<PickingWave, "status" | "sourcePurchaseOrderNumbers">[],
  records: readonly PoConfirmationRecord[]
): Set<string> {
  const confirmed = new Set<string>();
  for (const record of records) {
    if (record.stage === "confirmed" && record.poNumber.trim()) confirmed.add(record.poNumber.trim());
  }
  for (const wave of waves) {
    if (wave.status !== "order_confirmed") continue;
    for (const poNumber of wave.sourcePurchaseOrderNumbers) {
      const normalized = poNumber.trim();
      if (normalized) confirmed.add(normalized);
    }
  }
  return confirmed;
}
