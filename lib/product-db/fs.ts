import type { ProductDbFile } from "./files";

async function getOrCreateDir(parent: FileSystemDirectoryHandle, name: string) {
  return parent.getDirectoryHandle(name, { create: true });
}

function isNotFoundError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "NotFoundError";
}

async function fileExists(directory: FileSystemDirectoryHandle, filename: string): Promise<boolean> {
  try {
    await directory.getFileHandle(filename);
    return true;
  } catch (error) {
    if (isNotFoundError(error)) return false;
    throw error;
  }
}

/**
 * Save into 상품DB/카테고리/모델명/ (flat inside model folder).
 */
export async function writeProductDbFiles(
  root: FileSystemDirectoryHandle,
  category: string,
  model: string,
  files: ProductDbFile[],
  options: { overwriteExisting?: boolean } = {}
) {
  const categoryDir = await getOrCreateDir(root, category);
  const modelDir = await getOrCreateDir(categoryDir, model);
  const saved: string[] = [];
  const created: { directory: FileSystemDirectoryHandle; filename: string }[] = [];

  if (options.overwriteExisting === false) {
    await assertProductDbFilesWritable(root, category, model, files);
  }

  try {
    for (const file of files) {
      const targetDir = file.folder
        ? await getOrCreateDir(modelDir, file.folder)
        : modelDir;
      if (options.overwriteExisting === false && await fileExists(targetDir, file.filename)) {
        throw new Error(`저장 직전에 기존 파일이 확인되어 중단했습니다: ${file.folder ? `${file.folder}/` : ""}${file.filename}`);
      }
      const handle = await targetDir.getFileHandle(file.filename, { create: true });
      if (options.overwriteExisting === false) created.push({ directory: targetDir, filename: file.filename });
      const writable = await handle.createWritable();
      await writable.write(file.blob);
      await writable.close();
      saved.push(`${category}/${model}/${file.folder ? `${file.folder}/` : ""}${file.filename}`);
    }
  } catch (error) {
    if (options.overwriteExisting === false) {
      await Promise.allSettled(created.map(({ directory, filename }) => directory.removeEntry(filename)));
    }
    throw error;
  }

  return saved;
}

export async function ensureProductFolderTree(
  root: FileSystemDirectoryHandle,
  category: string,
  model: string
) {
  const categoryDir = await getOrCreateDir(root, category);
  return getOrCreateDir(categoryDir, model);
}

/** Save only one shared file into an existing category folder. */
export async function writeCategoryFile(
  root: FileSystemDirectoryHandle,
  category: string,
  filename: string,
  blob: Blob,
) {
  const categoryDir = await root.getDirectoryHandle(category);
  const handle = await categoryDir.getFileHandle(filename, { create: true });
  const writable = await handle.createWritable();
  await writable.write(blob);
  await writable.close();
  return `${category}/${filename}`;
}

export async function assertProductDbFilesWritable(
  root: FileSystemDirectoryHandle,
  category: string,
  model: string,
  files: ProductDbFile[]
) {
  const categoryDir = await getOrCreateDir(root, category);
  const modelDir = await getOrCreateDir(categoryDir, model);
  const existing: string[] = [];
  for (const file of files) {
    const targetDir = file.folder ? await getOrCreateDir(modelDir, file.folder) : modelDir;
    try {
      await targetDir.getFileHandle(file.filename);
      existing.push(`${file.folder ? `${file.folder}/` : ""}${file.filename}`);
    } catch (error) {
      if (!isNotFoundError(error)) throw error;
    }
  }
  if (existing.length > 0) throw new Error(`기존 파일 ${existing.length}개가 있어 일괄 저장을 중단했습니다: ${existing.slice(0, 5).join(", ")}${existing.length > 5 ? " 외" : ""}`);
}

export async function rootFolderFileExists(
  root: FileSystemDirectoryHandle,
  folder: string,
  filename: string,
) {
  const targetDir = await getOrCreateDir(root, folder);
  return fileExists(targetDir, filename);
}

/** Save one independently generated file into 상품이미지DB/<folder>/. */
export async function writeRootFolderFile(
  root: FileSystemDirectoryHandle,
  folder: string,
  filename: string,
  blob: Blob,
  options: { overwriteExisting?: boolean } = {},
) {
  const targetDir = await getOrCreateDir(root, folder);
  if (options.overwriteExisting === false && await fileExists(targetDir, filename)) {
    throw new Error(`기존 파일이 있어 저장을 중단했습니다: ${folder}/${filename}`);
  }
  const handle = await targetDir.getFileHandle(filename, { create: true });
  const writable = await handle.createWritable();
  await writable.write(blob);
  await writable.close();
  return `${folder}/${filename}`;
}
