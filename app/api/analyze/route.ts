import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

function extractJson(text: string) {
  const cleaned = text.replace(/```json|```/g, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end < 0) throw new Error("AI 응답에서 JSON을 찾지 못했습니다.");
  return JSON.parse(cleaned.slice(start, end + 1));
}

function cleanKeyword(value: unknown, category: string, gender: string, material: string) {
  const banned = new Set([
    category, gender, material,
    "여성용", "남성용", "남녀공용", "주얼리", "쥬얼리",
    "반지", "귀걸이", "목걸이", "팔찌", "발찌", "피어싱", "브로치", "세트"
  ]);
  const words = String(value ?? "")
    .replace(/[,.，、/|+()[\]{}:;·_-]+/g, " ")
    .split(/\s+/)
    .map(v => v.trim())
    .filter(Boolean)
    .filter(v => !banned.has(v));

  return [...new Set(words)].slice(0, 5).join(" ");
}

/** Only ONE image is accepted for OpenAI (prevents 413). */
function pickSingleImage(body: Record<string, unknown>): string | null {
  const single = body.imageDataUrl;
  if (typeof single === "string" && single.startsWith("data:image/")) return single;

  const multi = body.imageDataUrls;
  if (Array.isArray(multi)) {
    for (const item of multi) {
      if (typeof item === "string" && item.startsWith("data:image/")) return item;
    }
  }
  return null;
}

export async function POST(req: NextRequest) {
  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "Vercel 환경변수 OPENAI_API_KEY가 설정되지 않았습니다." },
        { status: 500 }
      );
    }

    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json(
        { error: "요청 본문을 읽을 수 없습니다. AI 분석용 사진 1장을 지정해주세요." },
        { status: 400 }
      );
    }

    const imageDataUrl = pickSingleImage(body);
    if (!imageDataUrl) {
      return NextResponse.json(
        { error: "AI 분석용 사진 1장을 지정해주세요." },
        { status: 400 }
      );
    }

    // Guard against oversized payloads (413)
    if (imageDataUrl.length > 2_500_000) {
      return NextResponse.json(
        {
          error:
            "AI 분석용 사진이 너무 큽니다. 사진을 다시 지정하거나 압축 후 분석해주세요. (AI 분석용 사진 1장만 전송)",
        },
        { status: 413 }
      );
    }

    const instruction = `
너는 대한민국 쿠팡 로켓배송용 주얼리 상품등록 전문가다.
첨부한 제품사진 1장만 분석하되, 보이지 않는 소재·사이즈는 단정하지 않는다.
사용자가 제공한 기본값은 참고하되 사진과 명백히 다를 때만 수정한다.

반드시 아래 JSON 한 개만 출력한다.
{
  "category": "반지|귀걸이|목걸이|팔찌|발찌|피어싱|브로치|세트",
  "gender": "여성|남성|남녀공용",
  "material": "써지컬스틸|925실버|티타늄|신주|14K|18K|기타",
  "colors": "쉼표로 구분한 옵션. 사용자가 이미 입력한 색상 순서가 있으면 그 순서를 바꾸지 말 것",
  "keyword": "공백으로만 구분한 핵심 디자인 키워드 2~4개. 쉼표 금지. 소재, 성별, 색상, 카테고리명 제외",
  "visualFeatures": ["사진에서 확인되는 특징"],
  "engraving": "각인 내용 또는 없음",
  "counterfeitRisk": "낮음|확인필요|높음",
  "counterfeitReason": "상표·로고·유명 디자인 유사성 관점의 짧은 설명",
  "confidence": 0부터 100 사이 정수
}

규칙:
- 확인할 수 없는 사실은 추측하지 말 것.
- colors 필드는 사용자가 입력한 순서를 강제 정렬하지 않는다.
- keyword에 카테고리명·성별·소재·색상을 넣지 않는다.
`;

    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4.1-mini",
        input: [
          {
            role: "user",
            content: [
              { type: "input_text", text: instruction },
              { type: "input_text", text: `현재 입력값: ${JSON.stringify(body.current ?? {})}` },
              { type: "input_image", image_url: imageDataUrl, detail: "high" },
            ],
          },
        ],
        max_output_tokens: 900,
      }),
    });

    const rawText = await response.text();
    let data: any = {};
    try {
      data = rawText ? JSON.parse(rawText) : {};
    } catch {
      if (!response.ok) {
        return NextResponse.json(
          {
            error:
              response.status === 413
                ? "AI 분석용 사진 1장을 지정해주세요. (요청 용량 초과)"
                : `OpenAI 응답을 해석하지 못했습니다 (${response.status}).`,
          },
          { status: response.status === 413 ? 413 : 502 }
        );
      }
      return NextResponse.json({ error: "OpenAI 응답 JSON 파싱 실패" }, { status: 502 });
    }

    if (!response.ok) {
      const message =
        data?.error?.message ??
        (response.status === 413
          ? "AI 분석용 사진 1장을 지정해주세요."
          : "OpenAI API 호출에 실패했습니다.");
      return NextResponse.json({ error: message }, { status: response.status });
    }

    const outputText =
      data.output_text ??
      data.output?.flatMap((item: any) => item.content ?? [])
        ?.find((item: any) => item.type === "output_text")?.text ??
      "";

    let result: any;
    try {
      result = extractJson(outputText);
    } catch {
      return NextResponse.json(
        { error: "AI 분석 결과를 해석하지 못했습니다. 잠시 후 다시 시도해주세요." },
        { status: 502 }
      );
    }

    result.keyword = cleanKeyword(
      result.keyword,
      result.category || (body.current as any)?.category || "",
      result.gender || (body.current as any)?.gender || "",
      result.material || (body.current as any)?.material || ""
    );

    const userColors = String((body.current as any)?.colors ?? "").trim();
    if (userColors) result.colors = userColors;

    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "알 수 없는 오류";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
