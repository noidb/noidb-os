import type { ProductDbFile } from "./files";

async function getOrCreateDir(parent: FileSystemDirectoryHandle, name: string) {
  return parent.getDirectoryHandle(name, { create: true });
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

  if (options.overwriteExisting === false) {
    await assertProductDbFilesWritable(root, category, model, files);
  }

  for (const file of files) {
    const targetDir = file.folder
      ? await getOrCreateDir(modelDir, file.folder)
      : modelDir;
    const handle = await targetDir.getFileHandle(file.filename, { create: true });
    const writable = await handle.createWritable();
    await writable.write(file.blob);
    await writable.close();
    saved.push(`${category}/${model}/${file.folder ? `${file.folder}/` : ""}${file.filename}`);
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
      if (!(error instanceof DOMException) || error.name !== "NotFoundError") throw error;
    }
  }
  if (existing.length > 0) throw new Error(`기존 파일 ${existing.length}개가 있어 일괄 저장을 중단했습니다: ${existing.slice(0, 5).join(", ")}${existing.length > 5 ? " 외" : ""}`);
}

/** Save one independently generated file into 상품이미지DB/<folder>/. */
export async function writeRootFolderFile(
  root: FileSystemDirectoryHandle,
  folder: string,
  filename: string,
  blob: Blob,
) {
  const targetDir = await getOrCreateDir(root, folder);
  const handle = await targetDir.getFileHandle(filename, { create: true });
  const writable = await handle.createWritable();
  await writable.write(blob);
  await writable.close();
  return `${folder}/${filename}`;
}
