import JSZip from "jszip";
import type { ProductDbFile } from "./files";

/** Flat ZIP: all files at the root of the archive (no nested folders). */
export async function buildProductDbZip(
  _category: string,
  _model: string,
  files: ProductDbFile[]
) {
  const zip = new JSZip();
  for (const file of files) {
    zip.file(file.filename, file.blob);
  }
  return zip.generateAsync({ type: "blob" });
}
