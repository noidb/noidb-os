import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";

export const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp", ".heic", ".heif", ".avif"]);
export type SearchRoot = { id: string; label: string; path: string; enabled: boolean; kind: "mybox" | "drive" | "pc" };
export type ImageHit = { id: string; path: string; rootId: string; rootLabel: string; fileName: string; size: number; modifiedAt: number; sha256: string; signature: string; match: string; duplicate: boolean; similarity: number | null; width: number | null; height: number | null; estimate: "원본" | "보정" | "편집" };

const indexPath = path.join(os.homedir(), ".noidb", "image-search-index.json");
const roots: SearchRoot[] = [
  { id: "mybox", label: "N:\\개인\\★전체제품사진 (MYBOX)", path: "N:\\개인\\★전체제품사진", enabled: true, kind: "mybox" },
  { id: "mybox-thumbnails", label: "N:\\개인\\썸네일모음 (MYBOX)", path: "N:\\개인\\썸네일모음", enabled: true, kind: "mybox" },
  { id: "mybox-photo-work", label: "N:\\개인\\중요!! ★사진작업★ (MYBOX)", path: "N:\\개인\\중요!! ★사진작업★", enabled: true, kind: "mybox" },
];
const excluded = new Set(["node_modules", ".git", ".next", "dist", "build", "AppData", "Windows", "$Recycle.Bin"]);
const safeName = (p: string) => p.toLowerCase().replace(/[\\/]+/g, "/");

async function walk(dir: string, out: string[] = []) {
  let entries: import("node:fs").Dirent[];
  try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (e.name.startsWith(".") || excluded.has(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) await walk(full, out);
    else if (IMAGE_EXTENSIONS.has(path.extname(e.name).toLowerCase())) out.push(full);
  }
  return out;
}
function dimensions(buf: Buffer) {
  if (buf.length > 24 && buf[0] === 0x89 && buf[1] === 0x50) return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  if (buf.length > 10 && buf.toString("ascii", 0, 3) === "GIF") return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
  return { width: null, height: null };
}
async function digest(file: string) {
  const hash = crypto.createHash("sha256"); const sample = crypto.createHash("sha1");
  const data = await fs.readFile(file); hash.update(data); sample.update(data.subarray(0, Math.min(data.length, 65536)));
  return { sha256: hash.digest("hex"), signature: sample.digest("hex").slice(0, 16), dimensions: dimensions(data.subarray(0, 65536)) };
}
export function getSearchRoots() { return roots; }
export async function searchImages(model: string, enabledRootIds: string[]) {
  const selected = roots.filter(r => enabledRootIds.includes(r.id));
  const files = (await Promise.all(selected.map(r => walk(r.path)))).flat();
  const existing = new Map<string, any>();
  try { const saved = JSON.parse(await fs.readFile(indexPath, "utf8")); for (const item of saved) existing.set(item.path, item); } catch {}
  const hits: ImageHit[] = [];
  for (const file of files) {
    let stat; try { stat = await fs.stat(file); } catch { continue; }
    let item = existing.get(file); if (!item || item.size !== stat.size || item.modifiedAt !== stat.mtimeMs) { const d = await digest(file); item = { path: file, size: stat.size, modifiedAt: stat.mtimeMs, ...d }; existing.set(file, item); }
    const root = selected.find(r => safeName(file).startsWith(safeName(r.path)))!;
    const lower = safeName(file), nameMatch = lower.includes(model.toLowerCase()), folderMatch = safeName(path.dirname(file)).includes(model.toLowerCase());
    if (!nameMatch && !folderMatch && !lower.includes("상품사진") && !lower.includes("product")) continue;
    hits.push({ id: crypto.createHash("sha1").update(file).digest("hex"), path: file, rootId: root.id, rootLabel: root.label, fileName: path.basename(file), size: stat.size, modifiedAt: stat.mtimeMs, sha256: item.sha256, signature: item.signature, match: nameMatch ? "파일명" : folderMatch ? "폴더명" : "주변 이미지", duplicate: false, similarity: null, width: item.dimensions.width, height: item.dimensions.height, estimate: /edit|편집/i.test(file) ? "편집" : /retouch|보정|clean/i.test(file) ? "보정" : "원본" });
  }
  const byHash = new Map<string, ImageHit[]>(); for (const h of hits) byHash.set(h.sha256, [...(byHash.get(h.sha256) || []), h]);
  for (const group of byHash.values()) if (group.length > 1) group.slice(1).forEach(h => { h.duplicate = true; });
  await fs.mkdir(path.dirname(indexPath), { recursive: true }); await fs.writeFile(indexPath, JSON.stringify([...existing.values()]), "utf8");
  return hits;
}
