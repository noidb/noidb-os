import JSZip from "jszip";
import type { ProductDbFile } from "./files";

/** ZIP mirrors 상품DB/카테고리/모델명/*.files */
export async function buildProductDbZip(
  category: string,
  model: string,
  files: ProductDbFile[]
) {
  const zip = new JSZip();
  const folder = zip.folder(category)?.folder(model);
  if (!folder) throw new Error("ZIP 폴더를 만들 수 없습니다.");
  for (const file of files) {
    folder.file(file.filename, file.blob);
  }
  return zip.generateAsync({ type: "blob" });
}
