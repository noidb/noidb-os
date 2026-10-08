"use client";

import { createPortal } from "react-dom";
import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import AppNavigation from "./AppNavigation";
import {
  ensureReadWritePermission,
  loadDirectoryHandle,
  saveDirectoryHandle,
  supportsDirectoryPicker,
} from "@/lib/product-db/idb";
import {
  buildAdditionalImagesCsv,
  collectProductImageFiles,
  collectProductDbFiles,
  syncProductDbToGoogleSheet,
  createLabelBlob,
} from "@/lib/product-db/files";
import { buildSkuRows } from "@/lib/excel/common";
import type { SkuRow } from "@/lib/excel/types";
import { assertProductDbFilesWritable, ensureProductFolderTree, rootFolderFileExists, writeCategoryFile, writeProductDbFiles, writeRootFolderFile } from "@/lib/product-db/fs";
import { dataUrlToBlob } from "@/lib/product-db/files";
import { buildProductDbZip } from "@/lib/product-db/zip";
import { compressImageDataUrl } from "@/lib/image/compress";
import { splitDetailPage, type QuickDetailSection } from "@/lib/image-generator/quick-detail";
import QuickDetailRemake, { prependHeader } from "./QuickDetailRemake";
import { normalizeCoupangImage } from "@/lib/image/normalize-coupang";
import { getWmsDisplayImageUrl } from "@/lib/wms/image-display-url";
import { loadPreparedDetail, loadPreparedPhotos, type PreparedDetail } from "@/lib/image-search/browser-folder";
import { coverSquareCanvas, defaultFitAdjust, extendToSquareCanvas, fitToWhiteCanvas, drawSquareCrop, renderSquareCrop, sharpenAmount, type FitAdjust, type SquareCrop } from "@/lib/thumbnail/fit";
import { deleteProductDraft, listProductDrafts, saveProductDraft, type ProductDraftRecord } from "@/lib/drafts/idb";
import { mergeProductDrafts, readDraftResponse, type ListedProductDraft } from "@/lib/drafts/records";
import WimsRegistrationImportPanel from "@/app/product-registration/WimsRegistrationImportPanel";
import SupplyStatusAuditPanel from "@/app/product-registration/SupplyStatusAuditPanel";
import { ensureNoidbActionSession } from "@/lib/wms/noidb-action-session-client";

type Product = {
  supplier: string;
  category: string;
  gender: string;
  material: string;
  colors: string;
  sizes: string;
  modelNo: string;
  modelName?: string;
  warehouse: string;
  replacementSku: string;
  keyword: string;
  coupangTitle?: string;
  searchTags?: string;
  dimension: string;
  cost: string;
  price: string;
};

type Analysis = {
  visualFeatures?: string[];
  engraving?: string;
  counterfeitRisk?: string;
  counterfeitReason?: string;
  confidence?: number;
};

type ProductPhoto = { id: string; name: string; dataUrl: string };
type SlotImage = { dataUrl: string; fileName: string; source?: string; crop?: SquareCrop; locked?: boolean };
type VariantOption = SkuRow & { key: string; label: string };
type DetailImage = { id: string; name: string; dataUrl: string; zoom?: number; focusX?: number; focusY?: number; frameHeight?: number };
type CustomSlot = { id: string; type: "all" | "detail" | "wear"; slot: SlotImage | null };
type QuoteQueueRecord = { model: string; gender: string; category: string; skuCount: number; savedAt: number | string; payload: any };
type PendingReplacementCleanup = { model: string; legacySku: string; oldRows: number; matchedOptions: number };
type ChineseKeyword = { chinese: string; koreanMeaning: string };
type EnglishKeyword = { english: string; koreanMeaning: string };
type SourcingAnalysis = {
  koreanSummary?: string;
  chineseKeywords?: ChineseKeyword[];
  englishKeywords?: EnglishKeyword[];
  searchTips?: string[];
};

const codeMap: Record<string, string> = {
  반지: "wr", 귀걸이: "we", 목걸이: "wn", 팔찌: "wb",
  발찌: "wa", 피어싱: "wp", 브로치: "wc", 세트: "wx",
};

const CATEGORY_WORDS = new Set([
  "반지", "귀걸이", "목걸이", "팔찌", "발찌", "피어싱", "브로치", "세트",
]);
const GENDER_WORDS = new Set(["여성", "남성", "남녀공용", "여성용", "남성용"]);
const FEMALE_RING_SIZES = "9호,11호,14호,17호,20호";
const MALE_RING_SIZES = "20호,22호,25호";
const UNISEX_RING_SIZES = "9호,11호,14호,17호,20호,22호,25호";
const MAX_PHOTOS = 20;
const ACCEPTED = ["image/jpeg", "image/jpg", "image/png"];
const DEFAULT_DETAIL_HEADER = "/노이드비-상단이미지.jpg";
const DRAFT_STORAGE_KEY = "noidb-product-draft";
/** 제품사진선택으로 나갈 때 작업 중이던 내용을 임시저장한 모델명. 돌아오면 그 임시저장을 다시 연다(이 탭에서만). */
const PHOTO_SELECT_RETURN_KEY = "noidb-photo-select-return";
const PRODUCT_DB_PATH_KEY = "noidb-product-db-path";
const LAURA_DRAFT_STORAGE_KEY = "laura-product-draft";
const LEGACY_DRAFT_STORAGE_KEY = ["noi", "db-product-draft"].join("");
const DEFAULT_LABEL_YEAR_MONTH = (() => {
  const now = new Date();
  return `${now.getFullYear()}.${String(now.getMonth() + 1).padStart(2, "0")}`;
})();
const DEFAULT_SUPPLIERS = [
  "프리스타일", "JK인터내셔널", "닝구네", "단종", "모건쥬얼리", "블루", "비에이블리",
  "샬롬", "세븐", "스콜피온", "실버데이", "아트피어싱", "자체제작", "제작", "쥬얼리김",
  "창성", "캐럿", "케이원", "태양사", "팝비즈도매", "피어싱도매닷컴", "한나도매", "현", "기타",
];

function normalizeSupplierName(value: string) {
  let supplier = String(value || "").trim();
  supplier = supplier.replace(/\s*\((?:여성|남성|여자|남자|남녀공용)\)\s*$/u, "").trim();
  if (!supplier || /^(?:부산|여성 거래처|남성 거래처|공용 거래처|공용거래처)$/u.test(supplier)) return "프리스타일";
  return supplier;
}

function mergeSupplierOptions(values: string[]) {
  const unique = [...new Set(values.map(normalizeSupplierName).filter(Boolean))];
  return [
    "프리스타일",
    ...unique.filter(value => value !== "프리스타일" && value !== "기타").sort((a, b) => a.localeCompare(b, "ko")),
    ...(unique.includes("기타") ? ["기타"] : []),
  ];
}

function openExternalUrl(url: string) {
  const standalone = window.matchMedia("(display-mode: standalone)").matches ||
    Boolean((window.navigator as Navigator & { standalone?: boolean }).standalone);
  if (standalone) {
    window.location.assign(url);
    return;
  }
  window.open(url, "_blank", "noopener,noreferrer");
}

const DEFAULT_PRODUCT: Product = {
  supplier: "프리스타일",
  category: "반지",
  gender: "여성",
  material: "써지컬스틸",
  colors: "로즈골드,골드,실버",
  sizes: "9호,11호,14호,17호,20호",
  modelNo: "1",
  warehouse: "",
  replacementSku: "",
  keyword: "체인패턴 볼드",
  coupangTitle: "",
  searchTags: "",
  dimension: "",
  cost: "1900",
  price: "14900",
};

function defaultRingSizes(gender: string) {
  if (gender === "남성") return MALE_RING_SIZES;
  if (gender === "여성") return FEMALE_RING_SIZES;
  return UNISEX_RING_SIZES;
}

function defaultSizes(gender: string, category: string) {
  if (category === "반지") return defaultRingSizes(gender);
  // 목걸이는 쿠팡에서 사이즈 필수 → 성별과 관계없이 FREE로 시작한다(길이는 치수 칸에 적는다).
  if (category === "목걸이") return "FREE";
  if (gender === "여성" && category === "발찌") return "약 20~26cm";
  if (gender === "여성" && category === "팔찌") return "약 16~21cm";
  if (gender === "남성" && category === "팔찌") return "약 22cm";
  return "";
}

function defaultDimension(category: string) {
  if (category === "피어싱") return "바길이 6바, 바두께 1.2cm, 총길이 5cm";
  if (category === "귀걸이") return "링너비 0.5cm, 링지름 1.3cm";
  return "";
}

function buildAutoModel(product: Pick<Product, "category" | "gender" | "modelNo">) {
  const no = product.modelNo.replace(/\D/g, "").padStart(4, "0");
  if (!product.modelNo) return "";
  const categoryCode = codeMap[product.category] ?? "wx";
  const genderPrefix = product.gender === "남성" ? "m" : product.gender === "남녀공용" ? "u" : "w";
  return `${genderPrefix}${categoryCode.slice(1)}${no}`;
}

function normalizeKeyword(value: string, product: Product) {
  const banned = new Set([
    product.category, product.gender, product.material,
    "여성용", "남성용", "남녀공용", "주얼리", "쥬얼리",
    "반지", "귀걸이", "목걸이", "팔찌", "발찌", "피어싱", "브로치", "세트",
  ]);
  return [...new Set(
    value.replace(/[,.，、/|+()[\]{}:;·_-]+/g, " ").split(/\s+/)
      .map(v => v.trim()).filter(Boolean).filter(v => !banned.has(v))
  )].join(" ");
}

function normalizeCompare(value: string) {
  return value.toLowerCase().replace(/\s/g, "");
}

function buildProductTitle(product: Product, cleanedKeyword: string) {
  const material = product.material.trim();
  const gender = product.gender.trim();
  const category = product.category.trim();
  const seen = new Set<string>();
  const parts: string[] = [];
  const addPart = (word: string) => {
    const t = word.trim();
    if (!t) return;
    const key = normalizeCompare(t);
    if (seen.has(key)) return;
    seen.add(key);
    parts.push(t);
  };
  addPart(material);
  for (const token of cleanedKeyword.replace(/[,.，、/|+()[\]{}:;·_\-]+/g, " ").split(/\s+/).map(v => v.trim()).filter(Boolean)) {
    if (token === material || token === gender || token === category || GENDER_WORDS.has(token) || CATEGORY_WORDS.has(token)) continue;
    if (!token || CATEGORY_WORDS.has(token)) continue;
    addPart(token);
  }
  addPart(gender);
  addPart(category);
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

function isAccepted(file: File) {
  return ACCEPTED.includes(file.type) || /\.(jpe?g|png)$/i.test(file.name);
}

function readFile(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function postGoogleSheet(body: unknown, signal?: AbortSignal): Promise<Response> {
  if (!await ensureNoidbActionSession()) throw new Error("관리자 잠금 해제를 취소했습니다.");
  return fetch("/api/google-sheet", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
}

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

async function imageUrlToDataUrl(url: string): Promise<string> {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`대표이미지 조회 실패 (${response.status})`);
  const blob = await response.blob();
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("대표이미지 변환 실패"));
    reader.readAsDataURL(blob);
  });
}

export default function Home() {
  const [product, setProduct] = useState<Product>({ ...DEFAULT_PRODUCT });
  const [supplierOptions, setSupplierOptions] = useState<string[]>(DEFAULT_SUPPLIERS);

  const [photos, setPhotos] = useState<ProductPhoto[]>([]);
  const [photoMessage, setPhotoMessage] = useState("");
  const [draggingPhotos, setDraggingPhotos] = useState(false);
  const [dragPhotoIndex, setDragPhotoIndex] = useState<number | null>(null);

  const [analysis, setAnalysis] = useState<Analysis>({});
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  const sizesUserEditedRef = useRef(false);

  const [mainWear, setMainWear] = useState<SlotImage | null>(null);
  const [allOptions, setAllOptions] = useState<SlotImage | null>(null);
  const [optionThumbs, setOptionThumbs] = useState<Record<string, SlotImage | null>>({});
  const [variantThumbs, setVariantThumbs] = useState<Record<string, SlotImage | null>>({});
  const variantUploadRevision = useRef<Record<string, number>>({});
  const [extra01, setExtra01] = useState<SlotImage | null>(null);
  const [extra02, setExtra02] = useState<SlotImage | null>(null);
  const [extra03, setExtra03] = useState<SlotImage | null>(null);
  const [detailCut, setDetailCut] = useState<SlotImage | null>(null);
  const [wear01, setWear01] = useState<SlotImage | null>(null);
  const [wear02, setWear02] = useState<SlotImage | null>(null);
  const [customSlots, setCustomSlots] = useState<CustomSlot[]>([]);
  const [includeAllOptionsInDetail] = useState(true);
  const [adjustKey, setAdjustKey] = useState("");
  const [adjust, setAdjust] = useState<FitAdjust>(defaultFitAdjust());
  const [adjustPreview, setAdjustPreview] = useState("");
  const [adjustResult, setAdjustResult] = useState("");
  const [lightbox, setLightbox] = useState("");

  const [detailImages, setDetailImages] = useState<DetailImage[]>([]);
  const [detailHeader, setDetailHeader] = useState<SlotImage | null>(null);
  const [detailFooter, setDetailFooter] = useState<SlotImage | null>(null);
  const [detailPreview, setDetailPreview] = useState("");
  // 상단 로고를 붙인 결과 그대로면 같은 로고가 두 번 붙지 않게 버튼을 막는다.
  const [logoAppliedPreview, setLogoAppliedPreview] = useState("");
  const [squareImagesBusy, setSquareImagesBusy] = useState(false);
  /** 개별 다운로드 메시지를 버튼이 있는 칸에만 보여준다(5번 이미지 · 6번 상세 · 8번 기타). */
  const [exportArea, setExportArea] = useState<"images" | "detail" | "etc">("etc");
  const [squareImagesMessage, setSquareImagesMessage] = useState("");
  const [detailMessage, setDetailMessage] = useState("");
  const [detailShareUrl, setDetailShareUrl] = useState("");
  const [detailShareLoading, setDetailShareLoading] = useState(false);
  const [detailShareError, setDetailShareError] = useState("");
  useEffect(() => {
    setDetailShareUrl("");
    setDetailShareError("");
  }, [detailPreview]);
  const [incomingDetailFile, setIncomingDetailFile] = useState<File | null>(null);
  const [incomingDetailToken, setIncomingDetailToken] = useState(0);
  const [preparedDetail, setPreparedDetail] = useState<PreparedDetail | null>(null);
  const [dragDetailIndex, setDragDetailIndex] = useState<number | null>(null);

  const [sourcingUrls, setSourcingUrls] = useState(["", "", ""]);
  const [sourcingUrlInputs, setSourcingUrlInputs] = useState(["", "", ""]);
  const [sourcingMessage, setSourcingMessage] = useState("");
  const [sourcingAnalysis, setSourcingAnalysis] = useState<SourcingAnalysis>({});
  const [sourcingLoading, setSourcingLoading] = useState(false);
  const [sourcingImages, setSourcingImages] = useState<ProductPhoto[]>([]);
  const [sourcingSaveStatus, setSourcingSaveStatus] = useState("");
  const [uploadPool, setUploadPool] = useState<SlotImage[]>([]);

  const [exportLoading, setExportLoading] = useState("");
  const [exportMessage, setExportMessage] = useState("");
  const [labelManufactureYearMonth, setLabelManufactureYearMonth] = useState(DEFAULT_LABEL_YEAR_MONTH);
  const [labelManufacturerName, setLabelManufacturerName] = useState("프리스타일 협력사");
  const [labelImporterName, setLabelImporterName] = useState("프리스타일");
  const [batchBusy, setBatchBusy] = useState(false);
  const [batchStatus, setBatchStatus] = useState("");
  const [batchMode, setBatchMode] = useState<"practice" | "actual">("actual");
  const [quoteQueue, setQuoteQueue] = useState<QuoteQueueRecord[]>([]);
  const [quoteQueueBusy, setQuoteQueueBusy] = useState("");
  const [drafts, setDrafts] = useState<ListedProductDraft[]>([]);
  const [showDrafts, setShowDrafts] = useState(false);
  const [draftStatus, setDraftStatus] = useState("");
  const [draftSaving, setDraftSaving] = useState(false);
  const draftSavingRef = useRef(false);
  const draftRefreshRef = useRef(0);
  const restoringDraftRef = useRef(false);
  /** 상세페이지 사진 목록을 직접 끌어 순서를 바꿨는지. 바꾸기 전에는 5번 칸 순서를 그대로 따른다. */
  const detailOrderEditedRef = useRef(false);
  const leavingForPhotosRef = useRef(false);
  const router = useRouter();
  const detailImagesRef = useRef<DetailImage[]>([]);
  detailImagesRef.current = detailImages;
  const detailPreviewRef = useRef("");
  detailPreviewRef.current = detailPreview;
  // 상세페이지 목록에서 사용자가 지운 5번 칸 사진(id → 그때의 이미지). 같은 사진은 자동으로 다시 넣지 않는다.
  const dismissedDetailSlotsRef = useRef(new Map<string, string>());
  const [draftRestoreRevision, setDraftRestoreRevision] = useState(0);
  const [modelDuplicate, setModelDuplicate] = useState(false);
  const [modelCheckMessage, setModelCheckMessage] = useState("");
  const [modelReregisterable, setModelReregisterable] = useState(false);
  const [pendingReplacementCleanup, setPendingReplacementCleanup] = useState<PendingReplacementCleanup | null>(null);
  const [reregistrationMessage, setReregistrationMessage] = useState("");
  const [titleBackup, setTitleBackup] = useState("");
  const [tagsBackup, setTagsBackup] = useState("");
  const [reregisterModelName, setReregisterModelName] = useState("");
  /** 제품DB에 없는 로켓 미등록 모델을 신규 등록 중 — 모델명은 고정하되, 채울 값이 없으므로 AI 분석 결과로 기본정보를 채운다. */
  const [rocketNewModel, setRocketNewModel] = useState(false);

  const [dbSupported, setDbSupported] = useState(false);
  const [dbHandle, setDbHandle] = useState<FileSystemDirectoryHandle | null>(null);
  const [dbFolderName, setDbFolderName] = useState("");
  const [folderPathMessage, setFolderPathMessage] = useState("");
  const [dbStatus, setDbStatus] = useState("");
  const [dbSavedFiles, setDbSavedFiles] = useState<string[]>([]);
  const [registrationUploadReady, setRegistrationUploadReady] = useState<{ model: string; files: string[] } | null>(null);
  const uploadPoolInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setDbSupported(supportsDirectoryPicker());
    (async () => {
      try {
        const handle = await loadDirectoryHandle();
        if (!handle) return;
        if (!(await ensureReadWritePermission(handle))) {
          setDbStatus("저장된 폴더 권한이 없습니다. 다시 선택해주세요.");
          return;
        }
        setDbHandle(handle);
        setDbFolderName(handle.name);
        setDbStatus(`저장폴더 연결 완료: ${handle.name}`);
      } catch {
        setDbStatus("저장된 폴더 연결을 복원하지 못했습니다.");
      }
    })();

    try {
      if (new URLSearchParams(window.location.search).has("reregisterModel") || new URLSearchParams(window.location.search).has("rocketModel")) return;
      // 제품사진선택에서 등록 준비 없이(뒤로 가기 등) 돌아온 경우에도 나가기 전 작업을 다시 연다.
      if (sessionStorage.getItem(PHOTO_SELECT_RETURN_KEY)) {
        void restoreWorkAfterPhotoSelect();
        return;
      }
      const legacyKey = localStorage.getItem(LAURA_DRAFT_STORAGE_KEY) ? LAURA_DRAFT_STORAGE_KEY : LEGACY_DRAFT_STORAGE_KEY;
      const legacyRaw = localStorage.getItem(legacyKey);
      const raw = localStorage.getItem(DRAFT_STORAGE_KEY) || legacyRaw;
      if (!raw) return;
      if (legacyRaw) {
        localStorage.setItem(DRAFT_STORAGE_KEY, raw);
        localStorage.removeItem(legacyKey);
      }
      const draft = JSON.parse(raw);
      if (draft.product) setProduct((prev: Product) => ({
        ...prev,
        ...draft.product,
        supplier: normalizeSupplierName(draft.product.supplier || prev.supplier),
      }));
      if (draft.analysis) setAnalysis(draft.analysis);
      if (Array.isArray(draft.photos) && draft.photos.length) {
        setPhotos(
          draft.photos.map((p: any, i: number) => ({
            id: p.id || `p-${i}`,
            name: p.name || `사진${i + 1}.jpg`,
            dataUrl: p.dataUrl,
          })).filter((p: ProductPhoto) => p.dataUrl?.startsWith("data:image/"))
        );
      } else if (typeof draft.imageDataUrl === "string" && draft.imageDataUrl.startsWith("data:image/")) {
        setPhotos([{ id: "legacy", name: "기존사진.jpg", dataUrl: draft.imageDataUrl }]);
      }
      if (draft.mainWear) setMainWear(draft.mainWear);
      if (draft.allOptions) setAllOptions(draft.allOptions);
      if (draft.optionThumbs) setOptionThumbs(draft.optionThumbs);
      if (draft.variantThumbs) setVariantThumbs(draft.variantThumbs);
      if (draft.extra01) setExtra01(draft.extra01);
      if (draft.extra02) setExtra02(draft.extra02);
      if (draft.extra03) setExtra03(draft.extra03);
      if (draft.detailCut) setDetailCut(draft.detailCut);
      if (draft.wear01) setWear01(draft.wear01);
      if (draft.wear02) setWear02(draft.wear02);
      if (Array.isArray(draft.detailImages)) setDetailImages(draft.detailImages);
      if (typeof draft.detailPreview === "string") setDetailPreview(draft.detailPreview);
      if (typeof draft.sourcingUrl === "string" && draft.sourcingUrl) {
        const urls = draft.sourcingUrl.split(/\r?\n/).filter(Boolean).slice(0, 3);
        const restored = [urls[0] || "", urls[1] || "", urls[2] || ""];
        setSourcingUrls(restored);
        setSourcingUrlInputs(restored);
      }
      setMessage("임시저장된 정보를 불러왔습니다.");
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    // rocketModel = 제품DB에 없는 로켓 미등록 모델(사진선택 "로켓 미등록" 보기에서 등록 준비). 신규 등록으로 연다.
    const rocketModel = params.get("rocketModel")?.trim() || "";
    const requestedModel = params.get("reregisterModel")?.trim() || rocketModel;
    if (!requestedModel) return;
    let active = true;
    void (async () => {
      try {
        const exclusionsResponse = await fetch("/api/wms/reregistration-exclusions", { cache: "no-store" });
        if (!exclusionsResponse.ok) throw new Error("재등록 제외 목록을 확인하지 못했습니다.");
        const exclusions = await exclusionsResponse.json();
        if (exclusions.entries?.[requestedModel.toLowerCase()]) throw new Error(`${requestedModel}은 재등록 제외 모델입니다: ${exclusions.entries[requestedModel.toLowerCase()].reason}`);
        const response = await fetch(rocketModel ? `/api/wms/rocket-pending?model=${encodeURIComponent(rocketModel)}` : "/api/wms/product-registration-catalog", { cache: "no-store" });
        const data = await response.json();
        if (!response.ok || !Array.isArray(data.items)) throw new Error(data?.error || "재등록 대상 조회 실패");
        const group = data.items.filter((item: any) => String(item.modelName || "").trim().toLowerCase() === requestedModel.toLowerCase());
        if (!group.length) throw new Error(`${requestedModel} 모델을 ${rocketModel ? "로켓 미등록 목록" : "제품DB"}에서 찾지 못했습니다.`);
        if (active) setRocketNewModel(Boolean(rocketModel));
        if (group.some((item: any) => String(item.reregistrationTier || "").startsWith("영구제외"))) throw new Error(`${requestedModel}은 제품DB에서 영구제외된 모델입니다.`);
        if (active) setReregisterModelName(requestedModel);
        const first = group[0];
        const optionText = group.map((item: any) => {
          const label = String(item.optionLabel || "").split("|").pop()?.trim() || "";
          return label === String(item.modelSku || "").trim() ? "" : label.replace(/^\[색상\]\s*/, "");
        });
        const colors = [...new Set(optionText.map((value: string) => value.replace(/\s*\d+(?:\.\d+)?\s*호\s*$/u, "").trim()).filter(Boolean))];
        const digits = requestedModel.match(/\d+/)?.[0] || "";
        if (!active) return;
        // 작업하다 제품사진선택으로 나갔다가 돌아온 경우: 입력·이미지를 처음 상태로 덮지 않고
        // 나가기 전 임시저장을 다시 연 뒤, 새로 고른 사진만 업로드 풀 뒤에 붙인다.
        const returned = await restoreWorkAfterPhotoSelect(requestedModel);
        if (!active) return;
        if (returned) {
          const added = await loadPreparedPhotos(requestedModel).catch(() => []);
          if (!active) return;
          if (added.length) {
            setUploadPool(current => {
              const known = new Set(current.map(image => image.dataUrl));
              const fresh = added.filter(photo => !known.has(photo.dataUrl)).map(photo => ({ dataUrl: photo.dataUrl, fileName: photo.name }));
              setPhotoMessage(fresh.length ? `제품사진선택에서 고른 사진 ${fresh.length}장을 업로드 풀 뒤에 추가했습니다. 슬롯에 넣어 쓰세요.` : "제품사진선택에서 새로 추가된 사진은 없습니다.");
              return [...current, ...fresh];
            });
          }
          return;
        }
        setProduct({
          ...DEFAULT_PRODUCT,
          supplier: String(first.vendorName || ""),
          category: String(first.category || ""),
          gender: String(first.gender || ""),
          modelName: requestedModel,
          modelNo: digits,
          colors: colors.join(","),
          // 제품DB에 사이즈가 비어 있으면 카테고리 기본값(목걸이 = FREE)을 넣는다.
          sizes: String(first.jewelrySize || "").trim() || defaultSizes(String(first.gender || ""), String(first.category || "")),
          // 제품DB 상품명 끝에 붙은 옵션(", 유광골드" 등)은 빼고 첫 번째 쉼표 앞의 상품명만 가져온다.
          coupangTitle: String(first.productName || "").split(",")[0].trim(),
          dimension: String(first.dimension || ""),
          cost: String(first.costVatIncluded || ""),
          price: String(first.salePrice || ""),
          warehouse: String(first.warehouseNumber || ""),
          keyword: "", searchTags: "", replacementSku: "",
        });
        const selectedPhotos = await loadPreparedPhotos(requestedModel).catch(() => []);
        if (!active) return;
        if (selectedPhotos.length) {
          // 첫 장 = 연결 대장에서 '분석용'으로 지정한 사진(savePreparedPhotos가 맨 앞에 둔다).
          // 분석에는 그 1장만 쓰고, 선택한 전체 사진(분석용 포함)은 업로드 풀로 보내 슬롯은 사용자가 지정한다.
          const preparedSlots = selectedPhotos.map(photo => ({ dataUrl: photo.dataUrl, fileName: photo.name }));
          setPhotos([{ id: selectedPhotos[0].id, name: selectedPhotos[0].name, dataUrl: selectedPhotos[0].dataUrl }]);
          setUploadPool(preparedSlots);
          setPhotoMessage("");
          return;
        }
        const imageUrl = getWmsDisplayImageUrl(String(first.imageUrl || ""));
        if (imageUrl) {
          try {
            const dataUrl = await imageUrlToDataUrl(imageUrl);
            if (active && dataUrl.startsWith("data:image/")) {
              const fallbackName = `${requestedModel}-기존대표이미지`;
              setPhotos([{ id: `catalog:${requestedModel}`, name: fallbackName, dataUrl }]);
              setUploadPool([{ dataUrl, fileName: fallbackName }]);
              setPhotoMessage("기존 대표이미지를 업로드 풀에 준비했습니다. 슬롯은 사용자가 직접 지정해주세요.");
            }
          } catch {
            if (active) setPhotoMessage("기존 대표이미지를 불러오지 못했습니다. 사진 후보에서 직접 선택해주세요.");
          }
        }
      } catch (error) {
        if (active) setReregistrationMessage(`재등록 대상 불러오기 실패: ${error instanceof Error ? error.message : "제품DB 조회 실패"}`);
      }
    })();
    return () => { active = false; };
  }, []);

  // 재등록 모델이 정해지면(재등록 목록에서 열었거나 재등록 임시저장을 불러왔을 때) 사진선택에서
  // 골라 둔 기존 상세페이지를 다시 찾아 "기존상세페이지 사용" 버튼을 보여준다.
  useEffect(() => {
    setPreparedDetail(null);
    if (!reregisterModelName) return;
    let active = true;
    void loadPreparedDetail(reregisterModelName)
      .then(detail => { if (active) setPreparedDetail(detail); })
      .catch(() => undefined);
    return () => { active = false; };
  }, [reregisterModelName]);

  useEffect(() => {
    void (async () => {
      try {
        const response = await fetch(`/api/google-sheet?action=supplierList&t=${Date.now()}`, { cache: "no-store" });
        const data = await response.json();
        if (response.ok && Array.isArray(data.suppliers)) {
          setSupplierOptions(mergeSupplierOptions([...DEFAULT_SUPPLIERS, ...data.suppliers]));
        }
      } catch {
        setSupplierOptions(mergeSupplierOptions(DEFAULT_SUPPLIERS));
      }
    })();
  }, []);

  const model = useMemo(() => {
    return product.modelName?.trim() || buildAutoModel(product);
  }, [product.category, product.gender, product.modelNo, product.modelName]);

  // 대부분 실제 등록이므로 기본은 실제 등록용이다. 테스트·교육용은 그 상품에서만 쓰고, 다른 상품으로 바뀌면 실제 등록용으로 돌아간다.
  useEffect(() => {
    setBatchMode("actual");
  }, [model, product.category]);

  useEffect(() => {
    let active = true;
    setModelReregisterable(false);
    setModelCheckMessage("");
    if (!model) {
      setModelDuplicate(false);
      setModelCheckMessage("");
      return;
    }
    const timer = window.setTimeout(async () => {
      const result = await checkModelInGoogleDb(model);
      if (!active) return;
      setModelDuplicate(result.duplicate);
      setModelReregisterable(result.reregisterable);
      setModelCheckMessage(result.message);
    }, 450);
    return () => { active = false; window.clearTimeout(timer); };
  }, [model]);

  const cleanedKeyword = useMemo(() => normalizeKeyword(product.keyword, product), [product]);
  const generatedTitle = useMemo(() => buildProductTitle(product, cleanedKeyword), [product, cleanedKeyword]);
  const generatedTags = useMemo(() => {
    const designWords = cleanedKeyword.split(/\s+/).filter(Boolean);
    const colors = product.colors.split(",").map(v => v.trim()).filter(Boolean);
    return [...new Set([
      `${product.material}${product.category}`,
      `${product.gender}${product.category}`,
      ...designWords.map(w => `${w}${product.category}`),
      `데일리${product.category}`,
      `패션${product.category}`,
      `선물용${product.category}`,
      ...colors.map(c => `${c}${product.category}`),
    ].filter(Boolean))].slice(0, 10).join(",");
  }, [product, cleanedKeyword]);
  const title = product.coupangTitle?.trim() || generatedTitle;
  const tags = product.searchTags?.trim() || generatedTags;
  const availableSuppliers = useMemo(
    () => mergeSupplierOptions([...supplierOptions, product.supplier]),
    [supplierOptions, product.supplier]
  );

  const ready = Boolean(
    product.supplier && product.category && product.material && product.colors &&
    product.sizes && product.modelNo && product.keyword && product.price
  );

  const variantOptions = useMemo(() => {
    try {
      const rows: VariantOption[] = buildSkuRows({ model: "", product }).map(row => ({
        ...row, key: JSON.stringify([product.category, row.color, row.size]), label: `${row.color} ${row.size}`,
      }));
      return { rows, error: "" };
    } catch (error) {
      return { rows: [] as VariantOption[], error: error instanceof Error ? error.message : "색상과 사이즈를 확인해주세요." };
    }
  }, [product.category, product.colors, product.sizes]);
  const variants = variantOptions.rows;
  const activeVariantThumbs = useMemo(() => Object.fromEntries(variants.map(variant => [
    variant.key,
    Object.prototype.hasOwnProperty.call(variantThumbs, variant.key)
      ? variantThumbs[variant.key]
      : variants.filter(item => item.color === variant.color).length === 1 ? optionThumbs[variant.color] || null : null,
  ])), [variants, variantThumbs, optionThumbs]);
  const legacyColorThumbs = Object.entries(optionThumbs).filter(([color, slot]) =>
    slot?.dataUrl && variants.filter(variant => variant.color === color).length > 1);
  const requireVariantImages = () => {
    if (variantOptions.error) throw new Error(variantOptions.error);
    if (!variants.length) throw new Error("색상과 사이즈 옵션을 먼저 입력해주세요.");
    const missing = variants.filter(variant => !activeVariantThumbs[variant.key]?.dataUrl);
    if (missing.length) throw new Error(`옵션 사진을 모두 올려주세요: ${missing.map(variant => variant.label).join(", ")}`);
  };
  const quoteGroups = useMemo(() => {
    const groups = new Map<string, { key: string; gender: string; category: string; models: number; modelNames: string[]; skuCount: number; records: QuoteQueueRecord[] }>();
    quoteQueue.forEach(record => {
      const key = `${record.gender}\u0000${record.category}`;
      const group = groups.get(key) || { key, gender: record.gender, category: record.category, models: 0, modelNames: [], skuCount: 0, records: [] };
      if (record.model && !group.modelNames.includes(record.model)) group.modelNames.push(record.model);
      group.models = group.modelNames.length;
      group.skuCount += Number(record.skuCount || 0);
      group.records.push(record);
      groups.set(key, group);
    });
    return [...groups.values()].sort((a, b) => `${a.gender}${a.category}`.localeCompare(`${b.gender}${b.category}`, "ko"));
  }, [quoteQueue]);

  useEffect(() => {
    if (restoringDraftRef.current) {
      restoringDraftRef.current = false;
      return;
    }
    const automatic: DetailImage[] = [];
    const add = (id: string, name: string, slot: SlotImage | null | undefined) => {
      if (slot?.dataUrl) automatic.push({ id: `slot:${id}`, name, dataUrl: slot.dataUrl });
    };
    add("mainWear", "메인착용컷", mainWear);
    add("all", "전체옵션", allOptions);
    variants.forEach(variant => add(`variant:${variant.key}`, `${variant.label} 썸네일`, activeVariantThumbs[variant.key]));
    add("detail", "디테일컷", detailCut);
    add("wear01", "착용컷 01", wear01);
    add("wear02", "착용컷 02", wear02);
    customSlots.forEach((item, index) => add(`custom:${item.id}`, `${item.type === "all" ? "전체옵션" : item.type === "detail" ? "디테일컷" : "착용컷"} 추가 ${index + 1}`, item.slot));
    // 상세페이지를 한 번 만든 뒤에도 5번 칸에 새로 넣은 사진이 목록에 들어오도록 항상 동기화한다.
    // 사용자가 정한 순서는 유지하고, 새 사진만 뒤에 붙이며, 사용자가 목록에서 지운 사진은 다시 넣지 않는다.
    const prev = detailImagesRef.current;
    if (reregisterModelName && prev.some(item => !item.id.startsWith("slot:"))) return;
    let changed = false;
    {
      const byId = new Map(automatic.map(item => [item.id, item]));
      const kept: DetailImage[] = [];
      prev.forEach(item => {
        if (!item.id.startsWith("slot:")) { kept.push(item); return; }
        const current = byId.get(item.id);
        if (!current) { changed = true; return; }
        if (current.dataUrl !== item.dataUrl || current.name !== item.name) {
          changed = true;
          kept.push({ ...item, name: current.name, dataUrl: current.dataUrl });
        } else kept.push(item);
      });
      const existing = new Set(prev.map(item => item.id));
      const added = automatic.filter(item =>
        !existing.has(item.id) && dismissedDetailSlotsRef.current.get(item.id) !== item.dataUrl);
      if (added.length) changed = true;
      // 목록을 직접 끌어 순서를 바꾸기 전에는 항상 5번 칸 순서(메인착용컷 → 전체옵션 → 옵션 썸네일 → 디테일컷 → 착용컷 → 추가 칸)를 따른다.
      // 직접 바꾼 뒤에는 그 순서를 지키고, 새 사진은 칸 순서상 바로 앞 사진 뒤에 끼워 넣는다.
      const slotOrder = new Map(automatic.map((item, index) => [item.id, index]));
      let next: DetailImage[];
      if (!detailOrderEditedRef.current) {
        const slotItems = [...kept.filter(item => item.id.startsWith("slot:")), ...added].sort((a, b) => (slotOrder.get(a.id) ?? 0) - (slotOrder.get(b.id) ?? 0));
        next = [...slotItems, ...kept.filter(item => !item.id.startsWith("slot:"))];
      } else {
        next = [...kept];
        for (const item of added) {
          const order = slotOrder.get(item.id) ?? 0;
          let at = 0;
          next.forEach((existingItem, index) => { if ((slotOrder.get(existingItem.id) ?? -1) < order && existingItem.id.startsWith("slot:")) at = index + 1; });
          next.splice(at, 0, item);
        }
      }
      if (!changed && next.some((item, index) => item.id !== prev[index]?.id)) changed = true;
      if (changed) {
        detailImagesRef.current = next;
        setDetailImages(next);
      }
    }
    if (changed && detailPreviewRef.current) {
      setDetailMessage("상세페이지 사진 목록이 바뀌었습니다. 반영하려면 780px 상세페이지 만들기를 다시 눌러주세요.");
    }
  }, [mainWear, allOptions, activeVariantThumbs, variants, detailCut, wear01, wear02, customSlots, draftRestoreRevision, reregisterModelName]);

  const update = (key: keyof Product, value: string) => {
    setProduct(prev => {
      const next = { ...prev, [key]: value };
      if (key === "gender" || key === "category") {
        sizesUserEditedRef.current = false;
        next.sizes = defaultSizes(next.gender, next.category);
        next.material = "써지컬스틸";
      }
      if (key === "category") next.dimension = defaultDimension(value);
      if (key === "gender" && value === "남성") {
        next.colors = "실버";
      }
      if (!reregisterModelName && (key === "gender" || key === "category" || key === "modelNo")) {
        next.modelName = buildAutoModel(next);
      }
      return next;
    });
  };

  const updateModel = (value: string) => {
    setProduct(prev => {
      const digits = value.match(/\d+/)?.[0];
      return {
        ...prev,
        modelName: value,
        modelNo: digits || prev.modelNo,
      };
    });
  };

  const updateSizes = (value: string) => {
    sizesUserEditedRef.current = true;
    setProduct(prev => ({ ...prev, sizes: value }));
  };

  const linkExistingReplacement = async () => {
    if (!model || !product.replacementSku?.trim()) {
      setModelCheckMessage("현재 새 모델명과 기존 대표 SKU ID를 입력해주세요.");
      return;
    }
    const legacySku = product.replacementSku.trim();
    if (!window.confirm(`${model}에 구 SKU ${legacySku}의 옵션별 창고번호와 재고 이력을 이관할까요?\n\n이 단계에서는 기존행을 삭제하지 않습니다.`)) return;
    const requestLink = async (forceLegacyOptions: boolean) => {
      const linkPayload = exportPayload();
      const response = await postGoogleSheet({
        action: "linkReplacementExisting",
        model,
        replacementSku: legacySku,
        forceLegacyOptions,
        payload: { ...linkPayload, optionImages: {}, skuImages: undefined },
      });
      const responseText = await response.text();
      let data: any = {};
      try { data = JSON.parse(responseText); }
      catch { throw new Error(responseText.startsWith("Request Entity Too Large") ? "연결 요청 용량이 너무 큽니다. 최신 버전으로 다시 시도해주세요." : "서버 응답을 읽지 못했습니다."); }
      if (!response.ok || !data.ok) throw new Error(data.error || "기존 SKU 연결 실패");
      return data;
    };
    setModelCheckMessage("기존 SKU 정보를 연결하고 있습니다...");
    try {
      let data: any;
      try {
        data = await requestLink(false);
      } catch (initialError) {
        const reason = initialError instanceof Error ? initialError.message : "";
        if (!reason.includes("색상·사이즈 옵션을 연결하지 못했습니다") && !reason.includes("새 옵션과 연결할 수 없습니다")) throw initialError;
        const counts = reason.match(/\[기존\s*(\d+)개\s*\/\s*새\s*(\d+)개\]/);
        const countText = counts ? `\n\n기존 옵션 ${counts[1]}개 · 새 옵션 ${counts[2]}개` : "";
        const proceed = window.confirm(
          `예전 상품은 색상·사이즈 표기 방식이 달라 자동 연결할 수 없습니다.${countText}\n\n기존 제품DB 저장 순서대로 연결할까요? 대응되는 기존 행이 없는 새 옵션은 창고번호를 비워둡니다.`
        );
        if (!proceed) {
          setModelCheckMessage("기존 옵션 연결을 취소했습니다. 기존 제품DB 행은 변경되지 않았습니다.");
          return;
        }
        setModelCheckMessage("구형 옵션을 기존 저장 순서대로 연결하고 있습니다...");
        data = await requestLink(true);
      }
      const warehouses = Array.isArray(data.warehouses) ? data.warehouses.filter(Boolean) : [];
      if (data.cleanupAvailable) {
        setPendingReplacementCleanup({ model, legacySku, oldRows: Number(data.oldRows || 0), matchedOptions: Number(data.matchedOptions || 0) });
      } else if (data.recoveredFromHistory) {
        setPendingReplacementCleanup(null);
      }
      setModelCheckMessage(
        `기존 상품 연결 완료 · 옵션 ${Number(data.matchedOptions || 0).toLocaleString()}개 이관` +
        `${Number(data.unmatchedNew || 0) ? ` · 새 옵션 ${Number(data.unmatchedNew).toLocaleString()}개는 기존 행 없음` : ""}` +
        ` · 창고번호 ${warehouses.length ? warehouses.join(", ") : "없음"}` +
        `${data.recoveredFromHistory ? " · 교체이력에서 복구" : ""}${data.forcedFallback ? " · 구형 옵션 저장순서로 연결" : ""}` +
        `${data.cleanupAvailable ? " · 제품DB 확인 후 아래 버튼으로 기존행 삭제 또는 연결 취소" : " · 기존 활성행 없음"}`
      );
    } catch (error) {
      setModelCheckMessage(`오류: ${error instanceof Error ? error.message : "기존 SKU 연결 실패"}`);
    }
  };

  const deleteLinkedLegacyRows = async () => {
    const pending = pendingReplacementCleanup;
    if (!pending) return;
    const confirmed = window.confirm(
      `정보를 이관하고 기존행을 삭제하겠습니까?\n\n${pending.model} · 이관 ${pending.matchedOptions.toLocaleString()}건 · 삭제 대상 ${pending.oldRows.toLocaleString()}행\n확인을 누른 경우에만 기존행을 삭제합니다.`
    );
    if (!confirmed) {
      setModelCheckMessage("기존행 삭제를 취소했습니다. 기존행은 그대로 유지됩니다.");
      return;
    }
    setModelCheckMessage("확인된 기존행만 삭제하고 있습니다...");
    try {
      const response = await postGoogleSheet({ action: "deleteReplacementLegacyRows", model: pending.model, replacementSku: pending.legacySku, confirmed: true });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "기존행 삭제 실패");
      setPendingReplacementCleanup(null);
      setProduct(prev => ({ ...prev, replacementSku: "" }));
      setModelCheckMessage(`정보 이관 완료 · 확인한 기존 ${Number(data.deleted || 0).toLocaleString()}행 삭제 완료`);
    } catch (error) {
      setModelCheckMessage(`오류: ${error instanceof Error ? error.message : "기존행 삭제 실패"}`);
    }
  };

  const undoLinkedReplacement = async () => {
    const pending = pendingReplacementCleanup;
    if (!pending) return;
    if (!window.confirm(`${pending.model}의 이번 SKU 연결을 취소하고 기존행을 복원할까요?`)) return;
    setModelCheckMessage("기존행을 복원하고 있습니다...");
    try {
      const response = await postGoogleSheet({ action: "undoReplacementLink", model: pending.model, replacementSku: pending.legacySku });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "연결 취소 실패");
      setPendingReplacementCleanup(null);
      setProduct(prev => ({ ...prev, replacementSku: "" }));
      setModelCheckMessage(`SKU 연결 취소 완료 · 기존 ${Number(data.restored || 0).toLocaleString()}행 복원`);
    } catch (error) {
      setModelCheckMessage(`오류: ${error instanceof Error ? error.message : "연결 취소 실패"}`);
    }
  };

  const addPhotoFiles = async (fileList: FileList | File[]) => {
    const files = Array.from(fileList).filter(isAccepted);
    if (!files.length) {
      setPhotoMessage("JPG/JPEG/PNG만 업로드할 수 있습니다.");
      return;
    }
    const room = MAX_PHOTOS - photos.length;
    if (room <= 0) {
      setPhotoMessage(`사진은 최대 ${MAX_PHOTOS}장까지입니다.`);
      return;
    }
    const slice = files.slice(0, room);
    const items: ProductPhoto[] = [];
    for (const file of slice) {
      items.push({
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        name: file.name,
        dataUrl: await readFile(file),
      });
    }
    setPhotos(prev => [...prev, ...items]);
    setPhotoMessage(`${items.length}장 추가됨. 첫 번째 사진이 AI 분석에 사용됩니다.`);
  };

  const removePhoto = (id: string) => {
    setPhotos(prev => prev.filter(p => p.id !== id));
  };

  const reorderPhoto = (from: number, to: number) => {
    if (from === to) return;
    setPhotos(prev => {
      const next = [...prev];
      const [m] = next.splice(from, 1);
      next.splice(to, 0, m);
      return next;
    });
  };

  const analyzeImage = async () => {
    if (!photos[0]) {
      setMessage("AI 분석용으로 사용할 제품사진을 먼저 올려주세요. (첫 번째 사진)");
      return;
    }
    setLoading(true);
    setMessage("AI가 첫 번째 사진을 분석하고 있습니다...");
    try {
      const compressed = await compressImageDataUrl(photos[0].dataUrl, 1600, 0.82);
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageDataUrl: compressed, current: product }),
      });
      let data: any = null;
      try {
        data = await res.json();
      } catch {
        data = null;
      }
      if (!res.ok) {
        setMessage(
          res.status === 413
            ? "AI 분석용 사진 1장을 지정해주세요. (요청 용량 초과)"
            : `오류: ${data?.error || "AI 분석에 실패했습니다."}`
        );
        return;
      }
      if (!data) {
        setMessage("오류: AI 분석 결과를 해석하지 못했습니다.");
        return;
      }
      setProduct(prev => {
        // 재등록은 제품DB의 실제 값(치수·사이즈·성별·카테고리)을 이미 채워뒀으니, AI의 일반적인
        // 추정값으로 덮어쓰지 않는다. 검색어(keyword)만 참고용으로 갱신한다.
        if (reregisterModelName && !rocketNewModel) {
          return {
            ...prev,
            keyword: normalizeKeyword(data.keyword || prev.keyword, prev),
          };
        }
        const analyzedGender = data.gender || prev.gender;
        const next = {
          ...prev,
          category: data.category || prev.category,
          gender: analyzedGender,
          material: "써지컬스틸",
          colors: analyzedGender === "남성" ? "실버" : (prev.colors.trim() ? prev.colors : (data.colors || prev.colors)),
          keyword: normalizeKeyword(data.keyword || prev.keyword, {
            ...prev,
            category: data.category || prev.category,
            gender: analyzedGender,
            material: "써지컬스틸",
          }),
          dimension: data.category && data.category !== prev.category
            ? defaultDimension(data.category)
            : prev.dimension,
        };
        next.modelName = buildAutoModel(next);
        if (!sizesUserEditedRef.current) {
          next.sizes = defaultSizes(next.gender, next.category);
        }
        return next;
      });
      setAnalysis(data);
      setMessage("AI 사진분석이 완료되었습니다. 기본정보를 확인하세요.");
    } catch (e) {
      setMessage(`오류: ${e instanceof Error ? e.message : "분석 실패"}`);
    } finally {
      setLoading(false);
    }
  };

  const materialCategoryKeywords = product.material === "써지컬스틸"
    ? [`써지컬스틸 ${product.category}`, `티타늄 ${product.category}`]
    : [`${product.material} ${product.category}`];
  const searchKeyword = materialCategoryKeywords.join(" OR ");
  const sourcingUrl = sourcingUrls.filter(Boolean).join("\n");

  const openGoogleImages = () => {
    openExternalUrl(`https://www.google.com/search?tbm=isch&q=${encodeURIComponent(searchKeyword)}`);
  };

  const open1688Search = () => {
    openExternalUrl(`https://s.1688.com/selloffer/offer_search.htm?keywords=${encodeURIComponent(materialCategoryKeywords[0])}`);
  };

  const openCoupangSearch = () => {
    openExternalUrl(`https://www.coupang.com/np/search?q=${encodeURIComponent(materialCategoryKeywords[0])}`);
  };

  const analyzeSourcingImage = async () => {
    if (!photos[0]) {
      setSourcingMessage("제품사진을 먼저 올려주세요.");
      return;
    }
    setSourcingLoading(true);
    setSourcingMessage("사진의 소재·분류·디자인을 조합해 검색어를 만들고 있습니다...");
    try {
      const imageDataUrl = await compressImageDataUrl(photos[0].dataUrl, 1600, 0.82);
      const res = await fetch("/api/sourcing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageDataUrl, current: product }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "검색어 분석 실패");
      setSourcingAnalysis(data);
      setSourcingMessage("사진 기반 검색어가 준비되었습니다. 중국어 뜻을 확인한 뒤 검색할 수 있습니다.");
    } catch (e) {
      setSourcingMessage(`오류: ${e instanceof Error ? e.message : "검색어 분석 실패"}`);
    } finally {
      setSourcingLoading(false);
    }
  };

  const addSourcingFiles = async (fileList: FileList | File[]) => {
    const items: ProductPhoto[] = [];
    for (const file of Array.from(fileList).filter(isAccepted)) {
      items.push({ id: `${Date.now()}-${Math.random()}`, name: file.name, dataUrl: await readFile(file) });
    }
    setSourcingImages(prev => [...prev, ...items]);
    setSourcingSaveStatus(`${items.length}장의 이미지를 추가했습니다.`);
  };

  const createSourcingFolder = async () => {
    if (!dbHandle) return setSourcingSaveStatus("먼저 상품DB 폴더를 선택해주세요.");
    if (!model || !product.category) return setSourcingSaveStatus("카테고리와 모델명을 먼저 확인해주세요.");
    try {
      await ensureProductFolderTree(dbHandle, product.category, model);
      setSourcingSaveStatus(`폴더 생성 완료: ${product.category}/${model}/`);
    } catch (e) {
      setSourcingSaveStatus(`오류: ${e instanceof Error ? e.message : "폴더 생성 실패"}`);
    }
  };

  const saveSourcingImages = async () => {
    if (!dbHandle) return setSourcingSaveStatus("먼저 상품DB 폴더를 선택해주세요.");
    if (!sourcingImages.length) return setSourcingSaveStatus("저장할 이미지를 추가해주세요.");
    const files = sourcingImages.map((item, index) => ({
      folder: "원본",
      filename: `수집이미지_${String(index + 1).padStart(2, "0")}.jpg`,
      blob: dataUrlToBlob(item.dataUrl),
      path: `원본/수집이미지_${String(index + 1).padStart(2, "0")}.jpg`,
    }));
    try {
      const saved = await writeProductDbFiles(dbHandle, product.category, model, files);
      setSourcingSaveStatus(`이미지 ${saved.length}장 저장 완료 → ${product.category}/${model}/원본/`);
    } catch (e) {
      setSourcingSaveStatus(`오류: ${e instanceof Error ? e.message : "이미지 저장 실패"}`);
    }
  };

  // 4번(수집이미지)과 7번(등록파일 저장 확인)에서 함께 쓴다. 안내 문구는 누른 칸에 보여준다.
  const openModelFolder = async (setStatus: (message: string) => void = setSourcingSaveStatus) => {
    if (!dbHandle) return setStatus("먼저 상품DB 폴더를 선택해주세요.");
    if (!model || !product.category) return setStatus("카테고리와 모델명을 먼저 확인해주세요.");
    try {
      const modelDir = await ensureProductFolderTree(dbHandle, product.category, model);
      const picker = (window as any).showOpenFilePicker;
      if (typeof picker !== "function") {
        setStatus("이 브라우저에서는 파일 목록 바로가기를 지원하지 않습니다.");
        return;
      }
      await picker({ startIn: modelDir, multiple: false });
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      setStatus(`오류: ${e instanceof Error ? e.message : "폴더 열기 실패"}`);
    }
  };

  // 웹페이지는 윈도우 탐색기를 직접 열 수 없어서, 모델 폴더의 전체 경로를 복사해 탐색기·업로드 창 주소칸에 붙여넣게 한다.
  // 브라우저는 선택한 상품DB 폴더의 전체 경로를 알려주지 않으므로 처음 한 번만 사용자가 입력한다.
  const copyModelFolderPath = async () => {
    if (!model || !product.category) return setFolderPathMessage("카테고리와 모델명을 먼저 확인해주세요.");
    let base = "";
    try { base = localStorage.getItem(PRODUCT_DB_PATH_KEY) || ""; } catch { /* 저장공간을 못 쓰면 매번 입력 */ }
    const matchesFolder = (path: string) => !dbFolderName || path.split(/[\\/]/).pop() === dbFolderName;
    if (!base || !matchesFolder(base)) {
      const entered = window.prompt(
        `상품DB 폴더(${dbFolderName || "연결한 폴더"})의 전체 경로를 한 번만 입력해주세요.\n탐색기에서 그 폴더를 열고 주소칸을 복사해 붙여넣으면 됩니다.\n예: G:\\내 드라이브\\상품이미지DB`,
        base,
      );
      const cleaned = String(entered || "").trim().replace(/^"|"$/g, "").replace(/[\\/]+$/, "");
      if (!cleaned) return;
      if (!matchesFolder(cleaned)) return setFolderPathMessage(`입력한 경로의 마지막 폴더가 연결된 상품DB 폴더(${dbFolderName})와 다릅니다. 다시 눌러 입력해주세요.`);
      base = cleaned;
      try { localStorage.setItem(PRODUCT_DB_PATH_KEY, base); } catch { /* 이번만 사용 */ }
    }
    const fullPath = `${base}\\${product.category}\\${model}`;
    try {
      await navigator.clipboard.writeText(fullPath);
      setFolderPathMessage(`경로를 복사했습니다: ${fullPath} · 업로드 창이나 탐색기(Win+E) 주소칸에 붙여넣으세요.`);
    } catch {
      setFolderPathMessage(`복사하지 못했습니다. 이 경로를 직접 복사해주세요: ${fullPath}`);
    }
  };

  const prepareApprovedSquareImages = async () => {
    if (!detailPreview || squareImagesBusy) return;
    setSquareImagesBusy(true);
    setSquareImagesMessage("확정된 상세페이지에서 사진을 분리하고 있습니다...");
    try {
      if (!model) throw new Error("모델명을 먼저 확인해주세요.");
      const sections = await splitDetailPage(detailPreview, detailHeader?.dataUrl || DEFAULT_DETAIL_HEADER);
      const images: SlotImage[] = [];
      for (let index = 0; index < sections.length; index += 1) {
        setSquareImagesMessage(`${sections.length}장 중 ${index + 1}장을 1000×1000으로 만드는 중...`);
        images.push({
          dataUrl: await extendToSquareCanvas(sections[index].dataUrl),
          source: sections[index].dataUrl,
          fileName: `${model}-detail-square-${String(index + 1).padStart(2, "0")}.jpg`,
        });
      }
      setUploadPool(prev => [...prev.filter(item => !item.fileName.startsWith(`${model}-detail-square-`)), ...images]);
      setSquareImagesMessage(`${images.length}장을 5번 이미지 풀에 넣었습니다. 쓸 사진을 대표·추가이미지 칸으로 끌어 넣으세요.`);
    } catch (error) {
      setSquareImagesMessage(`오류: ${error instanceof Error ? error.message : "등록 이미지 생성 실패"}`);
    } finally {
      setSquareImagesBusy(false);
    }
  };

  const addUploadPoolFiles = async (fileList: FileList | File[]) => {
    const items: SlotImage[] = [];
    for (const file of Array.from(fileList).filter(isAccepted)) {
      items.push({ dataUrl: await readFile(file), fileName: file.name });
    }
    setUploadPool(prev => [...prev, ...items]);
  };

  const openUploadPoolPicker = async () => {
    try {
      if (dbHandle && model && product.category) {
        const modelDir = await ensureProductFolderTree(dbHandle, product.category, model);
        const picker = (window as any).showOpenFilePicker;
        if (typeof picker === "function") {
          const handles = await picker({
            startIn: modelDir,
            multiple: true,
            types: [{ description: "상품 이미지", accept: { "image/jpeg": [".jpg", ".jpeg"], "image/png": [".png"] } }],
          });
          const files = await Promise.all(handles.map((handle: any) => handle.getFile()));
          await addUploadPoolFiles(files);
          return;
        }
      }
      uploadPoolInputRef.current?.click();
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      setPhotoMessage(`오류: ${e instanceof Error ? e.message : "이미지 선택 실패"}`);
    }
  };

  const resetCoupangImages = () => {
    setDraftRestoreRevision(value => value + 1);
    setMainWear(null);
    setAllOptions(null);
    setOptionThumbs({});
    setVariantThumbs({});
    Object.keys(variantUploadRevision.current).forEach(key => { variantUploadRevision.current[key] += 1; });
    setExtra01(null);
    setExtra02(null);
    setExtra03(null);
    setDetailCut(null);
    setWear01(null);
    setWear02(null);
    setCustomSlots([]);
    setUploadPool([]);
    setSquareImagesMessage("");
    setAdjustKey("");
    setAdjustPreview("");
    setDetailPreview("");
    setMessage("쿠팡 등록 이미지를 초기화했습니다.");
  };

  const resetAll = () => {
    if (!window.confirm("기본값을 제외한 입력값과 업로드 이미지를 모두 초기화할까요?")) return;
    setProduct({ ...DEFAULT_PRODUCT });
    setTitleBackup("");
    setTagsBackup("");
    sizesUserEditedRef.current = false;
    setPhotos([]);
    setPhotoMessage("");
    setAnalysis({});
    resetCoupangImages();
    setDetailImages([]);
    detailOrderEditedRef.current = false;
    dismissedDetailSlotsRef.current.clear();
    setDetailMessage("");
    setSourcingUrls(["", "", ""]);
    setSourcingUrlInputs(["", "", ""]);
    setSourcingMessage("");
    setSourcingAnalysis({});
    setSourcingImages([]);
    setSourcingSaveStatus("");
    setExportMessage("");
    setBatchStatus("");
    setBatchMode("actual");
    setDbSavedFiles([]);
    localStorage.removeItem(DRAFT_STORAGE_KEY);
    localStorage.removeItem(LAURA_DRAFT_STORAGE_KEY);
    localStorage.removeItem(LEGACY_DRAFT_STORAGE_KEY);
    setMessage("전체 입력값을 기본값으로 초기화했습니다.");
  };

  const loadQuoteQueue = async () => {
    setQuoteQueueBusy("목록");
    try {
      const response = await fetch("/api/google-sheet?action=quoteQueueList", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok || data.error) throw new Error(data.error || "견적서 대기목록 조회 실패");
      setQuoteQueue(Array.isArray(data.records) ? data.records : []);
      if (data.configured === false) setExportMessage("Google 시트 연결 후 견적서 대기목록을 사용할 수 있습니다.");
    } catch (error) {
      setExportMessage(`오류: ${error instanceof Error ? error.message : "견적서 대기목록 조회 실패"}`);
    } finally {
      setQuoteQueueBusy("");
    }
  };

  const downloadQuoteGroup = async (group: { key: string; gender: string; category: string; skuCount: number; records: QuoteQueueRecord[] }) => {
    setQuoteQueueBusy(group.key);
    setExportMessage(`${group.gender} ${group.category} 최신 대기목록을 확인하고 있습니다...`);
    try {
      // 화면에 표시된 목록이 오래되었더라도 항상 Google 시트의 최신 내용으로 생성합니다.
      const queueResponse = await fetch(`/api/google-sheet?action=quoteQueueList&t=${Date.now()}`, { cache: "no-store" });
      const queueData = await queueResponse.json();
      if (!queueResponse.ok || queueData.error) {
        throw new Error(queueData.error || "최신 견적서 대기목록 조회 실패");
      }
      const latestRecords = (Array.isArray(queueData.records) ? queueData.records : [])
        .filter((record: QuoteQueueRecord) => record.gender === group.gender && record.category === group.category);
      if (!latestRecords.length) throw new Error("이 카테고리의 견적서 대기목록이 비어 있습니다.");
      setQuoteQueue(Array.isArray(queueData.records) ? queueData.records : []);
      const latestSkuCount = latestRecords.reduce(
        (sum: number, record: QuoteQueueRecord) => sum + Number(record.skuCount || 0),
        0
      );
      setExportMessage(`${group.gender} ${group.category} 최신 정보로 묶음 견적서를 만들고 있습니다...`);
      const response = await fetch("/api/export-quote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ payloads: latestRecords.map((record: QuoteQueueRecord) => record.payload) }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || "묶음 견적서 생성 실패");
      }
      const encodedName = response.headers.get("X-Download-Name") || "";
      const name = encodedName ? decodeURIComponent(encodedName) : `견적서_${group.gender}_${group.category}.${latestSkuCount > 1000 ? "zip" : "xlsx"}`;
      const blob = await response.blob();
      if (dbHandle && await ensureReadWritePermission(dbHandle)) {
        const savedPath = await writeCategoryFile(dbHandle, group.category, name, blob);
        // 카테고리 폴더 원본 저장과 별도로 검수용 사본을 브라우저 다운로드에도 보냅니다.
        // 브라우저 다운로드 목록에서 누르면 Excel로 바로 열 수 있습니다.
        downloadBlobFile(blob, name);
        setExportMessage(`${group.gender} ${group.category} · ${latestRecords.length}모델 · ${latestSkuCount.toLocaleString()} SKU 최신 묶음 견적서 저장 완료 → ${savedPath} · 검수용 파일도 다운로드했습니다. 브라우저 다운로드 목록에서 눌러 Excel로 여세요.`);
      } else {
        downloadBlobFile(blob, name);
        setExportMessage(`${group.gender} ${group.category} · ${latestRecords.length}모델 · ${latestSkuCount.toLocaleString()} SKU 최신 묶음 견적서 다운로드 완료 · 상품DB 폴더를 선택하면 ${group.category} 폴더에 바로 저장됩니다.`);
      }
    } catch (error) {
      setExportMessage(`오류: ${error instanceof Error ? error.message : "묶음 견적서 생성 실패"}`);
    } finally {
      setQuoteQueueBusy("");
    }
  };

  const openQuoteCategoryFolder = async (group: { category: string }) => {
    if (!dbHandle) {
      setExportMessage("먼저 상품DB 폴더를 선택해주세요.");
      return;
    }
    try {
      if (!(await ensureReadWritePermission(dbHandle))) throw new Error("상품DB 폴더 권한이 필요합니다.");
      const categoryDir = await dbHandle.getDirectoryHandle(group.category, { create: true });
      const picker = (window as any).showOpenFilePicker;
      if (typeof picker !== "function") {
        setExportMessage("이 브라우저에서는 폴더 파일 목록 바로가기를 지원하지 않습니다.");
        return;
      }
      const handles = await picker({
        startIn: categoryDir,
        multiple: false,
        types: [{
          description: "Excel 견적서",
          accept: { "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"] },
        }],
      });
      const selected = handles?.[0] as FileSystemFileHandle | undefined;
      if (!selected) return;
      const file = await selected.getFile();
      // 브라우저 보안상 로컬 Excel을 직접 실행할 수 없으므로, 선택한 파일을 다운로드 목록에
      // 전달합니다. 사용자는 브라우저 다운로드 항목을 눌러 Excel로 바로 열 수 있습니다.
      downloadBlobFile(file, file.name);
      setExportMessage(`${file.name}을(를) 열 수 있도록 다운로드했습니다. 브라우저의 다운로드 항목에서 파일을 누르면 Excel로 열립니다.`);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setExportMessage(`오류: ${error instanceof Error ? error.message : "견적서 저장 폴더 열기 실패"}`);
    }
  };

  const clearQuoteGroup = async (group: { key: string; gender: string; category: string; records: QuoteQueueRecord[] }) => {
    if (!window.confirm(`${group.gender} ${group.category} 대기목록 ${group.records.length}모델을 비울까요? 견적서를 다운로드하고 쿠팡 업로드까지 확인한 뒤 비우세요.`)) return;
    setQuoteQueueBusy(group.key);
    try {
      const response = await postGoogleSheet({ action: "quoteQueueClear", gender: group.gender, category: group.category });
      const data = await response.json();
      if (!response.ok || data.error) throw new Error(data.error || "견적서 대기목록 비우기 실패");
      setExportMessage(`${group.gender} ${group.category} 대기목록 ${Number(data.cleared || 0).toLocaleString()}모델을 비웠습니다.`);
      await loadQuoteQueue();
    } catch (error) {
      setExportMessage(`오류: ${error instanceof Error ? error.message : "견적서 대기목록 비우기 실패"}`);
    } finally {
      setQuoteQueueBusy("");
    }
  };

  const deleteQuoteModel = async (modelName: string) => {
    if (!window.confirm(`${modelName}을(를) 묶음 견적서 대기목록에서 삭제할까요?\n상품DB의 제품 정보는 삭제되지 않습니다.`)) return;
    setQuoteQueueBusy(`삭제:${modelName}`);
    try {
      const response = await postGoogleSheet({ action: "quoteQueueDeleteModel", model: modelName });
      const data = await response.json();
      if (!response.ok || data.error) throw new Error(data.error || "모델 삭제 실패");
      setExportMessage(`${modelName}을(를) 묶음 견적서 대기목록에서 삭제했습니다.`);
      await loadQuoteQueue();
    } catch (error) {
      setExportMessage(`오류: ${error instanceof Error ? error.message : "모델 삭제 실패"}`);
    } finally {
      setQuoteQueueBusy("");
    }
  };

  /** 칸에서 빠진 사진(삭제·덮어쓰기·칸 삭제)은 지우지 않고 위쪽 이미지 목록으로 되돌린다. */
  const returnToPool = (slot: SlotImage | null | undefined) => {
    if (!slot?.dataUrl) return;
    const { locked: _locked, ...rest } = slot;
    setUploadPool(prev => prev.some(item => item.dataUrl === rest.dataUrl) ? prev : [...prev, rest]);
  };

  const assignPoolItem = (index: number, key: string) => {
    const slot = uploadPool[index];
    if (!slot) return;
    const previous = getSlotValue(key);
    setSlotValue(key, slot);
    setUploadPool(prev => {
      const next = prev.filter((_, i) => i !== index);
      if (!previous?.dataUrl || next.some(item => item.dataUrl === previous.dataUrl)) return next;
      const { locked: _locked, ...rest } = previous;
      return [...next, rest];
    });
  };

  const getSlotValue = (key: string): SlotImage | null => {
    if (key === "mainWear") return mainWear;
    if (key === "all") return allOptions;
    if (key === "detail") return detailCut;
    if (key === "wear01") return wear01;
    if (key === "wear02") return wear02;
    if (key.startsWith("opt:")) return activeVariantThumbs[key.slice(4)] || null;
    if (key.startsWith("legacy:")) return optionThumbs[key.slice(7)] || null;
    if (key.startsWith("custom:")) return customSlots.find(item => item.id === key.slice(7))?.slot || null;
    return null;
  };

  const setSlotValue = (key: string, value: SlotImage | null) => {
    if (key === "mainWear") setMainWear(value);
    else if (key === "all") setAllOptions(value);
    else if (key === "detail") setDetailCut(value);
    else if (key === "wear01") setWear01(value);
    else if (key === "wear02") setWear02(value);
    else if (key.startsWith("opt:")) void setOptionThumbCovered(key.slice(4), value);
    else if (key.startsWith("custom:")) {
      setCustomSlots(prev => prev.map(item => item.id === key.slice(7) ? { ...item, slot: value } : item));
    }
  };

  const swapSlots = (sourceKey: string, targetKey: string) => {
    if (!sourceKey || sourceKey === targetKey) return;
    const source = getSlotValue(sourceKey);
    const target = getSlotValue(targetKey);
    if (!sourceKey.startsWith("legacy:")) setSlotValue(sourceKey, target);
    setSlotValue(targetKey, source);
  };

  const addCustomSlot = (type: CustomSlot["type"]) => {
    setCustomSlots(prev => {
      if (prev.length >= 5) {
        setBatchStatus("사용자 추가 이미지는 05~09번까지 최대 5개입니다.");
        return prev;
      }
      return [...prev, { id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, type, slot: null }];
    });
  };

  const customSlotTitle = (item: CustomSlot, index: number) => {
    const sameTypeBefore = customSlots.slice(0, index).filter(slot => slot.type === item.type).length;
    if (item.type === "wear") return `착용컷 ${String(3 + sameTypeBefore).padStart(2, "0")}`;
    if (item.type === "detail") return `디테일컷 ${2 + sameTypeBefore}`;
    return `전체옵션 이미지 ${2 + sameTypeBefore}`;
  };

  const saveSourcingUrl = (index: number) => {
    const url = sourcingUrlInputs[index].trim();
    if (!url) {
      setSourcingMessage("링크를 입력해주세요.");
      return;
    }
    setSourcingUrls(prev => prev.map((value, i) => i === index ? url : value));
    setSourcingMessage("링크를 저장했습니다.");
  };

  const copyText = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setSourcingMessage("링크를 복사했습니다.");
    } catch {
      setSourcingMessage("복사에 실패했습니다.");
    }
  };

  const slotFromFile = async (file: File): Promise<SlotImage | null> => {
    if (!isAccepted(file)) return null;
    return { dataUrl: await readFile(file), fileName: file.name };
  };

  const setOptionThumb = (option: string, slot: SlotImage | null) => {
    setVariantThumbs(prev => ({ ...prev, [option]: slot }));
  };

  const setOptionThumbCovered = async (option: string, slot: SlotImage | null) => {
    const revision = (variantUploadRevision.current[option] || 0) + 1;
    variantUploadRevision.current[option] = revision;
    if (!slot) {
      setOptionThumb(option, null);
      return;
    }
    const dataUrl = await coverSquareCanvas(slot.dataUrl);
    if (variantUploadRevision.current[option] === revision) setOptionThumb(option, { ...slot, dataUrl });
  };

  const openAdjust = (key: string, dataUrl: string) => {
    setAdjustKey(key);
    setAdjust(defaultFitAdjust());
    setAdjustPreview(dataUrl);
    setAdjustResult("");
  };

  const previewAdjust = async () => {
    if (!adjustPreview) return;
    try {
      const out = await fitToWhiteCanvas(adjustPreview, adjust);
      setAdjustResult(out);
    } catch {
      /* ignore */
    }
  };

  const confirmAdjust = async () => {
    if (!adjustKey || !adjustPreview) return;
    const fitted = await fitToWhiteCanvas(adjustPreview, adjust);
    const slot: SlotImage = { dataUrl: fitted, fileName: "fitted.jpg" };
    if (adjustKey.startsWith("opt:")) {
      setOptionThumb(adjustKey.slice(4), slot);
    } else if (adjustKey === "all") setAllOptions(slot);
    else if (adjustKey === "detail") setDetailCut(slot);
    else if (adjustKey === "wear01") setWear01(slot);
    else if (adjustKey === "wear02") setWear02(slot);
    setAdjustKey("");
    setAdjustPreview("");
    setAdjustResult("");
  };

  const pushDetail = (name: string, dataUrl: string) => {
    setDetailImages(prev => [
      ...prev,
      { id: `${Date.now()}-${Math.random()}`, name, dataUrl },
    ]);
    setDetailPreview("");
    setDetailMessage(`${name}을(를) 상세페이지 목록에 추가했습니다.`);
  };

  const changeDetailBrandImage = async (position: "header" | "footer", file: File | undefined) => {
    if (!file || !isAccepted(file)) {
      setDetailMessage("JPG/JPEG/PNG 이미지를 선택해주세요.");
      return;
    }
    const slot = { dataUrl: await readFile(file), fileName: file.name };
    if (position === "header") setDetailHeader(slot);
    else setDetailFooter(slot);
    setDetailPreview("");
    setDetailMessage(`${position === "header" ? "상단" : "하단"} 이미지를 변경했습니다: ${file.name}`);
  };

  const composeDetailPage = async () => {
    if (!detailImages.length) {
      throw new Error("상세페이지에 사용할 사진을 추가해주세요.");
    }
    const width = 780;
    const gap = 60;
    const header = await loadImage(detailHeader?.dataUrl || DEFAULT_DETAIL_HEADER);
    const footer = detailFooter ? await loadImage(detailFooter.dataUrl) : null;
    const headerHeight = Math.max(1, Math.round((header.height / header.width) * width));
    const footerHeight = footer ? Math.max(1, Math.round((footer.height / footer.width) * width)) : 0;
    const prepared = await Promise.all(
      detailImages.map(async item => {
        const img = await loadImage(item.dataUrl);
        const naturalHeight = Math.max(1, Math.round((img.height / img.width) * width));
        const height = naturalHeight;
        const zoom = 1;
        const sourceWidth = img.width / zoom;
        const sourceHeight = sourceWidth * height / width;
        if (sourceWidth < width || sourceHeight > img.height + 2) {
          throw new Error(`${item.name}: 확대하면 화질이 낮아집니다. 보정 폴더의 고해상도 사진을 사용해주세요.`);
        }
        return { img, height, sourceWidth, sourceHeight: Math.min(img.height, sourceHeight),
          focusX: Math.max(0, Math.min(1, item.focusX ?? 0.5)),
          focusY: Math.max(0, Math.min(1, item.focusY ?? 0.5)) };
      })
    );
    const totalHeight =
      headerHeight + gap + prepared.reduce((s, i) => s + i.height, 0) + gap * Math.max(0, prepared.length - 1) + gap + footerHeight;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = totalHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("캔버스를 만들 수 없습니다.");
    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(0, 0, width, totalHeight);
    ctx.drawImage(header, 0, 0, width, headerHeight);
    let y = headerHeight + gap;
    for (const item of prepared) {
      const sourceX = Math.max(0, Math.min(item.img.width - item.sourceWidth, item.img.width * item.focusX - item.sourceWidth / 2));
      const sourceY = Math.max(0, Math.min(item.img.height - item.sourceHeight, item.img.height * item.focusY - item.sourceHeight / 2));
      ctx.drawImage(item.img, sourceX, sourceY, item.sourceWidth, item.sourceHeight, 0, y, width, item.height);
      y += item.height + gap;
    }
    if (footer) ctx.drawImage(footer, 0, y, width, footerHeight);
    return { dataUrl: canvas.toDataURL("image/jpeg", 0.97), totalHeight };
  };

  const buildDetailPage = async () => {
    setDetailMessage("780px 상세페이지를 만들고 있습니다...");
    try {
      const built = await composeDetailPage();
      setDetailPreview(built.dataUrl);
      setDetailMessage(`상세페이지 완성 · ${detailImages.length}장 · ${built.totalHeight}px`);
    } catch (e) {
      setDetailMessage(`오류: ${e instanceof Error ? e.message : "상세페이지 실패"}`);
    }
  };

  const downloadDetailPageOnly = async () => {
    if (!model) {
      setExportMessage("모델명을 먼저 확인해주세요.");
      return;
    }
    setExportLoading("detail");
    try {
      setExportMessage("상세이미지만 만들고 있습니다...");
      const dataUrl = detailPreview || (await composeDetailPage()).dataUrl;
      setDetailPreview(dataUrl);
      downloadDataUrl(dataUrl, `${model}.jpg`);
      setExportMessage("상세이미지 다운로드 완료");
    } catch (e) {
      setExportMessage(`오류: ${e instanceof Error ? e.message : "상세이미지 다운로드 실패"}`);
    } finally {
      setExportLoading("");
    }
  };

  const shareDetailPreview = async () => {
    if (!detailPreview || !model) return;
    setDetailShareLoading(true);
    setDetailShareError("");
    try {
      const response = await fetch("/api/detail-preview-share", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model, dataUrl: detailPreview }),
      });
      const result = await response.json() as { url?: string; error?: string };
      if (!response.ok || !result.url) throw new Error(result.error || "링크를 만들지 못했습니다.");
      setDetailShareUrl(result.url);
    } catch (error) {
      setDetailShareError(error instanceof Error ? error.message : "링크를 만들지 못했습니다.");
    } finally {
      setDetailShareLoading(false);
    }
  };

  const downloadDataUrl = (dataUrl: string, filename: string) => {
    const a = document.createElement("a");
    a.href = dataUrl;
    a.download = filename;
    a.click();
  };

  const downloadBlobFile = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportPayload = () => {
    if (variantOptions.error) throw new Error(variantOptions.error);
    return {
    product,
    model,
    title,
    tags,
    sourcingUrl,
    skuImages: Object.fromEntries(
      variants.flatMap(variant => {
        const dataUrl = activeVariantThumbs[variant.key]?.dataUrl;
        return dataUrl ? [[`${model}${variant.sku}`, dataUrl]] : [];
      })
    ),
    additionalImagesCsv: [
      ...buildAdditionalImagesCsv(model, [allOptions?.dataUrl, detailCut?.dataUrl, wear01?.dataUrl, wear02?.dataUrl])
        .split(",").filter(Boolean),
      ...customSlots.filter(item => item.slot?.dataUrl).slice(0, 5)
        .map((_, index) => `${model}-${String(index + 5).padStart(2, "0")}.jpg`),
    ].join(","),
    additionalImages: [
      ...buildAdditionalImagesCsv(model, [allOptions?.dataUrl, detailCut?.dataUrl, wear01?.dataUrl, wear02?.dataUrl])
        .split(",").filter(Boolean),
      ...customSlots.filter(item => item.slot?.dataUrl).slice(0, 5)
        .map((_, index) => `${model}-${String(index + 5).padStart(2, "0")}.jpg`),
    ],
  };
  };

  const refreshDrafts = async () => {
    const revision = ++draftRefreshRef.current;
    const results = await Promise.allSettled([
      listProductDrafts().then(local => {
        if (revision === draftRefreshRef.current) setDrafts(current => mergeProductDrafts(current, local));
        return local;
      }),
      fetch("/api/google-sheet?action=cloudDraftList", { cache: "no-store", signal: AbortSignal.timeout(15000) })
        .then(readDraftResponse).then(data => {
          if (!Array.isArray(data.drafts)) throw new Error("동기화 목록 응답이 올바르지 않습니다.");
          return data.drafts as ProductDraftRecord[];
        }),
    ]);
    if (revision !== draftRefreshRef.current) return;
    const available = results.flatMap(result => result.status === "fulfilled" ? result.value : []);
    if (results.every(result => result.status === "fulfilled")) {
      setDrafts(mergeProductDrafts(available));
    } else if (results.some(result => result.status === "fulfilled")) {
      setDrafts(current => mergeProductDrafts(current, available));
    } else {
      setDraftStatus("임시저장 목록을 불러오지 못했습니다. 저장 공간과 연결을 확인해주세요.");
    }
  };

  const buildDraftRecord = (): ProductDraftRecord => ({
    model,
    savedAt: Date.now(),
    data: {
      product, analysis, photos, mainWear, allOptions, optionThumbs, variantThumbs, detailCut, wear01, wear02, customSlots,
      detailImages, detailHeader, detailFooter, detailPreview, sourcingUrls, sourcingUrlInputs, sourcingImages,
      uploadPool, title, tags, sourcingAnalysis,
      labelManufactureYearMonth, labelManufacturerName, labelImporterName, reregisterModelName, rocketNewModel, logoAppliedPreview,
    },
  });

  const saveDraft = async (revealList = true) => {
    if (draftSavingRef.current) return;
    if (!model) {
      setDraftStatus("모델명을 먼저 입력해주세요.");
      return;
    }
    draftSavingRef.current = true;
    setDraftSaving(true);
    setDraftStatus("이 기기에 임시저장 중...");
    const record = buildDraftRecord();
    try {
      await saveProductDraft(record);
    } catch (error) {
      setDraftStatus(`이 기기 임시저장 실패: ${error instanceof Error ? error.message : "저장 공간을 확인해주세요."}`);
      draftSavingRef.current = false;
      setDraftSaving(false);
      return;
    }
    const revision = ++draftRefreshRef.current;
    setDrafts(current => mergeProductDrafts(current, [record]));
    void listProductDrafts().then(local => {
      if (revision === draftRefreshRef.current) setDrafts(current => mergeProductDrafts(current, local));
    }).catch(() => undefined);
    if (revealList) setShowDrafts(true);
    setDraftStatus(`${record.model} · 이 기기에 이미지와 입력내용을 저장했습니다. 다른 기기 동기화 중...`);
    try {
      try {
        localStorage.removeItem(DRAFT_STORAGE_KEY);
        localStorage.removeItem(LAURA_DRAFT_STORAGE_KEY);
        localStorage.removeItem(LEGACY_DRAFT_STORAGE_KEY);
      } catch { /* IndexedDB has already committed the complete draft. */ }
      const cloudResponse = await postGoogleSheet({
        action: "cloudDraftSave",
        record: {
          model: record.model,
          savedAt: record.savedAt,
          data: { product, analysis, sourcingUrls, sourcingUrlInputs, title, tags, sourcingAnalysis,
            labelManufactureYearMonth, labelManufacturerName, labelImporterName, reregisterModelName, rocketNewModel, cloudOnly: true },
        },
      }, AbortSignal.timeout(15000));
      const cloudResult = await readDraftResponse(cloudResponse);
      if (cloudResult.ok !== true) throw new Error("동기화 저장 완료를 확인하지 못했습니다.");
      setDraftStatus(`${record.model} 임시저장 완료 · 이 기기에는 이미지까지 저장했고, 다른 기기에는 기본정보를 동기화했습니다.`);
    } catch (error) {
      setDraftStatus(`${record.model} · 이 기기에 임시저장 완료. 임시저장 목록에서 다시 불러올 수 있습니다. 다른 기기 동기화 실패: ${error instanceof Error ? error.message : "연결을 확인해주세요."}`);
    } finally {
      draftSavingRef.current = false;
      setDraftSaving(false);
    }
  };

  const loadDraft = (record: ProductDraftRecord) => {
    const data = record.data as any;
    Object.keys(variantUploadRevision.current).forEach(key => { variantUploadRevision.current[key] += 1; });
    restoringDraftRef.current = true;
    setDraftRestoreRevision(value => value + 1);
    if (data.product) setProduct({
      ...DEFAULT_PRODUCT,
      ...data.product,
      supplier: normalizeSupplierName(data.product.supplier || DEFAULT_PRODUCT.supplier),
    });
    setAnalysis(data.analysis || {});
    setSourcingAnalysis(data.sourcingAnalysis || {});
    setLabelManufactureYearMonth(data.labelManufactureYearMonth ?? DEFAULT_LABEL_YEAR_MONTH);
    setLabelManufacturerName(data.labelManufacturerName ?? "프리스타일 협력사");
    setLabelImporterName(data.labelImporterName ?? "프리스타일");
    setPhotos(Array.isArray(data.photos) ? data.photos : []);
    setMainWear(data.mainWear || null);
    setAllOptions(data.allOptions || null);
    setOptionThumbs(data.optionThumbs || {});
    setVariantThumbs(data.variantThumbs || {});
    setDetailCut(data.detailCut || null);
    setWear01(data.wear01 || null);
    setWear02(data.wear02 || null);
    setCustomSlots(Array.isArray(data.customSlots) ? data.customSlots : []);
    setDetailImages(Array.isArray(data.detailImages) ? data.detailImages : []);
    // 임시저장에 들어 있던 순서는 사용자가 정한 순서일 수 있으니 그대로 지킨다.
    detailOrderEditedRef.current = Array.isArray(data.detailImages) && data.detailImages.length > 0;
    dismissedDetailSlotsRef.current.clear();
    setDetailHeader(data.detailHeader || null);
    setDetailFooter(data.detailFooter || null);
    setDetailPreview(data.detailPreview || "");
    setLogoAppliedPreview(data.logoAppliedPreview && data.logoAppliedPreview === data.detailPreview ? data.detailPreview : "");
    // 재등록 화면에서 저장한 임시저장은 불러와도 재등록 화면(모델명 고정)을 유지한다.
    // 예전 임시저장에는 이 값이 없으므로, 재등록 목록에서 연 같은 모델이면 현재 재등록 표시를 그대로 둔다.
    const draftModel = String(data.product?.modelName || record.model || "").trim().toLowerCase();
    setRocketNewModel(Boolean(data.rocketNewModel));
    setReregisterModelName(prev => data.reregisterModelName
      ? String(data.reregisterModelName)
      : prev && prev.trim().toLowerCase() === draftModel ? prev : "");
    setSquareImagesMessage("");
    setSourcingUrls(Array.isArray(data.sourcingUrls) ? data.sourcingUrls : ["", "", ""]);
    setSourcingUrlInputs(Array.isArray(data.sourcingUrlInputs) ? data.sourcingUrlInputs : ["", "", ""]);
    setSourcingImages(Array.isArray(data.sourcingImages) ? data.sourcingImages : []);
    setUploadPool(Array.isArray(data.uploadPool) ? data.uploadPool : []);
    setShowDrafts(false);
    setDraftStatus(data.cloudOnly
      ? `${record.model} 기본정보를 불러왔습니다. 다른 기기의 이미지는 다시 올려주세요.`
      : `${record.model} 임시저장을 불러왔습니다.`);
  };

  /**
   * 제품사진선택에서 돌아왔을 때 나가기 전 작업을 다시 연다. expectedModel(등록 준비한 모델)이 있으면
   * 같은 모델일 때만 연다 — 다른 모델을 등록 준비했으면 그 모델로 새로 시작하고, 이전 작업은 임시저장 목록에 남는다.
   */
  const restoreWorkAfterPhotoSelect = async (expectedModel = "") => {
    let draftModel = "";
    try {
      draftModel = sessionStorage.getItem(PHOTO_SELECT_RETURN_KEY) || "";
      sessionStorage.removeItem(PHOTO_SELECT_RETURN_KEY);
    } catch { /* 저장공간을 못 쓰면 되살릴 작업도 없다 */ }
    if (!draftModel) return false;
    const record = (await listProductDrafts().catch(() => [])).find(row => row.model === draftModel);
    if (!record) return false;
    const data = record.data as any;
    const expected = expectedModel.trim().toLowerCase();
    const sameModel = [record.model, data?.product?.modelName, data?.reregisterModelName]
      .some(value => String(value || "").trim().toLowerCase() === expected);
    if (expected && !sameModel) return false;
    loadDraft(record);
    setDraftStatus(`${record.model} 작업하던 내용을 그대로 다시 열었습니다.`);
    return true;
  };

  // 제품사진선택으로 나가기 전에 지금 작업을 이 기기에 임시저장한다(사진까지). 돌아오면 자동으로 다시 연다.
  // AI 상세페이지 새로 만들기에서 고를 수 있는 사진: 5번 쿠팡 등록이미지 목록 + 이미 칸에 넣은 사진(중복 제외).
  const quickRemakePool = useMemo(() => {
    const seen = new Set<string>();
    const all: Array<SlotImage | null | undefined> = [
      ...uploadPool, mainWear, allOptions, detailCut, wear01, wear02, ...customSlots.map(item => item.slot),
    ];
    return all.filter((image): image is SlotImage => Boolean(image?.dataUrl) && !seen.has(image!.dataUrl) && Boolean(seen.add(image!.dataUrl)))
      .map(image => ({ dataUrl: image.source || image.dataUrl, fileName: image.fileName }));
  }, [uploadPool, mainWear, allOptions, detailCut, wear01, wear02, customSlots]);

  const openPhotoSelect = async (event: React.MouseEvent<HTMLAnchorElement>, href: string) => {
    const hasWork = Boolean(product.modelNo?.trim() || product.modelName?.trim() || photos.length || uploadPool.length);
    if (!model || !hasWork) return;
    event.preventDefault();
    if (leavingForPhotosRef.current) return;
    leavingForPhotosRef.current = true;
    try {
      await saveProductDraft(buildDraftRecord());
      sessionStorage.setItem(PHOTO_SELECT_RETURN_KEY, model);
    } catch (error) {
      if (!window.confirm(`작업 내용을 임시저장하지 못했습니다(${error instanceof Error ? error.message : "저장 공간 확인"}).\n그래도 제품사진선택으로 이동할까요? 이동하면 입력한 내용이 사라집니다.`)) {
        leavingForPhotosRef.current = false;
        return;
      }
    }
    router.push(href);
  };

  const pickFolder = async () => {
    if (!supportsDirectoryPicker()) {
      setDbStatus("이 브라우저는 폴더 선택을 지원하지 않습니다. ZIP을 사용하세요.");
      return;
    }
    try {
      const handle = await window.showDirectoryPicker({ mode: "readwrite" });
      if (!(await ensureReadWritePermission(handle))) {
        setDbStatus("폴더 쓰기 권한이 필요합니다.");
        return;
      }
      await saveDirectoryHandle(handle);
      setDbHandle(handle);
      setDbFolderName(handle.name);
      setDbStatus(`저장폴더 연결 완료: ${handle.name}`);
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      setDbStatus(`오류: ${e instanceof Error ? e.message : "폴더 선택 실패"}`);
    }
  };

  const buildCollectInput = async (detailOverride?: string) => {
    const thumbs: Record<string, string> = {};
    await Promise.all(variants.map(async variant => {
      const source = activeVariantThumbs[variant.key]?.dataUrl;
      if (source) thumbs[`${model}${variant.sku}`] = await normalizeCoupangImage(source);
    }));
    const normalizeOptional = async (source?: string) => source ? normalizeCoupangImage(source) : undefined;
    const [normalizedAll, normalizedDetail, normalizedWear01, normalizedWear02] = await Promise.all([
      normalizeOptional(allOptions?.dataUrl),
      normalizeOptional(detailCut?.dataUrl),
      normalizeOptional(wear01?.dataUrl),
      normalizeOptional(wear02?.dataUrl),
    ]);
    const customImages = customSlots
      .filter(item => item.slot?.dataUrl)
      .slice(0, 5)
      .map(async (item, index) => ({
        filename: `${model}-${String(index + 5).padStart(2, "0")}.jpg`,
        dataUrl: await normalizeCoupangImage(item.slot!.dataUrl),
      }));
    return {
      category: product.category,
      model,
      title,
      tags,
      product: product as unknown as Record<string, string>,
      analysis,
      ready,
      photos: photos.map(p => p.dataUrl),
      optionThumbs: {},
      skuImages: thumbs,
      allOptionsImage: undefined,
      includeAllOptionsInQuote: false,
      extra01: normalizedAll,
      extra02: normalizedDetail,
      extra03: normalizedWear01,
      extra04: normalizedWear02,
      detailCut: undefined,
      wear01: undefined,
      wear02: undefined,
      customImages: await Promise.all(customImages),
      detailPreview: detailOverride ?? detailPreview,
      sourcingUrl,
      label: {
        manufactureYearMonth: labelManufactureYearMonth,
        manufacturerName: labelManufacturerName,
        importerName: labelImporterName,
      },
    };
  };

  const collectInput = async (detailOverride?: string, syncGoogleSheet = true) =>
    collectProductDbFiles(await buildCollectInput(detailOverride), { syncGoogleSheet });

  const migrateExistingDbToGoogle = async () => {
    if (!dbHandle) {
      setBatchStatus("먼저 상품DB 폴더를 선택해주세요.");
      return;
    }
    if (!window.confirm("기존 상품정보 JSON을 찾아 Google 상품DB에 중복 없이 이전할까요?")) return;
    setBatchBusy(true);
    setBatchStatus("기존 상품DB를 확인하고 있습니다...");
    let migrated = 0;
    let duplicates = 0;
    let failed = 0;
    let found = 0;
    let lastError = "";
    try {
      if (!await ensureNoidbActionSession()) {
        setBatchStatus("기존 DB 이전을 취소했습니다. 제품DB는 변경하지 않았습니다.");
        return;
      }
      async function* findInfoFiles(dir: FileSystemDirectoryHandle): AsyncGenerator<FileSystemFileHandle> {
        for await (const [name, handle] of (dir as any).entries()) {
          if (handle.kind === "directory") {
            yield* findInfoFiles(handle as FileSystemDirectoryHandle);
          } else if (handle.kind === "file" && /^상품정보_.*\.json$/i.test(name)) {
            yield handle as FileSystemFileHandle;
          }
        }
      }

      for await (const fileHandle of findInfoFiles(dbHandle)) {
        found += 1;
        try {
          const info = JSON.parse(await (await fileHandle.getFile()).text());
          // 예전 파일은 product 안이 아니라 최상위에 상품 필드가 저장되어 있습니다.
          const legacyProduct = info?.product || info;
          const oldModel = String(info?.model || "").trim();
          const oldTitle = String(info?.title || "").trim();
          if (!oldModel || !oldTitle || !legacyProduct?.category) {
            failed += 1;
            lastError = "필수 정보(모델명·상품명·카테고리)가 없는 JSON 파일";
            continue;
          }
          const res = await fetch("/api/google-sheet", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              product: { ...DEFAULT_PRODUCT, ...legacyProduct },
              model: oldModel,
              title: oldTitle,
              tags: info.tags || "",
              sourcingUrl: info.sourcingUrl || "",
              syncMode: "skipDuplicate",
              operationId: globalThis.crypto?.randomUUID?.() || `migration-${Date.now()}-${found}`,
            }),
          });
          const result = await res.json().catch(() => ({}));
          if (result.duplicate) duplicates += 1;
          else if (res.ok && result.synced) migrated += 1;
          else {
            failed += 1;
            lastError = result.error || (result.configured === false ? "Google 시트 연동 미설정" : "Google 시트 저장 실패");
          }
        } catch (error) {
          failed += 1;
          lastError = error instanceof Error ? error.message : "JSON 읽기 실패";
        }
      }
      if (!found) {
        setBatchStatus("기존 DB 이전 실패 · 선택한 폴더 안에서 상품정보_*.json 파일을 찾지 못했습니다.");
      } else {
        setBatchStatus(
          `기존 DB 이전 완료 · 발견 ${found}개 · 신규 ${migrated}개 · 중복 건너뜀 ${duplicates}개 · 실패 ${failed}개` +
          (lastError ? ` · 마지막 오류: ${lastError}` : "")
        );
      }
    } catch (e) {
      setBatchStatus(`오류: ${e instanceof Error ? e.message : "기존 DB 이전 실패"}`);
    } finally {
      setBatchBusy(false);
    }
  };

  const batchSave = async () => {
    const isActual = batchMode === "actual";
    if (isActual) setRegistrationUploadReady(null);
    if (pendingReplacementCleanup) {
      setBatchStatus("SKU 이관 결과 확인이 끝나지 않았습니다. 기존행 삭제 또는 연결 취소를 먼저 선택해주세요.");
      return;
    }
    const required: string[] = [];
    if (!model) required.push("모델명");
    if (!product.category) required.push("카테고리");
    if (isActual && !dbHandle && dbSupported) required.push("상품DB 폴더 연결");
    if (required.length) {
      setBatchStatus(`필수 항목 부족: ${required.join(", ")}`);
      return;
    }

    let check = { duplicate: modelDuplicate, reregisterable: modelReregisterable, message: modelCheckMessage };
    // 화면의 중복확인은 모델명이 정해진 뒤 몇 초 늦게 끝나거나 Google 일시 오류로 실패할 수 있다.
    // 확인이 아직 안 끝났거나 실패한 상태로 저장을 누르면 막지 않고, 저장 직전에 Google DB를 다시 조회한다.
    // 중복·재등록 불가 결과도 다시 조회한다. 화면을 연 뒤 구글시트 상태(판매중지 등)를 고쳤을 수 있고,
    // 재등록 화면은 모델명이 잠겨 있어 모델명을 다시 입력해 재확인할 방법이 없다.
    if (isActual && (!check.message || check.message.startsWith("중복확인 실패") || check.message.endsWith("...") || (check.duplicate && !check.reregisterable))) {
      setBatchStatus("Google DB에서 모델명을 다시 확인하고 있습니다...");
      check = await checkModelInGoogleDb(model);
      setModelDuplicate(check.duplicate);
      setModelReregisterable(check.reregisterable);
      setModelCheckMessage(check.message);
    }
    const reregisterable = check.reregisterable;

    if (isActual && check.duplicate && !reregisterable) {
      setBatchStatus("기존 모델의 일괄 저장은 안전을 위해 차단했습니다. 필요한 파일만 개별 다운로드하세요.");
      return;
    }
    if (isActual && check.message !== "사용 가능한 모델명" && !reregisterable) {
      setBatchStatus("실제 등록은 Google DB에서 사용 가능한 모델명 확인이 끝난 뒤에만 저장할 수 있습니다.");
      return;
    }

    try {
      requireVariantImages();
    } catch (error) {
      setBatchStatus(`오류: ${error instanceof Error ? error.message : "옵션 사진을 확인해주세요."}`);
      return;
    }
    const recommended: string[] = [];
    if (!allOptions || !detailCut || !wear01) recommended.push("전체옵션·디테일컷·착용컷 01");
    if (!detailImages.length && !detailPreview) recommended.push("상세페이지 이미지");

    if (recommended.length) {
      const ok = window.confirm(
        `권장 항목이 부족합니다:\n- ${recommended.join("\n- ")}\n\n그래도 계속 저장할까요?`
      );
      if (!ok) {
        setBatchStatus("저장을 취소했습니다.");
        return;
      }
    }

    setBatchBusy(true);
    setBatchStatus("등록파일을 생성·저장하고 있습니다...");
    try {
      if (isActual && !await ensureNoidbActionSession()) {
        setBatchStatus("실제 등록을 취소했습니다. 상품 폴더와 Google 제품DB는 변경하지 않았습니다.");
        return;
      }
      let preview = detailPreview;
      if (!preview && detailImages.length) {
        const built = await composeDetailPage();
        preview = built.dataUrl;
        setDetailPreview(preview);
      }

      const { files, skipped, readyFiles } = await collectInput(preview, false);
      if (!isActual) {
        const blob = await buildProductDbZip(product.category, model, files);
        downloadBlobFile(blob, `연습용_상품DB_${model}.zip`);
        setDbSavedFiles(readyFiles);
        setBatchStatus("테스트·교육용 ZIP 생성 완료 · 실제 상품 폴더와 Google 제품DB는 변경하지 않았습니다.");
      } else if (dbHandle) {
        // 파일 충돌 여부를 Google 시트 변경보다 먼저 확인하여 기존 상품과 시트가 모두 보존되게 한다.
        if (!reregisterable) await assertProductDbFilesWritable(dbHandle, product.category, model, files);
        const sync = await syncProductDbToGoogleSheet((await buildCollectInput(preview)));
        if (!sync.ok) throw new Error(`${sync.message} · 상품 폴더는 변경하지 않았습니다.`);
        const saved = await writeProductDbFiles(dbHandle, product.category, model, files, { overwriteExisting: reregisterable });
        const fileSkips = skipped.filter(item => !item.startsWith("Google 시트"));
        setDbSavedFiles(saved);
        setBatchStatus(
          `상품 생성 완료 · ${saved.length}개 저장 → ${product.category}/${model}/` +
            (fileSkips.length ? ` · 미저장: ${fileSkips.join(", ")}` : "") +
            ` · ${sync.message}`
        );
      } else {
        const blob = await buildProductDbZip(product.category, model, files);
        downloadBlobFile(blob, `상품DB_${model}.zip`);
        setDbSavedFiles(readyFiles);
        const sync = await syncProductDbToGoogleSheet((await buildCollectInput(preview)));
        if (!sync.ok) throw new Error(`${sync.message} · ZIP은 다운로드됐지만 Google 제품DB는 변경되지 않았습니다. 같은 모델로 다시 실행할 수 있습니다.`);
        setBatchStatus(`상품 생성 완료 · ZIP 다운로드 (${files.length}개 파일) · ${sync.message}`);
      }
      if (isActual) {
        setRegistrationUploadReady({ model, files: files.map(file => file.path) });
        await saveDraft(false);
        await loadQuoteQueue();
      }
    } catch (e) {
      setBatchStatus(`오류: ${e instanceof Error ? e.message : "저장 실패"}`);
    } finally {
      setBatchBusy(false);
    }
  };

  const downloadQuote = async () => {
    if (!model || !title) {
      setExportMessage("모델명과 상품명을 먼저 완성해주세요.");
      return;
    }
    setExportLoading("quote");
    try {
      const res = await fetch("/api/export-quote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...exportPayload(), skuImages: {} }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "견적서 실패");
      }
      downloadBlobFile(await res.blob(), `견적서_${model}_${product.category}.xlsx`);
      setExportMessage("견적서 다운로드 완료");
    } catch (e) {
      setExportMessage(`오류: ${e instanceof Error ? e.message : "견적서 실패"}`);
    } finally {
      setExportLoading("");
    }
  };

  const downloadAutomation = async () => {
    if (!model || !title) {
      setExportMessage("모델명과 상품명을 먼저 완성해주세요.");
      return;
    }
    setExportLoading("auto");
    try {
      const payload = exportPayload();
      payload.skuImages = Object.fromEntries(await Promise.all(
        Object.entries(payload.skuImages).map(async ([option, dataUrl]) => [
          option,
          await normalizeCoupangImage(dataUrl),
        ])
      ));
      const res = await fetch("/api/export-automation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "자동화 실패");
      }
      downloadBlobFile(await res.blob(), "상품DB.xlsx");
      setExportMessage("상품DB 다운로드 완료");
    } catch (e) {
      setExportMessage(`오류: ${e instanceof Error ? e.message : "자동화 실패"}`);
    } finally {
      setExportLoading("");
    }
  };

  const downloadLabel = async () => {
    if (!model) {
      setExportMessage("모델명을 먼저 확인해주세요.");
      return;
    }
    setExportLoading("label");
    try {
      const fileName = `라벨_${model}.jpg`;
      const labelBlob = await createLabelBlob({
        model,
        manufactureYearMonth: labelManufactureYearMonth,
        manufacturerName: labelManufacturerName,
        importerName: labelImporterName,
      });
      if (dbHandle) {
        const existing = await rootFolderFileExists(dbHandle, "라벨", fileName);
        if (existing && !window.confirm(`${fileName}이 이미 있습니다.\n\n기존 라벨을 새 내용으로 교체할까요?`)) {
          setExportMessage("기존 라벨을 유지했습니다.");
          return;
        }
        const savedPath = await writeRootFolderFile(dbHandle, "라벨", fileName, labelBlob, { overwriteExisting: existing });
        setExportMessage(`라벨 저장 완료 → ${savedPath}`);
      } else {
        downloadBlobFile(labelBlob, fileName);
        setExportMessage("라벨 다운로드 완료");
      }
    } catch (e) {
      setExportMessage(`오류: ${e instanceof Error ? e.message : "라벨 다운로드 실패"}`);
    } finally {
      setExportLoading("");
    }
  };

  const downloadProductImagesOnly = async () => {
    if (!model || !product.category) {
      setExportMessage("모델명과 카테고리를 먼저 확인해주세요.");
      return;
    }
    setExportLoading("images");
    try {
      requireVariantImages();
      const normalizedThumbs = Object.fromEntries(await Promise.all(
        variants.flatMap(variant => {
          const dataUrl = activeVariantThumbs[variant.key]?.dataUrl;
          return dataUrl ? [[`${model}${variant.sku}`, normalizeCoupangImage(dataUrl)]] : [];
        }).map(async ([option, pending]) => [option, await pending])
      ));
      const normalizedExtras = await Promise.all(
        [allOptions?.dataUrl, detailCut?.dataUrl, wear01?.dataUrl, wear02?.dataUrl]
          .map(async dataUrl => dataUrl ? normalizeCoupangImage(dataUrl) : undefined)
      );
      const normalizedCustom = await Promise.all(
        customSlots.filter(item => item.slot?.dataUrl).slice(0, 5).map(async (item, index) => ({
          filename: `${model}-${String(index + 5).padStart(2, "0")}.jpg`,
          dataUrl: await normalizeCoupangImage(item.slot!.dataUrl),
        }))
      );
      const files = collectProductImageFiles({
        category: product.category,
        model,
        sizesCsv: product.sizes,
        colorsCsv: product.colors,
        optionThumbs: {},
        skuImages: normalizedThumbs,
        additionalImages: normalizedExtras,
        customImages: normalizedCustom,
      });
      if (!files.length) throw new Error("다운로드할 썸네일 또는 추가이미지가 없습니다.");
      const zip = await buildProductDbZip(product.category, model, files);
      downloadBlobFile(zip, `썸네일_추가이미지_${model}.zip`);
      setExportMessage(`썸네일 + 추가이미지 다운로드 완료 · ${files.length}개 파일`);
    } catch (e) {
      setExportMessage(`오류: ${e instanceof Error ? e.message : "이미지 다운로드 실패"}`);
    } finally {
      setExportLoading("");
    }
  };

  const counterfeitAlert = ["확인필요", "높음"].includes(analysis.counterfeitRisk?.trim() || "");

  return (
    <main className="shell">
      {reregistrationMessage && <p role="status" className="message">{reregistrationMessage}</p>}
      <AppNavigation active="product-registration" />
      <header className="hero">
        <div className="heroBrandArea">
          <h1>AI 상품등록 도우미</h1>
          <div className="heroUtilityActions">
            {(() => {
              const photoSelectHref = `/wms/product-catalog?status=${rocketNewModel ? "rocket-new" : "reregister"}${reregisterModelName ? `&model=${encodeURIComponent(reregisterModelName)}` : ""}`;
              return <Link className="imageGeneratorLink" href={photoSelectHref} onClick={event => void openPhotoSelect(event, photoSelectHref)}>제품사진선택</Link>;
            })()}
            <button className="draftLoadButton" type="button" onClick={() => {
              setShowDrafts(value => !value);
              if (!showDrafts) void refreshDrafts();
            }}>임시저장 불러오기</button>
            <button className="resetAllButton" type="button" onClick={resetAll}>전체 초기화</button>
          </div>
        </div>
      </header>
      {showDrafts && (
        <section id="product-draft-list" className="card full draftPanel">
          <h2>임시저장 목록 ({drafts.length}/20)</h2>
          {!drafts.length && <p className="note">임시저장된 상품이 없습니다.</p>}
          <div className="draftList">
            {drafts.map(record => (
              <div className="draftItem" key={record.model}>
                <div><strong>{record.model}</strong><span>{new Date(record.savedAt).toLocaleString("ko-KR")}</span>
                  {record.localCopy && <span>다른 기기에 더 최신 기본정보가 있습니다. 이 기기 저장본에는 이미지가 포함됩니다.</span>}
                </div>
                <button type="button" className="green" onClick={() => loadDraft(record.localCopy || record)}>{record.localCopy ? "이 기기 저장본 불러오기" : "불러오기"}</button>
                {record.localCopy && <button type="button" className="secondaryButton" onClick={() => loadDraft(record)}>다른 기기 기본정보 불러오기</button>}
                <button type="button" className="removeButton" onClick={() => void (async () => {
                  try {
                    const response = await postGoogleSheet({ action: "cloudDraftDelete", model: record.model });
                    await readDraftResponse(response);
                    await deleteProductDraft(record.model);
                    setDrafts(current => current.filter(draft => draft.model !== record.model));
                    await refreshDrafts();
                  } catch (error) {
                    setDraftStatus(`임시저장 삭제 실패: ${error instanceof Error ? error.message : "다시 시도해주세요."}`);
                  }
                })()}>삭제</button>
              </div>
            ))}
          </div>
        </section>
      )}
      {draftStatus && <p className="detailMessage draftStatus">{draftStatus}</p>}

      {/* 1. 제품사진 */}
      <section className="card full">
        <h2>1. 제품사진</h2>
        <p className="note">
          이곳에는 상품 확인과 이미지 검색에 사용할 사진을 넣어주세요.
          실제 쿠팡에 사용할 이미지는 아래 이미지 등록칸에 직접 넣습니다.
        </p>
        <div
          className={"dropZone" + (draggingPhotos ? " dragging" : "")}
          onDragOver={e => { e.preventDefault(); setDraggingPhotos(true); }}
          onDragLeave={() => setDraggingPhotos(false)}
          onDrop={e => {
            e.preventDefault();
            setDraggingPhotos(false);
            if (e.dataTransfer.files?.length) void addPhotoFiles(e.dataTransfer.files);
          }}
        >
          <label>
            <input
              type="file"
              accept="image/jpeg,image/jpg,image/png,.jpg,.jpeg,.png"
              multiple
              hidden
              onChange={e => {
                if (e.target.files?.length) void addPhotoFiles(e.target.files);
                e.target.value = "";
              }}
            />
            <strong>클릭 또는 드래그앤드롭</strong>
            <span>제품이 가장 잘 나온 사진으로 분석합니다</span>
          </label>
        </div>
        {photoMessage && <p className="detailMessage">{photoMessage}</p>}
        <div className="photoGrid">
          {photos.map((photo, index) => (
            <div
              key={photo.id}
              className={"photoCard" + (index === 0 ? " primary" : "")}
              draggable
              onDragStart={() => setDragPhotoIndex(index)}
              onDragOver={e => e.preventDefault()}
              onDrop={() => {
                if (dragPhotoIndex !== null) reorderPhoto(dragPhotoIndex, index);
                setDragPhotoIndex(null);
              }}
            >
              {index === 0 && <span className="badgePrimary">AI분석</span>}
              <img src={photo.dataUrl} alt={photo.name} />
              <div className="photoActions">
                <button type="button" onClick={() => setLightbox(photo.dataUrl)}>확대</button>
                <button type="button" onClick={() => removePhoto(photo.id)}>삭제</button>
              </div>
            </div>
          ))}
        </div>
        <button className="aiButton" type="button" disabled={loading} onClick={analyzeImage}>
          {loading ? "분석 중..." : "AI 사진분석"}
        </button>
        {message && <p className={message.startsWith("오류") ? "error" : "message"}>{message}</p>}
      </section>

      {/* 2. AI 결과 */}
      <section className="card full">
        <h2>2. AI 분석 결과</h2>
        <div className="results">
          <Result label="사진 특징" value={analysis.visualFeatures?.join(", ") || "-"} />
          <Result label="각인" value={analysis.engraving || "-"} alert={counterfeitAlert} />
          <Result
            label="가품 위험도"
            value={counterfeitAlert
              ? "⚠ 확인필요 — 상표·로고·디자인을 꼼꼼히 확인하세요."
              : analysis.counterfeitRisk || "-"}
            alert={counterfeitAlert}
          />
          <Result label="검토 이유" value={analysis.counterfeitReason || "-"} alert={counterfeitAlert} />
          <Result label="신뢰도" value={analysis.confidence != null ? `${analysis.confidence}%` : "-"} />
        </div>
      </section>

      {/* 3. 기본정보 */}
      <section className="card full basicInfoCard">
        <h2>3. 기본정보 확인</h2>
        <div className="formGrid">
          <Field label="거래처">
            <select value={product.supplier} onChange={e => update("supplier", e.target.value)}>
              {availableSuppliers.map(supplier => <option key={supplier}>{supplier}</option>)}
            </select>
          </Field>
          <Field label="카테고리">
            <select value={product.category} onChange={e => update("category", e.target.value)}>
              {Object.keys(codeMap).map(c => <option key={c}>{c}</option>)}
            </select>
          </Field>
          <Field label="성별">
            <select value={product.gender} onChange={e => update("gender", e.target.value)}>
              <option>여성</option><option>남성</option><option>남녀공용</option>
            </select>
          </Field>
          <Field label="소재">
            <select value={product.material} onChange={e => update("material", e.target.value)}>
              <option>써지컬스틸</option><option>925실버</option><option>티타늄</option>
              <option>신주</option><option>14K</option><option>18K</option><option>기타</option>
            </select>
          </Field>
          <Field label="색상옵션">
            <input value={product.colors} onChange={e => update("colors", e.target.value)} />
          </Field>
          <Field label="사이즈">
            <input value={product.sizes} onChange={e => updateSizes(e.target.value)} />
            {product.category === "목걸이" && (
              <small style={{ color: "#d92d20", fontWeight: 700 }}>
                필수입력{product.sizes.trim() ? "" : " · 목걸이는 사이즈가 비어 있으면 쿠팡에서 반려됩니다."}
              </small>
            )}
          </Field>
          <Field label="치수">
            <input value={product.dimension} onChange={e => update("dimension", e.target.value)}
              placeholder="예: 폭 8mm, 길이 42cm" />
          </Field>
          <Field label="모델번호 숫자">
            <input value={product.modelNo} readOnly={Boolean(reregisterModelName)} onChange={e => update("modelNo", e.target.value)} />
          </Field>
          <Field label="모델명">
            <input value={model} readOnly={Boolean(reregisterModelName)} onChange={e => updateModel(e.target.value)} />
            {modelCheckMessage && <small className={modelDuplicate && !modelReregisterable ? "duplicateModel" : "modelAvailable"}>{modelCheckMessage}</small>}
          </Field>
          <Field label="창고번호">
            <input value={product.warehouse || ""} onChange={e => update("warehouse", e.target.value)}
              placeholder="예: 711(592) · 미정이면 비워두세요" />
          </Field>
          {!reregisterModelName && <Field label="기존상품 재등록 SKU ID">
            <input inputMode="numeric" value={product.replacementSku || ""} onChange={e => update("replacementSku", e.target.value)}
              placeholder="재등록 상품만 기존 대표 SKU ID 입력" />
            <small>연결하면 기존 옵션별 창고번호·재고 이력을 가져옵니다. 기존행은 별도 최종 확인 전까지 삭제하지 않습니다.</small>
            <button className="secondaryButton replacementLinkButton" type="button" onClick={() => void linkExistingReplacement()}>기존 등록행에 연결</button>
            {pendingReplacementCleanup && <>
              <button className="secondaryButton replacementLinkButton" type="button" onClick={() => void deleteLinkedLegacyRows()}>이관 확인 후 기존행 삭제</button>
              <button className="secondaryButton replacementLinkButton" type="button" onClick={() => void undoLinkedReplacement()}>연결 취소 · 기존행 복원</button>
            </>}
          </Field>}
          <Field label="핵심키워드">
            <input value={product.keyword} onChange={e => update("keyword", e.target.value)} />
          </Field>
          <Field label="쿠팡 상품명">
            <input value={product.coupangTitle || generatedTitle} onChange={e => update("coupangTitle", e.target.value)} />
            <small>직접 수정할 수 있습니다. 자동 상품명으로 되돌리려면 아래 버튼을 누르세요.</small>
            <button className="existingDetailUseButton compactFieldButton" type="button" disabled={!product.coupangTitle && !titleBackup}
              onClick={() => {
                if (product.coupangTitle) { setTitleBackup(product.coupangTitle); update("coupangTitle", ""); }
                else { update("coupangTitle", titleBackup); setTitleBackup(""); }
              }}>{product.coupangTitle ? "자동 상품명 사용" : titleBackup ? "직접 입력값 복구" : "자동 상품명 사용 중"}</button>
          </Field>
          <Field label="검색태그">
            <input value={product.searchTags || generatedTags} onChange={e => update("searchTags", e.target.value)} />
            <small>쉼표로 구분해 직접 수정할 수 있습니다.</small>
            <button className="existingDetailUseButton compactFieldButton" type="button" disabled={!product.searchTags && !tagsBackup}
              onClick={() => {
                if (product.searchTags) { setTagsBackup(product.searchTags); update("searchTags", ""); }
                else { update("searchTags", tagsBackup); setTagsBackup(""); }
              }}>{product.searchTags ? "자동 검색태그 사용" : tagsBackup ? "직접 입력값 복구" : "자동 검색태그 사용 중"}</button>
          </Field>
          <Field label="원가 (부가세 미포함)">
            <input inputMode="numeric" value={product.cost} onChange={e => update("cost", e.target.value)} />
          </Field>
          <Field label="판매가">
            <input inputMode="numeric" value={product.price} onChange={e => update("price", e.target.value)} />
          </Field>
        </div>
        <div className="results" style={{ marginTop: 14 }}>
          <Result label="등록상태" value={ready ? "등록가능" : "판매가·키워드 확인"} status={ready} />
        </div>
      </section>

      {/* 4. 검색 */}
      <section className="card full sourcingCard">
        <h2>4. 쿠팡 · Google · 1688 검색</h2>
        <p className="note">쿠팡에서 판매 여부·가격을 확인하고, Google과 1688에서 동일제품 이미지를 찾습니다.</p>
        <div className="searchTwoButtons">
          <button className="coupangSearchButton" type="button" onClick={openCoupangSearch}>
            쿠팡 검색
          </button>
          <button className="googleSearchButton" type="button" onClick={openGoogleImages}>
            Google 이미지 검색
          </button>
          <button className="search1688Button" type="button" onClick={open1688Search}>
            1688 이미지 검색
          </button>
        </div>
        <button className="sourceAnalyzeButton sourcingAnalyzeFull" type="button" disabled={sourcingLoading}
          onClick={() => void analyzeSourcingImage()}>
          {sourcingLoading ? "사진 분석 중..." : "사진으로 1688 검색어 정밀 분석"}
        </button>
        {sourcingAnalysis.koreanSummary && <p className="sourcingSummary">{sourcingAnalysis.koreanSummary}</p>}
        {!!sourcingAnalysis.chineseKeywords?.length && (
          <div className="chineseKeywordList">
            <h3>중국어 검색어와 뜻</h3>
            {sourcingAnalysis.chineseKeywords.map((item, index) => (
              <div className="chineseKeywordItem" key={`${item.chinese}-${index}`}>
                <div><strong>{item.chinese}</strong><span>{item.koreanMeaning}</span></div>
                <button type="button" onClick={() => void copyText(item.chinese)}>복사</button>
              </div>
            ))}
          </div>
        )}
        {!!sourcingAnalysis.englishKeywords?.length && (
          <div className="chineseKeywordList">
            <h3>영어 검색어와 뜻</h3>
            {sourcingAnalysis.englishKeywords.map((item, index) => (
              <div className="chineseKeywordItem" key={`${item.english}-${index}`}>
                <div><strong>{item.english}</strong><span>{item.koreanMeaning}</span></div>
                <button type="button" onClick={() => void copyText(item.english)}>복사</button>
              </div>
            ))}
          </div>
        )}
        {[0, 1, 2].map(index => (
          <div key={index}>
            <div className="sourcingUrlRow">
              <input value={sourcingUrlInputs[index]}
                onChange={e => setSourcingUrlInputs(prev => prev.map((value, i) => i === index ? e.target.value : value))}
                placeholder="링크를 붙여넣으세요" />
              <button className="softBeigeButton" type="button" onClick={() => saveSourcingUrl(index)}>링크 저장</button>
            </div>
            {sourcingUrls[index] && (
              <div className="savedLinkBox">
                <p className="savedLinkText">{sourcingUrls[index]}</p>
                <div className="savedLinkActions">
                  <button type="button" onClick={() => openExternalUrl(sourcingUrls[index])}>링크 열기</button>
                  <button type="button" onClick={() => void copyText(sourcingUrls[index])}>복사</button>
                  <button type="button" onClick={() => {
                    setSourcingUrls(prev => prev.map((value, i) => i === index ? "" : value));
                    setSourcingUrlInputs(prev => prev.map((value, i) => i === index ? "" : value));
                  }}>삭제</button>
                </div>
              </div>
            )}
          </div>
        ))}
        {sourcingMessage && <p className="detailMessage">{sourcingMessage}</p>}
        <label className="multiUpload" style={{ marginTop: 12 }}
          onDragOver={e => e.preventDefault()}
          onDrop={e => {
            e.preventDefault();
            if (e.dataTransfer.files?.length) void addSourcingFiles(e.dataTransfer.files);
          }}>
          <input
            type="file"
            accept="image/jpeg,image/jpg,image/png"
            multiple
            hidden
            onChange={e => {
              if (e.target.files?.length) void addSourcingFiles(e.target.files);
              e.target.value = "";
            }}
          />
          <strong>이미지 직접 추가</strong>
          <span>다운로드한 사진은 제품사진과 분리해 아래에 표시합니다. 클릭하거나 드래그앤드롭하세요.</span>
        </label>
        {!!sourcingImages.length && (
          <div className="sourcingImageGrid">
            {sourcingImages.map(item => (
              <div key={item.id} className="sourcingImageCard">
                <img src={item.dataUrl} alt={item.name} onClick={() => setLightbox(item.dataUrl)} />
                <button type="button" onClick={() => setSourcingImages(prev => prev.filter(v => v.id !== item.id))}>삭제</button>
              </div>
            ))}
          </div>
        )}
        <div className="sourcingFolderActions">
          {dbSupported && !dbHandle && <button className="softSlateButton" type="button" onClick={pickFolder}>상품DB 폴더 선택</button>}
          <button className="softBeigeButton" type="button" onClick={() => void createSourcingFolder()}>모델명 폴더 생성</button>
          <button className="softSageButton" type="button" onClick={() => void saveSourcingImages()}>위 이미지 저장</button>
          {dbSupported && <button className="softBeigeButton" type="button" onClick={() => void openModelFolder()}>폴더 바로가기</button>}
        </div>
        <p className="note">위에 추가한 참고 사진을 상품DB의 카테고리/모델명/원본 폴더에 수집이미지로 저장합니다.</p>
        {sourcingSaveStatus && <p className="detailMessage">{sourcingSaveStatus}</p>}
      </section>

      {/* 5. 쿠팡 등록 이미지 */}
      <section className="card full">
        <div className="sectionTitleRow">
          <h2>5. 쿠팡 등록 이미지</h2>
          <div className="sectionTitleActions">
            <button className="pillButtonBeige" type="button" disabled={Boolean(exportLoading)}
              onClick={() => { setExportArea("images"); void downloadProductImagesOnly(); }}>
              {exportLoading === "images" ? "이미지 묶는 중..." : "썸네일 + 추가이미지만 다운로드"}
            </button>
            <button className="resetImagesButton" type="button" onClick={resetCoupangImages} title="5번의 사진 목록과 모든 칸의 사진을 비웁니다.">이미지 초기화</button>
          </div>
        </div>
        {exportArea === "images" && exportMessage && <p className={exportMessage.startsWith("오류") ? "error" : "detailMessage"}>{exportMessage}</p>}
        <div className="multiUpload imagePoolUpload" onClick={() => void openUploadPoolPicker()}
          onDragOver={e => e.preventDefault()}
          onDrop={e => {
            e.preventDefault();
            if (e.dataTransfer.files?.length) void addUploadPoolFiles(e.dataTransfer.files);
          }}>
          <input ref={uploadPoolInputRef} type="file" accept="image/jpeg,image/jpg,image/png" multiple hidden
            onClick={e => e.stopPropagation()}
            onChange={e => {
              if (e.target.files?.length) void addUploadPoolFiles(e.target.files);
              e.target.value = "";
            }} />
          <strong>여러 이미지를 한 번에 업로드</strong>
          <span>클릭하거나 이미지를 이곳으로 드래그한 뒤 각 등록 칸에 배치하세요.</span>
        </div>
        {!!uploadPool.length && (
          <div className="uploadPool uploadPoolSticky" title="5번 안에서 아래로 내려도 이 사진 목록은 화면 위에 붙어 있습니다.">
            {uploadPool.map((item, index) => (
              <div className="uploadPoolItem" key={`${item.fileName}-${index}`} draggable
                onDragStart={e => e.dataTransfer.setData("application/x-laura-pool-index", String(index))}>
                <img src={item.dataUrl} alt={item.fileName} />
                <span>{item.fileName}</span>
                <button type="button" onClick={() => setUploadPool(prev => prev.filter((_, i) => i !== index))}>삭제</button>
              </div>
            ))}
          </div>
        )}

        <div className="slotAddButtons">
          <button type="button" onClick={() => addCustomSlot("all")}>+ 전체옵션 이미지</button>
          <button type="button" onClick={() => addCustomSlot("detail")}>+ 디테일컷</button>
          <button type="button" onClick={() => addCustomSlot("wear")}>+ 착용컷</button>
        </div>

        {variantOptions.error && <p className="error">{variantOptions.error} 색상에는 블랙,화이트처럼 색상만, 사이즈에는 S,M처럼 사이즈만 입력해주세요.</p>}
        {!!legacyColorThumbs.length && <div>
          <p className="note">이전에 저장한 색상 사진입니다. 사용할 옵션 칸으로 직접 끌어놓으세요.</p>
          <div className="uploadPool">{legacyColorThumbs.map(([color, slot]) => <div className="uploadPoolItem" key={color} draggable
            onDragStart={event => event.dataTransfer.setData("application/x-laura-slot-key", `legacy:${color}`)}>
            <img src={slot!.dataUrl} alt={`이전 ${color} 사진`} /><span>이전 {color} 사진</span>
          </div>)}</div>
        </div>}

        <div className="imageSlotGrid" key={draftRestoreRevision}>
          <ImageSlot
            slotKey="mainWear"
            title="메인착용컷"
            subtitle="상세페이지 전용"
            filename=""
            value={mainWear}
            onChange={setMainWear}
            onPoolDrop={index => assignPoolItem(index, "mainWear")}
            onReturnToPool={returnToPool}
            onSlotSwap={swapSlots}
            onExpand={setLightbox}
          />
          <ImageSlot
            slotKey="all"
            title="전체옵션 이미지"
            subtitle="추가이미지 01"
            filename={model ? `${model}-01.jpg` : "모델명-01.jpg"}
            value={allOptions}
            onChange={setAllOptions}
            onPoolDrop={index => assignPoolItem(index, "all")}
            onReturnToPool={returnToPool}
            onSlotSwap={swapSlots}
            onExpand={setLightbox}
            onAddDetail={
              includeAllOptionsInDetail && allOptions
                ? () => pushDetail("전체옵션", allOptions.dataUrl)
                : undefined
            }
          />

          {variants.map(variant => (
            <ImageSlot
              slotKey={`opt:${variant.key}`}
              key={variant.key}
              title={`${variant.label} 썸네일`}
              filename={`${model || "모델명"}${variant.thumbFile}`}
              value={activeVariantThumbs[variant.key] || null}
              onChange={slot => void setOptionThumbCovered(variant.key, slot)}
              onPoolDrop={index => assignPoolItem(index, `opt:${variant.key}`)}
              onReturnToPool={returnToPool}
              coverSquare
              onSlotSwap={swapSlots}
              onExpand={setLightbox}
              onAddDetail={
                activeVariantThumbs[variant.key]
                  ? () => pushDetail(`${variant.label} 썸네일`, activeVariantThumbs[variant.key]!.dataUrl)
                  : undefined
              }
            />
          ))}

          <ImageSlot
            slotKey="detail"
            title="디테일컷"
            subtitle="추가이미지 02"
            filename={model ? `${model}-02.jpg` : "모델명-02.jpg"}
            value={detailCut}
            onChange={setDetailCut}
            onPoolDrop={index => assignPoolItem(index, "detail")}
            onReturnToPool={returnToPool}
            onSlotSwap={swapSlots}
            onExpand={setLightbox}
            onAddDetail={detailCut ? () => pushDetail("디테일컷", detailCut.dataUrl) : undefined}
          />
          <ImageSlot
            slotKey="wear01"
            title="착용컷 01"
            subtitle="추가이미지 03"
            filename={model ? `${model}-03.jpg` : "모델명-03.jpg"}
            value={wear01}
            onChange={setWear01}
            onPoolDrop={index => assignPoolItem(index, "wear01")}
            onReturnToPool={returnToPool}
            onSlotSwap={swapSlots}
            onExpand={setLightbox}
            onAddDetail={wear01 ? () => pushDetail("착용컷 01", wear01.dataUrl) : undefined}
          />
          <ImageSlot
            slotKey="wear02"
            title="착용컷 02"
            subtitle="추가이미지 04"
            filename={model ? `${model}-04.jpg` : "모델명-04.jpg"}
            value={wear02}
            onChange={setWear02}
            onPoolDrop={index => assignPoolItem(index, "wear02")}
            onReturnToPool={returnToPool}
            onSlotSwap={swapSlots}
            onExpand={setLightbox}
            onAddDetail={wear02 ? () => pushDetail("착용컷 02", wear02.dataUrl) : undefined}
          />
          {customSlots.map((item, index) => (
            <ImageSlot
              key={item.id}
              slotKey={`custom:${item.id}`}
              title={customSlotTitle(item, index)}
              subtitle={`사용자 추가 이미지 ${String(index + 5).padStart(2, "0")}`}
              filename={model ? `${model}-${String(index + 5).padStart(2, "0")}.jpg` : `모델명-${String(index + 5).padStart(2, "0")}.jpg`}
              value={item.slot}
              onChange={slot => setSlotValue(`custom:${item.id}`, slot)}
              onPoolDrop={poolIndex => assignPoolItem(poolIndex, `custom:${item.id}`)}
              onReturnToPool={returnToPool}
              onSlotSwap={swapSlots}
              onExpand={setLightbox}
              onAddDetail={item.slot ? () => pushDetail(customSlotTitle(item, index), item.slot!.dataUrl) : undefined}
              onRemoveSlot={() => { returnToPool(item.slot); setCustomSlots(prev => prev.filter(slot => slot.id !== item.id)); }}
            />
          ))}
        </div>

      </section>

      {/* 6. 상세페이지 */}
      <section className="card full">
        <div className="sectionTitleRow">
          <h2>6. 상세페이지</h2>
          {preparedDetail && (
            <button type="button" className="existingDetailUseButton" title={`MYBOX 후보: ${preparedDetail.name}`}
              onClick={() => { setIncomingDetailFile(preparedDetail.file); setIncomingDetailToken(token => token + 1); }}>기존상세페이지 사용</button>
          )}
        </div>
        <div className="detailBrandImages">
          <div className="detailBrandBlock">
            <strong>상단 로고 이미지</strong>
            <img src={detailHeader?.dataUrl || DEFAULT_DETAIL_HEADER} alt="상단 로고 이미지" />
            <div className="detailBrandActions">
              <label className="detailBrandUpload"
                onDragOver={event => event.preventDefault()}
                onDrop={event => { event.preventDefault(); void changeDetailBrandImage("header", event.dataTransfer.files?.[0]); }}>
                이미지 변경하기
                <input type="file" accept="image/jpeg,image/jpg,image/png" onChange={event => { void changeDetailBrandImage("header", event.target.files?.[0]); event.target.value = ""; }} />
              </label>
              <button type="button" className="detailBrandUpload"
                disabled={!detailPreview || detailPreview === logoAppliedPreview}
                title={!detailPreview ? "아래 상세페이지 칸에 상세페이지가 있어야 합니다." : detailPreview === logoAppliedPreview ? "이미 상단 로고를 붙였습니다." : "아래 상세페이지 맨 위에 이 상단 로고를 붙입니다."}
                onClick={async () => {
                  try {
                    const next = await prependHeader(detailPreview, detailHeader?.dataUrl || DEFAULT_DETAIL_HEADER);
                    setDetailPreview(next);
                    setLogoAppliedPreview(next);
                    setSquareImagesMessage("");
                    setDetailMessage("상세페이지 맨 위에 상단 로고를 붙였습니다.");
                  } catch (error) {
                    setDetailMessage(`오류: ${error instanceof Error ? error.message : "상단 로고를 붙이지 못했습니다."}`);
                  }
                }}>상세페이지 사용</button>
            </div>
            {detailHeader && <button type="button" className="secondaryButton" onClick={() => { setDetailHeader(null); setDetailPreview(""); }}>NOID-B 기본 로고로 되돌리기</button>}
          </div>
          <div className="detailBrandBlock">
            <strong>하단 로고·안내 이미지 (선택)</strong>
            {detailFooter ? <img src={detailFooter.dataUrl} alt="하단 이미지" /> : <span>올리지 않으면 흰 여백으로 끝납니다.</span>}
            <label className="detailBrandUpload"
              onDragOver={event => event.preventDefault()}
              onDrop={event => { event.preventDefault(); void changeDetailBrandImage("footer", event.dataTransfer.files?.[0]); }}>
              하단 이미지 올리기
              <input type="file" accept="image/jpeg,image/jpg,image/png" onChange={event => { void changeDetailBrandImage("footer", event.target.files?.[0]); event.target.value = ""; }} />
            </label>
            {detailFooter && <button type="button" className="secondaryButton" onClick={() => { setDetailFooter(null); setDetailPreview(""); }}>하단 이미지 빼기</button>}
          </div>
        </div>
        <QuickDetailRemake
          headerUrl={detailHeader?.dataUrl || DEFAULT_DETAIL_HEADER}
          footerUrl={detailFooter?.dataUrl || ""}
          modelName={model}
          poolImages={quickRemakePool}
          incomingFile={incomingDetailFile}
          incomingToken={incomingDetailToken}
          onComplete={({ dataUrl, logoApplied }) => {
            setDetailPreview(dataUrl);
            setLogoAppliedPreview(logoApplied ? dataUrl : "");
            setSquareImagesMessage("");
            setDetailMessage(logoApplied ? "자른 상세페이지에 상단 로고를 붙여 아래 상세페이지 칸에 넣었습니다." : "새 상세페이지를 아래 상세페이지 칸에 넣었습니다.");
          }}
          onAddToList={items => {
            setUploadPool(prev => [...prev, ...items]);
            setPhotoMessage(`${items.length}장을 5번 쿠팡 등록이미지 목록에 추가했습니다. 썸네일·추가이미지 칸으로 끌어 넣으세요.`);
          }}
        />

        <div className="detailList">
          {detailImages.map((item, index) => (
            <div
              key={item.id}
              className="detailItem draggableDetail"
              draggable
              onDragStart={() => setDragDetailIndex(index)}
              onDragOver={e => e.preventDefault()}
              onDrop={() => {
                if (dragDetailIndex === null || dragDetailIndex === index) return;
                detailOrderEditedRef.current = true;
                setDetailImages(prev => {
                  const next = [...prev];
                  const [m] = next.splice(dragDetailIndex, 1);
                  next.splice(index, 0, m);
                  return next;
                });
                setDragDetailIndex(null);
                setDetailPreview("");
              }}
            >
              <img src={item.dataUrl} alt={item.name} />
              <div className="detailItemInfo">
                <strong>{item.name}</strong>
                <div className="detailItemButtons">
                  <button type="button" onClick={() => setLightbox(item.dataUrl)}>확대</button>
                  <button type="button" className="removeButton"
                    onClick={() => {
                      if (item.id.startsWith("slot:")) dismissedDetailSlotsRef.current.set(item.id, item.dataUrl);
                      setDetailImages(prev => prev.filter(d => d.id !== item.id));
                      setDetailPreview("");
                    }}>삭제</button>
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="detailActions">
          <button type="button" className="purpleButton" onClick={() => void buildDetailPage()}>
            780px 상세페이지 만들기
          </button>
          <button type="button" className="pillButtonBeige" disabled={!detailPreview || detailShareLoading}
            title={detailPreview ? "휴대폰에서 상세페이지를 볼 수 있는 링크를 만듭니다." : "상세페이지를 먼저 만들어주세요."}
            onClick={() => void shareDetailPreview()}>
            {detailShareLoading ? "링크 만드는 중..." : "모바일 링크 만들기"}
          </button>
          <button type="button" className="pillButtonBeige" disabled={Boolean(exportLoading)}
            onClick={() => { setExportArea("detail"); void downloadDetailPageOnly(); }}>
            {exportLoading === "detail" ? "상세이미지 생성 중..." : "상세이미지만 다운로드"}
          </button>
        </div>
        {detailMessage && <p className="detailMessage">{detailMessage}</p>}
        {exportArea === "detail" && exportMessage && <p className={exportMessage.startsWith("오류") ? "error" : "detailMessage"}>{exportMessage}</p>}
        {detailPreview && (
          <div className="detailResult">
            {detailShareUrl && <p className="detailMessage"><a href={detailShareUrl} target="_blank" rel="noopener noreferrer">{detailShareUrl}</a></p>}
            {detailShareError && <p className="error">{detailShareError}</p>}
            <div className="detailPreviewFrame">
              <img src={detailPreview} alt="상세페이지" />
            </div>
          </div>
        )}
      </section>

      {/* 7. 마지막 단계 */}
      <section className="card full dbSetupCard">
        <h2>7. 상품DB · 등록파일 일괄 생성</h2>
        <div className="exportActions">
          {dbSupported && <button className="folderPickButton" type="button" onClick={pickFolder}>폴더 선택</button>}
          {dbSupported && <button className="folderPickButton" type="button" onClick={() => void openModelFolder(setDbStatus)}>폴더 바로가기</button>}
          <button className="finalSaveDraft" type="button" disabled={draftSaving} onClick={() => void saveDraft()}>
            {draftSaving ? "임시저장 중..." : "임시저장"}
          </button>
        </div>
        {dbFolderName &&<p className="detailMessage">연결: {dbFolderName}</p>}
        {dbStatus && <p className="note">{dbStatus}</p>}
        <div className="batchModePanel" role="group" aria-label="일괄 생성 용도">
          <button type="button" className={batchMode === "actual" ? "selected" : ""} onClick={() => setBatchMode("actual")}>
            <strong>실제 등록용</strong><span>새 모델 등록 · 판매중지 모델은 기존 행 재사용</span>
          </button>
          <button type="button" className={batchMode === "practice" ? "selected" : ""} onClick={() => setBatchMode("practice")}>
            <strong>테스트·교육용</strong><span>ZIP만 생성 · 폴더와 제품DB 변경 없음</span>
          </button>
        </div>
        {batchMode === "actual" && modelDuplicate && !modelReregisterable && <p className="dangerAlert">기존 모델입니다. 판매중지 상태가 아닌 모델의 일괄 등록은 차단됩니다.</p>}
        <div className="finalSaveActions">
          <button className="finalSaveAll" type="button" disabled={batchBusy} onClick={batchSave}>
            {batchBusy ? "저장 중..." : batchMode === "practice" ? "테스트 ZIP 생성" : "전체 파일 저장"}
          </button>
        </div>
        {draftStatus && <p className="detailMessage" role="status" aria-live="polite">{draftStatus}</p>}
        {!dbSupported && <p className="saveExplain">모바일에서는 상품DB ZIP이 다운로드됩니다. 다운로드 완료 후 공유 또는 파일 앱에서 Google Drive에 저장하세요.</p>}
        {batchStatus && <p className={batchStatus.startsWith("오류") ? "error" : "detailMessage"}>{batchStatus}</p>}
        {dbSavedFiles.length > 0 && (
          <div className="dbFileList"><h3>저장된 파일</h3><ul>{dbSavedFiles.slice(0, 40).map(f => <li key={f}>{f}</li>)}</ul></div>
        )}
        {registrationUploadReady?.model === model && (
          <div className="registrationNextStep" role="status">
            <div>
              <strong>실제 등록파일 준비 완료</strong>
              <span>{model} · {registrationUploadReady.files.length.toLocaleString()}개 파일 · Google 제품DB 반영 완료</span>
              <span>다음은 Supplier Hub에서 등록파일과 견적서를 올린 뒤 최종 제출하는 단계입니다.</span>
            </div>
            <div className="registrationNextActions">
              <button type="button" className="secondaryButton" onClick={() => void copyModelFolderPath()}>폴더 경로 복사</button>
              <a href="https://supplier.coupang.com/qvt/registration" target="_blank" rel="noreferrer">Supplier Hub 대량상품등록 열기</a>
            </div>
            {folderPathMessage && <span className="registrationPathMessage">{folderPathMessage}</span>}
          </div>
        )}
      </section>

      {/* 8. 기타 파일 생성 */}
      <section className="card full dbSetupCard">
        <h2>8. 기타 파일 생성</h2>
        <div className="labelQuickPanel">
          <strong>라벨 정보</strong>
          <p>현재 상품 정보를 기본값으로 사용합니다. 바꿔야 하는 항목만 수정하세요.</p>
          <div className="labelQuickFields">
            <Field label="모델명"><input value={model} readOnly={Boolean(reregisterModelName)} onChange={e => updateModel(e.target.value)} /></Field>
            <Field label="제조연월"><input value={labelManufactureYearMonth} onChange={e => setLabelManufactureYearMonth(e.target.value)} placeholder="2026.09" /></Field>
            <Field label="제조자명"><input value={labelManufacturerName} onChange={e => setLabelManufacturerName(e.target.value)} /></Field>
            <Field label="수입자명"><input value={labelImporterName} onChange={e => setLabelImporterName(e.target.value)} /></Field>
          </div>
          <span>{dbHandle ? "라벨만 실행하면 연결된 상품이미지DB/라벨 폴더에 JPG로 저장됩니다." : "저장 폴더가 연결되지 않은 환경에서는 JPG로 다운로드됩니다."}</span>
        </div>
        <div className="individualDownloadGrid">
          <button className="secondaryButton" type="button" disabled={Boolean(exportLoading)} onClick={() => { setExportArea("etc"); void downloadQuote(); }}>
            {exportLoading === "quote" ? "견적서 생성 중..." : "견적서만 다운로드"}
          </button>
          <button className="secondaryButton" type="button" disabled={Boolean(exportLoading)} onClick={() => { setExportArea("etc"); void downloadLabel(); }}>
            {exportLoading === "label" ? "라벨 생성 중..." : dbHandle ? "라벨만 저장" : "라벨만 다운로드"}
          </button>
        </div>
        {exportArea === "etc" && exportMessage && <p className={exportMessage.startsWith("오류") ? "error" : "detailMessage"}>{exportMessage}</p>}
        <div className="quoteQueuePanel">
          <div className="quoteQueueHeader">
            <div><h3>카테고리별 묶음 견적서</h3><p>등록할 때 자동 누적되며 같은 성별·카테고리끼리 최대 1,000 SKU행으로 나뉩니다.</p></div>
            <button type="button" className="softSageButton" disabled={Boolean(quoteQueueBusy)} onClick={() => void loadQuoteQueue()} style={{ flexShrink: 0, minWidth: "160px", padding: "12px 22px", whiteSpace: "nowrap", fontSize: "16px" }}>
              {quoteQueueBusy === "목록" ? "불러오는 중..." : "대기목록 불러오기"}
            </button>
          </div>
          {!quoteGroups.length && <p className="note">대기목록을 불러오거나 새 상품을 저장하면 여기에 표시됩니다.</p>}
          <div className="quoteGroupList">
            {quoteGroups.map(group => (
              <div className="quoteGroupItem" key={group.key}>
                <div>
                  <strong>{group.gender} · {group.category}</strong>
                  <span>{group.models.toLocaleString()}모델 · {group.skuCount.toLocaleString()} SKU행</span>
                  <span className="quoteModelNames">포함 모델:</span>
                  <span className="quoteModelChips">
                    {group.modelNames.map(modelName => (
                      <span className="quoteModelChip" key={modelName}>
                        {modelName}
                        <button
                          type="button"
                          aria-label={`${modelName} 대기목록에서 삭제`}
                          title="이 모델만 대기목록에서 삭제"
                          disabled={Boolean(quoteQueueBusy)}
                          onClick={() => void deleteQuoteModel(modelName)}
                        >×</button>
                      </span>
                    ))}
                  </span>
                </div>
                <div className="quoteGroupActions">
                  <button type="button" disabled={Boolean(quoteQueueBusy)} onClick={() => void downloadQuoteGroup(group)}>묶음 견적서 다운로드</button>
                  <button type="button" className="secondaryButton" onClick={() => void openQuoteCategoryFolder(group)}>폴더 바로가기</button>
                  <button type="button" className="dangerTextButton" disabled={Boolean(quoteQueueBusy)} onClick={() => void clearQuoteGroup(group)}>목록 비우기</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="product-registration-status" className="card full">
        <div className="wms-section-heading" style={{ marginTop: 0 }}>
          <div><span>PRODUCT REGISTRATION</span><h2>9. 등록 진행상황 · 상품 운영정보</h2></div>
        </div>
        <div className="wms-automation-grid">
          <WimsRegistrationImportPanel />
          <SupplyStatusAuditPanel />
        </div>
      </section>

      {lightbox && (
        <div className="lightbox" onClick={() => setLightbox("")}>
          <img src={lightbox} alt="확대" onClick={e => e.stopPropagation()} />
        </div>
      )}
    </main>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="field"><span>{label}</span>{children}</label>;
}

function Result({ label, value, status, alert }: { label: string; value: string; status?: boolean; alert?: boolean }) {
  return (
    <div className="result">
      <span>{label}</span>
      <strong className={alert ? "dangerAlert" : status === undefined ? "" : status ? "good" : "warn"}>{value}</strong>
    </div>
  );
}

// Google DB(Apps Script)는 가끔 일시적으로 404·지연을 내므로 한 번 더 시도한 뒤 실패로 본다.
async function checkModelInGoogleDb(model: string): Promise<{ duplicate: boolean; reregisterable: boolean; message: string }> {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(`/api/google-sheet?model=${encodeURIComponent(model)}`, { cache: "no-store" });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || "중복확인 실패");
      return {
        duplicate: Boolean(data.duplicate),
        reregisterable: Boolean(data.reregisterable),
        message: data.reregisterable ? (data.reason || "기존 행 재등록 가능") : data.duplicate ? (data.reason || "중복번호") : data.configured === false ? "Google DB 연결 후 중복확인" : "사용 가능한 모델명",
      };
    } catch (error) {
      if (attempt < 1) {
        await new Promise(resolve => window.setTimeout(resolve, 1500));
        continue;
      }
      // Apps Script 오류 본문(HTML)은 길어서 첫 구간만 보여준다.
      const detail = error instanceof Error ? error.message.split(" · ")[0].trim() : "";
      return { duplicate: false, reregisterable: false, message: detail && detail !== "중복확인 실패" ? `중복확인 실패 · ${detail}` : "중복확인 실패" };
    }
  }
}

function SlotCropEditor({ value, title, onChange, tuneHost }: { value: SlotImage; title: string; onChange: (v: SlotImage | null) => void; tuneHost: HTMLElement | null }) {
  const source = value.source || value.dataUrl;
  const [loadedImg, setLoadedImg] = useState<HTMLImageElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [view, setView] = useState<SquareCrop>(value.crop || { zoom: 1, x: 0, y: 0 });
  const [tuneOpen, setTuneOpen] = useState(false);
  // 마우스가 지나가기만 해도 휠로 확대·축소되면 화면을 내리다 사진이 바뀐다 → 칸을 한 번 클릭한 뒤에만 휠 확대·축소.
  const [active, setActive] = useState(false);
  const activeRef = useRef(false);
  activeRef.current = active;
  const viewRef = useRef(view);
  const frameRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ px: number; py: number } | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const valueRef = useRef(value);
  valueRef.current = value;
  const locked = Boolean(value.locked);
  const lockedRef = useRef(locked);
  lockedRef.current = locked;
  const sourceRef = useRef(source);
  sourceRef.current = source;

  useEffect(() => {
    let alive = true;
    const img = new Image();
    img.onload = () => { if (alive) setLoadedImg(img); };
    img.src = source;
    return () => { alive = false; };
  }, [source]);

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  // 칸에 처음 들어온 사진이 1000×1000이 아니면, 화면에 보이는 그대로(가장자리 자연스럽게 채움) 1000×1000으로 바로 만든다.
  // 예전에는 손대지 않으면 원본 비율 그대로 남아, 저장할 때 흰 여백이 붙고 상세페이지에서는 모양이 달라졌다.
  useEffect(() => {
    if (!loadedImg || lockedRef.current || valueRef.current.crop) return;
    if (loadedImg.naturalWidth === 1000 && loadedImg.naturalHeight === 1000) return;
    commit(viewRef.current);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadedImg]);

  const commit = (next: SquareCrop) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(async () => {
      try {
        const dataUrl = await renderSquareCrop(sourceRef.current, next);
        onChange({ ...valueRef.current, dataUrl, source: sourceRef.current, crop: next });
      } catch { /* ignore */ }
    }, 250);
  };

  const update = (next: SquareCrop) => {
    const clamped = {
      zoom: Math.max(0.3, Math.min(5, next.zoom)),
      x: Math.max(-1.5, Math.min(1.5, next.x)),
      y: Math.max(-1.5, Math.min(1.5, next.y)),
      brightness: Math.max(-60, Math.min(60, next.brightness || 0)),
      sharpness: Math.max(0, Math.min(1, next.sharpness || 0)),
    };
    viewRef.current = clamped;
    setView(clamped);
    commit(clamped);
  };

  useEffect(() => {
    const el = frameRef.current;
    if (!el) return;
    const onWheel = (event: WheelEvent) => {
      if (lockedRef.current || !activeRef.current) return;
      event.preventDefault();
      const v = viewRef.current;
      update({ ...v, zoom: v.zoom * (event.deltaY < 0 ? 1.06 : 1 / 1.06) });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 칸 바깥을 누르면 휠 확대·축소를 끈다.
  useEffect(() => {
    if (!active) return;
    const onOutside = (event: PointerEvent) => {
      if (frameRef.current && !frameRef.current.contains(event.target as Node)) setActive(false);
    };
    document.addEventListener("pointerdown", onOutside);
    return () => document.removeEventListener("pointerdown", onOutside);
  }, [active]);

  const sharp = sharpenAmount(view.sharpness || 0);

  useEffect(() => {
    if (canvasRef.current && loadedImg) drawSquareCrop(canvasRef.current, loadedImg, view, 540);
  }, [loadedImg, view]);

  return (
    <div
      ref={frameRef}
      className={"slotCropFrame" + (active && !locked ? " slotCropActive" : "")}
      onPointerDown={event => {
        if (lockedRef.current) return;
        setActive(true);
        event.currentTarget.setPointerCapture(event.pointerId);
        dragRef.current = { px: event.clientX, py: event.clientY };
      }}
      onPointerMove={event => {
        const start = dragRef.current;
        const box = frameRef.current;
        if (!start || !box) return;
        const size = box.getBoundingClientRect().width || 1;
        const v = viewRef.current;
        dragRef.current = { px: event.clientX, py: event.clientY };
        update({ ...v, x: v.x + (event.clientX - start.px) / size, y: v.y + (event.clientY - start.py) / size });
      }}
      onPointerUp={() => { dragRef.current = null; }}
      onPointerCancel={() => { dragRef.current = null; }}
      onDoubleClick={() => { if (!lockedRef.current) update({ zoom: 1, x: 0, y: 0 }); }}
      title={locked ? "저장됨 · 수정 버튼을 누르면 다시 조절할 수 있습니다." : active ? "끌어서 위치 이동 · 마우스 휠로 확대/축소 · 더블클릭으로 처음 상태 · 칸 바깥을 누르면 휠 확대 끔" : "사진을 한 번 클릭하면 마우스 휠로 확대/축소할 수 있습니다."}
    >
      <canvas ref={canvasRef} className="slotCropCanvas" aria-label={title} />
      {!locked && <div className="slotCropTools" onPointerDown={event => event.stopPropagation()}>
        <button type="button" onClick={() => update({ zoom: 1, x: 0, y: 0, brightness: 0, sharpness: 0 })} title="처음 상태로 되돌리기">↻</button>
        <button type="button" onClick={() => setTuneOpen(open => !open)} title="밝기·선명도">☀</button>
        <button type="button" onClick={() => update({ ...viewRef.current, zoom: viewRef.current.zoom / 1.1 })}>－</button>
        <button type="button" onClick={() => update({ ...viewRef.current, zoom: viewRef.current.zoom * 1.1 })}>＋</button>
      </div>}
      {!locked && tuneOpen && tuneHost && createPortal(
        <div className="slotCropTune" onPointerDown={event => event.stopPropagation()} onDoubleClick={event => event.stopPropagation()}>
          <label>밝기 {view.brightness || 0}
            <input type="range" min={-60} max={60} step={1} value={view.brightness || 0}
              onChange={event => update({ ...viewRef.current, brightness: Number(event.target.value) })} />
          </label>
          <label>선명도 {Math.round(sharp * 100)}%
            <input type="range" min={0} max={1} step={0.05} value={sharp}
              onChange={event => update({ ...viewRef.current, sharpness: Number(event.target.value) })} />
          </label>
        </div>,
        tuneHost
      )}
    </div>
  );
}

function ImageSlot({
  slotKey,
  title,
  subtitle,
  filename,
  value,
  onChange,
  onExpand,
  onAddDetail,
  onPoolDrop,
  onReturnToPool,
  onSlotSwap,
  onRemoveSlot,
  coverSquare = false,
}: {
  slotKey: string;
  title: string;
  subtitle?: string;
  filename: string;
  value: SlotImage | null;
  onChange: (v: SlotImage | null) => void;
  onExpand: (url: string) => void;
  onAddDetail?: () => void;
  onPoolDrop?: (index: number) => void;
  /** 칸에서 빠지는 사진을 이미지 목록으로 되돌린다. */
  onReturnToPool?: (slot: SlotImage) => void;
  onSlotSwap?: (sourceKey: string, targetKey: string) => void;
  onRemoveSlot?: () => void;
  coverSquare?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [tuneHost, setTuneHost] = useState<HTMLDivElement | null>(null);
  const pendingFileRevision = useRef(0);
  const displaySubtitle = slotKey.startsWith("opt:") ? filename : subtitle;
  useEffect(() => () => { pendingFileRevision.current += 1; }, []);

  const applyFile = async (file: File | undefined) => {
    if (!file) return;
    if (!ACCEPTED.includes(file.type) && !/\.(jpe?g|png)$/i.test(file.name)) return;
    const revision = ++pendingFileRevision.current;
    const sourceDataUrl = await readFile(file);
    const dataUrl = coverSquare ? await coverSquareCanvas(sourceDataUrl) : sourceDataUrl;
    if (pendingFileRevision.current !== revision) return;
    if (value) onReturnToPool?.(value);
    onChange({ dataUrl, fileName: file.name });
  };

  return (
    <div className={"imageSlot" + (value ? " imageSlotFilled" : " imageSlotEmpty") + (dragging ? " dragging" : "")}>
      <div className="imageSlotHeader"
        draggable={Boolean(value)}
        title={value ? "제목을 끌어 다른 칸과 위치를 바꿀 수 있습니다." : undefined}
        onDragStart={e => {
          if (!value) return;
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData("application/x-laura-slot-key", slotKey);
        }}>
        <h3>{title}</h3>
        {displaySubtitle && <p className="slotAlias" title={displaySubtitle}>{displaySubtitle}</p>}
      </div>
      <div
        className={"slotDrop" + (value && !value.locked ? " slotDropEdit" : "")}
        onClick={() => { if (!value) inputRef.current?.click(); }}
        draggable={Boolean(value?.locked)}
        onDragStart={e => {
          if (!value?.locked) return;
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData("application/x-laura-slot-key", slotKey);
        }}
        onDragOver={e => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={e => {
          e.preventDefault();
          setDragging(false);
          pendingFileRevision.current += 1;
          const poolIndex = e.dataTransfer.getData("application/x-laura-pool-index");
          if (poolIndex !== "" && onPoolDrop) {
            onPoolDrop(Number(poolIndex));
            return;
          }
          const sourceKey = e.dataTransfer.getData("application/x-laura-slot-key");
          if (sourceKey && onSlotSwap) {
            onSlotSwap(sourceKey, slotKey);
            return;
          }
          void applyFile(e.dataTransfer.files?.[0]);
        }}
      >
        {value ? (
          <SlotCropEditor key={value.fileName} value={value} title={title} onChange={onChange} tuneHost={tuneHost} />
        ) : (
          <div className="slotPlaceholder">
            <strong>{title}</strong>
            <span>이미지를 끌어놓거나 클릭하세요.</span>
          </div>
        )}
      </div>
      <div ref={setTuneHost} />
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/jpg,image/png"
        hidden
        onChange={e => {
          void applyFile(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      <div className="slotActions">
        {value && <button type="button" className={value.locked ? "secondaryButton" : "green"} onClick={() => onChange({ ...value, locked: !value.locked })}>{value.locked ? "수정" : "저장"}</button>}
        {value && <button type="button" className="removeButton" onClick={() => { pendingFileRevision.current += 1; onReturnToPool?.(value); onChange(null); }} title="칸에서 빼서 위쪽 이미지 목록으로 되돌립니다.">삭제</button>}
        {onRemoveSlot && <button type="button" className="removeButton" onClick={onRemoveSlot}>칸 삭제</button>}
      </div>
    </div>
  );
}
