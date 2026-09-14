import { promises as fs } from "node:fs";
import path from "node:path";
import { put } from "@vercel/blob";
import { readWeeklyBlob } from "./weekly-work-blob";
import { emptyWeeklyWorkspace } from "./weekly-work-state";
import type { WeeklyWorkspace } from "./weekly-work-types";

const blobPath = "noidb-wms/weekly-work/v1/workspace.json";
const localPath = () => process.env.WMS_WEEKLY_WORK_STORE_FILE || path.join(process.cwd(), ".secrets", "weekly-work.json");
const useBlob = () => !process.env.WMS_WEEKLY_WORK_STORE_FILE && Boolean(process.env.VERCEL || process.env.BLOB_READ_WRITE_TOKEN);
let queue: Promise<unknown> = Promise.resolve();
export async function readWeeklyWorkspace(): Promise<WeeklyWorkspace> { return (await read()).value; }
async function read(): Promise<{value: WeeklyWorkspace; etag?: string}> {
  let text: string;
  let etag: string | undefined;
  if (useBlob()) {
    const result = await readWeeklyBlob(blobPath);
    if (!result) return {value: emptyWeeklyWorkspace()};
    if (result.statusCode !== 200) throw new Error("주간 업무 저장소를 읽지 못했습니다.");
    text = await new Response(result.stream).text(); etag = result.blob.etag;
  } else {
    try { text = await fs.readFile(localPath(), "utf8"); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return {value: emptyWeeklyWorkspace()}; throw error; }
  }
  const value = JSON.parse(text) as WeeklyWorkspace;
  if (value.schemaVersion !== 1 || !Array.isArray(value.runs) || !value.productOverrides || !Number.isSafeInteger(value.revision)) throw new Error("저장된 주간 업무 형식을 확인해 주세요.");
  return { value, etag };
}
export async function mutateWeeklyWorkspace<T>(change: (workspace: WeeklyWorkspace) => T): Promise<T> {
  const task = queue.then(async () => {
    for (let attempt = 0; attempt < 4; attempt++) {
      const { value, etag } = await read();
      const result = change(value); value.revision++;
      try {
        if (useBlob()) await put(blobPath, JSON.stringify(value), { access: "private", addRandomSuffix: false, allowOverwrite: Boolean(etag), contentType: "application/json",
          ...(etag ? { ifMatch: etag.replace(/^W\//, "").replace(/^"|"$/g, "") } : {}) });
        else {
          const filePath = localPath();
          await fs.mkdir(path.dirname(filePath), { recursive: true });
          const temp = `${filePath}.${process.pid}.tmp`;
          await fs.writeFile(temp, JSON.stringify(value), "utf8"); await fs.rename(temp, filePath);
        }
        return structuredClone(result);
      } catch (error) {
        if (!useBlob() || attempt === 3 || !/precondition|conflict|etag|already exists/i.test(String(error))) throw error;
      }
    }
    throw new Error("동시에 저장된 내용이 있습니다. 새로고침 후 다시 확인해 주세요.");
  });
  queue = task.catch(() => undefined);
  return task;
}
