import type { VendorOrderDraftLine } from "./types";
import { encodeCode128B } from "./code128";
import { resolveDisplayNameAndOption } from "../display-name";

/**
 * 승인된 거래처별 부족분 발주서를 세로형(모바일 스크린샷/카카오톡 전송에 적합한) PNG 이미지로 그린다.
 * 브라우저 Canvas 2D API만 쓰고 외부 라이브러리는 쓰지 않는다. 클라이언트 전용 함수.
 *
 * 2026-08-19 3차 실사용 테스트 — 근본 원인 수정: 구글드라이브/쿠팡CDN 이미지는 CORS 허용 헤더를
 * 보내지 않아 crossOrigin="anonymous"로 직접 불러오면 항상 실패해 전부 "이미지 미등록"으로
 * 보였다. /api/wms/image-proxy(같은 origin 중계)를 거쳐 불러오면 Canvas가 오염되지 않는다.
 * 그래도 실패하는 이미지는 콘솔에 원인을 남기고 자리표시자만 대신 그린다(전체 생성은 막지 않음).
 *
 * 2026-08-20 실기기 테스트 반영 — 거래처가 실제로 중요하게 보는 정보(카테고리·옵션·수량·상품
 * 이미지) 우선 재배치. 카드 구조를 위에서부터: ① 카테고리/옵션/수량(크게, 최상단) →
 * ② 상품 이미지(카드 가로폭 최대) → ③ 상품명(줄바꿈, 브랜드명 제거) → ④ SKU/바코드 가로 2열
 * 순서로 바꿨다. 여백을 전반적으로 줄이고, 화면 미리보기(ExportPanel의 handleShare/handleSave)와
 * 실제 카카오톡 공유 이미지가 이 함수 하나만 거치므로 항상 같은 결과가 나온다.
 */

const HEADER_HEIGHT = 190;
/** 카카오톡/사진 앱에서 축소 표시되어도 글자가 선명하도록 최종 PNG 자체를 1080px로 만든다. */
const WIDTH = 1080;
const CARD_PAD_X = 48;
const IMAGE_SIZE = WIDTH - CARD_PAD_X * 2; // 카드 가로폭 최대한 크게(2026-08-20)
const TOP_INFO_GAP_TOP = 26;
const GAP_INFO_TO_IMAGE = 22;
const GAP_IMAGE_TO_NAME = 28;
const NAME_FONT = "bold 38px sans-serif";
const NAME_LINE_HEIGHT = 50;
const GAP_NAME_TO_SKUROW = 24;
const SKU_BARCODE_ROW_HEIGHT = 150;
const CARD_BOTTOM_PAD = 38;
const TEXT_MAX_WIDTH = WIDTH - CARD_PAD_X * 2;

/** 상단 카테고리/옵션/수량 3줄 — 값이 없는 항목은 "미분류"/"옵션 없음" 같은 폴백 문구를 아예
 *  출력하지 않고 그 줄 자체(공간 포함)를 만들지 않는다(2026-08-20 실기기 추가 확인 6번).
 *  수량은 항상 표시한다. */
interface TopInfoLine {
  text: string;
  font: string;
  color: string;
  lineHeight: number;
  marginTop: number;
  marginBottom: number;
}

interface CardLayout {
  line: VendorOrderDraftLine;
  displayName: string;
  topInfoLines: Array<TopInfoLine & { wrappedLines: string[] }>;
  topInfoHeight: number;
  nameLines: string[];
  cardHeight: number;
}

function buildTopInfoLines(category: string, option: string, quantity: number, memo = ""): TopInfoLine[] {
  const lines: TopInfoLine[] = [];
  // 사진만으로 혼동하기 쉬운 세 분류만 거래처 공유 이미지에 표시한다. 그 밖의 긴 쿠팡 분류 경로는
  // 상품명과 이미지를 가리고 거래처 작업에도 필요하지 않아 줄 자체를 만들지 않는다.
  if (category && /(목걸이|팔찌|발찌)/.test(category)) {
    lines.push({ text: category, font: "bold 36px sans-serif", color: "#252525", lineHeight: 46, marginTop: 0, marginBottom: 8 });
  }
  if (option) {
    lines.push({ text: option, font: "bold 40px sans-serif", color: "#4d6358", lineHeight: 52, marginTop: 8, marginBottom: 12 });
  }
  if (memo) {
    lines.push({ text: memo, font: "bold 32px sans-serif", color: "#8a5a44", lineHeight: 42, marginTop: 8, marginBottom: 12 });
  }
  // 수량은 항상 "발주수량 N개" 형태로 표시 — 카테고리·옵션 유무와 무관하게 상단 핵심 정보로
  // 가장 크게 그린다(2026-08-20 배포 전 마지막 실기기 확인 4번). 값이 비어 있어도 NaN개/undefined개가
  // 나오지 않도록 안전하게 숫자로 변환한다. 직전 줄이 없으면(카테고리·옵션 모두 없음) baseline
  // 간격을 첫 줄 기준으로 줄인다.
  const safeQuantity = Number.isFinite(quantity) ? quantity : 0;
  lines.push({
    text: `발주수량 ${safeQuantity}개`,
    font: "bold 48px sans-serif",
    color: "#252525",
    lineHeight: 62,
    marginTop: lines.length === 0 ? 0 : 20,
    marginBottom: 10,
  });
  return lines;
}

function loadImageSafe(url: string, skuId: string): Promise<HTMLImageElement | null> {
  return new Promise(resolve => {
    if (!url) {
      resolve(null);
      return;
    }
    const proxiedUrl = `/api/wms/image-proxy?url=${encodeURIComponent(url)}`;
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => {
      console.warn(`[vendor-order-image] SKU ${skuId} 이미지 로드 실패: ${url}`);
      resolve(null);
    };
    img.src = proxiedUrl;
    setTimeout(() => resolve(null), 10000);
  });
}

/** 한글은 공백 없이 길게 이어지는 경우가 많아 단어 단위 대신 글자 단위로 줄바꿈한다. */
function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  if (!text) return [];
  const lines: string[] = [];
  let current = "";
  for (const ch of text) {
    const test = current + ch;
    if (current && ctx.measureText(test).width > maxWidth) {
      lines.push(current);
      current = ch;
    } else {
      current = test;
    }
  }
  if (current) lines.push(current);
  return lines;
}

/** 바코드 그래픽 + 번호를 지정된 폭 안에 맞춰 그린다 — 번호 앞자리 0을 그대로 보존한다. */
function drawBarcode(ctx: CanvasRenderingContext2D, barcodeValue: string, x: number, y: number, width: number, barHeight: number) {
  if (!barcodeValue) {
    ctx.textAlign = "center";
    ctx.font = "bold 22px sans-serif";
    ctx.fillStyle = "#a6614e";
    ctx.fillText("쿠팡 바코드 미등록", x + width / 2, y + barHeight / 2 + 5);
    ctx.textAlign = "left";
    return;
  }
  try {
    const widths = encodeCode128B(barcodeValue);
    const totalModules = widths.reduce((sum, w) => sum + w, 0);
    const moduleWidth = Math.min(4.2, width / totalModules);
    const barcodeWidth = totalModules * moduleWidth;
    let bx = x + (width - barcodeWidth) / 2;
    widths.forEach((w, index) => {
      const barWidth = w * moduleWidth;
      if (index % 2 === 0) {
        ctx.fillStyle = "#000000";
        ctx.fillRect(bx, y, barWidth, barHeight);
      }
      bx += barWidth;
    });
    ctx.textAlign = "center";
    ctx.font = "bold 28px monospace";
    ctx.fillStyle = "#252525";
    ctx.fillText(barcodeValue, x + width / 2, y + barHeight + 36);
    ctx.textAlign = "left";
  } catch {
    ctx.textAlign = "center";
    ctx.font = "bold 28px monospace";
    ctx.fillStyle = "#252525";
    ctx.fillText(barcodeValue, x + width / 2, y + barHeight / 2 + 5);
    ctx.textAlign = "left";
  }
}

/** SKU 번호가 컬럼 폭보다 넓으면 잘리지 않도록 폭에 맞을 때까지 폰트 크기를 줄인다
 *  (2026-08-20 배포 전 마지막 실기기 확인 5번 — SKU 번호 확대에 따른 안전장치). */
function fitSkuFontSize(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, startPx: number, minPx: number): number {
  let size = startPx;
  while (size > minPx) {
    ctx.font = `bold ${size}px sans-serif`;
    if (ctx.measureText(text).width <= maxWidth) break;
    size -= 1;
  }
  return size;
}

export async function renderVendorOrderImage(
  vendorName: string,
  lines: VendorOrderDraftLine[],
  _waveId: string
): Promise<Blob | null> {
  const images = await Promise.all(lines.map(line => loadImageSafe(line.imageUrl, line.skuId)));

  // 실제 캔버스를 만들기 전에, 임시 컨텍스트로 상품명 줄바꿈을 먼저 측정해 카드별 높이를 정확히 계산한다.
  const measureCanvas = document.createElement("canvas");
  const measureCtx = measureCanvas.getContext("2d")!;
  measureCtx.font = NAME_FONT;

  const cards: CardLayout[] = lines.map(line => {
    const { name, option } = resolveDisplayNameAndOption(line.productName, line.optionLabel);
    const category = (line.category || "").trim();
    const topInfoLines = buildTopInfoLines(category, option.trim(), line.shortageQuantity, line.memo.trim()).map(info => {
      measureCtx.font = info.font;
      return { ...info, wrappedLines: wrapText(measureCtx, info.text, TEXT_MAX_WIDTH) };
    });
    const topInfoHeight = topInfoLines.reduce(
      (sum, info) => sum + info.marginTop + info.wrappedLines.length * info.lineHeight + info.marginBottom,
      0
    );
    measureCtx.font = NAME_FONT;
    const nameLines = wrapText(measureCtx, name, TEXT_MAX_WIDTH);
    const cardHeight =
      TOP_INFO_GAP_TOP + topInfoHeight +
      GAP_INFO_TO_IMAGE + IMAGE_SIZE +
      GAP_IMAGE_TO_NAME + nameLines.length * NAME_LINE_HEIGHT +
      GAP_NAME_TO_SKUROW + SKU_BARCODE_ROW_HEIGHT +
      CARD_BOTTOM_PAD;
    return { line, displayName: name, topInfoLines, topInfoHeight, nameLines, cardHeight };
  });

  const deliveryAddress = "강원도 원주시 전망길 22-3 1층";
  measureCtx.font = "bold 28px sans-serif";
  const deliveryAddressLines = wrapText(measureCtx, `주소: ${deliveryAddress}`, TEXT_MAX_WIDTH - 56);
  const summaryHeight = 108;
  const deliveryHeight = 56 + 44 + 22 + 42 * (2 + deliveryAddressLines.length) + 34;
  const totalCardsHeight = cards.reduce((sum, card) => sum + card.cardHeight, 0);
  const height = HEADER_HEIGHT + totalCardsHeight + summaryHeight + deliveryHeight + 54;
  const canvas = document.createElement("canvas");
  canvas.width = WIDTH;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, WIDTH, height);

  // 웨이브 ID는 내부 데이터와 파일명에 유지하되 거래처 공유 이미지에는 표시하지 않는다.
  ctx.fillStyle = "#252525";
  ctx.font = "bold 48px sans-serif";
  ctx.fillText("노이드비 발주서", CARD_PAD_X, 66);

  ctx.font = "bold 28px sans-serif";
  ctx.fillStyle = "#77716a";
  ctx.fillText(`거래처: ${vendorName}`, CARD_PAD_X, 116);
  ctx.fillText(`발주일: ${new Date().toLocaleDateString("ko-KR")}`, CARD_PAD_X, 158);

  ctx.strokeStyle = "#e5dace";
  ctx.beginPath();
  ctx.moveTo(0, HEADER_HEIGHT);
  ctx.lineTo(WIDTH, HEADER_HEIGHT);
  ctx.stroke();

  const imgX = CARD_PAD_X;
  let cursorY = HEADER_HEIGHT;

  cards.forEach((card, index) => {
    const rowTop = cursorY;
    ctx.fillStyle = index % 2 === 0 ? "#faf8f4" : "#ffffff";
    ctx.fillRect(0, rowTop, WIDTH, card.cardHeight);

    // 1순위: 카테고리 / 옵션 / 수량 — 값이 있는 항목만, 최상단에 크게(2026-08-20, 미분류/옵션
    // 없음 폴백 문구 출력 금지 — 값이 없는 줄은 배열 자체에 없으므로 공백도 남지 않는다)
    let textY = rowTop + TOP_INFO_GAP_TOP;
    ctx.textAlign = "center";
    for (const infoLine of card.topInfoLines) {
      textY += infoLine.marginTop;
      ctx.font = infoLine.font;
      ctx.fillStyle = infoLine.color;
      for (const wrappedLine of infoLine.wrappedLines) {
        ctx.fillText(wrappedLine, WIDTH / 2, textY + infoLine.lineHeight * 0.8);
        textY += infoLine.lineHeight;
      }
      textY += infoLine.marginBottom;
    }
    ctx.textAlign = "left";

    // 2순위: 상품 이미지 — 카드 가로폭 최대, 좌우 여백 최소(2026-08-20)
    const imgY = rowTop + TOP_INFO_GAP_TOP + card.topInfoHeight + GAP_INFO_TO_IMAGE;
    const img = images[index];
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(imgX, imgY, IMAGE_SIZE, IMAGE_SIZE);
    if (img) {
      // contain: 잘림 없이 비율 유지, 남는 영역은 흰 배경
      const scale = Math.min(IMAGE_SIZE / img.width, IMAGE_SIZE / img.height);
      const drawW = img.width * scale;
      const drawH = img.height * scale;
      ctx.drawImage(img, imgX + (IMAGE_SIZE - drawW) / 2, imgY + (IMAGE_SIZE - drawH) / 2, drawW, drawH);
    } else {
      ctx.fillStyle = "#f2dfd8";
      ctx.fillRect(imgX, imgY, IMAGE_SIZE, IMAGE_SIZE);
      ctx.fillStyle = "#a6614e";
      ctx.font = "bold 32px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("이미지 미등록", WIDTH / 2, imgY + IMAGE_SIZE / 2 + 8);
      ctx.textAlign = "left";
    }

    // 3순위: 이미지 아래 상품명(전체 표시, 브랜드명 제거는 resolveDisplayNameAndOption에서 처리됨)
    let nameY = imgY + IMAGE_SIZE + GAP_IMAGE_TO_NAME + 38;
    ctx.textAlign = "center";
    ctx.fillStyle = "#252525";
    ctx.font = NAME_FONT;
    for (const nameLine of card.nameLines) {
      ctx.fillText(nameLine, WIDTH / 2, nameY);
      nameY += NAME_LINE_HEIGHT;
    }
    ctx.textAlign = "left";

    // 4순위: SKU(왼쪽, 큰 글자) · 바코드(오른쪽, 그래픽+번호) 가로 2열 — SKU:바코드 = 0.8:1.2
    // 비율(바코드가 더 넓게), 컬럼 간격을 좁히고 바코드 오른쪽에는 SKU 왼쪽 여백과 비슷한 실제
    // 여백이 남도록 그리기 폭을 컬럼폭보다 조금 좁혀 확보한다(2026-08-20 실기기 추가 확인 7번).
    // SKU 왼쪽 외부 여백(leftX=CARD_PAD_X)은 그대로 유지하고, 바코드 오른쪽 여백을 16→40px로
    // 넓혀 행 전체의 시각적 무게를 왼쪽으로 옮긴다(2026-08-20 배포 전 마지막 실기기 확인 6번,
    // justify-content:space-between 방식 대신 명시적 좌표 계산 사용).
    const rowY = imgY + IMAGE_SIZE + GAP_IMAGE_TO_NAME + card.nameLines.length * NAME_LINE_HEIGHT + GAP_NAME_TO_SKUROW;
    const colGap = 14;
    const available = WIDTH - CARD_PAD_X * 2 - colGap;
    const skuColWidth = available * 0.4;
    const barcodeColWidth = available * 0.6;
    const leftX = CARD_PAD_X;
    const rightX = CARD_PAD_X + skuColWidth + colGap;
    const barcodeRightMargin = 40;

    ctx.textAlign = "center";
    ctx.font = "26px sans-serif";
    ctx.fillStyle = "#77716a";
    ctx.fillText("SKU", leftX + skuColWidth / 2, rowY + 34);
    const skuFontSize = fitSkuFontSize(ctx, card.line.skuId, skuColWidth - 12, 54, 38);
    ctx.font = `bold ${skuFontSize}px sans-serif`;
    ctx.fillStyle = "#252525";
    ctx.fillText(card.line.skuId, leftX + skuColWidth / 2, rowY + 96);
    ctx.textAlign = "left";

    drawBarcode(ctx, card.line.barcode, rightX, rowY + 8, barcodeColWidth - barcodeRightMargin, 80);

    // 실제 부족수량은 내부 확인용이다. 거래처가 발주수량과 혼동하지 않도록 카드 오른쪽 아래에
    // 발주수량보다 충분히 작게 유지하되 휴대폰에서도 내부 작업자가 읽을 수 있는 크기로 표시한다.
    const actualShortage = card.line.actualShortageQuantity ?? card.line.shortageQuantity;
    ctx.textAlign = "right";
    ctx.font = "bold 20px sans-serif";
    ctx.fillStyle = "#8f8982";
    ctx.fillText(`내부참고 부족 ${actualShortage}개`, WIDTH - CARD_PAD_X, rowTop + card.cardHeight - 10);
    ctx.textAlign = "left";

    cursorY += card.cardHeight;
  });

  const totalQuantity = lines.reduce((sum, line) => sum + line.shortageQuantity, 0);
  const footerY = cursorY + 34;
  ctx.strokeStyle = "#e5dace";
  ctx.beginPath();
  ctx.moveTo(0, footerY - 20);
  ctx.lineTo(WIDTH, footerY - 20);
  ctx.stroke();

  ctx.font = "bold 32px sans-serif";
  ctx.fillStyle = "#252525";
  ctx.fillText(`총 ${lines.length}종 · 총수량 ${totalQuantity}개`, CARD_PAD_X, footerY + 34);

  // 배송정보는 상품 목록 맨 아래에서 가장 잘 보이도록 별도 강조 박스로 그린다.
  const deliveryTop = cursorY + summaryHeight;
  ctx.fillStyle = "#eef3ef";
  ctx.strokeStyle = "#6f887c";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(CARD_PAD_X, deliveryTop, WIDTH - CARD_PAD_X * 2, deliveryHeight, 18);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#263d33";
  const deliveryX = CARD_PAD_X + 28;
  let deliveryY = deliveryTop + 52;
  ctx.font = "bold 32px sans-serif";
  ctx.fillText("배송정보", deliveryX, deliveryY);
  ctx.font = "bold 28px sans-serif";
  deliveryY += 62;
  ctx.fillText("받는 사람: 노이드비", deliveryX, deliveryY);
  deliveryY += 42;
  ctx.fillText("전화번호: 010-5769-5602", deliveryX, deliveryY);
  for (const addressLine of deliveryAddressLines) {
    deliveryY += 42;
    ctx.fillText(addressLine, deliveryX, deliveryY);
  }

  return new Promise<Blob | null>(resolve => {
    try {
      canvas.toBlob(resolve, "image/png");
    } catch {
      resolve(null);
    }
  });
}
