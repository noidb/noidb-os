import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

function extractJson(text: string) {
  const cleaned = text.replace(/```json|```/g, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end < 0) throw new Error("검색정보 JSON을 찾지 못했습니다.");
  return JSON.parse(cleaned.slice(start, end + 1));
}

export async function POST(req: NextRequest) {
  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "OPENAI_API_KEY가 설정되지 않았습니다." }, { status: 500 });
    }

    const body = await req.json();
    const imageDataUrl = String(body.imageDataUrl || "");
    if (!imageDataUrl.startsWith("data:image/")) {
      return NextResponse.json({ error: "먼저 제품사진을 선택해주세요." }, { status: 400 });
    }

    const prompt = `
너는 중국 주얼리 도매시장과 쿠팡 소싱에 익숙한 상품 검색 전문가다.
첨부 제품사진을 보고 동일하거나 매우 유사한 제품을 찾기 위한 검색어를 만든다.
사진 속 문자와 가격, 사이즈, 옵션도 읽되 보이지 않는 내용은 추측하지 않는다.

반드시 아래 JSON 하나만 출력한다.
{
  "koreanSummary": "제품을 찾기 위한 짧은 한국어 설명",
  "chineseKeywords": [
    {"chinese": "1688 검색용 중국어 검색어 1", "koreanMeaning": "검색어 전체의 한국어 뜻"},
    {"chinese": "중국어 검색어 2", "koreanMeaning": "검색어 전체의 한국어 뜻"},
    {"chinese": "중국어 검색어 3", "koreanMeaning": "검색어 전체의 한국어 뜻"}
  ],
  "englishKeywords": [
    {"english": "English search phrase 1", "koreanMeaning": "검색어 전체의 한국어 뜻"},
    {"english": "English search phrase 2", "koreanMeaning": "검색어 전체의 한국어 뜻"}
  ],
  "ocrText": ["사진에서 실제로 읽힌 문구"],
  "detectedPrice": "사진에서 읽힌 가격 또는 없음",
  "detectedSizes": ["사진에서 읽힌 사이즈"],
  "detectedColors": ["사진에서 확인되는 색상 옵션"],
  "searchTips": ["검색 정확도를 높이는 짧은 팁"]
}

규칙:
- 중국어 검색어는 1688 판매자가 실제로 쓸 법한 간결한 상품명으로 작성한다.
- 모든 중국어 검색어에는 사용자 입력의 소재와 분류를 반드시 포함한다. 디자인 특징은 사진에서 확실한 것만 더한다.
- koreanMeaning에는 중국어 검색어 전체를 자연스러운 한국어로 번역해 적는다.
- 모든 영어 검색어에도 사용자 입력의 소재와 분류를 반드시 포함하고 koreanMeaning에 한국어 뜻을 적는다.
- 소재가 써지컬스틸이면 써지컬스틸 검색어와 티타늄 검색어를 각각 하나 이상 만든다.
- 브랜드명은 사진에서 명확히 확인될 때만 기록한다.
- 가격과 사이즈는 OCR로 실제 읽힌 것만 반환한다.
- 동일 검색어를 반복하지 않는다.
`;

    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4.1-mini",
        input: [{
          role: "user",
          content: [
            { type: "input_text", text: prompt },
            { type: "input_text", text: `현재 입력 상품정보: ${JSON.stringify(body.current || {})}` },
            { type: "input_image", image_url: imageDataUrl, detail: "high" }
          ]
        }],
        max_output_tokens: 900
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      return NextResponse.json(
        { error: data?.error?.message || "소싱 분석에 실패했습니다." },
        { status: response.status }
      );
    }

    const outputText =
      data.output_text ??
      data.output?.flatMap((item: any) => item.content ?? [])
        ?.find((item: any) => item.type === "output_text")?.text ??
      "";

    return NextResponse.json(extractJson(outputText));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "알 수 없는 오류" },
      { status: 500 }
    );
  }
}
