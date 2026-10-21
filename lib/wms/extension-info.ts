/**
 * NOID-B 크롬 확장 2개의 버전·기능 설명(2026-10-21).
 * 작업센터 '크롬 확장 프로그램' 칸과 각 화면의 '확장 받기' 버튼이 같은 값을 쓴다.
 * 확장을 고쳐 zip을 다시 만들면 여기 version·features도 함께 고친다.
 */
export type ExtensionInfo = { id: string; name: string; version: string; zip: string; where: string; features: string[] };

export const SUPPLIER_HUB_EXTENSION: ExtensionInfo = {
  id: "supplier-hub",
  name: "NOID-B 쉽먼트 확장",
  version: "0.9.13",
  zip: "/downloads/noidb-supplier-hub.zip",
  where: "쿠팡 쉽먼트 화면 위에 'NOID-B 쉽먼트 입고결과' 칸이 생깁니다.",
  features: [
    "입고결과 일괄 가져오기 — 새로 마감된 쉽먼트의 입고결과를 읽어 NOID-B에 저장",
    "이 날짜 Label·내역서 전부 받기 — 한 번에 받고, 다 받으면 NOID-B 출력세트를 자동으로 생성(이미 받은 건 건너뜀)",
    "Label·내역서 PDF는 저장 창 없이 G드라이브 쉽먼트출력세트/입고예정일 폴더에 바로 저장(폴더 없으면 새로 만듦)",
    "저장 폴더 열기 — 고른 입고예정일의 G드라이브 폴더를 새 탭으로 열기",
  ],
};

export const SUPPLIER_SYNC_EXTENSION: ExtensionInfo = {
  id: "supplier-sync",
  name: "NOID-B 서플라이허브 연결",
  version: "1.3.6",
  zip: "/downloads/noidb-supplier-sync.zip",
  where: "NOID-B 화면의 버튼을 누르면 쿠팡 탭을 열어 대신 조회합니다.",
  features: [
    "주간 입고상세내역 자동 가져오기 — 기간의 전체 페이지를 검증해 NOID-B로 전달",
    "WIMS 전체를 NOID-B로 전송 — WIMS 상품등록상태 확인에 사용",
  ],
};

export const NOIDB_EXTENSIONS = [SUPPLIER_HUB_EXTENSION, SUPPLIER_SYNC_EXTENSION];
