const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const reader = require(path.join(process.cwd(), "extensions/supplier-hub-poc/shipment-reader.js"));

const cell = (text, rowSpan = 1, colSpan = 1) => ({ textContent: text, rowSpan, colSpan });
const table = rows => ({ rows: rows.map(row => ({ cells: row })) });
function receiptDoc(shipmentNumber, status, lines = []) {
  const heading = { textContent: `쉽먼트 # ${shipmentNumber} 쉽먼트 상태 : ${status}` };
  if (status !== "마감") return { querySelectorAll: selector => selector === "h4" ? [heading] : [], querySelector: () => null };
  const detail = table([
    [cell("박스"), cell("발주번호"), cell("SKU"), cell("SKU 이름"), cell("SKU 바코드"), cell("납품수량"), cell("입고수량")],
    ...lines.map(line => [cell(line.box), cell(line.po), cell(line.sku), cell("상품"), cell("barcode"), cell(line.delivered), cell(line.received)]),
  ]);
  const totals = table([[cell("총 납품 수량"), cell("총 입고 수량")], [cell(String(lines.reduce((sum, line) => sum + Number(line.delivered), 0))), cell(String(lines.reduce((sum, line) => sum + Number(line.received), 0)))] ]);
  return { querySelectorAll: selector => selector === "h4" ? [heading] : selector === "table" ? [detail, totals] : [], querySelector: selector => selector === "#shipmentDetailTable" ? detail : null };
}

const original = { location: global.location, fetch: global.fetch, DOMParser: global.DOMParser };
global.location = new URL("https://supplier.coupang.com/ibs/asn/active");
const docs = new Map([
  ["100", receiptDoc("100", "마감", [{ box: "A", po: "900", sku: "1", delivered: "3", received: "2" }])],
  ["104", receiptDoc("104", "마감", [{ box: "A", po: "900", sku: "1", delivered: "3", received: "2" }, { box: "B", po: "901", sku: "2", delivered: "1", received: "1" }])],
  ["101", receiptDoc("101", "발송 완료")],
  ["102", receiptDoc("102", "확인 필요")],
  ["103", { querySelectorAll: () => [], querySelector: () => null }],
]);
const defaultHeader = ["선택", "상태", "쉽먼트번호", "물류센터", "입고 예정일"];
let listHeader = defaultHeader;
const listRow = (id, status, center, date) => ({ hasAttribute: name => name === "data-id", getAttribute: name => name === "data-id" ? id : name === "data-type" ? "PARCEL" : null,
  querySelector: () => null, cells: [cell(""), cell(status), cell(id), cell(center), cell(date)] });
function listDoc(page) {
  const head = { hasAttribute: () => false, querySelector: selector => selector === "th" ? {} : null, cells: listHeader.map(text => cell(text)) };
  const rows = page === 1 ? [listRow("100", "마감", "A센터", "2026-09-14"), listRow("101", "발송 완료", "A센터", "2026-09-20")]
    : [listRow("104", "마감", "B센터", "2026.09.13 (토)"), listRow("105", "마감", "B센터", "2026-09-12")];
  const tableNode = { querySelectorAll: selector => selector === "tr[data-id]" ? rows : selector === "tr" ? [head, ...rows] : [] };
  const script = { textContent: `$('#parcel-pagination').bootpag({ total: 2, page: ${page} })` };
  return { querySelector: selector => selector === "#parcel-tab" ? tableNode : null, querySelectorAll: selector => selector === "script" ? [script] : [] };
}
const asideBaseline = JSON.parse(fs.readFileSync("lib/wms/logistics-aside-baseline.json", "utf8"));
global.DOMParser = class { parseFromString(text) { return text.startsWith("list:") ? listDoc(Number(text.slice(5))) : docs.get(text) || receiptDoc(text, "발송 가능"); } };
let skuStatusRequest, invalidSkuStatus = false;
global.fetch = async (url, init = {}) => {
  if (String(url).includes("/plan/v1/ticket/sku/listTicketSku")) {
    const skuId = JSON.parse(init.body).skuId;
    skuStatusRequest = JSON.parse(init.body);
    return { ok: true, redirected: false, url: "https://supplier.coupang.com/plan/v1/ticket/sku/listTicketSku?locale=ko", json: async () => ({ content: [{ skuId, orderStatus: invalidSkuStatus ? "미확인" : skuId === "2" ? "일시중단" : "정상" }] }) };
  }
  if (String(url).includes("/list?")) return { ok: true, redirected: false, url: `https://supplier.coupang.com${url}`, text: async () => `list:${new URL(url, "https://x").searchParams.get("pageNumber")}` };
  return { ok: true, redirected: false, url: `https://supplier.coupang.com${url}`, text: async () => String(url).match(/(\d+)$/)[1] };
};

(async () => {
  const result = await reader.collectShipments([
    { shipmentNumber: "100", expectedDate: "2026-09-20", centerName: "A센터", purchaseOrderNumbers: ["900"], source: "dispatch" },
    { shipmentNumber: "101", expectedDate: "2026-09-20", centerName: "A센터", purchaseOrderNumbers: ["901"], source: "aside" },
  ]);
  assert.equal(result.schemaVersion, 3); assert.deepEqual(result.requestedShipmentNumbers, ["100", "101"]); assert.deepEqual(result.skuStatuses, [{ skuId: "1", orderStatus: "정상" }]); assert.deepEqual(skuStatusRequest, { skuId: "1", skuName: "", barcode: "", orderingStatus: "", unit1: "", unit2: "", issueStatus: "", issueType: "", size: 10, page: 1 });
  assert.equal(result.shipments[0].totalReceived, 2); assert.deepEqual(result.shipments[1].lines, []);
  const aside = await reader.collectShipments([{ shipmentNumber: "104", expectedDate: "2026-09-20", centerName: "A센터", purchaseOrderNumbers: ["900"], source: "aside" }]);
  assert.deepEqual(aside.shipments[0].lines.map(line => line.purchaseOrderNumber), ["900", "901"]); assert.deepEqual(aside.skuStatuses, [{ skuId: "1", orderStatus: "정상" }, { skuId: "2", orderStatus: "일시중단" }]);
  // 예전 Aside 대기목록은 2026-10-08 사용자 요청으로 비웠다.
  assert.equal(asideBaseline.pendingTargets.length, 0);
  // 쿠팡 목록 전체에서 9/13 이후 입고예정 마감건만 찾는다(2쪽, 날짜 형식 혼합, 기준일 이전·미마감 제외).
  const hub = await reader.collectClosedSince("2026-09-13");
  assert.equal(hub.mode, "hub-closed"); assert.deepEqual(hub.requestedShipmentNumbers, ["100", "104"]);
  assert.deepEqual(hub.shipmentMetadata, { "100": { expectedDate: "2026-09-14", centerName: "A센터" }, "104": { expectedDate: "2026-09-13", centerName: "B센터" } });
  assert.deepEqual(hub.skuStatuses, [{ skuId: "1", orderStatus: "정상" }, { skuId: "2", orderStatus: "일시중단" }]);
  listHeader = ["선택", "상태", "쉽먼트", "택배사"];
  await assert.rejects(() => reader.collectClosedSince("2026-09-13"), /입고예정일·센터 열을 찾지 못했습니다/);
  listHeader = defaultHeader;
  await assert.rejects(() => reader.collectShipments([{ shipmentNumber: "104", expectedDate: "2026-09-20", centerName: "A센터", purchaseOrderNumbers: ["900"], source: "dispatch" }]), /출고 대상과 다릅니다/);
  await assert.rejects(() => reader.collectShipments([{ shipmentNumber: "100", expectedDate: "2026-09-20", centerName: "A센터", purchaseOrderNumbers: ["900"], source: "dispatch" }, { shipmentNumber: "100", expectedDate: "2026-09-20", centerName: "A센터", purchaseOrderNumbers: ["900"], source: "dispatch" }]), /중복/);
  await assert.rejects(() => reader.collectShipments([{ shipmentNumber: "102", expectedDate: "2026-09-20", centerName: "A센터", purchaseOrderNumbers: ["900"], source: "dispatch" }]), /처리할 수 없습니다/);
  await assert.rejects(() => reader.collectShipments([{ shipmentNumber: "103", expectedDate: "2026-09-20", centerName: "A센터", purchaseOrderNumbers: ["900"], source: "dispatch" }]), /상세를 확인하지 못했습니다/);
  invalidSkuStatus = true;
  await assert.rejects(() => reader.collectShipments([{ shipmentNumber: "100", expectedDate: "2026-09-20", centerName: "A센터", purchaseOrderNumbers: ["900"], source: "dispatch" }]), /공급상태를 정확히/);
  invalidSkuStatus = false;
  global.fetch = async () => ({ ok: true, redirected: true, url: "https://supplier.coupang.com/login", text: async () => "" });
  await assert.rejects(() => reader.collectShipments([{ shipmentNumber: "100", expectedDate: "2026-09-20", centerName: "A센터", purchaseOrderNumbers: ["900"], source: "dispatch" }]), /다시 로그인/);
  console.log("PASS hub-closed list collection since 9/13; logistics receipt v2 direct-detail collection, rowspan totals, PO identity, duplicate, missing, unknown-state and login blocks");
})().finally(() => Object.assign(global, original));
