/**
 * Local storage helpers. Drive adapter can wrap the same file list later.
 */
import type { ProductDbFile } from "./files";
import { writeProductDbFiles } from "./fs";

export type StorageBackend = "local" | "drive";

export async function saveProductDbLocal(
  root: FileSystemDirectoryHandle,
  category: string,
  model: string,
  files: ProductDbFile[]
) {
  const saved = await writeProductDbFiles(root, category, model, files);
  return { backend: "local" as const, saved };
}
