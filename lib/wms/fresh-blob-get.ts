import { BlobNotFoundError, get, head } from "@vercel/blob";

type GetResult = Awaited<ReturnType<typeof get>>;

const cleanEtag = (value?: string | null) => String(value || "").replace(/^W\//, "").replace(/^"|"$/g, "");

function isForbidden(error: unknown): boolean {
  if (!error || typeof error !== "object") return /403 forbidden/i.test(String(error));
  const candidate = error as { status?: unknown; statusCode?: unknown; message?: unknown };
  return Number(candidate.status ?? candidate.statusCode) === 403 || /403 forbidden/i.test(String(candidate.message || ""));
}

/**
 * 2026-10-11: 저장 직후에도 최신 저장본을 읽는다.
 *
 * 이 계정은 캐시 없는 읽기(useCache:false)가 403으로 막혀 캐시된 읽기로 넘어가는데, 캐시된 읽기는
 * 방금 저장한 내용 대신 예전 저장본을 돌려줄 때가 있었다(처리완료 후에도 버튼이 남음, "목록이 변경됐습니다",
 * 저장 충돌 반복). 그래서 캐시를 못 쓸 때는 메타정보(head, 항상 최신)의 ETag와 맞는 본문을
 * 주소 끝에 매번 다른 값을 붙여 캐시를 피해 읽는다. 어떤 이유로든 실패하면 예전 방식(캐시된 읽기)으로 돌아간다.
 */
export async function getFreshPrivateBlob(pathname: string): Promise<GetResult> {
  try {
    return await get(pathname, { access: "private", useCache: false });
  } catch (error) {
    if (!isForbidden(error)) throw error;
  }
  let meta: Awaited<ReturnType<typeof head>>;
  try {
    meta = await head(pathname);
  } catch (error) {
    if (error instanceof BlobNotFoundError) return null;
    return get(pathname, { access: "private" });
  }
  let last: GetResult = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const url = new URL(meta.url);
      url.searchParams.set("v", `${cleanEtag(meta.etag)}-${Date.now()}-${attempt}`);
      last = await get(url.toString(), { access: "private" });
    } catch {
      return get(pathname, { access: "private" });
    }
    if (!last || last.statusCode !== 200 || cleanEtag(last.blob.etag) === cleanEtag(meta.etag)) return last;
    if (attempt < 3) await last.stream?.cancel().catch(() => undefined);
    await new Promise(resolve => setTimeout(resolve, 250 * (attempt + 1)));
  }
  return last;
}
