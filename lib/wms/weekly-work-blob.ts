import { get, head } from "@vercel/blob";

/**
 * 주간업무 저장소 읽기 — 항상 최신본을 읽는다.
 * 계정에 따라 캐시 없는 읽기(useCache:false)가 막혀 있어(403) 캐시된 옛 사본이 올 수 있다.
 * 그러면 저장할 때 충돌이 나서 분류·처리 결과가 저장되지 않는다(2026-10-08 실사용 확인).
 * 그래서 head()로 현재 ETag를 확인하고, 다르면 주소 끝에 매번 다른 값을 붙여 캐시를 피해 다시 읽는다.
 */
export async function readWeeklyBlob(pathname: string) {
  let result;
  try {
    result = await get(pathname, { access: "private", useCache: false });
  } catch (error) {
    const value = error as { status?: unknown; statusCode?: unknown; message?: unknown } | null;
    if (Number(value?.status ?? value?.statusCode) !== 403 && !/403 forbidden/i.test(String(value?.message || error))) throw error;
    result = await get(pathname, { access: "private" });
  }
  if (!result || result.statusCode !== 200) return result;
  const latest = await head(pathname).catch(() => null);
  const clean = (etag: string | undefined) => String(etag || "").replace(/^W\//, "").replace(/^"|"$/g, "");
  if (!latest || clean(latest.etag) === clean(result.blob.etag)) return result;
  for (let attempt = 0; attempt < 4; attempt++) {
    const url = new URL(result.blob.url);
    url.searchParams.set("fresh", `${Date.now()}-${attempt}-${Math.random().toString(36).slice(2, 8)}`);
    const fresh = await get(url.toString(), { access: "private" });
    if (fresh && fresh.statusCode === 200 && clean(fresh.blob.etag) === clean(latest.etag)) return fresh;
    await new Promise(resolve => setTimeout(resolve, 250 * (attempt + 1)));
  }
  throw new Error("저장소 최신본을 읽지 못했습니다. 잠시 후 다시 시도해 주세요.");
}
