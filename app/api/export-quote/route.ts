import { NextRequest, NextResponse } from "next/server";
import { buildQuoteWorkbook, MissingRequiredError, type QuoteCategoryOptions } from "@/lib/excel/quote";
import { readCategoryTemplate, readProductOptions } from "@/lib/product-options/store";
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

/** 카테고리 설정(올린 쿠팡 양식·경로·기본값)을 읽는다. 설정을 못 읽으면 예전 방식(기본 양식)으로 만든다. */
async function categoryOptions(categoryName: string, allowMissingRequired: boolean): Promise<QuoteCategoryOptions> {
  const options: QuoteCategoryOptions = { allowMissingRequired };
  let config;
  try { config = await readProductOptions(); } catch { return options; }
  const category = config.categories.find(item => item.name === categoryName);
  if (!category) return options;
  if (category.template?.blobPath) {
    const template = await readCategoryTemplate(category, categoryName);
    if (template) options.template = template;
  }
  const paths = category.paths || {};
  if (Object.keys(paths).length) options.path = gender => paths[gender] || "";
  if (category.defaults && Object.keys(category.defaults).length) options.defaults = category.defaults;
  return options;
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as ExportPayload & { payloads?: ExportPayload[]; allowMissingRequired?: boolean };
    const payloads = Array.isArray(body.payloads) ? body.payloads : [];
    const firstCategory = payloads[0]?.product?.category || body.product?.category || "";
    const options = firstCategory ? await categoryOptions(firstCategory, Boolean(body.allowMissingRequired)) : {};
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
      for (const chunk of chunks) results.push(await buildQuoteWorkbook(chunk, options));
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

    const result = await buildQuoteWorkbook(body, options);
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
    if (error instanceof MissingRequiredError) {
      return NextResponse.json({ error: error.message, missingRequired: error.missing }, { status: 422 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "견적서 생성 실패" },
      { status: 500 }
    );
  }
}
