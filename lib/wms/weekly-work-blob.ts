import { get } from "@vercel/blob";

/** Match the existing WMS store on accounts without uncached Blob reads.
 * Mutable writes still use the returned ETag, so a cached read cannot overwrite newer data. */
export async function readWeeklyBlob(pathname: string) {
  try {
    return await get(pathname, { access: "private", useCache: false });
  } catch (error) {
    const value = error as { status?: unknown; statusCode?: unknown; message?: unknown } | null;
    if (Number(value?.status ?? value?.statusCode) !== 403 && !/403 forbidden/i.test(String(value?.message || error))) throw error;
    return get(pathname, { access: "private" });
  }
}
