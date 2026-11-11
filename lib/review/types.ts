/**
 * 2026-11-11 상품등록 검수: 다른 사용자가 AI상품등록에서 '검수 요청'을 하면 입력 내용과 사진을 서버에 올리고,
 * 사장님이 검수 화면에서 자동 검사 결과와 사진을 보고 검수완료·보완요청을 한다.
 */
export type ReviewStatus = "pending" | "approved" | "revise";

export type ReviewImageRef = { label: string; ref: string };
export type ReviewImageInfo = { width: number; height: number; bytes: number };

export type ReviewCheck = {
  /** ok: 통과, warn: 확인 필요, fail: 고쳐야 함 */
  level: "ok" | "warn" | "fail";
  group: "기본정보" | "쿠팡 양식" | "이미지" | "상세페이지" | "중복";
  text: string;
};

export type ReviewSummary = {
  title: string;
  category: string;
  gender: string;
  supplier: string;
  colors: string;
  sizes: string;
  cost: string;
  price: string;
  tags: string;
  dimension: string;
};

export type ReviewRecord = {
  model: string;
  submittedAt: string;
  status: ReviewStatus;
  memo: string;
  reviewedAt?: string;
  summary: ReviewSummary;
  /** 견적서 미리 만들어 보기용(사진 값은 넣지 않는다) */
  payload: unknown;
  /** 썸네일 칸마다 사진이 있는지(ref가 비어 있으면 빠진 칸) */
  thumbs: ReviewImageRef[];
  /** 추가이미지·착용컷 등 이름 붙은 칸 */
  slots: ReviewImageRef[];
  /** 상세페이지에 들어가는 사진 */
  details: ReviewImageRef[];
  detailPreviewRef: string;
  images: Record<string, ReviewImageInfo>;
  /** 임시저장 내용 전체(사진은 'review-img:<ref>' 표시로 바뀐 상태). 사장님이 그대로 열어 이어서 작업한다. */
  data: unknown;
  checks: ReviewCheck[];
  checkedAt: string;
};

export type ReviewListItem = Pick<ReviewRecord, "model" | "submittedAt" | "status" | "memo" | "reviewedAt" | "summary"> & {
  failCount: number;
  warnCount: number;
};

export const IMAGE_MARK = "review-img:";
