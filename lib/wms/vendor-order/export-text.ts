import type { VendorOrderDraftLine } from "./types";

function normalizeShareUrl(value: unknown): string | null {
  const text = String(value ?? "").trim();
  if (!text) return null;
  try {
    const url = new URL(text);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

/** 유효한 제품링크만 중복 없이 공유 문구로 만든다. 링크가 없으면 text 속성을 생략할 수 있게 undefined를 반환한다. */
export function buildProductLinkShareText(
  lines: Pick<VendorOrderDraftLine, "skuId" | "productName">[],
  productLinksBySku: Record<string, string | null | undefined>
): string | undefined {
  const seen = new Set<string>();
  const linkLines: string[] = [];
  for (const line of lines) {
    const url = normalizeShareUrl(productLinksBySku[line.skuId]);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    linkLines.push(`${linkLines.length + 1}. ${line.productName}\n${url}`);
  }
  return linkLines.length > 0 ? `제품링크\n\n${linkLines.join("\n\n")}` : undefined;
}

/**
 * 승인된 거래처별 부족분 발주서를 카카오톡으로 보낼 텍스트로 만든다.
 * 순수 문자열 포매팅만 하며, 어디로도 전송하지 않는다 — 사용자가 복사해서 직접 붙여넣는다.
 */
export function buildKakaoOrderText(vendorName: string, lines: VendorOrderDraftLine[], _waveId: string): string {
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
  ].join("\n");
}
