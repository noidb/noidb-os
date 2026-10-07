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
    const shared = `The single input image is the exact photograph to edit. Leave any letters, words, logos or graphics that appear on the photograph exactly as they are: do not erase, blur, cover or paint over them, and never create white patches, blank areas, borders or empty margins where they were. The output must contain the same exact jewelry—not a similar or redesigned item.`;
    if (sectionKind === "wear") return `${shared}

This is a WEAR SHOT. Keep the photograph's composition exactly as it is: the same framing, crop, camera angle and distance, the same pose, the same head and body position and orientation, the same position and scale of the face, ear, neck, hand and shoulders. Nothing may move, rotate, zoom or reframe. Only the following appearance attributes must change, and each change must be clearly visible when the output is compared side by side with the input:
- skin tone: a noticeably different natural skin tone and undertone;
- eyes: a different natural eye shape and eye color, without changing where the eyes are;
- hair color: a clearly different natural hair color;
- hairstyle design: restyle ONLY the hair that already exists in the input, within the same head position and never covering the jewelry. Keep the same hair length and roughly the same amount of hair: short hair stays short, long hair stays long. Change only the parting, fringe direction, texture, wave or neatness within that same length. Never add hair that is not there: no longer hair, extensions, ponytails, buns, bangs or strands falling on the neck, shoulders or ears;
- clothing color: a clearly different clothing color (keep the same neckline and garment position);
- background color: a clearly different background color and tone, keeping the same soft studio feel and depth.
Both the clothing color and the background color must ALWAYS be very light, pale, low-saturation colors chosen only from this palette: light beige, pale pink, light gray, cream, ivory, white, pale mint. Never use dark, deep, saturated, vivid or strongly colored clothing or backgrounds, and never black, brown, camel, navy or red.
Keep exactly the same gender and age range as the input. If the model is a man, he must stay clearly a man: masculine face and jawline, masculine short men's hairstyle if the hair is short, no makeup, no feminine styling. Never turn a man into a woman or a woman into a man. Keep realistic pores, natural professional retouching and correct anatomy; do not reshape the body, hands, fingers or ears.

Lock the jewelry and copy it from the input as a rigid, unchangeable object: exact design, silhouette, real-world scale, position and orientation on the body. Reproduce with pixel-level fidelity the thickness and width of every hoop, band or bar and its flat or rounded cross-section, the exact size ratio between each part, the exact shape, size and cut of every stone, and every engraved letter, initial, motif or pattern (for example an "H" shape inside or beside a stone) with the same lines and orientation. Keep the same metal color, finish and highlights. Do not thin, thicken, shrink, enlarge, blur, simplify, restyle or redraw any part. Never replace, add or remove any jewelry. The jewelry must stay clearly visible and unobstructed.

Fill the complete square with no embedded white border, frame, panel or letterboxing.

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
