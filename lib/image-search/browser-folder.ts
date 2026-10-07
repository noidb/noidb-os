// The photo root is local to this browser. No files are uploaded or moved.
export type LocalPhoto = { id: string; name: string; file: File; matchedBy: string[] };
export type PreparedPhoto = { id: string; name: string; dataUrl: string };
export type PreparedDetail = { id: string; name: string; file: File };
const DB = "noidb-photo-folder";

async function database() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore("values");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function read<T>(key: string): Promise<T | undefined> {
  const db = await database();
  try {
    return await new Promise<T | undefined>((resolve, reject) => {
      const request = db.transaction("values").objectStore("values").get(key);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } finally { db.close(); }
}

async function write(key: string, value: unknown) {
  const db = await database();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("values", "readwrite");
      tx.objectStore("values").put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally { db.close(); }
}

export async function connectPhotoFolder() {
  if (!("showDirectoryPicker" in window)) throw new Error("사진 폴더 연결은 PC Chrome 또는 Edge에서 열어주세요.");
  const handle = await (window as any).showDirectoryPicker({ mode: "read", id: "noidb-photo-root" }) as FileSystemDirectoryHandle;
  await write("root", handle);
  return handle.name;
}

/** 권한 요청 없이(사용자 클릭 없이도) 연결 폴더를 바로 읽을 수 있는지만 확인한다. */
export async function photoFolderReady() {
  const root = await read<FileSystemDirectoryHandle>("root").catch(() => undefined);
  return Boolean(root) && await root!.queryPermission({ mode: "read" }) === "granted";
}

export async function photoFolderName() {
  return (await read<FileSystemDirectoryHandle>("root"))?.name || "";
}

async function connectedRoot() {
  const root = await read<FileSystemDirectoryHandle>("root");
  if (!root) throw new Error("먼저 ‘사진 원본 폴더 연결’을 눌러 MYBOX 동기화 폴더를 선택해주세요.");
  if (await root.queryPermission({ mode: "read" }) !== "granted" && await root.requestPermission({ mode: "read" }) !== "granted") {
    throw new Error("사진 폴더 읽기 권한이 필요합니다. 사진 원본 폴더를 다시 연결해주세요.");
  }
  return root;
}

const IMAGE_FILE = /\.(jpe?g|png|webp)$/i;

async function descend(root: FileSystemDirectoryHandle, segments: string[]) {
  let dir = root;
  for (const segment of segments) dir = await dir.getDirectoryHandle(segment);
  return dir;
}

/** 모델번호 경계 일치: we011623은 "we011623 귀걸이"와 맞고 "we0116230"과는 맞지 않는다. */
function termMatcher(terms: string[]) {
  const needles = [...new Set(terms.map(term => term.trim().toLowerCase()).filter(Boolean))];
  return (value: string) => {
    const name = value.toLowerCase();
    return needles.filter(needle => {
      let at = name.indexOf(needle);
      while (at >= 0) {
        if (!/[a-z0-9]/i.test(name[at - 1] || "") && !/\d/.test(name[at + needle.length] || "")) return true;
        at = name.indexOf(needle, at + 1);
      }
      return false;
    });
  };
}

/** 파일명과 크기가 완전히 같은 사진(중복 저장본)은 처음 것 하나만 남긴다. */
function duplicateKey(file: File) {
  return `${file.name.toLowerCase()}|${file.size}`;
}

const MAX_PHOTOS = 400;
/** 등록 도우미로 한 번에 넘길 수 있는 선택 사진 수(옵션이 많은 상품까지 고려해 20장). */
export const MAX_SELECTED_PHOTOS = 20;
/** 다른 모델번호(예: wb011625, mn0009)가 이름에 들어간 폴더 — 맨 뒤로 보낸다. */
const OTHER_MODEL_FOLDER = /(^|[^a-z0-9])[mw][a-z]\d{3,}/i;

/** 연결표 폴더를 여는 단계. 1차 확정(이 모델) → 2차 같은 폴더 공용(착용컷 등) → 3차 같은 폴더의 다른 모델 폴더. */
export type FolderTier = 1 | 2 | 3;
export const FOLDER_TIER_LABELS: Record<FolderTier, string> = {
  1: "1차 · 연결표 확정 폴더",
  2: "2차 · 같은 폴더 공용(착용컷 등)",
  3: "3차 · 같은 폴더의 다른 모델 폴더",
};

/**
 * 상품 연결표의 확정 폴더(예: N:\개인\★전체제품사진\we00290)를 전체 검색 없이 바로 연다.
 * 연결한 폴더가 경로의 어느 단계인지 모르므로, 긴 경로부터 줄여가며 처음 열리는 위치를 쓴다.
 * 확정 폴더가 여러 모델을 담은 묶음 폴더(grouped)이면 tier로 나눠 연다:
 * 1차 = modelKeys와 맞는 하위 폴더, 2차 = 모델번호 없는 사진·폴더, 3차 = 다른 모델번호 하위 폴더.
 * 묶음 폴더가 아니면 1차에 폴더 전체가 들어가고 2·3차는 비어 있다.
 * existing(이미 보여준 사진)과 같은 경로·같은 파일명+크기는 다시 넣지 않는다.
 */
export async function openPhotoFolders(folderPaths: string[], modelKeys: string[] = [], tier: FolderTier = 1, existing: LocalPhoto[] = []): Promise<{ photos: LocalPhoto[]; grouped: boolean }> {
  const root = await connectedRoot();
  const matches = termMatcher(modelKeys);
  let label = FOLDER_TIER_LABELS[tier];
  const found: LocalPhoto[] = [];
  const seen = new Set(existing.map(photo => duplicateKey(photo.file)));
  const existingIds = new Set(existing.map(photo => photo.id));
  let grouped = false;
  async function add(entry: any, id: string, name: string) {
    if (existing.length + found.length >= MAX_PHOTOS || !IMAGE_FILE.test(name) || existingIds.has(id)) return;
    const file = await entry.getFile() as File;
    if (seen.has(duplicateKey(file))) return;
    seen.add(duplicateKey(file));
    found.push({ id, name, file, matchedBy: [label] });
  }
  async function collect(dir: FileSystemDirectoryHandle, prefix: string) {
    for await (const [name, entry] of (dir as any).entries()) {
      if (name.startsWith(".")) continue;
      if (entry.kind === "directory") await collect(entry, `${prefix}/${name}`);
      else await add(entry, `${prefix}/${name}`, name);
    }
  }
  for (const path of folderPaths) {
    const segments = path.split(/[\\/]+/).filter(segment => segment && !/^[a-z]:$/i.test(segment));
    for (let start = 0; start < segments.length; start++) {
      const rest = segments.slice(start);
      const dir = await descend(root, rest).catch(() => null);
      if (!dir) continue;
      const prefix = [root.name, ...rest].join("/");
      const entries: [string, any][] = [];
      for await (const pair of (dir as any).entries()) if (!pair[0].startsWith(".")) entries.push(pair);
      const isModelFolder = ([name, entry]: [string, any]) => entry.kind === "directory" && matches(name).length > 0;
      if (!entries.some(isModelFolder)) {
        if (tier === 1) await collect(dir, prefix);
      } else {
        grouped = true;
        for (const [name, entry] of entries) {
          const id = `${prefix}/${name}`;
          if (isModelFolder([name, entry])) { if (tier === 1) await collect(entry, id); }
          else if (entry.kind === "directory") {
            if (tier === (OTHER_MODEL_FOLDER.test(name) ? 3 : 2)) await collect(entry, id);
          } else if (tier === 2) await add(entry, id, name);
        }
      }
      break;
    }
  }
  // MYBOX 통합 후 예전 확정 경로가 사라졌다면, 새 분류 위치의 정확한 모델 폴더만 확인한다.
  // 복합 촬영 자료는 해당 모델명이 붙은 하위 폴더가 있을 때만 연다.
  if (tier === 1 && !found.length && root.name === "★전체제품사진") {
    const exactNames = new Set(modelKeys.map(key => key.trim().toLowerCase()).filter(Boolean));
    const isModelFolderName = (name: string) => [...exactNames].some(key => {
      const lower = name.toLowerCase();
      return lower.startsWith(key) && !/[a-z0-9]/.test(lower[key.length] || "");
    });
    for (const segments of [["01", "_제품별"], ["02", "_복합촬영·작업자료"]]) {
      const parent = await descend(root, segments).catch(() => null);
      if (!parent) continue;
      for await (const [name, entry] of (parent as any).entries()) {
        if (entry.kind !== "directory") continue;
        if (exactNames.has(name.toLowerCase())) {
          label = "1차 · 이동된 모델 폴더";
          await collect(entry, [root.name, ...segments, name].join("/"));
        } else if (segments[0] === "02" && matches(name).length) {
          // 복합 촬영 폴더 안에서는 모델명이 붙은 하위 폴더만 연다.
          for await (const [childName, child] of (entry as any).entries()) {
            if (child.kind !== "directory" || !isModelFolderName(childName)) continue;
            label = "1차 · 이동된 모델 폴더";
            await collect(child, [root.name, ...segments, name, childName].join("/"));
          }
        }
      }
      if (found.length) break;
    }
  }
  return { photos: found.sort((a, b) => a.id.localeCompare(b.id, "ko")), grouped };
}

/** 저장해 둔 검색 결과(id = 연결 폴더 기준 경로)를 검색 없이 다시 연다. 사라진 파일은 건너뛴다. */
export async function openSavedPhotos(saved: { id: string; matchedBy: string[] }[]): Promise<LocalPhoto[]> {
  const root = await connectedRoot();
  const photos = await Promise.all(saved.map(async item => {
    const segments = item.id.split("/");
    if (segments[0] !== root.name || segments.length < 2) return null;
    try {
      const dir = await descend(root, segments.slice(1, -1));
      const file = await (await dir.getFileHandle(segments[segments.length - 1])).getFile();
      return { id: item.id, name: file.name, file, matchedBy: item.matchedBy } as LocalPhoto;
    } catch { return null; }
  }));
  return photos.filter((photo): photo is LocalPhoto => Boolean(photo));
}

/** 모델별 사진 검색 결과·선택 상태. 사진 파일이 아니라 경로만 이 브라우저에 저장한다. */
/** level: 어디까지 열었는지(1~3 = 연결표 폴더 단계, 4 = 사진 폴더 전체 검색). 예전 저장본에는 없다. */
export type SavedPhotoSearch = { hits: { id: string; matchedBy: string[] }[]; selectedIds: string[]; analysisId: string; savedAt: string; level?: number; grouped?: boolean; hasFolders?: boolean; hiddenIds?: string[]; detailIds?: string[]; visualGroups?: Record<string, string>; photoDecisions?: Record<string, { kind: "product" | "wear" | "exclude"; reason: string }> };

export async function savePhotoSearch(model: string, state: SavedPhotoSearch) {
  await write(`search-v2:${model}`, state);
}

/**
 * 목록용 작은 사진(약 200px) 기억. 사진 폴더 읽기가 느려서, 한 번 만든 작은 사진을 이 브라우저에 저장해
 * 두 번째부터는 파일을 읽지 않고 바로 보여준다. 키 = 경로 + 크기 + 수정 시각이라 사진이 바뀌면 새로 만든다.
 * 목록 표시용일 뿐이고, 크게 보기·다운로드·등록 준비는 항상 원본 파일을 쓴다.
 */
const THUMB_DB = "noidb-photo-thumbnails";

function thumbnailKey(id: string, file: File) {
  return `${id}|${file.size}|${file.lastModified}`;
}

async function thumbnailDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(THUMB_DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore("thumbs");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function loadSavedThumbnail(id: string, file: File): Promise<Blob | undefined> {
  const db = await thumbnailDatabase();
  try {
    return await new Promise<Blob | undefined>((resolve, reject) => {
      const request = db.transaction("thumbs").objectStore("thumbs").get(thumbnailKey(id, file));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } finally { db.close(); }
}

export async function saveThumbnail(id: string, file: File, thumbnail: Blob) {
  const db = await thumbnailDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("thumbs", "readwrite");
      tx.objectStore("thumbs").put(thumbnail, thumbnailKey(id, file));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally { db.close(); }
}

/** 검색 초기화: 이 모델의 저장된 검색 결과·선택을 지운다(사진 파일은 건드리지 않는다). */
export async function clearPhotoSearch(model: string) {
  const db = await database();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("values", "readwrite");
      tx.objectStore("values").delete(`search-v2:${model}`);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally { db.close(); }
}

export async function loadPhotoSearch(model: string) {
  return read<SavedPhotoSearch>(`search-v2:${model}`);
}

/** 제품 폴더 안의 작업 단계 폴더(1000·보정·원본·상세페이지 등). 이름에 모델번호가 없다. */
const WORK_STAGE_FOLDER = /^(1000(x1000|px)?|보정|보정원본|원본|상세|상세페이지|evoto.*)$/i;
const SAME_MODEL_PARENT_LABEL = "같은 모델번호 상위 폴더";

export async function searchPhotoFolder(searchTerms: string[], existing: LocalPhoto[] = []): Promise<LocalPhoto[]> {
  const root = await connectedRoot();
  if (!searchTerms.some(term => term.trim())) return [];
  // Model name remains the primary term; SKU IDs are additional historical/current aliases.
  const matchingTerms = termMatcher(searchTerms);
  // 모델번호 숫자 부분(wd011917 → 011917). 접두어가 다른 모델이 같은 번호를 쓰는 경우가 많아(we011792/wr011792 등)
  // 숫자만으로는 검색하지 않고, 이 모델 사진이 실제로 들어 있는 상위 폴더를 확인할 때만 쓴다.
  const modelNumbers = new Set(searchTerms.map(term => term.trim().match(/^[a-z]{2,3}(\d{4,})$/i)?.[1]).filter(Boolean));
  const sameModelNumber = (name: string) => (name.match(/[a-z]{2,3}\d{4,}/gi) || [])
    .some(code => modelNumbers.has(code.match(/\d+$/)![0]));
  const found: LocalPhoto[] = [];
  const seen = new Set(existing.map(photo => duplicateKey(photo.file)));
  const ids = new Set(existing.map(photo => photo.id));
  const parentFolders = new Map<string, FileSystemDirectoryHandle>();
  async function add(entry: any, id: string, name: string, matchedBy: string[]) {
    const file = await entry.getFile() as File;
    if (seen.has(duplicateKey(file))) return;
    seen.add(duplicateKey(file));
    ids.add(id);
    found.push({ id, name, file, matchedBy });
  }
  type Ancestor = { name: string; id: string; handle: FileSystemDirectoryHandle };
  async function walk(dir: FileSystemDirectoryHandle, prefix: string, inheritedMatches: string[], ancestors: Ancestor[]) {
    for await (const [name, entry] of (dir as any).entries()) {
      if (existing.length + found.length >= MAX_PHOTOS) return;
      if (name.startsWith(".")) continue;
      const id = `${prefix}/${name}`;
      if (ids.has(id)) continue;
      const ownMatches = matchingTerms(name);
      // 여러 모델을 담은 묶음 폴더(예: "wn011229 ws011231 ws011232돼지코…") 안의 다른 모델 폴더
      // (wr011231 반지, wa011143 체인 등)는 묶음 폴더 이름의 일치를 물려받지 않는다.
      const otherModelFolder = entry.kind === "directory" && OTHER_MODEL_FOLDER.test(name) && !ownMatches.length;
      const matchedBy = [...new Set([...(otherModelFolder ? [] : inheritedMatches), ...ownMatches])];
      if (entry.kind === "directory") await walk(entry, id, matchedBy, [...ancestors, { name, id, handle: entry }]);
      else if (matchedBy.length > 0 && IMAGE_FILE.test(name)) {
        await add(entry, id, name, matchedBy);
        // 예: ws011917 실버별똑딱핀/1000/wd011917.0.jpg — 작업 단계 폴더를 거슬러 올라간 제품 폴더가
        // 같은 모델번호를 달고 있으면, 그 폴더의 보정·원본·상세페이지 사진도 함께 연다.
        let at = ancestors.length - 1;
        while (at > 0 && WORK_STAGE_FOLDER.test(ancestors[at].name)) at -= 1;
        if (at > 0 && at < ancestors.length - 1 && sameModelNumber(ancestors[at].name)) parentFolders.set(ancestors[at].id, ancestors[at].handle);
      }
    }
  }
  async function collect(dir: FileSystemDirectoryHandle, prefix: string) {
    for await (const [name, entry] of (dir as any).entries()) {
      if (existing.length + found.length >= MAX_PHOTOS) return;
      if (name.startsWith(".")) continue;
      const id = `${prefix}/${name}`;
      if (entry.kind === "directory") await collect(entry, id);
      else if (!ids.has(id) && IMAGE_FILE.test(name)) await add(entry, id, name, [SAME_MODEL_PARENT_LABEL]);
    }
  }
  await walk(root, root.name, matchingTerms(root.name), [{ name: root.name, id: root.name, handle: root }]);
  for (const [id, handle] of parentFolders) await collect(handle, id);
  return found.sort((a, b) => a.id.localeCompare(b.id, "ko"));
}

/** analysisId 사진을 맨 앞에 둔다 — 등록도우미는 첫 장을 AI 분석용으로, 전체를 업로드 풀로 쓴다. */
export async function savePreparedPhotos(model: string, photos: LocalPhoto[], analysisId = "") {
  const ordered = [...photos.filter(photo => photo.id === analysisId), ...photos.filter(photo => photo.id !== analysisId)];
  const result = await Promise.all(ordered.slice(0, MAX_SELECTED_PHOTOS).map(async photo => ({
    id: photo.id, name: photo.name, dataUrl: await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(photo.file);
    }),
  })));
  await write("prepared", { model, photos: result });
}

export async function loadPreparedPhotos(model: string): Promise<PreparedPhoto[]> {
  const saved = await read<{ model: string; photos: PreparedPhoto[] }>("prepared");
  return saved?.model === model ? saved.photos : [];
}

export async function savePreparedDetail(model: string, detail?: LocalPhoto) {
  await write("prepared-detail", { model, detail: detail ? { id: detail.id, name: detail.name, file: detail.file } : null });
}

export async function loadPreparedDetail(model: string): Promise<PreparedDetail | null> {
  const saved = await read<{ model: string; detail: PreparedDetail | null }>("prepared-detail");
  return saved?.model === model ? saved.detail : null;
}
