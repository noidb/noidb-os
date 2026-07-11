export type ProductDbFile = {
  /** Empty string = flat file directly under model folder */
  folder: string;
  filename: string;
  blob: Blob;
  path: string;
};

export type CollectResult = {
  files: ProductDbFile[];
  skipped: string[];
  readyFiles: string[];
  missingFiles: string[];
};

export function dataUrlToBlob(dataUrl: string): Blob {
  const [meta, data] = dataUrl.split(",");
  const mime = meta.match(/data:(.*?);/)?.[1] || "application/octet-stream";
  if (meta.includes(";base64")) {
    const bin = atob(data);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: mime });
  }
  return new Blob([decodeURIComponent(data)], { type: mime });
}

export function colorCode(option: string) {
  const normalized = option.trim().toLowerCase();
  if (normalized.includes("로즈")) return "RG";
  if (normalized.includes("골드") || normalized.includes("gold")) return "GO";
  if (normalized.includes("실버") || normalized.includes("silver")) return "SI";
  if (normalized.includes("블랙") || normalized.includes("black")) return "BK";
  if (normalized.includes("화이트") || normalized.includes("white")) return "WH";
  return normalized.replace(/[^a-z0-9가-힣]/g, "").slice(0, 2).toUpperCase() || "OP";
}

export function ringSizeNumber(size: string) {
  return size.replace(/[^0-9]/g, "");
}

export function buildSkuThumbFilenames(
  model: string,
  category: string,
  option: string,
  sizesCsv: string
) {
  const code = colorCode(option);
  const sizes = sizesCsv.split(",").map(v => v.trim()).filter(Boolean);
  if (category === "반지" && sizes.length) {
    return sizes.map(size => `${model}-${code}${ringSizeNumber(size)}.jpg`);
  }
  return [`${model}-${code}.jpg`];
}

export async function createLabelBlob(model: string): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = 900;
  canvas.height = 1200;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("라벨 캔버스를 만들 수 없습니다.");

  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = "#111111";
  ctx.lineWidth = 3;
  ctx.strokeRect(35, 35, 830, 1130);

  ctx.fillStyle = "#111111";
  ctx.textAlign = "center";
  ctx.font = "bold 32px Arial, sans-serif";
  ctx.fillText("전기용품 및 생활용품 안전관리법에 의한표시", 450, 105);

  const now = new Date();
  const ym = `${now.getFullYear()}.${String(now.getMonth() + 1).padStart(2, "0")}`;
  const lines = [
    `1. 모델명 : ${model}`,
    `2. 제조연월 : ${ym}`,
    "3. 제조자명 : 프리스타일 협력사",
    "4. 수입자명 : 프리스타일",
    "5. 주소 및 전화번호 : 경기도 고양시 탄현동 1559-1 / 010-5769-5602",
    "6. 제조국명 : 중국",
    "7. 사용연령 : 14세 이상",
    "8. 주의사항 : 분실, 파손주의",
  ];

  ctx.textAlign = "left";
  ctx.font = "26px Arial, sans-serif";
  let y = 210;
  for (const line of lines) {
    // wrap long address line
    if (line.length > 42) {
      const mid = line.indexOf(" / ");
      if (mid > 0) {
        ctx.fillText(line.slice(0, mid), 70, y);
        y += 48;
        ctx.fillText(line.slice(mid + 1).trim(), 70, y);
        y += 88;
        continue;
      }
    }
    ctx.fillText(line, 70, y);
    y += 100;
  }

  const dataUrl = canvas.toDataURL("image/jpeg", 0.96);
  return dataUrlToBlob(dataUrl);
}

function pushFlat(files: ProductDbFile[], filename: string, blob: Blob) {
  files.push({
    folder: "",
    filename,
    blob,
    path: filename,
  });
}

export type CollectInput = {
  category: string;
  model: string;
  title: string;
  tags: string;
  product: Record<string, string>;
  analysis: unknown;
  ready: boolean;
  /** Multi photo data URLs in order */
  photos: string[];
  /** Legacy single photo fallback */
  imageDataUrl?: string;
  /** Approved option → dataUrl only */
  thumbnails: Record<string, string>;
  /** Extra images in order (already 1000×1000) */
  extraImages: string[];
  detailPreview: string;
  sourcingUrl?: string;
};

export async function collectProductDbFiles(
  input: CollectInput
): Promise<CollectResult> {
  const files: ProductDbFile[] = [];
  const skipped: string[] = [];
  const readyFiles: string[] = [];
  const missingFiles: string[] = [];
  const { model, category } = input;

  if (!model) {
    return {
      files: [],
      skipped: ["모델명 없음"],
      readyFiles: [],
      missingFiles: [
        "원본사진",
        "썸네일",
        "추가이미지",
        "상세페이지",
        "라벨",
        "견적서",
        "상품입력자동화",
        "상품정보",
      ],
    };
  }

  const photoUrls =
    input.photos?.filter(u => u?.startsWith("data:image/")) ??
    [];
  if (!photoUrls.length && input.imageDataUrl?.startsWith("data:image/")) {
    photoUrls.push(input.imageDataUrl);
  }

  if (photoUrls.length) {
    photoUrls.forEach((url, index) => {
      const name = `원본_${String(index + 1).padStart(2, "0")}.jpg`;
      pushFlat(files, name, dataUrlToBlob(url));
      readyFiles.push(name);
    });
  } else {
    skipped.push("원본사진 (제품사진 없음)");
    missingFiles.push("원본_01.jpg …");
  }

  const options = Object.keys(input.thumbnails);
  if (options.length) {
    for (const option of options) {
      const dataUrl = input.thumbnails[option];
      if (!dataUrl) continue;
      const blob = dataUrlToBlob(dataUrl);
      for (const filename of buildSkuThumbFilenames(
        model,
        category,
        option,
        input.product.sizes || ""
      )) {
        pushFlat(files, filename, blob);
        readyFiles.push(filename);
      }
    }
  } else {
    skipped.push("썸네일 (승인한 썸네일 없음)");
    missingFiles.push("옵션별 SKU 썸네일");
  }

  if (input.extraImages?.length) {
    input.extraImages.forEach((url, index) => {
      if (!url?.startsWith("data:image/")) return;
      const name = `${model}-${String(index + 1).padStart(2, "0")}.jpg`;
      pushFlat(files, name, dataUrlToBlob(url));
      readyFiles.push(name);
    });
  } else {
    missingFiles.push(`${model}-01.jpg (추가이미지)`);
  }

  if (input.detailPreview?.startsWith("data:image/")) {
    pushFlat(files, `${model}.jpg`, dataUrlToBlob(input.detailPreview));
    readyFiles.push(`${model}.jpg`);
  } else {
    skipped.push("상세페이지 (상세페이지 미생성)");
    missingFiles.push(`${model}.jpg`);
  }

  try {
    const labelBlob = await createLabelBlob(model);
    const labelName = `라벨_${model}.jpg`;
    pushFlat(files, labelName, labelBlob);
    readyFiles.push(labelName);
  } catch {
    skipped.push("라벨 (생성 실패)");
    missingFiles.push(`라벨_${model}.jpg`);
  }

  const payload = {
    product: input.product,
    model: input.model,
    title: input.title,
    tags: input.tags,
    additionalImages: (input.extraImages || [])
      .map((_, i) => `${model}-${String(i + 1).padStart(2, "0")}.jpg`),
  };

  const quoteCategories = ["반지", "귀걸이", "피어싱", "목걸이", "팔찌", "발찌"];
  if (quoteCategories.includes(category) && input.title) {
    try {
      const res = await fetch("/api/export-quote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "견적서 생성 실패");
      }
      const quoteName = `견적서_${model}_${category}.xlsx`;
      pushFlat(files, quoteName, await res.blob());
      readyFiles.push(quoteName);
    } catch (error) {
      skipped.push(
        `견적서 (${error instanceof Error ? error.message : "생성 실패"})`
      );
      missingFiles.push(`견적서_${model}_${category}.xlsx`);
    }
  } else {
    skipped.push("견적서 (카테고리 템플릿 없음 또는 상품명 없음)");
    missingFiles.push("견적서");
  }

  if (input.title) {
    try {
      const res = await fetch("/api/export-automation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "자동화 파일 생성 실패");
      }
      const autoName = `상품입력자동화_${model}.xlsx`;
      pushFlat(files, autoName, await res.blob());
      readyFiles.push(autoName);
    } catch (error) {
      skipped.push(
        `쿠팡등록 (${error instanceof Error ? error.message : "생성 실패"})`
      );
      missingFiles.push(`상품입력자동화_${model}.xlsx`);
    }
  } else {
    skipped.push("쿠팡등록 (상품명 없음)");
    missingFiles.push("상품입력자동화");
  }

  const info = {
    ...input.product,
    model: input.model,
    title: input.title,
    tags: input.tags,
    analysis: input.analysis,
    sourcingUrl: input.sourcingUrl || "",
    status: input.ready ? "등록가능" : "정보확인",
  };
  const infoName = `상품정보_${model}.json`;
  pushFlat(
    files,
    infoName,
    new Blob([JSON.stringify(info, null, 2)], {
      type: "application/json;charset=utf-8",
    })
  );
  readyFiles.push(infoName);

  if (input.sourcingUrl?.trim()) {
    pushFlat(
      files,
      "sourcing-url.txt",
      new Blob([input.sourcingUrl.trim()], { type: "text/plain;charset=utf-8" })
    );
    readyFiles.push("sourcing-url.txt");
  }

  return { files, skipped, readyFiles, missingFiles };
}

/** @deprecated Flat structure — no subfolders created for new saves */
export const PRODUCT_DB_SUBFOLDERS = [] as const;
