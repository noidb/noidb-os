import { NextRequest, NextResponse } from "next/server";
import { isSameOriginActionRequest } from "@/lib/wms/noidb-action-auth";
import { runReviewChecks } from "@/lib/review/checks";
import {
  MODEL_PATTERN, REF_PATTERN, deleteReviewRecord, listReviewRecords, readReviewImage, readReviewRecord,
  saveReviewImage, saveReviewRecord, toListItem,
} from "@/lib/review/store";
import type { ReviewRecord, ReviewStatus } from "@/lib/review/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const NO_STORE = { "Cache-Control": "private, no-store" };
const MAX_IMAGE_BODY = 4.4 * 1024 * 1024;
const fail = (error: string, status = 400) => NextResponse.json({ ok: false, error }, { status, headers: NO_STORE });

export async function GET(request: NextRequest) {
  if (!isSameOriginActionRequest(request) && request.headers.get("sec-fetch-site") !== "none") return fail("사이트 화면에서 다시 열어 주세요.", 403);
  try {
    const params = request.nextUrl.searchParams;
    const image = params.get("image");
    if (image) {
      const [model, ref] = image.split("/");
      if (!MODEL_PATTERN.test(model || "") || !REF_PATTERN.test(ref || "")) return new NextResponse(null, { status: 404 });
      const found = await readReviewImage(model, ref);
      if (!found) return new NextResponse(null, { status: 404 });
      return new NextResponse(new Uint8Array(found.bytes), {
        headers: { "Content-Type": found.contentType, "Cache-Control": "private, max-age=3600", "X-Robots-Tag": "noindex, nofollow" },
      });
    }
    const model = params.get("model");
    if (model) {
      if (!MODEL_PATTERN.test(model)) return fail("모델명이 올바르지 않습니다.");
      const record = await readReviewRecord(model);
      if (!record) return fail("검수 요청을 찾지 못했습니다.", 404);
      return NextResponse.json({ ok: true, record }, { headers: NO_STORE });
    }
    const records = await listReviewRecords();
    const items = records.map(toListItem);
    return NextResponse.json({ ok: true, items, pending: items.filter(item => item.status === "pending").length }, { headers: NO_STORE });
  } catch (error) {
    return fail(error instanceof Error ? error.message : "검수 목록을 읽지 못했습니다.", 500);
  }
}

type Body = {
  action?: string;
  model?: string;
  ref?: string;
  dataUrl?: string;
  record?: Partial<ReviewRecord>;
  status?: ReviewStatus;
  memo?: string;
};

export async function POST(request: NextRequest) {
  if (!isSameOriginActionRequest(request)) return fail("사이트 화면에서 다시 진행해 주세요.", 403);
  try {
    if (Number(request.headers.get("content-length") || 0) > MAX_IMAGE_BODY * 1.1) return fail("보낸 내용이 너무 큽니다.", 413);
    const body = await request.json() as Body;
    const model = String(body.model || body.record?.model || "").trim();
    if (!MODEL_PATTERN.test(model)) return fail("모델명이 올바르지 않습니다.");

    if (body.action === "image") {
      const ref = String(body.ref || "");
      const match = String(body.dataUrl || "").match(/^data:image\/(?:jpeg|jpg|png|webp);base64,([A-Za-z0-9+/=]+)$/);
      if (!REF_PATTERN.test(ref) || !match) return fail("사진 정보가 올바르지 않습니다.");
      const bytes = Buffer.from(match[1], "base64");
      if (!bytes.length || bytes.length > MAX_IMAGE_BODY) return fail("사진 한 장이 너무 큽니다.", 413);
      await saveReviewImage(model, ref, bytes);
      return NextResponse.json({ ok: true }, { headers: NO_STORE });
    }

    if (body.action === "submit") {
      const input = body.record;
      if (!input?.summary || !Array.isArray(input.thumbs) || !Array.isArray(input.slots) || !Array.isArray(input.details)) return fail("검수 요청 내용이 올바르지 않습니다.");
      const others = (await listReviewRecords().catch(() => [])).filter(record => record.model !== model);
      const draft = {
        model, summary: input.summary, payload: input.payload ?? null, thumbs: input.thumbs, slots: input.slots, details: input.details,
        detailPreviewRef: String(input.detailPreviewRef || ""), images: input.images || {},
      };
      const record: ReviewRecord = {
        ...draft, submittedAt: new Date().toISOString(), status: "pending", memo: "", data: input.data ?? null,
        checks: await runReviewChecks(draft, others), checkedAt: new Date().toISOString(),
      };
      await saveReviewRecord(record);
      return NextResponse.json({ ok: true, item: toListItem(record) }, { headers: NO_STORE });
    }

    const record = await readReviewRecord(model);
    if (body.action === "delete") {
      await deleteReviewRecord(model);
      return NextResponse.json({ ok: true }, { headers: NO_STORE });
    }
    if (!record) return fail("검수 요청을 찾지 못했습니다.", 404);

    if (body.action === "review") {
      if (body.status !== "approved" && body.status !== "revise") return fail("처리 종류가 올바르지 않습니다.");
      const memo = String(body.memo || "").trim().slice(0, 500);
      if (body.status === "revise" && !memo) return fail("보완할 내용을 메모에 적어 주세요.");
      const next: ReviewRecord = { ...record, status: body.status, memo, reviewedAt: new Date().toISOString() };
      await saveReviewRecord(next);
      return NextResponse.json({ ok: true, item: toListItem(next) }, { headers: NO_STORE });
    }

    if (body.action === "recheck") {
      const others = (await listReviewRecords().catch(() => [])).filter(item => item.model !== model);
      const next: ReviewRecord = { ...record, checks: await runReviewChecks(record, others), checkedAt: new Date().toISOString() };
      await saveReviewRecord(next);
      return NextResponse.json({ ok: true, record: next }, { headers: NO_STORE });
    }
    return fail("알 수 없는 요청입니다.");
  } catch (error) {
    return fail(error instanceof Error ? error.message : "처리하지 못했습니다.", 500);
  }
}
