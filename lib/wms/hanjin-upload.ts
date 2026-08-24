import { readFile } from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";
import ExcelJS from "exceljs";
import { SaxesParser, type SaxesTagPlain } from "saxes";
import { loadSupplierHubPurchaseOrders, type SupplierHubPurchaseOrder } from "./supplier-hub-orders";
import { normalizeSkuId } from "./sku-normalize";
import { findVerifiedPostalCode } from "./data/verified-postal-codes";

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
 *   K열(내품명1)  = 쿠팡 물류센터용 표시 문구 (2026-08-24 형식 변경, buildShipmentLabel 참고)
 *   AB열(받으시는 분) = "로켓배송*{물류센터}"
 *   AC/AD/AE/AF = 전화/우편번호/주소/특기사항("던지지마세요") — 물류센터별로 고정
 *   그 외 열은 전부 비어있다(값을 넣지 않는다 — 실제 사용 패턴 그대로 따름, 임의로 채우지 않음).
 *
 * 2026-08-24: K열 문구를 "로켓입고*{발주번호}"에서 사람이 읽는 "{물류센터} / {M월D일} /
 * 발주서 번호 {발주번호(들)}" 형식으로 바꿨다. 같은 물류센터+같은 입고예정일로 합배송되는
 * 요청은 한 행(=한 운송장)으로 묶고 그 행의 K열에 발주번호를 전부(중복 제거) 나열한다 —
 * buildShipmentLabel/groupRequestsByCenterAndDate 참고. 이 함수는 로켓배송(물류센터향) 행만
 * 만들기 때문에 개인 고객용 운송장에는 애초에 적용되지 않는다.
 *
 * 2026-08-24(2차): 원본 서식은 레이아웃/헤더(1행)만 템플릿으로 쓰고, 원본에 들어있던 과거
 * 데이터 행(2행 이후)은 결과 파일에 전혀 포함하지 않는다 — 예전에는 과거 행을 그대로 복사해
 * 남겨두고 새 행만 append했는데, 이 때문에 과거에 구 형식("로켓입고*발주번호")으로 이미
 * 개별 행이 있던 발주번호가 이번 합배송 그룹에 섞여 있으면 그 발주번호가 "이미 있음"으로
 * 걸러지면서 같은 그룹의 나머지 발주번호만 새로 추가되어, 원래 하나로 합쳐져야 할 그룹이
 * 과거 개별 행 + 새 개별 행으로 쪼개지는 문제가 있었다(대구3/인천36 케이스로 확인). 이제는
 * 매 생성 요청마다 현재 선택된 발주서만으로 그룹을 새로 만들고, "이미 있어서 건너뜀" 판단
 * 자체를 하지 않는다(과거 행을 안 남기므로 중복될 여지가 없다) — skippedAlreadyPresent는
 * 인터페이스 호환을 위해 남겨두되 항상 빈 배열이다.
 *
 * 2026-08-24(3차): 운영(Vercel)에서 "헤더 행(1행)을 찾을 수 없습니다" 오류로 생성이 실패하는
 * 원인을 확인했다 — 이전에는 원본 서식을 (1) Google Drive의
 * GOOGLE_DRIVE_HANJIN_SHIPMENT_FOLDER_ID 폴더에서 "한진택배"로 시작하는 최초 매칭 파일을
 * 찾거나, (2) 로컬 개발 전용 gitignored 폴더(lib/wms/data/hanjin-template/)에서 찾았는데,
 * 실제 그 Drive 폴더에는 이름만 "한진택배"로 시작할 뿐 완전히 다른 서식("한진택배
 * 서식_씨엘링크_...xlsx" — 네임스페이스 없는 일반 <row> 구조, 우리가 쓰는 <x:row> 구조가
 * 아님)이 들어있었고, 실제 검증해온 "쿠팡(고정형)" 서식은 "샘플파일_한진택배..."로 시작해서
 * 애초에 이름 조건에 안 맞았다. 로컬 개발 폴더는 gitignore 대상이라 Vercel 배포 산출물에
 * 아예 포함되지도 않는다. 즉 운영에서는 (a) 엉뚱한 서식을 잘못 집어오거나 (b) 아무 파일도
 * 못 찾는 두 경우만 있었다 — G드라이브 폴더 내용이나 파일명 관례에 기대지 않고, 검증 완료된
 * "쿠팡(고정형)" 서식 원본을 lib/wms/data/hanjin-template-static/(Git에 커밋됨, gitignore
 * 아님)에 고정 자산으로 포함해 항상 그 파일만 읽도록 바꿨다 — 로컬/운영 어디서든 완전히
 * 동일한 파일을 쓴다. 이 정적 파일도 결과에는 헤더(1행)와 열 구조만 쓰이고, 안에 남아있는
 * 물류센터별 과거 행은 여전히 목적지(우편번호 등) 조회용 참고 데이터로만 쓰인다(2차 수정에서
 * 확립한 동작 그대로 — 결과 파일에는 절대 복사되지 않는다).
 */

const STATIC_TEMPLATE_PATH = path.join(
  process.cwd(),
  "lib",
  "wms",
  "data",
  "hanjin-template-static",
  "한진택배_쿠팡_고정형_기준서식.xlsx"
);
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
      "한진택배 업로드 서식 원본을 찾지 못했습니다. " +
        "lib/wms/data/hanjin-template-static/한진택배_쿠팡_고정형_기준서식.xlsx 파일이 " +
        "저장소에 있는지 확인해주세요."
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
  /** 원본 1행(헤더) 원문 그대로 — 결과 파일 재구성 시 이 값 + 새 데이터 행만 쓰고 과거 데이터
   *  행(2행 이후)은 버린다. */
  headerRowXml: string;
  destinationsByCenter: Map<string, HanjinDestination>;
  sourceFileName: string;
}

/** 검증된 "쿠팡(고정형)" 원본 서식 하나만 Git에 커밋된 고정 자산에서 읽는다 — 로컬/운영
 *  어디서든 완전히 같은 파일을 쓴다(2026-08-24 3차, 위 상단 설명 참고). */
async function findLatestTemplateFile(): Promise<{ sourceFileName: string; buffer: Buffer }> {
  let buffer: Buffer;
  try {
    buffer = await readFile(STATIC_TEMPLATE_PATH);
  } catch {
    throw new HanjinTemplateNotFoundError();
  }
  return { sourceFileName: path.basename(STATIC_TEMPLATE_PATH), buffer };
}

function splitCellRef(ref: string): { col: string; row: number } | null {
  const match = ref.match(/^([A-Z]+)(\d+)$/);
  if (!match) return null;
  return { col: match[1], row: Number(match[2]) };
}

/** 물류센터명 비교용 정규화 — 앞뒤 공백 제거 + 내부 공백 전부 제거("인천 14" == "인천14").
 *  표시용 원본 값은 절대 바꾸지 않고, Map 키/조회에만 쓴다(2026-08-24 신규 — 필수 조사 4번). */
function normalizeCenterName(value: string): string {
  return value.trim().replace(/\s+/g, "");
}

/** sheet1.xml 원문을 SAX로 훑어서 물류센터별 수취인 정보(전화/우편번호/주소/특기사항)만
 *  뽑아낸다 — 결과 파일에는 이 과거 행 자체를 복사하지 않고, 우편번호 등 발주서 원본에 없는
 *  값을 보충할 때만 조회용으로 쓴다(resolveGroupDestination 참고). */
function parseSheetXml(sheetXml: string): { destinationsByCenter: Map<string, HanjinDestination> } {
  const destinationsByCenter = new Map<string, HanjinDestination>();

  const parser = new SaxesParser();
  let currentRowCells: Record<string, string> = {};
  let currentCellRef: string | null = null;
  let currentCellText = "";
  let insideValueTag = false;

  parser.on("opentag", (node: SaxesTagPlain) => {
    if (node.name === "x:row") {
      currentRowCells = {};
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
      let abValue = "";
      let acValue = "";
      let adValue = "";
      let aeValue = "";
      let afValue = "";
      for (const [ref, value] of Object.entries(currentRowCells)) {
        const parsed = splitCellRef(ref);
        if (!parsed) continue;
        if (parsed.col === COL_AB) abValue = value;
        else if (parsed.col === COL_AC) acValue = value;
        else if (parsed.col === COL_AD) adValue = value;
        else if (parsed.col === COL_AE) aeValue = value;
        else if (parsed.col === COL_AF) afValue = value;
      }

      const centerMatch = abValue.match(/^로켓배송\*(.+)$/);
      if (centerMatch) {
        destinationsByCenter.set(normalizeCenterName(centerMatch[1]), { phone: acValue, zip: adValue, address: aeValue, note: afValue });
      }
    }
  });

  parser.write(sheetXml).close();
  return { destinationsByCenter };
}

/** 원본 sheet1.xml에서 1행(헤더) 원문을 그대로 뽑아낸다 — 결과 파일은 이 헤더 뒤에 새 데이터
 *  행만 붙이고, 원본의 다른 데이터 행은 전혀 가져오지 않는다. */
function extractHeaderRowXml(sheetXml: string): string {
  const match = sheetXml.match(/<x:row r="1"[^>]*>[\s\S]*?<\/x:row>/);
  if (!match) throw new Error("원본 파일에서 헤더 행(1행)을 찾을 수 없습니다. 파일 구조를 확인해주세요.");
  return match[0];
}

async function loadTemplate(): Promise<ParsedTemplate> {
  const source = await findLatestTemplateFile();
  const zip = await JSZip.loadAsync(source.buffer);
  const sheetEntry = zip.file(SHEET_PATH);
  if (!sheetEntry) throw new Error(`원본 파일에서 ${SHEET_PATH}를 찾을 수 없습니다. 파일 구조를 확인해주세요.`);
  const sheetXml = await sheetEntry.async("string");
  const { destinationsByCenter } = parseSheetXml(sheetXml);
  const headerRowXml = extractHeaderRowXml(sheetXml);
  return { zip, sheetXml, headerRowXml, destinationsByCenter, sourceFileName: source.sourceFileName };
}

function escapeXml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** "YYYY-MM-DD"(또는 "YYYY/MM/DD", "YYYYMMDD") 입고예정일을 "M월D일"로 바꾼다 — 형식을
 *  못 알아보면 임의로 바꾸지 않고 원본 문자열을 그대로 돌려준다. */
function formatMonthDay(expectedDate: string): string {
  const match =
    expectedDate.match(/^(\d{4})-(\d{2})-(\d{2})/) ||
    expectedDate.match(/^(\d{4})\/(\d{2})\/(\d{2})/) ||
    expectedDate.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (!match) return expectedDate;
  const [, , month, day] = match;
  return `${Number(month)}월${Number(day)}일`;
}

/** 한 줄 문구("발주서 번호"를 쉼표로 구분)가 이 길이를 넘으면 두 줄(슬래시 구분)로 바꾼다.
 *  발주번호 2개(9자리 기준)는 한 줄에 들어가고 3개부터 넘어가도록 실측해 정한 값이다. */
const SINGLE_LINE_MAX_LENGTH = 45;

/**
 * 쿠팡 물류센터용 표시 문구를 만든다: "{물류센터} / {M월D일} / 발주서 번호 {발주번호(들)}".
 * 합배송(같은 물류센터+같은 입고예정일)으로 발주번호가 여러 개면 쉼표로 이어붙이고, 문구가
 * 너무 길어지면 "{물류센터} / {M월D일}" + 줄바꿈 + "발주서 번호 {po1} / {po2} / {po3}"로 바꾼다.
 */
function buildShipmentLabel(fulfillmentCenter: string, expectedDate: string, purchaseOrderNumbers: string[]): string {
  const monthDay = formatMonthDay(expectedDate);
  const prefix = `${fulfillmentCenter} / ${monthDay}`;
  const singleLine = `${prefix} / 발주서 번호 ${purchaseOrderNumbers.join(", ")}`;
  if (singleLine.length <= SINGLE_LINE_MAX_LENGTH) return singleLine;
  return `${prefix}\n발주서 번호 ${purchaseOrderNumbers.join(" / ")}`;
}

interface ShipmentRequestGroup {
  fulfillmentCenter: string;
  expectedDate: string;
  purchaseOrderNumbers: string[];
}

/** 같은 물류센터+같은 입고예정일 요청을 한 그룹(=한 운송장 행)으로 묶는다. 발주번호 중복은
 *  제거하되, 서로 다른 물류센터나 입고예정일은 절대 같은 그룹으로 합치지 않는다. */
function groupRequestsByCenterAndDate(requests: HanjinShipmentRequest[]): ShipmentRequestGroup[] {
  const groups = new Map<string, ShipmentRequestGroup>();
  for (const request of requests) {
    const key = `${request.fulfillmentCenter} ${request.expectedDate}`;
    let group = groups.get(key);
    if (!group) {
      group = { fulfillmentCenter: request.fulfillmentCenter, expectedDate: request.expectedDate, purchaseOrderNumbers: [] };
      groups.set(key, group);
    }
    if (!group.purchaseOrderNumbers.includes(request.purchaseOrderNumber)) {
      group.purchaseOrderNumbers.push(request.purchaseOrderNumber);
    }
  }
  return [...groups.values()];
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
  /** "YYYY-MM-DD" 형식 입고예정일 — K열 표시 문구("{물류센터} / {M월D일} / 발주서 번호 ...")에 쓰인다. */
  expectedDate: string;
}

export interface BuildHanjinUploadResult {
  buffer: Buffer;
  addedPurchaseOrderNumbers: string[];
  /** 결과 파일이 과거 행을 전혀 포함하지 않게 되면서(2026-08-24 2차) "이미 있어서 건너뜀" 판단
   *  자체가 없어졌다 — 호출부(API 응답/화면) 호환을 위해 필드는 남기되 항상 빈 배열이다. */
  skippedAlreadyPresent: string[];
  skippedMissingDestination: { purchaseOrderNumber: string; fulfillmentCenter: string; reason: string }[];
  sourceFileName: string;
}

/**
 * 발주서 원본(실제 데이터, 최우선)과 기존 한진 서식의 과거 행(우편번호 등 원본에 없는 값의 보조
 * 출처)을 합쳐 목적지를 만든다. 2026-08-24 이전에는 destinationsByCenter(한진 서식 자체의 과거
 * 행)만 봤기 때문에, 예전에 한 번도 한진 업로드를 해본 적 없는 물류센터는 실제로는 발주서
 * 원본에 주소·연락처가 멀쩡히 있는데도 "목적지 정보 없음"으로 전부 제외됐다 — 이번에 확인된
 * 실제 원인이다.
 *
 * 우선순위 규칙(사용자 확정):
 * - 주소/전화번호는 발주서 원본이 있으면 그 값을 최우선 사용한다.
 * - 원본에 없는 값(우편번호 — 발주서 원본에 우편번호 항목 자체가 없음을 직접 확인함)은
 *   먼저 기존 한진 서식의 과거 행에서 보충하고, 거기에도 없으면 공식 주소 조회로 검증해
 *   영구 등록해둔 data/verified-postal-codes.ts에서 보충한다(2026-08-24 신규 — 센터명+주소가
 *   정확히 일치할 때만 반환되므로 추측/재사용 위험이 없다).
 * - 원본 값과 기존 서식 값이 서로 다르면(둘 다 있는데 불일치) 임의로 하나를 고르지 않고
 *   "정보 불일치"로 걸러서 사람이 확인하게 한다 — 절대 덮어쓰지 않는다.
 * - 그래도 주소/전화번호/우편번호 중 하나라도 못 채우면 운송장을 만들지 않는다(추측 금지).
 */
/** 발주서 원본 주소(D13) 끝에는 항상 "(택배수령담당자 :+82...)" 안내문구가 붙어있어, 접미사가
 *  없는 기존 한진 서식의 과거 행 주소와 비교하면 실제로는 같은 주소인데도 매번 "불일치"로
 *  잘못 걸러졌다(2026-08-24 3차 — 인천4 등 과거 행이 있는 센터에서 확인). 비교용으로만 이
 *  안내문구를 떼어내고, 실제 저장/출력에 쓰는 orderAddress 원본 값은 절대 건드리지 않는다. */
function stripContactAnnotationForComparison(address: string): string {
  return address.replace(/\(택배수령담당자\s*:\s*\+?\d+\)\s*$/, "").trim();
}

/** 발주서 원본 전화번호("+8270..." 국제표기)와 기존 한진 서식의 전화번호("070..." 국내표기)는
 *  같은 번호를 다른 형식으로 적은 것뿐인데 문자열이 달라 비교 시 항상 "불일치"로 잘못
 *  걸러졌다(2026-08-24 3차). 숫자만 남기고 "82"로 시작하면 국내 0-표기로 맞춰 비교한다 —
 *  실제 저장/출력에 쓰는 orderPhone 원본 값은 절대 건드리지 않는다. */
function normalizePhoneForComparison(phone: string): string {
  const digits = phone.replace(/[^\d]/g, "");
  if (digits.startsWith("82") && digits.length > 10) return "0" + digits.slice(2);
  return digits;
}

function resolveGroupDestination(
  group: ShipmentRequestGroup,
  orderByPoNumber: Map<string, SupplierHubPurchaseOrder>,
  destinationsByCenter: Map<string, HanjinDestination>
): { destination: HanjinDestination | null; reason: string | null } {
  const templateDestination = destinationsByCenter.get(normalizeCenterName(group.fulfillmentCenter));

  // 이 묶음(그룹)에 속한 발주번호 중 실제 발주서 원본을 찾은 것들의 주소/연락처를 모은다.
  const matchedOrders = group.purchaseOrderNumbers
    .map(po => orderByPoNumber.get(normalizeSkuId(po)))
    .filter((order): order is SupplierHubPurchaseOrder => Boolean(order));

  const orderAddresses = new Set(matchedOrders.map(o => o.fulfillmentAddress).filter(Boolean));
  const orderPhones = new Set(matchedOrders.map(o => o.fulfillmentContactPhone).filter(Boolean));

  if (orderAddresses.size > 1) {
    return { destination: null, reason: `같은 물류센터인데 발주서 원본 주소가 서로 다릅니다: ${[...orderAddresses].join(" / ")}` };
  }
  if (orderPhones.size > 1) {
    return { destination: null, reason: `같은 물류센터인데 발주서 원본 전화번호가 서로 다릅니다: ${[...orderPhones].join(" / ")}` };
  }

  const orderAddress = [...orderAddresses][0] || "";
  const orderPhone = [...orderPhones][0] || "";

  if (
    orderAddress &&
    templateDestination?.address &&
    stripContactAnnotationForComparison(orderAddress) !== stripContactAnnotationForComparison(templateDestination.address)
  ) {
    return {
      destination: null,
      reason: `주소 불일치(임의로 덮어쓰지 않음) — 발주서 원본: "${orderAddress}" / 기존 한진 서식: "${templateDestination.address}"`,
    };
  }
  if (orderPhone && templateDestination?.phone && normalizePhoneForComparison(orderPhone) !== normalizePhoneForComparison(templateDestination.phone)) {
    return {
      destination: null,
      reason: `전화번호 불일치(임의로 덮어쓰지 않음) — 발주서 원본: "${orderPhone}" / 기존 한진 서식: "${templateDestination.phone}"`,
    };
  }

  const address = orderAddress || templateDestination?.address || "";
  const phone = orderPhone || templateDestination?.phone || "";
  // 발주서 원본에는 우편번호 항목이 없다 — 기존 서식에 없으면 공식 조회로 검증해 등록해둔
  // verified-postal-codes.ts에서만 보충한다(센터명+주소 정확 일치 시에만 값이 나옴).
  const zip = templateDestination?.zip || findVerifiedPostalCode(group.fulfillmentCenter, address) || "";
  const note = templateDestination?.note || "던지지마세요";

  const missing: string[] = [];
  if (!address) missing.push("주소");
  if (!phone) missing.push("전화번호");
  if (!zip) missing.push("우편번호");
  if (missing.length > 0) {
    return { destination: null, reason: `목적지 정보 없음(${missing.join(", ")} 확인 안 됨) — 발주서 원본/기존 한진 서식 어디에도 없습니다.` };
  }

  return { destination: { phone, zip, address, note }, reason: null };
}

/**
 * 요청받은 (발주번호, 물류센터, 입고예정일) 목록만으로 업로드파일을 새로 만든다. 원본 서식은
 * 레이아웃/헤더(1행)만 템플릿으로 쓰고, 원본에 있던 과거 데이터 행은 결과 파일에 절대 포함하지
 * 않는다 — 매 호출이 그 시점에 선택된 발주서만으로 완결된 결과를 만드는 방식이라 "이미 있어서
 * 건너뜀" 판단 자체가 필요 없다. 먼저 물류센터+입고예정일로 전부 그룹화한 뒤 그룹당 정확히
 * 한 행만 만든다(개별 행을 만들었다가 나중에 합치지 않는다). 목적지(전화/우편번호/주소)는
 * 발주서 원본을 최우선으로 쓰고(resolveGroupDestination 참고), 그래도 못 채우면 임의로 채우지
 * 않고 건너뛴 뒤 정확한 사유를 알려준다.
 */
export async function buildHanjinUploadFile(requests: HanjinShipmentRequest[]): Promise<BuildHanjinUploadResult> {
  const [template, orders] = await Promise.all([loadTemplate(), loadSupplierHubPurchaseOrders()]);
  const orderByPoNumber = new Map(orders.map(order => [normalizeSkuId(order.purchaseOrderNumber), order]));

  const addedPurchaseOrderNumbers: string[] = [];
  const skippedMissingDestination: { purchaseOrderNumber: string; fulfillmentCenter: string; reason: string }[] = [];
  const newRowsXml: string[] = [];
  let nextRow = 2; // 결과 파일에는 과거 데이터 행이 없으므로 항상 헤더(1행) 바로 다음부터 새로 쓴다.

  // 같은 물류센터+같은 입고예정일은 한 행(=한 운송장)으로 합배송 처리한다 — 서로 다른 물류센터나
  // 입고예정일은 절대 합치지 않는다(groupRequestsByCenterAndDate가 키로 분리해서 보장).
  const groups = groupRequestsByCenterAndDate(requests);

  for (const group of groups) {
    const { destination, reason } = resolveGroupDestination(group, orderByPoNumber, template.destinationsByCenter);
    if (!destination) {
      for (const po of group.purchaseOrderNumbers) {
        skippedMissingDestination.push({ purchaseOrderNumber: po, fulfillmentCenter: group.fulfillmentCenter, reason: reason || "목적지 정보 없음" });
      }
      continue;
    }

    newRowsXml.push(
      buildRowXml(nextRow, {
        [COL_K]: buildShipmentLabel(group.fulfillmentCenter, group.expectedDate, group.purchaseOrderNumbers),
        [COL_AB]: `로켓배송*${group.fulfillmentCenter}`,
        [COL_AC]: destination.phone,
        [COL_AD]: destination.zip,
        [COL_AE]: destination.address,
        [COL_AF]: destination.note,
      })
    );
    addedPurchaseOrderNumbers.push(...group.purchaseOrderNumbers);
    nextRow += 1;
  }

  const updatedSheetXml = template.sheetXml.replace(
    /<x:sheetData([^>]*)>[\s\S]*?<\/x:sheetData>/,
    (_match, attrs: string) => `<x:sheetData${attrs}>${template.headerRowXml}${newRowsXml.join("")}</x:sheetData>`
  );
  template.zip.file(SHEET_PATH, updatedSheetXml);
  const buffer = await template.zip.generateAsync({ type: "nodebuffer" });

  return {
    buffer,
    addedPurchaseOrderNumbers,
    skippedAlreadyPresent: [],
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
  if (!sheet) return rows;

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
}

/**
 * 3단계 전용 — 2단계에서 업로드한 원본의 실제 행 데이터 중, 현재 웨이브의 (발주번호,물류센터)와
 * 일치하고 송장번호가 실제로 채워진 행만 골라 새 "상품목록" 시트(원본과 같은 실제 헤더)로
 * 만든다. 1단계 한진 업로드 서식(K/AB~AF 고정 컬럼)과는 완전히 다른 파일이다. 송장번호가 없는
 * (매칭 실패) 행은 절대 포함하지 않는다 — 임의로 채우거나 끼워 넣지 않는다.
 */
export async function buildShipmentCreationUploadFile(
  allRows: ParsedTrackingRow[],
  targets: { purchaseOrderNumber: string; fulfillmentCenter: string }[]
): Promise<BuildShipmentUploadResult> {
  const targetKeys = new Set(targets.map(t => trackingKey(t.purchaseOrderNumber, t.fulfillmentCenter)));
  const inTarget = allRows.filter(row => targetKeys.has(trackingKey(row.purchaseOrderNumber, row.fulfillmentCenter)));
  const included = inTarget.filter(row => row.trackingNumber);
  const excludedUnmatchedCount = inTarget.length - included.length;

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(TRACKING_SHEET_NAME);
  sheet.addRow(TRACKING_HEADERS);
  for (const row of included) {
    sheet.addRow([
      row.purchaseOrderNumber,
      row.fulfillmentCenter,
      row.transportType,
      row.expectedDate,
      row.skuId,
      row.barcode,
      row.productName,
      row.confirmedQuantity,
      row.trackingNumber,
      row.shippedQuantity,
    ]);
  }

  const buffer = (await workbook.xlsx.writeBuffer()) as unknown as Buffer;
  return { buffer, includedCount: included.length, excludedUnmatchedCount };
}
