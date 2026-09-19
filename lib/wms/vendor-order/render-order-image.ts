import type { VendorOrderDraftLine } from "./types";
import { resolveDisplayNameAndOption } from "../display-name";

/**
 * 초안과 전송에 함께 사용하는 거래처 발주서 PNG 이미지를 그린다.
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

const HEADER_HEIGHT = 0;
/** 카카오톡/사진 앱에서 축소 표시되어도 글자가 선명하도록 최종 PNG 자체를 1080px로 만든다. */
const WIDTH = 1080;
const CARD_PAD_X = 48;
const IMAGE_SIZE = WIDTH - 96;
const TOP_INFO_GAP_TOP = 26;
const GAP_IMAGE_TO_NAME = 28;
const NAME_FONT = "bold 38px sans-serif";
const NAME_LINE_HEIGHT = 50;
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

function buildTopInfoLines(_category: string, option: string, quantity: number, memo = ""): TopInfoLine[] {
  const lines: TopInfoLine[] = [];
  if (option) {
    lines.push({ text: option, font: NAME_FONT, color: "#4d6358", lineHeight: NAME_LINE_HEIGHT, marginTop: 12, marginBottom: 8 });
  }
  // 수량은 항상 "주문수량 N개" 형태로 표시 — 카테고리·옵션 유무와 무관하게 상단 핵심 정보로
  // 가장 크게 그린다(2026-08-20 배포 전 마지막 실기기 확인 4번). 값이 비어 있어도 NaN개/undefined개가
  // 나오지 않도록 안전하게 숫자로 변환한다. 직전 줄이 없으면(카테고리·옵션 모두 없음) baseline
  // 간격을 첫 줄 기준으로 줄인다.
  const safeQuantity = Number.isFinite(quantity) ? quantity : 0;
  lines.push({
    text: `주문수량 ${safeQuantity}개`,
    font: "bold 48px sans-serif",
    color: "#252525",
    lineHeight: 62,
    marginTop: 12,
    marginBottom: 10,
  });
  if (memo) lines.push({ text: memo, font: "bold 32px sans-serif", color: "#8a5a44", lineHeight: 42, marginTop: 10, marginBottom: 12 });
  return lines;
}

const productImages = new Map<string, Promise<HTMLImageElement | null>>();

function loadImageSafe(url: string, skuId: string): Promise<HTMLImageElement | null> {
  if (!url) return Promise.resolve(null);
  const cached = productImages.get(url);
  if (cached) return cached;
  const pending = new Promise<HTMLImageElement | null>(resolve => {
    const proxiedUrl = url.startsWith("/api/wms/weekly-work/image?") || url.startsWith("/api/wms/image-proxy?")
      ? url : `/api/wms/image-proxy?url=${encodeURIComponent(url)}`;
    const img = new Image();
    img.crossOrigin = "anonymous";
    const finish = (result: HTMLImageElement | null) => { clearTimeout(timer); resolve(result); };
    const timer = setTimeout(() => finish(null), 10000);
    img.onload = () => finish(img);
    img.onerror = () => {
      console.warn(`[vendor-order-image] SKU ${skuId} 이미지 로드 실패: ${url}`);
      finish(null);
    };
    img.src = proxiedUrl;
  }).then(image => {
    if (!image) productImages.delete(url);
    return image;
  });
  productImages.set(url, pending);
  if (productImages.size > 80) productImages.delete(productImages.keys().next().value!);
  return pending;
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

export async function renderVendorOrderImage(
  vendorName: string,
  lines: VendorOrderDraftLine[],
  _waveId: string,
  options: { strictImages?: boolean; orderDate?: string } = {}
): Promise<Blob | null> {
  const images = await Promise.all(lines.map(line => loadImageSafe(line.imageUrl, line.skuId)));
  if (options.strictImages) {
    const missing = lines.filter((_, index) => !images[index]);
    if (missing.length) {
      throw Object.assign(new Error(`사진을 불러오지 못했습니다. ${vendorName} · SKU ${missing.map(line => line.skuId).join(", ")}의 사진을 다시 추가해 주세요.`), { skuIds: missing.map(line => line.skuId) });
    }
  }

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
      TOP_INFO_GAP_TOP + IMAGE_SIZE +
      GAP_IMAGE_TO_NAME + nameLines.length * NAME_LINE_HEIGHT +
      topInfoHeight +
      CARD_BOTTOM_PAD;
    return { line, displayName: name, topInfoLines, topInfoHeight, nameLines, cardHeight };
  });

  const totalCardsHeight = cards.reduce((sum, card) => sum + card.cardHeight, 0);
  const height = HEADER_HEIGHT + totalCardsHeight;
  const canvas = document.createElement("canvas");
  canvas.width = WIDTH;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, WIDTH, height);

  const imgX = (WIDTH - IMAGE_SIZE) / 2;
  let cursorY = HEADER_HEIGHT;

  cards.forEach((card, index) => {
    const rowTop = cursorY;
    ctx.fillStyle = index % 2 === 0 ? "#faf8f4" : "#ffffff";
    ctx.fillRect(0, rowTop, WIDTH, card.cardHeight);

    // 2순위: 상품 이미지 — 카드 가로폭 최대, 좌우 여백 최소(2026-08-20)
    const imgY = rowTop + TOP_INFO_GAP_TOP;
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
    let nameY = imgY + IMAGE_SIZE + GAP_IMAGE_TO_NAME;
    ctx.textAlign = "center";
    ctx.fillStyle = "#252525";
    ctx.font = NAME_FONT;
    for (const nameLine of card.nameLines) {
      ctx.fillText(nameLine, WIDTH / 2, nameY + 38);
      nameY += NAME_LINE_HEIGHT;
    }
    for (const infoLine of card.topInfoLines) {
      let textY = nameY + infoLine.marginTop;
      ctx.font = infoLine.font;
      ctx.fillStyle = infoLine.color;
      for (const wrappedLine of infoLine.wrappedLines) {
        ctx.fillText(wrappedLine, WIDTH / 2, textY + infoLine.lineHeight * 0.8);
        textY += infoLine.lineHeight;
      }
      nameY = textY + infoLine.marginBottom;
    }
    ctx.textAlign = "left";

    cursorY += card.cardHeight;
  });

  return new Promise<Blob | null>(resolve => {
    try {
      canvas.toBlob(resolve, "image/png");
    } catch {
      resolve(null);
    }
  });
}
