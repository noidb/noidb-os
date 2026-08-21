import { NextResponse } from "next/server";
import { isDriveOAuthConfigured } from "@/lib/wms/google-drive-oauth";
import { getStoredRefreshToken, getConnectedAt, getStoredFolderId, hasEnvRefreshToken } from "@/lib/wms/google-drive-oauth-store";

/**
 * Google Drive OAuth 연결 상태만 반환한다. client secret, refresh token, access token은
 * 절대 이 응답에 포함하지 않는다(2026-08-20 신규).
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const configured = isDriveOAuthConfigured();
  const refreshToken = configured ? await getStoredRefreshToken() : null;
  const connected = Boolean(refreshToken);
  const connectedAt = connected ? await getConnectedAt() : null;
  const folderId = connected ? (process.env.GOOGLE_DRIVE_UPLOAD_FOLDER_ID?.trim() || (await getStoredFolderId())) : null;

  return NextResponse.json({
    configured,
    connected,
    connectedAt,
    folderReady: Boolean(folderId),
    usingEnvRefreshToken: connected && hasEnvRefreshToken(),
  }, { headers: { "Cache-Control": "no-store" } });
}
