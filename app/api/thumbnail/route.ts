import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;

function parseDataUrl(dataUrl: string) {
  const match = dataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (!match) throw new Error("올바른 이미지 데이터가 아닙니다.");
  return { mime: match[1], buffer: Buffer.from(match[2], "base64") };
}

export async function POST(req: NextRequest) {
  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "OPENAI_API_KEY가 없습니다." }, { status: 500 });
    }

    const body = await req.json();
    const imageDataUrl = String(body.imageDataUrl || "");
    const option = String(body.option || "");
    const category = String(body.category || "주얼리");
    const keyword = String(body.keyword || "");

    if (!imageDataUrl.startsWith("data:image/")) {
      return NextResponse.json({ error: "먼저 제품사진을 선택해주세요." }, { status: 400 });
    }

    const { mime, buffer } = parseDataUrl(imageDataUrl);
    const form = new FormData();
    form.append("model", "gpt-image-1.5");
    form.append("image", new Blob([buffer], { type: mime }), "product.png");
    form.append("size", "1024x1024");
    form.append("quality", "medium");
    form.append("output_format", "png");
    form.append("prompt", `
첨부 제품의 디자인과 구조를 최대한 정확히 유지하여 쿠팡 상품 썸네일을 제작한다.
제품: ${keyword} ${category}
금속 색상 옵션: ${option}

필수 규칙:
- 정사각형 1024x1024
- 순백색 #FFFFFF 배경
- 제품 하나만 중앙 배치
- 제품이 화면의 약 85%를 차지
- 원본의 형태, 큐빅 위치, 두께, 비율, 각인을 임의로 변경하지 않기
- 금속 색상만 ${option}으로 자연스럽게 표현
- 텍스트, 가격, 로고, 손, 모델, 소품, 박스, 받침대 금지
- 아주 약한 자연스러운 그림자만 허용
- 선명하고 깨끗한 스튜디오 제품 사진
`);

    const response = await fetch("https://api.openai.com/v1/images/edits", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    });

    const data = await response.json();
    if (!response.ok) {
      return NextResponse.json(
        { error: data?.error?.message || "썸네일 생성에 실패했습니다." },
        { status: response.status }
      );
    }

    const b64 = data?.data?.[0]?.b64_json;
    if (!b64) throw new Error("생성된 이미지 데이터가 없습니다.");
    return NextResponse.json({ imageDataUrl: `data:image/png;base64,${b64}`, option });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "알 수 없는 오류" },
      { status: 500 }
    );
  }
}
