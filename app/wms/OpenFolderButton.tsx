/**
 * 2026-11-06: 이 PC의 G드라이브 폴더를 탐색기로 연다.
 * 웹 화면은 보안 때문에 탐색기를 직접 열 수 없어서, PC마다 '설정 파일(.reg)'을 한 번 설치해 두고
 * noidbreorder:// 같은 폴더 전용 주소를 누르면 윈도우가 정해진 폴더만 연다(주소로 경로를 받지 않아 안전).
 * 설정 파일: public/noidb-folder-install.reg (폴더를 더 늘릴 때 이 파일과 아래 FOLDER_PROTOCOLS를 같이 고친다).
 */
export const FOLDER_PROTOCOLS = {
  output: { protocol: "noidbfolder", path: "쿠팡데이터\\쉽먼트업로드완성\\쉽먼트출력세트" },
  reorder: { protocol: "noidbreorder", path: "쿠팡데이터\\제품관리\\미납sku재발주" },
  discontinue: { protocol: "noidbdiscontinue", path: "쿠팡데이터\\단종 및 해제" },
  coupon: { protocol: "noidbcoupon", path: "쿠팡데이터\\마케팅\\쿠폰관리" },
} as const;

export type FolderKey = keyof typeof FOLDER_PROTOCOLS;

export function OpenFolderButton({ folder, label = "폴더 열기", className = "softSageButton", style }: {
  folder: FolderKey;
  label?: string;
  className?: string;
  style?: React.CSSProperties;
}) {
  const target = FOLDER_PROTOCOLS[folder];
  return (
    <a
      href={`${target.protocol}://open`}
      className={className}
      title={`G:\\내 드라이브\\${target.path} 폴더를 탐색기로 엽니다.`}
      style={{ textDecoration: "none", boxSizing: "border-box", display: "inline-flex", alignItems: "center", justifyContent: "center", ...style }}
    >
      {label}
    </a>
  );
}

/** 폴더 열기가 안 열릴 때 쓰는 '처음 한 번' 설정 파일 받기 링크. */
export function FolderInstallLink() {
  return (
    <a href="/noidb-folder-install.reg" download="폴더열기_설치.reg" style={{ fontSize: 12, color: "#6b6b6b" }}>
      폴더 열기가 안 되면: 설정 파일 받아 더블클릭 (PC마다 한 번)
    </a>
  );
}
