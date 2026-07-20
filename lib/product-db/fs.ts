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
  files: ProductDbFile[]
) {
  const categoryDir = await getOrCreateDir(root, category);
  const modelDir = await getOrCreateDir(categoryDir, model);
  const saved: string[] = [];

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
