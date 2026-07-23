import { createHash } from "node:crypto";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
// 대량 SKU 파일은 Apps Script의 시트 갱신까지 기다려야 하므로 60초보다 넉넉하게 허용합니다.
export const maxDuration = 180;

type TableRow = Record<string, string>;

function cleanText(value: unknown) {
  let text = String(value ?? "");
  text = text.replace(/&nbsp;/gi, " ")
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(Number.parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/\u00a0/g, " ");
  return text.replace(/[\t ]+/g, " ").trim();
}

function normalizeFieldName(value: unknown) {
  return cleanText(value).toLowerCase().replace(/[\s()[\]{}_.\-/:]/g, "");
}

function field(row: TableRow, ...aliases: string[]) {
  const normalized = new Map(Object.entries(row).map(([key, value]) => [normalizeFieldName(key), value]));
  for (const alias of aliases) {
    const value = normalized.get(normalizeFieldName(alias));
    if (value !== undefined) return cleanText(value);
  }
  return "";
}

function parseNumber(value: unknown) {
  const number = Number(String(value ?? "").replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(number) ? number : 0;
}

function parseCsv(text: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (char === '"') {
      if (quoted && text[index + 1] === '"') { cell += '"'; index++; }
      else quoted = !quoted;
    } else if (char === "," && !quoted) {
      row.push(cell); cell = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && text[index + 1] === "\n") index++;
      row.push(cell); cell = "";
      if (row.some(value => value.trim())) rows.push(row);
      row = [];
    } else cell += char;
  }
  row.push(cell);
  if (row.some(value => value.trim())) rows.push(row);
  return rows;
}

function toObjects(rows: string[][]): TableRow[] {
  const headerIndex = rows.findIndex(row => row.some(value => ["SKU ID", "SKU번호", "SKU"].includes(cleanText(value))));
  if (headerIndex < 0) throw new Error("SKU 열을 찾을 수 없습니다.");
  const headers = rows[headerIndex].map(value => cleanText(value));
  return rows.slice(headerIndex + 1).filter(row => row.some(value => value.trim())).map(row =>
    Object.fromEntries(headers.map((header, index) => [header, cleanText(row[index])]))
  );
}

function decodeXml(value: string) {
  return cleanText(value.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&amp;/g, "&"));
}

function columnIndex(reference: string) {
  const letters = reference.replace(/[^A-Z]/gi, "").toUpperCase();
  let result = 0;
  for (const letter of letters) result = result * 26 + letter.charCodeAt(0) - 64;
  return result - 1;
}

async function fastXlsxRows(file: File) {
  const buffer = Buffer.from(await file.arrayBuffer());
  const zip = await JSZip.loadAsync(buffer);
  const sharedXml = await zip.file("xl/sharedStrings.xml")?.async("string") || "";
  const sharedStrings = [...sharedXml.matchAll(/<si(?:\s[^>]*)?>([\s\S]*?)<\/si>/g)].map(match =>
    decodeXml([...match[1].matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map(text => text[1]).join(""))
  );
  const sheetEntry = Object.keys(zip.files).filter(name => /^xl\/worksheets\/sheet\d+\.xml$/.test(name)).sort()[0];
  if (!sheetEntry) throw new Error(`${file.name}: 시트를 찾을 수 없습니다.`);
  const sheetXml = await zip.file(sheetEntry)!.async("string");
  const rows: string[][] = [];
  for (const rowMatch of sheetXml.matchAll(/<row(?:\s[^>]*)?>([\s\S]*?)<\/row>/g)) {
    const row: string[] = [];
    for (const cellMatch of rowMatch[1].matchAll(/<c([^>]*)>([\s\S]*?)<\/c>/g)) {
      const attributes = cellMatch[1];
      const reference = attributes.match(/\br="([A-Z]+\d+)"/i)?.[1] || "A1";
      const type = attributes.match(/\bt="([^"]+)"/)?.[1] || "";
      const raw = cellMatch[2].match(/<v>([\s\S]*?)<\/v>/)?.[1]
        ?? cellMatch[2].match(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/)?.[1] ?? "";
      const value = type === "s" ? sharedStrings[Number(raw)] || "" : decodeXml(raw);
      row[columnIndex(reference)] = value;
    }
    if (row.some(value => String(value ?? "").trim())) rows.push(row.map(value => String(value ?? "").trim()));
  }
  return { rows, buffer };
}

async function xlsxRows(file: File) {
  const buffer = Buffer.from(await file.arrayBuffer());
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
  const sheet = workbook.worksheets[0];
  if (!sheet) throw new Error(`${file.name}: 시트를 찾을 수 없습니다.`);
  const rows: string[][] = [];
  const cellText = (value: ExcelJS.CellValue): string => {
    if (value === null || value === undefined) return "";
    if (value instanceof Date) return value.toISOString().replace("T", " ").slice(0, 19);
    if (typeof value !== "object") return cleanText(value);
    if ("richText" in value && Array.isArray(value.richText)) return cleanText(value.richText.map(part => part.text || "").join(""));
    if ("result" in value && value.result !== undefined && value.result !== null) return cleanText(value.result);
    if ("text" in value && value.text !== undefined && value.text !== null) return cleanText(value.text);
    return "";
  };
  sheet.eachRow({ includeEmpty: false }, row => {
    const values: string[] = [];
    for (let column = 1; column <= sheet.columnCount; column++) values.push(cellText(row.getCell(column).value));
    rows.push(values);
  });
  return { rows, buffer };
}

function purchaseOrderNumber(rows: string[][], fileName: string) {
  for (const row of rows.slice(0, 20)) {
    const text = row.join(" ");
    const match = text.match(/발주서\s*No\.?\s*(\d+)/i) || text.match(/발주번호\s*(\d+)/);
    if (match) return match[1];
  }
  return fileName.match(/(\d{6,})/)?.[1] || "";
}

function formattedPurchaseOrderItems(rows: string[][], fileName: string) {
  const headerIndex = rows.findIndex(row => row.some(value => value.trim() === "상품코드"));
  if (headerIndex < 0) return [];
  const headers = rows[headerIndex].map(value => value.trim());
  const indexOf = (name: string) => headers.findIndex(value => value === name);
  const skuIndex = indexOf("상품코드");
  const nameIndex = headers.findIndex(value => value.startsWith("상품명/옵션"));
  const centerIndex = indexOf("물류센터");
  const orderQtyIndex = indexOf("발주수량");
  const confirmedQtyIndex = indexOf("업체납품가능수량");
  const receivedQtyIndex = indexOf("입고수량");
  const purchasePriceIndex = indexOf("공급가");
  const po = purchaseOrderNumber(rows, fileName);
  const expectedLabelIndex = rows.findIndex(row => row.some(value => value.trim() === "입고예정일시"));
  const expectedDate = expectedLabelIndex >= 0
    ? (rows[expectedLabelIndex + 1] || []).find(value => /^\d{4}[\/.\-]\d{1,2}[\/.\-]\d{1,2}/.test(value.trim())) || ""
    : "";

  const parsed = rows.slice(headerIndex + 1).map(row => {
    const sku = String(row[skuIndex] || "").trim();
    const center = String(row[centerIndex] || "").trim();
    return {
      key: [po, sku, center].join("|"), po, sku, center,
      status: "발주서", name: String(row[nameIndex] || "").trim(), barcode: "",
      expectedDate, orderDate: expectedDate,
      orderQty: parseNumber(row[orderQtyIndex]),
      confirmedQty: parseNumber(row[confirmedQtyIndex]),
      receivedQty: parseNumber(row[receivedQtyIndex]),
      purchasePrice: parseNumber(row[purchasePriceIndex]),
      supplyPrice: parseNumber(row[purchasePriceIndex + 1]),
      tax: parseNumber(row[purchasePriceIndex + 2]),
    };
  }).filter(item => item.po && item.sku && /^\d+$/.test(item.sku));

  const merged = new Map<string, (typeof parsed)[number]>();
  for (const item of parsed) {
    const current = merged.get(item.key);
    if (!current) {
      merged.set(item.key, item);
      continue;
    }
    if (!current.barcode && item.name && item.name !== current.name) current.barcode = item.name;
    if (/^R\d+$/i.test(current.name) && !/^R\d+$/i.test(item.name)) {
      current.barcode ||= current.name;
      current.name = item.name;
    }
  }
  return [...merged.values()];
}

async function callWebhook(body: unknown) {
  const webhookUrl = process.env.GOOGLE_SHEETS_WEB_APP_URL;
  if (!webhookUrl) throw new Error("Google 시트 연결이 설정되지 않았습니다.");
  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...(body as object), secret: process.env.GOOGLE_SHEETS_WEBHOOK_SECRET || "" }),
  });
  const text = await response.text();
  let result: any;
  try { result = JSON.parse(text); } catch { result = { error: text }; }
  if (!response.ok || result?.ok === false) {
    if (result?.error === "unauthorized") throw new Error("Apps Script와 Vercel의 비밀번호가 서로 다릅니다.");
    throw new Error(String(result?.error || `Google 시트 응답 오류 (${response.status})`));
  }
  return result;
}

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const mode = String(form.get("mode") || "");
    const dryRun = process.env.NODE_ENV !== "production" && String(form.get("dryRun") || "") === "true";
    const files = form.getAll("files").filter((value): value is File => value instanceof File && value.size > 0);
    if (!files.length) throw new Error("파일을 선택해주세요.");

    if (mode === "skuMaster") {
      const { rows } = await fastXlsxRows(files[0]);
      const parsedItems = toObjects(rows).map(row => ({
        sku: row["SKU ID"],
        name: row["상품명"],
        barcode: row["바코드"],
        status: row["발주가능상태"],
      })).filter(item => item.sku);
      const excluded = parsedItems.filter(item => /^S/i.test(String(item.barcode || "").trim())).length;
      const items = parsedItems.filter(item => !/^S/i.test(String(item.barcode || "").trim()));
      if (dryRun) return NextResponse.json({ ok: true, mode, parsed: items.length, excluded, sample: items.slice(0, 2) });
      const result = await callWebhook({ action: "importSkuMaster", items });
      return NextResponse.json({ ok: true, mode, parsed: items.length, excluded, ...result });
    }

    if (mode === "coupangExtract") {
      if (files.length !== 1) throw new Error("쿠팡쇼핑몰 추출DB.xlsx 파일 하나만 선택해주세요.");
      const { rows } = await xlsxRows(files[0]);
      const objects = toObjects(rows);
      const hasExtractColumns = objects.some(row =>
        ("제품링크" in row || "상품링크" in row) && "쿠팡노출가격" in row
      );
      if (!hasExtractColumns) throw new Error("쿠팡쇼핑몰 추출DB 형식을 확인해주세요.");

      const items = objects.map(row => ({
        sku: cleanText(row["SKU ID"] || row["SKU"]),
        optionId: cleanText(row["옵션ID"]),
        productLink: cleanText(row["상품링크"] || row["제품링크"]),
        exposurePrice: parseNumber(row["쿠팡노출가격"] || row["쿠팡 노출가"]),
        stockStatus: cleanText(row["재고현황"] || row["재고상태"] || row["재고 상태"]),
      })).filter(item => item.sku || item.optionId);
      const summary = { ok: true, mode, files: 1, parsed: items.length };
      if (dryRun) return NextResponse.json({ ...summary, sample: items.slice(0, 3) });
      const result = await callWebhook({ action: "importCoupangExtract", items });
      return NextResponse.json({ ...summary, ...result });
    }

    if (mode === "inboundHistory") {
      const datasets: { fingerprint: string; sourceFile: string; items: any[] }[] = [];
      const uniqueSkus = new Set<string>();
      let totalInbound = 0;
      let totalOutbound = 0;
      for (const file of files) {
        const { rows, buffer } = await xlsxRows(file);
        const totals = new Map<string, {
          po: string; expectedDate: string; sku: string; name: string;
          inbound: number; outbound: number; prices: { date: string; price: number }[]; lastDate: string;
        }>();
        for (const row of toObjects(rows)) {
          const sku = field(row, "SKU번호", "SKU ID", "SKU");
          if (!sku) continue;
          const po = field(row, "발주서 번호", "발주서번호", "발주번호", "발주서 NO", "발주서 No.", "PO 번호", "PO No");
          const expectedDate = field(row, "입고예정일", "입고예정일자", "입고예정일시");
          const key = [po, expectedDate, sku].join("|");
          const current = totals.get(key) || {
            po, expectedDate, sku, name: field(row, "SKU명", "SKU 이름", "상품명"),
            inbound: 0, outbound: 0, prices: [], lastDate: "",
          };
          const quantity = parseNumber(field(row, "입고수량", "수량"));
          const type = field(row, "구분");
          const date = field(row, "입고/반출시각", "입고일", "입고일시");
          const isOutbound = type.includes("반출");
          const isInbound = !isOutbound && (!type || type.includes("발주") || type.includes("입고"));
          if (isInbound) current.inbound += quantity;
          if (isOutbound) current.outbound += quantity;
          if (isInbound) {
            const price = parseNumber(field(row, "공급가액", "공급가"));
            if (price > 0 && date) current.prices.push({ date, price });
          }
          if (date > current.lastDate) current.lastDate = date;
          totals.set(key, current);
        }
        const items = [...totals.values()].map(item => {
          const prices = item.prices.sort((a, b) => a.date.localeCompare(b.date));
          const latest = prices.at(-1)?.price || 0;
          const previous = prices.length > 1 ? prices.at(-2)?.price || 0 : 0;
          uniqueSkus.add(item.sku);
          totalInbound += item.inbound;
          totalOutbound += item.outbound;
          return {
            po: item.po, expectedDate: item.expectedDate, sku: item.sku, name: item.name,
            totalInbound: item.inbound, receivedQty: item.inbound, outbound: item.outbound,
            netInbound: item.inbound - item.outbound, lastDate: item.lastDate,
            previousSupplyDate: prices.length > 1 ? prices.at(-2)?.date || "" : "",
            previousSupplyPrice: previous,
            latestSupplyDate: prices.at(-1)?.date || "",
            latestSupplyPrice: latest,
          };
        });
        datasets.push({ fingerprint: createHash("sha256").update(buffer).digest("hex"), sourceFile: file.name, items });
      }
      const responseSummary = { ok: true, mode, files: files.length, parsed: uniqueSkus.size, totalInbound, totalOutbound, netInbound: totalInbound - totalOutbound };
      if (dryRun) return NextResponse.json({ ...responseSummary, sample: datasets.flatMap(dataset => dataset.items).slice(0, 2) });
      const result = await callWebhook({ action: "importInboundSummary", datasets });
      return NextResponse.json({ ...responseSummary, ...result });
    }

    if (mode === "poList") {
      const allItems: any[] = [];
      for (const file of files) {
        const rows = file.name.toLowerCase().endsWith(".csv")
          ? parseCsv(Buffer.from(await file.arrayBuffer()).toString("utf8").replace(/^\uFEFF/, ""))
          : (await xlsxRows(file)).rows;
        const formattedItems = formattedPurchaseOrderItems(rows, file.name);
        if (formattedItems.length) {
          allItems.push(...formattedItems);
          continue;
        }
        allItems.push(...toObjects(rows).map(row => {
          const po = row["발주번호"];
          const sku = row["SKU ID"];
          const center = row["물류센터"];
          return {
            key: [po, sku, center].join("|"), po, sku, center,
            status: row["발주현황"], name: row["SKU 이름"], barcode: row["SKU Barcode"],
            expectedDate: row["입고예정일"], orderDate: row["발주일"],
            orderQty: parseNumber(row["발주수량"]), confirmedQty: parseNumber(row["확정수량"]), receivedQty: parseNumber(row["입고수량"]),
            purchasePrice: parseNumber(row["매입가"]), supplyPrice: parseNumber(row["공급가"]), tax: parseNumber(row["부가세"]),
          };
        }).filter(item => item.po && item.sku));
      }
      const centersByPo = new Map<string, Set<string>>();
      allItems.forEach(item => {
        const po = String(item.po || "").trim();
        const center = String(item.center || "").trim();
        if (!po || !center) return;
        if (!centersByPo.has(po)) centersByPo.set(po, new Set());
        centersByPo.get(po)!.add(center);
      });
      allItems.forEach(item => {
        const po = String(item.po || "").trim();
        const knownCenters = centersByPo.get(po);
        if (!String(item.center || "").trim() && knownCenters?.size === 1) item.center = [...knownCenters][0];
        item.key = [po, String(item.sku || "").trim(), String(item.center || "").trim()].join("|");
      });
      const items = [...new Map(allItems.map(item => [item.key, item])).values()];
      const summary = { ok: true, mode, files: files.length, parsed: items.length };
      if (dryRun) return NextResponse.json({ ...summary, sample: items.slice(0, 2) });
      const result = await callWebhook({ action: "importPurchaseOrders", items });
      return NextResponse.json({ ...summary, ...result });
    }

    throw new Error("지원하지 않는 가져오기 방식입니다.");
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "쿠팡 데이터 가져오기 실패" }, { status: 500 });
  }
}
