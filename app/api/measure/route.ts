import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * 2026-11-11 자 사진 → 사이즈 읽기.
 * 기존 /api/analyze(상품등록 분석)와 분리한 별도 경로다. 같은 OPENAI_API_KEY를 쓴다.
 *
 * AI가 "길이를 어림"하게 하면 오차가 크므로, 자 눈금에서 각 부분의 시작 값과 끝 값을 "읽게" 하고
 * 길이는 여기서 빼기로 계산한다. 체인을 반으로 접어 찍은 사진이면 체인 길이는 2배로 계산한다.
 * 결과는 항상 사용자가 확인·수정한 뒤에만 쓰는 값이다.
 */

type Segment = { name: string; startMm: number | null; endMm: number | null };

function extractJson(text: string) {
  const cleaned = text.replace(/```json|```/g, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end < 0) throw new Error("AI 응답에서 JSON을 찾지 못했습니다.");
  return JSON.parse(cleaned.slice(start, end + 1));
}

function lengthCm(segment: Segment | undefined) {
  if (!segment) return null;
  const { startMm, endMm } = segment;
  if (typeof startMm !== "number" || typeof endMm !== "number") return null;
  const mm = Math.abs(endMm - startMm);
  if (!Number.isFinite(mm) || mm <= 0 || mm > 1000) return null;
  return Math.round(mm) / 10;
}

export async function POST(req: NextRequest) {
  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "Vercel 환경변수 OPENAI_API_KEY가 설정되지 않았습니다." }, { status: 500 });
    }

    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "요청 본문을 읽을 수 없습니다. 자 사진 1장을 지정해주세요." }, { status: 400 });
    }

    const imageDataUrl = typeof body.imageDataUrl === "string" && body.imageDataUrl.startsWith("data:image/") ? body.imageDataUrl : null;
    if (!imageDataUrl) return NextResponse.json({ error: "자 사진 1장을 지정해주세요." }, { status: 400 });
    if (imageDataUrl.length > 2_500_000) {
      return NextResponse.json({ error: "사진이 너무 큽니다. 사진을 압축해서 다시 보내주세요. (요청 용량 초과)" }, { status: 413 });
    }

    // 접어서 찍은 사진인지 사용자가 정해 준다(기본: 접음). 접었으면 체인 길이를 2배로 계산한다.
    const folded = body.foldedInHalf !== false;

    const instruction = `
너는 주얼리 상품 사진에서 금속 자(mm 눈금)를 읽어 길이를 재는 도우미다.
사진 속 자의 눈금 숫자는 mm 단위다(예: 100은 10cm).

해야 할 일: 아래 각 부분의 "시작 지점"과 "끝 지점"이 자의 어느 눈금(mm)에 닿는지 눈금 숫자를 읽어서 적는다.
길이를 직접 계산하거나 어림하지 말고, 눈금 값만 읽는다. 사진에 없거나 눈금을 읽을 수 없으면 null.
자와 물건이 나란히 있지 않거나 자가 없으면 모두 null로 둔다.

부분 이름(name):
- "chain": 펜던트(또는 체인 시작)부터 잠금 고리까지. 체인을 반으로 접어 찍은 경우 접힌 한쪽의 길이만 잰다.
- "extension": 잠금 고리부터 연장 체인 끝(태그 끝)까지.
- "pendantWidth": 펜던트 가로 끝에서 끝까지(큐빅 등 포함한 전체).
- "pendantHeight": 펜던트 세로 끝에서 끝까지. 자가 세로로 놓이지 않았으면 null.

반드시 아래 JSON 한 개만 출력한다.
{
  "segments": [
    { "name": "chain", "startMm": 숫자|null, "endMm": 숫자|null },
    { "name": "extension", "startMm": 숫자|null, "endMm": 숫자|null },
    { "name": "pendantWidth", "startMm": 숫자|null, "endMm": 숫자|null },
    { "name": "pendantHeight", "startMm": 숫자|null, "endMm": 숫자|null }
  ],
  "rulerVisible": true|false,
  "confidence": 0부터 100 사이 정수,
  "notes": "읽을 때 헷갈린 점(한 줄)"
}
`;

    const model = process.env.OPENAI_MEASURE_MODEL || "gpt-4.1-mini";
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        input: [
          {
            role: "user",
            content: [
              { type: "input_text", text: instruction },
              { type: "input_image", image_url: imageDataUrl, detail: "high" },
            ],
          },
        ],
        max_output_tokens: 700,
      }),
    });

    const rawText = await response.text();
    let data: any = {};
    try {
      data = rawText ? JSON.parse(rawText) : {};
    } catch {
      return NextResponse.json(
        { error: response.status === 413 ? "사진이 너무 큽니다. (요청 용량 초과)" : `OpenAI 응답을 해석하지 못했습니다 (${response.status}).` },
        { status: response.status === 413 ? 413 : 502 }
      );
    }
    if (!response.ok) {
      return NextResponse.json({ error: data?.error?.message ?? "OpenAI API 호출에 실패했습니다." }, { status: response.status });
    }

    const outputText =
      data.output_text ??
      data.output?.flatMap((item: any) => item.content ?? [])?.find((item: any) => item.type === "output_text")?.text ??
      "";

    let parsed: any;
    try {
      parsed = extractJson(outputText);
    } catch {
      return NextResponse.json({ error: "자 읽기 결과를 해석하지 못했습니다. 잠시 후 다시 시도해주세요." }, { status: 502 });
    }

    const segments: Segment[] = Array.isArray(parsed.segments) ? parsed.segments : [];
    const find = (name: string) => segments.find(item => item?.name === name);

    const chainSideCm = lengthCm(find("chain"));
    const result = {
      foldedInHalf: folded,
      chainSideCm, // 사진에서 잰 길이(접었으면 한쪽)
      chainCm: chainSideCm === null ? null : Math.round(chainSideCm * (folded ? 2 : 1) * 10) / 10,
      extensionCm: lengthCm(find("extension")),
      pendantWidthCm: lengthCm(find("pendantWidth")),
      pendantHeightCm: lengthCm(find("pendantHeight")),
      rulerVisible: parsed.rulerVisible !== false,
      confidence: Number.isFinite(Number(parsed.confidence)) ? Math.max(0, Math.min(100, Math.round(Number(parsed.confidence)))) : 0,
      notes: typeof parsed.notes === "string" ? parsed.notes.slice(0, 200) : "",
      model,
    };
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "알 수 없는 오류" }, { status: 500 });
  }
}
