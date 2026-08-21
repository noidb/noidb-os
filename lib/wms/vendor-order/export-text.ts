import type { VendorOrderDraftLine } from "./types";

/**
 * 승인된 거래처별 부족분 발주서를 카카오톡으로 보낼 텍스트로 만든다.
 * 순수 문자열 포매팅만 하며, 어디로도 전송하지 않는다 — 사용자가 복사해서 직접 붙여넣는다.
 */
export function buildKakaoOrderText(vendorName: string, lines: VendorOrderDraftLine[], waveId: string): string {
  const today = new Date().toLocaleDateString("ko-KR");
  const totalQuantity = lines.reduce((sum, line) => sum + line.shortageQuantity, 0);

  // 표시 우선순위: SKU → 옵션명 → 수량 → 참고용 바코드(작게). 모델명은 화면/공유 결과물 모두에서
  // 뺀다 — 거래처가 실제로 확인하는 값은 SKU와 옵션이다 (2026-08-19 2차 실사용 테스트 반영).
  const itemLines = lines.map((line, index) => {
    const memoText = line.memo ? ` — ${line.memo}` : "";
    const barcodeText = line.barcode ? ` (참고 바코드 ${line.barcode})` : ` (참고 바코드 미등록)`;
    const actualShortage = line.actualShortageQuantity ?? line.shortageQuantity;
    return `${index + 1}. SKU ${line.skuId} · ${line.optionLabel || "옵션 없음"} × 발주 ${line.shortageQuantity}개${barcodeText}${memoText} (내부참고 부족 ${actualShortage}개)`;
  });

  return [
    `[노이드비 발주 요청]`,
    `거래처: ${vendorName}`,
    `발주일: ${today}`,
    ``,
    ...itemLines,
    ``,
    `총 ${lines.length}종 / ${totalQuantity}개`,
    ``,
    `확인 후 발주 부탁드립니다. 감사합니다.`,
    ``,
    `[배송정보]`,
    `받는 사람: 노이드비`,
    `주소: 강원도 원주시 전망길 22-3 1층`,
    `전화번호: 010-5769-5602`,
    ``,
    `(참고번호: ${waveId})`,
  ].join("\n");
}
