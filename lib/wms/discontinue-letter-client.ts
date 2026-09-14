export interface DiscontinueLetterItem {
  skuId: string;
}

/** Compatibility entry point: all callers use the verified original PDF now. */
export async function buildDiscontinueLetterPdf(items: DiscontinueLetterItem[], _date: string): Promise<Uint8Array> {
  const response = await fetch("/api/wms/discontinue-files", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind: "discontinue", format: "pdf", items }),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || "단종 공문을 만들지 못했습니다.");
  }
  return new Uint8Array(await response.arrayBuffer());
}
