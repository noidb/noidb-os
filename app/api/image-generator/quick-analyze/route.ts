import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;

type SectionInput = { id?: string; dataUrl?: string };
type Decision = { id: string; keep: boolean; kind: "product" | "wear" | "exclude"; reason: string };

function outputText(data: Record<string, unknown>) {
  if (typeof data.output_text === "string") return data.output_text;
  const output = Array.isArray(data.output) ? data.output : [];
  for (const item of output) {
    if (!item || typeof item !== "object") continue;
    const content = Array.isArray((item as { content?: unknown[] }).content) ? (item as { content: unknown[] }).content : [];
    for (const part of content) {
      if (part && typeof part === "object" && (part as { type?: string }).type === "output_text") return String((part as { text?: string }).text || "");
    }
  }
  return "";
}

function extractDecisions(text: string): Decision[] {
  const clean = text.replace(/```json|```/g, "").trim();
  const start = clean.indexOf("[");
  const end = clean.lastIndexOf("]");
  if (start < 0 || end <= start) throw new Error("선별 결과를 읽지 못했습니다.");
  const parsed = JSON.parse(clean.slice(start, end + 1));
  if (!Array.isArray(parsed)) throw new Error("선별 결과가 올바르지 않습니다.");
  return parsed.map(item => ({
    id: String(item.id || ""),
    keep: Boolean(item.keep),
    kind: item.kind === "product" || item.kind === "wear" ? item.kind : "exclude",
    reason: String(item.reason || "자동 선별"),
  }));
}

export async function POST(request: NextRequest) {
  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return NextResponse.json({ error: "서버에 이미지 분석 API 키가 설정되지 않았습니다." }, { status: 500 });
    const body = await request.json() as { sections?: SectionInput[] };
    const sections = (body.sections || []).filter(section => section.id && section.dataUrl?.startsWith("data:image/")).slice(0, 12);
    if (!sections.length) return NextResponse.json({ error: "선별할 상세페이지 구간이 없습니다." }, { status: 400 });

    const prompt = `당신은 주얼리 쇼핑몰 상세페이지의 사진 선별 담당자입니다. 입력 이미지를 각각 독립적으로 판단하세요.

keep=true로 남길 것:
- 주얼리 제품 자체가 선명하게 보이는 단독 제품컷
- 사람이 실제 제품을 착용한 착용컷
- 제품/착용컷에 중국어, 영어, 설명문, 로고가 일부 섞여 있어도 실제 제품 사진이 충분히 보이면 유지

keep=false로 제외할 것:
- 포장 상자, 파우치, 보증서, 쇼핑백 등 패키지가 중심인 사진
- 브랜드 소개, 브랜드 로고, 설명 글, 가격표, 치수표, 옵션표, 주문 안내, 배송 안내 중심 구간
- 글자만 있거나 제품이 너무 작고 불분명한 구간
- 주얼리 제품과 무관한 장면

패키지 옆에 제품이 아주 작게 놓인 경우도 제외하세요. 제품이 사진의 핵심 피사체인 경우만 유지하세요.
각 입력 id를 빠짐없이 아래 JSON 배열 하나로만 답하세요.
[{"id":"quick-1","keep":true,"kind":"product","reason":"제품 단독컷"}]
kind는 product, wear, exclude 중 하나입니다.`;
    const content: Array<Record<string, unknown>> = [{ type: "input_text", text: prompt }];
    sections.forEach(section => {
      content.push({ type: "input_text", text: `구간 id: ${section.id}` });
      content.push({ type: "input_image", image_url: section.dataUrl, detail: "low" });
    });
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "gpt-4.1-mini", input: [{ role: "user", content }], max_output_tokens: 1600 }),
    });
    const data = await response.json() as Record<string, unknown>;
    if (!response.ok) return NextResponse.json({ error: "상세페이지 사진을 선별하지 못했습니다. 잠시 뒤 다시 시도해주세요." }, { status: response.status });
    return NextResponse.json({ decisions: extractDecisions(outputText(data)) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "사진을 선별하는 중 문제가 생겼습니다." }, { status: 500 });
  }
}
