import type { QuoteCategoryOptions } from "@/lib/excel/quote";
import { readCategoryTemplate, readProductOptions } from "./store";

/** 카테고리 설정(올린 쿠팡 양식·경로·기본값)을 읽는다. 설정을 못 읽으면 예전 방식(기본 양식)으로 만든다. */
export async function categoryQuoteOptions(categoryName: string, allowMissingRequired: boolean): Promise<QuoteCategoryOptions> {
  const options: QuoteCategoryOptions = { allowMissingRequired };
  let config;
  try { config = await readProductOptions(); } catch { return options; }
  const category = config.categories.find(item => item.name === categoryName);
  if (!category) return options;
  if (category.template?.blobPath) {
    const template = await readCategoryTemplate(category, categoryName);
    if (template) options.template = template;
  }
  const paths = category.paths || {};
  if (Object.keys(paths).length) options.path = gender => paths[gender] || "";
  if (category.defaults && Object.keys(category.defaults).length) options.defaults = category.defaults;
  return options;
}
