export type WimsRegistrationStatus = "reviewing" | "approved" | "rejected" | "unknown";

export interface WimsRegistrationRow {
  productName: string;
  modelSku: string;
  estimateId: string;
  skuId: string;
  barcode: string;
  status: WimsRegistrationStatus;
  statusLabel: string;
  registeredAt: string;
}

export interface WimsRegistrationSnapshot {
  rows: WimsRegistrationRow[];
  reviewingCount: number;
  approvedCount: number;
  rejectedCount: number;
  unknownCount: number;
}

const HEADER_ALIASES = {
  productName: ["상품명"],
  registeredAt: ["상품등록일", "상품 등록일"],
  barcode: ["바코드"],
  estimateId: ["견적서ID", "견적서 ID"],
  skuId: ["SKUID", "SKU ID"],
  status: ["상태"],
} as const;

function compact(value: string): string {
  return value.replace(/\s+/g, "").trim().toUpperCase();
}

function findColumn(headers: string[], aliases: readonly string[]): number {
  const normalized = headers.map(compact);
  return normalized.findIndex(header => aliases.some(alias => header === compact(alias)));
}

function cleanCell(value: string | undefined): string {
  return String(value ?? "").replace(/\r/g, "").trim();
}

function normalizeStatus(raw: string): WimsRegistrationStatus {
  const value = compact(raw);
  if (value.includes("등록불가") || value.includes("반려")) return "rejected";
  if (value.includes("검수완료") || value.includes("등록완료")) return "approved";
  if (value.includes("검수중") || value.includes("등록진행") || value.includes("승인대기")) return "reviewing";
  return "unknown";
}

function extractModelSku(productName: string): string {
  const tokens = productName.match(/\b[A-Za-z]{1,8}\d{3,}(?:[-_][A-Za-z0-9]+)*\b/g) || [];
  return tokens.length > 0 ? tokens[tokens.length - 1] : "";
}

function cleanBarcode(raw: string): string {
  const match = raw.toUpperCase().match(/\bR[0-9A-Z-]+\b/);
  return match?.[0] || "";
}

/** WIMS 표를 브라우저에서 복사했을 때 생성되는 탭 구분 텍스트를 읽는다. */
export function parseWimsClipboard(text: string): WimsRegistrationSnapshot {
  const lines = text.split(/\n/).map(line => line.replace(/\r/g, "").trim()).filter(Boolean);
  const headerLineIndex = lines.findIndex(line => {
    const cells = line.split("\t");
    return findColumn(cells, HEADER_ALIASES.productName) >= 0 && findColumn(cells, HEADER_ALIASES.status) >= 0;
  });
  if (headerLineIndex < 0) throw new Error("WIMS 표 머리글(상품명·상태)을 찾지 못했습니다. 표의 머리글부터 행까지 복사해주세요.");

  const headers = lines[headerLineIndex].split("\t").map(cleanCell);
  const indexes = {
    productName: findColumn(headers, HEADER_ALIASES.productName),
    registeredAt: findColumn(headers, HEADER_ALIASES.registeredAt),
    barcode: findColumn(headers, HEADER_ALIASES.barcode),
    estimateId: findColumn(headers, HEADER_ALIASES.estimateId),
    skuId: findColumn(headers, HEADER_ALIASES.skuId),
    status: findColumn(headers, HEADER_ALIASES.status),
  };

  const tabularLines = lines.slice(headerLineIndex + 1).filter(line => line.includes("\t"));
  const tabularRows = tabularLines.map(line => line.split("\t")).filter(cells => cleanCell(cells[indexes.productName])).map(cells => {
    const productName = cleanCell(cells[indexes.productName]);
    const statusLabel = cleanCell(cells[indexes.status]);
    const skuRaw = indexes.skuId >= 0 ? cleanCell(cells[indexes.skuId]) : "";
    return {
      productName,
      modelSku: extractModelSku(productName),
      estimateId: indexes.estimateId >= 0 ? cleanCell(cells[indexes.estimateId]) : "",
      skuId: /^\d+$/.test(skuRaw) ? skuRaw : "",
      barcode: indexes.barcode >= 0 ? cleanBarcode(cleanCell(cells[indexes.barcode])) : "",
      status: normalizeStatus(statusLabel),
      statusLabel,
      registeredAt: indexes.registeredAt >= 0 ? cleanCell(cells[indexes.registeredAt]) : "",
    } satisfies WimsRegistrationRow;
  });

  const rows = tabularRows.length > 0 ? tabularRows : parseVerticalWimsRows(lines.slice(headerLineIndex + 1));

  if (rows.length === 0) throw new Error("복사한 내용에서 상품 행을 찾지 못했습니다.");
  return {
    rows,
    reviewingCount: rows.filter(row => row.status === "reviewing").length,
    approvedCount: rows.filter(row => row.status === "approved").length,
    rejectedCount: rows.filter(row => row.status === "rejected").length,
    unknownCount: rows.filter(row => row.status === "unknown").length,
  };
}

function parseVerticalWimsRows(lines: string[]): WimsRegistrationRow[] {
  const dateIndexes = lines.map((line, index) => (/^\d{4}\/\d{2}\/\d{2}$/.test(line) ? index : -1)).filter(index => index >= 1);
  return dateIndexes.map((dateIndex, position) => {
    const productIndex = dateIndex - 1;
    const nextProductIndex = position + 1 < dateIndexes.length ? dateIndexes[position + 1] - 1 : lines.length;
    const segment = lines.slice(productIndex, nextProductIndex);
    const productName = segment[0] || "";
    const statusLabel = segment.find(line => ["상품 등록 불가", "상품 검수 완료", "상품 검수중", "상품 등록 진행중"].includes(line)) || "";
    const statusIndex = statusLabel ? segment.indexOf(statusLabel) : segment.length;
    const barcode = cleanBarcode(segment.find(line => /^R[0-9A-Z-]+$/i.test(line)) || "");
    const openParenIndex = segment.indexOf("(");
    const estimateId = openParenIndex >= 0 && /^\d+$/.test(segment[openParenIndex + 1] || "") ? segment[openParenIndex + 1] : "";
    let skuId = "";
    for (let index = statusIndex - 1; index >= 0; index -= 1) {
      if (/^\d{6,}$/.test(segment[index])) {
        if (segment[index] !== estimateId) skuId = segment[index];
        break;
      }
      if (segment[index] === "-") break;
    }
    const time = /^\d{2}:\d{2}:\d{2}$/.test(segment[2] || "") ? segment[2] : "";
    return {
      productName,
      modelSku: extractModelSku(productName),
      estimateId,
      skuId,
      barcode,
      status: normalizeStatus(statusLabel),
      statusLabel,
      registeredAt: [segment[1], time].filter(Boolean).join(" "),
    } satisfies WimsRegistrationRow;
  }).filter(row => row.productName && row.statusLabel);
}
