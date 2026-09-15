import fs from "node:fs";
import { NextResponse } from "next/server";
import path from "node:path";
const types: Record<string,string> = { ".jpg":"image/jpeg", ".jpeg":"image/jpeg", ".png":"image/png", ".webp":"image/webp", ".avif":"image/avif", ".heic":"image/heic", ".heif":"image/heif" };
export async function GET(req: Request) { const file = new URL(req.url).searchParams.get("path"); if (!file) return new NextResponse("missing", { status: 400 }); try { const stream = fs.createReadStream(file); return new NextResponse(stream as unknown as ReadableStream, { headers: { "Content-Type": types[path.extname(file).toLowerCase()] || "application/octet-stream", "Cache-Control": "private, max-age=300" } }); } catch { return new NextResponse("not found", { status: 404 }); } }
