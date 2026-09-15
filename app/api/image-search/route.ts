import { NextResponse } from "next/server";
import { getSearchRoots, searchImages } from "@/lib/image-search";
export async function GET() { return NextResponse.json({ roots: getSearchRoots() }); }
export async function POST(req: Request) {
  try { const body = await req.json(); const model = String(body.model || "").trim(); if (!model) return NextResponse.json({ error: "모델명을 입력해주세요." }, { status: 400 }); const hits = await searchImages(model, Array.isArray(body.rootIds) ? body.rootIds : getSearchRoots().map(r => r.id)); return NextResponse.json({ model, hits }); }
  catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : "이미지를 검색하지 못했습니다." }, { status: 500 }); }
}
