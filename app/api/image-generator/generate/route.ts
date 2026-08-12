import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 120;

type Reference = { dataUrl?: string; role?: string };

function parseDataUrl(dataUrl: string) {
  const match = dataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (!match) throw new Error("올바른 이미지 파일이 아닙니다.");
  return { mime: match[1], buffer: Buffer.from(match[2], "base64") };
}

function promptFor(body: Record<string, unknown>) {
  const kind = String(body.kind || "");
  const product = (body.product || {}) as Record<string, unknown>;
  const dimensions = `actual product dimensions: width ${product.widthMm || "unknown"}mm, height ${product.heightMm || "unknown"}mm, thickness ${product.thicknessMm || "unknown"}mm`;
  const invariant = `Preserve the exact real product silhouette, engraving, grooves, curves, proportions, stone count and placement, non-metal colors, thickness, front/back/side construction, clasp, left/right orientation, and pair count from the references. Never invent hidden details. No text, logo, watermark, border, or prop. Square studio product photography.`;
  if (kind === "baseline") return `${invariant} Build one clean approval reference image of exactly one matching product pair on pure white background. Preserve the real photographed metal color. Natural controlled metal shine, crisp edges, no dust, fingerprints, glare, or distortion. ${dimensions}`;
  if (kind === "color") return `${invariant} The first reference is the user-approved baseline. Derive the identical pair from it and change metal parts only to ${String(body.metal || body.color || "the requested metal color")}. Do not recolor stones, pearl, shell, enamel, leather, epoxy, or black decoration. Keep placement, camera angle, scale, form, and shadow identical. Pure #FFFFFF background, pair centered and occupying about 85-90%. ${dimensions}`;
  if (kind === "wear") {
    const variant = Number(body.variant || 1);
    const framing = variant === 1 ? "full or mostly full face, elegant three-quarter angle" : variant === 2 ? "close emotional crop showing eye, lips, and ear" : "extreme close-up centered on ear and earring";
    return `${invariant} The references contain an approved product color image and an approved reusable NOID-B professional female model template. Composite that exact product onto the same approved model. ${framing}. Hair and hands must not cover the product. One natural piercing only; no extra earring. Clasp must not pass through skin. Match the entered real-world product size and wear angle. Bright clean luxury jewelry-shop background. Do not use or imitate any customer's face, skin, hair, clothes, body, or background. ${dimensions}`;
  }
  if (kind === "model-template") return `Create a reusable, consistent NOID-B professional female jewelry model template, square 1024x1024, bright clean luxury studio background, elegant natural makeup and realistic skin. Three-quarter face angle with one ear fully visible, hair tucked away, no earrings, no jewelry, no text or logo. This is an approval template that will be reused across products.`;
  if (kind === "detail") return `${invariant} Create a close detail view requested as ${String(body.detail || "front detail")}, using only confirmed reference structure. Pure white background. ${dimensions}`;
  throw new Error("지원하지 않는 이미지 종류입니다.");
}

export async function POST(request: NextRequest) {
  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return NextResponse.json({ error: "서버에 이미지 생성 API 키가 설정되지 않았습니다." }, { status: 500 });
    const body = await request.json() as Record<string, unknown> & { references?: Reference[] };
    const kind = String(body.kind || "");
    const references = (body.references || []).filter(item => item.dataUrl?.startsWith("data:image/")).slice(0, 8);
    if (kind !== "model-template" && !references.length) return NextResponse.json({ error: "생성에 사용할 승인 이미지나 제품 사진이 없습니다." }, { status: 400 });
    if (references.some(item => (item.dataUrl?.length || 0) > 8_000_000)) return NextResponse.json({ error: "참고 사진 용량이 너무 큽니다." }, { status: 413 });
    let response: Response;
    if (kind === "model-template") {
      response = await fetch("https://api.openai.com/v1/images/generations", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: "gpt-image-2", size: "1024x1024", quality: "medium", output_format: "jpeg", prompt: promptFor(body) }),
      });
    } else {
      const form = new FormData();
      form.append("model", "gpt-image-2");
      form.append("size", "1024x1024");
      form.append("quality", "medium");
      form.append("output_format", "jpeg");
      form.append("prompt", promptFor(body));
      references.forEach((item, index) => {
        const parsed = parseDataUrl(item.dataUrl!);
        form.append("image[]", new Blob([parsed.buffer], { type: parsed.mime }), `reference-${index + 1}.jpg`);
      });
      response = await fetch("https://api.openai.com/v1/images/edits", { method: "POST", headers: { Authorization: `Bearer ${apiKey}` }, body: form });
    }
    const data = await response.json() as { data?: Array<{ b64_json?: string }>; error?: { message?: string }; usage?: unknown };
    if (!response.ok) return NextResponse.json({ error: "이미지를 만들지 못했습니다. 완성된 다른 이미지는 그대로 보관됩니다." }, { status: response.status });
    const encoded = data.data?.[0]?.b64_json;
    if (!encoded) throw new Error("생성된 이미지가 없습니다.");
    return NextResponse.json({ imageDataUrl: `data:image/jpeg;base64,${encoded}`, usage: data.usage || null });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "이미지 생성 중 문제가 생겼습니다." }, { status: 500 });
  }
}
