import { upload } from "@vercel/blob/client";
import type { QuickDetailSection } from "./quick-detail";
import type { QuickDetailDraft, QuickDraftResult } from "./quick-drafts";

export const QUICK_DRAFT_CLOUD_API = "/api/image-generator/quick-drafts";
export const QUICK_DRAFT_CLOUD_UPLOAD_API = `${QUICK_DRAFT_CLOUD_API}/upload`;
export const QUICK_DRAFT_CLOUD_PREFIX = "quick-detail-drafts/v1";
export const QUICK_DRAFT_CLOUD_VERSION = 1 as const;

export type CloudImageRef =
  | { kind: "empty" }
  | { kind: "url"; url: string }
  | {
      kind: "asset";
      pathname: string;
      sha256: string;
      mimeType: string;
      byteLength: number;
    };

export type CloudQuickDetailSection = Omit<QuickDetailSection, "dataUrl"> & {
  image: CloudImageRef;
};

export type CloudQuickDraftSummary = {
  id: string;
  savedAt: string;
  modelName: string;
  sourceName: string;
  originalCount: number;
  editedCount: number;
  finalCount: number;
  complete: boolean;
  previewPathname?: string;
};

export type CloudQuickDraftManifest = {
  schema: "noidb.quick-detail-draft";
  version: typeof QUICK_DRAFT_CLOUD_VERSION;
  id: string;
  savedAt: string;
  modelName: string;
  sourceName: string;
  headerName: string;
  footerName: string;
  style: QuickDetailDraft["style"];
  header: CloudImageRef;
  footer: CloudImageRef;
  originalSections: CloudQuickDetailSection[];
  editedSections: CloudQuickDetailSection[];
  finalSections: CloudQuickDetailSection[];
  sectionActions: QuickDetailDraft["sectionActions"];
  scanSummary: QuickDetailDraft["scanSummary"];
  complete: boolean;
  resultMeta: Omit<QuickDraftResult, "dataUrl"> | null;
  preview: CloudImageRef;
  summary: CloudQuickDraftSummary;
};

export type StoredCloudQuickDraftManifest = {
  version: typeof QUICK_DRAFT_CLOUD_VERSION;
  summary: CloudQuickDraftSummary;
  draft: CloudQuickDraftManifest;
  assetPathnames: string[];
};

export type CloudQuickDraftAsset = {
  pathname: string;
  sha256: string;
  mimeType: string;
  byteLength: number;
  blob: Blob;
};

export type EncodedCloudQuickDraft = {
  manifest: CloudQuickDraftManifest;
  assets: CloudQuickDraftAsset[];
};

export type QuickDraftCloudStatus = {
  configured: boolean;
  error?: string;
};

export type QuickDraftCloudListItem = CloudQuickDraftSummary & {
  location: "local" | "cloud" | "both";
  localDraft?: QuickDetailDraft;
  cloudSummary?: CloudQuickDraftSummary;
};

export type QuickDraftCloudProgress = {
  phase: "prepare" | "upload" | "save" | "hydrate";
  completed: number;
  total: number;
  pathname?: string;
};

export type QuickDraftCloudClientOptions = {
  apiUrl?: string;
  uploadUrl?: string;
  fetch?: typeof fetch;
  onProgress?: (progress: QuickDraftCloudProgress) => void;
};

export type HydrateQuickDraftOptions = QuickDraftCloudClientOptions & {
  recompose?: (headerUrl: string, sections: QuickDetailSection[], footerUrl?: string) => Promise<QuickDraftResult>;
};

export type HydratedCloudQuickDraft = QuickDetailDraft & {
  cloud: {
    complete: boolean;
    sourceOmitted: true;
  };
};

const DATA_URL_PATTERN = /^data:([^;,]+);base64,([a-zA-Z0-9+/=\r\n]+)$/;
const EMPTY_IMAGE_REF: CloudImageRef = { kind: "empty" };

function apiUrl(options?: QuickDraftCloudClientOptions) {
  return options?.apiUrl || QUICK_DRAFT_CLOUD_API;
}

function fetcher(options?: QuickDraftCloudClientOptions) {
  const selected = options?.fetch || globalThis.fetch;
  if (!selected) throw new Error("클라우드 연결 기능을 사용할 수 없는 브라우저입니다.");
  return selected;
}

function codeHeaders(code: string, json = false) {
  const headers: Record<string, string> = { "x-quick-draft-code": code };
  if (json) headers["Content-Type"] = "application/json";
  return headers;
}

function safeDraftId(value: string) {
  return value.trim().replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 100) || "draft";
}

function extensionForMime(mimeType: string) {
  if (mimeType === "image/png") return "png";
  if (mimeType === "image/webp") return "webp";
  if (mimeType === "image/gif") return "gif";
  return "jpg";
}

function bytesToBase64(bytes: Uint8Array) {
  let result = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    result += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(result);
}

function base64ToBytes(value: string) {
  const normalized = value.replace(/\s+/g, "");
  const binary = atob(normalized);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

async function sha256Hex(bytes: Uint8Array) {
  if (!globalThis.crypto?.subtle) throw new Error("이미지 중복 확인 기능을 사용할 수 없는 브라우저입니다.");
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

function parseDataUrl(dataUrl: string) {
  const match = dataUrl.match(DATA_URL_PATTERN);
  if (!match) return null;
  const mimeType = match[1].toLowerCase();
  const bytes = base64ToBytes(match[2]);
  return { mimeType, bytes };
}

async function responseError(response: Response, fallback: string) {
  const data = await response.json().catch(() => null) as { error?: string } | null;
  return new Error(data?.error || fallback);
}

async function dataUrlFromResponse(response: Response, fallbackMimeType: string) {
  const contentType = response.headers.get("content-type") || fallbackMimeType;
  if (contentType.includes("application/json")) {
    const data = await response.json() as { dataUrl?: string; url?: string; error?: string };
    if (data.dataUrl?.startsWith("data:")) return data.dataUrl;
    if (data.url) {
      const nested = await fetch(data.url);
      if (!nested.ok) throw await responseError(nested, "클라우드 이미지를 불러오지 못했습니다.");
      return dataUrlFromResponse(nested, fallbackMimeType);
    }
    throw new Error(data.error || "클라우드 이미지를 불러오지 못했습니다.");
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  const mimeType = contentType.split(";")[0] || fallbackMimeType;
  return `data:${mimeType};base64,${bytesToBase64(bytes)}`;
}

function pathnameForAsset(draftId: string, sha256: string, mimeType: string, suffix = "") {
  return `${QUICK_DRAFT_CLOUD_PREFIX}/${safeDraftId(draftId)}/assets/${sha256}${suffix}.${extensionForMime(mimeType)}`;
}

async function thumbnailDataUrl(dataUrl: string, size = 240): Promise<string | null> {
  if (typeof document === "undefined" || typeof Image === "undefined") return null;
  return new Promise(resolve => {
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = size;
      canvas.height = size;
      const context = canvas.getContext("2d");
      if (!context) return resolve(null);
      context.fillStyle = "#FFFFFF";
      context.fillRect(0, 0, size, size);
      const scale = Math.max(size / image.naturalWidth, size / image.naturalHeight);
      const width = Math.round(image.naturalWidth * scale);
      const height = Math.round(image.naturalHeight * scale);
      context.drawImage(image, Math.round((size - width) / 2), Math.round((size - height) / 2), width, height);
      resolve(canvas.toDataURL("image/jpeg", 0.76));
    };
    image.onerror = () => resolve(null);
    image.src = dataUrl;
  });
}

export async function encodeQuickDraftForCloud(draft: QuickDetailDraft): Promise<EncodedCloudQuickDraft> {
  const assets = new Map<string, CloudQuickDraftAsset>();

  const encodeImage = async (value: string, suffix = ""): Promise<CloudImageRef> => {
    if (!value) return EMPTY_IMAGE_REF;
    const parsed = parseDataUrl(value);
    if (!parsed) return { kind: "url", url: value };
    const sha256 = await sha256Hex(parsed.bytes);
    const pathname = pathnameForAsset(draft.id, sha256, parsed.mimeType, suffix);
    if (!assets.has(pathname)) {
      assets.set(pathname, {
        pathname,
        sha256,
        mimeType: parsed.mimeType,
        byteLength: parsed.bytes.byteLength,
        blob: new Blob([parsed.bytes], { type: parsed.mimeType }),
      });
    }
    return { kind: "asset", pathname, sha256, mimeType: parsed.mimeType, byteLength: parsed.bytes.byteLength };
  };

  const encodeSections = async (sections: QuickDetailSection[]) => Promise.all(sections.map(async section => {
    const { dataUrl, ...metadata } = section;
    return { ...metadata, image: await encodeImage(dataUrl) };
  }));

  const header = await encodeImage(draft.headerUrl);
  const footer = await encodeImage(draft.footerUrl);
  const originalSections = await encodeSections(draft.originalSections);
  const editedSections = await encodeSections(draft.editedSections);
  const finalSections = await encodeSections(draft.finalSections);

  const previewSource = draft.preview || draft.editedSections[0]?.dataUrl || draft.originalSections[0]?.dataUrl || draft.finalSections[0]?.dataUrl || "";
  const derivedThumbnail = parseDataUrl(previewSource) ? await thumbnailDataUrl(previewSource) : null;
  const preview = derivedThumbnail ? await encodeImage(derivedThumbnail, "-preview") :
    editedSections[0]?.image || originalSections[0]?.image || finalSections[0]?.image || EMPTY_IMAGE_REF;

  const summary: CloudQuickDraftSummary = {
    id: draft.id,
    savedAt: draft.savedAt,
    modelName: draft.modelName,
    sourceName: draft.sourceName,
    originalCount: originalSections.length,
    editedCount: editedSections.length,
    finalCount: finalSections.length,
    complete: Boolean(draft.result && finalSections.length),
    ...(preview.kind === "asset" ? { previewPathname: preview.pathname } : {}),
  };

  const manifest: CloudQuickDraftManifest = {
    schema: "noidb.quick-detail-draft",
    version: QUICK_DRAFT_CLOUD_VERSION,
    id: draft.id,
    savedAt: draft.savedAt,
    modelName: draft.modelName,
    sourceName: draft.sourceName,
    headerName: draft.headerName,
    footerName: draft.footerName,
    style: draft.style,
    header,
    footer,
    originalSections,
    editedSections,
    finalSections,
    sectionActions: draft.sectionActions,
    scanSummary: draft.scanSummary,
    complete: summary.complete,
    resultMeta: draft.result ? {
      sectionCount: draft.result.sectionCount,
      width: draft.result.width,
      height: draft.result.height,
    } : null,
    preview,
    summary,
  };

  return { manifest, assets: [...assets.values()] };
}

function validateManifest(value: unknown): CloudQuickDraftManifest {
  const record = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
  const candidate = record?.draft && typeof record.draft === "object" ? record.draft : value;
  const manifest = candidate as Partial<CloudQuickDraftManifest> | null;
  if (!manifest || manifest.schema !== "noidb.quick-detail-draft" || manifest.version !== QUICK_DRAFT_CLOUD_VERSION || !manifest.id) {
    throw new Error("지원하지 않는 클라우드 임시저장 형식입니다.");
  }
  return manifest as CloudQuickDraftManifest;
}

async function resolveImageRef(ref: CloudImageRef, code: string, options: QuickDraftCloudClientOptions, cache: Map<string, string>) {
  if (ref.kind === "empty") return "";
  if (ref.kind === "url") return ref.url;
  const cached = cache.get(ref.pathname);
  if (cached) return cached;
  const draftId = ref.pathname.startsWith(`${QUICK_DRAFT_CLOUD_PREFIX}/`)
    ? ref.pathname.slice(QUICK_DRAFT_CLOUD_PREFIX.length + 1).split("/")[0]
    : "";
  const url = `${apiUrl(options)}?action=asset&id=${encodeURIComponent(draftId)}&path=${encodeURIComponent(ref.pathname)}`;
  const response = await fetcher(options)(url, { headers: codeHeaders(code) });
  if (!response.ok) throw await responseError(response, "클라우드 이미지를 불러오지 못했습니다.");
  const dataUrl = await dataUrlFromResponse(response, ref.mimeType);
  cache.set(ref.pathname, dataUrl);
  return dataUrl;
}

export async function hydrateQuickDraftManifest(manifestValue: CloudQuickDraftManifest, code: string, options: HydrateQuickDraftOptions = {}): Promise<HydratedCloudQuickDraft> {
  const manifest = validateManifest(manifestValue);
  const cache = new Map<string, string>();
  const assetRefs = [manifest.header, manifest.footer, manifest.preview,
    ...manifest.originalSections.map(section => section.image),
    ...manifest.editedSections.map(section => section.image),
    ...manifest.finalSections.map(section => section.image),
  ].filter(ref => ref.kind === "asset");
  const uniqueAssets = new Set(assetRefs.map(ref => ref.kind === "asset" ? ref.pathname : ""));
  let hydratedCount = 0;
  const resolve = async (ref: CloudImageRef) => {
    const hadAsset = ref.kind === "asset" && cache.has(ref.pathname);
    const value = await resolveImageRef(ref, code, options, cache);
    if (ref.kind === "asset" && !hadAsset) {
      hydratedCount += 1;
      options.onProgress?.({ phase: "hydrate", completed: hydratedCount, total: uniqueAssets.size, pathname: ref.pathname });
    }
    return value;
  };
  const hydrateSections = (sections: CloudQuickDetailSection[]) => Promise.all(sections.map(async section => {
    const { image, ...metadata } = section;
    return { ...metadata, dataUrl: await resolve(image) };
  }));

  const [headerUrl, footerUrl, preview, originalSections, editedSections, finalSections] = await Promise.all([
    resolve(manifest.header),
    resolve(manifest.footer),
    resolve(manifest.preview),
    hydrateSections(manifest.originalSections),
    hydrateSections(manifest.editedSections),
    hydrateSections(manifest.finalSections),
  ]);
  let result: QuickDraftResult | null = null;
  if (manifest.complete && finalSections.length && options.recompose) {
    result = await options.recompose(headerUrl, finalSections, footerUrl || undefined);
  }
  return {
    id: manifest.id,
    savedAt: manifest.savedAt,
    modelName: manifest.modelName,
    source: "",
    sourceName: manifest.sourceName,
    headerUrl,
    headerName: manifest.headerName,
    footerUrl,
    footerName: manifest.footerName,
    style: manifest.style,
    originalSections,
    editedSections,
    finalSections,
    sectionActions: manifest.sectionActions,
    result,
    scanSummary: manifest.scanSummary,
    preview: preview || editedSections[0]?.dataUrl || originalSections[0]?.dataUrl || finalSections[0]?.dataUrl || "",
    cloud: { complete: manifest.complete, sourceOmitted: true },
  };
}

export async function getQuickDraftCloudStatus(code: string, options: QuickDraftCloudClientOptions = {}): Promise<QuickDraftCloudStatus> {
  try {
    const response = await fetcher(options)(`${apiUrl(options)}?action=status`, { headers: codeHeaders(code) });
    const data = await response.json().catch(() => ({})) as QuickDraftCloudStatus;
    if (!response.ok) return { configured: false, error: data.error || "클라우드 연결 상태를 확인하지 못했습니다." };
    return { configured: Boolean(data.configured), ...(data.error ? { error: data.error } : {}) };
  } catch (error) {
    return { configured: false, error: error instanceof Error ? error.message : "클라우드에 연결하지 못했습니다." };
  }
}

export async function listCloudQuickDrafts(code: string, options: QuickDraftCloudClientOptions = {}) {
  const response = await fetcher(options)(`${apiUrl(options)}?action=list`, { headers: codeHeaders(code) });
  if (!response.ok) throw await responseError(response, "클라우드 임시저장 목록을 불러오지 못했습니다.");
  const data = await response.json() as { configured?: boolean; drafts?: CloudQuickDraftSummary[] };
  return (data.drafts || []).sort((a, b) => b.savedAt.localeCompare(a.savedAt));
}

export async function getCloudQuickDraftManifest(id: string, code: string, options: QuickDraftCloudClientOptions = {}) {
  const response = await fetcher(options)(`${apiUrl(options)}?action=get&id=${encodeURIComponent(id)}`, { headers: codeHeaders(code) });
  if (!response.ok) throw await responseError(response, "클라우드 임시저장을 불러오지 못했습니다.");
  const data = await response.json() as { manifest?: CloudQuickDraftManifest };
  return validateManifest(data.manifest);
}

export async function loadCloudQuickDraftPreview(summary: CloudQuickDraftSummary, code: string, options: QuickDraftCloudClientOptions = {}) {
  if (!summary.previewPathname) return "";
  const ref: CloudImageRef = {
    kind: "asset",
    pathname: summary.previewPathname,
    sha256: "",
    mimeType: "image/jpeg",
    byteLength: 0,
  };
  return resolveImageRef(ref, code, options, new Map());
}

export async function hydrateCloudQuickDraft(id: string, code: string, options: HydrateQuickDraftOptions = {}) {
  const manifest = await getCloudQuickDraftManifest(id, code, options);
  return hydrateQuickDraftManifest(manifest, code, options);
}

export async function saveCloudQuickDraft(draft: QuickDetailDraft, code: string, options: QuickDraftCloudClientOptions = {}) {
  const encoded = await encodeQuickDraftForCloud(draft);
  const total = encoded.assets.length;
  options.onProgress?.({ phase: "prepare", completed: 0, total });
  const prepareResponse = await fetcher(options)(apiUrl(options), {
    method: "POST",
    headers: codeHeaders(code, true),
    body: JSON.stringify({ action: "prepare", id: draft.id, assetPathnames: encoded.assets.map(asset => asset.pathname) }),
  });
  if (!prepareResponse.ok) throw await responseError(prepareResponse, "클라우드 저장을 준비하지 못했습니다.");
  const prepared = await prepareResponse.json() as { missingPathnames?: string[] };
  const missing = new Set(prepared.missingPathnames || []);
  let completed = total - missing.size;
  options.onProgress?.({ phase: "upload", completed, total });
  for (const asset of encoded.assets) {
    if (!missing.has(asset.pathname)) continue;
    await upload(asset.pathname, asset.blob, {
      access: "private",
      handleUploadUrl: options.uploadUrl || QUICK_DRAFT_CLOUD_UPLOAD_API,
      clientPayload: JSON.stringify({ code, draftId: draft.id }),
      headers: codeHeaders(code),
      contentType: asset.mimeType,
      multipart: asset.byteLength > 4_000_000,
    });
    completed += 1;
    options.onProgress?.({ phase: "upload", completed, total, pathname: asset.pathname });
  }
  options.onProgress?.({ phase: "save", completed: total, total });
  const saveResponse = await fetcher(options)(apiUrl(options), {
    method: "POST",
    headers: codeHeaders(code, true),
    body: JSON.stringify({
      action: "save",
      id: draft.id,
      manifest: {
        version: QUICK_DRAFT_CLOUD_VERSION,
        summary: encoded.manifest.summary,
        draft: encoded.manifest,
        assetPathnames: encoded.assets.map(asset => asset.pathname),
      } satisfies StoredCloudQuickDraftManifest,
    }),
  });
  if (!saveResponse.ok) throw await responseError(saveResponse, "클라우드 임시저장을 마무리하지 못했습니다.");
  const saved = await saveResponse.json().catch(() => ({})) as { saved?: boolean; error?: string };
  if (saved.saved === false) throw new Error(saved.error || "클라우드 임시저장을 마무리하지 못했습니다.");
  return encoded.manifest.summary;
}

export async function deleteCloudQuickDraft(id: string, code: string, options: QuickDraftCloudClientOptions = {}) {
  const response = await fetcher(options)(`${apiUrl(options)}?id=${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: codeHeaders(code),
  });
  if (!response.ok) throw await responseError(response, "클라우드 임시저장을 삭제하지 못했습니다.");
}

function localSummary(draft: QuickDetailDraft): CloudQuickDraftSummary {
  return {
    id: draft.id,
    savedAt: draft.savedAt,
    modelName: draft.modelName,
    sourceName: draft.sourceName,
    originalCount: draft.originalSections.length,
    editedCount: draft.editedSections.length,
    finalCount: draft.finalSections.length,
    complete: Boolean(draft.result && draft.finalSections.length),
  };
}

export function mergeCloudSummaries(localDrafts: QuickDetailDraft[], cloudDrafts: CloudQuickDraftSummary[], limit = 10): QuickDraftCloudListItem[] {
  const merged = new Map<string, QuickDraftCloudListItem>();
  for (const cloud of cloudDrafts) {
    merged.set(cloud.id, { ...cloud, location: "cloud", cloudSummary: cloud });
  }
  for (const local of localDrafts) {
    const summary = localSummary(local);
    const existing = merged.get(local.id);
    if (!existing) {
      merged.set(local.id, { ...summary, location: "local", localDraft: local });
      continue;
    }
    const localIsNewer = summary.savedAt >= existing.savedAt;
    merged.set(local.id, {
      ...(localIsNewer ? summary : existing),
      location: "both",
      localDraft: local,
      cloudSummary: existing.cloudSummary,
    });
  }
  return [...merged.values()].sort((a, b) => b.savedAt.localeCompare(a.savedAt)).slice(0, Math.max(0, limit));
}
