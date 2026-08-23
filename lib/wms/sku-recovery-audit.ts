export type RecoveryGrade = "A" | "B" | "C" | "D" | "E";

export interface RecoveryApprovedSku {
  skuId: string;
  barcode: string;
  productName: string;
  modelName?: string;
  modelSku?: string;
  option?: string;
  color?: string;
  size?: string;
  productLink?: string;
  previousSkuId?: string;
  source: string;
}

export interface RecoveryProductDbRow {
  sheetRowNumber: number;
  skuId: string;
  barcode: string;
  productName: string;
  modelName: string;
  modelSku: string;
  option?: string;
  color?: string;
  size?: string;
  productLink?: string;
  currentStatus: string;
  warehouseNumber?: string;
  currentStock?: string;
  cumulativeInbound?: string;
  pendingInbound?: string;
  lastOrderDate?: string;
  lastInboundDate?: string;
  supplyPriceHistory?: string;
  package?: string;
}

export interface RecoveryAuditRow {
  approved: RecoveryApprovedSku;
  grade: RecoveryGrade;
  candidateRows: number[];
  selectedRow: RecoveryProductDbRow | null;
  evidence: string[];
  packageRow: boolean;
  autoApplyCandidate: boolean;
  recommendation: string;
}

export interface RecoveryAuditReport {
  total: number;
  counts: Record<RecoveryGrade, number>;
  rows: RecoveryAuditRow[];
  atomicProductEligibility: Record<string, boolean>;
}

function compact(value: unknown): string {
  return String(value ?? "").toLowerCase().replace(/노이드비|자체제작|free|프리/g, "").replace(/[^0-9a-z가-힣]/g, "");
}

function upper(value: unknown): string {
  return String(value ?? "").trim().toUpperCase();
}

export function isPackageLike(value: Pick<RecoveryProductDbRow, "productName" | "package"> | Pick<RecoveryApprovedSku, "productName">): boolean {
  const packageValue = "package" in value ? String(value.package ?? "").trim() : "";
  return Boolean(packageValue) || /패키지|랜덤발송|(?:^|\s|\d)세트(?:\s|$)/i.test(String(value.productName ?? ""));
}

function optionKey(value: { option?: string; color?: string; size?: string; productName: string }): string {
  const explicit = compact(`${value.option ?? ""}|${value.color ?? ""}|${value.size ?? ""}`);
  if (explicit) return explicit;
  const parts = String(value.productName ?? "").split(/[,/]/).slice(1).join(" ");
  return compact(parts);
}

function matchLevel(approved: RecoveryApprovedSku, row: RecoveryProductDbRow): { level: number; evidence: string } | null {
  if (isPackageLike(approved) !== isPackageLike(row)) return null;
  const approvedModelSku = upper(approved.modelSku);
  if (approvedModelSku && approvedModelSku === upper(row.modelSku)) return { level: 1, evidence: "모델SKU 정확 일치" };

  const model = upper(approved.modelName);
  const sameModel = Boolean(model) && model === upper(row.modelName);
  const approvedOption = optionKey(approved);
  const rowOption = optionKey(row);
  if (sameModel && approvedOption && approvedOption === rowOption) return { level: 2, evidence: "모델명 + 색상/사이즈/옵션 정확 일치" };

  if (sameModel && compact(approved.productName) === compact(row.productName) && approvedOption && approvedOption === rowOption) {
    return { level: 3, evidence: "모델명 + 정규화 상품명 + 옵션 일치" };
  }

  const historyMatches = Boolean(approved.previousSkuId) && upper(approved.previousSkuId) === upper(row.skuId);
  const linkMatches = Boolean(approved.productLink) && compact(approved.productLink) === compact(row.productLink);
  const barcodeMatches = Boolean(approved.barcode) && upper(approved.barcode) === upper(row.barcode);
  if (historyMatches && (linkMatches || barcodeMatches)) return { level: 4, evidence: "기존 SKU 이력 + 상품링크/바코드 이력 일치" };
  return null;
}

export function buildSkuRecoveryAudit(approvedRows: RecoveryApprovedSku[], productDbRows: RecoveryProductDbRow[]): RecoveryAuditReport {
  const skuUsage = new Map<string, RecoveryProductDbRow[]>();
  productDbRows.forEach(row => {
    const key = upper(row.skuId);
    if (key) skuUsage.set(key, [...(skuUsage.get(key) ?? []), row]);
  });

  const rows: RecoveryAuditRow[] = approvedRows.map(approved => {
    const existingSkuRows = skuUsage.get(upper(approved.skuId)) ?? [];
    if (existingSkuRows.length > 1) {
      return { approved, grade: "E", candidateRows: existingSkuRows.map(row => row.sheetRowNumber), selectedRow: null,
        evidence: [`새 SKU가 제품DB에 ${existingSkuRows.length}건 존재`], packageRow: isPackageLike(approved), autoApplyCandidate: false,
        recommendation: "중복 행의 운영 데이터와 이력을 사용자 확인 후 수동 정리" };
    }

    const matches = productDbRows.map(row => ({ row, match: matchLevel(approved, row) })).filter(item => item.match);
    const bestLevel = matches.reduce((best, item) => Math.min(best, item.match!.level), Number.POSITIVE_INFINITY);
    const best = matches.filter(item => item.match!.level === bestLevel);
    if (best.length > 1) {
      return { approved, grade: "C", candidateRows: best.map(item => item.row.sheetRowNumber), selectedRow: null,
        evidence: [`동일 우선순위 후보 ${best.length}개`, best[0].match!.evidence], packageRow: isPackageLike(approved), autoApplyCandidate: false,
        recommendation: "후보 행 2건 이상이므로 쓰기 중단 후 사용자 확인" };
    }
    if (best.length === 0) {
      return { approved, grade: "D", candidateRows: [], selectedRow: null, evidence: ["허용된 복합키로 일치하는 기존 행 없음"],
        packageRow: isPackageLike(approved), autoApplyCandidate: false, recommendation: "행 삽입 금지 상태로 원본/백업에서 내부키를 추가 확인" };
    }
    const selected = best[0];
    const grade: RecoveryGrade = selected.match!.level <= 2 ? "A" : "B";
    return { approved, grade, candidateRows: [selected.row.sheetRowNumber], selectedRow: selected.row,
      evidence: [selected.match!.evidence, existingSkuRows.length === 0 ? "새 SKU가 제품DB 전체에서 0건" : "새 SKU가 이미 1건 존재"],
      packageRow: isPackageLike(approved), autoApplyCandidate: grade === "A" && existingSkuRows.length === 0,
      recommendation: grade === "A" ? "상품 전체 옵션 검증 통과 시 고정 행번호에 SKU/바코드/상태만 일괄 반영" : "정보 보완 후 사용자 확인" };
  });

  const byProduct = new Map<string, RecoveryAuditRow[]>();
  rows.forEach(row => {
    const key = upper(row.approved.modelName) || compact(row.approved.productName.split(/[,/]/)[0]);
    byProduct.set(key, [...(byProduct.get(key) ?? []), row]);
  });
  const atomicProductEligibility: Record<string, boolean> = {};
  byProduct.forEach((items, key) => {
    const targetRows = items.flatMap(item => item.candidateRows);
    atomicProductEligibility[key] = items.every(item => item.autoApplyCandidate) && new Set(targetRows).size === items.length;
    if (!atomicProductEligibility[key]) items.forEach(item => { item.autoApplyCandidate = false; });
  });

  const counts: Record<RecoveryGrade, number> = { A: 0, B: 0, C: 0, D: 0, E: 0 };
  rows.forEach(row => { counts[row.grade] += 1; });
  return { total: rows.length, counts, rows, atomicProductEligibility };
}
