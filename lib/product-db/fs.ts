import type { ProductDbFile } from "./files";
import { PRODUCT_DB_SUBFOLDERS } from "./files";

async function getOrCreateDir(
  parent: FileSystemDirectoryHandle,
  name: string
) {
  return parent.getDirectoryHandle(name, { create: true });
}

export async function ensureProductFolderTree(
  root: FileSystemDirectoryHandle,
  category: string,
  model: string
) {
  const categoryDir = await getOrCreateDir(root, category);
  const modelDir = await getOrCreateDir(categoryDir, model);
  for (const folder of PRODUCT_DB_SUBFOLDERS) {
    await getOrCreateDir(modelDir, folder);
  }
  return modelDir;
}

export async function writeProductDbFiles(
  root: FileSystemDirectoryHandle,
  category: string,
  model: string,
  files: ProductDbFile[]
) {
  const modelDir = await ensureProductFolderTree(root, category, model);
  const saved: string[] = [];

  for (const file of files) {
    const folder = await getOrCreateDir(modelDir, file.folder);
    const handle = await folder.getFileHandle(file.filename, { create: true });
    const writable = await handle.createWritable();
    await writable.write(file.blob);
    await writable.close();
    saved.push(`${category}/${model}/${file.path}`);
  }

  return saved;
}
