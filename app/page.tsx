"use client";

import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  ensureReadWritePermission,
  loadDirectoryHandle,
  saveDirectoryHandle,
  supportsDirectoryPicker,
} from "@/lib/product-db/idb";
import { collectProductDbFiles, createLabelBlob } from "@/lib/product-db/files";
import { writeProductDbFiles } from "@/lib/product-db/fs";
import { buildProductDbZip } from "@/lib/product-db/zip";
import { composeWhiteThumbnail, detectContentCrop, loadImageElement } from "@/lib/thumbnail/compose";
import { applyMetalColorPreset } from "@/lib/thumbnail/recolor";
import { buildCloseupFromSource, buildOptionsCollage } from "@/lib/shots/extra";
import { compressImageDataUrl } from "@/lib/image/compress";

type Product = {
  supplier: string; category: string; gender: string; material: string;
  colors: string; sizes: string; modelNo: string; keyword: string;
  cost: string; price: string;
};

type Analysis = {
  visualFeatures?: string[];
  engraving?: string;
  counterfeitRisk?: string;
  counterfeitReason?: string;
  confidence?: number;
};

type ThumbnailMap = Record<string, string>;

type DetailImage = {
  id: string;
  name: string;
  dataUrl: string;
};

type SourcingResult = {
  koreanSummary?: string;
  chineseKeywords?: string[];
  englishKeywords?: string[];
  ocrText?: string[];
  detectedPrice?: string;
  detectedSizes?: string[];
  detectedColors?: string[];
  searchTips?: string[];
};

type GeneratedShot = {
  key: string;
  label: string;
  dataUrl: string;
  option: string;
};

type ProductPhoto = {
  id: string;
  name: string;
  dataUrl: string;
  isPrimary: boolean;
  isAiAnalyze: boolean;
  isThumbSource: boolean;
  includeInDetail: boolean;
  /** 1688 extras saved as 원본_추가NN */
  isSourcingExtra?: boolean;
};

type OptionThumbState = {
  sourceId: string;
  draftDataUrl: string;
  approvedDataUrl: string;
};

type ExtraImageKind = "closeup" | "collage" | "upload";

type ExtraImage = {
  id: string;
  kind: ExtraImageKind;
  dataUrl: string;
};

type ProgressStep = { key: string; label: string; done: boolean };

const experimentalShotTypes = [
  { key: "wearingFront", label: "손 착용 정면컷" },
  { key: "wearingSide", label: "손 착용 측면컷" },
] as const;

const codeMap: Record<string, string> = {
  반지:"wr", 귀걸이:"we", 목걸이:"wn", 팔찌:"wb",
  발찌:"wa", 피어싱:"wp", 브로치:"wc", 세트:"wx",
};

const CATEGORY_WORDS = new Set([
  "반지", "귀걸이", "목걸이", "팔찌", "발찌", "피어싱", "브로치", "세트",
]);
const GENDER_WORDS = new Set(["여성", "남성", "남녀공용", "여성용", "남성용"]);

const FEMALE_RING_SIZES = "9호,11호,14호,17호,20호";
const MALE_RING_SIZES = "20호,22호,25호";
const UNISEX_RING_SIZES = "9호,11호,14호,17호,20호,22호,25호";

const MAX_PHOTOS = 10;
const ACCEPTED_IMAGE_TYPES = ["image/jpeg", "image/jpg", "image/png"];

const STEP_GUIDE: Record<string, string> = {
  photos: "① 사진 업로드: 제품사진을 1장 이상 올려주세요. 대표사진 · AI분석용 사진을 지정하면 더 정확합니다.",
  analyze: "② AI 분석: AI 사진분석 버튼을 눌러 카테고리 · 소재 · 키워드를 자동으로 채워보세요.",
  info: "③ 기본정보 확인: 거래처 · 색상 · 사이즈 · 모델번호 · 판매가를 확인하고 필요한 부분만 수정하세요.",
  thumbs: "④ 썸네일 승인: 옵션별 흰배경 썸네일을 만들고 승인해주세요. 전체 생성 버튼이 자동으로 만들어 드립니다.",
  detail: "⑤ 상세페이지 승인: 상세페이지에 포함할 사진을 체크하고 780px 상세페이지를 만들어주세요.",
  generate: "⑥ 전체 생성: 모든 준비가 끝났습니다. 전체 생성 버튼 한 번으로 상품DB까지 저장하세요.",
};

function defaultRingSizes(gender: string) {
  if (gender === "남성") return MALE_RING_SIZES;
  if (gender === "여성") return FEMALE_RING_SIZES;
  return UNISEX_RING_SIZES;
}

function colorCode(option: string) {
  const normalized = option.trim().toLowerCase();
  if (normalized.includes("로즈")) return "RG";
  if (normalized.includes("골드") || normalized.includes("gold")) return "GO";
  if (normalized.includes("실버") || normalized.includes("silver")) return "SI";
  if (normalized.includes("블랙") || normalized.includes("black")) return "BK";
  if (normalized.includes("화이트") || normalized.includes("white")) return "WH";
  return normalized.replace(/[^a-z0-9가-힣]/g, "").slice(0, 2).toUpperCase() || "OP";
}

function ringSizeNumber(size: string) {
  return size.replace(/[^0-9]/g, "");
}

function looksLikeMetalColorOption(option: string) {
  const n = option.trim().toLowerCase();
  return ["로즈", "골드", "gold", "실버", "silver", "블랙", "black", "화이트", "white"].some(
    k => n.includes(k)
  );
}

function normalizeKeyword(value: string, product: Product) {
  const banned = new Set([
    product.category, product.gender, product.material,
    "여성용", "남성용", "남녀공용", "주얼리", "쥬얼리",
    "반지", "귀걸이", "목걸이", "팔찌", "발찌", "피어싱", "브로치", "세트"
  ]);
  const words = value
    .replace(/[,.，、/|+()[\]{}:;·_-]+/g, " ")
    .split(/\s+/)
    .map(v => v.trim())
    .filter(Boolean)
    .filter(v => !banned.has(v));
  return [...new Set(words)].slice(0, 5).join(" ");
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
    const trimmed = word.trim();
    if (!trimmed) return;
    const key = normalizeCompare(trimmed);
    if (seen.has(key)) return;
    seen.add(key);
    parts.push(trimmed);
  };

  const designTokens = cleanedKeyword
    .replace(/[,.，、/|+()[\]{}:;·_\-]+/g, " ")
    .split(/\s+/)
    .map(v => v.trim())
    .filter(Boolean);

  addPart(material);

  for (const token of designTokens) {
    if (
      token === material ||
      token === gender ||
      token === category ||
      GENDER_WORDS.has(token) ||
      CATEGORY_WORDS.has(token)
    ) {
      continue;
    }

    let word = token;
    if (word.endsWith(category) && word.length > category.length) {
      word = word.slice(0, -category.length);
    }
    if (!word || word.length < 2 || CATEGORY_WORDS.has(word)) continue;
    addPart(word);
  }

  addPart(gender);
  addPart(category);

  return parts.join(" ").replace(/\s+/g, " ").trim();
}

function isAcceptedImageFile(file: File) {
  if (ACCEPTED_IMAGE_TYPES.includes(file.type)) return true;
  return /\.(jpe?g|png)$/i.test(file.name);
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function composeDetailPageDataUrl(items: { dataUrl: string }[], gap = 60): Promise<string> {
  if (!items.length) throw new Error("상세페이지에 사용할 사진이 없습니다.");
  const width = 780;
  const prepared = await Promise.all(
    items.map(async item => {
      const img = await loadImageElement(item.dataUrl);
      const height = Math.max(1, Math.round((img.height / img.width) * width));
      return { img, height };
    })
  );

  const totalHeight =
    gap +
    prepared.reduce((sum, item) => sum + item.height, 0) +
    gap * Math.max(0, prepared.length - 1) +
    gap;

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

  return canvas.toDataURL("image/jpeg", 0.94);
}

export default function Home() {
  const [product, setProduct] = useState<Product>({
    supplier:"부산", category:"반지", gender:"여성", material:"써지컬스틸",
    colors:"로즈골드,실버,골드", sizes:"9호,11호,14호,17호,20호",
    modelNo:"1", keyword:"체인패턴 볼드", cost:"1900", price:"14900",
  });

  const [photos, setPhotos] = useState<ProductPhoto[]>([]);
  const [photoMessage, setPhotoMessage] = useState("");
  const [isDraggingPhotos, setIsDraggingPhotos] = useState(false);
  const [draggedPhotoIndex, setDraggedPhotoIndex] = useState<number | null>(null);

  const [analysis, setAnalysis] = useState<Analysis>({});
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  const [thumbnails, setThumbnails] = useState<ThumbnailMap>({});
  const [optionThumbs, setOptionThumbs] = useState<Record<string, OptionThumbState>>({});
  const [thumbBusy, setThumbBusy] = useState("");
  const [thumbMessage, setThumbMessage] = useState("");

  const sizesUserEditedRef = useRef(false);

  const [detailImages, setDetailImages] = useState<DetailImage[]>([]);
  const [detailPreview, setDetailPreview] = useState("");
  const [detailMessage, setDetailMessage] = useState("");
  const [draggedDetailIndex, setDraggedDetailIndex] = useState<number | null>(null);

  const [sourcing, setSourcing] = useState<SourcingResult>({});
  const [sourcingLoading, setSourcingLoading] = useState(false);
  const [sourcingImagesLoading, setSourcingImagesLoading] = useState(false);
  const [sourcingMessage, setSourcingMessage] = useState("");
  const [sourcingUrl, setSourcingUrl] = useState("");
  const [sourcingUrlInput, setSourcingUrlInput] = useState("");
  const [showAdvancedSourcing, setShowAdvancedSourcing] = useState(false);

  const [extraImages, setExtraImages] = useState<ExtraImage[]>([]);
  const [extraMessage, setExtraMessage] = useState("");
  const [extraBusy, setExtraBusy] = useState("");
  const [closeupSourceId, setCloseupSourceId] = useState("");

  const [showExperimental, setShowExperimental] = useState(false);
  const [generatedShots, setGeneratedShots] = useState<Record<string, GeneratedShot>>({});
  const [shotLoading, setShotLoading] = useState("");
  const [shotOption, setShotOption] = useState("");
  const [shotMessage, setShotMessage] = useState("");

  const [showAdvanced, setShowAdvanced] = useState(false);

  const [exportLoading, setExportLoading] = useState("");
  const [exportMessage, setExportMessage] = useState("");
  const [fullSaveDone, setFullSaveDone] = useState(false);

  const [dbSupported, setDbSupported] = useState(false);
  const [dbHandle, setDbHandle] = useState<FileSystemDirectoryHandle | null>(null);
  const [dbFolderName, setDbFolderName] = useState("");
  const [dbStatus, setDbStatus] = useState("");
  const [dbSaving, setDbSaving] = useState(false);
  const [dbSavedFiles, setDbSavedFiles] = useState<string[]>([]);
  const [dbSkippedFiles, setDbSkippedFiles] = useState<string[]>([]);
  const [dbReadyFiles, setDbReadyFiles] = useState<string[]>([]);
  const [dbMissingFiles, setDbMissingFiles] = useState<string[]>([]);

  const [generateBusy, setGenerateBusy] = useState(false);
  const [generateStatus, setGenerateStatus] = useState("");

  useEffect(() => {
    setDbSupported(supportsDirectoryPicker());
    (async () => {
      try {
        const handle = await loadDirectoryHandle();
        if (!handle) return;
        const ok = await ensureReadWritePermission(handle);
        if (!ok) {
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
      const raw = localStorage.getItem("noidb-product-draft");
      if (!raw) return;
      const draft = JSON.parse(raw);

      if (draft.product) setProduct(prev => ({ ...prev, ...draft.product }));
      if (draft.analysis) setAnalysis(draft.analysis);

      if (Array.isArray(draft.photos) && draft.photos.length) {
        const legacy = draft.photos.some((p: Record<string, unknown>) => typeof p.isPrimary === "undefined");
        const migrated: ProductPhoto[] = draft.photos.map((p: Record<string, unknown>, index: number) => ({
          id: String(p.id ?? `${Date.now()}-${index}`),
          name: String(p.name ?? `사진${index + 1}.jpg`),
          dataUrl: String(p.dataUrl ?? ""),
          isPrimary: legacy ? index === 0 : Boolean(p.isPrimary),
          isAiAnalyze: legacy ? index === 0 : Boolean(p.isAiAnalyze),
          isThumbSource: legacy ? true : Boolean(p.isThumbSource ?? true),
          includeInDetail: legacy ? true : Boolean(p.includeInDetail ?? true),
          isSourcingExtra: Boolean(p.isSourcingExtra),
        })).filter((p: ProductPhoto) => p.dataUrl);

        if (migrated.length && !migrated.some(p => p.isPrimary)) migrated[0].isPrimary = true;
        if (migrated.length && !migrated.some(p => p.isAiAnalyze)) migrated[0].isAiAnalyze = true;
        setPhotos(migrated);
      } else if (typeof draft.imageDataUrl === "string" && draft.imageDataUrl.startsWith("data:image/")) {
        setPhotos([{
          id: `legacy-${Date.now()}`,
          name: "기존사진.jpg",
          dataUrl: draft.imageDataUrl,
          isPrimary: true,
          isAiAnalyze: true,
          isThumbSource: true,
          includeInDetail: true,
        }]);
      }

      if (draft.optionThumbs) {
        const migratedThumbs: Record<string, OptionThumbState> = {};
        for (const [option, state] of Object.entries(draft.optionThumbs as Record<string, Record<string, unknown>>)) {
          migratedThumbs[option] = {
            sourceId: String(state.sourceId ?? ""),
            draftDataUrl: String(state.draftDataUrl ?? ""),
            approvedDataUrl: String(state.approvedDataUrl ?? ""),
          };
        }
        setOptionThumbs(migratedThumbs);
      }
      if (Array.isArray(draft.extraImages)) setExtraImages(draft.extraImages);
      if (Array.isArray(draft.detailImages)) setDetailImages(draft.detailImages);
      if (typeof draft.detailPreview === "string") setDetailPreview(draft.detailPreview);
      if (typeof draft.sourcingUrl === "string" && draft.sourcingUrl) {
        setSourcingUrl(draft.sourcingUrl);
        setSourcingUrlInput(draft.sourcingUrl);
      }

      setMessage("임시저장된 정보를 불러왔습니다.");
    } catch {
      // corrupted draft — ignore and start fresh
    }
  }, []);

  const model = useMemo(() => {
    const no = product.modelNo.replace(/\D/g,"").padStart(4,"0");
    return product.modelNo ? `${codeMap[product.category] ?? "wx"}${no}` : "";
  }, [product.category, product.modelNo]);

  const cleanedKeyword = useMemo(
    () => normalizeKeyword(product.keyword, product),
    [product]
  );

  const title = useMemo(
    () => buildProductTitle(product, cleanedKeyword),
    [product, cleanedKeyword]
  );

  const tags = useMemo(() => {
    const designWords = cleanedKeyword.split(/\s+/).filter(Boolean);
    const colors = product.colors.split(",").map(v => v.trim()).filter(Boolean);
    const candidates = [
      `${product.material}${product.category}`,
      `${product.gender}${product.category}`,
      ...designWords.map(word => `${word}${product.category}`),
      `데일리${product.category}`,
      `패션${product.category}`,
      `선물용${product.category}`,
      ...colors.map(color => `${color}${product.category}`),
    ];
    return [...new Set(candidates.filter(Boolean))].slice(0, 10).join(",");
  }, [product, cleanedKeyword]);

  const ready = Boolean(
    product.supplier && product.category && product.material && product.colors &&
    product.sizes && product.modelNo && product.keyword && product.price
  );

  // Colors are never re-sorted — option order below always mirrors user input order.
  const options = useMemo(
    () => product.colors.split(",").map(v => v.trim()).filter(Boolean),
    [product.colors]
  );

  const primaryPhoto = useMemo(
    () => photos.find(p => p.isPrimary) || photos[0],
    [photos]
  );
  const imageDataUrl = primaryPhoto?.dataUrl ?? "";

  const thumbSourceCandidates = useMemo(() => {
    const flagged = photos.filter(p => p.isThumbSource);
    return flagged.length ? flagged : photos;
  }, [photos]);

  useEffect(() => {
    if (options.length && !options.includes(shotOption)) {
      setShotOption(options[0]);
    }
  }, [options, shotOption]);

  const defaultThumbSourceId = () =>
    thumbSourceCandidates[0]?.id || primaryPhoto?.id || photos[0]?.id || "";

  const defaultOptionThumb = (): OptionThumbState => ({
    sourceId: defaultThumbSourceId(),
    draftDataUrl: "",
    approvedDataUrl: "",
  });

  useEffect(() => {
    setOptionThumbs(prev => {
      let changed = false;
      const next = { ...prev };
      for (const option of options) {
        if (!next[option]) {
          next[option] = defaultOptionThumb();
          changed = true;
        }
      }
      return changed ? next : prev;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options]);

  const approvedCount = options.filter(o => optionThumbs[o]?.approvedDataUrl).length;

  const progressSteps: ProgressStep[] = [
    { key: "photos", label: "① 사진 업로드", done: photos.length > 0 },
    { key: "analyze", label: "② AI 분석", done: Object.keys(analysis).length > 0 },
    { key: "info", label: "③ 기본정보 확인", done: ready },
    { key: "thumbs", label: "④ 썸네일 승인", done: approvedCount > 0 && approvedCount >= options.length },
    { key: "detail", label: "⑤ 상세페이지 승인", done: Boolean(detailPreview) },
    { key: "generate", label: "⑥ 전체 생성", done: fullSaveDone },
  ];
  const nextStepKey = progressSteps.find(s => !s.done)?.key || "generate";

  const update = (key:keyof Product, value:string) => {
    setProduct(prev => {
      const next = { ...prev, [key]: value };
      if (
        (key === "gender" || key === "category") &&
        next.category === "반지" &&
        !sizesUserEditedRef.current
      ) {
        next.sizes = defaultRingSizes(next.gender);
      }
      return next;
    });
  };

  const updateSizes = (value: string) => {
    sizesUserEditedRef.current = true;
    setProduct(prev => ({ ...prev, sizes: value }));
  };

  // ----------------------------------------------------------------------
  // Photos
  // ----------------------------------------------------------------------

  const addPhotoFiles = async (fileList: FileList | File[], opts?: { isSourcingExtra?: boolean }) => {
    const files = Array.from(fileList).filter(isAcceptedImageFile);
    if (!files.length) {
      setPhotoMessage("JPG 또는 PNG 파일만 추가할 수 있습니다.");
      return;
    }
    const room = Math.max(0, MAX_PHOTOS - photos.length);
    if (room <= 0) {
      setPhotoMessage(`사진은 최대 ${MAX_PHOTOS}장까지 등록할 수 있습니다.`);
      return;
    }
    const toAdd = files.slice(0, room);
    const wasEmpty = photos.length === 0;
    try {
      const items: ProductPhoto[] = await Promise.all(
        toAdd.map(async (file, index) => {
          const isFirstEver = wasEmpty && index === 0;
          return {
            id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
            name: file.name,
            dataUrl: await readFileAsDataUrl(file),
            isPrimary: isFirstEver,
            isAiAnalyze: isFirstEver,
            isThumbSource: true,
            includeInDetail: true,
            isSourcingExtra: opts?.isSourcingExtra || false,
          };
        })
      );
      setPhotos(prev => [...prev, ...items].slice(0, MAX_PHOTOS));
      setAnalysis({});
      setPhotoMessage(
        files.length > toAdd.length
          ? `${toAdd.length}장을 추가했습니다. 최대 ${MAX_PHOTOS}장 제한으로 ${files.length - toAdd.length}장은 제외되었습니다.`
          : `${toAdd.length}장의 사진을 추가했습니다.`
      );
    } catch {
      setPhotoMessage("사진을 불러오지 못했습니다.");
    }
  };

  const addPhotosFromDataUrls = (
    dataUrls: string[],
    opts: { isSourcingExtra: boolean; namePrefix: string }
  ) => {
    setPhotos(prev => {
      const room = Math.max(0, MAX_PHOTOS - prev.length);
      if (room <= 0) return prev;
      const wasEmpty = prev.length === 0;
      const toAdd: ProductPhoto[] = dataUrls.slice(0, room).map((dataUrl, index) => ({
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}-${index}`,
        name: `${opts.namePrefix}${String(index + 1).padStart(2, "0")}.jpg`,
        dataUrl,
        isPrimary: wasEmpty && index === 0,
        isAiAnalyze: wasEmpty && index === 0,
        isThumbSource: true,
        includeInDetail: true,
        isSourcingExtra: opts.isSourcingExtra,
      }));
      return [...prev, ...toAdd];
    });
  };

  const onPhotoInput = (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.length) addPhotoFiles(e.target.files);
    e.target.value = "";
  };

  const onPhotoDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDraggingPhotos(false);
    if (e.dataTransfer.files?.length) addPhotoFiles(e.dataTransfer.files);
  };
  const onPhotoDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDraggingPhotos(true);
  };
  const onPhotoDragLeave = () => setIsDraggingPhotos(false);

  const removePhoto = (id: string) => {
    setPhotos(prev => {
      let next = prev.filter(p => p.id !== id);
      if (!next.length) return next;
      if (!next.some(p => p.isPrimary)) {
        next = next.map((p, i) => (i === 0 ? { ...p, isPrimary: true } : p));
      }
      if (!next.some(p => p.isAiAnalyze)) {
        next = next.map((p, i) => (i === 0 ? { ...p, isAiAnalyze: true } : p));
      }
      return next;
    });
  };

  const setPrimaryPhoto = (id: string) => {
    setPhotos(prev => prev.map(p => ({ ...p, isPrimary: p.id === id })));
  };

  const setAiAnalyzePhoto = (id: string) => {
    setPhotos(prev => prev.map(p => ({ ...p, isAiAnalyze: p.id === id })));
  };

  const toggleThumbSourcePhoto = (id: string) => {
    setPhotos(prev => prev.map(p => (p.id === id ? { ...p, isThumbSource: !p.isThumbSource } : p)));
  };

  const toggleIncludeInDetailPhoto = (id: string) => {
    setPhotos(prev => prev.map(p => (p.id === id ? { ...p, includeInDetail: !p.includeInDetail } : p)));
  };

  const reorderPhoto = (fromIndex: number, toIndex: number) => {
    if (fromIndex === toIndex) return;
    setPhotos(prev => {
      const next = [...prev];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      return next;
    });
  };
  const dropPhoto = (targetIndex: number) => {
    if (draggedPhotoIndex === null || draggedPhotoIndex === targetIndex) return;
    reorderPhoto(draggedPhotoIndex, targetIndex);
    setDraggedPhotoIndex(null);
  };

  // ----------------------------------------------------------------------
  // AI 분석
  // ----------------------------------------------------------------------

  const analyzeImage = async () => {
    const aiPhoto = photos.find(p => p.isAiAnalyze) || photos.find(p => p.isPrimary);
    if (!aiPhoto) {
      setMessage("AI 분석용 사진 1장을 지정해주세요.");
      return;
    }
    setLoading(true);
    setMessage("AI가 제품 디자인과 각인을 분석하고 있습니다...");
    try {
      const compressed = await compressImageDataUrl(aiPhoto.dataUrl, 1600, 0.82);
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageDataUrl: compressed, current: product }),
      });

      let data: Record<string, unknown> | null = null;
      try {
        data = await res.json();
      } catch {
        data = null;
      }

      if (!res.ok) {
        if (res.status === 413) {
          setMessage("AI 분석용 사진 1장을 지정해주세요.");
        } else {
          const errorText = data && typeof data.error === "string" ? data.error : "";
          setMessage(`오류: ${errorText || "AI 분석에 실패했습니다. 잠시 후 다시 시도해주세요."}`);
        }
        return;
      }
      if (!data) {
        setMessage("오류: AI 분석 결과를 해석하지 못했습니다. 잠시 후 다시 시도해주세요.");
        return;
      }

      setProduct(prev => {
        const hasUserColors = prev.colors.trim().length > 0;
        const next: Product = {
          ...prev,
          category: String(data?.category || prev.category),
          gender: String(data?.gender || prev.gender),
          material: String(data?.material || prev.material),
          // Never overwrite user-entered colors, and never re-sort them.
          colors: hasUserColors ? prev.colors : String(data?.colors || prev.colors),
          keyword: normalizeKeyword(String(data?.keyword || prev.keyword), {
            ...prev,
            category: String(data?.category || prev.category),
            gender: String(data?.gender || prev.gender),
            material: String(data?.material || prev.material),
          }),
        };
        if (next.category === "반지" && !sizesUserEditedRef.current) {
          next.sizes = defaultRingSizes(next.gender);
        }
        return next;
      });
      setAnalysis(data as Analysis);
      setMessage("AI 사진분석이 완료되었습니다. 결과를 확인하고 필요한 부분만 수정하세요.");
    } catch {
      setMessage("오류: AI 분석 중 문제가 발생했습니다. 네트워크 상태를 확인하고 다시 시도해주세요.");
    } finally {
      setLoading(false);
    }
  };

  // ----------------------------------------------------------------------
  // Draft save / download
  // ----------------------------------------------------------------------

  const persistDraft = () => {
    localStorage.setItem("noidb-product-draft", JSON.stringify({
      product, analysis, model, title, tags,
      photos, optionThumbs, extraImages, sourcingUrl,
      detailImages, detailPreview,
    }));
  };

  const saveDraft = () => {
    persistDraft();
    setMessage("현재 기기에 임시저장했습니다.");
  };

  const download = () => {
    const blob = new Blob([JSON.stringify({
      ...product, model, title, tags, analysis, sourcingUrl,
      status:ready ? "등록가능":"정보확인"
    },null,2)], {type:"application/json;charset=utf-8"});
    const url=URL.createObjectURL(blob);
    const a=document.createElement("a");
    a.href=url; a.download=`${model || "noidb-product"}.json`; a.click();
    URL.revokeObjectURL(url);
  };

  // ----------------------------------------------------------------------
  // Sourcing (1688 first)
  // ----------------------------------------------------------------------

  const analyzeForSourcing = async () => {
    if (!imageDataUrl) {
      setSourcingMessage("먼저 제품사진을 선택해주세요.");
      return;
    }
    setSourcingLoading(true);
    setSourcingMessage("중국어 검색어와 사진 속 정보를 분석하고 있습니다...");
    try {
      const res = await fetch("/api/sourcing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageDataUrl, current: product }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "소싱 분석 실패");
      setSourcing(data);

      if (data.detectedPrice && data.detectedPrice !== "없음" && !product.cost) {
        const number = String(data.detectedPrice).replace(/\D/g, "");
        if (number) update("cost", number);
      }
      if (Array.isArray(data.detectedSizes) && data.detectedSizes.length && !product.sizes) {
        update("sizes", data.detectedSizes.join(","));
      }
      if (Array.isArray(data.detectedColors) && data.detectedColors.length && !product.colors.trim()) {
        update("colors", data.detectedColors.join(","));
      }

      setSourcingMessage("소싱 검색어 생성이 완료되었습니다.");
    } catch (error) {
      setSourcingMessage(
        `오류: ${error instanceof Error ? error.message : "소싱 분석 실패"}`
      );
    } finally {
      setSourcingLoading(false);
    }
  };

  const copyText = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setSourcingMessage(`복사했습니다: ${value}`);
    } catch {
      setSourcingMessage("복사하지 못했습니다. 검색어를 길게 눌러 복사해주세요.");
    }
  };

  const openSearch = (site: "1688" | "taobao" | "aliexpress" | "googleImages", keyword: string) => {
    const q = encodeURIComponent(keyword);
    const urls = {
      "1688": `https://www.google.com/search?q=${encodeURIComponent("site:1688.com " + keyword)}`,
      "taobao": `https://www.google.com/search?q=${encodeURIComponent("site:taobao.com " + keyword)}`,
      "aliexpress": `https://www.google.com/search?q=${encodeURIComponent("site:aliexpress.com/item " + keyword)}`,
      "googleImages": `https://www.google.com/search?tbm=isch&q=${q}`,
    };
    window.open(urls[site], "_blank", "noopener,noreferrer");
  };

  const primary1688Keyword = useMemo(() => {
    const chinese = sourcing.chineseKeywords?.[0];
    if (chinese) return chinese;
    const korean = [cleanedKeyword, product.material, product.category].filter(Boolean).join(" ");
    return korean || title || model;
  }, [sourcing, cleanedKeyword, product.material, product.category, title, model]);

  const search1688 = () => {
    if (!primary1688Keyword) {
      setSourcingMessage("검색어를 만들 정보가 부족합니다. 먼저 기본정보를 입력해주세요.");
      return;
    }
    openSearch("1688", primary1688Keyword);
  };

  const saveSourcingUrl = () => {
    const trimmed = sourcingUrlInput.trim();
    if (!trimmed) {
      setSourcingMessage("1688 링크를 입력해주세요.");
      return;
    }
    setSourcingUrl(trimmed);
    setSourcingMessage("1688 링크를 저장했습니다. 상품정보 저장시 함께 기록됩니다.");
  };

  const fetchSourcingImages = async () => {
    const url = sourcingUrl || sourcingUrlInput.trim();
    if (!url) {
      setSourcingMessage("먼저 1688 상품 URL을 입력하고 저장해주세요.");
      return;
    }
    setSourcingImagesLoading(true);
    setSourcingMessage("1688 이미지를 가져오고 있습니다...");
    try {
      const res = await fetch("/api/sourcing-images", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      let data: { images?: { dataUrl: string }[]; error?: string } | null = null;
      try {
        data = await res.json();
      } catch {
        data = null;
      }
      if (!res.ok || !Array.isArray(data?.images) || !data.images.length) {
        setSourcingMessage(
          (data && data.error) ||
            "1688 이미지를 가져오지 못했습니다. \"1688 이미지 직접 추가\"로 업로드해주세요."
        );
        return;
      }
      const urls = data.images.map(img => img.dataUrl).filter(Boolean);
      const room = Math.max(0, MAX_PHOTOS - photos.length);
      if (room <= 0) {
        setSourcingMessage(`사진은 최대 ${MAX_PHOTOS}장까지 등록할 수 있습니다.`);
        return;
      }
      addPhotosFromDataUrls(urls, { isSourcingExtra: true, namePrefix: "원본_추가" });
      setSourcingMessage(`1688 이미지 ${Math.min(urls.length, room)}장을 제품사진 목록에 추가했습니다.`);
    } catch {
      setSourcingMessage("1688 이미지 가져오기 중 문제가 발생했습니다. \"1688 이미지 직접 추가\"를 사용해주세요.");
    } finally {
      setSourcingImagesLoading(false);
    }
  };

  const onSourcingDirectUpload = (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.length) addPhotoFiles(e.target.files, { isSourcingExtra: true });
    e.target.value = "";
  };

  // ----------------------------------------------------------------------
  // Experimental AI wearing shots (advanced only — never auto-included)
  // ----------------------------------------------------------------------

  const generateDetailShot = async (shotType: string, label: string) => {
    if (!imageDataUrl) {
      setShotMessage("먼저 대표사진을 등록해주세요.");
      return;
    }
    setShotLoading(shotType);
    setShotMessage(`${shotOption} ${label}을 생성하고 있습니다. 약 20~60초 걸릴 수 있습니다.`);

    try {
      const res = await fetch("/api/detail-shot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          imageDataUrl,
          shotType,
          option: shotOption,
          category: product.category,
          keyword: cleanedKeyword
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "추가컷 생성 실패");

      const resultKey = `${shotOption}-${shotType}`;
      setGeneratedShots(prev => ({
        ...prev,
        [resultKey]: { key: resultKey, label, dataUrl: data.imageDataUrl, option: shotOption }
      }));
      setShotMessage(`${shotOption} ${label} 생성이 완료되었습니다. 실험 기능이므로 실제 제품과 비교 후 사용하세요.`);
    } catch (error) {
      setShotMessage(`오류: ${error instanceof Error ? error.message : "추가컷 생성 실패"}`);
    } finally {
      setShotLoading("");
    }
  };

  // ----------------------------------------------------------------------
  // Detail page
  // ----------------------------------------------------------------------

  const onDetailImages = (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (!files.length) return;

    Promise.all(
      files.map(async file => ({
        id: `${Date.now()}-${Math.random()}`,
        name: file.name,
        dataUrl: await readFileAsDataUrl(file),
      }))
    )
      .then(items => {
        setDetailImages(prev => [...prev, ...items]);
        setDetailPreview("");
        setDetailMessage(`${items.length}장의 상세페이지 사진을 추가했습니다.`);
      })
      .catch(() => setDetailMessage("사진을 불러오지 못했습니다."));
    e.target.value = "";
  };

  const reorderDetailImage = (fromIndex: number, toIndex: number) => {
    if (fromIndex === toIndex) return;
    setDetailImages(prev => {
      const next = [...prev];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      return next;
    });
    setDetailPreview("");
    setDetailMessage("사진 순서를 변경했습니다.");
  };

  const dropDetailImage = (targetIndex: number) => {
    if (draggedDetailIndex === null || draggedDetailIndex === targetIndex) return;
    reorderDetailImage(draggedDetailIndex, targetIndex);
    setDraggedDetailIndex(null);
  };

  const onDetailTouchMove = (e: React.TouchEvent) => {
    if (draggedDetailIndex === null) return;
    const touch = e.touches[0];
    const target = document.elementFromPoint(touch.clientX, touch.clientY);
    const row = target?.closest("[data-detail-index]");
    if (!row) return;
    const toIndex = Number(row.getAttribute("data-detail-index"));
    if (Number.isNaN(toIndex) || toIndex === draggedDetailIndex) return;
    reorderDetailImage(draggedDetailIndex, toIndex);
    setDraggedDetailIndex(toIndex);
  };

  const removeDetailImage = (id: string) => {
    setDetailImages(prev => prev.filter(item => item.id !== id));
    setDetailPreview("");
  };

  const addPhotoToDetail = (photo: ProductPhoto) => {
    setDetailImages(prev => [
      ...prev,
      { id: `${Date.now()}-${photo.id}-${Math.random()}`, name: photo.name, dataUrl: photo.dataUrl }
    ]);
    setDetailPreview("");
    setDetailMessage(`${photo.name} 사진을 상세페이지 목록에 추가했습니다.`);
  };

  const syncDetailFromPhotos = () => {
    const included = photos.filter(p => p.includeInDetail);
    if (!included.length) {
      setDetailMessage("상세페이지에 포함할 사진을 먼저 체크해주세요 (상세페이지 포함).");
      return;
    }
    setDetailImages(included.map(p => ({
      id: `${p.id}-detail-${Date.now()}`,
      name: p.name,
      dataUrl: p.dataUrl,
    })));
    setDetailPreview("");
    setDetailMessage(`상세페이지 포함 사진 ${included.length}장을 순서대로 불러왔습니다.`);
  };

  const buildDetailPage = async () => {
    if (!detailImages.length) {
      setDetailMessage("상세페이지에 사용할 사진을 먼저 여러 장 선택해주세요.");
      return;
    }

    setDetailMessage("780px 롱 상세페이지를 만들고 있습니다...");
    try {
      const dataUrl = await composeDetailPageDataUrl(detailImages, 60);
      setDetailPreview(dataUrl);
      setDetailMessage(`상세페이지 완성: 가로 780px · 사진 ${detailImages.length}장 · 여백 60px`);
    } catch (error) {
      setDetailMessage(
        `오류: ${error instanceof Error ? error.message : "상세페이지 생성 실패"}`
      );
    }
  };

  // ----------------------------------------------------------------------
  // Thumbnails
  // ----------------------------------------------------------------------

  const setThumbSource = (option: string, photoId: string) => {
    setOptionThumbs(prev => ({
      ...prev,
      [option]: { ...(prev[option] || defaultOptionThumb()), sourceId: photoId },
    }));
  };

  const buildWhiteThumbnail = async (option: string) => {
    const state = optionThumbs[option] || defaultOptionThumb();
    const source =
      photos.find(p => p.id === state.sourceId) ||
      thumbSourceCandidates[0] ||
      primaryPhoto;
    if (!source) {
      setThumbMessage(`${option} 썸네일을 만들 사진을 먼저 선택해주세요.`);
      return;
    }
    setThumbBusy(`${option}:white`);
    setThumbMessage(`${option} 흰배경 썸네일을 만들고 있습니다...`);
    try {
      const crop = await detectContentCrop(source.dataUrl).catch(() => null);
      const dataUrl = await composeWhiteThumbnail(source.dataUrl, 0.84, crop);
      setOptionThumbs(prev => ({
        ...prev,
        [option]: { ...(prev[option] || defaultOptionThumb()), sourceId: source.id, draftDataUrl: dataUrl },
      }));
      setThumbMessage(`${option} 흰배경 썸네일 초안을 만들었습니다.`);
    } catch (error) {
      setThumbMessage(`오류: ${error instanceof Error ? error.message : "썸네일 생성 실패"}`);
    } finally {
      setThumbBusy("");
    }
  };

  const adjustColor = async (option: string) => {
    const state = optionThumbs[option] || defaultOptionThumb();
    setThumbBusy(`${option}:color`);
    setThumbMessage(`${option} 색상을 보정하고 있습니다...`);
    try {
      let baseDataUrl = state.draftDataUrl;
      if (!baseDataUrl) {
        const source =
          photos.find(p => p.id === state.sourceId) ||
          thumbSourceCandidates[0] ||
          primaryPhoto;
        if (!source) throw new Error("먼저 썸네일 소스 사진을 선택해주세요.");
        const crop = await detectContentCrop(source.dataUrl).catch(() => null);
        baseDataUrl = await composeWhiteThumbnail(source.dataUrl, 0.84, crop);
      }
      const recolored = await applyMetalColorPreset(baseDataUrl, option);
      setOptionThumbs(prev => ({
        ...prev,
        [option]: { ...(prev[option] || defaultOptionThumb()), draftDataUrl: recolored },
      }));
      setThumbMessage(`${option} 색상 보정을 완료했습니다.`);
    } catch (error) {
      setThumbMessage(`오류: ${error instanceof Error ? error.message : "색상 보정 실패"}`);
    } finally {
      setThumbBusy("");
    }
  };

  const approveThumbnail = (option: string) => {
    const state = optionThumbs[option];
    if (!state?.draftDataUrl) {
      setThumbMessage(`${option} 썸네일 초안을 먼저 만들어주세요.`);
      return;
    }
    setOptionThumbs(prev => ({
      ...prev,
      [option]: { ...state, approvedDataUrl: state.draftDataUrl },
    }));
    setThumbnails(prev => ({ ...prev, [option]: state.draftDataUrl }));
    setThumbMessage(`${option} 썸네일을 승인했습니다. SKU 저장이 가능합니다.`);
  };

  const regenerateThumbnailWithAI = async (option: string) => {
    const state = optionThumbs[option] || defaultOptionThumb();
    const source =
      photos.find(p => p.id === state.sourceId) ||
      thumbSourceCandidates[0] ||
      primaryPhoto;
    if (!source) {
      setThumbMessage(`${option} 썸네일을 만들 사진을 먼저 선택해주세요.`);
      return;
    }
    setThumbBusy(`${option}:ai`);
    setThumbMessage(`${option} AI 썸네일을 새로 생성하고 있습니다. 20~40초 정도 걸릴 수 있습니다.`);
    try {
      const res = await fetch("/api/thumbnail", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          imageDataUrl: source.dataUrl,
          option,
          category: product.category,
          keyword: cleanedKeyword,
        }),
      });
      let data: { imageDataUrl?: string; error?: string } | null = null;
      try {
        data = await res.json();
      } catch {
        data = null;
      }
      if (!res.ok || !data?.imageDataUrl) {
        setThumbMessage(`${option}: AI 썸네일 생성을 사용할 수 없습니다. 기본 흰배경 썸네일을 이용해주세요.`);
        return;
      }
      setOptionThumbs(prev => ({
        ...prev,
        [option]: { ...(prev[option] || defaultOptionThumb()), sourceId: source.id, draftDataUrl: data!.imageDataUrl! },
      }));
      setThumbMessage(`${option} AI 썸네일 초안을 만들었습니다. 실제 제품과 비교한 뒤 승인해주세요.`);
    } catch {
      setThumbMessage(`${option}: AI 썸네일 생성 중 문제가 발생했습니다. 기본 흰배경 썸네일을 이용해주세요.`);
    } finally {
      setThumbBusy("");
    }
  };

  const downloadDataUrl = (dataUrl: string, filename: string) => {
    const a = document.createElement("a");
    a.href = dataUrl;
    a.download = filename;
    a.click();
  };

  const downloadApprovedSku = (option: string) => {
    const dataUrl = optionThumbs[option]?.approvedDataUrl;
    if (!dataUrl) {
      setThumbMessage(`${option} 썸네일을 먼저 승인해주세요.`);
      return;
    }
    const sizes = product.sizes.split(",").map(v => v.trim()).filter(Boolean);
    const code = colorCode(option);
    if (product.category === "반지" && sizes.length) {
      sizes.forEach((size, index) => {
        window.setTimeout(() => {
          downloadDataUrl(dataUrl, `${model}-${code}${ringSizeNumber(size)}.jpg`);
        }, index * 300);
      });
      setThumbMessage(`${option} SKU 썸네일 ${sizes.length}개를 다운로드했습니다.`);
    } else {
      downloadDataUrl(dataUrl, `${model}-${code}.jpg`);
      setThumbMessage(`${option} 썸네일을 다운로드했습니다.`);
    }
  };

  // ----------------------------------------------------------------------
  // Extra images (closeup / collage / real uploads only)
  // ----------------------------------------------------------------------

  const extraImageLabel = (kind: ExtraImageKind) => {
    if (kind === "closeup") return "디테일 클로즈업";
    if (kind === "collage") return "전체옵션 연출컷";
    return "실사 사진";
  };

  const buildCloseup = async () => {
    const source = photos.find(p => p.id === closeupSourceId) || primaryPhoto;
    if (!source) {
      setExtraMessage("먼저 제품사진을 등록해주세요.");
      return;
    }
    setExtraBusy("closeup");
    setExtraMessage("디테일 클로즈업 이미지를 만들고 있습니다...");
    try {
      const dataUrl = await buildCloseupFromSource(source.dataUrl);
      setExtraImages(prev => [...prev, { id: `${Date.now()}-closeup-${Math.random()}`, kind: "closeup", dataUrl }]);
      setExtraMessage("디테일 클로즈업 이미지를 추가했습니다.");
    } catch (error) {
      setExtraMessage(`오류: ${error instanceof Error ? error.message : "클로즈업 생성 실패"}`);
    } finally {
      setExtraBusy("");
    }
  };

  const buildCollage = async () => {
    const approved = options.filter(o => thumbnails[o]).map(o => thumbnails[o]);
    if (approved.length < 2) {
      setExtraMessage("전체옵션 연출컷은 승인된 썸네일이 2개 이상 필요합니다.");
      return;
    }
    setExtraBusy("collage");
    setExtraMessage("전체옵션 연출컷을 만들고 있습니다...");
    try {
      const dataUrl = await buildOptionsCollage(approved);
      setExtraImages(prev => [...prev, { id: `${Date.now()}-collage-${Math.random()}`, kind: "collage", dataUrl }]);
      setExtraMessage("전체옵션 연출컷을 추가했습니다.");
    } catch (error) {
      setExtraMessage(`오류: ${error instanceof Error ? error.message : "연출컷 생성 실패"}`);
    } finally {
      setExtraBusy("");
    }
  };

  const onExtraUpload = (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []).filter(isAcceptedImageFile);
    if (!files.length) {
      setExtraMessage("JPG 또는 PNG 파일만 추가할 수 있습니다.");
      e.target.value = "";
      return;
    }
    Promise.all(
      files.map(async file => ({
        id: `${Date.now()}-${Math.random()}`,
        kind: "upload" as ExtraImageKind,
        dataUrl: await readFileAsDataUrl(file),
      }))
    )
      .then(items => {
        setExtraImages(prev => [...prev, ...items]);
        setExtraMessage(`${items.length}장의 실사 사진을 추가이미지 목록에 추가했습니다.`);
      })
      .catch(() => setExtraMessage("사진을 불러오지 못했습니다."));
    e.target.value = "";
  };

  const removeExtraImage = (id: string) => {
    setExtraImages(prev => prev.filter(item => item.id !== id));
  };

  const downloadExtraImage = (index: number) => {
    const item = extraImages[index];
    if (!item) return;
    downloadDataUrl(item.dataUrl, `${model || "model"}-${String(index + 1).padStart(2, "0")}.jpg`);
  };

  const downloadAllExtraImages = () => {
    if (!extraImages.length) {
      setExtraMessage("먼저 추가이미지를 만들어주세요.");
      return;
    }
    extraImages.forEach((_, index) => {
      window.setTimeout(() => downloadExtraImage(index), index * 300);
    });
    setExtraMessage(`추가이미지 ${extraImages.length}장을 다운로드했습니다.`);
  };

  // ----------------------------------------------------------------------
  // Excel exports (advanced)
  // ----------------------------------------------------------------------

  const exportPayload = () => ({
    product,
    model,
    title,
    tags,
    additionalImages: extraImages.map((_, i) => `${model}-${String(i + 1).padStart(2, "0")}.jpg`),
  });

  const downloadBlobFile = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const filenameFromDisposition = (header: string | null, fallback: string) => {
    if (!header) return fallback;
    const utf = header.match(/filename\*=UTF-8''([^;]+)/i);
    if (utf?.[1]) return decodeURIComponent(utf[1]);
    const plain = header.match(/filename="?([^";]+)"?/i);
    return plain?.[1] || fallback;
  };

  const downloadQuoteExcel = async () => {
    if (!model || !title) {
      setExportMessage("모델명과 상품명을 먼저 완성해주세요.");
      return;
    }
    if (!["반지", "귀걸이", "피어싱", "목걸이", "팔찌", "발찌"].includes(product.category)) {
      setExportMessage("이 카테고리는 견적서 템플릿이 없습니다. (브로치/세트 제외)");
      return;
    }
    setExportLoading("quote");
    setExportMessage("카테고리별 견적서를 생성하고 있습니다...");
    try {
      const res = await fetch("/api/export-quote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(exportPayload()),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "견적서 생성 실패");
      }
      const blob = await res.blob();
      const filename = filenameFromDisposition(
        res.headers.get("Content-Disposition"),
        `견적서_${model}_${product.category}.xlsx`
      );
      downloadBlobFile(blob, filename);
      const skuCount = res.headers.get("X-SKU-Count") || "";
      setExportMessage(
        `견적서 다운로드 완료${skuCount ? ` · SKU ${skuCount}행` : ""}: ${filename}`
      );
    } catch (error) {
      setExportMessage(`오류: ${error instanceof Error ? error.message : "견적서 생성 실패"}`);
    } finally {
      setExportLoading("");
    }
  };

  const downloadAutomationExcel = async () => {
    if (!model || !title) {
      setExportMessage("모델명과 상품명을 먼저 완성해주세요.");
      return;
    }
    setExportLoading("automation");
    setExportMessage("상품입력 자동화 파일을 생성하고 있습니다...");
    try {
      const res = await fetch("/api/export-automation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(exportPayload()),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "자동화 파일 생성 실패");
      }
      const blob = await res.blob();
      const filename = filenameFromDisposition(
        res.headers.get("Content-Disposition"),
        `상품입력자동화_${model}.xlsx`
      );
      downloadBlobFile(blob, filename);
      const skuCount = res.headers.get("X-SKU-Count") || "";
      setExportMessage(
        `상품입력 자동화 파일 다운로드 완료${skuCount ? ` · SKU ${skuCount}행` : ""}: ${filename}`
      );
    } catch (error) {
      setExportMessage(
        `오류: ${error instanceof Error ? error.message : "자동화 파일 생성 실패"}`
      );
    } finally {
      setExportLoading("");
    }
  };

  const downloadLabel = async () => {
    if (!model) {
      setExportMessage("모델명을 먼저 입력해주세요.");
      return;
    }
    try {
      const blob = await createLabelBlob(model);
      downloadBlobFile(blob, `라벨_${model}.jpg`);
      setExportMessage(`라벨_${model}.jpg 다운로드 완료`);
    } catch (error) {
      setExportMessage(`오류: ${error instanceof Error ? error.message : "라벨 생성 실패"}`);
    }
  };

  // ----------------------------------------------------------------------
  // Product DB collection / storage
  // ----------------------------------------------------------------------

  const buildCollectInput = (overrides?: {
    photosList?: ProductPhoto[];
    thumbnailMap?: ThumbnailMap;
    extraImagesList?: ExtraImage[];
    detailPreviewValue?: string;
  }) => {
    const photosList = overrides?.photosList ?? photos;
    const thumbnailMap = overrides?.thumbnailMap ?? thumbnails;
    const extraImagesList = overrides?.extraImagesList ?? extraImages;
    const detailPreviewValue = overrides?.detailPreviewValue ?? detailPreview;

    const normalPhotoUrls = photosList.filter(p => !p.isSourcingExtra).map(p => p.dataUrl);
    const extraOriginalPhotoUrls = photosList.filter(p => p.isSourcingExtra).map(p => p.dataUrl);

    return collectProductDbFiles({
      category: product.category,
      model,
      title,
      tags,
      product: product as unknown as Record<string, string>,
      analysis,
      ready,
      photos: normalPhotoUrls,
      extraOriginalPhotos: extraOriginalPhotoUrls,
      imageDataUrl: photosList.find(p => p.isPrimary)?.dataUrl ?? photosList[0]?.dataUrl ?? "",
      thumbnails: Object.fromEntries(options.filter(o => thumbnailMap[o]).map(o => [o, thumbnailMap[o]])),
      extraImages: extraImagesList.map(e => e.dataUrl),
      detailPreview: detailPreviewValue,
      sourcingUrl,
    });
  };

  const previewDbFiles = async () => {
    if (!model) {
      setDbStatus("모델명을 먼저 완성해주세요.");
      return;
    }
    setDbStatus("저장 전 파일 구성을 확인하고 있습니다...");
    try {
      const { readyFiles, missingFiles } = await buildCollectInput();
      setDbReadyFiles(readyFiles);
      setDbMissingFiles(missingFiles);
      setDbStatus(
        missingFiles.length
          ? `확인 완료: 준비된 파일 ${readyFiles.length}개 · 빠진 파일 ${missingFiles.length}개`
          : `확인 완료: 모든 파일이 준비되었습니다 (${readyFiles.length}개).`
      );
    } catch (error) {
      setDbStatus(`오류: ${error instanceof Error ? error.message : "확인 실패"}`);
    }
  };

  const pickProductDbFolder = async () => {
    if (!supportsDirectoryPicker()) {
      setDbStatus("이 브라우저에서는 폴더 선택이 지원되지 않습니다. ZIP 다운로드를 사용하세요.");
      return;
    }
    try {
      const handle = await window.showDirectoryPicker({ mode: "readwrite" });
      const ok = await ensureReadWritePermission(handle);
      if (!ok) {
        setDbStatus("폴더 쓰기 권한이 필요합니다.");
        return;
      }
      await saveDirectoryHandle(handle);
      setDbHandle(handle);
      setDbFolderName(handle.name);
      setDbStatus(`저장폴더 연결 완료: ${handle.name}`);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setDbStatus(`오류: ${error instanceof Error ? error.message : "폴더 선택 실패"}`);
    }
  };

  const saveAllToProductDb = async () => {
    if (!model) {
      setDbStatus("모델명을 먼저 완성해주세요.");
      return;
    }
    if (!dbHandle) {
      setDbStatus("먼저 상품DB 폴더를 선택해주세요.");
      return;
    }
    setDbSaving(true);
    setDbSavedFiles([]);
    setDbSkippedFiles([]);
    setDbStatus("상품DB에 저장 중...");
    try {
      const ok = await ensureReadWritePermission(dbHandle);
      if (!ok) throw new Error("폴더 쓰기 권한이 없습니다. 다시 선택해주세요.");

      const { files, skipped, readyFiles, missingFiles } = await buildCollectInput();
      const saved = await writeProductDbFiles(dbHandle, product.category, model, files);
      setDbSavedFiles(saved);
      setDbSkippedFiles(skipped);
      setDbReadyFiles(readyFiles);
      setDbMissingFiles(missingFiles);
      setFullSaveDone(true);
      setDbStatus(
        `상품DB 저장 완료: ${saved.length}개 저장` +
          (skipped.length ? ` · ${skipped.length}개 건너뜀` : "")
      );
    } catch (error) {
      setDbStatus(`오류: ${error instanceof Error ? error.message : "상품DB 저장 실패"}`);
    } finally {
      setDbSaving(false);
    }
  };

  const downloadProductDbZip = async () => {
    if (!model) {
      setDbStatus("모델명을 먼저 완성해주세요.");
      return;
    }
    setDbSaving(true);
    setDbSavedFiles([]);
    setDbSkippedFiles([]);
    setDbStatus("상품DB ZIP을 만들고 있습니다...");
    try {
      const { files, skipped, readyFiles, missingFiles } = await buildCollectInput();
      const blob = await buildProductDbZip(product.category, model, files);
      downloadBlobFile(blob, `상품DB_${model}.zip`);
      setDbSavedFiles(files.map(f => f.path));
      setDbSkippedFiles(skipped);
      setDbReadyFiles(readyFiles);
      setDbMissingFiles(missingFiles);
      setFullSaveDone(true);
      setDbStatus(
        `ZIP 다운로드 완료: 상품DB_${model}.zip · ${files.length}개 포함` +
          (skipped.length ? ` · ${skipped.length}개 건너뜀` : "")
      );
    } catch (error) {
      setDbStatus(`오류: ${error instanceof Error ? error.message : "ZIP 생성 실패"}`);
    } finally {
      setDbSaving(false);
    }
  };

  // ----------------------------------------------------------------------
  // 전체 생성 (one-click pipeline)
  // ----------------------------------------------------------------------

  const runFullGeneration = async () => {
    if (generateBusy) return;
    if (!photos.length) {
      setGenerateStatus("오류: 먼저 제품사진을 1장 이상 등록해주세요.");
      return;
    }
    if (!model) {
      setGenerateStatus("오류: 카테고리와 모델번호를 확인해 모델명을 완성해주세요.");
      return;
    }

    setGenerateBusy(true);
    try {
      // 1. save product JSON draft
      setGenerateStatus("1/6 상품 정보를 임시저장하고 있습니다...");
      persistDraft();

      // 2. thumbnails per option
      setGenerateStatus("2/6 옵션별 흰배경 썸네일을 만들고 있습니다...");
      const nextOptionThumbs: Record<string, OptionThumbState> = { ...optionThumbs };
      for (const option of options) {
        const existing = nextOptionThumbs[option];
        if (existing?.approvedDataUrl) continue;

        const source =
          photos.find(p => p.id === existing?.sourceId) ||
          thumbSourceCandidates[0] ||
          primaryPhoto;
        if (!source) continue;

        setGenerateStatus(`2/6 "${option}" 옵션 썸네일을 만들고 있습니다...`);
        const crop = await detectContentCrop(source.dataUrl).catch(() => null);
        let composed = await composeWhiteThumbnail(source.dataUrl, 0.84, crop);
        if (looksLikeMetalColorOption(option)) {
          composed = await applyMetalColorPreset(composed, option).catch(() => composed);
        }
        nextOptionThumbs[option] = {
          sourceId: source.id,
          draftDataUrl: composed,
          approvedDataUrl: composed,
        };
      }
      setOptionThumbs(nextOptionThumbs);

      const approvedMap: ThumbnailMap = {};
      for (const option of options) {
        const approved = nextOptionThumbs[option]?.approvedDataUrl;
        if (approved) approvedMap[option] = approved;
      }
      setThumbnails(approvedMap);

      // 4. closeup + collage (rebuilt fresh each run; keep user uploads)
      setGenerateStatus("3/6 추가이미지(클로즈업 · 연출컷)를 만들고 있습니다...");
      let nextExtra = extraImages.filter(e => e.kind === "upload");
      const closeupSource = photos.find(p => p.isPrimary) || photos[0];
      if (closeupSource) {
        try {
          const closeup = await buildCloseupFromSource(closeupSource.dataUrl);
          nextExtra = [...nextExtra, { id: `${Date.now()}-closeup`, kind: "closeup", dataUrl: closeup }];
        } catch {
          // non-fatal — closeup is best-effort
        }
      }
      const approvedList = options.filter(o => approvedMap[o]).map(o => approvedMap[o]);
      if (approvedList.length >= 2) {
        try {
          const collage = await buildOptionsCollage(approvedList);
          nextExtra = [...nextExtra, { id: `${Date.now()}-collage`, kind: "collage", dataUrl: collage }];
        } catch {
          // non-fatal — collage is best-effort
        }
      }
      setExtraImages(nextExtra);

      // 5. detail page from photos with includeInDetail (order preserved), gap=60
      setGenerateStatus("4/6 상세페이지를 만들고 있습니다...");
      const includedPhotos = photos.filter(p => p.includeInDetail);
      let preview = detailPreview;
      if (includedPhotos.length) {
        const detailItems: DetailImage[] = includedPhotos.map(p => ({
          id: `${p.id}-detail`,
          name: p.name,
          dataUrl: p.dataUrl,
        }));
        setDetailImages(detailItems);
        preview = await composeDetailPageDataUrl(detailItems, 60);
        setDetailPreview(preview);
      }

      // 6+7. label blob ready via collect + gather all product DB files
      setGenerateStatus("5/6 상품DB 파일을 모으고 있습니다 (라벨 · 견적서 · 자동화 파일 포함)...");
      const collected = await buildCollectInput({
        photosList: photos,
        thumbnailMap: approvedMap,
        extraImagesList: nextExtra,
        detailPreviewValue: preview,
      });
      setDbReadyFiles(collected.readyFiles);
      setDbMissingFiles(collected.missingFiles);

      // 8+9. write to folder or fall back to ZIP download
      setGenerateStatus("6/6 상품DB에 저장하고 있습니다...");
      if (dbHandle) {
        const ok = await ensureReadWritePermission(dbHandle);
        if (!ok) throw new Error("폴더 쓰기 권한이 없습니다. 상품DB 폴더를 다시 선택해주세요.");
        const saved = await writeProductDbFiles(dbHandle, product.category, model, collected.files);
        setDbSavedFiles(saved);
        setDbSkippedFiles(collected.skipped);
      } else {
        const blob = await buildProductDbZip(product.category, model, collected.files);
        downloadBlobFile(blob, `상품DB_${model}.zip`);
        setDbSavedFiles(collected.files.map(f => f.path));
        setDbSkippedFiles(collected.skipped);
      }

      setFullSaveDone(true);
      setGenerateStatus("상품 생성 완료");
    } catch (error) {
      setGenerateStatus(`오류: ${error instanceof Error ? error.message : "전체 생성 중 문제가 발생했습니다."}`);
    } finally {
      setGenerateBusy(false);
    }
  };

  return (
    <main className="shell">
      <header className="hero">
        <div><p className="eyebrow">노이드비 AI</p><h1>AI 상품등록 도우미</h1>
        <p className="sub">V11 · 초보자 간편 흐름 · 전체 생성 원클릭</p></div>
        <span className="pill">AI 사진분석</span>
      </header>

      <div className="stepGuide">
        <div className="progressSteps">
          {progressSteps.map(step => (
            <span
              key={step.key}
              className={
                "progressStep" +
                (step.done ? " done" : "") +
                (step.key === nextStepKey ? " nextStepHighlight" : "")
              }
            >
              {step.done ? "✓ " : ""}{step.label}
            </span>
          ))}
        </div>
        <p className="guideLine">{STEP_GUIDE[nextStepKey]}</p>
      </div>

      <section className="card full dbSetupCard">
        <h2>상품DB 저장 폴더 · 전체 생성</h2>
        <p className="note">
          G:\내 드라이브\상품DB 폴더를 선택해두면 아래 &quot;전체 생성&quot; 버튼 한 번으로 썸네일 · 추가이미지 ·
          상세페이지 · 라벨 · 견적서 · 자동화 파일까지 모두 만들어 폴더에 저장합니다.
          폴더를 선택하지 않으면 ZIP 파일로 대신 다운로드합니다.
        </p>
        <div className="exportActions">
          {dbSupported && (
            <button className="dark" onClick={pickProductDbFolder}>
              상품DB 폴더 선택
            </button>
          )}
        </div>
        {dbSupported && dbFolderName && (
          <p className="detailMessage">저장폴더 연결 완료: {dbFolderName}</p>
        )}

        <button
          className="generateAllButton green"
          disabled={generateBusy}
          onClick={runFullGeneration}
        >
          {generateBusy ? "전체 생성 중..." : "🚀 전체 생성"}
        </button>

        {generateStatus && (
          <p className={generateStatus.startsWith("오류") ? "error" : "detailMessage"}>
            {generateStatus}
          </p>
        )}

        {(dbReadyFiles.length > 0 || dbMissingFiles.length > 0) && (
          <div className="dbFileList">
            <h3>준비된 파일 ({dbReadyFiles.length})</h3>
            <ul>
              {dbReadyFiles.map(name => <li key={name}>{name}</li>)}
            </ul>
            {dbMissingFiles.length > 0 && (
              <>
                <h3>빠진 파일 ({dbMissingFiles.length})</h3>
                <ul>
                  {dbMissingFiles.map(name => <li key={name}>{name}</li>)}
                </ul>
              </>
            )}
          </div>
        )}
        {dbSavedFiles.length > 0 && (
          <div className="dbFileList">
            <h3>저장된 파일</h3>
            <ul>
              {dbSavedFiles.map(path => (
                <li key={path}>{path}</li>
              ))}
            </ul>
          </div>
        )}
        {dbSkippedFiles.length > 0 && (
          <div className="dbFileList skipped">
            <h3>건너뛴 파일</h3>
            <ul>
              {dbSkippedFiles.map(item => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <section className="grid">
        <div className="card full">
          <h2>① 제품사진 (최소 1장, 최대 {MAX_PHOTOS}장)</h2>
          <div
            className={"dropZone" + (isDraggingPhotos ? " dragging" : "")}
            onDragOver={onPhotoDragOver}
            onDragLeave={onPhotoDragLeave}
            onDrop={onPhotoDrop}
          >
            <label className="uploadLabel">
              <input
                type="file"
                accept="image/jpeg,image/jpg,image/png"
                multiple
                onChange={onPhotoInput}
              />
              <strong>사진을 끌어놓거나 클릭해서 선택하세요</strong>
              <span>JPG 또는 PNG · 여러 장 동시 선택 가능 · 순서는 끌어서 변경</span>
            </label>
          </div>

          {photoMessage && (
            <p className={photoMessage.startsWith("오류") ? "error" : "message"}>{photoMessage}</p>
          )}

          {photos.length > 0 && (
            <div className="photoGrid">
              {photos.map((photo, index) => (
                <div
                  className={"photoCard" + (photo.isPrimary ? " primaryPhoto" : "")}
                  key={photo.id}
                  draggable
                  onDragStart={() => setDraggedPhotoIndex(index)}
                  onDragOver={e => e.preventDefault()}
                  onDrop={() => dropPhoto(index)}
                  onDragEnd={() => setDraggedPhotoIndex(null)}
                >
                  <img src={photo.dataUrl} alt={photo.name} />
                  {photo.isPrimary && <span className="primaryBadge">대표사진</span>}
                  {photo.isSourcingExtra && <span className="primaryBadge sourcingBadge">1688 추가</span>}

                  <div className="photoChecks">
                    <label>
                      <input
                        type="radio"
                        name="photoPrimary"
                        checked={photo.isPrimary}
                        onChange={() => setPrimaryPhoto(photo.id)}
                      />
                      대표사진
                    </label>
                    <label>
                      <input
                        type="radio"
                        name="photoAiAnalyze"
                        checked={photo.isAiAnalyze}
                        onChange={() => setAiAnalyzePhoto(photo.id)}
                      />
                      AI분석용
                    </label>
                    <label>
                      <input
                        type="checkbox"
                        checked={photo.isThumbSource}
                        onChange={() => toggleThumbSourcePhoto(photo.id)}
                      />
                      썸네일원본
                    </label>
                    <label>
                      <input
                        type="checkbox"
                        checked={photo.includeInDetail}
                        onChange={() => toggleIncludeInDetailPhoto(photo.id)}
                      />
                      상세페이지 포함
                    </label>
                  </div>

                  <div className="photoCardActions">
                    <button type="button" className="removeButton" onClick={() => removePhoto(photo.id)}>
                      삭제
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="card full">
          <h2>② AI 사진분석</h2>
          <p className="note">
            체크한 &quot;AI분석용&quot; 사진 1장만 서버로 전송해 분석합니다. 지정하지 않으면 대표사진을 사용합니다.
          </p>
          <button className="aiButton" onClick={analyzeImage} disabled={loading || !photos.length}>
            {loading ? "AI 분석 중..." : "✨ AI 사진분석"}
          </button>
          {message && <p className={message.startsWith("오류") ? "error" : "message"}>{message}</p>}

          <div className="results">
            <Result label="사진 특징" value={analysis.visualFeatures?.join(", ") || "AI 사진분석 버튼을 눌러주세요."}/>
            <Result label="확인된 각인" value={analysis.engraving || "-"}/>
            <Result label="가품 위험도" value={analysis.counterfeitRisk || "-"}/>
            <Result label="검토 이유" value={analysis.counterfeitReason || "-"}/>
            <Result label="분석 신뢰도" value={analysis.confidence != null ? `${analysis.confidence}%` : "-"}/>
          </div>
        </div>

        <div className="card full basicInfoCard">
          <h2>③ 기본정보 확인</h2>
          <div className="formGrid">
            <Field label="거래처"><select value={product.supplier} onChange={e=>update("supplier",e.target.value)}>
              <option>부산</option><option>광주</option><option>서울</option><option>중국직수입</option><option>자체제작</option><option>기타</option>
            </select></Field>
            <Field label="카테고리"><select value={product.category} onChange={e=>update("category",e.target.value)}>
              {Object.keys(codeMap).map(v=><option key={v}>{v}</option>)}
            </select></Field>
            <Field label="성별"><select value={product.gender} onChange={e=>update("gender",e.target.value)}>
              <option>여성</option><option>남성</option><option>남녀공용</option>
            </select></Field>
            <Field label="소재"><select value={product.material} onChange={e=>update("material",e.target.value)}>
              <option>써지컬스틸</option><option>925실버</option><option>티타늄</option><option>신주</option><option>14K</option><option>18K</option><option>기타</option>
            </select></Field>
            <Field label="색상옵션"><input value={product.colors} onChange={e=>update("colors",e.target.value)}/></Field>
            <Field label="사이즈"><input value={product.sizes} onChange={e=>updateSizes(e.target.value)}/></Field>
            <Field label="모델번호 숫자"><input value={product.modelNo} onChange={e=>update("modelNo",e.target.value)}/></Field>
            <Field label="모델명"><input value={model} readOnly /></Field>
            <Field label="핵심키워드"><input
              value={product.keyword}
              onChange={e=>update("keyword",e.target.value)}
              onBlur={()=>update("keyword", normalizeKeyword(product.keyword, product))}
              placeholder="예: 굵은 하트 체인 볼드"
            /></Field>
            <Field label="원가"><input inputMode="numeric" value={product.cost} onChange={e=>update("cost",e.target.value)} placeholder="예: 1900"/></Field>
            <Field label="판매가"><input inputMode="numeric" value={product.price} onChange={e=>update("price",e.target.value)} placeholder="예: 14900"/></Field>
          </div>

          <div className="results">
            <Result label="쿠팡 상품명" value={title || "-"}/>
            <Result label="검색태그 10개" value={tags || "-"}/>
            <Result label="등록상태" value={ready ? "등록가능":"판매가를 입력하면 등록가능"} status={ready}/>
          </div>
          <div className="actions">
            <button className="dark" onClick={saveDraft}>임시저장</button>
            <button className="green" onClick={download}>상품정보 파일 저장</button>
          </div>
        </div>

        <div className="card full">
          <h2>④ 옵션별 흰배경 썸네일</h2>
          <p className="note">
            사진을 고르고 흰배경 썸네일을 만든 뒤, 필요하면 색상만 보정하세요.
            승인해야 SKU 파일로 저장할 수 있습니다. &quot;전체 생성&quot; 버튼이 승인 안 된 옵션을 자동으로 채워줍니다.
          </p>
          {thumbMessage && (
            <p className={thumbMessage.startsWith("오류") ? "error" : "detailMessage"}>{thumbMessage}</p>
          )}

          <div className="thumbnailGrid">
            {options.map(option => {
              const state = optionThumbs[option] || defaultOptionThumb();
              const busyWhite = thumbBusy === `${option}:white`;
              const busyColor = thumbBusy === `${option}:color`;
              const busyAi = thumbBusy === `${option}:ai`;
              const anyBusy = Boolean(thumbBusy);

              return (
                <div className={"thumbnailCard" + (state.approvedDataUrl ? " approved" : "")} key={option}>
                  <h3>{option}</h3>

                  <label className="field">
                    <span>썸네일 소스 사진</span>
                    <select
                      value={state.sourceId || ""}
                      onChange={e => setThumbSource(option, e.target.value)}
                    >
                      {thumbSourceCandidates.length === 0 && <option value="">사진 없음</option>}
                      {thumbSourceCandidates.map(photo => (
                        <option key={photo.id} value={photo.id}>
                          {photo.name}{photo.isPrimary ? " (대표)" : ""}
                        </option>
                      ))}
                    </select>
                  </label>

                  {state.draftDataUrl ? (
                    <img src={state.draftDataUrl} alt={`${option} 썸네일 초안`} />
                  ) : (
                    <div className="thumbnailEmpty">아직 만들지 않음</div>
                  )}

                  <button
                    className="originalButton"
                    disabled={anyBusy || !photos.length}
                    onClick={() => buildWhiteThumbnail(option)}
                  >
                    {busyWhite ? "생성 중..." : "흰배경 썸네일 생성"}
                  </button>
                  <button
                    className="aiOptionalButton"
                    disabled={anyBusy || (!state.draftDataUrl && !photos.length)}
                    onClick={() => adjustColor(option)}
                  >
                    {busyColor ? "보정 중..." : "색상만 보정"}
                  </button>
                  <button
                    className="approveButton"
                    disabled={!state.draftDataUrl}
                    onClick={() => approveThumbnail(option)}
                  >
                    승인
                  </button>
                  {state.approvedDataUrl && <p className="detailMessage">✓ 승인됨</p>}
                  <button
                    className="green"
                    disabled={!state.approvedDataUrl}
                    onClick={() => downloadApprovedSku(option)}
                  >
                    승인된 SKU 저장
                  </button>
                  <button
                    className="secondaryButton"
                    disabled={anyBusy || !photos.length}
                    onClick={() => regenerateThumbnailWithAI(option)}
                  >
                    {busyAi ? "AI 생성 중..." : "AI 새로 생성"}
                  </button>
                </div>
              );
            })}
          </div>
        </div>

        <div className="card full">
          <h2>추가이미지 (쿠팡 등록용)</h2>
          <p className="note">
            실제 제품사진을 그대로 활용한 클로즈업과, 승인된 옵션 썸네일을 모아 만드는 연출컷,
            그리고 직접 촬영한 착용컷 · 제품사진을 추가할 수 있습니다.
          </p>
          {extraMessage && (
            <p className={extraMessage.startsWith("오류") ? "error" : "detailMessage"}>{extraMessage}</p>
          )}

          <div className="extraTools">
            <div className="extraTool">
              <label className="field">
                <span>클로즈업에 사용할 사진</span>
                <select value={closeupSourceId || primaryPhoto?.id || ""} onChange={e => setCloseupSourceId(e.target.value)}>
                  {photos.length === 0 && <option value="">사진 없음</option>}
                  {photos.map(photo => (
                    <option key={photo.id} value={photo.id}>
                      {photo.name}{photo.isPrimary ? " (대표)" : ""}
                    </option>
                  ))}
                </select>
              </label>
              <button className="purpleButton" disabled={Boolean(extraBusy) || !photos.length} onClick={buildCloseup}>
                {extraBusy === "closeup" ? "생성 중..." : "디테일 클로즈업"}
              </button>
            </div>

            <div className="extraTool">
              <p className="note">승인된 옵션 썸네일 {options.filter(o => thumbnails[o]).length}개 사용 가능 (2개 이상 필요)</p>
              <button
                className="purpleButton"
                disabled={Boolean(extraBusy) || options.filter(o => thumbnails[o]).length < 2}
                onClick={buildCollage}
              >
                {extraBusy === "collage" ? "생성 중..." : "전체옵션 연출컷"}
              </button>
            </div>
          </div>

          <label className="multiUpload">
            <input type="file" accept="image/jpeg,image/jpg,image/png" multiple onChange={onExtraUpload} />
            <strong>실제 착용 · 제품 사진 추가</strong>
            <span>실사로 촬영한 착용컷이나 제품사진을 그대로 추가이미지 목록에 넣습니다.</span>
          </label>

          {extraImages.length > 0 && (
            <>
              <div className="photoGrid">
                {extraImages.map((item, index) => (
                  <div className="photoCard" key={item.id}>
                    <img src={item.dataUrl} alt={extraImageLabel(item.kind)} />
                    <span className="primaryBadge">{extraImageLabel(item.kind)}</span>
                    <div className="photoCardActions">
                      <button type="button" onClick={() => downloadExtraImage(index)}>다운로드</button>
                      <button type="button" className="removeButton" onClick={() => removeExtraImage(item.id)}>삭제</button>
                    </div>
                  </div>
                ))}
              </div>
              <div className="actions">
                <button className="green" onClick={downloadAllExtraImages}>
                  전체 다운로드 ({model || "model"}-01.jpg…)
                </button>
              </div>
            </>
          )}
        </div>

        <div className="card full">
          <h2>⑤ 780px 상세페이지</h2>
          <p className="note">
            사진 한 장당 가로 780px 전체 폭으로 배치하고, 위 · 아래 · 사진 사이에 각각 60px 흰 여백을 넣습니다.
          </p>

          <div className="detailActions">
            <button className="secondaryButton" onClick={syncDetailFromPhotos}>
              상세 체크 사진 불러오기
            </button>
            <button className="purpleButton" onClick={buildDetailPage}>
              780px 상세페이지 만들기
            </button>
          </div>

          <label className="multiUpload">
            <input type="file" accept="image/*" multiple onChange={onDetailImages} />
            <strong>상세페이지 사진 여러 장 선택 (직접 추가)</strong>
            <span>정면 · 측면 · 클로즈업 · 착용컷 순으로 선택하거나 아래에서 순서를 바꾸세요.</span>
          </label>

          {photos.length > 0 && (
            <div className="detailPickers">
              <span className="note">등록한 제품사진 추가:</span>
              <div className="detailPickerRow">
                {photos.map(photo => (
                  <button
                    key={photo.id}
                    type="button"
                    className="secondaryButton"
                    onClick={() => addPhotoToDetail(photo)}
                  >
                    + {photo.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          {detailMessage && <p className="detailMessage">{detailMessage}</p>}

          {detailImages.length > 0 && (
            <div className="detailList">
              {detailImages.map((item, index) => (
                <div
                  className="detailItem draggableDetail"
                  key={item.id}
                  data-detail-index={index}
                  draggable
                  onDragStart={() => setDraggedDetailIndex(index)}
                  onDragOver={e => e.preventDefault()}
                  onDrop={() => dropDetailImage(index)}
                  onDragEnd={() => setDraggedDetailIndex(null)}
                  onTouchStart={() => setDraggedDetailIndex(index)}
                  onTouchMove={onDetailTouchMove}
                  onTouchEnd={() => setDraggedDetailIndex(null)}
                >
                  <div className="dragHandle">☰</div>
                  <img src={item.dataUrl} alt={item.name} />
                  <div className="detailItemInfo">
                    <strong>{index + 1}. {item.name}</strong>
                    <span className="dragGuide">길게 눌러 끌어서 순서를 변경하세요.</span>
                    <div className="detailItemButtons">
                      <button className="removeButton" onClick={() => removeDetailImage(item.id)}>
                        삭제
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {detailPreview && (
            <div className="detailResult">
              <h3>완성된 상세페이지 미리보기</h3>
              <div className="detailPreviewFrame">
                <img src={detailPreview} alt="780px 롱 상세페이지" />
              </div>
              <button
                className="green detailDownload"
                onClick={() => downloadDataUrl(detailPreview, `${model}.jpg`)}
              >
                상세페이지 다운로드
              </button>
            </div>
          )}
        </div>

        <div className="card full">
          <h2>신상품 소싱 (1688 우선)</h2>
          <p className="note">
            대표사진으로 1688 동일제품을 먼저 찾아보세요. 다른 검색 사이트와 AI 분석은 고급 검색 옵션에서 사용할 수 있습니다.
          </p>

          <div className="sourcingPrimaryPhoto">
            <span>검색에 사용되는 대표사진</span>
            {primaryPhoto ? (
              <img src={primaryPhoto.dataUrl} alt="대표사진" />
            ) : (
              <span className="note">등록된 사진이 없습니다.</span>
            )}
          </div>

          <button className="search1688Button" onClick={search1688}>
            1688 동일제품 찾기
          </button>

          <div className="sourcingUrlRow">
            <input
              type="text"
              placeholder="1688 상품 URL을 붙여넣으세요"
              value={sourcingUrlInput}
              onChange={e => setSourcingUrlInput(e.target.value)}
            />
            <button className="dark" onClick={saveSourcingUrl}>1688 링크 저장</button>
          </div>
          {sourcingUrl && <p className="detailMessage">저장된 1688 링크: {sourcingUrl}</p>}

          <div className="exportActions">
            <button className="green" disabled={sourcingImagesLoading} onClick={fetchSourcingImages}>
              {sourcingImagesLoading ? "가져오는 중..." : "1688 이미지 가져오기"}
            </button>
          </div>

          <label className="multiUpload">
            <input type="file" accept="image/jpeg,image/jpg,image/png" multiple onChange={onSourcingDirectUpload} />
            <strong>1688 이미지 직접 추가</strong>
            <span>자동으로 가져오지 못했다면 1688에서 받은 사진을 직접 업로드해주세요. (최대 {MAX_PHOTOS}장)</span>
          </label>

          {sourcingMessage && (
            <p className={sourcingMessage.startsWith("오류") ? "error" : "detailMessage"}>
              {sourcingMessage}
            </p>
          )}

          <details
            className="advancedSourcing"
            open={showAdvancedSourcing}
            onToggle={e => setShowAdvancedSourcing((e.target as HTMLDetailsElement).open)}
          >
            <summary>고급 검색 옵션 (AI 분석 · 타오바오 · 알리익스프레스)</summary>

            <div className="sourcingTop">
              <button
                className="sourceAnalyzeButton"
                onClick={analyzeForSourcing}
                disabled={sourcingLoading}
              >
                {sourcingLoading ? "소싱 분석 중..." : "🔎 중국 도매 소싱 분석 (AI)"}
              </button>
            </div>

            {sourcing.koreanSummary && (
              <div className="sourcingSummary">
                <span>AI 제품 요약</span>
                <strong>{sourcing.koreanSummary}</strong>
              </div>
            )}

            {(sourcing.chineseKeywords?.length ?? 0) > 0 && (
              <div className="keywordSection">
                <h3>1688·타오바오 중국어 검색어</h3>
                {sourcing.chineseKeywords!.map((keyword, index) => (
                  <div className="keywordRow" key={`${keyword}-${index}`}>
                    <strong>{keyword}</strong>
                    <button onClick={() => copyText(keyword)}>복사</button>
                    <button onClick={() => openSearch("1688", keyword)}>1688 검색</button>
                    <button onClick={() => openSearch("taobao", keyword)}>타오바오 검색</button>
                    <button onClick={() => openSearch("googleImages", keyword)}>이미지 검색</button>
                  </div>
                ))}
              </div>
            )}

            {(sourcing.englishKeywords?.length ?? 0) > 0 && (
              <div className="keywordSection">
                <h3>알리익스프레스·구글 영어 검색어</h3>
                {sourcing.englishKeywords!.map((keyword, index) => (
                  <div className="keywordRow" key={`${keyword}-${index}`}>
                    <strong>{keyword}</strong>
                    <button onClick={() => copyText(keyword)}>복사</button>
                    <button onClick={() => openSearch("aliexpress", keyword)}>알리 검색</button>
                    <button onClick={() => openSearch("googleImages", keyword)}>이미지 검색</button>
                  </div>
                ))}
              </div>
            )}

            {(sourcing.ocrText?.length ?? 0) > 0 && (
              <div className="sourcingFacts">
                <div><span>사진 속 문구</span><strong>{sourcing.ocrText!.join(" / ")}</strong></div>
                <div><span>읽힌 가격</span><strong>{sourcing.detectedPrice || "없음"}</strong></div>
                <div><span>읽힌 사이즈</span><strong>{sourcing.detectedSizes?.join(", ") || "없음"}</strong></div>
                <div><span>확인된 색상</span><strong>{sourcing.detectedColors?.join(", ") || "없음"}</strong></div>
              </div>
            )}

            {(sourcing.searchTips?.length ?? 0) > 0 && (
              <div className="searchTips">
                <h3>검색 팁</h3>
                <p>{sourcing.searchTips!.join(" · ")}</p>
              </div>
            )}
          </details>
        </div>

        <details
          className="advancedPanel card full"
          open={showAdvanced}
          onToggle={e => setShowAdvanced((e.target as HTMLDetailsElement).open)}
        >
          <summary>고급 사용자</summary>

          <div className="advancedSection">
            <h3>라벨 · 견적서 · 상품입력 자동화 (개별 다운로드)</h3>
            <p className="note">
              &quot;전체 생성&quot; 버튼이 이 파일들을 상품DB 폴더에 자동으로 만들어 줍니다.
              별도의 개별 파일이 필요할 때만 아래 버튼을 사용하세요.
              반지 예시: wr0012-GO9.jpg / wr0012.jpg / 라벨_wr0012.jpg
            </p>
            <div className="exportActions">
              <button className="dark" onClick={downloadLabel}>제품표시사항 라벨 다운로드</button>
              <button
                className="green"
                disabled={Boolean(exportLoading)}
                onClick={downloadQuoteExcel}
              >
                {exportLoading === "quote" ? "견적서 생성 중..." : "카테고리별 견적서 생성"}
              </button>
              <button
                className="dark"
                disabled={Boolean(exportLoading)}
                onClick={downloadAutomationExcel}
              >
                {exportLoading === "automation" ? "자동화 파일 생성 중..." : "상품입력 자동화 파일 생성"}
              </button>
            </div>
            {exportMessage && (
              <p className={exportMessage.startsWith("오류") ? "error" : "detailMessage"}>
                {exportMessage}
              </p>
            )}
          </div>

          <div className="advancedSection">
            <h3>상품DB 저장 (개별 동작)</h3>
            <p className="note">전체 생성이 이미 저장을 마쳤다면 다시 사용할 필요가 없습니다.</p>
            <div className="exportActions">
              <button className="secondaryButton" disabled={dbSaving} onClick={previewDbFiles}>
                저장 전 파일 확인
              </button>
              {dbSupported && dbHandle && (
                <button className="dark" disabled={dbSaving} onClick={saveAllToProductDb}>
                  {dbSaving ? "저장 중..." : "상품DB에 다시 저장"}
                </button>
              )}
              <button className="secondaryButton" disabled={dbSaving} onClick={downloadProductDbZip}>
                {dbSaving ? "ZIP 생성 중..." : "전체 ZIP 다운로드"}
              </button>
            </div>
            {dbStatus && (
              <p className={dbStatus.startsWith("오류") ? "error" : "detailMessage"}>
                {dbStatus}
              </p>
            )}
          </div>

          <div className="advancedSection">
            <h3>실험 기능: AI 착용컷 생성 (미리보기용 · 자동 반영되지 않음)</h3>
            <p className="note">
              AI로 만든 착용컷은 실제 제품과 달라질 수 있습니다. 반드시 눈으로 비교한 뒤 별도로 사용하세요.
              상세페이지 · 추가이미지에 자동으로 포함되지 않습니다.
            </p>
            <details
              className="experimentalSection"
              open={showExperimental}
              onToggle={e => setShowExperimental((e.target as HTMLDetailsElement).open)}
            >
              <summary>AI 착용컷 생성 열기</summary>
              <div className="shotOptionRow">
                <label>
                  <span>생성할 금속 색상</span>
                  <select value={shotOption} onChange={e => setShotOption(e.target.value)}>
                    {options.map(option => <option key={option}>{option}</option>)}
                  </select>
                </label>
              </div>

              {shotMessage && (
                <p className={shotMessage.startsWith("오류") ? "error" : "detailMessage"}>{shotMessage}</p>
              )}

              <div className="shotGrid">
                {experimentalShotTypes.map(shot => {
                  const resultKey = `${shotOption}-${shot.key}`;
                  const result = generatedShots[resultKey];
                  return (
                    <div className="shotCard" key={shot.key}>
                      <h3>{shot.label}</h3>
                      {result ? (
                        <img src={result.dataUrl} alt={`${shotOption} ${shot.label}`} />
                      ) : (
                        <div className="shotEmpty">아직 생성되지 않음</div>
                      )}
                      <button
                        className="purple"
                        disabled={Boolean(shotLoading)}
                        onClick={() => generateDetailShot(shot.key, shot.label)}
                      >
                        {shotLoading === shot.key ? "생성 중..." : `${shot.label} 생성`}
                      </button>
                      {result && (
                        <button
                          className="green shotAction"
                          onClick={() => downloadDataUrl(result.dataUrl, `${model}_${shotOption}_${shot.label}.png`)}
                        >
                          이미지 다운로드
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </details>
          </div>
        </details>
      </section>
    </main>
  );
}

function Field({label,children}:{label:string;children:React.ReactNode}) {
  return <label className="field"><span>{label}</span>{children}</label>;
}
function Result({label,value,status}:{label:string;value:string;status?:boolean}) {
  return <div className="result"><span>{label}</span><strong className={status===undefined?"":status?"good":"warn"}>{value}</strong></div>;
}
