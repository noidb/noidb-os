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
import { writeProductDbFiles } from "@/lib/product-db/fs";
import { buildProductDbZip } from "@/lib/product-db/zip";
import { compressImageDataUrl } from "@/lib/image/compress";
import { defaultFitAdjust, fitToWhiteCanvas, type FitAdjust } from "@/lib/thumbnail/fit";

type Product = {
  supplier: string;
  category: string;
  gender: string;
  material: string;
  colors: string;
  sizes: string;
  modelNo: string;
  keyword: string;
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

function defaultRingSizes(gender: string) {
  if (gender === "남성") return MALE_RING_SIZES;
  if (gender === "여성") return FEMALE_RING_SIZES;
  return UNISEX_RING_SIZES;
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
  )].slice(0, 5).join(" ");
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
    let word = token;
    if (word.endsWith(category) && word.length > category.length) word = word.slice(0, -category.length);
    if (!word || word.length < 2 || CATEGORY_WORDS.has(word)) continue;
    addPart(word);
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
  const [product, setProduct] = useState<Product>({
    supplier: "부산",
    category: "반지",
    gender: "여성",
    material: "써지컬스틸",
    colors: "로즈골드,골드,실버",
    sizes: "9호,11호,14호,17호,20호",
    modelNo: "1",
    keyword: "체인패턴 볼드",
    cost: "1900",
    price: "14900",
  });

  const [photos, setPhotos] = useState<ProductPhoto[]>([]);
  const [photoMessage, setPhotoMessage] = useState("");
  const [draggingPhotos, setDraggingPhotos] = useState(false);
  const [dragPhotoIndex, setDragPhotoIndex] = useState<number | null>(null);

  const [analysis, setAnalysis] = useState<Analysis>({});
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  const sizesUserEditedRef = useRef(false);

  const [allOptions, setAllOptions] = useState<SlotImage | null>(null);
  const [optionThumbs, setOptionThumbs] = useState<Record<string, SlotImage | null>>({});
  const [extra01, setExtra01] = useState<SlotImage | null>(null);
  const [extra02, setExtra02] = useState<SlotImage | null>(null);
  const [extra03, setExtra03] = useState<SlotImage | null>(null);
  const [detailCut, setDetailCut] = useState<SlotImage | null>(null);
  const [wear01, setWear01] = useState<SlotImage | null>(null);
  const [wear02, setWear02] = useState<SlotImage | null>(null);
  const [includeAllOptionsInDetail] = useState(true);
  const [adjustKey, setAdjustKey] = useState("");
  const [adjust, setAdjust] = useState<FitAdjust>(defaultFitAdjust());
  const [adjustPreview, setAdjustPreview] = useState("");
  const [lightbox, setLightbox] = useState("");

  const [detailImages, setDetailImages] = useState<DetailImage[]>([]);
  const [detailPreview, setDetailPreview] = useState("");
  const [detailMessage, setDetailMessage] = useState("");
  const [dragDetailIndex, setDragDetailIndex] = useState<number | null>(null);

  const [sourcingUrl, setSourcingUrl] = useState("");
  const [sourcingUrlInput, setSourcingUrlInput] = useState("");
  const [sourcingMessage, setSourcingMessage] = useState("");

  const [exportLoading, setExportLoading] = useState("");
  const [exportMessage, setExportMessage] = useState("");
  const [batchBusy, setBatchBusy] = useState(false);
  const [batchStatus, setBatchStatus] = useState("");

  const [dbSupported, setDbSupported] = useState(false);
  const [dbHandle, setDbHandle] = useState<FileSystemDirectoryHandle | null>(null);
  const [dbFolderName, setDbFolderName] = useState("");
  const [dbStatus, setDbStatus] = useState("");
  const [dbSavedFiles, setDbSavedFiles] = useState<string[]>([]);

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
      const raw = localStorage.getItem("noidb-product-draft");
      if (!raw) return;
      const draft = JSON.parse(raw);
      if (draft.product) setProduct((prev: Product) => ({ ...prev, ...draft.product }));
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
        setSourcingUrl(draft.sourcingUrl);
        setSourcingUrlInput(draft.sourcingUrl);
      }
      setMessage("임시저장된 정보를 불러왔습니다.");
    } catch {
      /* ignore */
    }
  }, []);

  const model = useMemo(() => {
    const no = product.modelNo.replace(/\D/g, "").padStart(4, "0");
    return product.modelNo ? `${codeMap[product.category] ?? "wx"}${no}` : "";
  }, [product.category, product.modelNo]);

  const cleanedKeyword = useMemo(() => normalizeKeyword(product.keyword, product), [product]);
  const title = useMemo(() => buildProductTitle(product, cleanedKeyword), [product, cleanedKeyword]);
  const tags = useMemo(() => {
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

  const ready = Boolean(
    product.supplier && product.category && product.material && product.colors &&
    product.sizes && product.modelNo && product.keyword && product.price
  );

  const options = useMemo(
    () => product.colors.split(",").map(v => v.trim()).filter(Boolean),
    [product.colors]
  );

  const update = (key: keyof Product, value: string) => {
    setProduct(prev => {
      const next = { ...prev, [key]: value };
      if ((key === "gender" || key === "category") && next.category === "반지" && !sizesUserEditedRef.current) {
        next.sizes = defaultRingSizes(next.gender);
      }
      return next;
    });
  };

  const updateSizes = (value: string) => {
    sizesUserEditedRef.current = true;
    setProduct(prev => ({ ...prev, sizes: value }));
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
        const next = {
          ...prev,
          category: data.category || prev.category,
          gender: data.gender || prev.gender,
          material: data.material || prev.material,
          colors: prev.colors.trim() ? prev.colors : (data.colors || prev.colors),
          keyword: normalizeKeyword(data.keyword || prev.keyword, {
            ...prev,
            category: data.category || prev.category,
            gender: data.gender || prev.gender,
            material: data.material || prev.material,
          }),
        };
        if (next.category === "반지" && !sizesUserEditedRef.current) {
          next.sizes = defaultRingSizes(next.gender);
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

  const searchKeyword = cleanedKeyword || title || `${product.material} ${product.category}`;

  const openGoogleImages = () => {
    window.open(
      `https://www.google.com/search?tbm=isch&q=${encodeURIComponent(searchKeyword)}`,
      "_blank",
      "noopener,noreferrer"
    );
  };

  const open1688Search = () => {
    window.open(
      `https://www.google.com/search?q=${encodeURIComponent("site:1688.com " + searchKeyword)}`,
      "_blank",
      "noopener,noreferrer"
    );
  };

  const saveSourcingUrl = () => {
    const url = sourcingUrlInput.trim();
    if (!url) {
      setSourcingMessage("1688 링크를 입력해주세요.");
      return;
    }
    setSourcingUrl(url);
    setSourcingMessage("1688 링크를 저장했습니다.");
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

  const buildDetailPage = async () => {
    if (!detailImages.length) {
      setDetailMessage("상세페이지에 사용할 사진을 추가해주세요.");
      return;
    }
    setDetailMessage("780px 상세페이지를 만들고 있습니다...");
    try {
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
      setDetailPreview(canvas.toDataURL("image/jpeg", 0.94));
      setDetailMessage(`상세페이지 완성 · ${detailImages.length}장 · ${totalHeight}px`);
    } catch (e) {
      setDetailMessage(`오류: ${e instanceof Error ? e.message : "상세페이지 실패"}`);
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

  const exportPayload = () => ({
    product,
    model,
    title,
    tags,
    additionalImagesCsv: buildAdditionalImagesCsv(model, [
      extra01?.dataUrl,
      extra02?.dataUrl,
      extra03?.dataUrl,
    ]),
    additionalImages: buildAdditionalImagesCsv(model, [
      extra01?.dataUrl,
      extra02?.dataUrl,
      extra03?.dataUrl,
    ]).split(",").filter(Boolean),
  });

  const saveDraft = () => {
    localStorage.setItem(
      "noidb-product-draft",
      JSON.stringify({
        product, analysis, photos, allOptions, optionThumbs,
        extra01, extra02, extra03, detailCut, wear01, wear02,
        detailImages, detailPreview, sourcingUrl, model, title, tags,
      })
    );
    setMessage("임시저장했습니다.");
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

  const collectInput = (detailOverride?: string) => {
    const thumbs: Record<string, string> = {};
    for (const opt of options) {
      const s = optionThumbs[opt];
      if (s?.dataUrl) thumbs[opt] = s.dataUrl;
    }
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
      allOptionsImage: allOptions?.dataUrl,
      includeAllOptionsInQuote: false,
      extra01: extra01?.dataUrl,
      extra02: extra02?.dataUrl,
      extra03: extra03?.dataUrl,
      detailCut: detailCut?.dataUrl,
      wear01: wear01?.dataUrl,
      wear02: wear02?.dataUrl,
      detailPreview: detailOverride ?? detailPreview,
      sourcingUrl,
    });
  };

  const batchSave = async () => {
    const required: string[] = [];
    if (!model) required.push("모델명");
    if (!product.category) required.push("카테고리");
    if (!dbHandle && dbSupported) required.push("상품DB 폴더 연결");
    if (required.length) {
      setBatchStatus(`필수 항목 부족: ${required.join(", ")}`);
      return;
    }

    const recommended: string[] = [];
    for (const opt of options) {
      if (!optionThumbs[opt]?.dataUrl) recommended.push(`${opt} 썸네일`);
    }
    if (!extra01 || !extra02 || !extra03) recommended.push("추가이미지 01~03");
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
      if (dbHandle) {
        const saved = await writeProductDbFiles(dbHandle, product.category, model, files);
        setDbSavedFiles(saved);
        setBatchStatus(
          `상품 생성 완료 · ${saved.length}개 저장 → ${product.category}/${model}/` +
            (skipped.length ? ` · 건너뜀 ${skipped.length}` : "")
        );
      } else {
        const blob = await buildProductDbZip(product.category, model, files);
        downloadBlobFile(blob, `상품DB_${model}.zip`);
        setDbSavedFiles(readyFiles);
        setBatchStatus(`상품 생성 완료 · ZIP 다운로드 (${files.length}개 파일)`);
      }
      saveDraft();
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
      const res = await fetch("/api/export-automation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(exportPayload()),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "자동화 실패");
      }
      downloadBlobFile(await res.blob(), `상품입력자동화_${model}.xlsx`);
      setExportMessage("상품입력 자동화 다운로드 완료");
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

  return (
    <main className="shell">
      <header className="hero">
        <div>
          <p className="eyebrow">노이드비 AI</p>
          <h1>AI 상품등록 도우미</h1>
          <p className="sub">완성 이미지를 칸에 끌어놓고 등록파일로 연결</p>
        </div>
        <span className="pill">실무 수동등록</span>
      </header>

      <div className="progressSteps">
        {[
          "1.제품사진", "2.AI분석", "3.이미지검색", "4.기본정보",
          "5.쿠팡등록이미지", "6.상세페이지", "7.라벨·엑셀", "8.상품DB",
        ].map(s => (
          <span key={s} className="progressStep">{s}</span>
        ))}
      </div>

      <section className="card full dbSetupCard">
        <h2>상품DB · 등록파일 일괄 생성</h2>
        <p className="note">
          이미지를 각 칸에 직접 등록한 뒤, 마지막에 아래 버튼으로 파일명 정리·견적서·상품DB 저장을 한 번에 실행합니다.
          AI로 이미지를 자동 만들지 않습니다.
        </p>
        <div className="exportActions">
          {dbSupported && (
            <button className="dark" type="button" onClick={pickFolder}>상품DB 폴더 선택</button>
          )}
          <button className="secondaryButton" type="button" onClick={saveDraft}>임시저장</button>
        </div>
        {dbFolderName && <p className="detailMessage">연결: {dbFolderName}</p>}
        <button
          className="batchSaveButton"
          type="button"
          disabled={batchBusy}
          onClick={batchSave}
        >
          {batchBusy ? "저장 중..." : "등록파일 일괄 생성 및 저장"}
        </button>
        {batchStatus && (
          <p className={batchStatus.startsWith("오류") ? "error" : "detailMessage"}>{batchStatus}</p>
        )}
        {dbSavedFiles.length > 0 && (
          <div className="dbFileList">
            <h3>저장된 파일</h3>
            <ul>{dbSavedFiles.slice(0, 40).map(f => <li key={f}>{f}</li>)}</ul>
          </div>
        )}
        {dbStatus && <p className="note">{dbStatus}</p>}
      </section>

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
          <Result label="각인" value={analysis.engraving || "-"} />
          <Result label="가품 위험도" value={analysis.counterfeitRisk || "-"} />
          <Result label="검토 이유" value={analysis.counterfeitReason || "-"} />
          <Result label="신뢰도" value={analysis.confidence != null ? `${analysis.confidence}%` : "-"} />
        </div>
      </section>

      {/* 3. 검색 */}
      <section className="card full">
        <h2>3. Google · 1688 이미지 검색</h2>
        <p className="note">Google: 국내 판매가·브랜드 확인 · 1688: 동일제품·원가 확인</p>
        <div className="searchTwoButtons">
          <button className="googleSearchButton" type="button" onClick={openGoogleImages}>
            Google 이미지 검색
          </button>
          <button className="search1688Button" type="button" onClick={open1688Search}>
            1688 이미지 검색
          </button>
        </div>
        <div className="sourcingUrlRow">
          <input
            value={sourcingUrlInput}
            onChange={e => setSourcingUrlInput(e.target.value)}
            placeholder="찾은 1688 링크를 붙여넣으세요"
          />
          <button className="dark" type="button" onClick={saveSourcingUrl}>1688 링크 저장</button>
        </div>
        {sourcingUrl && (
          <div className="savedLinkBox">
            <p className="savedLinkText">{sourcingUrl}</p>
            <div className="savedLinkActions">
              <button type="button" onClick={() => window.open(sourcingUrl, "_blank")}>링크 열기</button>
              <button type="button" onClick={() => copyText(sourcingUrl)}>복사</button>
              <button type="button" onClick={() => { setSourcingUrl(""); setSourcingUrlInput(""); }}>삭제</button>
            </div>
          </div>
        )}
        {sourcingMessage && <p className="detailMessage">{sourcingMessage}</p>}
        <label className="multiUpload" style={{ marginTop: 12 }}>
          <input
            type="file"
            accept="image/jpeg,image/jpg,image/png"
            multiple
            hidden
            onChange={e => {
              if (e.target.files?.length) void addPhotoFiles(e.target.files);
              e.target.value = "";
            }}
          />
          <strong>1688 이미지 직접 추가</strong>
          <span>다운로드한 1688 사진을 제품사진 목록에 추가합니다.</span>
        </label>
      </section>

      {/* 4. 기본정보 */}
      <section className="card full basicInfoCard">
        <h2>4. 기본정보 확인</h2>
        <div className="formGrid">
          <Field label="거래처">
            <select value={product.supplier} onChange={e => update("supplier", e.target.value)}>
              <option>부산</option><option>서울</option><option>기타</option>
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
          <Field label="모델번호 숫자">
            <input value={product.modelNo} onChange={e => update("modelNo", e.target.value)} />
          </Field>
          <Field label="모델명">
            <input value={model} readOnly />
          </Field>
          <Field label="핵심키워드">
            <input value={product.keyword} onChange={e => update("keyword", e.target.value)} />
          </Field>
          <Field label="원가">
            <input inputMode="numeric" value={product.cost} onChange={e => update("cost", e.target.value)} />
          </Field>
          <Field label="판매가">
            <input inputMode="numeric" value={product.price} onChange={e => update("price", e.target.value)} />
          </Field>
        </div>
        <div className="results" style={{ marginTop: 14 }}>
          <Result label="쿠팡 상품명" value={title || "-"} />
          <Result label="검색태그" value={tags || "-"} />
          <Result label="등록상태" value={ready ? "등록가능" : "판매가·키워드 확인"} status={ready} />
        </div>
      </section>

      {/* 5. 쿠팡 등록 이미지 */}
      <section className="card full">
        <h2>5. 쿠팡 등록 이미지</h2>
        <p className="note">
          포토샵 등으로 완성한 이미지를 각 칸에 드래그앤드롭하세요. AI 자동생성은 하지 않습니다.
          파일은 마지막 &quot;등록파일 일괄 생성 및 저장&quot; 때 올바른 이름으로 저장됩니다.
        </p>

        <div className="imageSlotGrid">
          <ImageSlot
            title="전체옵션 이미지"
            filename={model ? `${model}-00.jpg` : "모델명-00.jpg"}
            value={allOptions}
            onChange={setAllOptions}
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
            title="추가이미지 01"
            filename={model ? `${model}-01.jpg` : "모델명-01.jpg"}
            value={extra01}
            onChange={setExtra01}
            onExpand={setLightbox}
            onAddDetail={extra01 ? () => pushDetail("추가이미지 01", extra01.dataUrl) : undefined}
          />
          <ImageSlot
            title="추가이미지 02"
            filename={model ? `${model}-02.jpg` : "모델명-02.jpg"}
            value={extra02}
            onChange={setExtra02}
            onExpand={setLightbox}
            onAddDetail={extra02 ? () => pushDetail("추가이미지 02", extra02.dataUrl) : undefined}
          />
          <ImageSlot
            title="추가이미지 03"
            filename={model ? `${model}-03.jpg` : "모델명-03.jpg"}
            value={extra03}
            onChange={setExtra03}
            onExpand={setLightbox}
            onAddDetail={extra03 ? () => pushDetail("추가이미지 03", extra03.dataUrl) : undefined}
          />
          <ImageSlot
            title="디테일컷"
            filename={model ? `${model}-detail.jpg` : "모델명-detail.jpg"}
            value={detailCut}
            onChange={setDetailCut}
            onExpand={setLightbox}
            onAddDetail={detailCut ? () => pushDetail("디테일컷", detailCut.dataUrl) : undefined}
          />
          <ImageSlot
            title="착용컷 01"
            filename={model ? `${model}-wear01.jpg` : "모델명-wear01.jpg"}
            value={wear01}
            onChange={setWear01}
            onExpand={setLightbox}
            onAddDetail={wear01 ? () => pushDetail("착용컷 01", wear01.dataUrl) : undefined}
          />
          <ImageSlot
            title="착용컷 02"
            filename={model ? `${model}-wear02.jpg` : "모델명-wear02.jpg"}
            value={wear02}
            onChange={setWear02}
            onExpand={setLightbox}
            onAddDetail={wear02 ? () => pushDetail("착용컷 02", wear02.dataUrl) : undefined}
          />
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
        <p className="note">가로 780px · 상·중·하 여백 60px · 파일명 {model || "모델명"}.jpg</p>
        <div className="detailActions">
          <button type="button" className="secondaryButton" disabled={!allOptions}
            onClick={() => allOptions && pushDetail("전체옵션", allOptions.dataUrl)}>전체옵션 이미지 추가</button>
          <button type="button" className="secondaryButton"
            disabled={!options.some(o => optionThumbs[o])}
            onClick={() => {
              options.forEach(o => {
                const s = optionThumbs[o];
                if (s) pushDetail(`${o} 썸네일`, s.dataUrl);
              });
            }}>옵션별 썸네일 모두 추가</button>
          <button type="button" className="secondaryButton" disabled={!extra01 && !extra02 && !extra03}
            onClick={() => {
              if (extra01) pushDetail("추가01", extra01.dataUrl);
              if (extra02) pushDetail("추가02", extra02.dataUrl);
              if (extra03) pushDetail("추가03", extra03.dataUrl);
            }}>추가이미지 01~03 추가</button>
          <button type="button" className="secondaryButton" disabled={!detailCut}
            onClick={() => detailCut && pushDetail("디테일컷", detailCut.dataUrl)}>디테일컷 추가</button>
          <button type="button" className="secondaryButton" disabled={!wear01 && !wear02}
            onClick={() => {
              if (wear01) pushDetail("착용01", wear01.dataUrl);
              if (wear02) pushDetail("착용02", wear02.dataUrl);
            }}>착용컷 01~02 추가</button>
          <button type="button" className="secondaryButton" disabled={!photos.length}
            onClick={() => photos.forEach((p, i) => pushDetail(`제품사진${i + 1}`, p.dataUrl))}>
            제품사진에서 추가
          </button>
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

      {/* 7. 라벨·엑셀 */}
      <section className="card full">
        <h2>7. 라벨 · 견적서 · 상품입력</h2>
        <p className="note">
          보통은 위 &quot;등록파일 일괄 생성 및 저장&quot;만 사용하면 됩니다. 개별 다운로드는 아래에서 가능합니다.
        </p>
        <div className="exportActions">
          <button className="dark labelButton" type="button" onClick={() => void downloadLabel()}>라벨 다운로드</button>
          <button className="green" type="button" disabled={Boolean(exportLoading)} onClick={() => void downloadQuote()}>
            {exportLoading === "quote" ? "생성 중..." : "견적서 생성"}
          </button>
          <button className="dark" type="button" disabled={Boolean(exportLoading)} onClick={() => void downloadAutomation()}>
            {exportLoading === "auto" ? "생성 중..." : "상품입력 자동화"}
          </button>
        </div>
        {exportMessage && <p className="detailMessage">{exportMessage}</p>}
      </section>

      <details className="advancedPanel">
        <summary>고급 사용자 · 개별 SKU 다운로드</summary>
        <div className="exportActions" style={{ marginTop: 12 }}>
          {options.map(option => (
            <button
              key={option}
              type="button"
              className="secondaryButton"
              disabled={!optionThumbs[option]}
              onClick={() => downloadSkuManual(option)}
            >
              {option} SKU 저장
            </button>
          ))}
        </div>
      </details>

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

function Result({ label, value, status }: { label: string; value: string; status?: boolean }) {
  return (
    <div className="result">
      <span>{label}</span>
      <strong className={status === undefined ? "" : status ? "good" : "warn"}>{value}</strong>
    </div>
  );
}

function ImageSlot({
  title,
  filename,
  value,
  onChange,
  onExpand,
  onFit,
  onAddDetail,
}: {
  title: string;
  filename: string;
  value: SlotImage | null;
  onChange: (v: SlotImage | null) => void;
  onExpand: (url: string) => void;
  onFit?: () => void;
  onAddDetail?: () => void;
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
    <div className={"imageSlot" + (value ? " imageSlotFilled" : " imageSlotEmpty") + (dragging ? " dragging" : "")}>
      <h3>{title}</h3>
      <p className="slotSpec">1000×1000 JPG</p>
      <p className="slotFilename">{filename}</p>
      <div
        className="slotDrop"
        onClick={() => inputRef.current?.click()}
        onDragOver={e => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={e => {
          e.preventDefault();
          setDragging(false);
          void applyFile(e.dataTransfer.files?.[0]);
        }}
      >
        {value ? (
          <img src={value.dataUrl} alt={title} />
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
        <button type="button" onClick={() => inputRef.current?.click()}>{value ? "교체" : "선택"}</button>
        {value && <button type="button" onClick={() => onExpand(value.dataUrl)}>확대</button>}
        {value && onFit && <button type="button" onClick={onFit}>캔버스맞춤</button>}
        {value && onAddDetail && <button type="button" onClick={onAddDetail}>상세추가</button>}
        {value && <button type="button" className="removeButton" onClick={() => onChange(null)}>삭제</button>}
      </div>
    </div>
  );
}
