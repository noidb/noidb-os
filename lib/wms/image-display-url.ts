/**
 * 상품 이미지를 브라우저 화면에 표시할 때 쓰는 공통 URL 변환 함수 (2026-08-20 신규).
 *
 * 근본 원인(실기기 진단으로 확인, 2026-08-20): drive.google.com 이미지 URL을 <img src>에
 * 직접 넣으면 모바일 브라우저에서 로드가 실패한다(onerror) — 서버(Node fetch)로는 같은 URL이
 * 항상 정상 응답했지만, 브라우저가 직접 요청할 때만 실패했다(리다이렉트/차단 등 브라우저·기기별
 * 동작 차이로 추정). /api/wms/image-proxy를 거치면(서버가 대신 가져와 같은 origin으로 전달)
 * 실기기에서도 100% 정상 로드됨을 실측 확인했다. 반면 쿠팡 CDN(t5a/t2a.coupangcdn.com) 이미지는
 * 기존에도 직접 로드가 정상 동작해왔으므로(사용자 확인) 그대로 직접 URL을 쓴다 — 불필요하게
 * 모든 이미지를 프록시로 돌리면 서버 부하만 늘고 얻는 게 없다.
 *
 * 이 함수는 "화면에 보여줄 URL"만 계산한다. Google Sheets에 저장하는 값, 웨이브/발주서
 * 데이터에 저장된 imageUrl, Canvas 발주서 이미지 생성(이미 자체적으로 image-proxy를 쓰고 있음)에는
 * 전혀 영향을 주지 않는다 — 원본 imageUrl은 그대로 두고 <img src>에 넣기 직전에만 이 함수를
 * 거친다.
 */

const IMAGE_PROXY_PATH = "/api/wms/image-proxy";

/** 브라우저에서 직접 로드하면 실패할 수 있어 반드시 서버 프록시를 거쳐야 하는 호스트. */
const HOSTS_REQUIRING_PROXY = ["drive.google.com", "googleusercontent.com"];

function isHostRequiringProxy(host: string): boolean {
  const lower = host.toLowerCase();
  return HOSTS_REQUIRING_PROXY.some(h => lower === h || lower.endsWith(`.${h}`));
}

/**
 * 화면 표시용 이미지 URL을 만든다.
 * - 빈 값이면 "" 그대로 반환(호출한 쪽에서 "이미지 없음" 처리).
 * - 이미 /api/wms/image-proxy 형태면 중복으로 다시 감싸지 않는다.
 * - drive.google.com / googleusercontent.com이면 image-proxy를 거친다.
 * - 그 외(쿠팡 CDN 등, 이미 직접 로드가 정상 동작 중인 호스트)는 원본 URL을 그대로 쓴다.
 */
export function getWmsDisplayImageUrl(imageUrl: string | undefined | null): string {
  const url = (imageUrl || "").trim();
  if (!url) return "";
  if (url.startsWith(IMAGE_PROXY_PATH)) return url;

  let host: string;
  try {
    host = new URL(url).host;
  } catch {
    // 상대경로 등 URL로 파싱 안 되는 값은 그대로 반환(임의로 손대지 않음).
    return url;
  }

  if (!isHostRequiringProxy(host)) return url;
  return `${IMAGE_PROXY_PATH}?url=${encodeURIComponent(url)}`;
}
