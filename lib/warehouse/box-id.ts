import type { WarehouseBox } from "@/lib/wms/types";

/** BOX ID 형식: 카테고리코드-선반코드-3자리번호 (예: "E-A-001") */
export const BOX_ID_PATTERN = /^[A-Z0-9]+-[A-Z0-9]+-\d{3}$/;

export function isValidBoxIdFormat(id: string): boolean {
  return BOX_ID_PATTERN.test(id.trim());
}

/** Shelf ID(예: "E-A")에서 선반코드("A")만 추출한다. */
export function shelfCodeFromShelfId(shelfId: string): string {
  const parts = shelfId.split("-");
  return parts[parts.length - 1] || shelfId;
}

/**
 * 구역(zoneId)+선반(shelfId) 조합에서 다음 BOX 번호를 추천한다.
 * 저장 전 사용자가 자유롭게 수정할 수 있으므로, 이 함수는 "추천값"만 만든다.
 */
export function suggestNextBoxId(existingBoxes: WarehouseBox[], zoneId: string, shelfId: string): string {
  const shelfCode = shelfCodeFromShelfId(shelfId);
  const prefix = `${zoneId}-${shelfCode}-`;
  const usedNumbers = existingBoxes
    .filter(box => box.id.startsWith(prefix))
    .map(box => Number(box.id.slice(prefix.length)))
    .filter(n => Number.isFinite(n));
  const next = (usedNumbers.length ? Math.max(...usedNumbers) : 0) + 1;
  return `${prefix}${String(next).padStart(3, "0")}`;
}

export function isBoxIdTaken(existingBoxes: WarehouseBox[], boxId: string): boolean {
  const normalized = boxId.trim().toUpperCase();
  return existingBoxes.some(box => box.id.toUpperCase() === normalized);
}
