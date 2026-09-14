/** Bound the complete request, including response body parsing. */
export async function requestVendorJson<T = any>(url: string, init: RequestInit = {}, timeoutMs = 30_000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const data = await response.json() as T;
    return { response, data };
  } catch (error) {
    if (controller.signal.aborted) throw new Error("발주 목록 연결이 지연되고 있습니다. 입력 내용은 유지됩니다. 잠시 후 다시 확인해 주세요.");
    throw error;
  } finally { clearTimeout(timeout); }
}
