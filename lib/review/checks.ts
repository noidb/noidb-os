import { buildQuoteWorkbook, MissingRequiredError } from "@/lib/excel/quote";
import { categoryQuoteOptions } from "@/lib/product-options/quote-options";
import type { ExportPayload } from "@/lib/excel/types";
import type { ReviewCheck, ReviewRecord } from "./types";

type CheckInput = Pick<ReviewRecord, "model" | "summary" | "payload" | "thumbs" | "slots" | "details" | "detailPreviewRef" | "images">;

const MIN_SIDE = 500;

/** 사장님이 하나하나 열어 보지 않아도 되도록 빠진 칸·사진·견적서 문제를 미리 찾는다. */
export async function runReviewChecks(input: CheckInput, otherRecords: ReviewRecord[]): Promise<ReviewCheck[]> {
  const checks: ReviewCheck[] = [];
  const add = (level: ReviewCheck["level"], group: ReviewCheck["group"], text: string) => checks.push({ level, group, text });
  const payload = input.payload as ExportPayload | null;
  const product = payload?.product;
  const summary = input.summary;

  // 1. 기본정보
  const required: [string, string][] = [
    ["거래처", summary.supplier], ["카테고리", summary.category], ["성별", summary.gender], ["소재", product?.material || ""],
    ["색상옵션", summary.colors], ["사이즈", summary.sizes], ["모델명", input.model], ["상품명", summary.title],
    ["주키워드", product?.keyword || ""], ["원가", summary.cost], ["판매가", summary.price],
  ];
  const empty = required.filter(([, value]) => !String(value || "").trim()).map(([name]) => name);
  if (empty.length) add("fail", "기본정보", `빠진 칸: ${empty.join(", ")}`);
  else add("ok", "기본정보", "필수 기본정보가 모두 들어 있습니다.");
  const cost = Number(String(summary.cost || "").replace(/[^\d.]/g, ""));
  const price = Number(String(summary.price || "").replace(/[^\d.]/g, ""));
  if (cost > 0 && price > 0 && price <= cost) add("fail", "기본정보", `판매가(${price.toLocaleString("ko-KR")})가 원가(${cost.toLocaleString("ko-KR")}) 이하입니다.`);
  if (!String(summary.tags || "").trim()) add("warn", "기본정보", "검색태그가 비어 있습니다.");
  if (!String(summary.dimension || "").trim()) add("warn", "기본정보", "치수가 비어 있습니다.");
  if (summary.title && summary.title.length > 100) add("warn", "기본정보", `상품명이 ${summary.title.length}자로 깁니다(100자 이하 권장).`);
  if (!/^[wmu][a-z]+\d{4,}$/.test(input.model)) add("warn", "기본정보", `모델명 '${input.model}' 형식이 평소(예: wr0001)와 다릅니다.`);

  // 2. 쿠팡 양식: 견적서를 실제로 한 번 만들어 보고 비어 있는 필수 칸을 찾는다.
  if (payload && product?.category) {
    try {
      const result = await buildQuoteWorkbook(payload, await categoryQuoteOptions(product.category, false));
      add("ok", "쿠팡 양식", `견적서 미리 만들기 통과 (SKU ${result.skuCount}개).`);
    } catch (error) {
      if (error instanceof MissingRequiredError) add("fail", "쿠팡 양식", `쿠팡 필수 칸이 비어 있습니다: ${error.missing.join(", ")}`);
      else add("fail", "쿠팡 양식", `견적서를 만들지 못했습니다: ${error instanceof Error ? error.message : "알 수 없는 오류"}`);
    }
  } else {
    add("fail", "쿠팡 양식", "카테고리가 없어 견적서를 미리 만들어 볼 수 없습니다.");
  }

  // 3. 이미지
  const missingThumbs = input.thumbs.filter(item => !item.ref).map(item => item.label);
  if (!input.thumbs.length) add("fail", "이미지", "대표 썸네일 칸이 없습니다(색상·사이즈를 확인하세요).");
  else if (missingThumbs.length) add("fail", "이미지", `대표 썸네일이 빠진 옵션 ${missingThumbs.length}개: ${missingThumbs.slice(0, 8).join(", ")}${missingThumbs.length > 8 ? " 외" : ""}`);
  else add("ok", "이미지", `대표 썸네일 ${input.thumbs.length}장이 모두 들어 있습니다.`);
  const present = [...input.thumbs, ...input.slots, ...input.details].filter(item => item.ref);
  const small: string[] = [];
  const notSquare: string[] = [];
  for (const item of [...input.thumbs, ...input.slots].filter(item => item.ref)) {
    const info = input.images[item.ref];
    if (!info) { add("fail", "이미지", `${item.label}: 사진 파일이 서버에 올라가지 않았습니다.`); continue; }
    if (Math.min(info.width, info.height) < MIN_SIDE) small.push(`${item.label}(${info.width}×${info.height})`);
    if (Math.abs(info.width - info.height) / Math.max(info.width, info.height) > 0.02) notSquare.push(`${item.label}(${info.width}×${info.height})`);
  }
  if (small.length) add("fail", "이미지", `쿠팡 최소 ${MIN_SIDE}×${MIN_SIDE}보다 작은 사진: ${small.join(", ")}`);
  if (notSquare.length) add("warn", "이미지", `정사각형이 아닌 사진: ${notSquare.join(", ")}`);
  const filledSlots = input.slots.filter(item => item.ref).length;
  if (!filledSlots) add("warn", "이미지", "추가이미지(전체옵션·상세컷·착용컷 등)가 하나도 없습니다.");
  else add("ok", "이미지", `추가이미지 ${filledSlots}장이 들어 있습니다.`);
  const emptySlots = input.slots.filter(item => !item.ref).map(item => item.label);
  if (filledSlots && emptySlots.length) add("warn", "이미지", `비어 있는 추가이미지 칸: ${emptySlots.join(", ")}`);
  if (!present.length) add("fail", "이미지", "올라온 사진이 한 장도 없습니다.");

  // 4. 상세페이지
  const detailCount = input.details.filter(item => item.ref).length;
  if (!input.detailPreviewRef && !detailCount) add("fail", "상세페이지", "상세페이지 사진이 없습니다.");
  else if (!input.detailPreviewRef) add("warn", "상세페이지", `상세페이지 합성 이미지가 만들어지지 않았습니다(상세 사진 ${detailCount}장은 있음).`);
  else add("ok", "상세페이지", `상세페이지 이미지가 있습니다(상세 사진 ${detailCount}장).`);

  // 5. 중복: 같은 상품명이 다른 모델명으로 이미 검수 요청돼 있는지
  const same = otherRecords.filter(record => record.model !== input.model && summary.title && record.summary.title === summary.title);
  if (same.length) add("warn", "중복", `같은 상품명이 다른 모델(${same.map(record => record.model).join(", ")})에도 있습니다.`);
  return checks;
}
