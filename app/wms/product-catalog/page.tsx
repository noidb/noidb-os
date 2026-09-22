"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { wmsColors } from "@/lib/wms/ui-tokens";
import { getWmsDisplayImageUrl } from "@/lib/wms/image-display-url";
import { resolveDisplayNameAndOption } from "@/lib/wms/display-name";
import type { ProductCatalogItem } from "@/lib/wms/product-catalog";
import { clearPhotoSearch, connectPhotoFolder, FOLDER_TIER_LABELS, loadPhotoSearch, loadSavedThumbnail, saveThumbnail, openPhotoFolders, openSavedPhotos, photoFolderName, photoFolderReady, savePhotoSearch, searchPhotoFolder, savePreparedPhotos, type FolderTier, type LocalPhoto } from "@/lib/image-search/browser-folder";
import type { WimsRegistrationRow, WimsRegistrationSnapshot } from "@/lib/wms/wims-registration";

type PhotoHit = LocalPhoto & { fileName: string; preview: string; selected: boolean };
/**
 * analysisId: AI 분석용으로 지정한 사진 1장(선택한 사진 중 하나). source: 사진을 어디서 가져왔는지.
 * level: 어디까지 열었는지 — 1~3 = 연결표 폴더 단계(FolderTier), 4 = 사진 폴더 전체 검색.
 * grouped: 확정 폴더가 여러 모델 묶음 폴더인지(아니면 2·3차가 없다). hasFolders: 연결표 확정 폴더가 있는지.
 */
type PhotoState = { loading: boolean; hits: PhotoHit[]; analysisId: string; level: number; grouped: boolean; hasFolders: boolean; source?: string; error?: string; note?: string };
type LinkTableResult = { folders: string[]; modelKeys: string[] };
const FULL_SEARCH_LEVEL = 4;
const THUMBNAIL_PAGE = 60;
const LEVEL_NAMES: Record<number, string> = { 2: "2차", 3: "3차", 4: "4차" };
const LEVEL_BUTTON_LABELS: Record<number, string> = {
  2: "2차: 같은 폴더의 착용컷·공용 사진 더 보기",
  3: "3차: 같은 폴더의 다른 모델 폴더 더 보기 (섞여 있을 수 있음 · 30초 이상 걸릴 수 있음)",
  4: "4차: 사진 폴더 전체에서 검색 (오래 걸림)",
};

/** 다음에 열 단계. 없으면 0. 묶음 폴더가 아니면 1차 다음이 바로 전체 검색이다. */
function nextPhotoLevel(state: PhotoState): number {
  if (!state.hasFolders || state.level >= FULL_SEARCH_LEVEL) return 0;
  if (state.level === 1 && !state.grouped) return FULL_SEARCH_LEVEL;
  return state.level + 1;
}
const SNAPSHOT_KEY = "noidb_wims_registration_snapshot_v1";
const REREGISTRATION_PREP_KEY = "noidb_reregistration_prep_v1";
const VIEW_KEY = "noidb_product_catalog_view_v1";

function readSnapshot(): WimsRegistrationSnapshot | null {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(SNAPSHOT_KEY) || "null");
    const snapshot = parsed?.snapshot ?? parsed;
    if (!snapshot || !Array.isArray(snapshot.rows)) return null;
    return snapshot as WimsRegistrationSnapshot;
  } catch {
    return null;
  }
}

function clean(value: string): string {
  return String(value || "").trim().toLowerCase();
}

function namedModelGroupKey(item: ProductCatalogItem): string | null {
  const modelName = clean(item.modelName);
  return modelName || null;
}

/** 제품DB '재등록구분' 열(연결표 v8 병합, 2026-09-22) 기준 판단. 이 열이 재등록 목록의 유일한 기준이다. */
function reregistrationTierOf(item: ProductCatalogItem): string {
  return String(item.reregistrationTier || "").trim();
}

function isPermanentlyExcluded(item: ProductCatalogItem): boolean {
  return reregistrationTierOf(item).startsWith("영구제외");
}

function isReregistrationTier(item: ProductCatalogItem): boolean {
  const tier = reregistrationTierOf(item);
  return tier.startsWith("1차") || tier.startsWith("2차");
}

function isRocketRegistered(item: ProductCatalogItem): boolean {
  return /^R/i.test(String(item.barcode || "").trim());
}

function externalUrl(value: string): string {
  const trimmed = String(value || "").trim();
  return /^https?:\/\//i.test(trimmed) ? trimmed : "";
}

function findWimsRow(item: ProductCatalogItem, rows: WimsRegistrationRow[]): WimsRegistrationRow | null {
  const skuId = clean(item.skuId);
  const modelSku = clean(item.modelSku);
  const matches = skuId
    ? rows.filter(row => clean(row.skuId) === skuId && (!row.modelSku || clean(row.modelSku) === modelSku))
    : rows.filter(row => modelSku && clean(row.modelSku) === modelSku);
  return matches.length === 1 ? matches[0] : null;
}

export default function ProductCatalogPage() {
  const router = useRouter();
  const [folderName, setFolderName] = useState("");
  const [folderMessage, setFolderMessage] = useState("");
  const [preparing, setPreparing] = useState("");
  const photoUrls = useRef<string[]>([]);
  useEffect(() => {
    void photoFolderName().then(setFolderName).catch(() => {});
    return () => { photoUrls.current.forEach(url => URL.revokeObjectURL(url)); };
  }, []);
  const [items, setItems] = useState<ProductCatalogItem[]>([]);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [snapshot, setSnapshot] = useState<WimsRegistrationSnapshot | null>(null);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [photoStates, setPhotoStates] = useState<Record<string, PhotoState>>({});
  const photoStatesRef = useRef(photoStates);
  photoStatesRef.current = photoStates;
  /** 새로고침 뒤 폴더 권한이 아직 없을 때 "저장된 결과가 있다"는 안내용 (모델명 → 선택 사진 수). */
  const [savedHints, setSavedHints] = useState<Record<string, number>>({});
  const [viewer, setViewer] = useState<{ model: string; index: number } | null>(null);
  /** 모델별로 화면에 그리는 사진 수. 큰 원본 사진을 한 번에 수백 장 그리면 느려서 60장씩 늘린다. */
  const [shownCounts, setShownCounts] = useState<Record<string, number>>({});
  const savedSearchJson = useRef<Record<string, string>>({});

  // 재등록 대상·영구제외는 모델 단위로 판단한다: 옵션 하나라도 1차·2차면 모델 전체 대상,
  // 옵션 하나라도 영구제외(가품·금은시세)면 그 모델은 항상 제외한다(영구제외가 우선).
  const { reregisterModelKeys, excludedModelKeys } = useMemo(() => {
    const target = new Set<string>();
    const excluded = new Set<string>();
    for (const item of items) {
      const key = namedModelGroupKey(item);
      if (!key) continue;
      if (isReregistrationTier(item)) target.add(key);
      if (isPermanentlyExcluded(item)) excluded.add(key);
    }
    return { reregisterModelKeys: target, excludedModelKeys: excluded };
  }, [items]);

  const isReregistrationTarget = useCallback((item: ProductCatalogItem) => {
    const key = namedModelGroupKey(item);
    if (key && excludedModelKeys.has(key)) return false;
    return key ? reregisterModelKeys.has(key) : isReregistrationTier(item);
  }, [reregisterModelKeys, excludedModelKeys]);

  const loadCatalog = useCallback(async (activeRef?: { current: boolean }) => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/wms/product-registration-catalog", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || "상품 연결 대장을 읽지 못했습니다.");
      if (!activeRef || activeRef.current) {
        setItems(Array.isArray(data.items) ? data.items : []);
        setConfigured(Boolean(data.configured));
        setSnapshot(readSnapshot());
      }
    } catch (cause) {
      if (!activeRef || activeRef.current) setError(cause instanceof Error ? cause.message : "상품 연결 대장을 읽지 못했습니다.");
    } finally {
      if (!activeRef || activeRef.current) setLoading(false);
    }
  }, []);

  // 등록도우미에서 돌아오거나(?status=reregister&model=…) 뒤로 가기로 와도 보던 상태·검색어를 되살린다.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    let saved: { status?: string; query?: string } = {};
    try { saved = JSON.parse(window.sessionStorage.getItem(VIEW_KEY) || "{}"); } catch {}
    const model = params.get("model")?.trim();
    const nextStatus = params.get("status") || saved.status;
    if (nextStatus) setStatus(nextStatus);
    if (model) setQuery(model);
    else if (saved.query) setQuery(saved.query);
  }, []);
  useEffect(() => {
    try { window.sessionStorage.setItem(VIEW_KEY, JSON.stringify({ status, query })); } catch {}
  }, [status, query]);

  useEffect(() => {
    const active = { current: true };
    void loadCatalog(active);
    return () => { active.current = false; };
  }, [loadCatalog]);

  useEffect(() => {
    let lastRefresh = 0;
    const refreshCatalog = () => {
      // 탭을 오갈 때마다 Sheets를 읽지 않고, 20초 이상 지난 경우에만 다시 읽는다.
      if (Date.now() - lastRefresh < 20_000) return;
      lastRefresh = Date.now();
      void loadCatalog();
    };
    const refreshSnapshot = () => setSnapshot(readSnapshot());
    window.addEventListener("focus", refreshCatalog);
    window.addEventListener("focus", refreshSnapshot);
    window.addEventListener("storage", refreshSnapshot);
    return () => {
      window.removeEventListener("focus", refreshCatalog);
      window.removeEventListener("focus", refreshSnapshot);
      window.removeEventListener("storage", refreshSnapshot);
    };
  }, [loadCatalog]);

  const filteredItems = useMemo(() => {
    const needle = clean(query);
    return items.filter(item => {
      const wims = snapshot ? findWimsRow(item, snapshot.rows) : null;
      const searchable = [item.modelName, item.modelSku, item.skuId, item.barcode, item.productName, item.optionLabel].map(clean).join(" ");
      const matchesQuery = !needle || searchable.includes(needle);
      const reregistration = isReregistrationTarget(item);
      const rocketPending = !isRocketRegistered(item);
      const matchesStatus = status === "all"
        || (status === "pending" && !item.skuId)
        || (status === "issued" && Boolean(item.skuId))
        || (status === "wims" && Boolean(wims))
        || (status === "reregister" && reregistration)
        || (status === "rocket-pending" && rocketPending);
      return matchesQuery && matchesStatus;
    }).sort((a, b) => (Number(b.cumulativeInbound) || 0) - (Number(a.cumulativeInbound) || 0)
      || Number(isReregistrationTarget(b)) - Number(isReregistrationTarget(a)));
  }, [items, query, snapshot, status, isReregistrationTarget]);

  const rejectedRows = useMemo(() => {
    const needle = clean(query);
    return (snapshot?.rows || []).filter(row => row.status === "rejected" && (!needle || [row.productName, row.modelSku].map(clean).join(" ").includes(needle)));
  }, [snapshot, query]);

  const summary = useMemo(() => ({
    total: items.length,
    issued: items.filter(item => item.skuId).length,
    pending: items.filter(item => !item.skuId).length,
    models: new Set(items.map(item => item.modelName).filter(Boolean)).size,
    reregisterModels: [...reregisterModelKeys].filter(key => !excludedModelKeys.has(key)).length,
    reregisterCandidates: items.filter(item => isReregistrationTarget(item)).length,
    rocketPending: items.filter(item => !isRocketRegistered(item)).length,
  }), [items, isReregistrationTarget, reregisterModelKeys, excludedModelKeys]);

  const reregistrationGroups = useMemo(() => {
    if (status !== "reregister") return [];
    const matchedKeys = new Set<string>();
    for (const item of filteredItems) {
      const key = namedModelGroupKey(item);
      if (key) matchedKeys.add(key);
    }
    return [...matchedKeys].map(key => {
      const groupItems = items.filter(item => namedModelGroupKey(item) === key);
      const representative = groupItems[0];
      return {
        key,
        modelName: representative?.modelName || "모델명 없음",
        productName: representative ? resolveDisplayNameAndOption(representative.productName || "", representative.optionLabel).name : "상품명 없음",
        items: groupItems,
      };
    });
  }, [filteredItems, items, status]);

  function toHits(found: LocalPhoto[], selectedIds: Set<string>): PhotoHit[] {
    return found.map(hit => {
      const preview = URL.createObjectURL(hit.file);
      photoUrls.current.push(preview);
      return { ...hit, fileName: hit.name, preview, selected: selectedIds.has(hit.id) };
    });
  }

  // 저장해 둔 검색 결과(경로·선택·분석용·단계)를 검색 없이 다시 연다. 파일이 모두 사라졌으면 null.
  const restoreSavedSearch = useCallback(async (model: string): Promise<PhotoState | null> => {
    const saved = await loadPhotoSearch(model);
    if (!saved?.hits.length) return null;
    // 빠르게 되살리려고 1차 사진과 고른 사진만 다시 연다. 2·3·4차는 필요하면 버튼으로 다시 연다.
    const firstTier = FOLDER_TIER_LABELS[1];
    const picked = new Set(saved.selectedIds);
    const quick = saved.hasFolders === false ? saved.hits : saved.hits.filter(hit => hit.matchedBy.includes(firstTier) || picked.has(hit.id));
    const found = await openSavedPhotos(quick.length ? quick : saved.hits.slice(0, 60));
    if (!found.length) return null;
    const selectedIds = new Set(saved.selectedIds.slice(0, 10));
    return {
      loading: false,
      hits: toHits(found, selectedIds),
      analysisId: selectedIds.has(saved.analysisId) && found.some(hit => hit.id === saved.analysisId) ? saved.analysisId : "",
      level: saved.hasFolders === false ? (saved.level ?? FULL_SEARCH_LEVEL) : 1,
      grouped: saved.grouped ?? true,
      hasFolders: saved.hasFolders ?? true,
      source: "저장된 검색 결과",
    };
  }, []);

  // 검색 결과·선택이 바뀔 때마다 이 브라우저에 경로만 저장 → 새로고침·화면 이동 후에도 다시 검색하지 않는다.
  useEffect(() => {
    for (const [model, state] of Object.entries(photoStates)) {
      if (state.loading || !state.hits.length) continue;
      const saved = { hits: state.hits.map(hit => ({ id: hit.id, matchedBy: hit.matchedBy })), selectedIds: state.hits.filter(hit => hit.selected).map(hit => hit.id), analysisId: state.analysisId, level: state.level, grouped: state.grouped, hasFolders: state.hasFolders };
      const json = JSON.stringify(saved);
      if (savedSearchJson.current[model] === json) continue;
      savedSearchJson.current[model] = json;
      void savePhotoSearch(model, { ...saved, savedAt: new Date().toISOString() }).catch(() => {});
    }
  }, [photoStates]);

  // 재등록 묶음을 열면 저장된 결과를 자동으로 되살린다. 폴더 권한은 클릭 없이 요청할 수 없으므로,
  // 권한이 아직 없으면 안내만 표시하고 "이 모델 사진 검색"을 누를 때 검색 없이 불러온다.
  useEffect(() => {
    if (status !== "reregister" || !reregistrationGroups.length) return;
    // 사진이 커서(1장 약 8MB) 여러 모델을 한꺼번에 되살리면 화면이 느려진다 — 3개 모델 이하일 때만 자동으로 연다.
    const autoOpen = reregistrationGroups.length <= 3;
    let active = true;
    void (async () => {
      const ready = await photoFolderReady().catch(() => false);
      for (const group of reregistrationGroups) {
        if (!active) return;
        const model = group.modelName;
        if (photoStatesRef.current[model]) continue;
        if (!ready || !autoOpen) {
          const saved = await loadPhotoSearch(model).catch(() => undefined);
          if (active && saved?.hits.length) setSavedHints(current => ({ ...current, [model]: saved.selectedIds.length }));
          continue;
        }
        const restored = await restoreSavedSearch(model).catch(() => null);
        if (active && restored) setPhotoStates(current => current[model] ? current : { ...current, [model]: restored });
      }
    })();
    return () => { active = false; };
  }, [status, reregistrationGroups, restoreSavedSearch]);

  /**
   * 사진 폴더 정보는 이제 제품DB '사진폴더(확정)' 열(연결표 v8 병합, 2026-09-22)에서 바로 읽는다.
   * 제품DB를 새로고침할 때 이미 받아 둔 relatedItems에서 뽑으므로 별도 요청이 필요 없다.
   */
  function fetchLinkTable(modelName: string, relatedItems: ProductCatalogItem[]): LinkTableResult {
    const folders = [...new Set(relatedItems.flatMap(related =>
      String(related.photoFolder || "").split(/\r?\n/).map(path => path.trim()).filter(Boolean)))];
    // 확정 폴더가 여러 모델을 담은 묶음 폴더일 때 하위 폴더를 좁히는 데 쓴다.
    // 모델SKU의 모델번호 부분(예: we011623-1의 모델SKU we011623RG → we011623)만 쓴다.
    const modelKeys = [...new Set([
      modelName,
      ...relatedItems.map(related => clean(related.modelSku).match(/^[a-z]{2,3}\d+/i)?.[0] || "").filter(Boolean),
    ])];
    return { folders, modelKeys };
  }

  // 한 단계의 사진을 읽는다. 1~3차 = 연결표 폴더, 4차 = 사진 폴더 전체 검색(모델명·SKU ID).
  async function loadPhotoLevel(level: number, modelName: string, relatedItems: ProductCatalogItem[], link: LinkTableResult, existing: LocalPhoto[]) {
    if (level < FULL_SEARCH_LEVEL) return openPhotoFolders(link.folders, link.modelKeys, level as FolderTier, existing);
    const relatedModelSkus = new Set(relatedItems.map(related => clean(related.modelSku)).filter(Boolean));
    const historicalSkuIds = (snapshot?.rows || []).filter(row => relatedModelSkus.has(clean(row.modelSku))).map(row => row.skuId);
    const photos = await searchPhotoFolder([modelName, ...relatedItems.map(related => related.skuId), ...historicalSkuIds], existing);
    return { photos, grouped: false };
  }

  function levelSource(level: number, hasFolders: boolean) {
    if (level >= FULL_SEARCH_LEVEL) return hasFolders ? "4차 · 사진 폴더 전체 검색까지" : "사진 폴더 전체 검색 (연결표 확정 폴더 없음)";
    return `${FOLDER_TIER_LABELS[level as FolderTier]}까지`;
  }

  /**
   * 사진을 읽는다. 연결표 폴더가 있으면 1차(확정 폴더)만 읽고, 2·3·4차는 사용자가 버튼을 눌러야 연다.
   * target(다시 검색 때 이전 단계)이 2 이상이면 그 단계까지만 차례로 읽는다. 연결표 폴더가 없으면 전체 검색.
   */
  async function loadPhotoLevels(target: number, modelName: string, relatedItems: ProductCatalogItem[], link: LinkTableResult) {
    const hasFolders = link.folders.length > 0;
    let found: LocalPhoto[] = [];
    let grouped = false;
    let level = hasFolders ? 1 : FULL_SEARCH_LEVEL;
    while (true) {
      const result = await loadPhotoLevel(level, modelName, relatedItems, link, found);
      if (level === 1) grouped = result.grouped;
      found = [...found, ...result.photos];
      const next = level === 1 && !grouped ? FULL_SEARCH_LEVEL : level + 1;
      if (level >= target || next >= FULL_SEARCH_LEVEL) break;
      level = next;
    }
    return { found, grouped, level, hasFolders };
  }

  /**
   * 사진 검색. 저장된 결과가 있으면 그대로 되살리고, 없으면 연결표 1차 확정 폴더만 연다.
   * fresh(다시 검색)는 1차부터 새로 읽는다. 이미 고른 사진은 1차에 없어도 맨 뒤에 남겨 선택·분석용을 유지한다.
   */
  async function searchPhotos(item: ProductCatalogItem, relatedItems: ProductCatalogItem[] = [item], fresh = false) {
    // 사진 폴더는 모델 단위이므로 같은 모델의 옵션들이 검색 결과를 공유한다.
    const key = item.modelName || item.modelSku || item.productName;
    if (!key || photoStates[key]?.loading) return;
    const previous = photoStates[key];
    setPhotoStates(current => ({ ...current, [key]: { ...(current[key] || { hits: [], analysisId: "", level: 1, grouped: false, hasFolders: false }), loading: true, error: undefined, note: undefined } }));
    try {
      const modelName = item.modelName.trim();
      if (!modelName) throw new Error("모델명이 없어 사진 검색을 진행할 수 없습니다. 모델명과 SKU 식별정보를 먼저 확인해주세요.");
      if (!fresh) {
        const restored = await restoreSavedSearch(modelName).catch(() => null);
        if (restored) { setPhotoStates(current => ({ ...current, [key]: restored })); return; }
      }
      const link = fetchLinkTable(modelName, relatedItems);
      const { found, grouped, level, hasFolders } = await loadPhotoLevels(1, modelName, relatedItems, link);
      const keepSelected = new Set((previous?.hits || []).filter(hit => hit.selected).map(hit => hit.id));
      const foundIds = new Set(found.map(hit => hit.id));
      const keptSelected = (previous?.hits || []).filter(hit => hit.selected && !foundIds.has(hit.id));
      const hits = [...toHits(found, keepSelected), ...keptSelected];
      const analysisId = hits.some(hit => hit.selected && hit.id === previous?.analysisId) ? previous!.analysisId : "";
      const note = hasFolders && !found.length ? "1차 확정 폴더에서 사진을 찾지 못했습니다. 아래 버튼으로 범위를 넓혀 주세요." : undefined;
      setPhotoStates(current => ({ ...current, [key]: { loading: false, hits, analysisId, level, grouped, hasFolders, source: levelSource(level, hasFolders), note } }));
    } catch (cause) {
      setPhotoStates(current => ({ ...current, [key]: { loading: false, hits: [], analysisId: "", level: 1, grouped: false, hasFolders: false, error: cause instanceof Error ? cause.message : "사진 후보를 찾지 못했습니다." } }));
    }
  }

  // "더 보기": 다음 단계 사진을 뒤에 붙인다. 이미 고른 사진·분석용은 그대로 둔다.
  async function expandPhotos(item: ProductCatalogItem, relatedItems: ProductCatalogItem[]) {
    const key = item.modelName;
    const state = photoStates[key];
    const level = state ? nextPhotoLevel(state) : 0;
    if (!state || !level || state.loading) return;
    setPhotoStates(current => ({ ...current, [key]: { ...current[key], loading: true, error: undefined, note: undefined } }));
    try {
      const link = fetchLinkTable(key.trim(), relatedItems);
      const result = await loadPhotoLevel(level, key.trim(), relatedItems, link, state.hits);
      const added = toHits(result.photos, new Set());
      const note = added.length ? `${LEVEL_NAMES[level]}에서 ${added.length}장을 뒤에 추가했습니다.` : `${LEVEL_NAMES[level]}에는 추가할 사진이 없습니다.`;
      setPhotoStates(current => ({ ...current, [key]: { ...current[key], loading: false, level, hits: [...current[key].hits, ...added], source: levelSource(level, current[key].hasFolders), note } }));
    } catch (cause) {
      setPhotoStates(current => ({ ...current, [key]: { ...current[key], loading: false, error: cause instanceof Error ? cause.message : "사진을 더 찾지 못했습니다." } }));
    }
  }

  // 검색 초기화: 화면과 이 브라우저에 저장된 결과·선택·분석용·단계를 모두 지워 검색 전 상태로 되돌린다.
  async function resetPhotoSearch(model: string) {
    if (!window.confirm(`${model}의 사진 검색 결과와 선택을 모두 지우고 처음 상태로 되돌릴까요?\n(사진 파일은 지워지지 않습니다.)`)) return;
    await clearPhotoSearch(model).catch(() => {});
    delete savedSearchJson.current[model];
    setPhotoStates(current => { const next = { ...current }; delete next[model]; return next; });
    setSavedHints(current => { const next = { ...current }; delete next[model]; return next; });
    setViewer(current => current?.model === model ? null : current);
  }

  // 전체 선택: 화면 순서대로 빈자리(최대 10장)만큼 선택한다. 등록도우미가 10장까지만 받는다.
  function selectAllPhotos(model: string) {
    setPhotoStates(current => {
      const state = current[model];
      if (!state) return current;
      let room = 10 - state.hits.filter(photo => photo.selected).length;
      return { ...current, [model]: { ...state, hits: state.hits.map(photo => photo.selected || room <= 0 ? photo : (room--, { ...photo, selected: true })) } };
    });
  }

  function clearPhotoSelection(model: string) {
    setPhotoStates(current => current[model] ? { ...current, [model]: { ...current[model], analysisId: "", hits: current[model].hits.map(photo => ({ ...photo, selected: false })) } } : current);
  }

  function setPhotoSelected(model: string, photoId: string, selected: boolean) {
    setPhotoStates(current => {
      const state = current[model];
      if (!state) return current;
      if (selected && state.hits.filter(photo => photo.selected).length >= 10) return current;
      return { ...current, [model]: { ...state, analysisId: !selected && state.analysisId === photoId ? "" : state.analysisId, hits: state.hits.map(photo => photo.id === photoId ? { ...photo, selected } : photo) } };
    });
  }

  // 분석용은 모델당 1장. 지정하면 선택도 함께 켠다(선택 10장이 이미 찼으면 지정하지 않는다).
  function setAnalysisPhoto(model: string, photoId: string) {
    setPhotoStates(current => {
      const state = current[model];
      const target = state?.hits.find(photo => photo.id === photoId);
      if (!state || !target) return current;
      if (!target.selected && state.hits.filter(photo => photo.selected).length >= 10) return current;
      return { ...current, [model]: { ...state, analysisId: photoId, hits: state.hits.map(photo => photo.id === photoId ? { ...photo, selected: true } : photo) } };
    });
  }

  const viewerState = viewer ? photoStates[viewer.model] : undefined;
  const viewerHit = viewer ? viewerState?.hits[viewer.index] : undefined;
  function moveViewer(step: number) {
    setViewer(current => {
      const count = current ? photoStatesRef.current[current.model]?.hits.length || 0 : 0;
      if (!current) return current;
      return { ...current, index: Math.min(Math.max(current.index + step, 0), Math.max(count - 1, 0)) };
    });
  }
  useEffect(() => {
    if (!viewer) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setViewer(null);
      else if (event.key === "ArrowLeft") moveViewer(-1);
      else if (event.key === "ArrowRight") moveViewer(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [viewer]);

  async function prepareModel(modelName: string, groupItems: ProductCatalogItem[]) {
    const state = photoStates[modelName];
    const selectedPhotos = (state?.hits || []).filter(hit => hit.selected);
    if (state && selectedPhotos.length && !selectedPhotos.some(hit => hit.id === state.analysisId)) {
      setPhotoStates(current => ({ ...current, [modelName]: { ...state, error: "AI 분석용 사진을 1장 지정해주세요. 제품만 정확히 나온 사진 아래 ‘분석용’ 버튼을 누르면 됩니다." } }));
      return;
    }
    setPreparing(modelName);
    setFolderMessage("");
    try {
      await savePreparedPhotos(modelName, selectedPhotos, state?.analysisId);
      window.localStorage.setItem(REREGISTRATION_PREP_KEY, JSON.stringify({ modelName, items: groupItems }));
      router.push(`/?reregisterModel=${encodeURIComponent(modelName)}`);
    } catch {
      setFolderMessage("등록 준비를 저장하지 못했습니다. 브라우저 저장공간과 선택한 사진을 확인해주세요.");
    } finally { setPreparing(""); }
  }

  return (
    <main style={{ maxWidth: 1180, margin: "0 auto", padding: "20px 16px 48px", fontFamily: "sans-serif" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "start", marginBottom: 18 }}>
        <div>
          <p style={{ margin: 0, color: wmsColors.muted, fontSize: 12, fontWeight: 700 }}>상품등록 · 연결 대장</p>
          <h1 style={{ margin: "4px 0 6px", color: wmsColors.ink, fontSize: 26 }}>모델·옵션·SKU·사진 연결</h1>
          <p style={{ margin: 0, color: wmsColors.muted, fontSize: 13 }}>모델명은 상품군, 모델SKU는 옵션 키입니다. 이 화면은 읽기 전용입니다.</p>
        </div>
        <Link href="/" style={{ color: wmsColors.ink, fontWeight: 800, fontSize: 13 }}>AI 상품등록으로 돌아가기</Link>
      </div>

      <div style={{ marginBottom: 14 }}>
        <button type="button" onClick={() => void connectPhotoFolder().then(name => { setFolderName(name); setFolderMessage(""); }).catch(error => { if (error?.name !== "AbortError") setFolderMessage(error instanceof Error ? error.message : "사진 폴더 연결 실패"); })}>사진 원본 폴더 연결</button>
        <span style={{ marginLeft: 8, fontSize: 12 }}>{folderName ? `연결: ${folderName}` : "PC에서 MYBOX 동기화 사진 폴더를 한 번 선택해주세요."}</span>
        <p style={{ fontSize: 12 }}>사진은 이 브라우저에서 읽습니다. 모델 사진 검색 후 사용할 사진을 최대 10장 선택하고 등록 준비를 누르세요.</p>
        {folderMessage && <p role="status">{folderMessage}</p>}
      </div>

      <div style={{ border: `1px solid ${wmsColors.border}`, background: "#fff", borderRadius: 14, padding: 14, marginBottom: 14 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 8 }}>
          {[["전체 행", summary.total], ["재등록 모델", summary.reregisterModels], ["재등록 후보 행", summary.reregisterCandidates], ["로켓 등록 증빙 확인", summary.rocketPending]].map(([label, value]) => (
            <div key={String(label)} style={{ background: wmsColors.surface, borderRadius: 10, padding: "10px 12px" }}><div style={{ color: wmsColors.muted, fontSize: 11 }}>{label}</div><strong style={{ color: wmsColors.ink, fontSize: 20 }}>{value}</strong></div>
          ))}
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
          <input value={query} onChange={event => setQuery(event.target.value)} placeholder="모델명·모델SKU·SKU ID·바코드·상품명 검색" style={{ flex: "1 1 340px", minHeight: 42, border: `1px solid ${wmsColors.border}`, borderRadius: 9, padding: "0 12px" }} />
          {query && <button type="button" onClick={() => { setQuery(""); try { window.sessionStorage.setItem(VIEW_KEY, JSON.stringify({ status, query: "" })); } catch {} }} title="검색어를 지웁니다." style={{ minHeight: 42, border: `1px solid ${wmsColors.border}`, borderRadius: 9, padding: "0 12px", background: "#fff", color: wmsColors.ink, fontWeight: 700, cursor: "pointer" }}>검색 초기화</button>}
          <button type="button" onClick={() => void loadCatalog()} disabled={loading} style={{ minHeight: 42, border: `1px solid ${wmsColors.border}`, borderRadius: 9, padding: "0 12px", background: "#fff", color: wmsColors.ink, fontWeight: 700, cursor: loading ? "wait" : "pointer" }}>{loading ? "새로 읽는 중…" : "제품DB 새로고침"}</button>
          <select value={status} onChange={event => setStatus(event.target.value)} style={{ minHeight: 42, border: `1px solid ${wmsColors.border}`, borderRadius: 9, padding: "0 10px", background: "#fff" }}>
            <option value="all">전체 상태</option><option value="reregister">재등록 필요(모델 전체)</option><option value="rocket-pending">로켓 등록 증빙 확인 필요</option><option value="pending">DB에 SKU 없음</option><option value="issued">DB에 SKU 있음</option><option value="wims">WIMS 대조 후보 있음</option>
          </select>
        </div>
      </div>

      {!configured && !loading && <div style={{ border: `1px solid ${wmsColors.warn}`, background: wmsColors.warnSoft, borderRadius: 12, padding: 14, marginBottom: 14 }}>Google Sheets 연결 설정이 없어 상품을 읽지 못했습니다.</div>}
      {error && <div style={{ border: `1px solid ${wmsColors.warnSoftBorder}`, background: wmsColors.warnSoft, borderRadius: 12, padding: 14, marginBottom: 14 }}>{error}</div>}
      <p style={{ fontSize: 12, color: wmsColors.muted }}>제품DB의 공란만으로 쿠팡 승인 여부를 판단할 수 없습니다. {snapshot ? `이 브라우저·사이트에 저장된 WIMS ${snapshot.rows.length}건의 대조 후보를 함께 표시합니다. 재등록 이력 검증과 DB 반영은 별도입니다.` : "이 브라우저·사이트에서 읽을 수 있는 WIMS 자료가 없습니다. 다른 브라우저나 운영 사이트의 저장 자료는 여기와 공유되지 않습니다."} <Link href="/product-registration#wims-registration">WIMS 대조 화면 열기</Link></p>
      <p style={{ fontSize: 12, color: wmsColors.muted }}>제품페이지 주소가 비어 있는 행은 SKU ID를 임의로 URL로 바꾸지 않습니다. 쿠팡에서 내려받은 <b>쿠팡쇼핑몰 추출DB.xlsx</b>를 <Link href="/#coupang-data-import">작업센터의 ‘쿠팡 추출DB 업데이트’</Link>에 올리면 SKU ID/옵션ID로 기존 행의 제품링크만 연결할 수 있습니다.</p>

      {rejectedRows.length > 0 && <section style={{ border: `2px solid ${wmsColors.warn}`, background: wmsColors.warnSoft, borderRadius: 14, padding: 14, marginBottom: 14 }}>
        <div style={{ color: wmsColors.warnText, fontWeight: 900, fontSize: 18 }}>반려 · 보완 후 재등록</div>
        <p style={{ margin: "6px 0 12px", color: wmsColors.ink, fontSize: 12 }}>제품DB의 기존 SKU 유무와 관계없이 독립적인 WIMS 등록건입니다. DB 행이 있다고 신규승인으로 판단하지 마세요.</p>
        <p style={{ margin: "0 0 12px", color: wmsColors.muted, fontSize: 12 }}>등록일은 반려일이 아닙니다. 상세 반려 사유와 반려일은 쿠팡 반려 안내에서 확인해 주세요.</p>
        <div style={{ display: "grid", gap: 8 }}>
          {rejectedRows.map((row, index) => <article key={`${row.modelSku}|${row.estimateId}|${index}`} style={{ border: `1px solid ${wmsColors.warnSoftBorder}`, background: "#fff", borderRadius: 10, padding: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "start" }}>
              <div style={{ color: wmsColors.ink, fontWeight: 800 }}>{row.productName || "상품명 미확인"}</div>
              <span style={{ color: wmsColors.warnText, fontWeight: 900, fontSize: 13 }}>반려</span>
            </div>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 8, color: wmsColors.muted, fontSize: 12 }}>
              <span>WIMS모델SKU: <b>{row.modelSku || "-"}</b></span>
              <span>견적서ID: <b>{row.estimateId || "-"}</b></span>
              <span>등록일: <b>{row.registeredAt || "미확인"}</b></span>
              <span>반려일: <b>미확인</b></span>
            </div>
            <div style={{ marginTop: 7, color: wmsColors.ink, fontSize: 12 }}>상태: <b>{row.statusLabel || ""}</b></div>
          </article>)}
        </div>
      </section>}

      {/* 창을 다시 누를 때의 자동 새로고침은 목록을 그대로 둔 채 뒤에서 읽는다(처음 한 번만 로딩 화면). */}
      {loading && !items.length ? <p style={{ color: wmsColors.muted }}>상품 연결 대장을 읽는 중입니다.</p> : (
        <div style={{ display: "grid", gap: 10 }}>
          {status === "reregister" && <section style={{ border: `2px solid ${wmsColors.warnSoftBorder}`, background: wmsColors.warnSoft, borderRadius: 14, padding: 14, marginBottom: 2 }}>
            <div style={{ color: wmsColors.warnText, fontWeight: 900, fontSize: 16 }}>재등록 작업 묶음 · {reregistrationGroups.length}개 모델</div>
            <p style={{ color: wmsColors.ink, fontSize: 12, margin: "6px 0 12px" }}>모델 하나에 옵션이 여러 개 있어도 사진 폴더 검색은 한 번만 합니다. 아래 옵션 목록은 각각 별도 모델SKU로 유지됩니다.</p>
            <div style={{ display: "grid", gap: 8 }}>
              {reregistrationGroups.map(group => {
                const first = group.items[0];
                const photos = photoStates[group.modelName];
                return <article key={group.key} style={{ border: `1px solid ${wmsColors.warnSoftBorder}`, background: "#fff", borderRadius: 10, padding: 10 }}>
                  <div style={{ display: "flex", alignItems: "start", justifyContent: "space-between", gap: 10 }}>
                    <div><div style={{ color: wmsColors.ink, fontWeight: 800 }}>{group.modelName}</div><div style={{ color: wmsColors.ink, fontSize: 12, marginTop: 3 }}>{group.productName}</div><div style={{ color: wmsColors.muted, fontSize: 11, marginTop: 4 }}>{group.items.length}개 후보 행</div><div style={{ display: "grid", gap: 3, marginTop: 6, fontSize: 11 }}>{group.items.map((item, itemIndex) => { const itemLink = externalUrl(item.productLink); return <div key={`${item.skuId}|${item.modelSku}|${item.optionLabel}|${itemIndex}`} style={{ color: wmsColors.muted }}>모델SKU <b>{item.modelSku || "미확인"}</b> · 기존 SKU ID <b>{item.skuId || "미확인"}</b> · 바코드 <b>{item.barcode || "미확인"}</b> · 옵션 <b>{item.optionLabel || "미확인"}</b> · 누적입고 <b>{item.cumulativeInbound ? `${(Number(item.cumulativeInbound) || 0).toLocaleString()}개` : "미확인"}</b> · 발주가능상태 <b>{item.orderableStatus || "미확인"}</b>{itemLink ? <> · <a href={itemLink} target="_blank" rel="noreferrer" style={{ color: wmsColors.slate }}>제품페이지 열기 ↗</a></> : " · 제품주소 미등록"}</div>; })}</div></div>
                    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end" }}><Link href={`/?reregisterModel=${encodeURIComponent(group.modelName)}`} onClick={event => { event.preventDefault(); if (!preparing) void prepareModel(group.modelName, group.items); }} aria-disabled={Boolean(preparing)} style={{ fontSize: 12, color: wmsColors.slate, fontWeight: 700 }}>등록 준비</Link><button type="button" onClick={() => void searchPhotos(first, group.items)} disabled={!group.modelName || photos?.loading} style={{ border: `1px solid ${wmsColors.border}`, borderRadius: 8, background: "#fff", padding: "7px 10px", cursor: photos?.loading ? "wait" : "pointer", fontWeight: 700, color: wmsColors.ink }}>{photos?.loading ? "사진 검색 중…" : "이 모델 사진 검색"}</button>{photos && !photos.loading && photos.hits.length > 0 && <button type="button" onClick={() => void searchPhotos(first, group.items, true)} title="1차 확정 폴더부터 새로 찾습니다. 고른 사진과 분석용은 유지됩니다." style={{ border: `1px solid ${wmsColors.border}`, borderRadius: 8, background: "#fff", padding: "7px 10px", cursor: "pointer", fontSize: 12, color: wmsColors.muted }}>다시 검색 (1차부터)</button>}{(photos || savedHints[group.modelName] !== undefined) && !photos?.loading && <button type="button" onClick={() => void resetPhotoSearch(group.modelName)} title="저장된 검색 결과와 선택을 모두 지웁니다. 사진 파일은 그대로입니다." style={{ border: `1px solid ${wmsColors.warnSoftBorder}`, borderRadius: 8, background: "#fff", padding: "7px 10px", cursor: "pointer", fontSize: 12, color: wmsColors.warnText }}>검색 초기화</button>}</div>
                  </div>
                  {!photos && savedHints[group.modelName] !== undefined && <div style={{ color: wmsColors.muted, fontSize: 11, marginTop: 7 }}>저장된 사진 검색 결과가 있습니다(선택 {savedHints[group.modelName]}장). ‘이 모델 사진 검색’을 누르면 다시 검색하지 않고 바로 불러옵니다.</div>}
                  {photos?.error && <div style={{ color: wmsColors.warnText, fontSize: 11, marginTop: 7 }}>{photos.error}</div>}
                  {photos && photos.hits.length > 0 && <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8 }}>
                    <button type="button" onClick={() => selectAllPhotos(group.modelName)} disabled={photos.hits.filter(hit => hit.selected).length >= 10} style={{ border: `1px solid ${wmsColors.slate}`, borderRadius: 8, background: "#fff", padding: "7px 12px", cursor: "pointer", fontWeight: 700, fontSize: 13, color: wmsColors.slate }}>전체 선택 (최대 10장)</button>
                    <button type="button" onClick={() => clearPhotoSelection(group.modelName)} disabled={!photos.hits.some(hit => hit.selected)} style={{ border: `1px solid ${wmsColors.border}`, borderRadius: 8, background: "#fff", padding: "7px 12px", cursor: "pointer", fontWeight: 700, fontSize: 13, color: wmsColors.ink }}>전체 해제</button>
                    <span style={{ color: wmsColors.muted, fontSize: 11 }}>전체 해제는 분석용 지정도 함께 풉니다.</span>
                  </div>}
                  {photos && photos.hits.length > 0 && <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
                    {photos.hits.slice(0, shownCounts[group.modelName] || THUMBNAIL_PAGE).map((hit, hitIndex) => {
                      const isAnalysis = photos.analysisId === hit.id;
                      const full = !hit.selected && photos.hits.filter(photo => photo.selected).length >= 10;
                      return <div key={hit.id} style={{ width: 104, fontSize: 11, overflowWrap: "anywhere", border: `2px solid ${isAnalysis ? wmsColors.greenDark : hit.selected ? wmsColors.slate : "transparent"}`, borderRadius: 8, padding: 2 }}>
                        <button type="button" onClick={() => setViewer({ model: group.modelName, index: hitIndex })} title="크게 보기" style={{ display: "block", padding: 0, border: 0, background: "none", cursor: "zoom-in" }}>
                          <Thumbnail photoId={hit.id} file={hit.file} alt={hit.fileName} />
                        </button>
                        <label style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 3, padding: "5px 6px", border: `1px solid ${hit.selected ? wmsColors.slate : wmsColors.border}`, borderRadius: 6, background: hit.selected ? wmsColors.surface : "#fff", cursor: full ? "not-allowed" : "pointer", fontSize: 13, fontWeight: 700 }}><input type="checkbox" checked={hit.selected} disabled={full} onChange={event => setPhotoSelected(group.modelName, hit.id, event.target.checked)} style={{ width: 20, height: 20, margin: 0, cursor: "inherit" }} />선택</label>
                        <button type="button" onClick={() => setAnalysisPhoto(group.modelName, hit.id)} disabled={full && !isAnalysis} style={{ marginTop: 3, width: "100%", border: `1px solid ${isAnalysis ? wmsColors.greenDark : wmsColors.border}`, borderRadius: 6, background: isAnalysis ? wmsColors.greenDark : "#fff", color: isAnalysis ? "#fff" : wmsColors.ink, fontSize: 13, fontWeight: 700, padding: "6px 0", cursor: "pointer" }}>{isAnalysis ? "★ 분석용" : "분석용"}</button>
                        <div>{hit.fileName}</div><div style={{ color: wmsColors.muted }}>검색: {hit.matchedBy.join(", ")}</div>
                      </div>;
                    })}
                    {photos.hits.length > (shownCounts[group.modelName] || THUMBNAIL_PAGE) && <button type="button" onClick={() => setShownCounts(current => ({ ...current, [group.modelName]: (current[group.modelName] || THUMBNAIL_PAGE) + THUMBNAIL_PAGE }))} style={{ alignSelf: "center", border: `1px solid ${wmsColors.border}`, borderRadius: 8, background: "#fff", padding: "10px 14px", cursor: "pointer", fontWeight: 700, color: wmsColors.ink }}>사진 {Math.min(THUMBNAIL_PAGE, photos.hits.length - (shownCounts[group.modelName] || THUMBNAIL_PAGE))}장 더 표시 ({photos.hits.length - (shownCounts[group.modelName] || THUMBNAIL_PAGE)}장 남음)</button>}
                    {photos.hits.length >= 400 && <p>사진이 많아 처음 400장만 표시합니다. 필요한 사진이 없으면 연결표의 사진폴더 지정을 고쳐야 하니 알려주세요.</p>}
                  </div>}
                  {photos?.note && <div style={{ color: wmsColors.ink, fontSize: 12, marginTop: 7 }}>{photos.note}</div>}
                  {photos && !photos.error && nextPhotoLevel(photos) > 0 && <div style={{ marginTop: 8 }}><button type="button" onClick={() => void expandPhotos(first, group.items)} disabled={photos.loading} style={{ border: `1px solid ${wmsColors.slate}`, borderRadius: 8, background: "#fff", padding: "8px 12px", cursor: photos.loading ? "wait" : "pointer", fontWeight: 700, fontSize: 13, color: wmsColors.slate }}>{photos.loading ? "사진 찾는 중…" : `${LEVEL_BUTTON_LABELS[nextPhotoLevel(photos)]} →`}</button><span style={{ marginLeft: 8, color: wmsColors.muted, fontSize: 11 }}>필요한 사진이 위에 없을 때만 누르세요. 고른 사진은 그대로 유지됩니다.</span></div>}
                  {photos && !photos.loading && <div style={{ color: wmsColors.muted, fontSize: 11, marginTop: 7 }}>사진 후보 {photos.hits.length}개{photos.source ? ` · ${photos.source}` : ""} · 선택 {photos.hits.filter(hit => hit.selected).length}/10장 · 분석용 {photos.analysisId ? "지정됨" : "미지정"} (분석용 1장은 AI 분석에, 선택한 사진 전체는 쿠팡 등록이미지 업로드 풀로 갑니다)</div>}
                </article>;
              })}
            </div>
          </section>}
          {filteredItems.slice(0, 200).map((item, index) => {
            const rowKey = `${item.skuId}|${item.modelSku}|${item.modelName}|${index}`;
            const wims = snapshot ? findWimsRow(item, snapshot.rows) : null;
            const photoKey = item.modelName || item.modelSku || item.productName;
            const photos = photoStates[photoKey];
            const imageUrl = getWmsDisplayImageUrl(externalUrl(item.imageUrl));
            const productLink = externalUrl(item.productLink);
            const reregistration = isReregistrationTarget(item);
            const rocketPending = !isRocketRegistered(item);
            const identityNeedsChecking = reregistration && !namedModelGroupKey(item);
            return <article key={rowKey} style={{ border: `1px solid ${wmsColors.border}`, background: "#fff", borderRadius: 12, padding: 12 }}>
              <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", gap: 12 }}>
                <div>
                  <div style={{ color: wmsColors.ink, fontWeight: 800 }}>{item.modelName || "모델명 없음"}</div>
                  <div style={{ color: wmsColors.muted, fontSize: 12, marginTop: 4 }}>{resolveDisplayNameAndOption(item.productName || "", item.optionLabel).name || "상품명 없음"}</div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 9, fontSize: 12 }}><span>옵션: <b>{item.optionLabel || "미확인"}</b></span><span>모델SKU: <b>{item.modelSku || "미확인"}</b></span><span>기존 SKU ID: <b>{item.skuId || "미확인"}</b></span><span>바코드: <b>{item.barcode || "미확인"}</b></span><span>누적입고: <b>{item.cumulativeInbound ? `${(Number(item.cumulativeInbound) || 0).toLocaleString()}개` : "미확인"}</b></span><span>발주가능상태: <b>{item.orderableStatus || "미확인"}</b></span></div>
                  {wims && <div style={{ marginTop: 6, fontSize: 12, color: wmsColors.muted }}>WIMS 대조 후보 · {wims.statusLabel || "상태 미확인"} · SKU {wims.skuId || "미확인"} · 바코드 {wims.barcode || "미확인"} · 등록일 {wims.registeredAt || "미확인"} (DB 연결 확정 전)</div>}
                </div>
                <div style={{ textAlign: "right", minWidth: 150 }}><div style={{ color: reregistration ? wmsColors.warnText : item.skuId ? wmsColors.greenDark : wmsColors.warn, fontWeight: 800, fontSize: 12 }}>{identityNeedsChecking ? "식별정보 확인 필요" : reregistration ? "모델 전체 재등록 대상" : item.skuId ? "DB에 SKU 있음" : "승인정보 연결 필요"}</div><div style={{ color: wmsColors.muted, fontSize: 11, marginTop: 5 }}>DB 상태: {item.currentStatus || "미입력"}</div>{rocketPending && <div style={{ color: wmsColors.warnText, fontSize: 11, marginTop: 3 }}>R 바코드 미확인 · 등록 증빙 확인 필요</div>}</div>
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginTop: 10 }}>
                <button type="button" onClick={() => void searchPhotos(item)} disabled={!photoKey || photos?.loading} style={{ border: `1px solid ${wmsColors.border}`, borderRadius: 8, background: "#fff", padding: "7px 10px", cursor: "pointer", fontWeight: 700, color: wmsColors.ink }}>{photos?.loading ? "사진 검색 중…" : "사진 후보 검색"}</button>
                {imageUrl && <a href={imageUrl} target="_blank" rel="noreferrer" aria-label="대표이미지 크게 보기" style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: wmsColors.slate }}><img src={imageUrl} alt="대표이미지" width={42} height={42} loading="lazy" style={{ width: 42, height: 42, objectFit: "contain", border: `1px solid ${wmsColors.border}`, borderRadius: 6, background: wmsColors.surface }} /><span>대표이미지 원본 열기 ↗</span></a>}
                {productLink ? <>
                  <a href={productLink} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: wmsColors.slate }}>쿠팡 제품페이지 열기 ↗</a>
                  <span style={{ color: wmsColors.muted, fontSize: 11 }}>쿠팡이 자동 확인을 막아 상태를 대신 알려드릴 수 없습니다. 위 링크를 직접 열어 확인해주세요.</span>
                </> : <span style={{ color: wmsColors.muted, fontSize: 11 }}>쿠팡 제품주소: 미등록 · 해당 SKU를 광고센터에서 SKU ID로 검색해야 합니다.</span>}
                {item.skuId && <Link href={`/wms/products/${encodeURIComponent(item.skuId)}`} style={{ fontSize: 12, color: wmsColors.slate }}>SKU 상세 보기</Link>}
                {photos?.error && <span style={{ color: wmsColors.warnText, fontSize: 11 }}>{photos.error}</span>}
                {photos && !photos.loading && !photos.error && <span style={{ color: wmsColors.muted, fontSize: 11 }}>사진 후보 {photos.hits.length}개</span>}
              </div>
              {photos && photos.hits.length > 0 && <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 6, marginTop: 10 }}>{photos.hits.slice(0, 8).map(hit => <div key={hit.id} style={{ border: `1px solid ${wmsColors.border}`, borderRadius: 8, padding: 7, fontSize: 10, overflow: "hidden" }}><div style={{ fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{hit.fileName}</div><div style={{ color: wmsColors.muted, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{hit.id}</div></div>)}</div>}
            </article>;
          })}
          {filteredItems.length > 200 && <p style={{ color: wmsColors.muted, fontSize: 12 }}>검색 결과가 많아 처음 200개만 표시합니다. 검색어를 좁혀 주세요.</p>}
          {filteredItems.length === 0 && <p style={{ color: wmsColors.muted }}>조건에 맞는 상품이 없습니다.</p>}
        </div>
      )}
      {viewerHit && viewerState && viewer && <div role="dialog" aria-modal="true" aria-label="사진 크게 보기" onClick={() => setViewer(null)} style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(0,0,0,0.82)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 16 }}>
        <div onClick={event => event.stopPropagation()} style={{ display: "flex", alignItems: "center", gap: 12, maxWidth: "100%" }}>
          <button type="button" onClick={() => moveViewer(-1)} disabled={viewer.index === 0} aria-label="이전 사진" style={{ fontSize: 28, padding: "8px 14px", borderRadius: 8, border: 0, cursor: "pointer" }}>‹</button>
          <ZoomableImage src={viewerHit.preview} alt={viewerHit.fileName} />
          <button type="button" onClick={() => moveViewer(1)} disabled={viewer.index >= viewerState.hits.length - 1} aria-label="다음 사진" style={{ fontSize: 28, padding: "8px 14px", borderRadius: 8, border: 0, cursor: "pointer" }}>›</button>
        </div>
        <div onClick={event => event.stopPropagation()} style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", justifyContent: "center", marginTop: 12, color: "#fff", fontSize: 13 }}>
          <span>{viewer.index + 1} / {viewerState.hits.length} · {viewerHit.fileName}</span>
          <label style={{ display: "flex", gap: 6, alignItems: "center", padding: "6px 12px", borderRadius: 6, background: "#fff", color: wmsColors.ink, fontWeight: 700, cursor: "pointer" }}><input type="checkbox" checked={viewerHit.selected} onChange={event => setPhotoSelected(viewer.model, viewerHit.id, event.target.checked)} style={{ width: 20, height: 20, margin: 0 }} />선택</label>
          <button type="button" onClick={() => setAnalysisPhoto(viewer.model, viewerHit.id)} style={{ border: 0, borderRadius: 6, padding: "6px 12px", fontWeight: 700, cursor: "pointer", background: viewerState.analysisId === viewerHit.id ? wmsColors.greenDark : "#fff", color: viewerState.analysisId === viewerHit.id ? "#fff" : wmsColors.ink }}>{viewerState.analysisId === viewerHit.id ? "★ 분석용" : "분석용으로 지정"}</button>
          <a href={viewerHit.preview} download={viewerHit.fileName} style={{ borderRadius: 6, padding: "6px 12px", background: "#fff", color: wmsColors.ink, fontWeight: 700, textDecoration: "none" }}>다운로드</a>
          <button type="button" onClick={() => setViewer(null)} style={{ border: 0, borderRadius: 6, padding: "6px 12px", cursor: "pointer" }}>닫기 (Esc)</button>
        </div>
      </div>}
    </main>
  );
}

/**
 * 크게 보기 화면의 사진. 마우스 휠로 가리킨 곳을 확대/축소하고, 확대한 상태에서는 끌어서 옮긴다.
 * 더블클릭하면 그 자리를 3배로 확대(다시 더블클릭하면 전체 보기). 상세페이지 글씨 확인용.
 */
function ZoomableImage({ src, alt }: { src: string; alt: string }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [zoom, setZoom] = useState(1);
  const drag = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const fit = natural && box.w && box.h ? Math.min(box.w / natural.w, box.h / natural.h) : 0;
  const view = useRef({ zoom, fit, natural, box });
  view.current = { zoom, fit, natural, box };

  useEffect(() => { setZoom(1); setNatural(null); }, [src]);
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const measure = () => setBox({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // (ox, oy) = 상자 안 마우스 위치. 확대 전후로 그 지점이 같은 자리에 머물도록 스크롤을 맞춘다.
  const zoomAt = useCallback((next: number, ox: number, oy: number) => {
    const el = boxRef.current;
    const { zoom: old, fit: base, natural: size, box: area } = view.current;
    if (!el || !size || !base) return;
    const target = Math.min(Math.max(next, 1), 12);
    if (target === old) return;
    const offset = (scale: number) => ({ x: Math.max((area.w - size.w * base * scale) / 2, 0), y: Math.max((area.h - size.h * base * scale) / 2, 0) });
    const before = offset(old), after = offset(target);
    const imageX = (el.scrollLeft + ox - before.x) / (base * old);
    const imageY = (el.scrollTop + oy - before.y) / (base * old);
    setZoom(target);
    requestAnimationFrame(() => {
      el.scrollLeft = imageX * base * target + after.x - ox;
      el.scrollTop = imageY * base * target + after.y - oy;
    });
  }, []);

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = el.getBoundingClientRect();
      zoomAt(view.current.zoom * (event.deltaY < 0 ? 1.25 : 0.8), event.clientX - rect.left, event.clientY - rect.top);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoomAt]);

  const width = natural ? natural.w * fit * zoom : undefined;
  const height = natural ? natural.h * fit * zoom : undefined;
  const center = () => zoomAt(0, box.w / 2, box.h / 2);
  const step = (factor: number) => zoomAt(zoom * factor, box.w / 2, box.h / 2);
  return <div style={{ display: "grid", gap: 6, justifyItems: "center" }}>
    <div
      ref={boxRef}
      onMouseDown={event => { const el = boxRef.current; if (el && zoom > 1) { event.preventDefault(); drag.current = { x: event.clientX, y: event.clientY, left: el.scrollLeft, top: el.scrollTop }; } }}
      onMouseMove={event => { const el = boxRef.current; if (el && drag.current) { el.scrollLeft = drag.current.left - (event.clientX - drag.current.x); el.scrollTop = drag.current.top - (event.clientY - drag.current.y); } }}
      onMouseUp={() => { drag.current = null; }}
      onMouseLeave={() => { drag.current = null; }}
      onDoubleClick={event => { const rect = event.currentTarget.getBoundingClientRect(); zoomAt(zoom > 1 ? 1 : 3, event.clientX - rect.left, event.clientY - rect.top); }}
      style={{ width: "min(80vw, 1200px)", height: "74vh", overflow: "auto", background: "#fff", borderRadius: 8, cursor: zoom > 1 ? (drag.current ? "grabbing" : "grab") : "zoom-in" }}
    >
      <div style={{ minWidth: "100%", minHeight: "100%", width: width, height: height, display: "flex", alignItems: "center", justifyContent: "center" }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt={alt} draggable={false} onLoad={event => setNatural({ w: event.currentTarget.naturalWidth, h: event.currentTarget.naturalHeight })} style={{ width, height, maxWidth: "none", display: "block", userSelect: "none" }} />
      </div>
    </div>
    <div style={{ display: "flex", gap: 6, alignItems: "center", color: "#fff", fontSize: 12 }}>
      <button type="button" onClick={() => step(0.8)} style={{ border: 0, borderRadius: 6, padding: "4px 10px", cursor: "pointer" }}>－</button>
      <span style={{ minWidth: 48, textAlign: "center" }}>{Math.round(zoom * 100)}%</span>
      <button type="button" onClick={() => step(1.25)} style={{ border: 0, borderRadius: 6, padding: "4px 10px", cursor: "pointer" }}>＋</button>
      <button type="button" onClick={center} style={{ border: 0, borderRadius: 6, padding: "4px 10px", cursor: "pointer" }}>전체 보기</button>
      <span>마우스 휠: 확대·축소 · 확대 후 끌어서 이동 · 더블클릭: 3배 확대</span>
    </div>
  </div>;
}

/*
 * 목록용 작은 사진. 한 번 만든 것은 브라우저에 기억해 두고, 처음에는 파일 안의 작은 미리보기를 쓰거나 원본을 3장씩 200px로 줄여 만든다.
 * 줄인 사진은 경로별로 기억해 두고, 크게 보기·다운로드·등록 준비는 원본 파일을 그대로 쓴다.
 */
const thumbnailCache = new Map<string, string>();
const thumbnailQueue: (() => void)[] = [];
let thumbnailsRunning = 0;

function queueThumbnail<T>(task: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const run = () => {
      thumbnailsRunning++;
      task().then(resolve, reject).finally(() => { thumbnailsRunning--; thumbnailQueue.shift()?.(); });
    };
    if (thumbnailsRunning < 3) run(); else thumbnailQueue.push(run);
  });
}

/**
 * 카메라 JPEG 앞부분(Exif)에 들어 있는 작은 미리보기를 꺼낸다. 파일 앞 128KB만 읽어서 매우 빠르다.
 * (이 PC의 사진 폴더는 브라우저에서 원본 전체를 읽는 속도가 초당 2~3MB 정도라 원본을 줄이는 방식은 느리다.)
 */
async function exifThumbnail(file: File): Promise<Blob | null> {
  if (!/\.jpe?g$/i.test(file.name)) return null;
  const bytes = new Uint8Array(await file.slice(0, 131072).arrayBuffer());
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let at = 2;
  while (at + 4 < bytes.length && bytes[at] === 0xff) {
    const marker = bytes[at + 1];
    const length = (bytes[at + 2] << 8) | bytes[at + 3];
    const end = Math.min(at + 2 + length, bytes.length);
    const isExif = marker === 0xe1 && String.fromCharCode(...bytes.slice(at + 4, at + 8)) === "Exif";
    if (isExif) {
      for (let i = at + 10; i + 3 < end; i++) {
        if (bytes[i] !== 0xff || bytes[i + 1] !== 0xd8 || bytes[i + 2] !== 0xff) continue;
        for (let j = end - 2; j > i; j--) {
          if (bytes[j] === 0xff && bytes[j + 1] === 0xd9) return new Blob([bytes.slice(i, j + 2)], { type: "image/jpeg" });
        }
        return null;
      }
      return null;
    }
    if (marker === 0xda) return null;
    at = end;
  }
  return null;
}

async function makeThumbnail(file: File): Promise<Blob | null> {
  const bitmap = await createImageBitmap(file, { resizeWidth: 200, resizeQuality: "medium" });
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  canvas.getContext("2d")?.drawImage(bitmap, 0, 0);
  bitmap.close();
  return new Promise<Blob | null>(resolve => canvas.toBlob(resolve, "image/jpeg", 0.8));
}

/** 기억해 둔 작은 사진 → 파일 안 미리보기 → 원본 축소(3장씩) 순서. 새로 만든 것은 기억해 둔다. */
async function thumbnailBlob(photoId: string, file: File, stillWanted: () => boolean): Promise<Blob | null> {
  const saved = await loadSavedThumbnail(photoId, file).catch(() => undefined);
  if (saved) return saved;
  const made = await exifThumbnail(file).catch(() => null)
    ?? await queueThumbnail(async () => stillWanted() ? makeThumbnail(file) : null);
  if (made) void saveThumbnail(photoId, file, made).catch(() => {});
  return made;
}

function Thumbnail({ photoId, file, alt }: { photoId: string; file: File; alt: string }) {
  const [url, setUrl] = useState(() => thumbnailCache.get(photoId) || "");
  useEffect(() => {
    if (thumbnailCache.has(photoId)) { setUrl(thumbnailCache.get(photoId)!); return; }
    let alive = true;
    void thumbnailBlob(photoId, file, () => alive)
      .then(blob => {
        if (!blob) return;
        const made = URL.createObjectURL(blob);
        thumbnailCache.set(photoId, made);
        if (alive) setUrl(made);
      })
      .catch(() => { if (alive) setUrl(URL.createObjectURL(file)); });
    return () => { alive = false; };
  }, [photoId, file]);
  if (!url) return <div style={{ width: 100, height: 100, display: "flex", alignItems: "center", justifyContent: "center", background: wmsColors.surface, color: wmsColors.muted, fontSize: 11 }}>불러오는 중…</div>;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={url} alt={alt} style={{ width: 100, height: 100, objectFit: "contain" }} />;
}
