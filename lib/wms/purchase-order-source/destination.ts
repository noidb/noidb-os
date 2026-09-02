import { readFile } from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";
import { findVerifiedPostalCode } from "../data/verified-postal-codes";
import { addressLedgerKey, normalizeAddress } from "../center-address/address-normalize";
import { searchAndVerifyPostalCode } from "../center-address/address-search";
import { loadCenterAddressLedger, saveCenterAddressLedgerEntries } from "../center-address/ledger-store";
import type { CenterAddressLedgerEntry, CenterAddressResolution } from "../center-address/types";

const TEMPLATE = path.join(process.cwd(), "lib", "wms", "data", "hanjin-template-static", "한진택배_쿠팡_고정형_기준서식.xlsx");

export interface DestinationSupplement { postalCode: string; source: CenterAddressResolution["source"]; matchedAddress?: string; }

function normalized(value: string): string {
  return value.replace(/\(택배수령담당자\s*:\s*\+?\d+\)\s*$/, "").replace(/\s+/g, "").trim();
}

function cellValue(rowXml: string, column: string): string {
  const match = rowXml.match(new RegExp(`<x:c r="${column}\\d+"[^>]*>[\\s\\S]*?<x:v>([\\s\\S]*?)<\\/x:v>[\\s\\S]*?<\\/x:c>`));
  return (match?.[1] || "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
}

let cachedTemplateDestinations: Map<string, { postalCode: string; address: string }> | null = null;
async function templateDestinations() {
  if (cachedTemplateDestinations) return cachedTemplateDestinations;
  const zip = await JSZip.loadAsync(await readFile(TEMPLATE));
  const xml = await zip.file("xl/worksheets/sheet1.xml")!.async("string");
  const result = new Map<string, { postalCode: string; address: string }>();
  for (const row of xml.matchAll(/<x:row r="\d+"[^>]*>([\s\S]*?)<\/x:row>/g)) {
    const recipient = cellValue(row[1], "AB");
    const center = recipient.match(/^로켓배송\*(.+)$/)?.[1]?.trim();
    const postalCode = cellValue(row[1], "AD").trim();
    const address = cellValue(row[1], "AE").trim();
    if (center && postalCode && address) result.set(center.replace(/\s+/g, ""), { postalCode, address });
  }
  cachedTemplateDestinations = result;
  return result;
}

export async function resolveDestinationSupplements(requests: readonly { fulfillmentCenterName: string; address: string }[]): Promise<Map<string, CenterAddressResolution>> {
  const ledger = await loadCenterAddressLedger();
  const ledgerByKey = new Map(ledger.entries.map(entry => [entry.key, entry]));
  const templates = await templateDestinations();
  const results = new Map<string, CenterAddressResolution>();
  const newEntries: CenterAddressLedgerEntry[] = [];
  const unique = new Map(requests.map(request => [addressLedgerKey(request.fulfillmentCenterName, request.address), request]));

  for (const [key, request] of unique) {
    const center = request.fulfillmentCenterName;
    const sourceAddress = request.address;
    const verified = findVerifiedPostalCode(center, sourceAddress);
    if (verified) {
      results.set(key, { fulfillmentCenterName: center, sourceAddress, postalCode: verified, matchedAddress: sourceAddress, source: "verified-postal-codes", status: "approved", candidateCount: 1, reason: "기존 공식 검증 목록과 센터명·주소가 일치합니다." });
      continue;
    }
    const template = templates.get(center.replace(/\s+/g, ""));
    if (template && normalized(template.address) === normalized(sourceAddress)) {
      results.set(key, { fulfillmentCenterName: center, sourceAddress, postalCode: template.postalCode, matchedAddress: template.address, source: "hanjin-template", status: "approved", candidateCount: 1, reason: "기존 한진 기준서식의 센터명·주소가 정확히 일치합니다." });
      continue;
    }
    const cached = ledgerByKey.get(key);
    if (cached && cached.normalizedSourceAddress === normalizeAddress(sourceAddress) && /^\d{5}$/.test(cached.postalCode)) {
      results.set(key, { fulfillmentCenterName: center, sourceAddress, postalCode: cached.postalCode, matchedAddress: cached.matchedAddress, source: "center-address-ledger", status: "approved", candidateCount: 1, reason: `센터주소 원장 캐시 재사용 (${cached.verificationSource})` });
      continue;
    }

    const searched = await searchAndVerifyPostalCode(sourceAddress);
    if (searched.approved && searched.candidate && searched.source) {
      const now = new Date().toISOString();
      const matchedAddress = searched.candidate.roadAddress || searched.candidate.jibunAddress;
      const entry: CenterAddressLedgerEntry = { key, fulfillmentCenterName: center, sourceAddress, normalizedSourceAddress: normalizeAddress(sourceAddress), postalCode: searched.candidate.postalCode, matchedAddress, verificationSource: searched.source, verifiedAt: now, updatedAt: now };
      newEntries.push(entry);
      results.set(key, { fulfillmentCenterName: center, sourceAddress, postalCode: entry.postalCode, matchedAddress, source: searched.source, status: "approved", candidateCount: searched.validCandidateCount, reason: searched.reason });
    } else {
      results.set(key, { fulfillmentCenterName: center, sourceAddress, postalCode: "", matchedAddress: "", source: searched.source, status: "needs_review", candidateCount: searched.validCandidateCount, reason: searched.reason });
    }
  }
  await saveCenterAddressLedgerEntries(newEntries);
  return results;
}

export async function resolveDestinationSupplement(center: string, sourceAddress: string): Promise<DestinationSupplement | null> {
  const key = addressLedgerKey(center, sourceAddress);
  const result = (await resolveDestinationSupplements([{ fulfillmentCenterName: center, address: sourceAddress }])).get(key);
  return result?.status === "approved" ? { postalCode: result.postalCode, source: result.source, matchedAddress: result.matchedAddress } : null;
}
