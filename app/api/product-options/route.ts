import { NextRequest, NextResponse } from "next/server";
import { changeProductOptions, readCategoryTemplateInfo, readProductOptions, saveTemplateFile } from "@/lib/product-options/store";
import { parseCoupangTemplate } from "@/lib/product-options/template-parse";
import type { CategoryConfig, OptionListKey, ProductOptionsConfig } from "@/lib/product-options/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const NO_STORE = { "Cache-Control": "no-store" };
const LISTS: OptionListKey[] = ["suppliers", "genders", "materials"];

const fail = (message: string, status = 400) => NextResponse.json({ error: message }, { status, headers: NO_STORE });
const clean = (value: unknown, max = 60) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);

function move<T>(list: T[], index: number, direction: number): T[] {
  const target = index + direction;
  if (index < 0 || target < 0 || target >= list.length) return list;
  const next = [...list];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

export async function GET(request: NextRequest) {
  try {
    const config = await readProductOptions();
    const categoryName = request.nextUrl.searchParams.get("templateInfo");
    if (categoryName) {
      const category = config.categories.find(item => item.name === categoryName);
      const info = await readCategoryTemplateInfo(category, categoryName);
      return NextResponse.json({ config, info }, { headers: NO_STORE });
    }
    return NextResponse.json({ config }, { headers: NO_STORE });
  } catch (error) {
    return fail(error instanceof Error ? error.message : "목록 설정을 읽지 못했습니다.", 500);
  }
}

type Body = {
  action?: string;
  list?: OptionListKey;
  value?: string;
  from?: string;
  to?: string;
  direction?: number;
  original?: string;
  category?: Partial<CategoryConfig>;
};

export async function POST(request: NextRequest) {
  try {
    if ((request.headers.get("content-type") || "").includes("multipart/form-data")) return uploadTemplate(request);
    const body = await request.json() as Body;
    const action = body.action || "";
    const direction = body.direction === -1 ? -1 : 1;

    if (["addItem", "removeItem", "renameItem", "moveItem"].includes(action)) {
      const list = body.list as OptionListKey;
      if (!LISTS.includes(list)) return fail("목록 종류가 올바르지 않습니다.");
      const value = clean(body.value);
      if (!value && action !== "renameItem") return fail("이름을 입력해주세요.");
      const config = await changeProductOptions(config => {
        const items = config[list];
        if (action === "addItem") {
          if (!items.includes(value)) items.push(value);
          if (list === "suppliers") config.removedSuppliers = config.removedSuppliers.filter(item => item !== value);
        } else if (action === "removeItem") {
          config[list] = items.filter(item => item !== value);
          if (list === "suppliers" && !config.removedSuppliers.includes(value)) config.removedSuppliers.push(value);
        } else if (action === "renameItem") {
          const from = clean(body.from), to = clean(body.to);
          if (!from || !to) return;
          config[list] = [...new Set(items.map(item => item === from ? to : item))];
          if (list === "suppliers") {
            if (!config.removedSuppliers.includes(from)) config.removedSuppliers.push(from);
            config.removedSuppliers = config.removedSuppliers.filter(item => item !== to);
          }
        } else {
          config[list] = move(items, items.indexOf(value), direction);
        }
      });
      return NextResponse.json({ config }, { headers: NO_STORE });
    }

    if (action === "saveCategory") {
      const input = body.category || {};
      const name = clean(input.name, 30);
      const letter = clean(input.letter, 4).toLowerCase();
      if (!name) return fail("카테고리 이름을 입력해주세요.");
      if (!/^[a-z]{1,4}$/.test(letter)) return fail("모델명 글자는 영어 소문자로 1~4글자 입력해주세요. 예) 반지 r → wr0001");
      const original = clean(body.original, 30);
      let error = "";
      const config = await changeProductOptions(config => {
        const others = config.categories.filter(item => item.name !== (original || name));
        if (others.some(item => item.name === name)) { error = `'${name}' 카테고리가 이미 있습니다.`; return; }
        const sameLetter = others.find(item => item.letter === letter);
        if (sameLetter) { error = `모델명 글자 '${letter}'는 '${sameLetter.name}'에서 이미 쓰고 있습니다. 다른 글자를 정해주세요.`; return; }
        const existing = config.categories.find(item => item.name === (original || name));
        const paths = Object.fromEntries(Object.entries(input.paths || {}).map(([key, value]) => [clean(key), String(value ?? "").trim()]).filter(([, value]) => value));
        const defaults = Object.fromEntries(Object.entries(input.defaults || {}).map(([key, value]) => [String(key).trim(), String(value ?? "").trim()]).filter(([key, value]) => key && value));
        const next: CategoryConfig = { ...existing, name, letter, paths, defaults };
        if (existing) config.categories = config.categories.map(item => item === existing ? next : item);
        else config.categories.push(next);
      });
      if (error) return fail(error);
      return NextResponse.json({ config }, { headers: NO_STORE });
    }

    if (action === "removeCategory" || action === "moveCategory") {
      const name = clean(body.value, 30);
      const config = await changeProductOptions((config: ProductOptionsConfig) => {
        const index = config.categories.findIndex(item => item.name === name);
        if (action === "removeCategory") {
          if (config.categories.length > 1) config.categories = config.categories.filter(item => item.name !== name);
        } else {
          config.categories = move(config.categories, index, direction);
        }
      });
      return NextResponse.json({ config }, { headers: NO_STORE });
    }

    return fail("알 수 없는 요청입니다.");
  } catch (error) {
    return fail(error instanceof Error ? error.message : "목록 설정을 저장하지 못했습니다.", 500);
  }
}

async function uploadTemplate(request: NextRequest) {
  const form = await request.formData();
  const name = clean(form.get("category"), 30);
  const file = form.get("file");
  if (!name) return fail("카테고리를 먼저 저장해주세요.");
  if (!(file instanceof File)) return fail("양식 파일을 골라주세요.");
  if (!/\.xlsx$/i.test(file.name)) return fail("엑셀(.xlsx) 파일만 올릴 수 있습니다.");
  if (file.size > 4 * 1024 * 1024) return fail("양식 파일이 너무 큽니다(4MB 이하).");
  const buffer = Buffer.from(await file.arrayBuffer());
  const info = await parseCoupangTemplate(buffer, file.name);
  const current = await readProductOptions();
  if (!current.categories.some(item => item.name === name)) return fail("카테고리를 먼저 저장해주세요.");
  const template = await saveTemplateFile(name, file.name, buffer);
  const config = await changeProductOptions(config => {
    config.categories = config.categories.map(item => {
      if (item.name !== name) return item;
      const paths = { ...(item.paths || {}) };
      // 경로가 비어 있으면 양식의 경로를 성별에 맞춰 미리 골라 둔다(여성/남성/공용 글자가 들어간 경로).
      for (const gender of config.genders) {
        if (paths[gender] && info.categoryPaths.includes(paths[gender])) continue;
        const word = gender === "남녀공용" ? "공용" : gender;
        paths[gender] = info.categoryPaths.find(value => value.includes(word)) || info.categoryPaths[0] || "";
      }
      return { ...item, template, paths };
    });
  });
  return NextResponse.json({ config, info }, { headers: NO_STORE });
}
