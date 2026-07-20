import { NextRequest, NextResponse } from "next/server";
import { buildSkuRows, costWithVat, dimensionText, parseNumber, supplierLabel, supplyPrice } from "@/lib/excel/common";
import type { ExportPayload } from "@/lib/excel/types";

export const runtime = "nodejs";

async function callWebhook(body: unknown) {
  const webhookUrl = process.env.GOOGLE_SHEETS_WEB_APP_URL;
  if (!webhookUrl) return { configured: false, result: null };
  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let result: any = {};
  try { result = JSON.parse(text); } catch { result = { raw: text }; }
  if (!response.ok) {
    const detail = String(result?.error || result?.raw || text || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 240);
    throw new Error(`Google 시트 응답 오류 (${response.status})${detail ? ` · ${detail}` : ""}`);
  }
  if (result?.ok === false) {
    const reason = String(result.error || "Apps Script 처리 실패");
    if (reason === "unauthorized") {
      throw new Error("Apps Script 비밀번호와 Vercel 환경변수 비밀번호가 서로 다릅니다.");
    }
    throw new Error(reason);
  }
  return { configured: true, result };
}

function productDbRow(values: {
  supplier: string; gender: string; category: string; model: string; modelSku: string; warehouse: string;
  image: string; title: string; color: string; size: string; dimension: string;
  cost: number; sale: number; supply: number; sourcingUrl: string;
}) {
  return [
    "", values.supplier, values.gender, values.category, values.model, values.modelSku,
    values.warehouse, "", values.image, values.title, values.color, values.size, values.dimension,
    values.cost || "", values.sale || "", values.supply,
    "", values.sourcingUrl || "", values.supply - values.cost, "", 0, 0,
    "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "",
  ];
}

export async function GET(req: NextRequest) {
  try {
    const action = req.nextUrl.searchParams.get("action") || "";
    if (action === "cloudDraftList" || action === "quoteQueueList" || action === "supplierList") {
      const called = await callWebhook({
        secret: process.env.GOOGLE_SHEETS_WEBHOOK_SECRET || "",
        action,
      });
      if (action === "quoteQueueList") {
        return NextResponse.json({ configured: called.configured, records: called.result?.records || [] });
      }
      if (action === "supplierList") {
        return NextResponse.json({ configured: called.configured, suppliers: called.result?.suppliers || [] });
      }
      return NextResponse.json({ configured: called.configured, drafts: called.result?.drafts || [] });
    }
    const model = req.nextUrl.searchParams.get("model")?.trim() || "";
    if (!model) return NextResponse.json({ configured: true, duplicate: false });
    const called = await callWebhook({
      secret: process.env.GOOGLE_SHEETS_WEBHOOK_SECRET || "",
      action: "checkModel",
      model,
    });
    return NextResponse.json({ configured: called.configured, duplicate: Boolean(called.result?.duplicate) });
  } catch (error) {
    return NextResponse.json({ configured: true, duplicate: false, error: error instanceof Error ? error.message : "중복 확인 실패" });
  }
}

export async function POST(req: NextRequest) {
  try {
    const webhookUrl = process.env.GOOGLE_SHEETS_WEB_APP_URL;
    if (!webhookUrl) return NextResponse.json({ configured: false, synced: false });

    const raw = await req.json() as any;
    if (raw?.action === "linkReplacementExisting" && raw?.payload) {
      const payload = raw.payload as ExportPayload;
      const sale = parseNumber(payload.product.price);
      const cost = costWithVat(parseNumber(payload.product.cost));
      const supply = supplyPrice(sale);
      const supplier = supplierLabel(payload.product.supplier, payload.product.gender);
      const dimension = dimensionText(payload.product);
      const skus = buildSkuRows(payload);
      const productDbRows = skus.map(sku => productDbRow({
        supplier, gender: payload.product.gender, category: payload.product.category, model: payload.model,
        modelSku: sku.sku, warehouse: payload.product.warehouse || "", image: sku.thumbFile,
        title: payload.title, color: sku.color, size: sku.size, dimension, cost, sale, supply,
        sourcingUrl: payload.sourcingUrl || "",
      }));
      const called = await callWebhook({
        action: "linkReplacementExisting",
        model: raw.model || payload.model,
        replacementSku: raw.replacementSku || payload.product.replacementSku || "",
        forceLegacyOptions: Boolean(raw.forceLegacyOptions),
        productDbRows,
        secret: process.env.GOOGLE_SHEETS_WEBHOOK_SECRET || "",
      });
      return NextResponse.json({ configured: called.configured, ...called.result });
    }
    if (["cloudDraftSave", "cloudDraftDelete", "quoteQueueClear", "quoteQueueDeleteModel", "linkReplacementExisting", "deleteReplacementLegacyRows"].includes(raw?.action)) {
      const called = await callWebhook({
        ...raw,
        secret: process.env.GOOGLE_SHEETS_WEBHOOK_SECRET || "",
      });
      return NextResponse.json({ configured: called.configured, ...called.result });
    }
    const payload = raw as ExportPayload;
    const sale = parseNumber(payload.product.price);
    const cost = costWithVat(parseNumber(payload.product.cost));
    const supply = supplyPrice(sale);
    const supplier = supplierLabel(payload.product.supplier, payload.product.gender);
    const dimension = dimensionText(payload.product);
    const skus = buildSkuRows(payload);

    const productInputRow = [
      "등록", supplier, payload.product.gender, payload.product.category, payload.model,
      payload.title, payload.product.colors, payload.product.sizes, cost || "", sale || "", dimension,
      payload.product.warehouse || "",
    ];
    const productDbRows = skus.map(sku => productDbRow({
      supplier, gender: payload.product.gender, category: payload.product.category, model: payload.model,
      modelSku: sku.sku, warehouse: payload.product.warehouse || "", image: sku.thumbFile,
      title: payload.title, color: sku.color, size: sku.size, dimension, cost, sale, supply,
      sourcingUrl: payload.sourcingUrl || "",
    }));
    const productImages = skus.flatMap(sku => {
      const dataUrl = payload.optionImages?.[sku.color];
      return dataUrl?.startsWith("data:image/") ? [{ filename: sku.thumbFile, dataUrl }] : [];
    });
    const quotePayload: ExportPayload = { ...payload, optionImages: {} };

    const called = await callWebhook({
      secret: process.env.GOOGLE_SHEETS_WEBHOOK_SECRET || "",
      productInputRow,
      productDbRows,
      productImages,
      quoteRecord: {
        model: payload.model,
        gender: payload.product.gender,
        category: payload.product.category,
        skuCount: skus.length,
        payload: quotePayload,
      },
      replacementSku: payload.product.replacementSku || "",
      syncMode: raw.syncMode || "upsert",
    });
    return NextResponse.json({
      configured: called.configured,
      synced: called.configured && called.result?.ok !== false && !called.result?.duplicate,
      duplicate: Boolean(called.result?.duplicate),
      result: called.result,
    });
  } catch (error) {
    return NextResponse.json(
      { configured: true, synced: false, error: error instanceof Error ? error.message : "Google 시트 누적 실패" },
      { status: 500 }
    );
  }
}
