import { NextRequest, NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { AutoShipmentBlockedError, buildAutoShipmentFile, resolveStoredAutoShipmentGeneration } from "@/lib/wms/hanjin-shipment-auto";
import { buildShipmentOutputContext, ShipmentOutputValidationError } from "@/lib/wms/shipment-output-context";
import { generatedDriveSaveHeaders } from "@/lib/wms/google-drive-oauth-writer";
import { readPickingWaveStore } from "@/lib/wms/picking-wave/server-store";

/**
 * "쉽먼트파일 생성" 버튼 하나로 끝내는 자동화 API(2026-08-24 9차). 사용자가 파일을 직접 고르지
 * 않는다 — Google Drive(운영)/로컬 G드라이브(개발)에서 최신 "재출력_세부내역_*.xlsx"와
 * "발주서업로드완성" 폴더의 확정수량 파일을 자동으로 찾아 현재 웨이브와 대조한다. 하나라도
 * 어긋나면(발주번호 없음/송장번호 없음/물류센터·입고예정일 불일치/운송장번호 충돌 등) 아무것도
 * 만들지 않고 사유를 전부 돌려준다 — 자세한 판정 로직은 lib/wms/hanjin-shipment-auto.ts 참고.
 */
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const ownerId = String(body.waveId || "").trim();
    const generationId = String(body.generationId || "").trim();
    const purchaseOrderNumbers = Array.isArray(body.purchaseOrderNumbers) ? body.purchaseOrderNumbers.map(String) : [];
    if (purchaseOrderNumbers.length === 0) {
      return NextResponse.json({ error: "대상 발주서/물류센터가 없습니다." }, { status: 400 });
    }

    const storedGeneration = resolveStoredAutoShipmentGeneration(
      await readPickingWaveStore(),
      ownerId,
      generationId,
      purchaseOrderNumbers,
    );

    const context = await buildShipmentOutputContext(storedGeneration.purchaseOrderNumbers, { requireDestination: false });
    if (!context.preview.canGenerate) throw new ShipmentOutputValidationError(context.preview);
    if (context.purchaseOrderNumbers.length !== new Set(purchaseOrderNumbers).size) {
      return NextResponse.json({ error: "선택 묶음의 발주번호 집합을 정확히 확인하지 못했습니다." }, { status: 409 });
    }
    const sourceRequests = context.documents.map(document => ({ purchaseOrderNumber: document.purchaseOrderNumber, fulfillmentCenter: document.fulfillmentCenterName, expectedDate: document.expectedArrivalDate }));
    const templatePath = process.env.WMS_SHIPMENT_TEMPLATE_PATH || path.join(process.cwd(), "public", "templates", "ShipmentsUpload_PARCEL_template.xlsx");
    const templateBuffer = await readFile(templatePath);
    const result = await buildAutoShipmentFile(sourceRequests, context.records, templateBuffer, {
      selectedReprintFileName: typeof body.selectedReprintFileName === "string" ? body.selectedReprintFileName : undefined,
      confirmedQuantityFileNameByPo: storedGeneration.confirmedQuantityFileNameByPo,
      confirmedQuantityFileHashByName: storedGeneration.confirmedQuantityFileHashByName,
    });

    const timestamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "").replace("T", "_");
    const fileName = `쉽먼트생성_업로드파일_${timestamp}.xlsx`;
    const driveHeaders = await generatedDriveSaveHeaders(
      result.buffer,
      fileName,
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      ["쿠팡데이터", "쉽먼트업로드완성"],
    );

    return new NextResponse(result.buffer, {
      headers: {
        ...driveHeaders,
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
        "X-Included-Count": String(result.includedCount),
        "X-Included-Po-Numbers": encodeURIComponent(result.includedPurchaseOrderNumbers.join(",")),
        "X-Tracking-Numbers-Used": encodeURIComponent(result.trackingNumbersUsed.join(", ")),
        "X-Reprint-File-Names": encodeURIComponent(result.reprintFileNames.join(", ")),
        "X-Confirmed-Quantity-File-Names": encodeURIComponent(result.confirmedQuantityFileNames.join(", ")),
      },
    });
  } catch (error) {
    if (error instanceof ShipmentOutputValidationError) return NextResponse.json({ error: error.message, preview: error.preview }, { status: 409 });
    if (error instanceof AutoShipmentBlockedError) {
      return NextResponse.json({ error: "쉽먼트파일을 생성할 수 없습니다.", reasons: error.reasons }, { status: 400 });
    }
    return NextResponse.json(
      { error: "Shipment 파일을 만들지 못했습니다. 파일폴더 연결 상태를 확인한 뒤 다시 시도해 주세요." },
      { status: 500 }
    );
  }
}
