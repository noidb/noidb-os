import type ExcelJS from "exceljs";

/**
 * 서플라이어허브 정산 '입고/반출 내역(입고상세내역)' 엑셀을 사용자가 직접 올린 기록(2026-11-06).
 * 쉽먼트 마감 기록의 입고수량이 0으로 찍혀도 정산 입고내역에는 정상 입고로 남는 경우가 많아,
 * 발주번호+SKU 기준 실제 입고 합계를 보관해 가짜 미납을 걸러 내는 근거로 쓴다.
 * 헤더 이름은 공백·표기 차이를 무시하고 찾는다.
 */
export interface SettlementInboundStore {
  uploadedAt: string;
  fileName: string;
  /** 마지막 업로드 파일에서 읽은 입고 행 수 */
  rowCount: number;
  /** 입고 날짜 범위(YYYY-MM-DD, 읽을 수 있을 때만) */
  firstDate?: string;
  lastDate?: string;
  /** 마지막으로 읽은 Drive 파일 서명(파일ID → 이름·md5/수정시각). 바뀐 파일만 다시 읽는 데 쓴다. */
  files?: Record<string, { name: string; signature: string }>;
  /** 발주번호|SKU ID → 입고 합계. 업로드가 겹쳐도 중복으로 더하지 않도록 키별 최댓값만 남긴다. */
  totals: Record<string, number>;
}

export interface SettlementInboundRow { purchaseOrderNumber: string; skuId: string; quantity: number; date: string }

export const settlementKey = (purchaseOrderNumber: string, skuId: string) => `${purchaseOrderNumber.trim()}|${skuId.trim()}`;

const norm = (value: string) => value.replace(/[\s ]/g, "").toLowerCase();
const SKU_HEADERS = ["sku번호", "skuid", "sku"].map(norm);
const PO_HEADERS = ["번호", "발주번호", "발주서번호"].map(norm);
const QTY_HEADERS = ["수량", "입고수량", "입고/반출수량", "입고수량(ea)"].map(norm);
const TYPE_HEADERS = ["구분"].map(norm);
const DATE_HEADERS = ["입고/반출시각", "입고/반출시간", "입고/반출일자", "입고/반출일", "입고일자", "입고일"].map(norm);

function cellText(value: unknown): string {
  if (value && typeof value === "object") {
    const v = value as { richText?: { text?: string }[]; text?: string; result?: unknown };
    if (value instanceof Date) return value.toISOString();
    if (Array.isArray(v.richText)) return v.richText.map(t => t.text ?? "").join("").trim();
    if (typeof v.text === "string") return v.text.trim();
    if (v.result !== undefined) return String(v.result ?? "").trim();
  }
  return String(value ?? "").trim();
}

export async function parseSettlementInboundBuffer(buffer: ExcelJS.Buffer | Buffer): Promise<SettlementInboundRow[]> {
  const { default: Excel } = await import("exceljs");
  const workbook = new Excel.Workbook();
  await workbook.xlsx.load(buffer as ExcelJS.Buffer);
  const rows: SettlementInboundRow[] = [];
  let foundHeader = false;
  for (const sheet of workbook.worksheets) {
    let columns: { sku: number; po: number; qty: number; type: number; date: number } | null = null;
    sheet.eachRow((row, rowNumber) => {
      const values: string[] = [];
      row.eachCell({ includeEmpty: true }, (cell, col) => { values[col - 1] = cellText(cell.value); });
      if (!columns) {
        const heads = values.map(v => norm(v || ""));
        const find = (list: string[]) => heads.findIndex(h => list.includes(h));
        const sku = find(SKU_HEADERS), po = find(PO_HEADERS), qty = find(QTY_HEADERS);
        if (sku >= 0 && po >= 0 && qty >= 0) { columns = { sku, po, qty, type: find(TYPE_HEADERS), date: find(DATE_HEADERS) }; foundHeader = true; }
        return;
      }
      const sku = (values[columns.sku] || "").replace(/\D/g, "");
      const po = (values[columns.po] || "").replace(/\D/g, "");
      if (!sku || !po) return;
      const raw = Number((values[columns.qty] || "").replace(/[^0-9.\-]/g, ""));
      if (!Number.isFinite(raw) || raw === 0) return;
      const type = columns.type >= 0 ? values[columns.type] || "" : "";
      const quantity = /반출|반품/.test(type) ? -Math.abs(raw) : raw;
      const dateMatch = (columns.date >= 0 ? values[columns.date] || "" : "").match(/\d{4}-\d{2}-\d{2}/);
      rows.push({ purchaseOrderNumber: po, skuId: sku, quantity, date: dateMatch?.[0] || "" });
      void rowNumber;
    });
  }
  if (!foundHeader) throw new Error("입고상세내역 표의 제목줄(번호·SKU번호·수량)을 찾지 못했습니다. 입고 상세내역 화면에서 내려받은 엑셀이 맞는지 확인해 주세요.");
  return rows;
}

export interface SettlementInboundFileInput { id: string; name: string; signature: string; rows: readonly SettlementInboundRow[] }

/** 파일마다 따로 합산한 뒤 키별 최댓값만 남긴다(기간이 겹치는 파일이 여러 개여도 이중으로 더하지 않음). 반출은 입고에서 뺀다. */
export function mergeSettlementInbound(previous: SettlementInboundStore | undefined, inputs: readonly SettlementInboundFileInput[], checkedAt: string, allFileSignatures?: Record<string, { name: string; signature: string }>): SettlementInboundStore {
  const totals = { ...(previous?.totals || {}) };
  const dates: string[] = [];
  let rowCount = 0;
  for (const input of inputs) {
    const perFile: Record<string, number> = {};
    for (const row of input.rows) { const key = settlementKey(row.purchaseOrderNumber, row.skuId); perFile[key] = (perFile[key] || 0) + row.quantity; if (row.date) dates.push(row.date); }
    rowCount += input.rows.length;
    for (const [key, value] of Object.entries(perFile)) totals[key] = Math.max(totals[key] || 0, value);
  }
  for (const key of Object.keys(totals)) if (!(totals[key] > 0)) delete totals[key];
  dates.sort();
  const files = allFileSignatures || { ...(previous?.files || {}), ...Object.fromEntries(inputs.map(i => [i.id, { name: i.name, signature: i.signature }])) };
  return { uploadedAt: checkedAt, fileName: Object.values(files).map(f => f.name).join(", ").slice(0, 300), rowCount: inputs.length ? rowCount : previous?.rowCount || 0, files,
    firstDate: [previous?.firstDate, dates[0]].filter(Boolean).sort()[0], lastDate: [previous?.lastDate, dates.at(-1)].filter(Boolean).sort().at(-1), totals };
}
