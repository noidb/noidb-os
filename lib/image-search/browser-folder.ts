// The photo root is local to this browser. No files are uploaded or moved.
export type LocalPhoto = { id: string; name: string; file: File };
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

export async function photoFolderName() {
  return (await read<FileSystemDirectoryHandle>("root"))?.name || "";
}

export async function searchPhotoFolder(model: string): Promise<LocalPhoto[]> {
  const root = await read<FileSystemDirectoryHandle>("root");
  if (!root) throw new Error("먼저 ‘사진 원본 폴더 연결’을 눌러 MYBOX 동기화 폴더를 선택해주세요.");
  if (await root.queryPermission({ mode: "read" }) !== "granted" && await root.requestPermission({ mode: "read" }) !== "granted") {
    throw new Error("사진 폴더 읽기 권한이 필요합니다. 사진 원본 폴더를 다시 연결해주세요.");
  }
  const needle = model.trim().toLowerCase();
  if (!needle) return [];
  // A numeric boundary prevents model 123 from matching model 1234.
  const matches = (value: string) => {
    const name = value.toLowerCase();
    const at = name.indexOf(needle);
    return at >= 0 && !/[a-z0-9]/i.test(name[at - 1] || "") && !/\d/.test(name[at + needle.length] || "");
  };
  const found: LocalPhoto[] = [];
  async function walk(dir: FileSystemDirectoryHandle, prefix: string, matched: boolean) {
    for await (const [name, entry] of (dir as any).entries()) {
      if (found.length >= 100) return;
      if (name.startsWith(".")) continue;
      const id = `${prefix}/${name}`;
      if (entry.kind === "directory") await walk(entry, id, matched || matches(name));
      else if ((matched || matches(name)) && /\.(jpe?g|png|webp)$/i.test(name)) {
        found.push({ id, name, file: await entry.getFile() });
      }
    }
  }
  await walk(root, root.name, matches(root.name));
  return found.sort((a, b) => a.id.localeCompare(b.id, "ko"));
}

export async function savePreparedPhotos(model: string, photos: LocalPhoto[]) {
  const result = await Promise.all(photos.slice(0, 10).map(async photo => ({
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
