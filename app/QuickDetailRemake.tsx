"use client";

import { ChangeEvent, DragEvent, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { extendToSquareCanvas } from "@/lib/thumbnail/fit";
import { readImageFile, shrinkForUpload, splitDetailPage, type QuickDetailColor, type QuickDetailSection, type QuickDetailStyle } from "@/lib/image-generator/quick-detail";
import { deleteQuickDraft, listQuickDrafts, MAX_QUICK_DRAFTS, saveQuickDraft, type QuickDetailDraft } from "@/lib/image-generator/quick-drafts";
import styles from "./quick-detail.module.css";

const STYLE_OPTIONS: Array<{ value: QuickDetailStyle; title: string; description: string }> = [
  { value: "clean", title: "밝은 주얼리 화이트", description: "밝고 깨끗한 쇼핑몰 제품사진 분위기" },
  { value: "ivory", title: "고급 아이보리", description: "따뜻하고 부드러운 고급 주얼리 분위기" },
  { value: "modern", title: "모던 그레이", description: "차분하고 세련된 현대적인 분위기" },
];

/** 제품 컬러 견본. swatch는 화면에 보이는 동그란 색(금속 느낌의 그라데이션). */
const COLOR_OPTIONS: Array<{ value: QuickDetailColor; title: string; swatch: string }> = [
  { value: "original", title: "원본 유지", swatch: "#ffffff" },
  { value: "rosegold", title: "로즈골드", swatch: "linear-gradient(135deg,#f3d2c4,#d9a28f)" },
  { value: "silver", title: "실버", swatch: "linear-gradient(135deg,#f2f3f4,#b9bcc0)" },
  { value: "gold", title: "골드", swatch: "linear-gradient(135deg,#f3e2a6,#d4b04a)" },
];

type Result = { dataUrl: string; sectionCount: number; width: number; height: number };
type CutHole = { from: number; to: number };
type CutSnapshot = { top: number; bottom: number; holes: CutHole[] };
/** holes: 가운데 잘라내기로 뺄 구간(0~1 비율). holeStart: 가운데 잘라내기에서 첫 번째 클릭 위치. */
type CutState = { dataUrl: string; name: string; top: number; bottom: number; holes: CutHole[]; holeStart: number | null; mode: "top" | "bottom" | "hole"; history: CutSnapshot[] };

/** 가운데 구간을 빼낼 때 사진 사이에 남기는 간격. 상세페이지 만들기의 기본 간격(780px 기준 90px)과 같은 비율. */
const HOLE_GAP_PER_780 = 90;

/** 위·아래 자름선 안쪽에서 holes 구간을 뺀 나머지 조각들. */
function keptRanges(top: number, bottom: number, holes: CutHole[]): Array<[number, number]> {
  const sorted = holes
    .map(hole => ({ from: Math.max(top, hole.from), to: Math.min(bottom, hole.to) }))
    .filter(hole => hole.to > hole.from)
    .sort((a, b) => a.from - b.from);
  const ranges: Array<[number, number]> = [];
  let cursor = top;
  for (const hole of sorted) {
    if (hole.from > cursor) ranges.push([cursor, hole.from]);
    cursor = Math.max(cursor, hole.to);
  }
  if (cursor < bottom) ranges.push([cursor, bottom]);
  return ranges;
}

/** 2026-11-17 5번 목록에 넣는 정사각형 크기. 예전엔 1000px로 고정해 큰 원본도 작게 줄어 확대하면 깨졌다. 원본 긴 변을 따르되 1000~2000px로 한다(원본보다 키우지는 않는다). */
async function listSquareSize(dataUrl: string): Promise<number> {
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error("사진을 불러오지 못했습니다."));
      element.src = dataUrl;
    });
    return Math.max(1000, Math.min(2000, Math.max(image.naturalWidth, image.naturalHeight)));
  } catch {
    return 1000;
  }
}

type Props = {
  headerUrl: string;
  footerUrl: string;
  modelName: string;
  incomingFile: File | null;
  incomingToken: number;
  onComplete: (result: { dataUrl: string; sections: QuickDetailSection[]; logoApplied?: boolean }) => void;
  /** slotKey가 있으면 그 사진은 목록이 아니라 해당 칸(같은 칸)으로 들어간다. */
  onAddToList: (items: Array<{ fileName: string; dataUrl: string; source: string; kind?: "product" | "wear"; slotKey?: string }>) => void;
  /** 2026-11-17 칸의 [AI 편집] 버튼: 고른 칸 사진을 바로 가져와 AI 편집까지 시작한다. 결과는 slotKey 칸으로 돌아간다. */
  request?: { token: number; images: Array<{ dataUrl: string; name: string; slotKey?: string }> } | null;
  /** 2026-11-17 "사진별 확인"을 그릴 자리(요소 id). 칸 아래에 두려고 쓴다. 없으면 이 자리에 그대로 그린다. */
  reviewHostId?: string;
  /** 5번 쿠팡 등록이미지(목록·칸)의 사진. 상세페이지 없이 여기서 골라 바로 AI 편집을 시작할 수 있다. */
  poolImages?: Array<{ dataUrl: string; fileName: string }>;
};

/** 2026-11-04 쿠팡은 상세페이지 가로 780px 미만을 반려한다. 기존 상세페이지를 자르거나 로고를 붙인 결과가 더 좁으면 780px로 키운다(780 이상이면 그대로). */
const MIN_DETAIL_WIDTH = 780;
export async function ensureMinWidth(dataUrl: string): Promise<string> {
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const element = new Image();
    element.onload = () => resolve(element);
    element.onerror = () => reject(new Error("상세페이지를 불러오지 못했습니다."));
    element.src = dataUrl;
  });
  if (image.naturalWidth >= MIN_DETAIL_WIDTH) return dataUrl;
  const canvas = document.createElement("canvas");
  canvas.width = MIN_DETAIL_WIDTH;
  canvas.height = Math.max(1, Math.round(image.naturalHeight * MIN_DETAIL_WIDTH / image.naturalWidth));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("캔버스를 만들 수 없습니다.");
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.97);
}

/**
 * 2026-11-11 '밝은 주얼리 화이트' 전용 자동 보정.
 * 사진에서 "밝고 색이 거의 없는 부분"(흰 배경·흰 옷·금속 하이라이트)을 흰색 기준으로 삼아,
 * 사진이 전체적으로 어둡거나 살짝 누런·분홍빛이면 조금 밝게 하고 색 쏠림을 줄인다.
 * 제품 금속색이 변하지 않도록 보정 폭은 작게 제한한다(밝기 최대 6%, 색 쏠림 최대 6%).
 * 분홍 배경·분홍 옷처럼 AI가 실제로 그려 넣은 색은 이 보정으로 바뀌지 않는다(그건 AI 지시문이 담당).
 * 어떤 오류가 나도 원본 AI 사진을 그대로 돌려주므로 작업이 멈추지 않는다.
 */
export async function brightenWhiteBalance(dataUrl: string): Promise<string> {
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error("사진을 불러오지 못했습니다."));
      element.src = dataUrl;
    });
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx || !canvas.width || !canvas.height) return dataUrl;
    ctx.drawImage(image, 0, 0);
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const px = imageData.data;
    const total = px.length / 4;
    // 1) 흰색 기준 후보: 밝고(휘도 150 이상) 색이 거의 없는(채도 38 이하) 픽셀. 피부는 색이 진해서 제외된다.
    const histogram = new Array<number>(256).fill(0);
    let candidates = 0;
    for (let i = 0; i < px.length; i += 4) {
      const r = px[i], g = px[i + 1], b = px[i + 2];
      const luma = 0.299 * r + 0.587 * g + 0.114 * b;
      if (luma >= 150 && Math.max(r, g, b) - Math.min(r, g, b) <= 38) {
        histogram[Math.round(luma)] += 1;
        candidates += 1;
      }
    }
    if (candidates < total * 0.02) return dataUrl;
    // 2) 후보 중 더 밝은 절반의 평균 색을 흰색 기준으로 삼는다.
    let seen = 0;
    let cut = 150;
    for (let v = 0; v < 256; v += 1) {
      seen += histogram[v];
      if (seen >= candidates / 2) { cut = v; break; }
    }
    let sumR = 0, sumG = 0, sumB = 0, count = 0;
    for (let i = 0; i < px.length; i += 4) {
      const r = px[i], g = px[i + 1], b = px[i + 2];
      const luma = 0.299 * r + 0.587 * g + 0.114 * b;
      if (luma >= cut && Math.max(r, g, b) - Math.min(r, g, b) <= 38) { sumR += r; sumG += g; sumB += b; count += 1; }
    }
    if (!count) return dataUrl;
    const ref = [sumR / count, sumG / count, sumB / count];
    const refMean = (ref[0] + ref[1] + ref[2]) / 3;
    const refChroma = Math.max(...ref) - Math.min(...ref);
    // 3) 배율 계산. 이미 밝고 색 쏠림이 적으면(일부러 고른 연한 베이지·회색 배경 포함) 색은 두고 밝기만 올린다.
    const clamp = (value: number, max: number) => Math.min(max, Math.max(1, value));
    const gains = Math.min(...ref) >= 225 && refChroma <= 20
      ? [clamp(250 / refMean, 1.06), clamp(250 / refMean, 1.06), clamp(250 / refMean, 1.06)]
      : ref.map(channel => clamp(250 / channel, 1.06));
    if (gains.every(gain => gain < 1.005)) return dataUrl;
    for (let i = 0; i < px.length; i += 4) {
      px[i] = Math.min(255, px[i] * gains[0]);
      px[i + 1] = Math.min(255, px[i + 1] * gains[1]);
      px[i + 2] = Math.min(255, px[i + 2] * gains[2]);
    }
    ctx.putImageData(imageData, 0, 0);
    return canvas.toDataURL("image/jpeg", 0.97);
  } catch {
    return dataUrl;
  }
}

async function cropDataUrl(dataUrl: string, top: number, bottom: number, holes: CutHole[] = []): Promise<string> {
  return ensureMinWidth(await cropDataUrlRaw(dataUrl, top, bottom, holes));
}

async function cropDataUrlRaw(dataUrl: string, top: number, bottom: number, holes: CutHole[] = []): Promise<string> {
  if (top <= 0 && bottom >= 1 && !holes.length) return dataUrl;
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const element = new Image();
    element.onload = () => resolve(element);
    element.onerror = () => reject(new Error("상세페이지를 불러오지 못했습니다."));
    element.src = dataUrl;
  });
  const ranges = keptRanges(top, bottom, holes).map(([from, to]) => {
    const y = Math.round(image.naturalHeight * from);
    return { y, h: Math.max(1, Math.round(image.naturalHeight * to) - y) };
  });
  if (!ranges.length) throw new Error("사용할 구간이 없습니다. 가운데 잘라내기를 되돌려주세요.");
  // 빼낸 자리에는 사이트 기본 간격(흰색)을 한 번만 넣는다.
  const gap = ranges.length > 1 ? Math.round(image.naturalWidth * HOLE_GAP_PER_780 / 780) : 0;
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = ranges.reduce((sum, range) => sum + range.h, 0) + gap * (ranges.length - 1);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("캔버스를 만들 수 없습니다.");
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  let offset = 0;
  for (const range of ranges) {
    ctx.drawImage(image, 0, range.y, image.naturalWidth, range.h, 0, offset, image.naturalWidth, range.h);
    offset += range.h + gap;
  }
  return canvas.toDataURL("image/jpeg", 0.97);
}

// 위를 잘라 로고가 없어진 상세페이지 맨 위에 6번 상단 로고 이미지를 같은 폭으로 붙인다(6번 상단 로고 칸의 "상세페이지 사용").
export async function prependHeader(dataUrl: string, headerUrl: string): Promise<string> {
  return ensureMinWidth(await prependHeaderRaw(dataUrl, headerUrl));
}

async function prependHeaderRaw(dataUrl: string, headerUrl: string): Promise<string> {
  const load = (src: string) => new Promise<HTMLImageElement>((resolve, reject) => {
    const element = new Image();
    element.onload = () => resolve(element);
    element.onerror = () => reject(new Error("상단 로고 이미지를 불러오지 못했습니다."));
    element.src = src;
  });
  const [page, header] = await Promise.all([load(dataUrl), load(headerUrl)]);
  const width = page.naturalWidth;
  const headerHeight = Math.round(header.naturalHeight * (width / header.naturalWidth));
  // 새로 만드는 상세페이지와 같은 비율(780px 기준 90px)로 로고 아래 여백을 둔다.
  const gap = Math.round(width * 90 / 780);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = headerHeight + gap + page.naturalHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("캔버스를 만들 수 없습니다.");
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(header, 0, 0, width, headerHeight);
  ctx.drawImage(page, 0, headerHeight + gap);
  return canvas.toDataURL("image/jpeg", 0.97);
}

function newDraftId() {
  return `quick-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** 아직 제품컷·착용컷을 구분하지 않은 사진의 표시. AI 편집을 시작할 때 이 표시가 있는 사진만 자동으로 구분한다. */
const UNSORTED_REASON = "직접 확인해주세요.";

type WearLook = { skin: string; eyes: string; hair: string; clothing: string; background: string };

const WEAR_LOOK_OPTIONS: { skin: string[]; eyes: string[]; hair: string[]; clothing: string[]; background: string[] } = {
  skin: ["light warm-ivory skin tone with a soft peach undertone", "fair neutral skin tone with a faint rosy undertone", "light beige skin tone with a gentle golden undertone"],
  eyes: ["soft dark-brown eyes with a natural almond shape", "warm hazel-brown eyes with a gentle natural shape"],
  hair: ["soft chestnut brown", "natural dark brown", "warm medium brown", "soft espresso brown"],
  clothing: ["cream", "ivory", "pale pink", "light beige"],
  background: ["soft cream", "pale ivory", "light warm gray", "pale pink-beige"],
};

/** '밝은 주얼리 화이트' 전용: 피부는 밝고 중립적으로(분홍·피치·베이지 기운 없이), 옷은 거의 흰색, 배경은 흰색. */
const CLEAN_WEAR_LOOK_OPTIONS: typeof WEAR_LOOK_OPTIONS = {
  skin: ["bright fair neutral skin tone, clean and luminous, with no pink, peach or beige cast", "light fair skin tone with a very faint neutral undertone, bright and even"],
  eyes: WEAR_LOOK_OPTIONS.eyes,
  hair: WEAR_LOOK_OPTIONS.hair,
  clothing: ["pure white", "soft white", "off-white"],
  background: ["pure white"],
};

function pickOne<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

function makeWearLook(style: QuickDetailStyle = "clean"): WearLook {
  const options = style === "clean" ? CLEAN_WEAR_LOOK_OPTIONS : WEAR_LOOK_OPTIONS;
  return {
    skin: pickOne(options.skin),
    eyes: pickOne(options.eyes),
    hair: pickOne(options.hair),
    clothing: pickOne(options.clothing),
    background: pickOne(options.background),
  };
}

export default function QuickDetailRemake({ headerUrl, footerUrl, modelName, incomingFile, incomingToken, onComplete, onAddToList, request = null, reviewHostId, poolImages = [] }: Props) {
  const [pickingPool, setPickingPool] = useState(false);
  /** 이미 5번 목록에 넣은 AI 사진 — "이어서 만들기"를 다시 눌러도 같은 사진이 두 번 들어가지 않게 한다. */
  const alreadyAdded = useRef(new Set<string>());
  /** 같은 상세페이지의 착용컷은 모두 같은 모델 느낌(머리색·피부·옷·배경)이 되도록 한 번만 정해서 계속 쓴다. */
  const wearLookRef = useRef<WearLook | null>(null);
  const [pickedPool, setPickedPool] = useState<string[]>([]);
  /** 가져온 사진(구역 id) → 결과를 돌려줄 칸 이름. 칸의 [AI 편집]으로 시작했을 때만 채워진다. */
  const slotKeyBySection = useRef<Record<string, string>>({});
  const [autoRun, setAutoRun] = useState(false);
  // 2026-11-17 "사진별 확인"을 칸 아래(reviewHostId 자리)에 그린다.
  const [reviewHost, setReviewHost] = useState<HTMLElement | null>(null);
  useEffect(() => { setReviewHost(reviewHostId ? document.getElementById(reviewHostId) : null); }, [reviewHostId]);
  // 2026-11-17 AI 편집 중단하기: 진행 중인 요청을 끊고, 남은 사진은 보내지 않는다. 끝난 사진은 보관된다.
  const [editing, setEditing] = useState(false);
  const [stopping, setStopping] = useState(false);
  const stopRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const [draftId, setDraftId] = useState("");
  const [drafts, setDrafts] = useState<QuickDetailDraft[]>([]);
  const [draftsReady, setDraftsReady] = useState(false);
  const deletedDraftIdsRef = useRef(new Set<string>());
  const [dragging, setDragging] = useState(false);
  const [cut, setCut] = useState<CutState | null>(null);
  const [source, setSource] = useState("");
  const [sourceName, setSourceName] = useState("");
  const [style, setStyle] = useState<QuickDetailStyle>("clean");
  const [color, setColor] = useState<QuickDetailColor>("original");
  const [originalSections, setOriginalSections] = useState<QuickDetailSection[]>([]);
  const [editedSections, setEditedSections] = useState<QuickDetailSection[]>([]);
  const [sectionActions, setSectionActions] = useState<Record<string, "edit" | "original">>({});
  const [finalSections, setFinalSections] = useState<QuickDetailSection[]>([]);
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  // 사진별 확인에서 사진을 누르면 크게 보는 창(몇 번째 사진인지, 닫혀 있으면 null)
  const [zoomIndex, setZoomIndex] = useState<number | null>(null);
  const zoomCountRef = useRef(0);
  useEffect(() => {
    if (zoomIndex === null) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setZoomIndex(null);
      else if (event.key === "ArrowLeft") setZoomIndex(current => current === null ? null : Math.max(0, current - 1));
      else if (event.key === "ArrowRight") setZoomIndex(current => current === null ? null : Math.min(zoomCountRef.current - 1, current + 1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [zoomIndex]);
  // 2026-11-17 AI로 편집할 사진 고르기에서도 사진을 누르면 크게 본다(선택은 사진 왼쪽 위 원을 눌러서).
  const [poolZoomIndex, setPoolZoomIndex] = useState<number | null>(null);
  const poolZoomCountRef = useRef(0);
  useEffect(() => {
    if (poolZoomIndex === null) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPoolZoomIndex(null);
      else if (event.key === "ArrowLeft") setPoolZoomIndex(current => current === null ? null : Math.max(0, current - 1));
      else if (event.key === "ArrowRight") setPoolZoomIndex(current => current === null ? null : Math.min(poolZoomCountRef.current - 1, current + 1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [poolZoomIndex]);
  const [progress, setProgress] = useState(0);
  const [scanSummary, setScanSummary] = useState<{ found: number; kept: number; excluded: number } | null>(null);
  const [message, setMessage] = useState("상세페이지를 올리거나, 등록이미지에서 사진을 골라주세요.");
  const expectedEdits = originalSections.filter(section => (sectionActions[section.id] || "edit") === "edit").length;
  const completedEdits = editedSections.filter(section => originalSections.some(original => original.id === section.id) && (sectionActions[section.id] || "edit") === "edit").length;
  const editedById = useMemo(() => new Map(editedSections.map(section => [section.id, section])), [editedSections]);
  // 2026-11-18 체크한(편집할) 사진 중 아직 AI 편집이 안 끝난 사진 수. 3번 "AI 편집 시작"은 이 사진들만 편집한다.
  const pendingCount = originalSections.filter(section => (sectionActions[section.id] || "edit") === "edit" && !editedById.has(section.id)).length;
  const [addedVersion, setAddedVersion] = useState(0);
  // 지금 보이는 사진(AI 편집본이 있으면 편집본, 아니면 원본) 중 아직 5번 등록이미지 목록에 안 들어간 것만 센다.
  const pendingAddCount = useMemo(() => {
    void addedVersion;
    return originalSections.filter(section => {
      const edited = editedById.get(section.id);
      const source = sectionActions[section.id] !== "original" && edited ? edited.dataUrl : section.dataUrl;
      return !alreadyAdded.current.has(source);
    }).length;
  }, [originalSections, editedById, sectionActions, addedVersion]);

  useEffect(() => {
    void listQuickDrafts().then(items => { setDrafts(items); setDraftsReady(true); }).catch(() => setDraftsReady(true));
  }, []);

  // AI 편집은 비용이 들기 때문에 진행 중인 작업을 이 PC에 자동으로 보관한다.
  useEffect(() => {
    if (!draftsReady || !originalSections.length) return;
    const timeout = window.setTimeout(() => {
      const id = draftId || newDraftId();
      if (deletedDraftIdsRef.current.has(id)) return;
      if (!draftId) setDraftId(id);
      const draft: QuickDetailDraft = {
        id, savedAt: new Date().toISOString(), modelName, source, sourceName, headerUrl: "", headerName: "", footerUrl: "", footerName: "",
        style, color, originalSections, editedSections, finalSections, sectionActions, result, scanSummary,
        preview: editedSections[0]?.dataUrl || originalSections[0]?.dataUrl || source,
      };
      void saveQuickDraft(draft).then(items => setDrafts(items)).catch(() => undefined);
    }, 700);
    return () => window.clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftsReady, draftId, source, sourceName, modelName, style, color, originalSections, editedSections, finalSections, sectionActions, result, scanSummary]);

  useEffect(() => {
    if (incomingFile) void startUpload(incomingFile);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incomingToken]);

  const panelRef = useRef<HTMLDivElement>(null);

  function resetWork() {
    wearLookRef.current = null;
    setOriginalSections([]);
    setEditedSections([]);
    setSectionActions({});
    setFinalSections([]);
    setResult(null);
    setProgress(0);
    setScanSummary(null);
  }

  async function startUpload(file: File) {
    if (!file.type.startsWith("image/")) {
      setMessage("JPG, PNG 또는 WEBP 이미지 파일을 올려주세요.");
      return;
    }
    try {
      const dataUrl = await readImageFile(file);
      setCut({ dataUrl, name: file.name, top: 0, bottom: 1, holes: [], holeStart: null, mode: "top", history: [] });
      setMessage("자를 부분이 있으면 위·아래 위치를 클릭해 정한 뒤, 그대로 상세페이지에 쓸지 사진별로 나눌지 선택하세요.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "이미지를 불러오지 못했습니다.");
    }
  }

  async function classifyKinds(sections: QuickDetailSection[], kindOnly = false) {
    const kinds = new Map<string, { kind: "product" | "wear"; reason: string }>();
    try {
      // 2026-11-18 칸에서 가져온 사진은 6000×4000(10MB 이상)도 있어, 그대로 보내면 서버가 받지 못해 전부 제품컷으로 처리됐다.
      // 구분에는 큰 사진이 필요 없으므로 작게 줄여서 보내고, 한 번에 보내는 장수도 줄인다.
      const step = kindOnly ? 4 : 8;
      for (let offset = 0; offset < sections.length; offset += step) {
        const batch = await Promise.all(sections.slice(offset, offset + step).map(async section => kindOnly ? { ...section, dataUrl: await shrinkForUpload(section.dataUrl, 768, 0.8) } : section));
        setMessage(`${sections.length}장의 제품컷·착용컷 구분을 확인하고 있습니다.`);
        const response = await fetch("/api/image-generator/quick-analyze", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sections: batch, mode: kindOnly ? "kind" : undefined }) });
        const data = await response.json() as { decisions?: Array<{ id: string; keep: boolean; kind: "product" | "wear" | "exclude"; reason: string }>; error?: string };
        if (!response.ok || !data.decisions) throw new Error(data.error || "구분하지 못했습니다.");
        for (const decision of data.decisions) if (decision.kind === "product" || decision.kind === "wear") kinds.set(decision.id, { kind: decision.kind, reason: decision.reason });
      }
    } catch { /* 구분하지 못한 사진은 제품컷으로 두고 직접 바꿀 수 있게 한다. */ }
    return sections.map(section => ({ ...section, kind: kinds.get(section.id)?.kind || ("product" as const), reason: kinds.get(section.id)?.reason || UNSORTED_REASON }));
  }

  // 사진별로 나눠서 등록이미지·AI 새로 만들기에 쓴다. 자를 때마다 이전에 나눠 둔 사진은 새 사진으로 바뀐다.
  async function confirmCutForSplit() {
    if (!cut || cut.bottom - cut.top < 0.02) {
      setMessage("사용할 구간이 너무 좁습니다. 위·아래 자를 위치를 다시 정해주세요.");
      return;
    }
    setBusy(true);
    try {
      const usable = await cropDataUrl(cut.dataUrl, cut.top, cut.bottom, cut.holes);
      const found = await splitDetailPage(usable, headerUrl);
      const classified = await classifyKinds(found);
      const stamp = Date.now().toString(36);
      const sections = classified.map(section => ({ ...section, id: `${stamp}-${section.id}` }));
      setDraftId(newDraftId());
      setSource(usable);
      setSourceName(cut.name);
      resetWork();
      setOriginalSections(sections);
      setSectionActions(Object.fromEntries(sections.map(section => [section.id, "edit"])));
      setScanSummary({ found: found.length, kept: sections.length, excluded: 0 });
      setCut(null);
      setMessage(`${sections.length}장을 가져왔습니다. 제품컷·착용컷 구분을 확인하고 새로 만들기를 누르세요.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "상세페이지를 나누지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  /**
   * 상세페이지 없이 사진 몇 장으로 바로 시작한다(모델컷·제품컷만 골라 AI 편집).
   * 고른 사진이 그대로 "사진별 확인" 목록이 되고, 2·3단계는 상세페이지를 나눴을 때와 똑같다.
   */
  async function startFromPhotos(images: Array<{ dataUrl: string; name: string; slotKey?: string }>, label: string, autoStart = false, fromSlot = false) {
    if (!images.length) return;
    if (busy) { setMessage("지금 다른 AI 편집이 진행 중입니다. 끝난 뒤 다시 눌러주세요."); return; }
    // 2026-11-18 가져올 때는 제품컷·착용컷을 AI로 구분하지 않는다(예전에는 여기서 1분쯤 기다렸고, 3번 버튼이 "작업 중"으로 바뀌었다).
    // 사진은 바로 보여 주고, 구분은 3번의 "AI 편집 시작"을 눌렀을 때 체크한 사진만 한다.
    try {
      const stamp = Date.now().toString(36);
      const found = images.map((image, index) => ({ id: `${stamp}-p${index + 1}`, dataUrl: image.dataUrl }));
      const sections = found.map(item => ({ ...item, kind: "product" as const, reason: UNSORTED_REASON }));
      setDraftId(newDraftId());
      setSource("");
      setSourceName(label);
      resetWork();
      setOriginalSections(sections);
      slotKeyBySection.current = Object.fromEntries(found.flatMap((item, index) => images[index].slotKey ? [[item.id, images[index].slotKey as string]] : []));
      setSectionActions(Object.fromEntries(sections.map(section => [section.id, "edit"])));
      setScanSummary({ found: sections.length, kept: sections.length, excluded: 0 });
      setCut(null);
      setPickingPool(false);
      setPickedPool([]);
      if (autoStart) setAutoRun(true);
      setMessage(fromSlot
        ? `사진 ${sections.length}장을 가져왔습니다. 편집할 사진을 체크하고, 아래 2번에서 분위기와 제품 컬러를 고른 뒤, 3번의 "AI 편집 시작" 버튼을 눌러야 시작됩니다.`
        : `사진 ${sections.length}장을 가져왔습니다. 편집할 사진만 체크하세요. 제품컷·착용컷은 AI 편집을 시작할 때 자동으로 구분합니다.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "사진을 가져오지 못했습니다.");
    }
  }

  // 2026-11-18 칸의 [AI 편집]·[체크한 칸 AI 편집]을 누르면(요청 번호가 바뀌면) 사진만 가져온다.
  // 예전에는 곧바로 AI 편집이 시작됐지만, 분위기·제품 컬러를 고른 뒤 3번의 버튼을 눌러야 시작하도록 바꿨다.
  useEffect(() => {
    if (!request?.images.length) return;
    void startFromPhotos(request.images, `칸에서 고른 사진 ${request.images.length}장`, false, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request?.token]);
  useEffect(() => {
    if (autoRun && !busy && originalSections.length) {
      setAutoRun(false);
      void create();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRun, busy, originalSections]);

  async function choosePhotoFiles(event: ChangeEvent<HTMLInputElement>) {
    const files = [...(event.target.files || [])].filter(file => file.type.startsWith("image/"));
    event.target.value = "";
    if (!files.length) return;
    try {
      const images = await Promise.all(files.map(async file => ({ dataUrl: await readImageFile(file), name: file.name })));
      await startFromPhotos(images, `사진 ${images.length}장`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "사진을 불러오지 못했습니다.");
    }
  }

  // 이미 완성된 상세페이지를 위·아래만 자르고 그대로 상세페이지 칸에 넣는다(로고는 자동으로 붙이지 않는다 — 기존 상세페이지에 로고가 있으면 두 번 들어가기 때문. 필요하면 6번 상세페이지 칸의 "상단 로고 붙이기").
  async function useCroppedAsDetailPage() {
    if (!cut || cut.bottom - cut.top < 0.02) {
      setMessage("사용할 구간이 너무 좁습니다. 위·아래 자를 위치를 다시 정해주세요.");
      return;
    }
    setBusy(true);
    try {
      const usable = await cropDataUrl(cut.dataUrl, cut.top, cut.bottom, cut.holes);
      onComplete({ dataUrl: usable, sections: [], logoApplied: false });
      setCut(null);
      setMessage("자른 상세페이지를 로고 없이 그대로 6번 상세페이지 칸에 넣었습니다. 로고가 필요하면 6번의 \"상단 로고 붙이기\"를 누르세요.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "상세페이지를 자르지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  // 2026-11-13 기존 상세페이지를 한 번에 두 용도로 쓴다: 자른 그대로 상세페이지 칸에 넣고, 같은 사진을 사진별로 나눠 5번 등록이미지 목록에도 올린다.
  // 제품컷·착용컷 구분(AI 호출)은 하지 않아 사용량을 쓰지 않는다. 구분은 나중에 AI 편집을 할 때 확인하면 된다.
  async function useCroppedAsDetailPageAndSplit() {
    if (!cut || cut.bottom - cut.top < 0.02) {
      setMessage("사용할 구간이 너무 좁습니다. 위·아래 자를 위치를 다시 정해주세요.");
      return;
    }
    setBusy(true);
    try {
      const usable = await cropDataUrl(cut.dataUrl, cut.top, cut.bottom, cut.holes);
      const found = await splitDetailPage(usable, headerUrl);
      const stamp = Date.now().toString(36);
      const sections = found.map(section => ({ ...section, id: `${stamp}-${section.id}`, kind: "product" as const, reason: UNSORTED_REASON }));
      const base = modelName.trim() || "NOID-B";
      const items: Array<{ fileName: string; dataUrl: string; source: string }> = [];
      for (let index = 0; index < sections.length; index += 1) {
        const source = sections[index].dataUrl;
        if (alreadyAdded.current.has(source)) continue;
        items.push({ fileName: `${base}-cut-${stamp.slice(-4)}-${String(index + 1).padStart(2, "0")}.jpg`, dataUrl: await extendToSquareCanvas(source, await listSquareSize(source)), source });
        alreadyAdded.current.add(source);
      }
      onComplete({ dataUrl: usable, sections: [], logoApplied: false });
      if (items.length) onAddToList(items);
      setDraftId(newDraftId());
      setSource(usable);
      setSourceName(cut.name);
      resetWork();
      setOriginalSections(sections);
      setSectionActions(Object.fromEntries(sections.map(section => [section.id, "edit"])));
      setScanSummary({ found: found.length, kept: sections.length, excluded: 0 });
      setAddedVersion(value => value + 1);
      setCut(null);
      setMessage(`6번 상세페이지 칸에 넣고, 사진 ${items.length}장을 위쪽 등록이미지 목록에 올렸습니다. 위 목록에서 썸네일·추가이미지 칸으로 끌어 넣으세요.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "상세페이지를 넣고 나누지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  function dropFile(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files?.[0];
    if (file && !busy) void startUpload(file);
  }

  function chooseFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (file) void startUpload(file);
    event.target.value = "";
  }

  function invalidateResult() {
    setFinalSections([]);
    setResult(null);
  }

  // 2026-11-18 사진마다 체크칸: 체크한 사진만 AI 편집하고, 체크 안 한 사진은 원본 그대로 둔다(삭제 버튼 대신).
  function toggleChecked(id: string) {
    if (editing || editedById.has(id)) return;
    setSectionActions(current => ({ ...current, [id]: (current[id] || "edit") === "edit" ? "original" : "edit" }));
  }

  // 편집이 끝난 사진을 다시 편집할 수 있게 AI 결과만 지운다(원본 사진은 그대로).
  function redoSection(id: string) {
    if (editing) return;
    setEditedSections(current => current.filter(section => section.id !== id));
    setSectionActions(current => ({ ...current, [id]: "edit" }));
    invalidateResult();
    setMessage("이 사진을 다시 편집할 수 있게 했습니다. 컬러를 고르고 3번의 \"AI 편집 시작\"을 누르세요. (이미 등록이미지 목록에 들어간 AI 사진은 그대로 있습니다.)");
  }

  async function addToRegistrationImages() {
    if (!originalSections.length) return;
    setBusy(true);
    try {
      const stamp = Date.now().toString(36).slice(-4);
      const base = modelName.trim() || "NOID-B";
      const items: Array<{ fileName: string; dataUrl: string; source: string; kind?: "product" | "wear" }> = [];
      for (let index = 0; index < originalSections.length; index += 1) {
        const section = originalSections[index];
        const edited = editedById.get(section.id);
        const useEdited = sectionActions[section.id] !== "original" && edited;
        const source = useEdited ? edited.dataUrl : section.dataUrl;
        // 이미 목록에 들어간 사진(AI 편집 후 자동 추가 포함)은 다시 넣지 않는다.
        if (alreadyAdded.current.has(source)) continue;
        // 제품컷·착용컷을 확인한 사진만 구분을 함께 넘긴다(빈 칸 자동 채우기에 쓴다).
        items.push({ fileName: `${base}-cut-${stamp}-${String(index + 1).padStart(2, "0")}.jpg`, dataUrl: await extendToSquareCanvas(source, await listSquareSize(source)), source, kind: section.reason !== UNSORTED_REASON ? section.kind : undefined });
        alreadyAdded.current.add(source);
      }
      if (!items.length) {
        setMessage("모든 사진이 이미 5번 쿠팡 등록이미지 목록에 들어 있습니다.");
        return;
      }
      onAddToList(items);
      setAddedVersion(value => value + 1);
      setMessage(`${items.length}장을 5번 쿠팡 등록이미지 목록에 추가했습니다. 아래 이미지 목록에서 썸네일·추가이미지 칸으로 끌어 넣으세요.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "등록이미지에 추가하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  function toggleSectionKind(id: string) {
    // 직접 바꾼 사진은 reason을 바꿔 두어, AI 편집 전 자동 구분이 다시 덮어쓰지 않게 한다.
    setOriginalSections(current => current.map(section => section.id === id ? { ...section, kind: section.kind === "wear" ? "product" : "wear", reason: "직접 선택했습니다." } : section));
    setEditedSections(current => current.filter(section => section.id !== id));
    invalidateResult();
    setMessage("제품컷·착용컷 구분을 바꿨습니다. 이 사진은 새 구분에 맞춰 편집합니다.");
  }

  async function editSection(section: QuickDetailSection, lookAnchor?: QuickDetailSection, signal?: AbortSignal) {
    const isWear = section.kind === "wear";
    if (isWear && !wearLookRef.current) wearLookRef.current = makeWearLook(style);
    // 서버가 한 번에 받는 용량(약 4.5MB)을 넘지 않도록 보내기 전에 사진을 줄인다.
    const references: Array<{ dataUrl: string; role: string }> = [{ dataUrl: await shrinkForUpload(section.dataUrl), role: section.kind || "detail-section" }];
    // 먼저 완성된 착용컷이 있으면 두 번째 참고 사진으로 보내 같은 모델·같은 분위기로 맞춘다.
    if (isWear && lookAnchor) references.push({ dataUrl: await shrinkForUpload(lookAnchor.dataUrl), role: "approved-look" });
    const response = await fetch("/api/image-generator/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "quick-detail", style, color, sectionKind: section.kind, look: isWear ? wearLookRef.current : undefined, hasLookReference: isWear && Boolean(lookAnchor), references }),
      signal,
    });
    // 서버가 JSON이 아닌 글자(용량 초과·시간 초과 등)를 돌려줘도 알아보기 쉬운 안내가 나오게 한다.
    const raw = await response.text();
    let data: { imageDataUrl?: string; error?: string } = {};
    try { data = JSON.parse(raw) as typeof data; } catch { /* JSON이 아닌 응답 */ }
    if (!response.ok || !data.imageDataUrl) {
      if (data.error) throw new Error(data.error);
      if (response.status === 413 || /Request Entity/i.test(raw)) throw new Error("사진 용량이 너무 커서 서버가 받지 못했습니다. 더 작은 사진으로 다시 시도해주세요.");
      if (response.status === 504 || response.status === 408 || /timeout|timed out/i.test(raw)) throw new Error("AI 편집 시간이 오래 걸려 서버가 중단했습니다. 잠시 후 다시 눌러주세요.");
      throw new Error(`서버 응답이 올바르지 않습니다(${response.status}). 잠시 후 다시 눌러주세요.`);
    }
    // '밝은 주얼리 화이트'일 때만 결과 사진을 살짝 밝게·색 쏠림 없이 보정한다(고급 아이보리·모던 그레이는 그대로).
    return { ...section, dataUrl: style === "clean" ? await brightenWhiteBalance(data.imageDataUrl) : data.imageDataUrl };
  }

  async function create() {
    if (!originalSections.length) return setMessage("상세페이지를 먼저 올려주세요.");
    if (!pendingCount) return setMessage("편집할 사진이 없습니다. 위 \"사진별 확인\"에서 AI로 편집할 사진을 체크해주세요.");
    setBusy(true);
    setEditing(true);
    stopRef.current = false;
    setStopping(false);
    const controller = new AbortController();
    abortRef.current = controller;
    setResult(null);
    const byId = new Map(editedSections.map(section => [section.id, section]));
    const completed: QuickDetailSection[] = [];
    let editIndex = completedEdits;
    try {
      // 2026-11-17 가져온 사진은 모두 '제품컷'으로 시작해서, 모델 사진도 배경만 바뀌는 문제가 있었다.
      // 아직 구분하지 않은 사진만 AI 편집 전에 한 번에 구분한다(직접 바꾼 사진·이미 구분된 사진은 건드리지 않는다).
      let workingSections = originalSections;
      const unsorted = originalSections.filter(section => (sectionActions[section.id] || "edit") === "edit" && section.reason === UNSORTED_REASON);
      if (unsorted.length) {
        const classified = await classifyKinds(unsorted, true);
        if (stopRef.current) throw new Error("STOPPED");
        // 2026-11-17 구분에 실패한 사진을 몰래 제품컷으로 편집하면 모델 사진의 얼굴·옷이 안 바뀐다. 실패하면 멈추고 직접 확인하게 한다.
        const failedCount = classified.filter(section => section.reason === UNSORTED_REASON).length;
        if (failedCount) throw new Error(`제품컷·착용컷 구분에 실패한 사진이 ${failedCount}장 있습니다. 각 사진의 "제품컷 → 착용컷으로 변경" 버튼으로 직접 확인한 뒤 새로 만들기를 다시 눌러주세요.`);
        const sorted = new Map(classified.map(section => [section.id, section]));
        workingSections = originalSections.map(section => sorted.get(section.id) || section);
        for (const section of workingSections) {
          const before = originalSections.find(item => item.id === section.id);
          // 구분이 바뀐 사진은 예전에 만든 AI 사진(배경만 바뀐 것)을 버리고 새 구분으로 다시 만든다.
          if (before && before.kind !== section.kind) byId.delete(section.id);
        }
        setOriginalSections(workingSections);
        setEditedSections(Array.from(byId.values()));
        editIndex = workingSections.filter(section => (sectionActions[section.id] || "edit") === "edit" && byId.has(section.id)).length;
      }
      for (const section of workingSections) {
        if ((sectionActions[section.id] || "edit") === "original") {
          completed.push(section);
          continue;
        }
        let edited = byId.get(section.id);
        if (!edited) {
          if (stopRef.current) throw new Error("STOPPED");
          setProgress(editIndex);
          setMessage(`AI 편집 ${expectedEdits}장 중 ${editIndex + 1}번째를 만들고 있습니다. 완성된 사진은 그대로 보관됩니다.`);
          const lookAnchor = section.kind === "wear"
            ? workingSections.map(item => byId.get(item.id)).find((item): item is QuickDetailSection => Boolean(item) && item!.kind === "wear")
            : undefined;
          edited = await editSection(section, lookAnchor, controller.signal);
          if (stopRef.current) { byId.set(section.id, edited); setEditedSections(Array.from(byId.values())); throw new Error("STOPPED"); }
          byId.set(section.id, edited);
          setEditedSections(Array.from(byId.values()));
          editIndex += 1;
        }
        completed.push(edited);
      }
      setProgress(expectedEdits);
      // 상세페이지는 만들지 않는다(아래 상세페이지 칸을 덮어쓰지 않음). AI로 새로 만든 사진만 1000×1000으로
      // 5번 쿠팡 등록이미지 목록에 넣고, 썸네일·추가이미지 칸에 쓴 뒤 그 사진들로 상세페이지를 만든다.
      const newlyEdited = completed.filter(section => (sectionActions[section.id] || "edit") === "edit" && !alreadyAdded.current.has(section.dataUrl));
      if (newlyEdited.length) {
        const stamp = Date.now().toString(36).slice(-4);
        const base = modelName.trim() || "NOID-B";
        const items: Array<{ fileName: string; dataUrl: string; source: string; kind?: "product" | "wear"; slotKey?: string }> = [];
        for (let index = 0; index < newlyEdited.length; index += 1) {
          items.push({ fileName: `${base}-ai-${stamp}-${String(index + 1).padStart(2, "0")}.jpg`, dataUrl: await extendToSquareCanvas(newlyEdited[index].dataUrl, await listSquareSize(newlyEdited[index].dataUrl)), source: newlyEdited[index].dataUrl, kind: newlyEdited[index].kind, slotKey: slotKeyBySection.current[newlyEdited[index].id] });
          alreadyAdded.current.add(newlyEdited[index].dataUrl);
        }
        onAddToList(items);
        setAddedVersion(value => value + 1);
      }
      setFinalSections(completed);
      setMessage(newlyEdited.length
        ? newlyEdited.some(section => slotKeyBySection.current[section.id])
          ? `AI 편집이 끝났습니다. 편집한 사진을 해당 칸에 넣었습니다(원래 사진은 사진 목록으로 되돌렸습니다). 제품 모양을 꼭 확인해주세요.`
          : `AI 편집 사진 ${newlyEdited.length}장을 5번 쿠팡 등록이미지 목록에 넣었습니다. 제품 모양을 꼭 확인한 뒤 썸네일·추가이미지 칸으로 끌어 넣거나, 위 "빈 칸 자동 채우기"를 누르세요.`
        : "새로 넣을 AI 편집 사진이 없습니다. 이미 5번 목록에 넣었습니다.");
    } catch (error) {
      if (stopRef.current) {
        const done = byId.size;
        setMessage(`AI 편집을 중단했습니다. 칸의 사진은 바꾸지 않았습니다.${done ? ` 이미 끝난 ${done}장은 보관했고, "이어서 AI 편집"을 누르면 나머지부터 이어서 만듭니다.` : ""}`);
      } else {
        setMessage(`${error instanceof Error ? error.message : "작업 중 문제가 생겼습니다."} 다시 누르면 완료된 AI 사진 다음부터 이어서 만듭니다.`);
      }
    } finally {
      abortRef.current = null;
      setStopping(false);
      setEditing(false);
      setBusy(false);
    }
  }

  /** 2026-11-17 AI 편집 중단: 지금 기다리는 요청을 끊고 남은 사진은 보내지 않는다(끝난 사진은 보관). */
  function stopEditing() {
    if (!editing) return;
    stopRef.current = true;
    setStopping(true);
    abortRef.current?.abort();
  }

  function restoreDraft(draft: QuickDetailDraft) {
    // 불러온 사진·안내 문구가 화면 위쪽에 있어, 눌러도 반응이 없는 것처럼 보이지 않게 위로 올려 보여 준다.
    panelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    if (draft.id === draftId && originalSections.length) {
      setMessage(`${draft.modelName || "이 작업"}은(는) 지금 열려 있는 작업입니다. 위쪽 사진 목록에서 이어서 하시면 됩니다.`);
      return;
    }
    deletedDraftIdsRef.current.delete(draft.id);
    setCut(null);
    setDraftId(draft.id);
    setSource(draft.source);
    setSourceName(draft.sourceName);
    setStyle(draft.style);
    setColor(draft.color || "original");
    setOriginalSections(draft.originalSections);
    setEditedSections(draft.editedSections);
    setFinalSections(draft.finalSections);
    setSectionActions(draft.sectionActions);
    setResult(draft.result);
    setScanSummary(draft.scanSummary);
    setProgress(draft.editedSections.length);
    setMessage(`${draft.modelName || "임시저장한 작업"} · 사진 ${draft.originalSections.length}장 · AI 완료 ${draft.editedSections.length}장을 불러왔습니다.`);
  }

  async function removeDraft(id: string) {
    deletedDraftIdsRef.current.add(id);
    await deleteQuickDraft(id);
    setDrafts(await listQuickDrafts());
    if (draftId === id) {
      setDraftId("");
      setSource("");
      setSourceName("");
      resetWork();
      setMessage("상세페이지를 올려주세요.");
    }
  }

  // 2026-11-17 사진별 확인(+크게 보기 창). 칸 아래 자리가 있으면 거기에, 없으면 이 자리에 그린다.
  const reviewBlock = (
    <>
    {originalSections.length > 0 && (
      <div className={styles.preEditReview}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <h3 style={{ margin: 0 }}>사진별 확인</h3>
          <button type="button" className="existingDetailUseButton" disabled={busy || pendingAddCount === 0} title={pendingAddCount === 0 ? "지금 보이는 사진이 모두 5번 쿠팡 등록이미지 목록에 들어 있습니다." : "지금 보이는 사진을 1000×1000 여백 없는 정사각형으로 만들어 5번 쿠팡 등록이미지 목록에 넣습니다. 썸네일·추가이미지·상세페이지에 모두 쓸 수 있습니다."}
            onClick={() => void addToRegistrationImages()}>{pendingAddCount === 0 ? "추가됨 ✓" : `등록이미지에 추가 (${pendingAddCount}장)`}</button>
          {editing
            ? <button type="button" className="softPinkButton" style={{ borderRadius: 8, padding: "8px 18px", fontWeight: 800 }} disabled={stopping} onClick={stopEditing}
                title="AI 편집을 멈춥니다. 끝난 사진은 보관되고 칸의 사진은 바뀌지 않습니다.">{stopping ? "중단하는 중…" : "중단하기"}</button>
            : completedEdits > 0 && completedEdits < expectedEdits
              ? <button type="button" className="softSageButton" style={{ borderRadius: 8, padding: "8px 18px", fontWeight: 800 }} disabled={busy} onClick={() => void create()}>이어서 AI 편집</button>
              : null}
        </div>
        {(editing || message) && <p style={{ margin: "8px 0 0", fontSize: 13, color: "#4b4744" }}>{editing ? `AI 편집 중… (${Math.min(progress + 1, Math.max(expectedEdits, 1))}/${Math.max(expectedEdits, 1)}) ` : ""}{message}</p>}
        <div className={styles.reviewGrid}>
          {originalSections.map((section, index) => {
            const original = sectionActions[section.id] === "original";
            const edited = editedById.get(section.id);
            const shown = !original && edited ? edited.dataUrl : section.dataUrl;
            const done = !original && Boolean(edited);
            const unsorted = section.reason === UNSORTED_REASON;
            return <article key={section.id} style={{ position: "relative", outline: !original && !done ? "2px solid #60766a" : "none", outlineOffset: -2 }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={shown} alt={`사진 ${index + 1}`} title="누르면 크게 봅니다" style={{ cursor: "zoom-in" }} onClick={() => setZoomIndex(index)} />
              <label title={done ? "AI 편집이 끝난 사진입니다." : "체크한 사진만 AI로 편집합니다."}
                style={{ position: "absolute", top: 6, left: 6, display: "flex", alignItems: "center", gap: 5, padding: "4px 9px 4px 6px", borderRadius: 8, background: "rgba(255,255,255,0.94)", border: "1px solid #60766a", color: "#3f4943", fontSize: 12, fontWeight: 800, cursor: done || editing ? "default" : "pointer" }}>
                <input type="checkbox" checked={done || !original} disabled={done || editing} onChange={() => toggleChecked(section.id)} style={{ width: 16, height: 16, margin: 0, accentColor: "#60766a" }} />
                {done ? "편집 완료" : "선택"}
              </label>
              <button type="button" className={styles.kindToggle} disabled={editing} onClick={() => toggleSectionKind(section.id)}>{section.kind === "wear" ? "착용컷 → 제품컷으로 변경" : "제품컷 → 착용컷으로 변경"}</button>
              <strong>{index + 1}. {unsorted ? "구분 전" : section.kind === "wear" ? "착용컷" : "제품컷"}{done ? " · AI 완료" : ""}</strong>
              {unsorted && !done && <small style={{ minHeight: 0 }}>AI 편집을 시작할 때 자동으로 구분합니다.</small>}
              {done && <div>
                <button type="button" className={styles.reviewDelete} disabled={editing} title="AI 결과를 지우고 이 사진을 다시 편집할 수 있게 합니다." onClick={() => redoSection(section.id)}>다시 편집</button>
              </div>}
            </article>;
          })}
        </div>
        <p className={styles.reviewCost}>선택 {pendingCount}장 · 예상 AI 편집 <strong>{pendingCount}회</strong> · 편집 완료 {completedEdits}장 · 원본 그대로 {originalSections.length - expectedEdits}장</p>
      </div>
    )}

    {(() => {
      zoomCountRef.current = originalSections.length;
      if (zoomIndex === null) return null;
      const index = Math.min(zoomIndex, originalSections.length - 1);
      const section = originalSections[index];
      if (!section) return null;
      const edited = editedById.get(section.id);
      const shown = sectionActions[section.id] !== "original" && edited ? edited.dataUrl : section.dataUrl;
      const navStyle = { width: 48, height: 48, borderRadius: 8, border: "none", background: "#f4f1ec", color: "#252525", fontSize: 18, cursor: "pointer", flex: "0 0 auto" } as const;
      return (
        <div role="dialog" aria-label="사진 크게 보기" onClick={() => setZoomIndex(null)}
          style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(37,37,37,0.82)", display: "flex", alignItems: "center", justifyContent: "center", gap: 12, padding: 16 }}>
          <button type="button" title="이전 사진" disabled={index === 0} style={{ ...navStyle, opacity: index === 0 ? 0.35 : 1 }} onClick={event => { event.stopPropagation(); setZoomIndex(index - 1); }}>◀</button>
          <div onClick={event => event.stopPropagation()} style={{ display: "grid", gap: 8, justifyItems: "center", minWidth: 0 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={shown} alt={`사진 ${index + 1} 크게 보기`} style={{ maxWidth: "min(100%, calc(100vw - 160px))", maxHeight: "calc(100vh - 110px)", objectFit: "contain", borderRadius: 8, background: "#fff" }} />
            <div style={{ display: "flex", alignItems: "center", gap: 12, color: "#fff", fontSize: 14, fontWeight: 700 }}>
              <span>{index + 1} / {originalSections.length} · {section.kind === "wear" ? "착용컷" : "제품컷"}</span>
              <button type="button" className="softBeigeButton" style={{ borderRadius: 8, padding: "6px 16px" }} onClick={() => setZoomIndex(null)}>닫기</button>
            </div>
          </div>
          <button type="button" title="다음 사진" disabled={index === originalSections.length - 1} style={{ ...navStyle, opacity: index === originalSections.length - 1 ? 0.35 : 1 }} onClick={event => { event.stopPropagation(); setZoomIndex(index + 1); }}>▶</button>
        </div>
      );
    })()}
    </>
  );

  return <div ref={panelRef} className={styles.quickPanel} style={{ maxWidth: "none", margin: 0, scrollMarginTop: 12 }}>
    <div className={styles.quickIntro}>
      <div><span>AI DETAIL REMAKE</span><h3 style={{ fontSize: 20, margin: "0 0 6px" }}>AI 사진편집</h3></div>
    </div>
    <div className={styles.quickSteps} onDragEnter={event => { event.preventDefault(); if (!busy) setDragging(true); }} onDragOver={event => { event.preventDefault(); if (!busy) setDragging(true); }} onDragLeave={event => { event.preventDefault(); setDragging(false); }} onDrop={dropFile}>
      <article>
        <span>1</span><h3>상세페이지 올리기</h3>
        <label className={`${styles.quickUpload} ${dragging ? styles.quickUploadDragging : ""}`}>
          <strong>{sourceName ? "다른 상세페이지 올리기" : "상세페이지 올리기"}</strong>
          <span>클릭해서 선택하거나 여기에 끌어다 놓으세요</span>
          <input type="file" accept="image/jpeg,image/png,image/webp" onChange={chooseFile} />
        </label>
        <div className={styles.photoSourceButtons}>
          <button type="button" disabled={busy || !poolImages.length}
            title={poolImages.length ? "5번 쿠팡 등록이미지에서 AI로 편집할 사진을 고릅니다." : "5번 쿠팡 등록이미지에 사진이 없습니다."}
            onClick={() => { setPickingPool(value => !value); setPickedPool([]); }}>등록이미지에서 고르기</button>
          <label style={{ cursor: busy ? "wait" : "pointer" }} title="상세페이지 없이 사진 여러 장을 바로 올립니다.">
            사진 여러 장 올리기
            <input type="file" accept="image/jpeg,image/png,image/webp" multiple style={{ display: "none" }} disabled={busy} onChange={event => void choosePhotoFiles(event)} />
          </label>
        </div>
        <small className={styles.wrapNote}>상세페이지가 없어도 사진만 골라 바로 AI 편집할 수 있습니다.</small>
        {sourceName && <small>{sourceName}</small>}
      </article>
      <article>
        <span>2</span><h3>분위기·컬러 선택</h3>
        <div className={styles.styleChoices}>{STYLE_OPTIONS.map(option => <label key={option.value} className={style === option.value ? styles.selectedStyle : ""}><input type="radio" name="quick-style" value={option.value} checked={style === option.value} onChange={() => { setStyle(option.value); invalidateResult(); }} /><strong>{option.title}</strong><small>{option.description}</small></label>)}</div>
        <div className={styles.colorPick}>
          <strong>제품 컬러</strong>
          <div role="radiogroup" aria-label="제품 컬러">
            {COLOR_OPTIONS.map(option => <button key={option.value} type="button" role="radio" aria-checked={color === option.value} disabled={busy}
              className={color === option.value ? styles.colorSelected : ""}
              onClick={() => { if (color === option.value) return; setColor(option.value); invalidateResult(); }}>
              <i style={{ background: option.swatch }} />{option.title}
            </button>)}
          </div>
          <small>{color === "original" ? "제품 색은 그대로 두고 분위기만 바꿉니다." : "분위기는 그대로, 제품 금속 색만 바뀝니다. 제품컷·착용컷 모두 적용됩니다."}</small>
        </div>
      </article>
      <article>
        <span>3</span><h3>AI 사진편집</h3>
        <button type="button" className={styles.quickCreate} disabled={!originalSections.length || busy} onClick={() => void create()}>{busy ? `작업 중… (${Math.min(progress + 1, Math.max(expectedEdits, 1))}/${Math.max(expectedEdits, 1)})` : "AI 편집 시작"}</button>
        {editing && <button type="button" className={`softPinkButton ${styles.stopButton}`} disabled={stopping} onClick={stopEditing}>{stopping ? "중단하는 중…" : "중단하기"}</button>}
        <button type="button" className={styles.splitButton} disabled={!cut || busy}
          title={cut ? "올린 상세페이지를 사진별로 나눕니다. 사진 바깥 흰 여백의 글자 줄은 잘라내고, 사진 위 글자는 그대로 둡니다." : "1단계에서 상세페이지를 먼저 올려주세요."}
          onClick={() => void confirmCutForSplit()}>{busy && cut ? "나누는 중…" : "상세페이지 분할"}</button>
        <small className={styles.wrapNote}>완성된 사진은 위쪽 등록이미지 목록 맨 앞에 들어갑니다. 6번 상세페이지 칸은 바꾸지 않습니다.</small>
        <p>{message}</p>
        {scanSummary && <div className={styles.scanSummary}><span>가져온 사진 <strong>{originalSections.length}</strong></span><span>AI 편집 예정 <strong>{pendingCount}</strong></span><span>원본 사용 <strong>{originalSections.length - expectedEdits}</strong></span></div>}
        {originalSections.length > 0 && <small>예상 AI 편집: {pendingCount}회 · 완료: {completedEdits}장</small>}
      </article>
    </div>

    {pickingPool && (
      <div style={{ marginTop: 16, padding: 12, border: "1px solid #d8d3cc", borderRadius: 10, background: "#faf9f7" }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 10 }}>
          <strong style={{ fontSize: 14 }}>AI로 편집할 사진 고르기 · {pickedPool.length}장 선택</strong>
          <button type="button" className="green compactFieldButton" disabled={busy || !pickedPool.length}
            onClick={() => void startFromPhotos(poolImages.filter(image => pickedPool.includes(image.dataUrl)).map(image => ({ dataUrl: image.dataUrl, name: image.fileName })), `등록이미지 ${pickedPool.length}장`)}>
            {busy ? "가져오는 중…" : "선택한 사진으로 시작"}
          </button>
          <button type="button" className="secondaryButton compactFieldButton" onClick={() => { setPickingPool(false); setPickedPool([]); setPoolZoomIndex(null); }}>닫기</button>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(110px, 1fr))", gap: 8 }}>
          {poolImages.map((image, index) => {
            const picked = pickedPool.includes(image.dataUrl);
            const togglePick = () => setPickedPool(current => picked ? current.filter(url => url !== image.dataUrl) : [...current, image.dataUrl]);
            return <div key={`${image.fileName}-${index}`}
              style={{ position: "relative", border: picked ? "3px solid #60766a" : "1px solid #d8d3cc", borderRadius: 8, background: "#fff", overflow: "hidden" }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={image.dataUrl} alt={image.fileName} title="누르면 크게 봅니다" onClick={() => setPoolZoomIndex(index)}
                style={{ display: "block", width: "100%", aspectRatio: "1 / 1", objectFit: "contain", cursor: "zoom-in" }} />
              <button type="button" title={picked ? "선택 해제" : "이 사진 선택"} onClick={togglePick}
                style={{ position: "absolute", top: 4, left: 4, padding: 0, cursor: "pointer", background: picked ? "#60766a" : "rgba(255,255,255,0.92)", color: picked ? "#fff" : "#60766a", border: "2px solid #60766a", borderRadius: 999, minWidth: 24, height: 24, fontSize: 12, fontWeight: 800, display: "grid", placeItems: "center" }}>
                {picked ? pickedPool.indexOf(image.dataUrl) + 1 : ""}
              </button>
            </div>;
          })}
        </div>
      </div>
    )}

    {pickingPool && (() => {
      poolZoomCountRef.current = poolImages.length;
      if (poolZoomIndex === null) return null;
      const index = Math.min(poolZoomIndex, poolImages.length - 1);
      const image = poolImages[index];
      if (!image) return null;
      const picked = pickedPool.includes(image.dataUrl);
      const navStyle = { width: 48, height: 48, borderRadius: 8, border: "none", background: "#f4f1ec", color: "#252525", fontSize: 18, cursor: "pointer", flex: "0 0 auto" } as const;
      return (
        <div role="dialog" aria-label="사진 크게 보기" onClick={() => setPoolZoomIndex(null)}
          style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(37,37,37,0.82)", display: "flex", alignItems: "center", justifyContent: "center", gap: 12, padding: 16 }}>
          <button type="button" title="이전 사진" disabled={index === 0} style={{ ...navStyle, opacity: index === 0 ? 0.35 : 1 }} onClick={event => { event.stopPropagation(); setPoolZoomIndex(index - 1); }}>◀</button>
          <div onClick={event => event.stopPropagation()} style={{ display: "grid", gap: 8, justifyItems: "center", minWidth: 0 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={image.dataUrl} alt={`사진 ${index + 1} 크게 보기`} style={{ maxWidth: "min(100%, calc(100vw - 160px))", maxHeight: "calc(100vh - 110px)", objectFit: "contain", borderRadius: 8, background: "#fff" }} />
            <div style={{ display: "flex", alignItems: "center", gap: 12, color: "#fff", fontSize: 14, fontWeight: 700 }}>
              <span>{index + 1} / {poolImages.length}</span>
              <button type="button" className="softBeigeButton" style={{ borderRadius: 8, padding: "6px 16px" }}
                onClick={() => setPickedPool(current => picked ? current.filter(url => url !== image.dataUrl) : [...current, image.dataUrl])}>{picked ? "선택 해제" : "이 사진 선택"}</button>
              <button type="button" className="softBeigeButton" style={{ borderRadius: 8, padding: "6px 16px" }} onClick={() => setPoolZoomIndex(null)}>닫기</button>
            </div>
          </div>
          <button type="button" title="다음 사진" disabled={index === poolImages.length - 1} style={{ ...navStyle, opacity: index === poolImages.length - 1 ? 0.35 : 1 }} onClick={event => { event.stopPropagation(); setPoolZoomIndex(index + 1); }}>▶</button>
        </div>
      );
    })()}

    {cut && (
      <div className="pageCutPanel" style={{ marginTop: 16 }}>
        <div className="detailActions">
          <button type="button" className={cut.mode === "top" ? "green" : "secondaryButton"} onClick={() => setCut(c => c && { ...c, mode: "top", holeStart: null })}>위쪽 자를 위치 정하기</button>
          <button type="button" className={cut.mode === "bottom" ? "green" : "secondaryButton"} onClick={() => setCut(c => c && { ...c, mode: "bottom", holeStart: null })}>아래쪽 자를 위치 정하기</button>
          <button type="button" className={cut.mode === "hole" ? "green" : "secondaryButton"} onClick={() => setCut(c => c && { ...c, mode: "hole", holeStart: null })} title="지울 문구의 바로 위와 바로 아래를 클릭하면 그 사이가 빠지고, 사이트 기본 간격만 남습니다.">가운데 잘라내기</button>
          <button type="button" className="purpleButton" disabled={busy} onClick={() => void useCroppedAsDetailPage()} title="자른 상세페이지를 로고 없이 그대로 6번 상세페이지 칸에 넣습니다.">상세페이지 사용</button>
          <button type="button" className="purpleButton" disabled={busy} onClick={() => void useCroppedAsDetailPageAndSplit()} title="6번 상세페이지 칸에 넣고, 같은 사진을 사진별로 나눠 위쪽 등록이미지 목록에도 한 번에 올립니다.">{busy ? "처리 중…" : "상세페이지 사용 + 사진별 나누기"}</button>
          <button type="button" className="secondaryButton" disabled={busy} onClick={() => void confirmCutForSplit()} title="사진별로 나눠서 등록이미지에 추가하거나 AI로 새로 만들 때 씁니다.">사진별로 나누기</button>
          <button type="button" className="secondaryButton" disabled={!cut.history.length && cut.holeStart === null} onClick={() => setCut(c => c && (c.holeStart !== null ? { ...c, holeStart: null } : c.history.length ? { ...c, ...c.history[c.history.length - 1], holeStart: null, history: c.history.slice(0, -1) } : c))}>되돌리기</button>
          <button type="button" className="secondaryButton" disabled={cut.top === 0 && cut.bottom === 1 && !cut.holes.length} onClick={() => setCut(c => c && { ...c, top: 0, bottom: 1, holes: [], holeStart: null, history: [...c.history, { top: c.top, bottom: c.bottom, holes: c.holes }] })}>초기화</button>
          <button type="button" className="secondaryButton" onClick={() => setCut(null)}>닫기</button>
        </div>
        <p className="detailMessage">{cut.mode === "top" ? "사용할 부분이 시작되는 위치를 이미지에서 클릭하세요. 그 위쪽은 버려집니다. 클릭하면 바로 아래쪽 정하기로 넘어갑니다." : cut.mode === "bottom" ? "사용할 부분이 끝나는 위치를 이미지에서 클릭하세요. 그 아래쪽은 버려집니다." : cut.holeStart === null ? "지울 문구의 바로 위를 클릭하세요." : "지울 문구의 바로 아래를 클릭하세요. 그 사이가 빠지고 사이트 기본 간격만 남습니다."}</p>
        <div className="pageCutScroll">
          <div className="pageCutFrame" onClick={event => {
            const rect = event.currentTarget.getBoundingClientRect();
            const ratio = Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height));
            setCut(c => {
              if (!c) return c;
              const snapshot = { top: c.top, bottom: c.bottom, holes: c.holes };
              // 2026-11-03 가운데 잘라내기: 첫 클릭(위)·두 번째 클릭(아래) 사이를 뺀다. 순서가 바뀌어도 알아서 맞춘다.
              if (c.mode === "hole") {
                if (c.holeStart === null) return { ...c, holeStart: ratio };
                const from = Math.min(c.holeStart, ratio), to = Math.max(c.holeStart, ratio);
                if (to - from < 0.002) return { ...c, holeStart: null };
                return { ...c, holes: [...c.holes, { from, to }], holeStart: null, history: [...c.history, snapshot] };
              }
              // 2026-10-23 사용자 요청: 위쪽을 정하면 곧바로 아래쪽 모드로 넘어가 '아래쪽 자를 위치 정하기'를 따로 누르지 않아도 된다.
              return c.mode === "top"
                ? { ...c, top: Math.min(ratio, c.bottom - 0.01), mode: "bottom", history: [...c.history, snapshot] }
                : { ...c, bottom: Math.max(ratio, c.top + 0.01), history: [...c.history, snapshot] };
            });
          }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={cut.dataUrl} alt="올린 상세페이지" draggable={false} />
            <div className="pageCutShade" style={{ top: 0, height: `${cut.top * 100}%` }} />
            <div className="pageCutShade" style={{ top: `${cut.bottom * 100}%`, bottom: 0 }} />
            {cut.holes.map((hole, index) => <div className="pageCutShade" key={index} style={{ top: `${hole.from * 100}%`, height: `${(hole.to - hole.from) * 100}%`, background: "rgba(225,29,72,.35)" }} />)}
            {cut.holeStart !== null && <div className="pageCutLine" style={{ top: `${cut.holeStart * 100}%` }}>지울 구간 시작</div>}
            <div className="pageCutLine" style={{ top: `${cut.top * 100}%` }}>위쪽 자름선</div>
            <div className="pageCutLine" style={{ top: `${cut.bottom * 100}%` }}>아래쪽 자름선</div>
          </div>
        </div>
      </div>
    )}

    {reviewHost ? createPortal(reviewBlock, reviewHost) : reviewBlock}

    {drafts.length > 0 && (
      <div style={{ marginTop: 16, display: "grid", gap: 8 }}>
        <strong style={{ fontSize: 13 }}>이어서 작업 <span style={{ color: "#77716a", fontWeight: 600 }}>{drafts.length}/{MAX_QUICK_DRAFTS}</span></strong>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {drafts.map(draft => (
            <span key={draft.id} style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "6px 10px", border: "1px solid #d8d3cc", borderRadius: 8, background: draft.id === draftId ? "#e3ede6" : "#f4f1ec", fontSize: 12 }}>
              <button type="button" disabled={busy} className="secondaryButton compactFieldButton" onClick={() => restoreDraft(draft)}>{draft.modelName || "이름 없는 작업"} · {draft.originalSections.length}장 · AI {draft.editedSections.length}장{draft.result ? " · 완성" : ""}{draft.id === draftId ? " · 열려 있음" : ""}</button>
              <button type="button" disabled={busy} className="secondaryButton compactFieldButton" onClick={() => void removeDraft(draft.id)}>삭제</button>
            </span>
          ))}
        </div>
      </div>
    )}
  </div>;
}
