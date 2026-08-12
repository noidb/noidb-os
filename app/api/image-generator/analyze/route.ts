import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;

type PhotoInput = { role?: string; dataUrl?: string };

function outputText(data: Record<string, unknown>) {
  if (typeof data.output_text === "string") return data.output_text;
  const output = Array.isArray(data.output) ? data.output : [];
  for (const item of output) {
    if (!item || typeof item !== "object") continue;
    const content = Array.isArray((item as { content?: unknown[] }).content) ? (item as { content: unknown[] }).content : [];
    for (const part of content) {
      if (part && typeof part === "object" && (part as { type?: string }).type === "output_text") {
        return String((part as { text?: string }).text || "");
      }
    }
  }
  return "";
}

function extractJson(text: string) {
  const clean = text.replace(/```json|```/g, "").trim();
  const start = clean.indexOf("{");
  const end = clean.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("분석 결과를 읽지 못했습니다.");
  return JSON.parse(clean.slice(start, end + 1));
}

export async function POST(request: NextRequest) {
  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return NextResponse.json({ error: "서버에 이미지 분석 API 키가 설정되지 않았습니다." }, { status: 500 });
    const body = await request.json() as { photos?: PhotoInput[]; product?: Record<string, unknown> };
    const photos = (body.photos || []).filter(photo => photo.dataUrl?.startsWith("data:image/")).slice(0, 8);
    if (!photos.length) return NextResponse.json({ error: "제품 사진을 한 장 이상 올려주세요." }, { status: 400 });
    if (photos.some(photo => (photo.dataUrl?.length || 0) > 3_000_000)) {
      return NextResponse.json({ error: "사진 용량이 너무 큽니다. 사진 크기를 줄인 뒤 다시 올려주세요." }, { status: 413 });
    }
    const prompt = `당신은 주얼리 상품 촬영 검수자입니다. 사진에 없는 제품 특징을 추측하거나 창작하지 마세요.
사진 역할과 사용자가 입력한 실제 크기를 함께 검토하고 아래 JSON 하나만 한국어로 답하세요.
{
 "detectedType":"감지한 제품 유형", "detectedColor":"감지한 실제 색상", "estimatedSize":"입력값과 사진에서 확인한 크기",
 "confirmedViews":["확인된 정면/뒷면/측면/잠금장치/한쌍/착용/크기"], "missingPhotos":["다시 찍어야 하는 사진"],
 "canGenerate":true, "reason":"일반 사용자가 이해하기 쉬운 생성 가능 또는 불가 이유", "confidence":0
}
제품 외곽, 무늬, 잠금장치, 한 쌍의 좌우 방향을 확실히 확인할 수 없거나 사진이 흐리거나 가려졌다면 canGenerate를 false로 하고 필요한 재촬영 방법을 구체적으로 적으세요.
사용자 입력: ${JSON.stringify(body.product || {})}`;
    const content: Array<Record<string, unknown>> = [{ type: "input_text", text: prompt }];
    photos.forEach(photo => {
      content.push({ type: "input_text", text: `다음 사진 역할: ${photo.role || "기타 참고"}` });
      content.push({ type: "input_image", image_url: photo.dataUrl, detail: "high" });
    });
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "gpt-4.1-mini", input: [{ role: "user", content }], max_output_tokens: 900 }),
    });
    const data = await response.json() as Record<string, unknown> & { error?: { message?: string } };
    if (!response.ok) return NextResponse.json({ error: "제품 사진을 분석하지 못했습니다. 잠시 뒤 다시 시도해주세요." }, { status: response.status });
    return NextResponse.json(extractJson(outputText(data)));
  } catch {
    return NextResponse.json({ error: "제품 사진을 분석하는 중 문제가 생겼습니다." }, { status: 500 });
  }
}
