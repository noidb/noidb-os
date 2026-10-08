import { BlobNotFoundError, head } from "@vercel/blob";

/**
 * 저장소(주간업무·발주 저장소) 읽기 — 항상 최신본을, 매번 새로 받아온다.
 * - 캐시된 옛 사본을 읽으면 저장할 때 충돌이 나서 분류 결과가 저장되지 않았다(2026-10-08).
 * - 같은 요청 안에서 같은 주소를 두 번 읽으면 이미 읽은 응답을 재사용하다
 *   "Response body object should not be disturbed or locked" 오류가 났다(2026-10-08).
 * 그래서 파일 주소는 한 번만 확인해 두고, 내용은 주소 끝에 매번 다른 값을 붙여 캐시 없이 직접 받는다.
 * 없는 파일이면 null, 그 밖의 실패는 오류로 알린다(빈 자료로 덮어쓰지 않도록).
 */
const blobUrls = new Map<string, string>();

async function blobUrl(pathname: string): Promise<string | null> {
  const known = blobUrls.get(pathname);
  if (known) return known;
  try {
    const meta = await head(pathname);
    blobUrls.set(pathname, meta.url);
    return meta.url;
  } catch (error) {
    if (error instanceof BlobNotFoundError) return null;
    throw error;
  }
}

export async function readWeeklyBlob(pathname: string) {
  const url = await blobUrl(pathname);
  if (!url) return null;
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  const freshUrl = new URL(url);
  freshUrl.searchParams.set("fresh", `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`);
  const response = await fetch(freshUrl, { cache: "no-store", headers: token ? { authorization: `Bearer ${token}` } : {} });
  if (response.status === 404) { blobUrls.delete(pathname); return null; }
  if (!response.ok || !response.body) throw new Error(`저장소를 읽지 못했습니다(${response.status}). 잠시 후 다시 시도해 주세요.`);
  // 저장 충돌 확인용 ETag. 응답에 없으면 head()로 받는다.
  const etag = response.headers.get("etag") || (await head(pathname)).etag;
  return { statusCode: 200 as const, stream: response.body, blob: { url, pathname, etag } };
}
