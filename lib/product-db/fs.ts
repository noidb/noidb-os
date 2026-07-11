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
    const handle = await modelDir.getFileHandle(file.filename, { create: true });
    const writable = await handle.createWritable();
    await writable.write(file.blob);
    await writable.close();
    saved.push(`${category}/${model}/${file.filename}`);
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
