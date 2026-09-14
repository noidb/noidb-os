import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { isSameOriginActionRequest } from "@/lib/wms/noidb-action-auth";
import { readWeeklyFile, saveWeeklyFile } from "@/lib/wms/weekly-work-files";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: NextRequest) {
  if (!isSameOriginActionRequest(request)) return NextResponse.json({ success:false,error:"주간 업무 화면에서 사진을 추가해 주세요." },{status:403});
  try {
    const { dataUrl } = await request.json();
    if (typeof dataUrl !== "string" || dataUrl.length > 1_000_000) throw new Error("사진 용량을 줄인 뒤 다시 추가해 주세요.");
    const match = dataUrl.match(/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/);
    if (!match) throw new Error("JPG·PNG·WebP 사진을 선택해 주세요.");
    const bytes = Buffer.from(match[2], "base64");
    const valid = match[1] === "image/png" ? bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
      : match[1] === "image/jpeg" ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
      : bytes.subarray(0,4).toString() === "RIFF" && bytes.subarray(8,12).toString() === "WEBP";
    if (!valid || bytes.length < 12) throw new Error("올바른 사진 파일을 선택해 주세요.");
    const id = createHash("sha256").update(bytes).digest("hex");
    await saveWeeklyFile(`image-${id}.json`, Buffer.from(JSON.stringify({mimeType:match[1],base64:match[2]})));
    return NextResponse.json({success:true,imageUrl:`/api/wms/weekly-work/image?id=${id}`});
  } catch(error) { return NextResponse.json({success:false,error:error instanceof Error ? error.message : "사진을 저장하지 못했습니다."},{status:400}); }
}
export async function GET(request: NextRequest) {
  const id=request.nextUrl.searchParams.get("id") || "";
  if (!/^[a-f0-9]{64}$/.test(id)) return new NextResponse(null,{status:404});
  try {
    const file=await readWeeklyFile(`image-${id}.json`);
    if(!file)return new NextResponse(null,{status:404});
    const data=JSON.parse(file.toString());
    return new NextResponse(Buffer.from(data.base64,"base64"),{headers:{"Content-Type":data.mimeType,"Cache-Control":"private, max-age=86400","X-Content-Type-Options":"nosniff"}});
  } catch { return new NextResponse(null,{status:503}); }
}
