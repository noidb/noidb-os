import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";
import { SaxesParser, type SaxesTagPlain } from "saxes";

/**
 * 한진택배 "쿠팡(고정형)" 업로드 서식 파일을 읽고, 새 출고 행을 추가한 사본을 만든다.
 *
 * 이 파일은 표준 OOXML이지만 모든 태그에 `x:` 네임스페이스 접두어가 붙어있어(예: <x:worksheet>,
 * <x:row>) ExcelJS가 파싱하지 못한다 (2026-08-19 확인 — model.sheets가 undefined가 되는 에러).
 * 그래서 이 파일만 별도로 jszip + saxes(exceljs가 이미 의존하는 SAX 파서, 새 패키지 설치 없음)로
 * 직접 XML을 읽고 필요한 행만 문자열로 추가한다. 스타일(styles.xml)·다른 시트는 절대 건드리지 않는다.
 *
 * 실제 샘플(한진택배 서식_쿠팡(고정형)_20260814.xlsx, 재출력_세부내역과 대조해 확인, 2026-08-19)
 * 기준 데이터 행 구조:
 *   K열(내품명1)  = "로켓입고*{발주번호}"
 *   AB열(받으시는 분) = "로켓배송*{물류센터}"
 *   AC/AD/AE/AF = 전화/우편번호/주소/특기사항("던지지마세요") — 물류센터별로 고정
 *   그 외 열은 전부 비어있다(값을 넣지 않는다 — 실제 사용 패턴 그대로 따름, 임의로 채우지 않음).
 */

const HANJIN_TEMPLATE_DIR = path.join(process.cwd(), "lib", "wms", "data", "hanjin-template");
const SHEET_PATH = "xl/worksheets/sheet1.xml";

// 실제 서식 파일의 컬럼 순서 그대로 (A~AF, 32개 — 2026-08-19 원본 확인)
const ALL_COLUMNS = [
  "A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M", "N", "O", "P",
  "Q", "R", "S", "T", "U", "V", "W", "X", "Y", "Z", "AA", "AB", "AC", "AD", "AE", "AF",
];
const COL_K = "K";
const COL_AB = "AB";
const COL_AC = "AC";
const COL_AD = "AD";
const COL_AE = "AE";
const COL_AF = "AF";

export class HanjinTemplateNotFoundError extends Error {
  constructor() {
    super(
      "한진택배 업로드 서식 원본을 찾지 못했습니다. lib/wms/data/hanjin-template 폴더에 " +
        "\"한진택배 서식_쿠팡(고정형)_...xlsx\" 파일을 넣어주세요."
    );
    this.name = "HanjinTemplateNotFoundError";
  }
}

interface HanjinDestination {
  phone: string;
  zip: string;
  address: string;
  note: string;
}

interface ParsedTemplate {
  zip: JSZip;
  sheetXml: string;
  destinationsByCenter: Map<string, HanjinDestination>;
  existingPoNumbers: Set<string>;
  maxRowIndex: number;
  filePath: string;
}

async function findLatestTemplateFile(): Promise<string> {
  let fileNames: string[];
  try {
    fileNames = (await readdir(HANJIN_TEMPLATE_DIR)).filter(name => name.startsWith("한진택배") && name.toLowerCase().endsWith(".xlsx"));
  } catch {
    fileNames = [];
  }
  if (fileNames.length === 0) throw new HanjinTemplateNotFoundError();

  let latest: { name: string; mtimeMs: number } | null = null;
  for (const name of fileNames) {
    const filePath = path.join(HANJIN_TEMPLATE_DIR, name);
    const fileStat = await stat(filePath);
    if (!latest || fileStat.mtimeMs > latest.mtimeMs) latest = { name, mtimeMs: fileStat.mtimeMs };
  }
  return path.join(HANJIN_TEMPLATE_DIR, latest!.name);
}

function splitCellRef(ref: string): { col: string; row: number } | null {
  const match = ref.match(/^([A-Z]+)(\d+)$/);
  if (!match) return null;
  return { col: match[1], row: Number(match[2]) };
}

/** sheet1.xml 원문을 SAX로 훑어서 기존 데이터(물류센터별 수취인 정보, 이미 있는 발주번호, 마지막 행 번호)를 뽑아낸다. */
function parseSheetXml(sheetXml: string): { destinationsByCenter: Map<string, HanjinDestination>; existingPoNumbers: Set<string>; maxRowIndex: number } {
  const destinationsByCenter = new Map<string, HanjinDestination>();
  const existingPoNumbers = new Set<string>();
  let maxRowIndex = 0;

  const parser = new SaxesParser();
  let currentRowCells: Record<string, string> = {};
  let currentCellRef: string | null = null;
  let currentCellText = "";
  let insideValueTag = false;

  parser.on("opentag", (node: SaxesTagPlain) => {
    if (node.name === "x:row") {
      currentRowCells = {};
      const r = Number(node.attributes.r as string);
      if (Number.isFinite(r) && r > maxRowIndex) maxRowIndex = r;
    } else if (node.name === "x:c") {
      currentCellRef = (node.attributes.r as string) || null;
      currentCellText = "";
    } else if (node.name === "x:v") {
      insideValueTag = true;
      currentCellText = "";
    }
  });

  parser.on("text", (text: string) => {
    if (insideValueTag) currentCellText += text;
  });

  parser.on("closetag", (node: SaxesTagPlain) => {
    if (node.name === "x:v") {
      insideValueTag = false;
      if (currentCellRef) currentRowCells[currentCellRef] = currentCellText;
    } else if (node.name === "x:row") {
      let kValue = "";
      let abValue = "";
      let acValue = "";
      let adValue = "";
      let aeValue = "";
      let afValue = "";
      for (const [ref, value] of Object.entries(currentRowCells)) {
        const parsed = splitCellRef(ref);
        if (!parsed) continue;
        if (parsed.col === COL_K) kValue = value;
        else if (parsed.col === COL_AB) abValue = value;
        else if (parsed.col === COL_AC) acValue = value;
        else if (parsed.col === COL_AD) adValue = value;
        else if (parsed.col === COL_AE) aeValue = value;
        else if (parsed.col === COL_AF) afValue = value;
      }

      const poMatch = kValue.match(/^로켓입고\*(\d+)/);
      if (poMatch) existingPoNumbers.add(poMatch[1]);

      const centerMatch = abValue.match(/^로켓배송\*(.+)$/);
      if (centerMatch) {
        destinationsByCenter.set(centerMatch[1], { phone: acValue, zip: adValue, address: aeValue, note: afValue });
      }
    }
  });

  parser.write(sheetXml).close();
  return { destinationsByCenter, existingPoNumbers, maxRowIndex };
}

async function loadTemplate(): Promise<ParsedTemplate> {
  const filePath = await findLatestTemplateFile();
  const raw = await readFile(filePath);
  const zip = await JSZip.loadAsync(raw);
  const sheetEntry = zip.file(SHEET_PATH);
  if (!sheetEntry) throw new Error(`원본 파일에서 ${SHEET_PATH}를 찾을 수 없습니다. 파일 구조를 확인해주세요.`);
  const sheetXml = await sheetEntry.async("string");
  const { destinationsByCenter, existingPoNumbers, maxRowIndex } = parseSheetXml(sheetXml);
  return { zip, sheetXml, destinationsByCenter, existingPoNumbers, maxRowIndex, filePath };
}

function escapeXml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function buildRowXml(rowIndex: number, filledColumns: Record<string, string>): string {
  const cells = ALL_COLUMNS.map(col => {
    const ref = `${col}${rowIndex}`;
    const value = filledColumns[col];
    if (value !== undefined) {
      return `<x:c r="${ref}" s="13" t="str"><x:v>${escapeXml(value)}</x:v></x:c>`;
    }
    return `<x:c r="${ref}" s="12" />`;
  });
  return `<x:row r="${rowIndex}">${cells.join("")}</x:row>`;
}

export interface HanjinShipmentRequest {
  purchaseOrderNumber: string;
  fulfillmentCenter: string;
}

export interface BuildHanjinUploadResult {
  buffer: Buffer;
  addedPurchaseOrderNumbers: string[];
  skippedAlreadyPresent: string[];
  skippedMissingDestination: { purchaseOrderNumber: string; fulfillmentCenter: string }[];
  sourceFileName: string;
}

/**
 * 요청받은 (발주번호, 물류센터) 목록 중, 아직 서식에 없는 것만 새 행으로 추가한 업로드파일을 만든다.
 * 목적지(전화/우편번호/주소) 정보가 원본에 없는 물류센터는 임의로 채우지 않고 건너뛴 뒤 알려준다.
 */
export async function buildHanjinUploadFile(requests: HanjinShipmentRequest[]): Promise<BuildHanjinUploadResult> {
  const template = await loadTemplate();

  const addedPurchaseOrderNumbers: string[] = [];
  const skippedAlreadyPresent: string[] = [];
  const skippedMissingDestination: { purchaseOrderNumber: string; fulfillmentCenter: string }[] = [];
  const newRowsXml: string[] = [];
  let nextRow = template.maxRowIndex + 1;

  for (const request of requests) {
    if (template.existingPoNumbers.has(request.purchaseOrderNumber)) {
      skippedAlreadyPresent.push(request.purchaseOrderNumber);
      continue;
    }
    const destination = template.destinationsByCenter.get(request.fulfillmentCenter);
    if (!destination) {
      skippedMissingDestination.push({ purchaseOrderNumber: request.purchaseOrderNumber, fulfillmentCenter: request.fulfillmentCenter });
      continue;
    }

    newRowsXml.push(
      buildRowXml(nextRow, {
        [COL_K]: `로켓입고*${request.purchaseOrderNumber}`,
        [COL_AB]: `로켓배송*${request.fulfillmentCenter}`,
        [COL_AC]: destination.phone,
        [COL_AD]: destination.zip,
        [COL_AE]: destination.address,
        [COL_AF]: destination.note || "던지지마세요",
      })
    );
    addedPurchaseOrderNumbers.push(request.purchaseOrderNumber);
    nextRow += 1;
  }

  const updatedSheetXml = template.sheetXml.replace("</x:sheetData>", `${newRowsXml.join("")}</x:sheetData>`);
  template.zip.file(SHEET_PATH, updatedSheetXml);
  const buffer = await template.zip.generateAsync({ type: "nodebuffer" });

  return {
    buffer,
    addedPurchaseOrderNumbers,
    skippedAlreadyPresent,
    skippedMissingDestination,
    sourceFileName: path.basename(template.filePath),
  };
}
