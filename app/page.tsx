"use client";

import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  ensureReadWritePermission,
  loadDirectoryHandle,
  saveDirectoryHandle,
  supportsDirectoryPicker,
} from "@/lib/product-db/idb";
import {
  buildAdditionalImagesCsv,
  collectProductDbFiles,
  createLabelBlob,
  colorCode,
  ringSizeNumber,
} from "@/lib/product-db/files";
import { ensureProductFolderTree, writeCategoryFile, writeProductDbFiles } from "@/lib/product-db/fs";
import { dataUrlToBlob } from "@/lib/product-db/files";
import { buildProductDbZip } from "@/lib/product-db/zip";
import { compressImageDataUrl } from "@/lib/image/compress";
import { normalizeCoupangImage } from "@/lib/image/normalize-coupang";
import { defaultFitAdjust, fitToWhiteCanvas, type FitAdjust } from "@/lib/thumbnail/fit";
import { deleteProductDraft, listProductDrafts, saveProductDraft, type ProductDraftRecord } from "@/lib/drafts/idb";

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
type SlotImage = { dataUrl: string; fileName: string };
type DetailImage = { id: string; name: string; dataUrl: string };
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
const MAX_PHOTOS = 10;
const ACCEPTED = ["image/jpeg", "image/jpg", "image/png"];
const DRAFT_STORAGE_KEY = "laura-product-draft";
const LEGACY_DRAFT_STORAGE_KEY = ["noi", "db-product-draft"].join("");
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
  if (gender === "여성" && category === "목걸이") return "약 40~46cm";
  if (gender === "여성" && category === "발찌") return "약 20~26cm";
  if (gender === "여성" && category === "팔찌") return "약 16~21cm";
  if (gender === "남성" && category === "목걸이") return "약 60cm";
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

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
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
  const [lightbox, setLightbox] = useState("");

  const [detailImages, setDetailImages] = useState<DetailImage[]>([]);
  const [detailPreview, setDetailPreview] = useState("");
  const [detailMessage, setDetailMessage] = useState("");
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
  const [batchBusy, setBatchBusy] = useState(false);
  const [batchStatus, setBatchStatus] = useState("");
  const [coupangImportBusy, setCoupangImportBusy] = useState("");
  const [coupangImportMessage, setCoupangImportMessage] = useState("");
  const [quoteQueue, setQuoteQueue] = useState<QuoteQueueRecord[]>([]);
  const [quoteQueueBusy, setQuoteQueueBusy] = useState("");
  const [drafts, setDrafts] = useState<ProductDraftRecord[]>([]);
  const [showDrafts, setShowDrafts] = useState(false);
  const [draftStatus, setDraftStatus] = useState("");
  const [modelDuplicate, setModelDuplicate] = useState(false);
  const [modelCheckMessage, setModelCheckMessage] = useState("");
  const [pendingReplacementCleanup, setPendingReplacementCleanup] = useState<PendingReplacementCleanup | null>(null);

  const [dbSupported, setDbSupported] = useState(false);
  const [dbHandle, setDbHandle] = useState<FileSystemDirectoryHandle | null>(null);
  const [dbFolderName, setDbFolderName] = useState("");
  const [dbStatus, setDbStatus] = useState("");
  const [dbSavedFiles, setDbSavedFiles] = useState<string[]>([]);
  const existingDetailInputRef = useRef<HTMLInputElement>(null);
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
      const legacyRaw = localStorage.getItem(LEGACY_DRAFT_STORAGE_KEY);
      const raw = localStorage.getItem(DRAFT_STORAGE_KEY) || legacyRaw;
      if (!raw) return;
      if (legacyRaw) {
        localStorage.setItem(DRAFT_STORAGE_KEY, raw);
        localStorage.removeItem(LEGACY_DRAFT_STORAGE_KEY);
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

  useEffect(() => {
    if (!model) {
      setModelDuplicate(false);
      setModelCheckMessage("");
      return;
    }
    const timer = window.setTimeout(async () => {
      try {
        const res = await fetch(`/api/google-sheet?model=${encodeURIComponent(model)}`, { cache: "no-store" });
        const data = await res.json();
        setModelDuplicate(Boolean(data.duplicate));
        setModelCheckMessage(
          data.duplicate ? "중복번호" : data.configured === false ? "Google DB 연결 후 중복확인" : "사용 가능한 모델명"
        );
      } catch {
        setModelDuplicate(false);
        setModelCheckMessage("중복확인 실패");
      }
    }, 450);
    return () => window.clearTimeout(timer);
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

  const options = useMemo(
    () => product.colors.split(",").map(v => v.trim()).filter(Boolean),
    [product.colors]
  );
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
    const automatic: DetailImage[] = [];
    const add = (id: string, name: string, slot: SlotImage | null | undefined) => {
      if (slot?.dataUrl) automatic.push({ id: `slot:${id}`, name, dataUrl: slot.dataUrl });
    };
    add("mainWear", "메인착용컷", mainWear);
    add("all", "전체옵션", allOptions);
    options.forEach(option => add(`option:${option}`, `${option} 썸네일`, optionThumbs[option]));
    add("detail", "디테일컷", detailCut);
    add("wear01", "착용컷 01", wear01);
    add("wear02", "착용컷 02", wear02);
    customSlots.forEach((item, index) => add(`custom:${item.id}`, `${item.type === "all" ? "전체옵션" : item.type === "detail" ? "디테일컷" : "착용컷"} 추가 ${index + 1}`, item.slot));
    setDetailImages(prev => [...automatic, ...prev.filter(item => !item.id.startsWith("slot:"))]);
    setDetailPreview("");
  }, [mainWear, allOptions, optionThumbs, options, detailCut, wear01, wear02, customSlots]);

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
      if (key === "gender" || key === "category" || key === "modelNo") {
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
      const response = await fetch("/api/google-sheet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "linkReplacementExisting",
          model,
          replacementSku: legacySku,
          forceLegacyOptions,
          payload: { ...linkPayload, optionImages: {} },
        }),
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
      const response = await fetch("/api/google-sheet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "deleteReplacementLegacyRows", model: pending.model, replacementSku: pending.legacySku, confirmed: true }),
      });
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
      const response = await fetch("/api/google-sheet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "undoReplacementLink", model: pending.model, replacementSku: pending.legacySku }),
      });
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

  const openModelFolder = async () => {
    if (!dbHandle) return setSourcingSaveStatus("먼저 상품DB 폴더를 선택해주세요.");
    if (!model || !product.category) return setSourcingSaveStatus("카테고리와 모델명을 먼저 확인해주세요.");
    try {
      const modelDir = await ensureProductFolderTree(dbHandle, product.category, model);
      const picker = (window as any).showOpenFilePicker;
      if (typeof picker !== "function") {
        setSourcingSaveStatus("이 브라우저에서는 파일 목록 바로가기를 지원하지 않습니다.");
        return;
      }
      await picker({ startIn: modelDir, multiple: false });
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      setSourcingSaveStatus(`오류: ${e instanceof Error ? e.message : "폴더 열기 실패"}`);
    }
  };

  const uploadExistingDetail = async (file: File | undefined) => {
    if (!file || !isAccepted(file)) {
      setDetailMessage("JPG/JPEG/PNG 상세페이지 이미지를 선택해주세요.");
      return;
    }
    setDetailPreview(await readFile(file));
    setDetailMessage(`완성된 상세페이지를 불러왔습니다: ${file.name}`);
  };

  const openExistingDetailPicker = async () => {
    try {
      if (dbHandle && model && product.category) {
        const modelDir = await ensureProductFolderTree(dbHandle, product.category, model);
        const picker = (window as any).showOpenFilePicker;
        if (typeof picker === "function") {
          const [handle] = await picker({
            startIn: modelDir,
            multiple: false,
            types: [{ description: "상세페이지 이미지", accept: { "image/jpeg": [".jpg", ".jpeg"], "image/png": [".png"] } }],
          });
          if (handle) await uploadExistingDetail(await handle.getFile());
          return;
        }
      }
      existingDetailInputRef.current?.click();
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      setDetailMessage(`오류: ${e instanceof Error ? e.message : "상세페이지 선택 실패"}`);
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
    setMainWear(null);
    setAllOptions(null);
    setOptionThumbs({});
    setExtra01(null);
    setExtra02(null);
    setExtra03(null);
    setDetailCut(null);
    setWear01(null);
    setWear02(null);
    setCustomSlots([]);
    setUploadPool([]);
    setAdjustKey("");
    setAdjustPreview("");
    setDetailPreview("");
    setMessage("쿠팡 등록 이미지를 초기화했습니다.");
  };

  const resetAll = () => {
    if (!window.confirm("기본값을 제외한 입력값과 업로드 이미지를 모두 초기화할까요?")) return;
    setProduct({ ...DEFAULT_PRODUCT });
    sizesUserEditedRef.current = false;
    setPhotos([]);
    setPhotoMessage("");
    setAnalysis({});
    resetCoupangImages();
    setDetailImages([]);
    setDetailMessage("");
    setSourcingUrls(["", "", ""]);
    setSourcingUrlInputs(["", "", ""]);
    setSourcingMessage("");
    setSourcingAnalysis({});
    setSourcingImages([]);
    setSourcingSaveStatus("");
    setExportMessage("");
    setBatchStatus("");
    setDbSavedFiles([]);
    localStorage.removeItem(DRAFT_STORAGE_KEY);
    localStorage.removeItem(LEGACY_DRAFT_STORAGE_KEY);
    setMessage("전체 입력값을 기본값으로 초기화했습니다.");
  };

  const importCoupangData = async (mode: "skuMaster" | "inboundHistory" | "poList" | "coupangExtract", fileList: FileList | null) => {
    if (!fileList?.length) return;
    const label = mode === "skuMaster" ? "SKU 전체 목록"
      : mode === "inboundHistory" ? "입고상세내역"
      : mode === "coupangExtract" ? "쿠팡 추출DB"
      : "발주 SKU 목록";
    setCoupangImportBusy(mode);
    setCoupangImportMessage(`${label}을 Google 상품DB에 반영하고 있습니다...`);
    try {
      const form = new FormData();
      form.set("mode", mode);
      Array.from(fileList).forEach(file => form.append("files", file));
      const response = await fetch("/api/coupang-data", { method: "POST", body: form });
      const responseText = await response.text();
      let data: any;
      try { data = JSON.parse(responseText); }
      catch {
        throw new Error(response.status === 504
          ? "서버 처리 시간이 초과됐습니다. 잠시 후 다시 시도해주세요."
          : `서버 처리 중 오류가 발생했습니다. (${response.status || "응답 없음"})`);
      }
      if (!response.ok || !data.ok) throw new Error(data.error || "가져오기 실패");
      if (mode === "skuMaster") {
        const safetyText = ` · 제품DB 신규행 0 · 기존 SKU는 상품명·바코드·발주가능상태만 갱신 · 업로드 S바코드 제외 ${Number(data.excluded || 0).toLocaleString()} · 기준목록 S바코드 정리 ${Number(data.removedNonRocket || 0).toLocaleString()} · 구 SKU 재추가 방지 ${Number(data.retiredSkipped || 0).toLocaleString()}`;
        setCoupangImportMessage(data.baseline
          ? `SKU 기준목록 ${data.parsed?.toLocaleString?.() || data.parsed}개 생성 완료 · 최초 업로드는 승인대기 자동연결 없음${safetyText}`
          : `SKU 전체 목록 ${data.parsed?.toLocaleString?.() || data.parsed}개 반영 완료 · 직전 업로드 이후 새 SKU ${data.newSkus || 0} · 승인대기 자동연결 ${data.matched || 0} · 확인필요 ${data.review || 0} · 수정 ${data.updated || 0}${safetyText}`);
      } else if (mode === "inboundHistory") {
        setCoupangImportMessage(data.skipped
          ? `이미 반영한 동일한 입고 파일 ${data.files}개라서 중복 적용하지 않았습니다.`
          : `입고상세내역 ${data.files}개 최신 정보 반영 완료 · 실제 입고 ${Number(data.totalInbound || 0).toLocaleString()} · 입고 갱신 SKU ${Number(data.cumulativeInboundUpdated || 0).toLocaleString()} · 미입고 재계산 SKU ${Number(data.missingUpdated || 0).toLocaleString()}`);
      } else if (mode === "coupangExtract") {
        setCoupangImportMessage(`쿠팡 추출DB 반영 완료 · 기존 행 매칭 ${Number(data.matched || 0).toLocaleString()} · 상품링크 갱신 ${Number(data.productLinkUpdated || 0).toLocaleString()} · 쿠팡 노출가 갱신 ${Number(data.exposurePriceUpdated || 0).toLocaleString()} · 재고현황 갱신 ${Number(data.stockStatusUpdated || 0).toLocaleString()} · 미연결 ${Number(data.missing || 0).toLocaleString()} · 제품DB 신규행 0 · 그 외 정보 수정 없음`);
      } else {
        setCoupangImportMessage(`발주 ${data.parsed?.toLocaleString?.() || data.parsed}행 반영 완료 · 최근발주일 ${Number(data.recentOrderDatesUpdated || 0).toLocaleString()}개 SKU 갱신 · 미입고 ${Number(data.missingUpdated || 0).toLocaleString()}개 SKU 재계산 · 합배송 ${data.shippingGroups || 0}묶음 · 발주서 출력 ${data.pickingRows || 0}행 · 쉽먼트전송 ${data.shipmentRows || 0}행 · 창고번호 미등록 ${data.missingWarehouse || 0}`);
      }
    } catch (error) {
      setCoupangImportMessage(`오류: ${error instanceof Error ? error.message : "쿠팡 데이터 가져오기 실패"}`);
    } finally {
      setCoupangImportBusy("");
    }
  };

  const dropCoupangFiles = (mode: "skuMaster" | "inboundHistory" | "poList" | "coupangExtract", event: React.DragEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (coupangImportBusy || !event.dataTransfer.files.length) return;
    void importCoupangData(mode, event.dataTransfer.files);
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
      const response = await fetch("/api/google-sheet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "quoteQueueClear", gender: group.gender, category: group.category }),
      });
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
      const response = await fetch("/api/google-sheet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "quoteQueueDeleteModel", model: modelName }),
      });
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

  const assignPoolItem = (index: number, setter: (slot: SlotImage | null) => void) => {
    const slot = uploadPool[index];
    if (!slot) return;
    setter(slot);
    setUploadPool(prev => prev.filter((_, i) => i !== index));
  };

  const getSlotValue = (key: string): SlotImage | null => {
    if (key === "mainWear") return mainWear;
    if (key === "all") return allOptions;
    if (key === "detail") return detailCut;
    if (key === "wear01") return wear01;
    if (key === "wear02") return wear02;
    if (key.startsWith("opt:")) return optionThumbs[key.slice(4)] || null;
    if (key.startsWith("custom:")) return customSlots.find(item => item.id === key.slice(7))?.slot || null;
    return null;
  };

  const setSlotValue = (key: string, value: SlotImage | null) => {
    if (key === "mainWear") setMainWear(value);
    else if (key === "all") setAllOptions(value);
    else if (key === "detail") setDetailCut(value);
    else if (key === "wear01") setWear01(value);
    else if (key === "wear02") setWear02(value);
    else if (key.startsWith("opt:")) setOptionThumb(key.slice(4), value);
    else if (key.startsWith("custom:")) {
      setCustomSlots(prev => prev.map(item => item.id === key.slice(7) ? { ...item, slot: value } : item));
    }
  };

  const swapSlots = (sourceKey: string, targetKey: string) => {
    if (!sourceKey || sourceKey === targetKey) return;
    const source = getSlotValue(sourceKey);
    const target = getSlotValue(targetKey);
    setSlotValue(sourceKey, target);
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
    setOptionThumbs(prev => ({ ...prev, [option]: slot }));
  };

  const openAdjust = (key: string, dataUrl: string) => {
    setAdjustKey(key);
    setAdjust(defaultFitAdjust());
    setAdjustPreview(dataUrl);
  };

  const previewAdjust = async () => {
    if (!adjustPreview) return;
    try {
      const out = await fitToWhiteCanvas(adjustPreview, adjust);
      setAdjustPreview(out);
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
    setAdjustKey("");
    setAdjustPreview("");
  };

  const pushDetail = (name: string, dataUrl: string) => {
    setDetailImages(prev => [
      ...prev,
      { id: `${Date.now()}-${Math.random()}`, name, dataUrl },
    ]);
    setDetailPreview("");
    setDetailMessage(`${name}을(를) 상세페이지 목록에 추가했습니다.`);
  };

  const composeDetailPage = async () => {
    if (!detailImages.length) {
      throw new Error("상세페이지에 사용할 사진을 추가해주세요.");
    }
    const width = 780;
    const gap = 60;
    const prepared = await Promise.all(
      detailImages.map(async item => {
        const img = await loadImage(item.dataUrl);
        const height = Math.max(1, Math.round((img.height / img.width) * width));
        return { img, height };
      })
    );
    const totalHeight =
      gap + prepared.reduce((s, i) => s + i.height, 0) + gap * Math.max(0, prepared.length - 1) + gap;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = totalHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("캔버스를 만들 수 없습니다.");
    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(0, 0, width, totalHeight);
    let y = gap;
    for (const item of prepared) {
      ctx.drawImage(item.img, 0, y, width, item.height);
      y += item.height + gap;
    }
    return { dataUrl: canvas.toDataURL("image/jpeg", 0.94), totalHeight };
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

  const saveDetailPageOnly = async () => {
    if (!model || !product.category) {
      setDetailMessage("오류: 모델명과 카테고리를 먼저 확인해주세요.");
      return;
    }
    try {
      setDetailMessage("상세페이지만 저장하고 있습니다...");
      const dataUrl = detailPreview || (await composeDetailPage()).dataUrl;
      setDetailPreview(dataUrl);
      if (dbHandle) {
        const saved = await writeProductDbFiles(dbHandle, product.category, model, [{
          folder: "",
          filename: `${model}.jpg`,
          blob: dataUrlToBlob(dataUrl),
          path: `${model}.jpg`,
        }]);
        setDbSavedFiles(prev => [...new Set([...prev, ...saved])]);
        setDetailMessage(`상세페이지 저장 완료 → ${product.category}/${model}/${model}.jpg`);
      } else {
        downloadDataUrl(dataUrl, `${model}.jpg`);
        setDetailMessage("상세페이지 다운로드 완료");
      }
    } catch (e) {
      setDetailMessage(`오류: ${e instanceof Error ? e.message : "상세페이지 저장 실패"}`);
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
    const fallbackOptionImage = allOptions?.dataUrl || photos[0]?.dataUrl || "";
    return {
    product,
    model,
    title,
    tags,
    sourcingUrl,
    optionImages: Object.fromEntries(
      options.flatMap(option => {
        const dataUrl = optionThumbs[option]?.dataUrl || fallbackOptionImage;
        return dataUrl ? [[option, dataUrl]] : [];
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
    try {
      const local = await listProductDrafts();
      const cloudRes = await fetch("/api/google-sheet?action=cloudDraftList");
      const cloud = await cloudRes.json().catch(() => ({}));
      const merged = new Map<string, ProductDraftRecord>();
      for (const record of (cloud.drafts || [])) merged.set(record.model, record);
      for (const record of local) merged.set(record.model, record);
      setDrafts([...merged.values()].sort((a, b) => b.savedAt - a.savedAt).slice(0, 20));
    } catch {
      setDraftStatus("임시저장 목록을 불러오지 못했습니다.");
    }
  };

  const saveDraft = async () => {
    if (!model) {
      setDraftStatus("모델명을 먼저 입력해주세요.");
      return;
    }
    try {
      await saveProductDraft({
        model,
        savedAt: Date.now(),
        data: {
          product, analysis, photos, mainWear, allOptions, optionThumbs, detailCut, wear01, wear02, customSlots,
          detailImages, detailPreview, sourcingUrls, sourcingUrlInputs, sourcingImages,
          uploadPool, title, tags,
        },
      });
      await fetch("/api/google-sheet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "cloudDraftSave",
          record: {
            model,
            savedAt: Date.now(),
            data: { product, analysis, sourcingUrls, sourcingUrlInputs, title, tags, cloudOnly: true },
          },
        }),
      });
      localStorage.removeItem(DRAFT_STORAGE_KEY);
      localStorage.removeItem(LEGACY_DRAFT_STORAGE_KEY);
      setDraftStatus(`${model}으로 임시저장되었습니다.`);
      setMessage(`${model}으로 임시저장되었습니다.`);
      await refreshDrafts();
    } catch {
      setDraftStatus("임시저장 공간이 부족합니다. 오래된 임시저장을 삭제해주세요.");
    }
  };

  const loadDraft = (record: ProductDraftRecord) => {
    const data = record.data as any;
    if (data.product) setProduct({
      ...DEFAULT_PRODUCT,
      ...data.product,
      supplier: normalizeSupplierName(data.product.supplier || DEFAULT_PRODUCT.supplier),
    });
    if (data.analysis) setAnalysis(data.analysis);
    setPhotos(Array.isArray(data.photos) ? data.photos : []);
    setMainWear(data.mainWear || null);
    setAllOptions(data.allOptions || null);
    setOptionThumbs(data.optionThumbs || {});
    setDetailCut(data.detailCut || null);
    setWear01(data.wear01 || null);
    setWear02(data.wear02 || null);
    setCustomSlots(Array.isArray(data.customSlots) ? data.customSlots : []);
    setDetailImages(Array.isArray(data.detailImages) ? data.detailImages : []);
    setDetailPreview(data.detailPreview || "");
    setSourcingUrls(Array.isArray(data.sourcingUrls) ? data.sourcingUrls : ["", "", ""]);
    setSourcingUrlInputs(Array.isArray(data.sourcingUrlInputs) ? data.sourcingUrlInputs : ["", "", ""]);
    setSourcingImages(Array.isArray(data.sourcingImages) ? data.sourcingImages : []);
    setUploadPool(Array.isArray(data.uploadPool) ? data.uploadPool : []);
    setShowDrafts(false);
    setDraftStatus(data.cloudOnly
      ? `${record.model} 기본정보를 불러왔습니다. 다른 기기의 이미지는 다시 올려주세요.`
      : `${record.model} 임시저장을 불러왔습니다.`);
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

  const collectInput = async (detailOverride?: string) => {
    const thumbs: Record<string, string> = {};
    await Promise.all(options.map(async opt => {
      const source = optionThumbs[opt]?.dataUrl;
      if (source) thumbs[opt] = await normalizeCoupangImage(source);
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
    return collectProductDbFiles({
      category: product.category,
      model,
      title,
      tags,
      product: product as unknown as Record<string, string>,
      analysis,
      ready,
      photos: photos.map(p => p.dataUrl),
      optionThumbs: thumbs,
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
    });
  };

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
    if (pendingReplacementCleanup) {
      setBatchStatus("SKU 이관 결과 확인이 끝나지 않았습니다. 기존행 삭제 또는 연결 취소를 먼저 선택해주세요.");
      return;
    }
    const required: string[] = [];
    if (!model) required.push("모델명");
    if (!product.category) required.push("카테고리");
    if (!dbHandle && dbSupported) required.push("상품DB 폴더 연결");
    if (required.length) {
      setBatchStatus(`필수 항목 부족: ${required.join(", ")}`);
      return;
    }

    if (modelDuplicate && !window.confirm(`${model}은(는) 이미 등록된 모델명입니다. 기존 Google 상품DB 내용을 업데이트할까요?`)) {
      setBatchStatus("기존 모델 업데이트를 취소했습니다.");
      return;
    }

    const recommended: string[] = [];
    for (const opt of options) {
      if (!optionThumbs[opt]?.dataUrl) recommended.push(`${opt} 썸네일`);
    }
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
      let preview = detailPreview;
      if (!preview && detailImages.length) {
        await buildDetailPage();
        // buildDetailPage sets state async — rebuild inline
        const width = 780;
        const gap = 60;
        const prepared = await Promise.all(
          detailImages.map(async item => {
            const img = await loadImage(item.dataUrl);
            return { img, height: Math.max(1, Math.round((img.height / img.width) * width)) };
          })
        );
        const totalHeight =
          gap + prepared.reduce((s, i) => s + i.height, 0) + gap * Math.max(0, prepared.length - 1) + gap;
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = totalHeight;
        const ctx = canvas.getContext("2d")!;
        ctx.fillStyle = "#FFFFFF";
        ctx.fillRect(0, 0, width, totalHeight);
        let y = gap;
        for (const item of prepared) {
          ctx.drawImage(item.img, 0, y, width, item.height);
          y += item.height + gap;
        }
        preview = canvas.toDataURL("image/jpeg", 0.94);
        setDetailPreview(preview);
      }

      const { files, skipped, readyFiles } = await collectInput(preview);
      const googleStatus = skipped.find(item => item.startsWith("Google 시트"));
      if (dbHandle) {
        const saved = await writeProductDbFiles(dbHandle, product.category, model, files);
        setDbSavedFiles(saved);
        setBatchStatus(
          `상품 생성 완료 · ${saved.length}개 저장 → ${product.category}/${model}/` +
            (skipped.length ? ` · 건너뜀 ${skipped.length}` : "") +
            (googleStatus ? ` · ${googleStatus}` : "")
        );
      } else {
        const blob = await buildProductDbZip(product.category, model, files);
        downloadBlobFile(blob, `상품DB_${model}.zip`);
        setDbSavedFiles(readyFiles);
        setBatchStatus(`상품 생성 완료 · ZIP 다운로드 (${files.length}개 파일)` + (googleStatus ? ` · ${googleStatus}` : ""));
      }
      await saveDraft();
      await loadQuoteQueue();
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
        body: JSON.stringify(exportPayload()),
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
      payload.optionImages = Object.fromEntries(await Promise.all(
        Object.entries(payload.optionImages).map(async ([option, dataUrl]) => [
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
    if (!model) return;
    downloadBlobFile(await createLabelBlob(model), `라벨_${model}.jpg`);
  };

  const downloadSkuManual = (option: string) => {
    const slot = optionThumbs[option];
    if (!slot) return;
    const sizes = product.sizes.split(",").map(v => v.trim()).filter(Boolean);
    const code = colorCode(option);
    if (product.category === "반지" && sizes.length) {
      sizes.forEach((size, i) => {
        window.setTimeout(() => {
          downloadDataUrl(slot.dataUrl, `${model}-${code}${ringSizeNumber(size)}.jpg`);
        }, i * 250);
      });
    } else {
      downloadDataUrl(slot.dataUrl, `${model}-${code}.jpg`);
    }
  };

  const counterfeitAlert = ["확인필요", "높음"].includes(analysis.counterfeitRisk?.trim() || "");

  return (
    <main className="shell">
      <header className="hero">
        <div className="heroBrandArea">
          <div className="brandLockup">
            <span className="lauraMark" aria-hidden="true">L</span>
            <div><p className="lauraWordmark">LAURA OS</p><span>Seller Workspace</span></div>
          </div>
          <h1>AI 상품등록 도우미</h1>
          <div className="heroUtilityActions">
            <button className="draftLoadButton" type="button" onClick={() => {
              setShowDrafts(value => !value);
              if (!showDrafts) void refreshDrafts();
            }}>임시저장 불러오기</button>
            <button className="resetAllButton" type="button" onClick={resetAll}>전체 초기화</button>
          </div>
        </div>
      </header>
      {showDrafts && (
        <section className="card full draftPanel">
          <h2>임시저장 목록 ({drafts.length}/20)</h2>
          {!drafts.length && <p className="note">임시저장된 상품이 없습니다.</p>}
          <div className="draftList">
            {drafts.map(record => (
              <div className="draftItem" key={record.model}>
                <div><strong>{record.model}</strong><span>{new Date(record.savedAt).toLocaleString("ko-KR")}</span></div>
                <button type="button" className="green" onClick={() => loadDraft(record)}>불러오기</button>
                <button type="button" className="removeButton" onClick={() => void (async () => {
                  await deleteProductDraft(record.model);
                  await fetch("/api/google-sheet", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ action: "cloudDraftDelete", model: record.model }),
                  });
                  await refreshDrafts();
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
            <strong>클릭 또는 드래그앤드롭 (최대 {MAX_PHOTOS}장)</strong>
            <span>첫 번째 사진이 AI 분석에 사용됩니다. 순서를 바꾸면 첫 장이 분석용입니다.</span>
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
          {loading ? "분석 중..." : "AI 사진분석 (첫 번째 사진)"}
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
          </Field>
          <Field label="치수">
            <input value={product.dimension} onChange={e => update("dimension", e.target.value)}
              placeholder="예: 폭 8mm, 길이 42cm" />
          </Field>
          <Field label="모델번호 숫자">
            <input value={product.modelNo} onChange={e => update("modelNo", e.target.value)} />
          </Field>
          <Field label="모델명">
            <input value={model} onChange={e => updateModel(e.target.value)} />
            {modelCheckMessage && <small className={modelDuplicate ? "duplicateModel" : "modelAvailable"}>{modelCheckMessage}</small>}
          </Field>
          <Field label="창고번호">
            <input value={product.warehouse || ""} onChange={e => update("warehouse", e.target.value)}
              placeholder="예: 711(592) · 미정이면 비워두세요" />
          </Field>
          <Field label="기존상품 재등록 SKU ID">
            <input inputMode="numeric" value={product.replacementSku || ""} onChange={e => update("replacementSku", e.target.value)}
              placeholder="재등록 상품만 기존 대표 SKU ID 입력" />
            <small>연결하면 기존 옵션별 창고번호·재고 이력을 가져옵니다. 기존행은 별도 최종 확인 전까지 삭제하지 않습니다.</small>
            <button className="secondaryButton replacementLinkButton" type="button" onClick={() => void linkExistingReplacement()}>기존 등록행에 연결</button>
            {pendingReplacementCleanup && <>
              <button className="secondaryButton replacementLinkButton" type="button" onClick={() => void deleteLinkedLegacyRows()}>이관 확인 후 기존행 삭제</button>
              <button className="secondaryButton replacementLinkButton" type="button" onClick={() => void undoLinkedReplacement()}>연결 취소 · 기존행 복원</button>
            </>}
          </Field>
          <Field label="핵심키워드">
            <input value={product.keyword} onChange={e => update("keyword", e.target.value)} />
          </Field>
          <Field label="쿠팡 상품명">
            <input value={product.coupangTitle || generatedTitle} onChange={e => update("coupangTitle", e.target.value)} />
            <small>직접 수정할 수 있습니다. 자동 상품명으로 되돌리려면 아래 버튼을 누르세요.</small>
            <button className="secondaryButton compactFieldButton" type="button" onClick={() => update("coupangTitle", "")}>자동 상품명 사용</button>
          </Field>
          <Field label="검색태그">
            <input value={product.searchTags || generatedTags} onChange={e => update("searchTags", e.target.value)} />
            <small>쉼표로 구분해 직접 수정할 수 있습니다.</small>
            <button className="secondaryButton compactFieldButton" type="button" onClick={() => update("searchTags", "")}>자동 검색태그 사용</button>
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
      <section className="card full">
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
              <button className="dark" type="button" onClick={() => saveSourcingUrl(index)}>링크 저장</button>
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
        <div className="exportActions">
          {dbSupported && <button className="dark" type="button" onClick={pickFolder}>상품DB 폴더 선택</button>}
          <button className="secondaryButton" type="button" onClick={() => void createSourcingFolder()}>모델명 폴더 생성</button>
          <button className="green" type="button" onClick={() => void saveSourcingImages()}>이미지 저장</button>
          {dbSupported && <button className="secondaryButton" type="button" onClick={() => void openModelFolder()}>폴더 바로가기</button>}
        </div>
        {sourcingSaveStatus && <p className="detailMessage">{sourcingSaveStatus}</p>}
      </section>

      {/* 5. 쿠팡 등록 이미지 */}
      <section className="card full">
        <h2>5. 쿠팡 등록 이미지</h2>
        <button className="resetImagesButton" type="button" onClick={resetCoupangImages}>쿠팡 이미지 전체 초기화</button>
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
          <div className="uploadPool">
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

        <div className="imageSlotGrid">
          <ImageSlot
            slotKey="mainWear"
            title="메인착용컷"
            subtitle="상세페이지 전용"
            filename=""
            value={mainWear}
            onChange={setMainWear}
            onPoolDrop={index => assignPoolItem(index, setMainWear)}
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
            onPoolDrop={index => assignPoolItem(index, setAllOptions)}
            onSlotSwap={swapSlots}
            onExpand={setLightbox}
            onFit={() => allOptions && openAdjust("all", allOptions.dataUrl)}
            onAddDetail={
              includeAllOptionsInDetail && allOptions
                ? () => pushDetail("전체옵션", allOptions.dataUrl)
                : undefined
            }
          />

          {options.map(option => (
            <ImageSlot
              slotKey={`opt:${option}`}
              key={option}
              title={`${option} 썸네일`}
              filename={
                model
                  ? (product.category === "반지"
                    ? `${model}-${colorCode(option)}*.jpg (전 사이즈)`
                    : `${model}-${colorCode(option)}.jpg`)
                  : "SKU.jpg"
              }
              value={optionThumbs[option] || null}
              onChange={slot => setOptionThumb(option, slot)}
              onPoolDrop={index => assignPoolItem(index, slot => setOptionThumb(option, slot))}
              onSlotSwap={swapSlots}
              onExpand={setLightbox}
              onFit={() => {
                const s = optionThumbs[option];
                if (s) openAdjust(`opt:${option}`, s.dataUrl);
              }}
              onAddDetail={
                optionThumbs[option]
                  ? () => pushDetail(`${option} 썸네일`, optionThumbs[option]!.dataUrl)
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
            onPoolDrop={index => assignPoolItem(index, setDetailCut)}
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
            onPoolDrop={index => assignPoolItem(index, setWear01)}
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
            onPoolDrop={index => assignPoolItem(index, setWear02)}
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
              onPoolDrop={poolIndex => assignPoolItem(poolIndex, slot => setSlotValue(`custom:${item.id}`, slot))}
              onSlotSwap={swapSlots}
              onExpand={setLightbox}
              onRemoveSlot={() => setCustomSlots(prev => prev.filter(slot => slot.id !== item.id))}
            />
          ))}
        </div>

        {adjustKey && (
          <div className="adjustPanel">
            <h3>흰 배경 캔버스 맞춤 (형태 변경 없음)</h3>
            {adjustPreview && <img src={adjustPreview} alt="조정 미리보기" className="adjustPreviewImg" />}
            <div className="cropControls">
              <label>확대 <input type="range" min={0.5} max={1.5} step={0.01} value={adjust.scale}
                onChange={e => setAdjust(a => ({ ...a, scale: Number(e.target.value) }))} /></label>
              <label>좌우 <input type="range" min={-200} max={200} value={adjust.offsetX}
                onChange={e => setAdjust(a => ({ ...a, offsetX: Number(e.target.value) }))} /></label>
              <label>상하 <input type="range" min={-200} max={200} value={adjust.offsetY}
                onChange={e => setAdjust(a => ({ ...a, offsetY: Number(e.target.value) }))} /></label>
              <label>밝기 <input type="range" min={-40} max={40} value={adjust.brightness}
                onChange={e => setAdjust(a => ({ ...a, brightness: Number(e.target.value) }))} /></label>
              <label>대비 <input type="range" min={0.7} max={1.4} step={0.01} value={adjust.contrast}
                onChange={e => setAdjust(a => ({ ...a, contrast: Number(e.target.value) }))} /></label>
            </div>
            <div className="detailActions">
              <button type="button" className="secondaryButton" onClick={() => void previewAdjust()}>미리보기 적용</button>
              <button type="button" className="green" onClick={() => void confirmAdjust()}>확정</button>
              <button type="button" className="secondaryButton" onClick={() => { setAdjustKey(""); setAdjustPreview(""); }}>취소</button>
            </div>
          </div>
        )}
      </section>

      {/* 6. 상세페이지 */}
      <section className="card full">
        <h2>6. 상세페이지</h2>
        <div className="multiUpload existingDetailUpload" onClick={() => void openExistingDetailPicker()}
          onDragOver={e => e.preventDefault()}
          onDrop={e => {
            e.preventDefault();
            void uploadExistingDetail(e.dataTransfer.files?.[0]);
          }}>
          <input ref={existingDetailInputRef} type="file" accept="image/jpeg,image/jpg,image/png" hidden
            onClick={e => e.stopPropagation()}
            onChange={e => {
              void uploadExistingDetail(e.target.files?.[0]);
              e.target.value = "";
            }} />
          <strong>완성된 상세페이지 업로드</strong>
          <span>이미 상세페이지가 있으면 클릭하거나 드래그앤드롭하세요.</span>
        </div>

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
          <button type="button" className="secondaryButton" onClick={() => void saveDetailPageOnly()}>
            상세페이지만 다운로드
          </button>
        </div>
        {detailMessage && <p className="detailMessage">{detailMessage}</p>}
        {detailPreview && (
          <div className="detailResult">
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
          <button className="secondaryButton" type="button" onClick={() => void saveDraft()}>임시저장</button>
          {dbSupported && <button className="secondaryButton" type="button" onClick={() => void openModelFolder()}>폴더 바로가기</button>}
        </div>
        {draftStatus && <p className="detailMessage">{draftStatus}</p>}
        {dbFolderName && <p className="detailMessage">연결: {dbFolderName}</p>}
        <button className="batchSaveButton" type="button" disabled={batchBusy} onClick={batchSave}>
          {batchBusy ? "저장 중..." : "등록파일 일괄 생성 및 저장"}
        </button>
        {!dbSupported && <p className="saveExplain">모바일에서는 상품DB ZIP이 다운로드됩니다. 다운로드 완료 후 공유 또는 파일 앱에서 Google Drive에 저장하세요.</p>}
        {batchStatus && <p className={batchStatus.startsWith("오류") ? "error" : "detailMessage"}>{batchStatus}</p>}
        {dbSavedFiles.length > 0 && (
          <div className="dbFileList"><h3>저장된 파일</h3><ul>{dbSavedFiles.slice(0, 40).map(f => <li key={f}>{f}</li>)}</ul></div>
        )}
        <div className="quoteQueuePanel">
          <div className="quoteQueueHeader">
            <div><h3>카테고리별 묶음 견적서</h3><p>등록할 때 자동 누적되며 같은 성별·카테고리끼리 최대 1,000 SKU행으로 나뉩니다.</p></div>
            <button type="button" className="secondaryButton" disabled={Boolean(quoteQueueBusy)} onClick={() => void loadQuoteQueue()}>
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
        {dbStatus && <p className="note">{dbStatus}</p>}
        <details className="advancedPanel coupangDataPanel">
          <summary>서플라이허브 데이터 업데이트</summary>
          <div className="coupangImportGrid">
            <label className="coupangImportItem" onDragOver={e => e.preventDefault()} onDrop={e => dropCoupangFiles("skuMaster", e)}>
              <strong>① 상품공급상태관리 다운로드</strong>
              <span>파일명: 상품공급상태관리 SKU 다운로드</span>
              <span>제품DB 행 추가 없음 · 기존 SKU는 상품명/바코드/발주가능상태만 갱신</span>
              <input type="file" accept=".xlsx" disabled={Boolean(coupangImportBusy)} onChange={e => { void importCoupangData("skuMaster", e.target.files); e.target.value = ""; }} />
            </label>
            <label className="coupangImportItem" onDragOver={e => e.preventDefault()} onDrop={e => dropCoupangFiles("inboundHistory", e)}>
              <strong>② 입고상세내역 다운로드</strong>
              <span>파일명: Coupang_Stocked_Data_List</span>
              <input type="file" accept=".xlsx" multiple disabled={Boolean(coupangImportBusy)} onChange={e => { void importCoupangData("inboundHistory", e.target.files); e.target.value = ""; }} />
            </label>
            <label className="coupangImportItem" onDragOver={e => e.preventDefault()} onDrop={e => dropCoupangFiles("poList", e)}>
              <strong>③ 발주SKU 리스트 다운로드</strong>
              <span>파일명: PO_SKU_LIST</span>
              <input type="file" accept=".csv,.xlsx" multiple disabled={Boolean(coupangImportBusy)} onChange={e => { void importCoupangData("poList", e.target.files); e.target.value = ""; }} />
            </label>
            <label className="coupangImportItem" onDragOver={e => e.preventDefault()} onDrop={e => dropCoupangFiles("coupangExtract", e)}>
              <strong>④ 쿠팡 추출DB 업데이트</strong>
              <span>쿠팡쇼핑몰 추출DB.xlsx 한 파일만 선택</span>
              <span>제품DB 행 추가 없음 · 기존 행의 상품링크/쿠팡 노출가/재고현황만 갱신</span>
              <input type="file" accept=".xlsx" disabled={Boolean(coupangImportBusy)} onChange={e => { void importCoupangData("coupangExtract", e.target.files); e.target.value = ""; }} />
            </label>
          </div>
          {coupangImportMessage && <p className={coupangImportMessage.startsWith("오류") ? "error" : "detailMessage"}>{coupangImportMessage}</p>}
        </details>
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

function ImageSlot({
  slotKey,
  title,
  subtitle,
  filename,
  value,
  onChange,
  onExpand,
  onFit,
  onAddDetail,
  onPoolDrop,
  onSlotSwap,
  onRemoveSlot,
}: {
  slotKey: string;
  title: string;
  subtitle?: string;
  filename: string;
  value: SlotImage | null;
  onChange: (v: SlotImage | null) => void;
  onExpand: (url: string) => void;
  onFit?: () => void;
  onAddDetail?: () => void;
  onPoolDrop?: (index: number) => void;
  onSlotSwap?: (sourceKey: string, targetKey: string) => void;
  onRemoveSlot?: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const applyFile = async (file: File | undefined) => {
    if (!file) return;
    if (!ACCEPTED.includes(file.type) && !/\.(jpe?g|png)$/i.test(file.name)) return;
    const dataUrl = await readFile(file);
    onChange({ dataUrl, fileName: file.name });
  };

  return (
    <div className={"imageSlot" + (value ? " imageSlotFilled" : " imageSlotEmpty") + (dragging ? " dragging" : "")}
      draggable={Boolean(value)}
      onDragStart={e => {
        if (!value) return;
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("application/x-laura-slot-key", slotKey);
      }}>
      <div className="imageSlotHeader">
        <h3>{title}</h3>
        {subtitle && <p className="slotAlias">{subtitle}</p>}
      </div>
      <div
        className="slotDrop"
        onClick={() => inputRef.current?.click()}
        onDragOver={e => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={e => {
          e.preventDefault();
          setDragging(false);
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
          <img src={value.dataUrl} alt={title} draggable={false} />
        ) : (
          <div className="slotPlaceholder">
            <strong>{title}</strong>
            <span>이미지를 끌어놓거나 클릭하세요.</span>
          </div>
        )}
      </div>
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
        {value && <button type="button" className="removeButton" onClick={() => onChange(null)}>삭제</button>}
        {onRemoveSlot && <button type="button" className="removeButton" onClick={onRemoveSlot}>칸 삭제</button>}
      </div>
    </div>
  );
}
