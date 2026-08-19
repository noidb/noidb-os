import type { VendorOrderDraftLine } from "./types";

/**
 * 승인된 거래처별 부족분 발주서를 카카오톡으로 보낼 텍스트로 만든다.
 * 순수 문자열 포매팅만 하며, 어디로도 전송하지 않는다 — 사용자가 복사해서 직접 붙여넣는다.
 */
export function buildKakaoOrderText(vendorName: string, lines: VendorOrderDraftLine[], waveId: string): string {
  const today = new Date().toLocaleDateString("ko-KR");
  const totalQuantity = lines.reduce((sum, line) => sum + line.shortageQuantity, 0);

  const itemLines = lines.map((line, index) => {
    const optionText = line.optionLabel ? ` (${line.optionLabel})` : "";
    const memoText = line.memo ? ` — ${line.memo}` : "";
    const barcodeText = line.barcode ? ` [바코드 ${line.barcode}]` : ` [쿠팡 바코드 미등록]`;
    return `${index + 1}. ${line.modelName || line.productName}${optionText} × ${line.shortageQuantity}개${barcodeText}${memoText}`;
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
    `(참고번호: ${waveId})`,
  ].join("\n");
}
