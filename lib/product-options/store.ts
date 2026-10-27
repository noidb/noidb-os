import { promises as fs } from "node:fs";
import path from "node:path";
import { BlobPreconditionFailedError, put } from "@vercel/blob";
import { getFreshPrivateBlob } from "@/lib/wms/fresh-blob-get";
import { templateFileForCategory, templatesDir } from "@/lib/excel/common";
import { defaultProductOptions, normalizeProductOptions } from "./defaults";
import { parseCoupangTemplate } from "./template-parse";
import type { CategoryConfig, ProductOptionsConfig, TemplateInfo } from "./types";

const ROOT = "noidb-wms/product-options/v1";
const CONFIG_PATH = `${ROOT}/options.json`;
const LOCAL_DIR = path.join(process.cwd(), ".secrets", "product-options");
let localQueue: Promise<unknown> = Promise.resolve();

function useBlob(): boolean {
  return Boolean(process.env.VERCEL || process.env.BLOB_READ_WRITE_TOKEN);
}

async function readConfigRaw(): Promise<{ config: ProductOptionsConfig; etag?: string; exists: boolean }> {
  if (!useBlob()) {
    try {
      return { config: normalizeProductOptions(JSON.parse(await fs.readFile(path.join(LOCAL_DIR, "options.json"), "utf8"))), exists: true };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return { config: defaultProductOptions(), exists: false };
      throw error;
    }
  }
  const result = await getFreshPrivateBlob(CONFIG_PATH);
  if (!result || result.statusCode !== 200) return { config: defaultProductOptions(), exists: false };
  return { config: normalizeProductOptions(JSON.parse(await new Response(result.stream).text())), etag: result.blob.etag, exists: true };
}

export async function readProductOptions(): Promise<ProductOptionsConfig> {
  return (await readConfigRaw()).config;
}

/** 저장 충돌이 나면 최신 저장본을 다시 읽어 같은 변경을 다시 적용한다(최대 6번). */
export async function changeProductOptions(change: (config: ProductOptionsConfig) => ProductOptionsConfig | void): Promise<ProductOptionsConfig> {
  const work = localQueue.then(async () => {
    for (let attempt = 0; attempt < 6; attempt++) {
      const { config, etag, exists } = await readConfigRaw();
      const draft = structuredClone(config);
      const next = normalizeProductOptions(change(draft) || draft);
      next.updatedAt = new Date().toISOString();
      const body = JSON.stringify(next);
      if (!useBlob()) {
        await fs.mkdir(LOCAL_DIR, { recursive: true });
        const temporary = path.join(LOCAL_DIR, `options.${process.pid}.tmp`);
        await fs.writeFile(temporary, body, "utf8");
        await fs.rename(temporary, path.join(LOCAL_DIR, "options.json"));
        return next;
      }
      try {
        await put(CONFIG_PATH, body, {
          access: "private", addRandomSuffix: false, contentType: "application/json",
          ...(exists && etag ? { allowOverwrite: true, ifMatch: etag } : { allowOverwrite: false }),
        });
        return next;
      } catch (error) {
        const conflict = error instanceof BlobPreconditionFailedError || /already exists/i.test(String((error as Error)?.message || ""));
        if (!conflict || attempt === 5) throw error;
        await new Promise(resolve => setTimeout(resolve, 300 * (attempt + 1)));
      }
    }
    throw new Error("목록 설정을 저장하지 못했습니다. 잠시 뒤 다시 눌러주세요.");
  });
  localQueue = work.catch(() => undefined);
  return work;
}

function safeName(value: string) {
  return value.replace(/[^0-9A-Za-z가-힣._-]+/g, "_").slice(0, 60) || "template";
}

export async function saveTemplateFile(category: string, fileName: string, buffer: Buffer) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const name = `${safeName(category)}_${stamp}.xlsx`;
  if (!useBlob()) {
    const dir = path.join(LOCAL_DIR, "templates");
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, name), buffer);
    return { blobPath: `local:${name}`, fileName, uploadedAt: new Date().toISOString() };
  }
  const blobPath = `${ROOT}/templates/${name}`;
  await put(blobPath, buffer, {
    access: "private", addRandomSuffix: false, allowOverwrite: false,
    contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  return { blobPath, fileName, uploadedAt: new Date().toISOString() };
}

/** 카테고리에 쓸 양식 파일. 올린 양식이 우선이고, 없으면 기본 제공 양식(templates 폴더). */
export async function readCategoryTemplate(category: CategoryConfig | undefined, categoryName: string): Promise<{ buffer: Buffer; fileName: string } | null> {
  const ref = category?.template;
  if (ref?.blobPath) {
    if (ref.blobPath.startsWith("local:")) {
      return { buffer: await fs.readFile(path.join(LOCAL_DIR, "templates", ref.blobPath.slice(6))), fileName: ref.fileName };
    }
    const result = await getFreshPrivateBlob(ref.blobPath);
    if (!result || result.statusCode !== 200) throw new Error(`${categoryName} 쿠팡 양식 파일을 불러오지 못했습니다. 카테고리 설정에서 양식을 다시 올려주세요.`);
    return { buffer: Buffer.from(await new Response(result.stream).arrayBuffer()), fileName: ref.fileName };
  }
  const builtin = templateFileForCategory(categoryName);
  if (!builtin) return null;
  return { buffer: await fs.readFile(path.join(templatesDir(), builtin)), fileName: builtin };
}

const infoCache = new Map<string, Promise<TemplateInfo>>();

export async function readCategoryTemplateInfo(category: CategoryConfig | undefined, categoryName: string): Promise<TemplateInfo | null> {
  const key = category?.template?.blobPath || `builtin:${templateFileForCategory(categoryName) || ""}`;
  if (key === "builtin:") return null;
  if (!infoCache.has(key)) {
    infoCache.set(key, (async () => {
      const template = await readCategoryTemplate(category, categoryName);
      if (!template) throw new Error("양식 없음");
      return parseCoupangTemplate(template.buffer, template.fileName);
    })());
  }
  try {
    return await infoCache.get(key)!;
  } catch (error) {
    infoCache.delete(key);
    throw error;
  }
}
