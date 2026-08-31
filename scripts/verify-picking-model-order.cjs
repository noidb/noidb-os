const assert = require("node:assert/strict");
const fs = require("node:fs");
const ts = require("typescript");

require.extensions[".ts"] = function compileTypeScript(module, filename) {
  const source = fs.readFileSync(filename, "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
      jsx: ts.JsxEmit.ReactJSX,
    },
    fileName: filename,
  }).outputText;
  module._compile(output, filename);
};

const { buildPickingWave } = require("../lib/wms/picking-wave/build-wave.ts");
const { buildLiveCatalogLookup } = require("../lib/wms/picking-wave/live-catalog.ts");
const { resolvePickingItemSortIdentity, sortPickingWaveItems } = require("../lib/wms/picking-wave/grouping.ts");

const NOW = "2026-09-01T09:00:00+09:00";

function catalogItem({ skuId, modelName, modelSku, warehouseNumber, productName, optionLabel = "" }) {
  return {
    skuId, modelName, modelSku, warehouseNumber, productName, optionLabel,
    category: warehouseNumber, gender: "", imageUrl: "", boxNumber: "", currentStock: "",
    currentStatus: "", costVatIncluded: "", vendorName: "", barcode: "", countryOfOrigin: "", productLink: "",
  };
}

function waveItem(catalog, overrides = {}) {
  return {
    id: `WAVE-TEST-${catalog.skuId}`,
    waveId: "WAVE-TEST",
    productCode: catalog.skuId,
    productName: catalog.productName,
    barcode: "",
    category: catalog.category,
    gender: catalog.gender,
    modelName: catalog.modelName,
    modelSku: catalog.modelSku,
    optionLabel: catalog.optionLabel,
    catalogWarehouseNumber: catalog.warehouseNumber,
    totalQuantity: 1,
    sources: [{ purchaseOrderNumber: "PO-1", basketNumber: "1", requestedQuantity: 1 }],
    locationStatus: "unlocated",
    modelSortKey: "legacy",
    locationSortKey: "legacy",
    status: "pending",
    pickedQuantity: 0,
    shortageQuantity: 0,
    allocations: [],
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function assertContiguous(sorted, lookup, expectedModels) {
  const modelOrder = sorted.map(item => resolvePickingItemSortIdentity(item, lookup).model);
  for (const model of expectedModels) {
    const positions = modelOrder.map((value, index) => value === model ? index : -1).filter(index => index >= 0);
    assert.ok(positions.length > 0, `${model}: 테스트 항목이 없습니다.`);
    assert.equal(positions.at(-1) - positions[0] + 1, positions.length, `${model}: 다른 모델이 옵션 사이에 끼었습니다.`);
  }
  return modelOrder;
}

// 실제 제품DB에서 확인한 다옵션 모델 표본.
const we011735 = [
  catalogItem({ skuId: "36034972", modelName: "we011735", modelSku: "we011735GOPI", warehouseNumber: "귀걸이A", productName: "강아지 발바닥 귀걸이, 골드핑크", optionLabel: "골드핑크" }),
  catalogItem({ skuId: "39396415", modelName: "we011735", modelSku: "we011735RGMI", warehouseNumber: "귀걸이A", productName: "강아지 발바닥 귀걸이, 로즈골드민트", optionLabel: "로즈골드민트" }),
  catalogItem({ skuId: "39396413", modelName: "we011735", modelSku: "we011735SIMI", warehouseNumber: "귀걸이A", productName: "강아지 발바닥 귀걸이, 실버민트", optionLabel: "실버민트" }),
];
const ws000129 = [
  catalogItem({ skuId: "38256633", modelName: "ws000129", modelSku: "wp000129GO1", warehouseNumber: "피어싱", productName: "원터치링 피어싱, 골드1호", optionLabel: "골드1호" }),
  catalogItem({ skuId: "59273308", modelName: "ws000129", modelSku: "wp000129GO2", warehouseNumber: "피어싱", productName: "원터치링 피어싱, 골드2호", optionLabel: "골드2호" }),
  catalogItem({ skuId: "59273289", modelName: "ws000129", modelSku: "wp000129GO3", warehouseNumber: "피어싱", productName: "원터치링 피어싱, 골드3호", optionLabel: "골드3호" }),
  catalogItem({ skuId: "59273307", modelName: "ws000129", modelSku: "wp000129GO4", warehouseNumber: "피어싱", productName: "원터치링 피어싱, 골드4호", optionLabel: "골드4호" }),
  catalogItem({ skuId: "59273306", modelName: "ws000129", modelSku: "wp000129GO5", warehouseNumber: "피어싱", productName: "원터치링 피어싱, 골드5호", optionLabel: "골드5호" }),
];
const wr0004 = [
  catalogItem({ skuId: "78489817", modelName: "wr0004", modelSku: "wr0004-RG11", warehouseNumber: "여성반지", productName: "체인패턴 반지, 로즈골드, 11호", optionLabel: "로즈골드 11호" }),
  catalogItem({ skuId: "78489827", modelName: "wr0004", modelSku: "wr0004-SI11", warehouseNumber: "여성반지", productName: "체인패턴 반지, 실버, 11호", optionLabel: "실버 11호" }),
  catalogItem({ skuId: "78489822", modelName: "wr0004", modelSku: "wr0004-GO11", warehouseNumber: "여성반지", productName: "체인패턴 반지, 골드, 11호", optionLabel: "골드 11호" }),
];
const otherSameWarehouse = catalogItem({ skuId: "99900001", modelName: "we011736", modelSku: "we011736SI", warehouseNumber: "귀걸이A", productName: "다른 귀걸이, 실버", optionLabel: "실버" });

const liveCatalog = [...we011735, ...ws000129, ...wr0004, otherSameWarehouse];
const lookup = buildLiveCatalogLookup(liveCatalog);

// 생성 당시 모델명이 비었던 구형 항목도 최신 modelSku 매칭으로 같은 모델에 복구된다.
const staleAndInterleaved = [
  waveItem(we011735[1], { modelName: undefined }),
  waveItem(otherSameWarehouse),
  waveItem(we011735[0], { modelName: undefined }),
  waveItem(ws000129[4]),
  waveItem(wr0004[1]),
  waveItem(ws000129[0]),
  waveItem(we011735[2], { modelName: undefined }),
  waveItem(wr0004[0]),
  waveItem(ws000129[2]),
  waveItem(wr0004[2]),
  waveItem(ws000129[1]),
  waveItem(ws000129[3]),
];
const sorted = sortPickingWaveItems(staleAndInterleaved, lookup);
const modelOrder = assertContiguous(sorted, lookup, ["we011735", "ws000129", "wr0004"]);

// 여러 센터/발주서에 같은 SKU가 있어도 SKU는 한 번만 피킹하고 sources에 원본 분배 단위를 보존한다.
const built = buildPickingWave({
  waveId: "WAVE-TEST",
  now: NOW,
  orders: [
    { purchaseOrderNumber: "PO-SEOUL", expectedDate: "2026-09-04", fulfillmentCenter: "서울", items: [
      { productCode: "36034972", productName: we011735[0].productName, barcode: "", orderedQuantity: 2 },
      { productCode: "39396415", productName: we011735[1].productName, barcode: "", orderedQuantity: 1 },
    ] },
    { purchaseOrderNumber: "PO-DAEGU", expectedDate: "2026-09-04", fulfillmentCenter: "대구3", items: [
      { productCode: "36034972", productName: we011735[0].productName, barcode: "", orderedQuantity: 3 },
      { productCode: "39396413", productName: we011735[2].productName, barcode: "", orderedQuantity: 4 },
    ] },
  ],
  catalog: { configured: true, items: liveCatalog },
  warehouse: { zones: [], shelves: [], boxes: [], modelLocations: [], skuExceptions: [] },
});
assert.deepEqual(built.items.map(item => item.modelName), ["we011735", "we011735", "we011735"]);
const repeatedSku = built.items.find(item => item.productCode === "36034972");
assert.equal(repeatedSku.totalQuantity, 5);
assert.equal(repeatedSku.sources.length, 2);
assert.deepEqual(new Set(repeatedSku.sources.map(source => source.purchaseOrderNumber)), new Set(["PO-SEOUL", "PO-DAEGU"]));

console.log(JSON.stringify({
  passed: true,
  actualModels: {
    threeOptions: we011735.map(item => `${item.modelName} ${item.optionLabel}`),
    fiveOptions: ws000129.map(item => `${item.modelName} ${item.optionLabel}`),
    sameWarehouseMultipleModels: modelOrder,
  },
  crossPurchaseOrder: {
    skuId: repeatedSku.productCode,
    totalQuantity: repeatedSku.totalQuantity,
    sourcePurchaseOrders: repeatedSku.sources.map(source => source.purchaseOrderNumber),
  },
}, null, 2));
