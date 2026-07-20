import { NextRequest, NextResponse } from "next/server";
import { buildQuoteWorkbook } from "@/lib/excel/quote";
import { buildSkuRows } from "@/lib/excel/common";
import type { ExportPayload } from "@/lib/excel/types";
import JSZip from "jszip";

export const runtime = "nodejs";
export const maxDuration = 60;

function modelSummary(payloads: ExportPayload[]) {
  const models = [...new Set(payloads.map(payload => String(payload.model || "").trim()).filter(Boolean))];
  if (!models.length) return "모델미확인";
  return models.length === 1 ? models[0] : `${models[0]}_외${models.length - 1}개`;
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as ExportPayload & { payloads?: ExportPayload[] };
    const payloads = Array.isArray(body.payloads) ? body.payloads : [];
    if (payloads.length) {
      const chunks: ExportPayload[][] = [];
      let current: ExportPayload[] = [];
      let currentRows = 0;
      for (const payload of payloads) {
        const count = buildSkuRows(payload).length;
        if (!count) continue;
        if (count > 1000) throw new Error(`${payload.model} 모델만으로 SKU가 1,000행을 초과합니다.`);
        if (current.length && currentRows + count > 1000) {
          chunks.push(current);
          current = [];
          currentRows = 0;
        }
        current.push(payload);
        currentRows += count;
      }
      if (current.length) chunks.push(current);
      if (!chunks.length) throw new Error("견적서에 넣을 SKU가 없습니다.");

      const results = [];
      for (const chunk of chunks) results.push(await buildQuoteWorkbook(chunk));
      const base = `견적서_${payloads[0].product.gender}_${payloads[0].product.category}_${modelSummary(payloads)}`;
      if (results.length === 1) {
        return new NextResponse(results[0].buffer, {
          status: 200,
          headers: {
            "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(`${base}.xlsx`)}`,
            "X-Download-Name": encodeURIComponent(`${base}.xlsx`),
            "X-SKU-Count": String(results[0].skuCount),
          },
        });
      }
      const zip = new JSZip();
      results.forEach((result, index) => zip.file(`${base}_${String(index + 1).padStart(3, "0")}.xlsx`, result.buffer));
      const zipBuffer = await zip.generateAsync({ type: "nodebuffer" });
      return new NextResponse(zipBuffer, {
        status: 200,
        headers: {
          "Content-Type": "application/zip",
          "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(`${base}.zip`)}`,
          "X-Download-Name": encodeURIComponent(`${base}.zip`),
          "X-SKU-Count": String(results.reduce((sum, result) => sum + result.skuCount, 0)),
        },
      });
    }
    if (!body?.product || !body?.model) {
      return NextResponse.json({ error: "상품정보가 부족합니다." }, { status: 400 });
    }

    const result = await buildQuoteWorkbook(body);
    return new NextResponse(result.buffer, {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(result.downloadName)}`,
        "X-SKU-Count": String(result.skuCount),
        "X-Template-File": encodeURIComponent(result.templateFile),
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "견적서 생성 실패" },
      { status: 500 }
    );
  }
}
