/**
 * 2026-11-13 사진선택 화면에서 체크한 사진을, 지금 열어 둔 AI상품등록 화면의 '5. 쿠팡 등록 이미지' 사진 목록 맨 앞에 바로 넣는다.
 * 같은 브라우저의 탭끼리 BroadcastChannel로 주고받는다(서버를 거치지 않음).
 * 등록 화면이 여러 탭이면 가장 최근에 본 탭 하나에만 들어간다.
 */
export const ADD_PHOTOS_CHANNEL = "noidb-add-registration-photos";
export const ACTIVE_REGISTRATION_TAB_KEY = "noidb-active-registration-tab";

export type AddPhotosRequest = { type: "add"; requestId: string; photos: { fileName: string; dataUrl: string }[] };
export type AddPhotosAck = { type: "ack"; requestId: string; added: number; skipped: number };

export function fileToDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}
