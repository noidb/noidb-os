import { promises as fs } from "node:fs";
import path from "node:path";
import { put } from "@vercel/blob";
import { readWeeklyBlob } from "./weekly-work-blob";

const folder = () => process.env.WMS_WEEKLY_WORK_FILES_DIR || path.join(process.cwd(), ".secrets", "weekly-files");
const blob = () => !process.env.WMS_WEEKLY_WORK_FILES_DIR && Boolean(process.env.VERCEL || process.env.BLOB_READ_WRITE_TOKEN);
function check(key: string) { if (!/^(image|output)-[a-f0-9]{64}\.(json|bin)$/.test(key)) throw new Error("파일 주소가 올바르지 않습니다."); }
export async function readWeeklyFile(key: string): Promise<Buffer | null> {
  check(key);
  if (blob()) {
    const result = await readWeeklyBlob(`noidb-wms/weekly-work/v1/files/${key}`);
    if (!result) return null;
    if (result.statusCode !== 200) throw new Error("주간 파일을 읽지 못했습니다.");
    return Buffer.from(await new Response(result.stream).arrayBuffer());
  }
  try { return await fs.readFile(path.join(folder(), key)); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
}
export async function saveWeeklyFile(key: string, bytes: Buffer): Promise<void> {
  check(key);
  if (blob()) {
    try { await put(`noidb-wms/weekly-work/v1/files/${key}`, bytes, { access: "private", addRandomSuffix: false, allowOverwrite: false, contentType: "application/octet-stream" }); }
    catch (error) { if (!/already exists|conflict|precondition/i.test(String(error))) throw error; if (!await readWeeklyFile(key)) throw error; }
  } else {
    await fs.mkdir(folder(), {recursive:true});
    try { await fs.writeFile(path.join(folder(), key), bytes, { flag: "wx" }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
  }
}
