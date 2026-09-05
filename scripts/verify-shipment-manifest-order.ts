import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import {
  buildBarTenderWorkbook,
  matchShipmentPrintGroups,
  type BarcodeSourceRow,
  type ShipmentPdfFile,
} from "../lib/wms/shipment-print-client";
import type { ProductCatalogItem } from "../lib/wms/product-catalog";

const shipmentNumber = "50129648";
const manifestOrder = ["57450341", "42085186", "78453238"];

function pdfFile(kind: "label" | "manifest"): ShipmentPdfFile {
  return {
    shipmentNumber,
    file: new File([kind], `${kind}(${shipmentNumber}).pdf`, { type: "application/pdf" }),
    pageCount: 1,
    pageWidth: 595,
    pageHeight: 842,
    pblCode: "PBL0108037352",
    trackingNumber: "463196755151",
    expectedDate: "2026-09-04",
    fulfillmentCenter: "인천14",
    purchaseOrderNumbers: kind === "label" ? ["140000001"] : [],
    boxNumber: "1-1",
    items: kind === "manifest"
      ? manifestOrder.map(skuId => ({ skuId, barcode: `R${skuId}`, quantity: 1 }))
      : [],
  };
}

const sourceRows: BarcodeSourceRow[] = [
  ["42085186", 2],
  ["78453238", 3],
  ["57450341", 4],
].map(([skuId, sourceRowNumber]) => ({
  purchaseOrderNumber: "140000001",
  fulfillmentCenter: "인천14",
  expectedDate: "2026-09-04",
  skuId: String(skuId),
  warehouseNumber: "A-1",
  barcode: `R${skuId}`,
  productName: `상품 ${skuId}`,
  optionLabel: "실버",
  quantity: 1,
  sourceRowNumber: Number(sourceRowNumber),
  embeddedModelName: "",
  embeddedCountryOfOrigin: "",
  trackingNumber: "463196755151",
}));

const catalog: ProductCatalogItem[] = manifestOrder.map(skuId => ({
  skuId,
  modelSku: `MODEL-${skuId}`,
  modelName: `MODEL-${skuId}`,
  category: "",
  gender: "",
  productName: `상품 ${skuId}`,
  optionLabel: "실버",
  imageUrl: "",
  warehouseNumber: "A-1",
  boxNumber: "",
  currentStock: "",
  currentStatus: "",
  costVatIncluded: "",
  vendorName: "",
  barcode: `R${skuId}`,
  countryOfOrigin: "중국",
  productLink: "",
}));

async function main() {
  const groups = matchShipmentPrintGroups(
    [pdfFile("label")],
    [pdfFile("manifest")],
    sourceRows,
    catalog,
  );

  assert.deepEqual(
    groups[0].barcodeRows.map(row => row.skuId),
    manifestOrder,
    "바코드 그룹은 발주서 행번호가 아니라 동봉내역서 상품 순서를 따라야 합니다.",
  );

  const workbookBytes = await buildBarTenderWorkbook(groups);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(workbookBytes as unknown as ExcelJS.Buffer);
  const sheet = workbook.getWorksheet("템플릿1")!;
  const savedRows = Array.from({ length: sheet.rowCount - 1 }, (_, index) => ({
    skuId: String(sheet.getRow(index + 2).getCell(1).value ?? ""),
    outputType: String(sheet.getRow(index + 2).getCell(8).value ?? ""),
  }));

  assert.equal(savedRows[0]?.outputType, "쉽먼트구분");
  assert.deepEqual(
    savedRows.filter(row => row.outputType === "상품").map(row => row.skuId),
    manifestOrder,
    "저장 레코드는 동봉내역서 상품 순서와 정확히 같아야 합니다.",
  );

  console.log(JSON.stringify({ manifestOrder, savedWorkbookOrder: savedRows.map(row => row.skuId || row.outputType) }, null, 2));
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
