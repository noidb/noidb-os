import { NextRequest, NextResponse } from "next/server";
import { categoryProfile } from "@/lib/image-generator/category-profiles";

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
  if (kind === "quick-detail") {
    const style = String(body.style || "clean");
    const mood = style === "ivory"
      ? "warm ivory luxury jewelry editorial, soft daylight and refined neutral styling"
      : style === "modern"
        ? "modern pale-gray luxury studio, crisp restrained lighting and contemporary styling"
        : "bright clean white luxury jewelry studio, natural soft lighting";
    return `Edit this square section from an existing NOID-B jewelry detail page into a genuinely new commercial photograph. Automatically determine whether it is a product-only photograph or a model wearing the product.

If it is a product-only photograph: preserve the exact jewelry product identity, silhouette, engraving, grooves, facets, stone count and placement, clasp, thickness, proportions, metal and non-metal colors. Remove every visible Chinese, Korean or English character, caption, logo, brand mark, price, measurement graphic and watermark, reconstructing the surface naturally. Remove all original props and replace any gray, brown, colored or non-white background with a bright white-on-white studio setting. Change the lighting, placement and camera viewpoint slightly so it is clearly a newly photographed composition. Select only one or two subtle new props appropriate to this particular composition: sheer white curtain folds, a plain white ceramic plate, a closed white book with absolutely no visible text, an ivory pedestal, or softly folded white fabric. Vary the selected prop and arrangement from the input photograph. Props must remain secondary, must not overlap or hide any part of the product, and must not introduce strong colors. Reframe and enlarge the product naturally so the finished square is visually full with no embedded margins, screenshot frames, panels or letterboxing. Keep the complete product visible and commercially realistic.

If it contains a model: preserve the exact jewelry design, color, real-world size and wearing position. Remove every visible character, caption, logo, brand mark and watermark. Replace the person with a different adult professional jewelry model and change the face, hairstyle, clothing, pose and background. Do not resemble the original person. Use a clean bright white-tone background and reframe the model photograph to fill the complete square without embedded margins, screenshot frames, panels or letterboxing. Keep the jewelry unobstructed and sharply visible, with anatomically correct wearing and no extra jewelry.

Visual direction: ${mood}. Keep a square 1:1 composition suitable for a Korean online jewelry shop. No text, logo, border, watermark or props that hide the product. Do not add, remove or redesign the jewelry. This must look like a new photo of the same product, not a filter or framed copy.`;
  }
  const product = (body.product || {}) as Record<string, unknown>;
  const profile = categoryProfile(String(product.category || "귀걸이"));
  const dimensions = `actual product dimensions: width ${product.widthMm || "unknown"}mm, height ${product.heightMm || "unknown"}mm, thickness ${product.thicknessMm || "unknown"}mm`;
  const count = profile.unitsPerColor === 2 ? "exactly one matching pair" : "exactly one product";
  const invariant = `Category: ${profile.label} (${profile.productNoun}). Preserve the exact real product silhouette, engraving, grooves, curves, proportions, stone count and placement, non-metal colors, thickness, front/back/side construction, clasp, orientation, and product count from the references. Never invent hidden details. No text, logo, watermark, border, or prop. Square studio product photography.`;
  if (kind === "baseline") return `${invariant} Build one clean approval reference image showing ${count} on pure white background. ${profile.baselineGuide} Preserve the real photographed metal color. Natural controlled metal shine, crisp edges, no dust, fingerprints, glare, or distortion. ${dimensions}`;
  if (kind === "color") return `${invariant} The first reference is the user-approved baseline. Derive the identical ${count} from it and change metal parts only to ${String(body.metal || body.color || "the requested metal color")}. Do not recolor stones, pearl, shell, enamel, leather, epoxy, or black decoration. Keep placement, camera angle, scale, form, and shadow identical. Pure #FFFFFF background, centered and occupying about 85-90%. ${profile.baselineGuide} ${dimensions}`;
  if (kind === "wear") {
    const variant = Number(body.variant || 1);
    const framing = profile.wearFrames[Math.max(0, Math.min(2, variant - 1))];
    return `${invariant} The references contain an approved product color image and an approved reusable NOID-B ${profile.modelGender} model template. Composite that exact product onto the same approved model. Framing: ${framing}. ${profile.wearSafety} Match the entered real-world product size and wear angle. Bright clean luxury jewelry-shop background. Do not use or imitate any customer's face, skin, hair, clothes, body, or background. ${dimensions}`;
  }
  if (kind === "model-template") return `Create a reusable, consistent NOID-B professional ${profile.modelGender} jewelry model template suitable for ${profile.productNoun}, square 1024x1024, bright clean luxury studio background, natural realistic skin, no jewelry, no text or logo. Ensure the relevant wearing area is clearly visible. This is an approval template that will be reused across products.`;
  if (kind === "detail") return `${invariant} Create a close detail view requested as ${String(body.detail || "front detail")}, using only confirmed reference structure. ${profile.detailGuide} Pure white background. ${dimensions}`;
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
