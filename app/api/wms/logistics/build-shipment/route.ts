import { NextRequest, NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { AutoShipmentBlockedError, buildAutoShipmentFile } from "@/lib/wms/hanjin-shipment-auto";
import { buildShipmentOutputContext, ShipmentOutputValidationError } from "@/lib/wms/shipment-output-context";
import { generatedDriveSaveHeaders } from "@/lib/wms/google-drive-oauth-writer";

/**
 * 발주묶음(InvoiceGroup) 전용 쉽먼트 업로드파일 생성 API (2026-09-18 신규).
 *
 * 기존 /api/wms/hanjin-upload/build-shipment-auto와 핵심 로직(buildAutoShipmentFile)은
 * 완전히 동일하게 재사용한다 — 그 로직 자체는 원래 웨이브와 무관했다(purchaseOrderNumbers만
 * 받는다). 웨이브에 종속됐던 부분은 오직 resolveStoredAutoShipmentGeneration(웨이브 저장소에서
 * 저장된 generation 기록을 찾는 어댑터)뿐이었는데, 발주묶음은 이미 그 자체로 "이 PO들이 하나의
 * 처리 단위"라는 걸 나타내므로 그 어댑터가 필요 없다 — 여기서는 곧바로 발주번호만으로 진행한다.
 * 재출력 세부내역·확정수량 파일 자동 매칭은 buildAutoShipmentFile 내부에서 그대로 처리한다
 * (발주서업로드완성 폴더의 파일을 PO+SKU로 자동 추론 — confirmedQuantityFileNameByPo를 안 넘기면
 * 자동 추론 경로를 탄다).
 */
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const purchaseOrderNumbers = Array.isArray(body.purchaseOrderNumbers) ? body.purchaseOrderNumbers.map(String) : [];
    if (!purchaseOrderNumbers.length) return NextResponse.json({ error: "대상 발주서가 없습니다." }, { status: 400 });

    const context = await buildShipmentOutputContext(purchaseOrderNumbers, { requireDestination: false, invoiceGroups: body.invoiceGroups });
    if (!context.preview.canGenerate) throw new ShipmentOutputValidationError(context.preview);
    if (context.purchaseOrderNumbers.length !== new Set(purchaseOrderNumbers).size) {
      return NextResponse.json({ error: "발주묶음의 발주번호 집합을 정확히 확인하지 못했습니다." }, { status: 409 });
    }
    const requests = context.documents.map(document => ({ purchaseOrderNumber: document.purchaseOrderNumber, fulfillmentCenter: document.fulfillmentCenterName, expectedDate: document.expectedArrivalDate }));
    const templatePath = process.env.WMS_SHIPMENT_TEMPLATE_PATH || path.join(process.cwd(), "public", "templates", "ShipmentsUpload_PARCEL_template.xlsx");
    const templateBuffer = await readFile(templatePath);
    // A source order quantity is not a confirmed quantity.  The auto builder
    // resolves a downloaded confirmation form (or blocks) for every PO.
    const result = await buildAutoShipmentFile(requests, context.records, templateBuffer, { invoiceGroups: body.invoiceGroups });

    const timestamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "").replace("T", "_");
    const fileName = `쉽먼트생성_업로드파일_${timestamp}.xlsx`;
    const driveHeaders = await generatedDriveSaveHeaders(
      result.buffer, fileName, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", ["쿠팡데이터", "쉽먼트업로드완성"],
    );

    return new NextResponse(result.buffer, {
      headers: {
        ...driveHeaders,
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
        "X-Included-Po-Numbers": encodeURIComponent(result.includedPurchaseOrderNumbers.join(",")),
        "X-Tracking-Numbers-Used": encodeURIComponent(result.trackingNumbersUsed.join(", ")),
        "X-Reprint-File-Names": encodeURIComponent(result.reprintFileNames.join(", ")),
        "X-Po-Tracking-Numbers": encodeURIComponent(JSON.stringify(result.invoiceNumbersByPurchaseOrder)),
      },
    });
  } catch (error) {
    if (error instanceof ShipmentOutputValidationError) return NextResponse.json({ error: error.message, preview: error.preview }, { status: 409 });
    if (error instanceof AutoShipmentBlockedError) return NextResponse.json({ error: "쉽먼트파일을 생성할 수 없습니다.", reasons: error.reasons }, { status: 400 });
    return NextResponse.json({ error: error instanceof Error ? error.message : "쉽먼트파일 생성에 실패했습니다." }, { status: 500 });
  }
}
