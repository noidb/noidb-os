import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

function extractJson(text: string) {
  const cleaned = text.replace(/```json|```/g, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end < 0) throw new Error("AI 응답에서 JSON을 찾지 못했습니다.");
  return JSON.parse(cleaned.slice(start, end + 1));
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

    const body = await req.json();
    const imageDataUrl = body.imageDataUrl as string | undefined;

    if (!imageDataUrl?.startsWith("data:image/")) {
      return NextResponse.json({ error: "분석할 제품사진이 없습니다." }, { status: 400 });
    }

    const instruction = `
너는 대한민국 쿠팡 로켓배송용 주얼리 상품등록 전문가다.
첨부한 제품사진만 분석하되, 보이지 않는 소재·사이즈는 단정하지 않는다.
사용자가 제공한 기본값은 참고하되 사진과 명백히 다를 때만 수정한다.

반드시 아래 JSON 한 개만 출력한다.
{
  "category": "반지|귀걸이|목걸이|팔찌|발찌|피어싱|브로치|세트",
  "gender": "여성|남성|남녀공용",
  "material": "써지컬스틸|925실버|티타늄|신주|14K|18K|기타",
  "colors": "쉼표로 구분한 옵션",
  "keyword": "쿠팡 상품명에 넣을 핵심 디자인 키워드 2~4개, 소재/성별/카테고리 제외",
  "visualFeatures": ["사진에서 확인되는 특징"],
  "engraving": "각인 내용 또는 없음",
  "counterfeitRisk": "낮음|확인필요|높음",
  "counterfeitReason": "상표·로고·유명 디자인 유사성 관점의 짧은 설명",
  "confidence": 0부터 100 사이 정수
}

규칙:
- 확인할 수 없는 사실은 추측하지 말 것.
- '써지컬스틸'은 사진만으로 확정하기 어려우므로 사용자가 제공한 소재 기본값을 유지할 수 있다.
- 상품명 키워드는 중복 없이 짧게 작성한다.
- 일반적인 하트, 큐빅, 체인만으로 가품이라고 단정하지 않는다.
- 문자 각인, 로고, 특정 브랜드를 연상시키는 고유 패턴이 있으면 확인필요로 표시한다.
`;

    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
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
              { type: "input_image", image_url: imageDataUrl, detail: "high" }
            ]
          }
        ],
        max_output_tokens: 900
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      const message = data?.error?.message ?? "OpenAI API 호출에 실패했습니다.";
      return NextResponse.json({ error: message }, { status: response.status });
    }

    const outputText =
      data.output_text ??
      data.output?.flatMap((item: any) => item.content ?? [])
        ?.find((item: any) => item.type === "output_text")?.text ??
      "";

    const result = extractJson(outputText);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "알 수 없는 오류";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
