import { NextRequest, NextResponse } from "next/server";
import { buildSkuRows, formatCoupangOptionName, costWithVat, dimensionText, parseNumber, supplierLabel, supplyPrice } from "@/lib/excel/common";
import type { ExportPayload } from "@/lib/excel/types";
import { markRegistrationFilesCreated } from "@/lib/wms/registration-file-stage";
import { hasNoidbActionSession, isSameOriginActionRequest } from "@/lib/wms/noidb-action-auth";

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
    "", "", "", "", "", "", "", "", "", "", "", "",
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
    return NextResponse.json({ configured: called.configured, duplicate: Boolean(called.result?.duplicate), reregisterable: Boolean(called.result?.reregisterable), reason: called.result?.reason || "" });
  } catch (error) {
    return NextResponse.json({ configured: true, duplicate: false, error: error instanceof Error ? error.message : "중복 확인 실패" });
  }
}

export async function POST(req: NextRequest) {
  if (!isSameOriginActionRequest(req) || !hasNoidbActionSession(req)) {
    return NextResponse.json({ configured: true, synced: false, error: "관리자 잠금 해제가 필요합니다." }, { status: 401 });
  }
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
        title: payload.title, color: formatCoupangOptionName(sku.sku, sku.color), size: sku.size, dimension, cost, sale, supply,
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
    if (["cloudDraftSave", "cloudDraftDelete", "quoteQueueClear", "quoteQueueDeleteModel", "linkReplacementExisting", "deleteReplacementLegacyRows", "undoReplacementLink", "normalizeCatalogIds", "repairSkuUploadDuplicates", "migrateInventoryTracking"].includes(raw?.action)) {
      const called = await callWebhook({
        ...raw,
        secret: process.env.GOOGLE_SHEETS_WEBHOOK_SECRET || "",
      });
      return NextResponse.json({ configured: called.configured, ...called.result });
    }
    const payload = raw as ExportPayload;
    const operationId = String(raw.operationId || "").trim();
    if (!/^[A-Za-z0-9_-]{12,120}$/.test(operationId)) {
      return NextResponse.json({ configured: true, synced: false, error: "등록 작업번호가 올바르지 않습니다." }, { status: 400 });
    }
    // 구버전 Apps Script는 알 수 없는 syncMode를 일반 upsert로 처리한다.
    // 기존행 재등록은 서버가 지원 여부를 확인한 경우에만 보내고, 신규는 create-only로 보낸다.
    let registrationSyncMode: "skipDuplicate" | "reregisterStopped" = "skipDuplicate";
    if (raw.syncMode !== "skipDuplicate") {
      const checked = await callWebhook({
        secret: process.env.GOOGLE_SHEETS_WEBHOOK_SECRET || "",
        action: "checkModel",
        model: payload.model,
      });
      if (!checked.configured || checked.result?.ok !== true || typeof checked.result?.duplicate !== "boolean") {
        return NextResponse.json({ configured: checked.configured, synced: false, error: "제품DB의 기존 모델 확인 결과를 검증하지 못해 저장하지 않았습니다." }, { status: 503 });
      }
      if (checked.result.duplicate) {
        if (checked.result.reregisterable !== true) {
          const reason = String(checked.result.reason || "판매중지 재등록용 Apps Script 업데이트가 필요하거나 보호 중인 기존 모델입니다.");
          return NextResponse.json({ configured: true, synced: false, duplicate: true, reason, error: reason });
        }
        registrationSyncMode = "reregisterStopped";
      }
    }
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
      title: payload.title, color: formatCoupangOptionName(sku.sku, sku.color), size: sku.size, dimension, cost, sale, supply,
      sourcingUrl: payload.sourcingUrl || "",
    }));
    // 재등록에서는 미입력 가격을 계산된 0으로 덮어쓰지 않는다.
    productDbRows.forEach(row => {
      row[13] = String(payload.product.cost || "").trim() ? cost : "";
      if (String(payload.product.price || "").trim()) { row[14] = sale; row[15] = supply; }
      else { row[14] = ""; row[15] = ""; }
      if (!String(payload.product.cost || "").trim() || !String(payload.product.price || "").trim()) row[18] = "";
    });
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
      operationId,
      // 기존 상품은 Apps Script 잠금 안에서 판매중지 상태와 옵션의 정확한 일치를 재검증한다.
      syncMode: registrationSyncMode,
    });
    let registrationStage: { updatedRows: number; backupSheetName?: string } | null = null;
    if (called.configured && called.result?.ok !== false && !called.result?.duplicate && !called.result?.updated) {
      registrationStage = await markRegistrationFilesCreated(payload.model, skus.map(sku => sku.sku));
    }
    return NextResponse.json({
      configured: called.configured,
      synced: called.configured && called.result?.ok !== false && !called.result?.duplicate,
      duplicate: Boolean(called.result?.duplicate),
      result: called.result,
      registrationStage: called.result?.registrationStage || registrationStage,
      reregistered: Boolean(called.result?.reregistered),
    });
  } catch (error) {
    return NextResponse.json(
      { configured: true, synced: false, error: error instanceof Error ? error.message : "Google 시트 누적 실패" },
      { status: 500 }
    );
  }
}
