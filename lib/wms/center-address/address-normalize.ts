import type { AddressSearchCandidate, AddressVerificationResult } from "./types";

const SIDO_ALIASES: Array<[RegExp, string]> = [
  [/^(서울특별시|서울시|서울)/, "서울"],
  [/^(부산광역시|부산시|부산)/, "부산"],
  [/^(대구광역시|대구시|대구)/, "대구"],
  [/^(인천광역시|인천시|인천)/, "인천"],
  [/^(광주광역시|광주시|광주)/, "광주"],
  [/^(대전광역시|대전시|대전)/, "대전"],
  [/^(울산광역시|울산시|울산)/, "울산"],
  [/^(세종특별자치시|세종시|세종)/, "세종"],
  [/^(경기도|경기)/, "경기"],
  [/^(강원특별자치도|강원도|강원)/, "강원"],
  [/^(충청북도|충북)/, "충북"],
  [/^(충청남도|충남)/, "충남"],
  [/^(전북특별자치도|전라북도|전북)/, "전북"],
  [/^(전라남도|전남)/, "전남"],
  [/^(경상북도|경북)/, "경북"],
  [/^(경상남도|경남)/, "경남"],
  [/^(제주특별자치도|제주도|제주)/, "제주"],
];

export function stripDeliveryDetails(value: string): string {
  return value
    .replace(/\(택배수령담당자\s*:\s*\+?\d+\)\s*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeAddress(value: string): string {
  return stripDeliveryDetails(value)
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[(),]/g, " ")
    .replace(/\s+/g, "")
    .trim();
}

function sido(value: string): string {
  const compact = stripDeliveryDetails(value).replace(/^\s+/, "");
  return SIDO_ALIASES.find(([pattern]) => pattern.test(compact))?.[1] || "";
}

function administrativeNames(value: string): Set<string> {
  const clean = stripDeliveryDetails(value).replace(/[(),]/g, " ");
  return new Set([...clean.matchAll(/([가-힣]+(?:시|군|구))(?=\s|$)/g)].map(match => match[1]));
}

function roadKeys(value: string): Set<string> {
  const clean = stripDeliveryDetails(value).replace(/[,()]/g, " ");
  const matches = clean.matchAll(/([가-힣0-9·.\-]+(?:대로|로)(?:\s*\d+번길)?|[가-힣0-9·.\-]+길)\s*(\d+(?:-\d+)?)/g);
  return new Set([...matches].map(match => `${match[1].replace(/\s+/g, "")}#${match[2]}`));
}

function parcelKeys(value: string): Set<string> {
  const clean = stripDeliveryDetails(value).replace(/[,()]/g, " ");
  const matches = clean.matchAll(/([가-힣0-9·.\-]+(?:읍|면|동|리))\s*(\d+(?:-\d+)?)/g);
  return new Set([...matches].map(match => `${match[1]}#${match[2]}`));
}

function intersects(left: Set<string>, right: Set<string>): boolean {
  for (const value of left) if (right.has(value)) return true;
  return false;
}

export function safelyMatchesAddress(sourceAddress: string, candidateAddress: string): boolean {
  if (!sourceAddress || !candidateAddress || sido(sourceAddress) !== sido(candidateAddress)) return false;
  const sourceAdmins = administrativeNames(sourceAddress);
  const candidateAdmins = administrativeNames(candidateAddress);
  if (!sourceAdmins.size || !candidateAdmins.size || !intersects(sourceAdmins, candidateAdmins)) return false;
  const roadsMatch = intersects(roadKeys(sourceAddress), roadKeys(candidateAddress));
  const parcelsMatch = intersects(parcelKeys(sourceAddress), parcelKeys(candidateAddress));
  return roadsMatch || parcelsMatch;
}

export function verifyAddressCandidates(sourceAddress: string, candidates: readonly AddressSearchCandidate[]): AddressVerificationResult {
  const valid = candidates.filter(candidate => {
    if (!/^\d{5}$/.test(candidate.postalCode)) return false;
    return [candidate.roadAddress, candidate.jibunAddress].filter(Boolean).some(address => safelyMatchesAddress(sourceAddress, address));
  });
  const unique = new Map(valid.map(candidate => [`${candidate.postalCode}\0${normalizeAddress(candidate.roadAddress || candidate.jibunAddress)}`, candidate]));
  if (unique.size === 1) {
    return { approved: true, candidate: [...unique.values()][0], validCandidateCount: 1, reason: "원본 주소의 지역 및 도로명/지번 핵심값이 단일 후보와 일치합니다." };
  }
  if (unique.size > 1) return { approved: false, validCandidateCount: unique.size, reason: `안전하게 일치하는 검색 후보가 ${unique.size}개입니다.` };
  return { approved: false, validCandidateCount: 0, reason: candidates.length ? "검색 후보의 지역 또는 도로명/지번·건물번호가 원본과 일치하지 않습니다." : "주소 검색 결과가 없습니다." };
}

export function addressLedgerKey(center: string, address: string): string {
  return `${center.trim().replace(/\s+/g, "")}\0${normalizeAddress(address)}`;
}
