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
    const sectionKind = String(body.sectionKind || "product");
    const mood = style === "ivory"
      ? "warm ivory luxury jewelry editorial, soft daylight and refined neutral styling"
      : style === "modern"
        ? "modern pale-gray luxury studio, crisp restrained lighting and contemporary styling"
        : "bright clean white luxury jewelry studio, natural soft lighting";
    const shared = `The single input image is the exact photograph to edit. Remove every visible Chinese, Korean or English character, caption, logo, brand mark, price, measurement graphic and watermark, reconstructing the surface naturally. The output must contain the same exact jewelry—not a similar or redesigned item.`;
    if (sectionKind === "wear") return `${shared}

This is definitely a WEAR SHOT. Treat the uploaded photograph as a locked composition, not as inspiration for a new pose. Preserve the exact same person's gender presentation and age range; a male hand must remain a male hand and a female hand must remain a female hand. Preserve the exact hand/body anatomy, finger shape, pose, gesture, camera viewpoint, crop, jewelry-bearing finger, jewelry position, orientation and real-world scale. Most importantly, preserve the exact jewelry pixels and identity: design, width, silhouette, engraving, pattern, color, finish, stone, inner and outer structure. Never redraw, reinterpret, simplify, replace or move the jewelry. Do not add or remove any jewelry.

Only edit non-product surroundings that can be changed without altering pose: background, lighting mood, color grade, surface texture, background props, clothing color, and—only when actually visible—facial appearance or hairstyle while keeping the head position unchanged. Natural professional skin retouching is allowed: gently even skin tone, reduce temporary blemishes and dryness, and keep realistic pores, wrinkles and masculine/feminine characteristics. Do not feminize a male hand, masculinize a female hand, reshape fingers, slim the hand, change nails, or beautify anatomy. If changing a surrounding element risks altering the jewelry or pose, leave that element unchanged. Fill the complete square with the original composition and no embedded white border, frame, panel or letterboxing.

Visual direction: ${mood}. Keep a square 1:1 composition suitable for a Korean online jewelry shop. No text, logo, border, watermark or props that hide the product.`;

    return `${shared}

This is definitely a PRODUCT-ONLY SHOT. Preserve the jewelry pixels and exact identity as aggressively as possible: silhouette, engraving, grooves, facets, stone count and placement, clasp, thickness, proportions, metal and non-metal colors. Do not rotate, bend, redraw, reinterpret or generate a new camera side of the product. Keep the same product-facing angle; change only the surrounding studio background, lighting, shadows, crop and placement. Remove all original props and replace any gray, brown, colored or non-white background with a bright white-on-white studio setting. Select only one or two subtle new props: sheer white curtain folds, a plain white ceramic plate, a closed white book with absolutely no visible text, an ivory pedestal, or softly folded white fabric. Props must stay behind or beside the product, never overlap it, and never introduce strong colors. Reframe and enlarge the unchanged product naturally so the square is visually full with no embedded margins, screenshot frames, panels or letterboxing.

Visual direction: ${mood}. Keep a square 1:1 composition suitable for a Korean online jewelry shop. No text, logo, border or watermark. This must look like a new studio setting around the exact same product.`;
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
