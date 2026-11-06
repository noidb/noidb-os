import { downloadOAuthDriveFile, listOAuthDriveFolderFiles, resolveDriveFolderPath } from "./google-drive-oauth-reader";
import { mergeSettlementInbound, parseSettlementInboundBuffer, type SettlementInboundFileInput, type SettlementInboundStore } from "./settlement-inbound";

/** 사용자가 정산 '입고상세내역' 엑셀을 넣어 두는 Drive 폴더(2026-11-06). 읽기 전용. */
export const SETTLEMENT_INBOUND_DRIVE_PATH = ["쿠팡데이터", "입고상세내역"];

/**
 * 폴더 목록만 확인해 새로 생기거나 바뀐 .xlsx만 내려받아 읽는다. 바뀐 게 없으면 `store`를 그대로 돌려준다(changed=false).
 * 실패해도 던지지 않고 error 문구만 돌려줘, 화면은 마지막 저장본으로 계속 동작한다.
 */
export async function syncSettlementInboundFromDrive(previous: SettlementInboundStore | undefined, now: string): Promise<{ store?: SettlementInboundStore; changed: boolean; error?: string }> {
  try {
    const folderId = await resolveDriveFolderPath(SETTLEMENT_INBOUND_DRIVE_PATH);
    const files = (await listOAuthDriveFolderFiles(folderId)).filter(f => f.name.toLowerCase().endsWith(".xlsx") && !f.name.startsWith("~$"));
    const signatures = Object.fromEntries(files.map(f => [f.id, { name: f.name, signature: f.md5Checksum || `${f.modifiedTime}|${f.size}` }]));
    const changedFiles = files.filter(f => previous?.files?.[f.id]?.signature !== signatures[f.id].signature);
    if (!changedFiles.length) return { store: previous, changed: false };
    const inputs: SettlementInboundFileInput[] = [];
    for (const file of changedFiles) {
      inputs.push({ id: file.id, name: file.name, signature: signatures[file.id].signature, rows: await parseSettlementInboundBuffer(await downloadOAuthDriveFile(file.id)) });
    }
    return { store: mergeSettlementInbound(previous, inputs, now, signatures), changed: true };
  } catch (error) {
    return { store: previous, changed: false, error: error instanceof Error ? error.message : "입고상세내역 폴더를 읽지 못했습니다." };
  }
}
