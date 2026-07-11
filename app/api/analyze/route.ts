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

function collectImageUrls(body: Record<string, unknown>): string[] {
  const urls: string[] = [];
  const multi = body.imageDataUrls;
  if (Array.isArray(multi)) {
    for (const item of multi) {
      if (typeof item === "string" && item.startsWith("data:image/")) urls.push(item);
    }
  }
  const single = body.imageDataUrl;
  if (typeof single === "string" && single.startsWith("data:image/")) {
    if (!urls.includes(single)) urls.unshift(single);
  }
  return urls.slice(0, 10);
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
    const imageDataUrls = collectImageUrls(body);

    if (!imageDataUrls.length) {
      return NextResponse.json({ error: "분석할 제품사진이 없습니다." }, { status: 400 });
    }

    const rolesHint = body.photoRoles
      ? `사진 역할 힌트: ${JSON.stringify(body.photoRoles)}`
      : "사진에는 전체 옵션·앞면·뒷면·착용컷·상세컷이 섞여 있을 수 있다. 모든 사진을 종합해 분석한다.";

    const instruction = `
너는 대한민국 쿠팡 로켓배송용 주얼리 상품등록 전문가다.
첨부한 제품사진 전체를 함께 분석하되, 보이지 않는 소재·사이즈는 단정하지 않는다.
사용자가 제공한 기본값은 참고하되 사진과 명백히 다를 때만 수정한다.
${rolesHint}

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
  "confidence": 0부터 100 사이 정수,
  "photoNotes": ["각 사진에서 확인된 각도/역할 요약"]
}

규칙:
- 확인할 수 없는 사실은 추측하지 말 것.
- '써지컬스틸'은 사진만으로 확정하기 어려우므로 사용자가 제공한 소재 기본값을 유지할 수 있다.
- 상품명 키워드는 중복 없이 짧게 작성한다.
- keyword에는 쉼표, 슬래시, 괄호를 절대 넣지 않는다.
- keyword에 반지, 귀걸이, 목걸이 등 카테고리명을 넣지 않는다.
- keyword에 여성, 남성, 써지컬스틸, 골드, 실버 등 기본속성을 넣지 않는다.
- colors 필드는 사용자가 입력한 순서를 강제 정렬하지 않는다.
- 일반적인 하트, 큐빅, 체인만으로 가품이라고 단정하지 않는다.
- 문자 각인, 로고, 특정 브랜드를 연상시키는 고유 패턴이 있으면 확인필요로 표시한다.
`;

    const content: Array<Record<string, unknown>> = [
      { type: "input_text", text: instruction },
      { type: "input_text", text: `현재 입력값: ${JSON.stringify(body.current ?? {})}` },
      { type: "input_text", text: `첨부 사진 수: ${imageDataUrls.length}` },
    ];

    for (let i = 0; i < imageDataUrls.length; i++) {
      content.push({
        type: "input_text",
        text: `사진 ${i + 1}/${imageDataUrls.length}`,
      });
      content.push({
        type: "input_image",
        image_url: imageDataUrls[i],
        detail: "high",
      });
    }

    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4.1-mini",
        input: [{ role: "user", content }],
        max_output_tokens: 1200,
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
    result.keyword = cleanKeyword(
      result.keyword,
      result.category || body.current?.category || "",
      result.gender || body.current?.gender || "",
      result.material || body.current?.material || ""
    );

    // Never force-sort colors: keep user's existing order when provided
    const userColors = String(body.current?.colors ?? "").trim();
    if (userColors) {
      result.colors = userColors;
    }

    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "알 수 없는 오류";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
