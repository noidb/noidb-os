// The photo root is local to this browser. No files are uploaded or moved.
export type LocalPhoto = { id: string; name: string; file: File; matchedBy: string[] };
export type PreparedPhoto = { id: string; name: string; dataUrl: string };
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
  const label = FOLDER_TIER_LABELS[tier];
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
export type SavedPhotoSearch = { hits: { id: string; matchedBy: string[] }[]; selectedIds: string[]; analysisId: string; savedAt: string; level?: number; grouped?: boolean; hasFolders?: boolean };

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

export async function searchPhotoFolder(searchTerms: string[], existing: LocalPhoto[] = []): Promise<LocalPhoto[]> {
  const root = await connectedRoot();
  if (!searchTerms.some(term => term.trim())) return [];
  // Model name remains the primary term; SKU IDs are additional historical/current aliases.
  const matchingTerms = termMatcher(searchTerms);
  const found: LocalPhoto[] = [];
  const seen = new Set(existing.map(photo => duplicateKey(photo.file)));
  const existingIds = new Set(existing.map(photo => photo.id));
  async function walk(dir: FileSystemDirectoryHandle, prefix: string, inheritedMatches: string[]) {
    for await (const [name, entry] of (dir as any).entries()) {
      if (existing.length + found.length >= MAX_PHOTOS) return;
      if (name.startsWith(".")) continue;
      const id = `${prefix}/${name}`;
      if (existingIds.has(id)) continue;
      const matchedBy = [...new Set([...inheritedMatches, ...matchingTerms(name)])];
      if (entry.kind === "directory") await walk(entry, id, matchedBy);
      else if (matchedBy.length > 0 && IMAGE_FILE.test(name)) {
        const file = await entry.getFile() as File;
        if (seen.has(duplicateKey(file))) continue;
        seen.add(duplicateKey(file));
        found.push({ id, name, file, matchedBy });
      }
    }
  }
  await walk(root, root.name, matchingTerms(root.name));
  return found.sort((a, b) => a.id.localeCompare(b.id, "ko"));
}

/** analysisId 사진을 맨 앞에 둔다 — 등록도우미는 첫 장을 AI 분석용으로, 전체를 업로드 풀로 쓴다. */
export async function savePreparedPhotos(model: string, photos: LocalPhoto[], analysisId = "") {
  const ordered = [...photos.filter(photo => photo.id === analysisId), ...photos.filter(photo => photo.id !== analysisId)];
  const result = await Promise.all(ordered.slice(0, 10).map(async photo => ({
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
