import JSZip from "jszip";
import type { ProductDbFile } from "./files";
import { PRODUCT_DB_SUBFOLDERS } from "./files";

export async function buildProductDbZip(
  category: string,
  model: string,
  files: ProductDbFile[]
) {
  const zip = new JSZip();
  const base = zip.folder(category)?.folder(model);
  if (!base) throw new Error("ZIP 폴더를 만들 수 없습니다.");

  for (const folder of PRODUCT_DB_SUBFOLDERS) {
    base.folder(folder);
  }

  for (const file of files) {
    const dir = base.folder(file.folder);
    if (!dir) continue;
    dir.file(file.filename, file.blob);
  }

  return zip.generateAsync({ type: "blob" });
}
