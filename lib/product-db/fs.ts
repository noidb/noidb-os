import type { ProductDbFile } from "./files";
import { createLocalStorage } from "./storage";

/**
 * Save all product files directly into the selected 상품DB root folder.
 * No category/model subfolders.
 */
export async function writeProductDbFiles(
  root: FileSystemDirectoryHandle,
  _category: string,
  _model: string,
  files: ProductDbFile[]
) {
  const storage = createLocalStorage(root);
  const result = await storage.saveFlat(files);
  return result.saved;
}

/** @deprecated Kept for compatibility — no longer creates nested folders. */
export async function ensureProductFolderTree(
  root: FileSystemDirectoryHandle,
  _category: string,
  _model: string
) {
  return root;
}
