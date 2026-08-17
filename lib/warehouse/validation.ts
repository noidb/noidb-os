import type { WarehouseBox, ModelLocation, SkuLocation } from "@/lib/wms/types";

export type WarehouseValidationIssueType =
  | "unassigned_model"
  | "missing_box_reference"
  | "duplicate_box_id"
  | "empty_box"
  | "inactive_box_placement"
  | "duplicate_sku_exception"
  | "set_product_wrong_box";

export interface WarehouseValidationIssue {
  type: WarehouseValidationIssueType;
  message: string;
  /** 바로 수정 화면으로 이동할 수 있도록, 어떤 대상(모델명/BOX ID/SKU ID)에 대한 문제인지 표시 */
  targetKind: "model" | "box" | "sku";
  targetId: string;
}

export interface WarehouseValidationInput {
  boxes: WarehouseBox[];
  modelLocations: ModelLocation[];
  skuExceptions: SkuLocation[];
  /** 제품 카탈로그(제품DB) 상 존재하는 모델명 전체 — 미배치 판정 기준 */
  catalogModelNames: string[];
}

const ISSUE_LABEL: Record<WarehouseValidationIssueType, string> = {
  unassigned_model: "미배치 모델",
  missing_box_reference: "없는 BOX를 참조하는 모델",
  duplicate_box_id: "중복 BOX ID",
  empty_box: "모델 없는 BOX",
  inactive_box_placement: "비활성 BOX에 배치된 모델",
  duplicate_sku_exception: "동일 SKU의 중복 예외 위치",
  set_product_wrong_box: "세트상품인데 일반 BOX에 배치된 모델",
};

export function validateWarehouse(input: WarehouseValidationInput): WarehouseValidationIssue[] {
  const { boxes, modelLocations, skuExceptions, catalogModelNames } = input;
  const issues: WarehouseValidationIssue[] = [];

  const boxById = new Map(boxes.map(box => [box.id, box]));
  const modelLocationByName = new Map(modelLocations.map(location => [location.modelName, location]));

  // 1. 미배치 모델: 카탈로그에는 있는데 모델위치/SKU예외 어디에도 없음
  const modelsWithSkuException = new Set(skuExceptions.map(exception => exception.modelName));
  for (const modelName of catalogModelNames) {
    if (modelLocationByName.has(modelName)) continue;
    if (modelsWithSkuException.has(modelName)) continue;
    issues.push({
      type: "unassigned_model",
      message: `${ISSUE_LABEL.unassigned_model}: "${modelName}" 모델의 위치가 등록되지 않았습니다.`,
      targetKind: "model",
      targetId: modelName,
    });
  }

  // 2. 없는 BOX를 참조하는 모델
  for (const location of modelLocations) {
    if (location.primaryBoxId && !boxById.has(location.primaryBoxId)) {
      issues.push({
        type: "missing_box_reference",
        message: `${ISSUE_LABEL.missing_box_reference}: "${location.modelName}"의 기본 BOX "${location.primaryBoxId}"가 BOX마스터에 없습니다.`,
        targetKind: "model",
        targetId: location.modelName,
      });
    }
    if (location.secondaryBoxId && !boxById.has(location.secondaryBoxId)) {
      issues.push({
        type: "missing_box_reference",
        message: `${ISSUE_LABEL.missing_box_reference}: "${location.modelName}"의 보조 BOX "${location.secondaryBoxId}"가 BOX마스터에 없습니다.`,
        targetKind: "model",
        targetId: location.modelName,
      });
    }
  }
  for (const exception of skuExceptions) {
    if (exception.boxId && !boxById.has(exception.boxId)) {
      issues.push({
        type: "missing_box_reference",
        message: `${ISSUE_LABEL.missing_box_reference}: SKU "${exception.skuId}"의 예외 BOX "${exception.boxId}"가 BOX마스터에 없습니다.`,
        targetKind: "sku",
        targetId: exception.skuId,
      });
    }
  }

  // 3. 중복 BOX ID
  const boxIdCounts = new Map<string, number>();
  for (const box of boxes) boxIdCounts.set(box.id, (boxIdCounts.get(box.id) || 0) + 1);
  for (const [boxId, count] of boxIdCounts) {
    if (count > 1) {
      issues.push({
        type: "duplicate_box_id",
        message: `${ISSUE_LABEL.duplicate_box_id}: "${boxId}"가 BOX마스터에 ${count}번 등록되어 있습니다.`,
        targetKind: "box",
        targetId: boxId,
      });
    }
  }

  // 4. 모델 없는 BOX (고아 BOX)
  const referencedBoxIds = new Set<string>();
  for (const location of modelLocations) {
    if (location.primaryBoxId) referencedBoxIds.add(location.primaryBoxId);
    if (location.secondaryBoxId) referencedBoxIds.add(location.secondaryBoxId);
  }
  for (const exception of skuExceptions) referencedBoxIds.add(exception.boxId);
  for (const box of boxes) {
    if (!referencedBoxIds.has(box.id)) {
      issues.push({
        type: "empty_box",
        message: `${ISSUE_LABEL.empty_box}: "${box.id}"에 연결된 모델이 없습니다.`,
        targetKind: "box",
        targetId: box.id,
      });
    }
  }

  // 5. 비활성 BOX에 배치된 모델
  for (const location of modelLocations) {
    const box = boxById.get(location.primaryBoxId);
    if (box && box.status !== "active") {
      issues.push({
        type: "inactive_box_placement",
        message: `${ISSUE_LABEL.inactive_box_placement}: "${location.modelName}"이 사용중이 아닌 BOX "${box.id}"(${box.status})에 배치되어 있습니다.`,
        targetKind: "model",
        targetId: location.modelName,
      });
    }
  }

  // 6. 동일 SKU의 중복 예외 위치
  const skuExceptionCounts = new Map<string, number>();
  for (const exception of skuExceptions) skuExceptionCounts.set(exception.skuId, (skuExceptionCounts.get(exception.skuId) || 0) + 1);
  for (const [skuId, count] of skuExceptionCounts) {
    if (count > 1) {
      issues.push({
        type: "duplicate_sku_exception",
        message: `${ISSUE_LABEL.duplicate_sku_exception}: SKU "${skuId}"에 예외 위치가 ${count}번 등록되어 있습니다.`,
        targetKind: "sku",
        targetId: skuId,
      });
    }
  }

  // 7. 세트상품인데 일반 BOX에 배치된 모델
  for (const location of modelLocations) {
    if (!location.isSetProduct) continue;
    const box = boxById.get(location.primaryBoxId);
    if (box && !box.isSetBox) {
      issues.push({
        type: "set_product_wrong_box",
        message: `${ISSUE_LABEL.set_product_wrong_box}: 세트상품 "${location.modelName}"이 세트 전용이 아닌 BOX "${box.id}"에 배치되어 있습니다.`,
        targetKind: "model",
        targetId: location.modelName,
      });
    }
  }

  return issues;
}

export function issueTypeLabel(type: WarehouseValidationIssueType): string {
  return ISSUE_LABEL[type];
}
