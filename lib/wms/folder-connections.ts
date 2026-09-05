import { getStoredRefreshToken } from "./google-drive-oauth-store";

export interface WmsFolderConnectionStatus {
  key: string;
  label: string;
  description: string;
  connected: boolean;
}

function configured(...names: string[]) {
  return names.some(name => Boolean(process.env[name]?.trim()));
}

/** 비밀값이나 내부 환경변수명은 반환하지 않고 사용자용 연결 상태만 만든다. */
export async function getWmsFolderConnectionStatuses(): Promise<WmsFolderConnectionStatus[]> {
  const userDriveConnected = Boolean(await getStoredRefreshToken());
  return [
    { key: "purchase-order-source", label: "발주서 원본 폴더", description: "새 ZIP·XLSX 자동 확인", connected: configured("GOOGLE_DRIVE_COUPANG_PURCHASE_ORDER_FOLDER_ID") },
    { key: "po-template", label: "발주서 업로드양식 폴더", description: "발주번호에 맞는 양식 자동 탐색", connected: configured("GOOGLE_DRIVE_PO_FOR_CONFIRM_FOLDER_ID") },
    { key: "po-completed", label: "발주서 업로드완성 폴더", description: "확정수량 파일 자동 연결", connected: configured("GOOGLE_DRIVE_PO_CONFIRMED_QUANTITY_FOLDER_ID", "GOOGLE_DRIVE_CONFIRMED_ORDER_FOLDER_ID") },
    { key: "hanjin", label: "한진 송장파일 폴더", description: "현재 발주 묶음과 정확히 맞는 결과파일 탐색", connected: configured("GOOGLE_DRIVE_HANJIN_SHIPMENT_FOLDER_ID") },
    { key: "shipment-upload", label: "Shipment 업로드완성 폴더", description: "Shipment 생성파일 자동 저장", connected: configured("GOOGLE_DRIVE_SHIPMENT_UPLOAD_FOLDER_ID") },
    { key: "shipment-output", label: "Shipment 출력세트 폴더", description: "출력세트 자동 저장 및 재출력", connected: configured("GOOGLE_DRIVE_SHIPMENT_OUTPUT_FOLDER_ID") },
    { key: "discontinue", label: "단종 및 해제 폴더", description: "실제 양식 탐색과 생성파일 저장", connected: configured("GOOGLE_DRIVE_DISCONTINUE_FOLDER_ID") },
    { key: "inbound", label: "입고상세내역 폴더", description: "새 입고파일 증분 분석", connected: userDriveConnected },
    { key: "coupon", label: "쿠폰관리 폴더", description: "쿠폰·미입고 파일 자동 저장", connected: configured("GOOGLE_DRIVE_COUPON_FOLDER_ID") },
  ];
}
