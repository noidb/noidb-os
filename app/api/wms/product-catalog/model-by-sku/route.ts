import { NextRequest, NextResponse } from "next/server";
import { FIELD_HEADER_CANDIDATES, normalizeSkuId } from "@/lib/wms/product-catalog";
import { findProductRowAnyTab } from "@/lib/wms/product-row-lookup";

/**
 * SKU ID 한 개로 제품DB의 모델명을 찾는 읽기 전용 API (2026-10-19).
 * 8번 기타파일생성 "썸네일·라벨 다운로드"에서 SKU ID를 입력하면 라벨용 모델명을 자동으로 채우는 데 쓴다.
 * 제품DB에서 먼저 찾고, 없으면 보관·창고재확인 등 다른 보이는 탭까지 찾는다(findProductRowAnyTab).
 * GET만 있고 시트에 아무것도 쓰지 않는다.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const skuId = normalizeSkuId(request.nextUrl.searchParams.get("skuId") ?? undefined);
  if (!/^\d{5,}$/.test(skuId)) {
    return NextResponse.json({ found: false, modelName: "", error: "SKU ID를 숫자로 입력해주세요." }, { status: 400 });
  }
  try {
    const match = await findProductRowAnyTab(skuId);
    if (!match) return NextResponse.json({ found: false, modelName: "" });
    const column = match.headers.findIndex(header => FIELD_HEADER_CANDIDATES.modelName.includes(header));
    const modelName = column >= 0 ? String(match.values[column] ?? "").trim() : "";
    return NextResponse.json({ found: true, modelName, sheetName: match.sheetName });
  } catch (error) {
    const message = error instanceof Error ? error.message : "제품DB 조회 중 오류가 발생했습니다.";
    // 같은 탭에 SKU가 여러 건이면 어느 모델인지 알 수 없다. 쓰기용 문구("쓰기를 중단")는 읽기에 맞게 바꿔 알린다.
    const friendly = message.includes("중복") ? `제품DB에 SKU ID ${skuId}가 중복되어 있어 모델명을 고를 수 없습니다.` : message;
    return NextResponse.json({ found: false, modelName: "", error: friendly }, { status: 500 });
  }
}
