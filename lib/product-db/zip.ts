import JSZip from "jszip";
import type { ProductDbFile } from "./files";

export async function buildProductDbZip(
  category: string,
  model: string,
  files: ProductDbFile[]
) {
  const zip = new JSZip();
  const base = zip.folder(category)?.folder(model);
  if (!base) throw new Error("ZIP 폴더를 만들 수 없습니다.");

  for (const file of files) {
    base.file(file.filename, file.blob);
  }

  return zip.generateAsync({ type: "blob" });
}
