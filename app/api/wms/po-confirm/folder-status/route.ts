import { NextRequest, NextResponse } from "next/server";
import { checkPoConfirmFolderStatus, isPoConfirmFolderAccessible, getPrimaryPoConfirmDir } from "@/lib/wms/po-confirm";

/**
 * 발주번호별 원본파일 자동검색 상태를 다시 조회하는 API (2026-08-20 신규) — "원본파일 다시 확인"
 * 버튼과 화면 최초 진입 시 사용한다. 아무것도 쓰지 않는다. 폴더 자체가 없으면(Google Drive 동기화
 * 안 됨 등) 전체를 개별 오류로 채우지 않고 폴더 수준 안내를 먼저 보여준다.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const poNumbers: string[] = Array.isArray(body.poNumbers) ? body.poNumbers.map((n: unknown) => String(n).trim()).filter(Boolean) : [];

    const folderAccessible = await isPoConfirmFolderAccessible();
    if (!folderAccessible) {
      return NextResponse.json({
        primaryDir: getPrimaryPoConfirmDir(),
        folderAccessible: false,
        entries: poNumbers.map(poNumber => ({ poNumber, status: "missing" as const })),
      });
    }

    const { primaryDir, entries } = await checkPoConfirmFolderStatus(poNumbers);
    return NextResponse.json({ primaryDir, folderAccessible: true, entries });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "원본 파일 상태를 확인하는 중 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
