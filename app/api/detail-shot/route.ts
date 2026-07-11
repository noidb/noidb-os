import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;

function parseDataUrl(dataUrl: string) {
  const match = dataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (!match) throw new Error("올바른 이미지 데이터가 아닙니다.");
  return { mime: match[1], buffer: Buffer.from(match[2], "base64") };
}

const shotPrompts: Record<string, string> = {
  front: "제품만 정면에서 촬영한 스튜디오 제품컷. 전체 구조와 장식 위치가 정확히 보이게 한다.",
  angle: "제품만 약 45도 사선에서 촬영한 스튜디오 제품컷. 입체감과 금속 두께가 자연스럽게 보이게 한다.",
  side: "제품만 측면에서 촬영한 스튜디오 제품컷. 높이, 두께, 밴드 구조가 정확히 보이게 한다.",
  closeup: "제품 장식 부분을 크게 보여주는 매크로 클로즈업. 큐빅과 금속 표면을 선명하게 표현한다.",
  back: "제품의 뒷면과 안쪽 구조가 보이는 제품컷. 밴드 안쪽과 마감 상태를 사실적으로 보여준다.",
  wearingFront: "20~30대 한국 여성의 깨끗한 손에 제품을 착용한 정면 착용컷. 화이트 배경, 얼굴 제외, 제품 중심.",
  wearingSide: "20~30대 한국 여성의 깨끗한 손에 제품을 착용한 측면 착용컷. 화이트 배경, 얼굴 제외, 제품 중심."
};

export async function POST(req: NextRequest) {
  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return NextResponse.json({ error: "OPENAI_API_KEY가 없습니다." }, { status: 500 });

    const body = await req.json();
    const imageDataUrl = String(body.imageDataUrl || "");
    const shotType = String(body.shotType || "");
    const option = String(body.option || "");
    const category = String(body.category || "주얼리");
    const keyword = String(body.keyword || "");

    if (!imageDataUrl.startsWith("data:image/")) {
      return NextResponse.json({ error: "먼저 제품사진을 선택해주세요." }, { status: 400 });
    }
    if (!shotPrompts[shotType]) {
      return NextResponse.json({ error: "지원하지 않는 촬영 유형입니다." }, { status: 400 });
    }

    const { mime, buffer } = parseDataUrl(imageDataUrl);
    const form = new FormData();
    form.append("model", "gpt-image-1.5");
    form.append("image", new Blob([buffer], { type: mime }), "reference.png");
    form.append("size", "1024x1536");
    form.append("quality", "medium");
    form.append("output_format", "png");
    form.append("prompt", `
첨부한 실제 제품사진을 기준으로 촬영컷을 생성한다.
제품 종류: ${category}
제품 특징: ${keyword}
금속 색상: ${option || "원본 색상 유지"}
촬영 지시: ${shotPrompts[shotType]}

필수 규칙:
- 원본 제품의 디자인, 체인 패턴, 큐빅 위치와 개수, 밴드 구조, 비율을 최대한 정확히 유지
- 원본에 없는 장식, 로고, 문자, 큐빅, 체인을 추가하지 않기
- 원본 각인이 불명확하면 임의 문자를 생성하지 않기
- 순백색 #FFFFFF 배경, 세로형 2:3
- 텍스트, 가격, 워터마크, 소품, 박스 금지
- 깨끗한 고급 주얼리 스튜디오 사진
`);

    const response = await fetch("https://api.openai.com/v1/images/edits", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form
    });

    const data = await response.json();
    if (!response.ok) {
      return NextResponse.json(
        { error: data?.error?.message || "이미지 생성에 실패했습니다." },
        { status: response.status }
      );
    }

    const b64 = data?.data?.[0]?.b64_json;
    if (!b64) throw new Error("생성된 이미지 데이터가 없습니다.");

    return NextResponse.json({ imageDataUrl: `data:image/png;base64,${b64}` });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "알 수 없는 오류" },
      { status: 500 }
    );
  }
}
