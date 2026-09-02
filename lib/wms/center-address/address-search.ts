import { stripDeliveryDetails, verifyAddressCandidates } from "./address-normalize";
import type { AddressSearchCandidate, AddressVerificationResult } from "./types";

type JusoItem = { roadAddr?: unknown; jibunAddr?: unknown; zipNo?: unknown };

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function decodeHtml(value: string): string {
  return value.replace(/&quot;/g, '"').replace(/&#39;|&#x27;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}

async function searchOfficialJuso(address: string): Promise<AddressSearchCandidate[]> {
  const key = process.env.JUSO_API_CONFM_KEY?.trim();
  if (!key) return [];
  const params = new URLSearchParams({ confmKey: key, currentPage: "1", countPerPage: "20", keyword: stripDeliveryDetails(address), resultType: "json", firstSort: "road" });
  const response = await fetch(`https://business.juso.go.kr/addrlink/addrLinkApi.do?${params}`, { cache: "no-store", signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`공식 도로명주소 API HTTP ${response.status}`);
  const body = await response.json() as { results?: { common?: { errorCode?: unknown; errorMessage?: unknown }; juso?: JusoItem[] | "" | null } };
  const common = body.results?.common;
  if (text(common?.errorCode) !== "0") throw new Error(`공식 도로명주소 API 오류: ${text(common?.errorMessage) || text(common?.errorCode)}`);
  const rows = Array.isArray(body.results?.juso) ? body.results.juso : [];
  return rows.map(item => ({ postalCode: text(item.zipNo), roadAddress: text(item.roadAddr), jibunAddress: text(item.jibunAddr), source: "juso-api" as const }));
}

async function searchKakaoPostcode(address: string): Promise<AddressSearchCandidate[]> {
  const params = new URLSearchParams({ region_name: stripDeliveryDetails(address), cq: "", cpage: "1", origin: "https://postcode.map.daum.net", isp: "N", isgr: "N", isgj: "N", ongr: "N", ongj: "N" });
  const response = await fetch(`https://postcode.map.daum.net/search?${params}`, { cache: "no-store", signal: AbortSignal.timeout(10_000), headers: { "user-agent": "NOID-B-OS/1.0 address-verification" } });
  if (!response.ok) throw new Error(`Kakao 우편번호 검색 HTTP ${response.status}`);
  const html = await response.text();
  const results: AddressSearchCandidate[] = [];
  for (const match of html.matchAll(/<li class="list_post_item[^\"]*"([\s\S]*?)<\/li>/g)) {
    const block = match[1];
    const postalCode = decodeHtml(block.match(/data-zonecode="([^"]*)"/)?.[1] || "");
    const addresses = [...block.matchAll(/data-addr="([^"]*)"/g)].map(item => decodeHtml(item[1]).trim()).filter(Boolean);
    const roadAddress = decodeHtml(block.match(/data-addr_type="R"[\s\S]*?data-addr="([^"]*)"/)?.[1] || addresses[0] || "");
    const jibunAddress = addresses.find(value => value !== roadAddress && /(?:읍|면|동|리)\s*\d/.test(value)) || "";
    if (postalCode && (roadAddress || jibunAddress)) results.push({ postalCode, roadAddress, jibunAddress, source: "kakao-postcode" });
  }
  return results;
}

export async function searchAndVerifyPostalCode(sourceAddress: string): Promise<AddressVerificationResult & { source: "juso-api" | "kakao-postcode" | "" }> {
  try {
    const official = await searchOfficialJuso(sourceAddress);
    const verified = verifyAddressCandidates(sourceAddress, official);
    if (verified.approved) return { ...verified, source: "juso-api" };
    if (official.length) return { ...verified, source: "juso-api" };
  } catch (error) {
    if (process.env.NODE_ENV !== "production") console.warn("[center-address] official Juso lookup failed", error);
  }
  try {
    const fallback = await searchKakaoPostcode(sourceAddress);
    return { ...verifyAddressCandidates(sourceAddress, fallback), source: "kakao-postcode" };
  } catch (error) {
    if (process.env.NODE_ENV !== "production") console.warn("[center-address] Kakao postcode lookup failed", error);
    return { approved: false, validCandidateCount: 0, reason: error instanceof Error ? error.message : "주소 검색에 실패했습니다.", source: "" };
  }
}
