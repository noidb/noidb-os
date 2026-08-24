import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";
import ExcelJS from "exceljs";
import { SaxesParser, type SaxesTagPlain } from "saxes";
import {
  downloadDriveFile,
  isDriveReaderConfigured,
  listDriveFilesFromEnv,
  shouldRequireDriveReader,
} from "./google-drive-reader";

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
  sourceFileName: string;
}

async function findLatestTemplateFile(): Promise<{ sourceFileName: string; buffer: Buffer }> {
  if (isDriveReaderConfigured() || shouldRequireDriveReader()) {
    const files = await listDriveFilesFromEnv("GOOGLE_DRIVE_HANJIN_SHIPMENT_FOLDER_ID");
    const latest = files.find(file => file.name.startsWith("한진택배") && file.name.toLowerCase().endsWith(".xlsx"));
    if (!latest) throw new HanjinTemplateNotFoundError();
    return { sourceFileName: latest.name, buffer: await downloadDriveFile(latest.id) };
  }

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
  const filePath = path.join(HANJIN_TEMPLATE_DIR, latest!.name);
  return { sourceFileName: latest!.name, buffer: await readFile(filePath) };
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
  const source = await findLatestTemplateFile();
  const zip = await JSZip.loadAsync(source.buffer);
  const sheetEntry = zip.file(SHEET_PATH);
  if (!sheetEntry) throw new Error(`원본 파일에서 ${SHEET_PATH}를 찾을 수 없습니다. 파일 구조를 확인해주세요.`);
  const sheetXml = await sheetEntry.async("string");
  const { destinationsByCenter, existingPoNumbers, maxRowIndex } = parseSheetXml(sheetXml);
  return { zip, sheetXml, destinationsByCenter, existingPoNumbers, maxRowIndex, sourceFileName: source.sourceFileName };
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
    sourceFileName: template.sourceFileName,
  };
}

/**
 * 한진택배가 송장번호를 채워 돌려준 "송장입력된 쉽먼트" 파일을 읽는다 (2026-08-19 5차 실사용
 * 테스트 신규 — 발주확정 다음 단계 흐름의 2단계, 6차 실사용 테스트에서 3단계와 완전히 분리).
 * 실제 샘플 구조 기준: 시트 "상품목록", A=발주번호(PO ID) B=물류센터(FC) C=입고유형(Transport
 * Type) D=입고예정일(EDD) E=상품번호(SKU ID) F=상품바코드(SKU Barcode) G=상품이름(SKU Name)
 * H=확정수량(Confirmed Qty) I=송장번호(Invoice Number) J=납품수량(Shipped Qty). SKU별로 행이
 * 반복된다.
 *
 * 6차 실사용 테스트 반영 — 근본 원인 수정: 이전에는 1단계(한진택배 송장출력용 업로드파일 생성)와
 * 3단계(Supplier Hub 쉽먼트 생성 업로드파일 생성)가 둘 다 같은 HanjinUploadSection/
 * buildHanjinUploadFile을 그대로 재사용해서, 실제로는 똑같은 "한진택배 서식_쿠팡(고정형)" 파일
 * (로켓입고*발주번호 행만 있고 송장번호는 아예 없음)을 두 번 만드는 구조였다 — 목적과 템플릿이
 * 전혀 다른데도 같은 결과물이 나왔다. 이제 3단계는 이 파일(2단계에서 업로드한 실제 원본)의
 * 실제 행 데이터를 그대로 읽어, 현재 웨이브의 (발주번호,물류센터)와 일치하면서 송장번호가 실제로
 * 채워진 행만 새 "상품목록" 시트로 다시 만든다 — 1단계 파일과는 템플릿·컬럼·용도가 완전히
 * 다르고, 매칭 실패(송장번호 없음) 행은 절대 포함하지 않는다.
 */
const TRACKING_SHEET_NAME = "상품목록";
const TRACKING_HEADERS = [
  "발주번호(PO ID)",
  "물류센터(FC)",
  "입고유형(Transport Type)",
  "입고예정일(EDD)",
  "상품번호(SKU ID)",
  "상품바코드(SKU Barcode)",
  "상품이름(SKU Name)",
  "확정수량(Confirmed Qty)",
  "송장번호(Invoice Number)",
  "납품수량(Shipped Qty)",
];

export interface ParsedTrackingRow {
  purchaseOrderNumber: string;
  fulfillmentCenter: string;
  transportType: string;
  expectedDate: string;
  skuId: string;
  barcode: string;
  productName: string;
  confirmedQuantity: string;
  trackingNumber: string;
  shippedQuantity: string;
}

export function trackingKey(purchaseOrderNumber: string, fulfillmentCenter: string): string {
  return `${purchaseOrderNumber}::${fulfillmentCenter}`;
}

/** SKU별 행 전체를 그대로 읽는다 — 3단계 재생성(전체 컬럼 필요)과 2단계 매칭 미리보기(요약)가
 *  같은 파싱 결과를 공유한다(중복 파싱 로직 제거). */
export async function parseTrackingRowsFromBuffer(buffer: Buffer): Promise<ParsedTrackingRow[]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
  const sheet = workbook.getWorksheet(TRACKING_SHEET_NAME);
  const rows: ParsedTrackingRow[] = [];
  if (!sheet) {
    if (!workbook.getWorksheet("상세내역")) return rows;
    return (await parseHanjinReprintAssignmentsFromBuffer(buffer)).map(assignment => ({
      purchaseOrderNumber: assignment.purchaseOrderNumber,
      fulfillmentCenter: assignment.fulfillmentCenter,
      transportType: "",
      expectedDate: "",
      skuId: "",
      barcode: "",
      productName: "",
      confirmedQuantity: "",
      trackingNumber: assignment.trackingNumber,
      shippedQuantity: "",
    }));
  }

  const cell = (row: number, col: number) => String(sheet.getCell(row, col).value ?? "").trim();
  for (let row = 2; row <= sheet.rowCount; row++) {
    const poNumber = cell(row, 1);
    if (!poNumber) continue;
    rows.push({
      purchaseOrderNumber: poNumber,
      fulfillmentCenter: cell(row, 2),
      transportType: cell(row, 3),
      expectedDate: cell(row, 4),
      skuId: cell(row, 5),
      barcode: cell(row, 6),
      productName: cell(row, 7),
      confirmedQuantity: cell(row, 8),
      trackingNumber: cell(row, 9),
      shippedQuantity: cell(row, 10),
    });
  }
  return rows;
}

/** (발주번호,물류센터) → 송장번호(첫 번째로 찾은 값) 요약 맵 — 2단계 매칭 미리보기 전용. */
export function buildTrackingMapFromRows(rows: ParsedTrackingRow[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const row of rows) {
    if (!row.trackingNumber) continue;
    const key = trackingKey(row.purchaseOrderNumber, row.fulfillmentCenter);
    if (!map.has(key)) map.set(key, row.trackingNumber);
  }
  return map;
}

export interface BuildShipmentUploadResult {
  buffer: Buffer;
  includedCount: number;
  excludedUnmatchedCount: number;
  excludedZeroQuantityCount: number;
}

export interface HanjinTrackingAssignment {
  purchaseOrderNumber: string;
  fulfillmentCenter: string;
  trackingNumber: string;
}

/** 한진택배 "재출력_세부내역"의 상세내역 시트에서 내품명1에 적힌 발주번호와
 * 운송장번호를 읽는다. 한 송장에 여러 발주번호가 묶인 경우에도 각 발주번호로 확장한다. */
export async function parseHanjinReprintAssignmentsFromBuffer(buffer: Buffer): Promise<HanjinTrackingAssignment[]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
  const sheet = workbook.getWorksheet("상세내역");
  if (!sheet) throw new Error("한진 재출력 파일에서 '상세내역' 시트를 찾지 못했습니다.");

  let headerRow = 0;
  let trackingCol = 0;
  let itemNameCol = 0;
  for (let row = 1; row <= Math.min(sheet.rowCount, 5); row++) {
    for (let col = 1; col <= sheet.columnCount; col++) {
      const value = String(sheet.getCell(row, col).value ?? "").trim();
      if (value === "운송장번호") trackingCol = col;
      if (value === "내품명1") itemNameCol = col;
    }
    if (trackingCol && itemNameCol) {
      headerRow = row;
      break;
    }
  }
  if (!headerRow) throw new Error("한진 재출력 파일에서 운송장번호/내품명1 열을 찾지 못했습니다.");

  const assignments: HanjinTrackingAssignment[] = [];
  const byPo = new Map<string, string>();
  for (let row = headerRow + 1; row <= sheet.rowCount; row++) {
    const trackingNumber = String(sheet.getCell(row, trackingCol).value ?? "").trim();
    const itemName = String(sheet.getCell(row, itemNameCol).value ?? "").trim();
    if (!trackingNumber || !itemName) continue;
    const marker = itemName.match(/^\s*([^/]+)\s*\/.*?발주서\s*번호\s*(.+)$/);
    if (!marker) continue;
    const fulfillmentCenter = marker[1].trim();
    const purchaseOrderNumbers = marker[2].match(/\b\d{9}\b/g) ?? [];
    for (const purchaseOrderNumber of purchaseOrderNumbers) {
      const previous = byPo.get(purchaseOrderNumber);
      if (previous && previous !== trackingNumber) {
        throw new Error(`발주서 ${purchaseOrderNumber}에 서로 다른 운송장번호가 중복되어 있습니다.`);
      }
      byPo.set(purchaseOrderNumber, trackingNumber);
      assignments.push({ purchaseOrderNumber, fulfillmentCenter, trackingNumber });
    }
  }
  if (assignments.length === 0) throw new Error("한진 재출력 파일에서 발주번호와 운송장번호를 읽지 못했습니다.");
  return assignments;
}

/** 발주확정 완료 파일의 실제 SKU 행을 읽는다. 열 위치를 고정하지 않고 헤더명으로 찾는다. */
export async function parseConfirmedOrderRowsFromBuffer(buffer: Buffer): Promise<ParsedTrackingRow[]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
  const sheet = workbook.getWorksheet("상품목록");
  if (!sheet) throw new Error("확정수량 파일에서 '상품목록' 시트를 찾지 못했습니다.");
  const headers = new Map<string, number>();
  for (let col = 1; col <= sheet.columnCount; col++) headers.set(String(sheet.getCell(1, col).value ?? "").trim(), col);
  const required = ["발주번호", "물류센터", "입고유형", "상품번호", "상품바코드", "상품이름", "확정수량", "입고예정일"];
  const missing = required.filter(header => !headers.has(header));
  if (missing.length) throw new Error(`확정수량 파일의 필수 열이 없습니다: ${missing.join(", ")}`);
  const value = (row: number, header: string) => String(sheet.getCell(row, headers.get(header)!).value ?? "").trim();
  const rows: ParsedTrackingRow[] = [];
  for (let row = 2; row <= sheet.rowCount; row++) {
    const purchaseOrderNumber = value(row, "발주번호");
    if (!purchaseOrderNumber) continue;
    rows.push({
      purchaseOrderNumber,
      fulfillmentCenter: value(row, "물류센터"),
      transportType: value(row, "입고유형"),
      expectedDate: value(row, "입고예정일").replace(/[^0-9]/g, "").slice(0, 8),
      skuId: value(row, "상품번호"),
      barcode: value(row, "상품바코드"),
      productName: value(row, "상품이름"),
      confirmedQuantity: value(row, "확정수량"),
      trackingNumber: "",
      shippedQuantity: value(row, "확정수량"),
    });
  }
  if (!rows.length) throw new Error("확정수량 파일에 발주 SKU 행이 없습니다.");
  return rows;
}

/** 완전체 확정수량 + 최신 한진 재출력 파일을 결합한다. 모든 대상 발주번호가 두 원본에
 * 존재하고 센터까지 일치해야만 결과 버퍼를 만든다. 부분 성공 파일은 만들지 않는다. */
export async function buildShipmentCreationUploadFileFromSources(
  confirmedRows: ParsedTrackingRow[],
  assignments: HanjinTrackingAssignment[],
  targets: { purchaseOrderNumber: string; fulfillmentCenter: string }[],
  templateBuffer?: Buffer
): Promise<BuildShipmentUploadResult> {
  const targetByPo = new Map(targets.map(target => [target.purchaseOrderNumber.trim(), target.fulfillmentCenter.trim()]));
  const assignmentByPo = new Map(assignments.map(item => [item.purchaseOrderNumber, item]));
  const sourceByPo = new Map<string, ParsedTrackingRow[]>();
  for (const row of confirmedRows) {
    const rows = sourceByPo.get(row.purchaseOrderNumber) ?? [];
    rows.push(row);
    sourceByPo.set(row.purchaseOrderNumber, rows);
  }
  const errors: string[] = [];
  for (const [poNumber, center] of targetByPo) {
    const sourceRows = sourceByPo.get(poNumber);
    const assignment = assignmentByPo.get(poNumber);
    if (!sourceRows?.length) errors.push(`발주서 ${poNumber}: 확정수량 파일에 없음`);
    else if (sourceRows.some(row => row.fulfillmentCenter !== center)) errors.push(`발주서 ${poNumber}: 확정수량 파일의 물류센터 불일치`);
    if (!assignment) errors.push(`발주서 ${poNumber}: 한진 재출력 파일에 운송장번호 없음`);
    else if (assignment.fulfillmentCenter !== center) errors.push(`발주서 ${poNumber}: 한진 재출력 파일의 물류센터 불일치`);
  }
  if (errors.length) throw new Error(`쉽먼트 파일 생성을 차단했습니다. ${errors.join("; ")}`);

  const included = confirmedRows
    .filter(row => targetByPo.has(row.purchaseOrderNumber))
    .map(row => ({ ...row, trackingNumber: assignmentByPo.get(row.purchaseOrderNumber)!.trackingNumber }));
  if (!included.length) throw new Error("쉽먼트 파일 생성을 차단했습니다. 대상 SKU 행이 없습니다.");
  return buildShipmentCreationUploadFile(included, targets, templateBuffer);
}

/**
 * 3단계 전용 — 2단계에서 업로드한 원본의 실제 행 데이터 중, 현재 웨이브의 (발주번호,물류센터)와
 * 일치하고 송장번호가 실제로 채워진 행만 골라 새 "상품목록" 시트(원본과 같은 실제 헤더)로
 * 만든다. 1단계 한진 업로드 서식(K/AB~AF 고정 컬럼)과는 완전히 다른 파일이다. 송장번호가 없는
 * (매칭 실패) 행은 절대 포함하지 않는다 — 임의로 채우거나 끼워 넣지 않는다.
 */
export async function buildShipmentCreationUploadFile(
  allRows: ParsedTrackingRow[],
  targets: { purchaseOrderNumber: string; fulfillmentCenter: string }[],
  templateBuffer?: Buffer
): Promise<BuildShipmentUploadResult> {
  const targetKeys = new Set(targets.map(t => trackingKey(t.purchaseOrderNumber, t.fulfillmentCenter)));
  const inTarget = allRows.filter(row => targetKeys.has(trackingKey(row.purchaseOrderNumber, row.fulfillmentCenter)));
  const tracked = inTarget.filter(row => row.trackingNumber);
  const included = tracked.filter(row => Number(row.shippedQuantity) > 0);
  const excludedUnmatchedCount = inTarget.length - tracked.length;
  const excludedZeroQuantityCount = tracked.length - included.length;

  if (!templateBuffer) {
    throw new Error("쿠팡 쉽먼트 원본 양식이 없어 생성을 차단했습니다. ShipmentsUpload_PARCEL 템플릿 경로를 확인해주세요.");
  }
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(templateBuffer as unknown as ExcelJS.Buffer);
  const sheet = workbook.getWorksheet(TRACKING_SHEET_NAME);
  const trackingInputSheet = workbook.getWorksheet("송장번호입력");
  const instructionSheet = workbook.getWorksheet("입력방법");
  if (!sheet || !trackingInputSheet || !instructionSheet) {
    throw new Error("쿠팡 쉽먼트 원본 양식의 필수 시트(상품목록/송장번호입력/입력방법)가 없어 생성을 차단했습니다.");
  }
  const actualHeaders = TRACKING_HEADERS.map((_, index) => String(sheet.getCell(1, index + 1).value ?? "").trim());
  if (actualHeaders.some((header, index) => header !== TRACKING_HEADERS[index])) {
    throw new Error("쿠팡 쉽먼트 원본 양식의 상품목록 헤더가 예상 구조와 달라 생성을 차단했습니다.");
  }

  const rowKey = (poNumber: string, skuId: string) => `${poNumber.trim()}::${skuId.trim()}`;
  const includedByKey = new Map<string, ParsedTrackingRow>();
  for (const row of included) {
    const key = rowKey(row.purchaseOrderNumber, row.skuId);
    if (includedByKey.has(key)) throw new Error(`쿠팡 쉽먼트 데이터에 발주번호+상품번호가 중복되어 생성을 차단했습니다: ${key}`);
    includedByKey.set(key, row);
  }
  const templateRows: { excelRow: number; key: string }[] = [];
  for (let excelRow = 2; excelRow <= sheet.rowCount; excelRow++) {
    const poNumber = String(sheet.getCell(excelRow, 1).value ?? "").trim();
    const skuId = String(sheet.getCell(excelRow, 5).value ?? "").trim();
    if (poNumber || skuId) templateRows.push({ excelRow, key: rowKey(poNumber, skuId) });
  }
  const templateKeys = new Set(templateRows.map(row => row.key));
  const missingInTemplate = [...includedByKey.keys()].filter(key => !templateKeys.has(key));
  const missingInData = [...templateKeys].filter(key => !includedByKey.has(key));
  if (missingInTemplate.length === 0 && missingInData.length === 0) {
    // 현재 쿠팡 다운로드 원본과 대상 행이 같으면 A~H와 행 순서를 그대로 두고 입력 허용 열만 채운다.
    for (const templateRow of templateRows) {
      const row = includedByKey.get(templateRow.key)!;
      sheet.getCell(templateRow.excelRow, 9).value = row.trackingNumber;
      sheet.getCell(templateRow.excelRow, 10).value = row.shippedQuantity;
    }
  } else {
    // 다음 웨이브처럼 대상 행이 달라도 매번 새 양식을 받을 필요가 없도록, 검증된 쿠팡 워크북
    // 구조(3개 시트/안내 이미지/병합/열 너비)는 유지하고 상품 데이터 영역 A~J만 교체한다.
    const validationTemplate = { ...sheet.getCell(2, 9).dataValidation };
    const rowsToClear = Math.max(templateRows.length, included.length);
    for (let index = 0; index < rowsToClear; index++) {
      const excelRow = index + 2;
      for (let col = 1; col <= 10; col++) sheet.getCell(excelRow, col).value = null;
    }
    included.forEach((row, index) => {
      const excelRow = index + 2;
      const values = [row.purchaseOrderNumber, row.fulfillmentCenter, row.transportType, row.expectedDate, row.skuId, row.barcode, row.productName, row.confirmedQuantity, row.trackingNumber, row.shippedQuantity];
      values.forEach((value, col) => { sheet.getCell(excelRow, col + 1).value = value; });
      sheet.getCell(excelRow, 9).dataValidation = { ...validationTemplate };
    });
  }

  const uniqueTrackingNumbers = [...new Set(included.map(row => row.trackingNumber))];
  const trackingRowsToClear = Math.max(100, trackingInputSheet.rowCount - 1);
  for (let index = 0; index < trackingRowsToClear; index++) trackingInputSheet.getCell(index + 2, 1).value = null;
  uniqueTrackingNumbers.forEach((trackingNumber, index) => { trackingInputSheet.getCell(index + 2, 1).value = trackingNumber; });

  const buffer = (await workbook.xlsx.writeBuffer()) as unknown as Buffer;
  return { buffer, includedCount: included.length, excludedUnmatchedCount, excludedZeroQuantityCount };
}
