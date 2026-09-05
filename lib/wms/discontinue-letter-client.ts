import { PDFDocument } from "pdf-lib";

export interface DiscontinueLetterItem {
  skuId: string;
}

const PAGE_WIDTH = 719;
const PAGE_HEIGHT = 959.5;
const SCALE = 2;
const ROWS_PER_PAGE = 11;

function drawCentered(context: CanvasRenderingContext2D, text: string, y: number) {
  context.fillText(text, PAGE_WIDTH / 2, y);
}

function drawTable(context: CanvasRenderingContext2D, items: DiscontinueLetterItem[], startNumber: number) {
  const left = 80;
  const top = 380;
  const widths = [70, 175, 314];
  const rowHeight = 28;
  const totalWidth = widths.reduce((sum, width) => sum + width, 0);
  context.strokeStyle = "#222";
  context.lineWidth = 0.8;
  context.fillStyle = "#f5f5f5";
  context.fillRect(left, top, totalWidth, rowHeight);
  context.strokeRect(left, top, totalWidth, rowHeight * (items.length + 1));
  let x = left;
  for (const width of widths.slice(0, -1)) {
    x += width;
    context.beginPath(); context.moveTo(x, top); context.lineTo(x, top + rowHeight * (items.length + 1)); context.stroke();
  }
  for (let row = 1; row <= items.length; row += 1) {
    const y = top + rowHeight * row;
    context.beginPath(); context.moveTo(left, y); context.lineTo(left + totalWidth, y); context.stroke();
  }
  context.fillStyle = "#111";
  context.font = "700 12px 'Malgun Gothic','Noto Sans KR',sans-serif";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText("Number", left + widths[0] / 2, top + rowHeight / 2);
  context.fillText("SKU ID", left + widths[0] + widths[1] / 2, top + rowHeight / 2);
  context.fillText("발주 중단 사유", left + widths[0] + widths[1] + widths[2] / 2, top + rowHeight / 2);
  context.font = "11px 'Malgun Gothic','Noto Sans KR',sans-serif";
  items.forEach((item, index) => {
    const y = top + rowHeight * (index + 1.5);
    context.fillText(String(startNumber + index), left + widths[0] / 2, y);
    context.fillText(item.skuId, left + widths[0] + widths[1] / 2, y);
    context.fillText("영구적 생산 중단에 의한 발주 중단", left + widths[0] + widths[1] + widths[2] / 2, y);
  });
}

function drawStamp(context: CanvasRenderingContext2D) {
  const x = 596;
  const y = 856;
  context.save();
  context.strokeStyle = "#c84136";
  context.fillStyle = "#c84136";
  context.lineWidth = 2;
  context.beginPath(); context.arc(x, y, 29, 0, Math.PI * 2); context.stroke();
  context.font = "700 10px 'Malgun Gothic','Noto Sans KR',sans-serif";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText("노 이 드 비", x, y - 8);
  context.fillText("대 표 인", x, y + 8);
  context.restore();
}

function renderPage(items: DiscontinueLetterItem[], date: string, page: number, totalPages: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(PAGE_WIDTH * SCALE);
  canvas.height = Math.round(PAGE_HEIGHT * SCALE);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("PDF 문서 화면을 만들 수 없습니다.");
  context.scale(SCALE, SCALE);
  context.fillStyle = "#fff";
  context.fillRect(0, 0, PAGE_WIDTH, PAGE_HEIGHT);
  context.fillStyle = "#111";
  context.textAlign = "center";
  context.textBaseline = "alphabetic";
  context.font = "700 30px 'Malgun Gothic','Noto Sans KR',sans-serif";
  drawCentered(context, "노이드비 단종 요청서", 92);
  context.font = "11px 'Malgun Gothic','Noto Sans KR',sans-serif";
  drawCentered(context, "경기도 고양시 일산동구 성현로 411, 3층(문봉동) / 02-6349-0118", 126);
  context.strokeStyle = "#333";
  context.lineWidth = 1;
  context.beginPath(); context.moveTo(80, 142); context.lineTo(639, 142); context.stroke();

  context.textAlign = "left";
  context.font = "13px 'Malgun Gothic','Noto Sans KR',sans-serif";
  context.fillText(`문서 번호 : 제 ${date.slice(0, 4)} – 1 호`, 88, 188);
  context.fillText("수 신 : 쿠 팡", 88, 220);
  context.fillText("발 신 : 노이드비 정혜원 / 010-5769-5602", 88, 252);
  context.fillText("제 목 : 로켓배송 제품 발주 중단 요청", 88, 284);
  context.font = "12px 'Malgun Gothic','Noto Sans KR',sans-serif";
  context.fillText("1. 귀사의 무궁한 발전을 기원합니다.", 88, 326);
  context.fillText("2. 아래 상품은 영구적 생산 중단으로 발주 중단을 요청드립니다.", 88, 352);
  drawTable(context, items, page * ROWS_PER_PAGE + 1);

  const tableBottom = 380 + 28 * (items.length + 1);
  context.textAlign = "center";
  context.font = "12px 'Malgun Gothic','Noto Sans KR',sans-serif";
  if (page === totalPages - 1) {
    context.fillText("- 끝 -", PAGE_WIDTH / 2, tableBottom + 45);
    context.textAlign = "right";
    context.font = "700 15px 'Malgun Gothic','Noto Sans KR',sans-serif";
    context.fillText("노이드비 대표이사 정혜원", 620, 860);
    drawStamp(context);
  }
  if (totalPages > 1) {
    context.textAlign = "center";
    context.font = "10px sans-serif";
    context.fillStyle = "#666";
    context.fillText(`${page + 1} / ${totalPages}`, PAGE_WIDTH / 2, 925);
  }
  return canvas;
}

export async function buildDiscontinueLetterPdf(itemsInput: DiscontinueLetterItem[], date: string): Promise<Uint8Array> {
  const items = Array.from(new Map(itemsInput.map(item => [String(item.skuId || "").trim(), { skuId: String(item.skuId || "").trim() }])).values())
    .filter(item => item.skuId);
  if (!items.length) throw new Error("단종 공문에 넣을 SKU가 없습니다.");
  const pages = Array.from({ length: Math.ceil(items.length / ROWS_PER_PAGE) }, (_, index) => items.slice(index * ROWS_PER_PAGE, (index + 1) * ROWS_PER_PAGE));
  const output = await PDFDocument.create();
  for (let index = 0; index < pages.length; index += 1) {
    const canvas = renderPage(pages[index], date, index, pages.length);
    const png = await output.embedPng(canvas.toDataURL("image/png"));
    const page = output.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    page.drawImage(png, { x: 0, y: 0, width: PAGE_WIDTH, height: PAGE_HEIGHT });
  }
  return output.save();
}
