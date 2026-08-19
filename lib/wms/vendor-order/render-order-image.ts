import type { VendorOrderDraftLine } from "./types";
import { encodeCode128B } from "./code128";

/**
 * 승인된 거래처별 부족분 발주서를 세로형(모바일 스크린샷/카카오톡 전송에 적합한) PNG 이미지로 그린다.
 * 브라우저 Canvas 2D API만 쓰고 외부 라이브러리는 쓰지 않는다. 클라이언트 전용 함수.
 *
 * 상품 이미지는 제품DB URL(대부분 구글드라이브)에서 불러온다 — CORS 헤더가 없는 이미지는
 * 캔버스를 오염시켜 전체 이미지 내보내기가 실패할 수 있으므로, crossOrigin="anonymous"로
 * 로드에 실패한 이미지는 건너뛰고 "이미지 미등록" 자리표시자를 대신 그린다(전체 실패 방지).
 */

const ROW_HEIGHT = 96;
const HEADER_HEIGHT = 150;
const FOOTER_HEIGHT = 70;
const WIDTH = 760;
const IMAGE_SIZE = 64;

function loadImageSafe(url: string): Promise<HTMLImageElement | null> {
  return new Promise(resolve => {
    if (!url) {
      resolve(null);
      return;
    }
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
    setTimeout(() => resolve(null), 8000);
  });
}

function drawBarcode(ctx: CanvasRenderingContext2D, barcodeValue: string, x: number, y: number, height: number, moduleWidth: number) {
  if (!barcodeValue) {
    ctx.font = "bold 13px sans-serif";
    ctx.fillStyle = "#a6614e";
    ctx.fillText("쿠팡 바코드 미등록", x, y + height / 2 + 5);
    return;
  }
  try {
    const widths = encodeCode128B(barcodeValue);
    let bx = x;
    widths.forEach((w, index) => {
      const barWidth = w * moduleWidth;
      if (index % 2 === 0) {
        ctx.fillStyle = "#000000";
        ctx.fillRect(bx, y, barWidth, height);
      }
      bx += barWidth;
    });
    ctx.font = "12px monospace";
    ctx.fillStyle = "#252525";
    ctx.fillText(barcodeValue, x, y + height + 14);
  } catch {
    ctx.font = "12px monospace";
    ctx.fillStyle = "#252525";
    ctx.fillText(barcodeValue, x, y + height / 2 + 5);
  }
}

export async function renderVendorOrderImage(
  vendorName: string,
  lines: VendorOrderDraftLine[],
  waveId: string
): Promise<Blob | null> {
  const images = await Promise.all(lines.map(line => loadImageSafe(line.imageUrl)));

  const height = HEADER_HEIGHT + lines.length * ROW_HEIGHT + FOOTER_HEIGHT + 40;
  const canvas = document.createElement("canvas");
  canvas.width = WIDTH;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, WIDTH, height);

  ctx.fillStyle = "#252525";
  ctx.font = "bold 30px sans-serif";
  ctx.fillText("노이드비 발주서", 32, 52);

  ctx.font = "16px sans-serif";
  ctx.fillStyle = "#77716a";
  ctx.fillText(`거래처: ${vendorName}`, 32, 86);
  ctx.fillText(`발주일: ${new Date().toLocaleDateString("ko-KR")}`, 32, 110);
  ctx.fillText(`참고번호: ${waveId}`, 32, 134);

  ctx.strokeStyle = "#e5dace";
  ctx.beginPath();
  ctx.moveTo(0, HEADER_HEIGHT);
  ctx.lineTo(WIDTH, HEADER_HEIGHT);
  ctx.stroke();

  lines.forEach((line, index) => {
    const rowTop = HEADER_HEIGHT + index * ROW_HEIGHT;
    ctx.fillStyle = index % 2 === 0 ? "#faf8f4" : "#ffffff";
    ctx.fillRect(0, rowTop, WIDTH, ROW_HEIGHT);

    const img = images[index];
    const imgX = 24;
    const imgY = rowTop + (ROW_HEIGHT - IMAGE_SIZE) / 2;
    if (img) {
      ctx.drawImage(img, imgX, imgY, IMAGE_SIZE, IMAGE_SIZE);
    } else {
      ctx.fillStyle = "#f2dfd8";
      ctx.fillRect(imgX, imgY, IMAGE_SIZE, IMAGE_SIZE);
      ctx.fillStyle = "#a6614e";
      ctx.font = "bold 11px sans-serif";
      ctx.fillText("이미지", imgX + 8, imgY + 28);
      ctx.fillText("미등록", imgX + 8, imgY + 44);
    }

    const textX = imgX + IMAGE_SIZE + 16;
    ctx.fillStyle = "#252525";
    ctx.font = "bold 17px sans-serif";
    const title = `${line.modelName || line.productName}${line.optionLabel ? ` (${line.optionLabel})` : ""}`;
    ctx.fillText(truncate(title, 20), textX, rowTop + 26);
    ctx.font = "12px sans-serif";
    ctx.fillStyle = "#77716a";
    ctx.fillText(`SKU ${line.skuId}`, textX, rowTop + 46);

    drawBarcode(ctx, line.barcode, textX, rowTop + 56, 26, 1.1);

    ctx.font = "bold 20px sans-serif";
    ctx.fillStyle = "#252525";
    ctx.textAlign = "right";
    ctx.fillText(`${line.shortageQuantity}개`, WIDTH - 24, rowTop + ROW_HEIGHT / 2 + 7);
    ctx.textAlign = "left";
  });

  const totalQuantity = lines.reduce((sum, line) => sum + line.shortageQuantity, 0);
  const footerY = HEADER_HEIGHT + lines.length * ROW_HEIGHT + 30;
  ctx.strokeStyle = "#e5dace";
  ctx.beginPath();
  ctx.moveTo(0, footerY - 20);
  ctx.lineTo(WIDTH, footerY - 20);
  ctx.stroke();

  ctx.font = "bold 18px sans-serif";
  ctx.fillStyle = "#252525";
  ctx.fillText(`총 ${lines.length}종 / ${totalQuantity}개`, 32, footerY + 10);

  return new Promise<Blob | null>(resolve => {
    try {
      canvas.toBlob(resolve, "image/png");
    } catch {
      resolve(null);
    }
  });
}

function truncate(text: string, maxLength: number): string {
  if (!text) return "";
  return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text;
}
