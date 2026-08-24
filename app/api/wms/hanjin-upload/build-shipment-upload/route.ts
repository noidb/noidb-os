import { NextRequest, NextResponse } from "next/server";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  parseTrackingRowsFromBuffer,
  buildShipmentCreationUploadFile,
  parseConfirmedOrderRowsFromBuffer,
  parseHanjinReprintAssignmentsFromBuffer,
  buildShipmentCreationUploadFileFromSources,
} from "@/lib/wms/hanjin-upload";

/**
 * 3단계 전용 API — Supplier Hub 쉽먼트 생성 업로드파일을 만든다 (2026-08-19 6차 실사용 테스트
 * 신규). 1단계(한진택배 송장출력용 업로드파일, /api/wms/hanjin-upload/generate)와는 완전히
 * 다른 파일이다: 2단계에서 업로드한 "송장번호 입력 완료" 원본의 실제 행 데이터를 그대로 읽어,
 * 현재 웨이브의 (발주번호,물류센터)와 일치하고 송장번호가 실제로 채워진 행만 새 파일로 만든다.
 * 매칭 실패(송장번호 없음) 행은 절대 포함하지 않는다. 이 API는 아무것도 외부에 업로드하지 않고
 * 파일만 만들어 반환한다.
 */
export const runtime = "nodejs";

function decodeBase64(input: string): Buffer {
  const commaIndex = input.indexOf(",");
  const raw = input.startsWith("data:") && commaIndex >= 0 ? input.slice(commaIndex + 1) : input;
  return Buffer.from(raw, "base64");
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const fileBase64 = String(body.fileBase64 || "");
    const confirmedFileBase64 = String(body.confirmedFileBase64 || "");
    const waveId = String(body.waveId || "wave");
    const targets: { purchaseOrderNumber: string; fulfillmentCenter: string }[] = Array.isArray(body.targets) ? body.targets : [];
    if (!fileBase64) {
      return NextResponse.json({ error: "2단계에서 업로드한 송장번호 파일이 없습니다. 먼저 2단계를 완료해주세요." }, { status: 400 });
    }
    if (targets.length === 0) {
      return NextResponse.json({ error: "대상 발주서/물류센터가 없습니다." }, { status: 400 });
    }

    const templatePath = process.env.WMS_SHIPMENT_TEMPLATE_PATH || path.join(process.cwd(), "public", "templates", "ShipmentsUpload_PARCEL_template.xlsx");
    const templateBuffer = await readFile(templatePath);

    const result = confirmedFileBase64
      ? await buildShipmentCreationUploadFileFromSources(
          await parseConfirmedOrderRowsFromBuffer(decodeBase64(confirmedFileBase64)),
          await parseHanjinReprintAssignmentsFromBuffer(decodeBase64(fileBase64)),
          targets,
          templateBuffer
        )
      : await buildShipmentCreationUploadFile(await parseTrackingRowsFromBuffer(decodeBase64(fileBase64)), targets, templateBuffer);

    if (result.includedCount === 0) {
      return NextResponse.json(
        { error: "송장번호가 채워진 대상 행이 없습니다 — 2단계 매칭 결과를 다시 확인해주세요.", excludedUnmatchedCount: result.excludedUnmatchedCount },
        { status: 400 }
      );
    }

    const timestamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "").replace("T", "_");
    const fileName = `쉽먼트생성_업로드파일_${waveId}_${timestamp}.xlsx`;
    const outputDirectory = process.env.WMS_SHIPMENT_OUTPUT_DIR || (process.platform === "win32" ? "G:\\내 드라이브\\쿠팡데이터\\쉽먼트업로드완성" : "");
    let savedPath = "";
    if (outputDirectory) {
      await mkdir(outputDirectory, { recursive: true });
      savedPath = path.join(outputDirectory, fileName);
      await writeFile(savedPath, result.buffer);
    }

    return new NextResponse(result.buffer, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
        "X-Included-Count": String(result.includedCount),
        "X-Excluded-Unmatched-Count": String(result.excludedUnmatchedCount),
        "X-Excluded-Zero-Quantity-Count": String(result.excludedZeroQuantityCount),
        ...(savedPath ? { "X-Auto-Saved-Path": encodeURIComponent(savedPath) } : {}),
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "쉽먼트 생성 업로드파일을 만드는 중 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
