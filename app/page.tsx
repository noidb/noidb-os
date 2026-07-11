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

const shotTypes = [
  { key: "front", label: "정면 제품컷" },
  { key: "side", label: "측면 제품컷" },
  { key: "closeup", label: "디테일 클로즈업" },
  { key: "wearingFront", label: "손 착용 정면컷" },
  { key: "wearingSide", label: "손 착용 측면컷" }
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

export default function Home() {
  const [product, setProduct] = useState<Product>({
    supplier:"부산", category:"반지", gender:"여성", material:"써지컬스틸",
    colors:"로즈골드,골드,실버", sizes:"9호,11호,14호,17호,20호",
    modelNo:"12", keyword:"큐빅 투라인 레이어드", cost:"", price:"",
  });
  const [preview, setPreview] = useState("");
  const [imageDataUrl, setImageDataUrl] = useState("");
  const [analysis, setAnalysis] = useState<Analysis>({});
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [thumbnails, setThumbnails] = useState<ThumbnailMap>({});
  const [thumbnailLoading, setThumbnailLoading] = useState("");
  const [aiThumbnailLoading, setAiThumbnailLoading] = useState("");
  const sizesUserEditedRef = useRef(false);
  const [detailImages, setDetailImages] = useState<DetailImage[]>([]);
  const [detailPreview, setDetailPreview] = useState("");
  const [detailMessage, setDetailMessage] = useState("");
  const [sourcing, setSourcing] = useState<SourcingResult>({});
  const [sourcingLoading, setSourcingLoading] = useState(false);
  const [sourcingMessage, setSourcingMessage] = useState("");
  const [generatedShots, setGeneratedShots] = useState<Record<string, GeneratedShot>>({});
  const [shotLoading, setShotLoading] = useState("");
  const [shotOption, setShotOption] = useState("로즈골드");
  const [shotMessage, setShotMessage] = useState("");
  const [exportLoading, setExportLoading] = useState("");
  const [exportMessage, setExportMessage] = useState("");
  const [dbSupported, setDbSupported] = useState(false);
  const [dbHandle, setDbHandle] = useState<FileSystemDirectoryHandle | null>(null);
  const [dbFolderName, setDbFolderName] = useState("");
  const [dbStatus, setDbStatus] = useState("");
  const [dbSaving, setDbSaving] = useState(false);
  const [dbSavedFiles, setDbSavedFiles] = useState<string[]>([]);
  const [dbSkippedFiles, setDbSkippedFiles] = useState<string[]>([]);

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

  const onImage = (e:ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setPreview(URL.createObjectURL(file));
    const reader = new FileReader();
    reader.onload = () => setImageDataUrl(String(reader.result ?? ""));
    reader.readAsDataURL(file);
    setAnalysis({});
    setMessage("");
  };

  const analyzeImage = async () => {
    if (!imageDataUrl) {
      setMessage("먼저 제품사진을 선택해주세요.");
      return;
    }
    setLoading(true);
    setMessage("AI가 제품 디자인과 각인을 분석하고 있습니다...");
    try {
      const res = await fetch("/api/analyze", {
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({imageDataUrl,current:product}),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "분석 실패");

      setProduct(prev => {
        const next = {
          ...prev,
          category:data.category || prev.category,
          gender:data.gender || prev.gender,
          material:data.material || prev.material,
          colors:data.colors || prev.colors,
          keyword:normalizeKeyword(data.keyword || prev.keyword, {
            ...prev,
            category:data.category || prev.category,
            gender:data.gender || prev.gender,
            material:data.material || prev.material,
          }),
        };
        if (next.category === "반지" && !sizesUserEditedRef.current) {
          next.sizes = defaultRingSizes(next.gender);
        }
        return next;
      });
      setAnalysis(data);
      setMessage("AI 사진분석이 완료되었습니다. 결과를 확인하고 필요한 부분만 수정하세요.");
    } catch (e) {
      setMessage(`오류: ${e instanceof Error ? e.message : "분석에 실패했습니다."}`);
    } finally {
      setLoading(false);
    }
  };

  const saveDraft = () => {
    localStorage.setItem("noidb-product-draft", JSON.stringify({product,analysis,model,title,tags}));
    setMessage("현재 기기에 임시저장했습니다.");
  };

  const download = () => {
    const blob = new Blob([JSON.stringify({
      ...product, model, title, tags, analysis,
      status:ready ? "등록가능":"정보확인"
    },null,2)], {type:"application/json;charset=utf-8"});
    const url=URL.createObjectURL(blob);
    const a=document.createElement("a");
    a.href=url; a.download=`${model || "noidb-product"}.json`; a.click();
    URL.revokeObjectURL(url);
  };

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
      if (Array.isArray(data.detectedColors) && data.detectedColors.length) {
        const found = data.detectedColors.join(",");
        if (found) update("colors", found);
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

  const downloadSearchImage = () => {
    if (!imageDataUrl) {
      setSourcingMessage("먼저 제품사진을 선택해주세요.");
      return;
    }
    downloadDataUrl(imageDataUrl, `${model || "상품"}_이미지검색용.jpg`);
  };

  const generateDetailShot = async (shotType: string, label: string) => {
    if (!imageDataUrl) {
      setShotMessage("먼저 제품사진을 선택해주세요.");
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
      setShotMessage(`${shotOption} ${label} 생성이 완료되었습니다.`);
    } catch (error) {
      setShotMessage(`오류: ${error instanceof Error ? error.message : "추가컷 생성 실패"}`);
    } finally {
      setShotLoading("");
    }
  };

  const addShotToDetail = (shot: GeneratedShot) => {
    setDetailImages(prev => [
      ...prev,
      {
        id: `${Date.now()}-${shot.key}-${Math.random()}`,
        name: `${shot.option} ${shot.label}`,
        dataUrl: shot.dataUrl
      }
    ]);
    setDetailPreview("");
    setShotMessage(`${shot.option} ${shot.label}을 상세페이지 목록에 추가했습니다.`);
  };

  const onDetailImages = (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (!files.length) return;

    Promise.all(
      files.map(
        file =>
          new Promise<DetailImage>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () =>
              resolve({
                id: `${Date.now()}-${Math.random()}`,
                name: file.name,
                dataUrl: String(reader.result ?? ""),
              });
            reader.onerror = reject;
            reader.readAsDataURL(file);
          })
      )
    )
      .then(items => {
        setDetailImages(prev => [...prev, ...items]);
        setDetailMessage(`${items.length}장의 상세페이지 사진을 추가했습니다.`);
      })
      .catch(() => setDetailMessage("사진을 불러오지 못했습니다."));
  };

  const [draggedDetailIndex, setDraggedDetailIndex] = useState<number | null>(null);

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

  const loadImage = (src: string) =>
    new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });

  const buildDetailPage = async () => {
    if (!detailImages.length) {
      setDetailMessage("상세페이지에 사용할 사진을 먼저 여러 장 선택해주세요.");
      return;
    }

    setDetailMessage("780px 롱 상세페이지를 만들고 있습니다...");
    try {
      const width = 780;
      const gap = 30;
      const prepared = await Promise.all(
        detailImages.map(async item => {
          const img = await loadImage(item.dataUrl);
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

      const dataUrl = canvas.toDataURL("image/jpeg", 0.94);
      setDetailPreview(dataUrl);
      setDetailMessage(
        `상세페이지 완성: 가로 780px · 사진 ${detailImages.length}장 · 세로 ${totalHeight}px`
      );
    } catch (error) {
      setDetailMessage(
        `오류: ${error instanceof Error ? error.message : "상세페이지 생성 실패"}`
      );
    }
  };

  const addGeneratedThumbnailsToDetail = () => {
    const items = Object.entries(thumbnails).map(([option, dataUrl]) => ({
      id: `${Date.now()}-${option}-${Math.random()}`,
      name: `${option} 썸네일`,
      dataUrl,
    }));
    if (!items.length) {
      setDetailMessage("먼저 옵션별 썸네일을 생성해주세요.");
      return;
    }
    setDetailImages(prev => [...prev, ...items]);
    setDetailPreview("");
    setDetailMessage(`생성된 썸네일 ${items.length}장을 상세페이지 목록에 추가했습니다.`);
  };

  const buildOriginalThumbnail = async (option: string) => {
    if (!imageDataUrl) {
      setMessage("먼저 제품사진을 선택해주세요.");
      return;
    }
    setThumbnailLoading(option);
    setMessage(`${option} 원본유지 썸네일을 만들고 있습니다...`);
    try {
      const img = await loadImage(imageDataUrl);
      const canvas = document.createElement("canvas");
      canvas.width = 1000;
      canvas.height = 1000;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("이미지 캔버스를 만들 수 없습니다.");
      ctx.fillStyle = "#FFFFFF";
      ctx.fillRect(0, 0, 1000, 1000);
      const maxW = 850;
      const maxH = 850;
      const scale = Math.min(maxW / img.width, maxH / img.height);
      const drawW = Math.round(img.width * scale);
      const drawH = Math.round(img.height * scale);
      const x = Math.round((1000 - drawW) / 2);
      const y = Math.round((1000 - drawH) / 2);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(img, x, y, drawW, drawH);
      const dataUrl = canvas.toDataURL("image/jpeg", 0.96);
      setThumbnails(prev => ({ ...prev, [option]: dataUrl }));
      setMessage(`${option} 썸네일 완성: 원본 디자인을 변경하지 않았습니다.`);
    } catch (error) {
      setMessage(`오류: ${error instanceof Error ? error.message : "썸네일 생성 실패"}`);
    } finally {
      setThumbnailLoading("");
    }
  };

  const downloadSkuThumbnails = (option: string) => {
    const dataUrl = thumbnails[option];
    if (!dataUrl) {
      setMessage(`${option} 썸네일을 먼저 만들어주세요.`);
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
      setMessage(`${option} SKU 썸네일 ${sizes.length}개를 다운로드했습니다.`);
    } else {
      downloadDataUrl(dataUrl, `${model}-${code}.jpg`);
      setMessage(`${option} 썸네일을 다운로드했습니다.`);
    }
  };

  const generateThumbnail = async (option: string) => {
    if (!imageDataUrl) {
      setMessage("먼저 제품사진을 선택해주세요.");
      return;
    }
    setAiThumbnailLoading(option);
    setMessage(`${option} AI 보정 썸네일을 생성하고 있습니다. 약 20~60초 걸릴 수 있습니다.`);
    try {
      const res = await fetch("/api/thumbnail", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          imageDataUrl,
          option,
          category: product.category,
          keyword: cleanedKeyword,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "썸네일 생성 실패");
      setThumbnails(prev => ({ ...prev, [option]: data.imageDataUrl }));
      setMessage(`${option} AI 보정 썸네일 생성이 완료되었습니다.`);
    } catch (e) {
      setMessage(`오류: ${e instanceof Error ? e.message : "AI 보정 썸네일 생성 실패"}`);
    } finally {
      setAiThumbnailLoading("");
    }
  };

  const downloadDataUrl = (dataUrl: string, filename: string) => {
    const a = document.createElement("a");
    a.href = dataUrl;
    a.download = filename;
    a.click();
  };

  const exportPayload = () => ({
    product,
    model,
    title,
    tags,
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
      setMessage("모델명을 먼저 입력해주세요.");
      return;
    }
    try {
      const blob = await createLabelBlob(model);
      downloadBlobFile(blob, `라벨_${model}.jpg`);
    } catch (error) {
      setMessage(`오류: ${error instanceof Error ? error.message : "라벨 생성 실패"}`);
    }
  };

  const collectCurrentDbFiles = () =>
    collectProductDbFiles({
      category: product.category,
      model,
      title,
      tags,
      product,
      analysis,
      ready,
      imageDataUrl,
      thumbnails,
      detailPreview,
    });

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

      const { files, skipped } = await collectCurrentDbFiles();
      const saved = await writeProductDbFiles(
        dbHandle,
        product.category,
        model,
        files
      );
      setDbSavedFiles(saved);
      setDbSkippedFiles(skipped);
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
      const { files, skipped } = await collectCurrentDbFiles();
      const blob = await buildProductDbZip(product.category, model, files);
      downloadBlobFile(blob, `상품DB_${model}.zip`);
      setDbSavedFiles(files.map(f => `${product.category}/${model}/${f.path}`));
      setDbSkippedFiles(skipped);
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

  const options = product.colors.split(",").map(v => v.trim()).filter(Boolean);

  return (
    <main className="shell">
      <header className="hero">
        <div><p className="eyebrow">노이드비 AI</p><h1>AI 상품등록 도우미</h1>
        <p className="sub">사진 한 장으로 쿠팡 등록 준비 완료</p></div>
        <span className="pill">AI 사진분석</span>
      </header>

      <section className="card full dbSetupCard">
        <h2>저장폴더 설정</h2>
        <p className="note">G:\내 드라이브\상품DB 폴더를 선택하세요.</p>
        {dbSupported ? (
          <div className="exportActions">
            <button className="dark" onClick={pickProductDbFolder}>
              상품DB 폴더 선택
            </button>
            <button
              className="green dbSaveAllButton"
              disabled={dbSaving || !dbHandle}
              onClick={saveAllToProductDb}
            >
              {dbSaving ? "저장 중..." : "상품DB에 전체 저장"}
            </button>
          </div>
        ) : (
          <div className="exportActions">
            <button
              className="green dbSaveAllButton"
              disabled={dbSaving}
              onClick={downloadProductDbZip}
            >
              {dbSaving ? "ZIP 생성 중..." : "전체 ZIP 다운로드"}
            </button>
          </div>
        )}
        {dbSupported && dbFolderName && (
          <p className="detailMessage">저장폴더 연결 완료: {dbFolderName}</p>
        )}
        {dbStatus && (
          <p className={dbStatus.startsWith("오류") ? "error" : "detailMessage"}>
            {dbStatus}
          </p>
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
        <div className="card">
          <h2>1. 제품사진</h2>
          <label className="upload">
            <input type="file" accept="image/*" onChange={onImage}/>
            {preview ? <img src={preview} alt="제품 미리보기"/> :
              <div><strong>사진을 클릭해서 선택하세요</strong><span>JPG 또는 PNG</span></div>}
          </label>
          <button className="aiButton" onClick={analyzeImage} disabled={loading}>
            {loading ? "AI 분석 중..." : "✨ AI 사진분석"}
          </button>
          {message && <p className={message.startsWith("오류") ? "error" : "message"}>{message}</p>}
        </div>

        <div className="card">
          <h2>2. 기본정보</h2>
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
            <Field label="핵심키워드"><input
              value={product.keyword}
              onChange={e=>update("keyword",e.target.value)}
              onBlur={()=>update("keyword", normalizeKeyword(product.keyword, product))}
              placeholder="예: 굵은 하트 체인 볼드"
            /></Field>
            <Field label="원가"><input inputMode="numeric" value={product.cost} onChange={e=>update("cost",e.target.value)} placeholder="예: 1900"/></Field>
            <Field label="쿠팡 판매가"><input inputMode="numeric" value={product.price} onChange={e=>update("price",e.target.value)} placeholder="예: 14900"/></Field>
          </div>
        </div>

        <div className="card full">
          <h2>3. AI 분석 결과</h2>
          <div className="results">
            <Result label="사진 특징" value={analysis.visualFeatures?.join(", ") || "AI 사진분석 버튼을 눌러주세요."}/>
            <Result label="확인된 각인" value={analysis.engraving || "-"}/>
            <Result label="가품 위험도" value={analysis.counterfeitRisk || "-"}/>
            <Result label="검토 이유" value={analysis.counterfeitReason || "-"}/>
            <Result label="분석 신뢰도" value={analysis.confidence != null ? `${analysis.confidence}%` : "-"}/>
          </div>
        </div>

        <div className="card full">
          <h2>4. 자동생성 결과</h2>
          <div className="results">
            <Result label="모델명" value={model || "-"}/>
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
          <h2>5. 옵션별 1000×1000 썸네일</h2>
          <p className="note">
            기본 버튼은 원본사진을 그대로 흰 배경 1000×1000에 배치하므로 디자인이 변형되지 않고 API 비용도 없습니다.
            AI 보정은 꼭 필요한 경우에만 선택하세요.
          </p>
          <div className="thumbnailGrid">
            {options.map(option => (
              <div className="thumbnailCard" key={option}>
                <h3>{option}</h3>
                {thumbnails[option] ? (
                  <img src={thumbnails[option]} alt={`${option} 썸네일`} />
                ) : (
                  <div className="thumbnailEmpty">아직 생성되지 않음</div>
                )}
                <button
                  className="originalButton"
                  disabled={Boolean(thumbnailLoading) || Boolean(aiThumbnailLoading)}
                  onClick={()=>buildOriginalThumbnail(option)}
                >
                  {thumbnailLoading === option ? "생성 중..." : "원본유지 썸네일 만들기"}
                </button>
                <button
                  className="aiOptionalButton"
                  disabled={Boolean(thumbnailLoading) || Boolean(aiThumbnailLoading)}
                  onClick={()=>generateThumbnail(option)}
                >
                  {aiThumbnailLoading === option ? "AI 보정 중..." : "AI 보정"}
                </button>
                {thumbnails[option] && (
                  <button
                    className="green"
                    onClick={()=>downloadSkuThumbnails(option)}
                  >
                    SKU 파일명으로 전체 다운로드
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="card full">
          <h2>6. AI 추가각도·착용컷 생성</h2>
          <p className="note">
            정면·측면·클로즈업·착용 정면·착용 측면만 제공합니다.
            AI 결과가 실제 제품과 다르면 사용하지 말고 원본사진을 우선 사용하세요.
          </p>

          <div className="shotOptionRow">
            <label>
              <span>생성할 금속 색상</span>
              <select value={shotOption} onChange={e => setShotOption(e.target.value)}>
                {product.colors.split(",").map(v => v.trim()).filter(Boolean).map(option =>
                  <option key={option}>{option}</option>
                )}
              </select>
            </label>
          </div>

          {shotMessage && (
            <p className={shotMessage.startsWith("오류") ? "error" : "detailMessage"}>
              {shotMessage}
            </p>
          )}

          <div className="shotGrid">
            {shotTypes.map(shot => {
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
                    <>
                      <button className="secondaryButton shotAction" onClick={() => addShotToDetail(result)}>
                        상세페이지에 추가
                      </button>
                      <button
                        className="green shotAction"
                        onClick={() => downloadDataUrl(
                          result.dataUrl,
                          `${model}_${shotOption}_${shot.label}.png`
                        )}
                      >
                        이미지 다운로드
                      </button>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <div className="card full">
          <h2>7. 신상품 AI 소싱 검색</h2>
          <p className="note">
            사진에서 중국어·영어 검색어와 가격·사이즈·색상을 추출합니다.
            검색 버튼을 누르면 새 창에서 해당 쇼핑몰 결과를 바로 확인할 수 있습니다.
          </p>

          <div className="sourcingTop">
            <button
              className="sourceAnalyzeButton"
              onClick={analyzeForSourcing}
              disabled={sourcingLoading}
            >
              {sourcingLoading ? "소싱 분석 중..." : "🔎 중국 도매 소싱 분석"}
            </button>
            <button className="secondaryButton" onClick={downloadSearchImage}>
              이미지검색용 사진 다운로드
            </button>
          </div>

          {sourcingMessage && (
            <p className={sourcingMessage.startsWith("오류") ? "error" : "detailMessage"}>
              {sourcingMessage}
            </p>
          )}

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
        </div>

        <div className="card full">
          <h2>8. 가로 780px 롱 상세페이지</h2>
          <p className="note">
            제품컷과 착용컷을 원하는 순서대로 여러 장 선택하세요.
            사진 한 장당 가로 780px 전체 폭으로 배치하고, 위·아래·사진 사이에 각각 30px 흰 여백을 넣습니다.
          </p>

          <label className="multiUpload">
            <input type="file" accept="image/*" multiple onChange={onDetailImages} />
            <strong>상세페이지 사진 여러 장 선택</strong>
            <span>정면 · 측면 · 클로즈업 · 착용컷 순으로 선택하거나 아래에서 순서를 바꾸세요.</span>
          </label>

          <div className="detailActions">
            <button className="secondaryButton" onClick={addGeneratedThumbnailsToDetail}>
              생성한 옵션별 썸네일 추가
            </button>
            <button className="purpleButton" onClick={buildDetailPage}>
              780px 상세페이지 만들기
            </button>
          </div>

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
          <h2>9. 제품표시사항 라벨</h2>
          <p className="note">현재 모델명과 이번 달 제조연월이 자동으로 들어간 3:4 흰 배경 JPG입니다.</p>
          <button className="dark labelButton" onClick={downloadLabel}>제품표시사항 라벨 다운로드</button>
        </div>

        <div className="card full">
          <h2>10. 견적서 · 상품입력 자동화</h2>
          <p className="note">
            선택한 카테고리 템플릿에 상품정보·색상×사이즈 SKU·이미지 파일명을 자동 입력합니다.
            반지 예시: wr0012-GO9.jpg / wr0012.jpg / 라벨_wr0012.jpg
          </p>
          <div className="exportActions">
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

        <div className="card full">
          <h2>다음 단계</h2>
          <div className="steps"><span>완료: 상품명 정리</span><span>완료: 옵션별 썸네일</span><span>완료: 780px 상세페이지</span><span>완료: 견적서·자동화 엑셀</span></div>
        </div>
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
