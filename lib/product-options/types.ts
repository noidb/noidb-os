/**
 * 상품등록 화면의 선택 목록(거래처·카테고리·성별·소재)과 카테고리별 쿠팡 양식 설정 (2026-10-27).
 * 사용자가 화면에서 직접 항목을 추가·관리하고, 새 카테고리는 쿠팡 양식 파일을 올려 등록 엑셀까지 만든다.
 * 이 파일은 화면(브라우저)과 서버 양쪽에서 쓰므로 node 전용 모듈을 넣지 않는다.
 */

export type CategoryTemplateRef = {
  /** 저장소(Blob) 경로. 기본 제공 양식(templates 폴더)을 쓰면 비어 있다. */
  blobPath: string;
  fileName: string;
  uploadedAt: string;
};

export type CategoryConfig = {
  name: string;
  /** 모델명 가운데 글자. 반지 r → wr0001(여성)·mr0001(남성)·ur0001(남녀공용). */
  letter: string;
  /** 사용자가 올린 쿠팡 양식. 없으면 기본 제공 양식(있을 때)을 쓴다. */
  template?: CategoryTemplateRef;
  /** 성별 → 쿠팡 카테고리 경로. 비어 있으면 기본값(기본 카테고리) 또는 양식의 첫 경로. */
  paths?: Record<string, string>;
  /** 쿠팡 양식 칸 이름 → 기본값. 사이트가 채우지 못한 빈 칸에만 들어간다. */
  defaults?: Record<string, string>;
};

export type ProductOptionsConfig = {
  version: 1;
  suppliers: string[];
  /** 구글시트에서 읽어온 거래처 중 사용자가 목록에서 지운 것 */
  removedSuppliers: string[];
  categories: CategoryConfig[];
  genders: string[];
  materials: string[];
  updatedAt?: string;
};

export type TemplateField = {
  header: string;
  column: string;
  group: string;
  required: boolean;
  description: string;
  example: string;
  choices: string[];
  /** 사이트가 자동으로 채우는 칸 */
  siteFilled: boolean;
};

export type TemplateInfo = {
  fileName: string;
  sheetName: string;
  categoryPaths: string[];
  fields: TemplateField[];
};

export type OptionListKey = "suppliers" | "genders" | "materials";
