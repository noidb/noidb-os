const assert = require("node:assert/strict");
const fs = require("node:fs");
const ts = require("typescript");
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, filename);
const { getVendorVariantOptions } = require("../lib/wms/vendor-order/variant-options.ts");
function product(skuId, option, modelName = "wr011699", extra = {}) {
  return { skuId, modelSku: modelName + "-" + skuId, modelName, category: "반지", gender: "여성", productName: "써지컬스틸 하프 큐빅라인 여성 반지, " + option, optionLabel: option.split(",")[0], imageUrl: "", warehouseNumber: "", boxNumber: "", currentStock: "0", currentStatus: "완료", costVatIncluded: "", vendorName: "창성", barcode: "R" + skuId, countryOfOrigin: "", productLink: "", ...extra };
}
const thirteen = ["로즈골드", "실버"].flatMap((color, group) => [9, 11, 14, 17, 20].map((size, index) => product(String(78490103 + group * 5 + index), color + ", " + size + "호")));
for (const [skuId, option] of [["39129599", "실버 9호(한국사이즈 20호) 랜덤발송(패키지)"], ["39129600", "실버 6호(한국사이즈 11호) 랜덤발송(패키지)"], ["39129601", "로즈골드 5호(한국사이즈 9호) 랜덤발송(패키지)"]]) thirteen.push(product(skuId, option, "wr011699", { optionLabel: "" }));
thirteen[4].currentStatus = "단종";
const before = JSON.stringify(thirteen);
const aliases = new Map(thirteen.flatMap(item => [[item.skuId, item], [item.modelSku, item]]));
const result = getVendorVariantOptions({ anchorSkuId: "78490105", catalogItems: aliases.values(), existingSkuIds: ["78490105"] });
assert.equal(result.options.length, 13, "alias map values deduplicate by exact SKU");
assert.equal(result.options.filter(option => option.selectable).length, 11);
assert.equal(result.options.find(option => option.skuId === "78490105").optionLabel, "로즈골드, 14호");
assert.equal(result.options.find(option => option.skuId === "78490105").alreadyAdded, true);
assert.equal(result.options.find(option => option.skuId === "78490107").discontinued, true);
for (const row of result.options) {
  assert.equal(row.optionLabel, thirteen.find(item => item.skuId === row.skuId).productName.split(",").slice(1).map(value => value.trim()).join(", "));
  assert.equal(row.product, thirteen.find(item => item.skuId === row.skuId), "selection returns the exact original DB product");
}
assert.equal(JSON.stringify(thirteen), before, "catalog remains untouched");
const similar = product("99901", "로즈골드, 22호", "wr011699-other");
const blankModel = product("99902", "실버, 22호", "");
const sameNormalized = product("99903", "골드, 22호", "  WR011699  ");
const filtered = getVendorVariantOptions({ anchorSkuId: "78490105", catalogItems: [...thirteen, similar, blankModel, sameNormalized], existingSkuIds: [] });
assert.equal(filtered.options.length, 14, "only whitespace/case normalization may join model names");
assert(!filtered.options.some(option => ["99901", "99902"].includes(option.skuId)));
assert(filtered.options.some(option => option.skuId === "99903"));
const missing = getVendorVariantOptions({ anchorSkuId: blankModel.skuId, catalogItems: [blankModel, ...thirteen], existingSkuIds: [] });
assert.equal(missing.options.length, 0);assert.match(missing.reason, /모델명/);
const missingSku = getVendorVariantOptions({ anchorSkuId: "absent", catalogItems: thirteen, existingSkuIds: [] });
assert.equal(missingSku.options.length, 0);assert.match(missingSku.reason, /SKU/);
const conflict = { ...thirteen[0], currentStatus: "단종" };
const conflicting = getVendorVariantOptions({ anchorSkuId: "78490105", catalogItems: [...thirteen, conflict, thirteen[0]], existingSkuIds: [] });
assert.equal(conflicting.options.length, 12);assert(!conflicting.options.some(option => option.skuId === thirteen[0].skuId));
const anchorConflict = getVendorVariantOptions({ anchorSkuId: thirteen[0].skuId, catalogItems: [...thirteen, conflict], existingSkuIds: [] });
assert.equal(anchorConflict.options.length, 0);assert.match(anchorConflict.reason, /서로 달라/);
console.log("PASS variant options: all 13 exact model SKUs keep full color/size; existing and discontinued options disabled; exact model grouping and alias dedupe; no missing-model guesses; conflicting SKU/anchor excluded; original catalog unchanged.");
