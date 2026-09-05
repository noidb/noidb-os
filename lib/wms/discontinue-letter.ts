import { createHash } from "node:crypto";
import { PDFArray, PDFDocument, PDFName, PDFRawStream, decodePDFRawStream } from "pdf-lib";
import { normalizedDiscontinueItems, type DiscontinueFileItem } from "./discontinue-files";

// Verified byte-for-byte against the user's original form. An unfamiliar layout
// must not be patched with these coordinates or replaced with a fabricated seal.
export const DISCONTINUE_LETTER_TEMPLATE_SHA256 = "07ea0278d5bd7a6a1f5600656cd056572a4b62b4a7bb356cdca0d44f1b140079";
export const DISCONTINUE_LETTER_ROWS_PER_PAGE = 6;
const SAMPLE_SKUS = ["39659674", "57342556", "39626071", "39626074", "39396110", "39135913"];

function replaceExactlyOnce(source: string, before: string, after: string): string {
  if (source.split(before).length !== 2) throw new Error("단종 공문 원본의 입력 위치가 변경되었습니다. 공문 양식을 확인해 주세요.");
  return source.replace(before, after);
}

function numericText(value: string, center: number, y: number): string {
  // Original embedded Noto Sans KR regular: every ASCII digit is 555/1000 em.
  const x = Number((center - value.length * 10.5 * 0.555 / 2).toFixed(5));
  return `BT 1 0 0 1 ${x} ${y} Tm /F3+0 10.5 Tf 12.6 TL (${value}) Tj T* ET`;
}

function contentForPage(original: string, items: DiscontinueFileItem[], date: string, page: number, pageCount: number): string {
  let content = original;
  for (let index = 0; index < DISCONTINUE_LETTER_ROWS_PER_PAGE; index += 1) {
    const y = 481.5 - 38 * index;
    const item = items[index];
    content = replaceExactlyOnce(content, numericText(String(index + 1), 100, y), item ? numericText(String(page * 6 + index + 1), 100, y) : "");
    content = replaceExactlyOnce(content, numericText(SAMPLE_SKUS[index], 203, y), item ? numericText(item.skuId, 203, y) : "");
    if (!item) {
      const reason = new RegExp(`BT 1 0 0 1 389 ${String(y).replace(".", "\\.")} Tm /F3\\+0 10\\.5 Tf 12\\.6 TL \\([^\\n]*\\) Tj T\\* ET`);
      const match = content.match(reason);
      if (!match) throw new Error("단종 공문 표의 입력 위치를 확인하지 못했습니다.");
      content = replaceExactlyOnce(content, match[0], "");
    }
  }
  content = replaceExactlyOnce(content, "2026 \\025 1 \\023", `${date.slice(0, 4)} \\025 1 \\023`);
  // The original has only a document-number year, no full date. Use its empty
  // right-hand date area; do not cover or duplicate an old date in the body.
  content += `\nBT 1 0 0 1 585 772.5 Tm /F3+0 10.5 Tf 12.6 TL (${date}) Tj T* ET\n`;
  if (pageCount > 1) {
    if (page < pageCount - 1) content = replaceExactlyOnce(content, "BT 1 0 0 1 348.159 234.5 Tm /F3+0 11 Tf 13.2 TL (- \\253 -) Tj T* ET", "");
    content += `BT 1 0 0 1 348 32 Tm /F3+0 10.5 Tf 12.6 TL (${page + 1} / ${pageCount}) Tj T* ET\n`;
  }
  return content;
}

export async function buildDiscontinueLetterFromTemplate(source: Buffer, itemsInput: DiscontinueFileItem[], date: string): Promise<Uint8Array> {
  const items = normalizedDiscontinueItems(itemsInput);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date) throw new Error("단종 공문 날짜가 올바르지 않습니다.");
  if (createHash("sha256").update(source).digest("hex") !== DISCONTINUE_LETTER_TEMPLATE_SHA256) throw new Error("단종 공문 샘플이 변경되었습니다. 원본 배치와 직인을 확인한 뒤 다시 연결해 주세요.");
  const template = await PDFDocument.load(source);
  const sourcePage = template.getPage(0);
  if (template.getPageCount() !== 1 || sourcePage.getWidth() !== 719 || sourcePage.getHeight() !== 959.5) throw new Error("단종 공문 원본 크기를 확인하지 못했습니다.");
  const contents = sourcePage.node.Contents();
  const streams = contents instanceof PDFArray ? contents.asArray().map(ref => template.context.lookup(ref)) : [contents];
  if (streams.some(stream => !(stream instanceof PDFRawStream))) throw new Error("단종 공문 원본의 문자 영역을 확인하지 못했습니다.");
  const original = streams.map(stream => Buffer.from(decodePDFRawStream(stream as PDFRawStream).decode()).toString("latin1")).join("\n");
  const output = await PDFDocument.create();
  const pageCount = Math.ceil(items.length / DISCONTINUE_LETTER_ROWS_PER_PAGE);
  for (let page = 0; page < pageCount; page += 1) {
    const content = contentForPage(original, items.slice(page * 6, (page + 1) * 6), date, page, pageCount);
    // Copy the already-patched original page, including its original embedded
    // fonts and actual stamp image. No old sample-SKU stream enters the output.
    sourcePage.node.set(PDFName.of("Contents"), template.context.register(template.context.flateStream(Buffer.from(content, "latin1"))));
    const [copy] = await output.copyPages(template, [0]);
    output.addPage(copy);
  }
  output.setTitle("노이드비 단종 요청서");
  return output.save();
}
