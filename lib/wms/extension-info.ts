/**
 * NOID-B 크롬 확장 2개의 버전·기능 설명(2026-10-21).
 * 작업센터 '크롬 확장 프로그램' 칸과 각 화면의 '확장 받기' 버튼이 같은 값을 쓴다.
 * 확장을 고쳐 zip을 다시 만들면 여기 version·features도 함께 고친다.
 */
export type ExtensionInfo = { id: string; name: string; version: string; zip: string; where: string; features: string[] };

export const SUPPLIER_HUB_EXTENSION: ExtensionInfo = {
  id: "supplier-hub",
  name: "NOID-B 쉽먼트 확장",
  version: "0.9.14",
  zip: "/downloads/noidb-supplier-hub.zip",
  where: "",
  features: ["입고결과 가져오기", "쉽먼트 PDF 다운로드(쿠팡 목록 쪽 자동 넘김)", "출력세트 생성"],
};

export const SUPPLIER_SYNC_EXTENSION: ExtensionInfo = {
  id: "supplier-sync",
  name: "NOID-B 서플라이허브 연결",
  version: "1.3.6",
  zip: "/downloads/noidb-supplier-sync.zip",
  where: "",
  features: ["상품등록상태 가져오기"],
};

export const NOIDB_EXTENSIONS = [SUPPLIER_HUB_EXTENSION, SUPPLIER_SYNC_EXTENSION];
