import { NextResponse } from "next/server";
import { fetchSheetRows, isWmsGoogleSheetsConfigured, rowsToObjects } from "@/lib/wms/google-sheets";
import { normalizeSkuId } from "@/lib/wms/sku-normalize";

/**
 * 상품 연결표(구글시트) 읽기 전용 API. 모델명·SKU ID로 "사진폴더(확정)" 경로만 돌려준다.
 * GET만 존재한다 (쓰기 없음). 연결표는 staging/build_link_table.py 결과를 올린 별도 시트이며,
 * 기존 "노이드비 상품DB"와는 다른 스프레드시트다.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** "NOIDB_상품연결표_20260922_v8" 구글시트. 환경변수로 덮어쓸 수 있다. */
const DEFAULT_LINK_TABLE_SPREADSHEET_ID = "1CPhWWy5o2jDBaSH3AIDxMsSoLgZeLpU5BZFepu0YKVU";
const SKU_SHEET = "10_SKU조회";
const CACHE_MS = 5 * 60 * 1000;

let cache: { at: number; rows: Record<string, string>[] } | null = null;

async function linkRows() {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.rows;
  const spreadsheetId = process.env.PRODUCT_LINK_TABLE_SPREADSHEET_ID?.trim() || DEFAULT_LINK_TABLE_SPREADSHEET_ID;
  const rows = rowsToObjects(await fetchSheetRows(SKU_SHEET, { spreadsheetId }));
  cache = { at: Date.now(), rows };
  return rows;
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  // 모델명은 앞자리 0까지 정확히 같아야 같은 제품이다 (we00130 ≠ we000130) — 대소문자만 무시한다.
  const model = (params.get("model") || "").trim().toLowerCase();
  const skuIds = new Set(params.getAll("sku").map(normalizeSkuId).filter(Boolean));
  if (!model && !skuIds.size) return NextResponse.json({ folders: [], photoStatus: "" });
  if (!isWmsGoogleSheetsConfigured()) return NextResponse.json({ configured: false, folders: [], photoStatus: "" });

  try {
    const matched = (await linkRows()).filter(row =>
      (model && row["모델명"].toLowerCase() === model) || skuIds.has(normalizeSkuId(row["SKU ID"])));
    const folders = [...new Set(matched.flatMap(row => row["사진폴더(확정)"].split(/\r?\n/).map(path => path.trim()).filter(Boolean)))];
    const photoStatus = [...new Set(matched.map(row => row["사진상태"]).filter(Boolean))].join(", ");
    // 확정 폴더가 여러 모델을 담은 묶음 폴더일 때 하위 폴더를 좁히는 데 쓴다.
    // 모델SKU의 모델번호 부분(예: we011623-1의 모델SKU we011623RG → we011623)도 포함한다.
    // 옵션접미사가 있으면 그것을 떼고, 없으면 앞쪽 "영문+숫자 전체"를 쓴다(숫자는 자르지 않는다).
    const modelKeys = [...new Set(matched.flatMap(row => {
      const modelSku = row["모델SKU"], suffix = row["옵션접미사"];
      const base = suffix && modelSku.toLowerCase().endsWith(suffix.toLowerCase())
        ? modelSku.slice(0, -suffix.length)
        : modelSku.match(/^[a-z]{2,3}\d+/i)?.[0] || "";
      return [row["모델명"], base].map(value => value.trim()).filter(Boolean);
    }))];
    return NextResponse.json({ configured: true, folders, photoStatus, modelKeys });
  } catch (error) {
    return NextResponse.json(
      { configured: true, folders: [], photoStatus: "", error: error instanceof Error ? error.message : "상품 연결표 조회 중 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
