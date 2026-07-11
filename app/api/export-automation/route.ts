import { NextRequest, NextResponse } from "next/server";
import { buildAutomationWorkbook } from "@/lib/excel/automation";
import type { ExportPayload } from "@/lib/excel/types";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as ExportPayload;
    if (!body?.product || !body?.model) {
      return NextResponse.json({ error: "상품정보가 부족합니다." }, { status: 400 });
    }

    const result = await buildAutomationWorkbook(body);
    return new NextResponse(result.buffer, {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(result.downloadName)}`,
        "X-SKU-Count": String(result.skuCount),
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "상품입력 자동화 파일 생성 실패" },
      { status: 500 }
    );
  }
}
