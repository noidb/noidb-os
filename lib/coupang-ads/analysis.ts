import type {
  CoupangAdsAnalyzedItem,
  CoupangAdsParsedSnapshot,
  CoupangAdsRawAd,
  CoupangAdsRecommendation,
  CoupangAdsSnapshotSource,
  CoupangAdsSummary,
} from "./types";

const recommendationLabels: Record<CoupangAdsRecommendation, string> = {
  focus: "집중 광고",
  expand: "확대 테스트",
  observe: "관찰",
  stop: "축소/중지 후보",
};

function numberValue(value: unknown): number {
  const parsed = typeof value === "string" ? Number(value.replace(/,/g, "")) : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function dateText(value: unknown): string {
  const digits = String(value ?? "").replace(/\D/g, "");
  return digits.length === 8 ? `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6)}` : String(value ?? "");
}

function statusOf(ad: CoupangAdsRawAd): { available: boolean; outOfStock: boolean; label: string } {
  const serving = String(ad.servingStatus?.status || "").toUpperCase();
  const hints = (ad.servingStatus?.hints || []).map(String).join(" ").toUpperCase();
  const outOfStock = /OUT.?OF.?STOCK|SOLD.?OUT|품절/.test(`${serving} ${hints}`);
  const active = ad.isActive !== false && !ad.isDeleted && !ad.isSuspended;
  const deliverable = !serving || serving === "APS_DELIVERABLE";
  const buyBox = String(ad.buyBoxRole || "").toUpperCase();
  const buyBoxOkay = !buyBox || buyBox === "WINNER";
  const available = active && deliverable && !outOfStock && buyBoxOkay && !ad.isApsExcludedProduct;
  if (outOfStock) return { available, outOfStock, label: "품절" };
  if (!active) return { available, outOfStock, label: "비활성/중지" };
  if (!deliverable) return { available, outOfStock, label: serving || "집행 불가" };
  if (!buyBoxOkay) return { available, outOfStock, label: `BuyBox ${buyBox}` };
  return { available, outOfStock, label: "판매 가능" };
}

function recommend(metrics: {
  available: boolean;
  orders: number;
  roas: number;
  clicks: number;
  adCost: number;
  ctr: number;
  impressions: number;
}): { recommendation: CoupangAdsRecommendation; reason: string; sampleWarning: boolean } {
  const sampleWarning = metrics.orders <= 1 || metrics.clicks < 5;
  if (!metrics.available) return { recommendation: "stop", reason: "품절·비활성·집행 불가 또는 BuyBox 문제", sampleWarning };
  if (metrics.orders >= 2 && metrics.roas >= 1000 && metrics.clicks >= 5) {
    return { recommendation: "focus", reason: "복수 주문과 충분한 클릭에서 ROAS 1,000% 이상", sampleWarning: false };
  }
  if (metrics.orders > 0 && metrics.roas >= 1000) {
    return { recommendation: "expand", reason: sampleWarning ? "고ROAS이나 주문/클릭 표본 부족 — 소폭 확대 테스트" : "ROAS 1,000% 이상 — 제한적으로 확대 테스트", sampleWarning };
  }
  if (metrics.orders >= 2 && metrics.roas >= 700) {
    return { recommendation: "expand", reason: "반복 주문과 양호한 ROAS — 제한적으로 확대 테스트", sampleWarning: false };
  }
  if (metrics.orders === 0 && (metrics.clicks >= 10 || metrics.adCost >= 2000)) {
    return { recommendation: "stop", reason: "충분한 클릭 또는 광고비에도 광고주문 0건", sampleWarning: false };
  }
  if (metrics.impressions >= 500 && metrics.ctr < 0.3) {
    return { recommendation: "stop", reason: "충분한 노출에서 CTR 0.3% 미만", sampleWarning: false };
  }
  if (metrics.ctr >= 0.5 && (metrics.clicks < 10 || metrics.adCost < 2000)) {
    return { recommendation: "observe", reason: "CTR은 양호하지만 주문·비용 표본이 아직 부족", sampleWarning: true };
  }
  return { recommendation: "observe", reason: "판단에 필요한 클릭·주문 데이터가 부족", sampleWarning: true };
}

function scoreCompleteness(ad: CoupangAdsRawAd): number {
  return numberValue(ad.impressions) + numberValue(ad.clicks) * 100 + numberValue(ad.deliveredAdCost) + numberValue(ad.adAttributedSales);
}

function analyzeAd(ad: CoupangAdsRawAd, duplicateCount: number): CoupangAdsAnalyzedItem {
  const impressions = numberValue(ad.impressions);
  const clicks = numberValue(ad.clicks);
  const adCost = numberValue(ad.deliveredAdCost);
  const adOrders = numberValue(ad.adAttributedOrders);
  const adSales = numberValue(ad.adAttributedSales);
  const ctr = numberValue(ad.ctr) || (impressions > 0 ? clicks / impressions * 100 : 0);
  const roas = numberValue(ad.roas) || (adCost > 0 ? adSales / adCost * 100 : 0);
  const conversionRate = numberValue(ad.clickToOrder) || (clicks > 0 ? adOrders / clicks * 100 : 0);
  const availability = statusOf(ad);
  const decision = recommend({ available: availability.available, orders: adOrders, roas, clicks, adCost, ctr, impressions });
  return {
    vendorItemId: String(ad.vendoritemid ?? ""),
    itemName: String(ad.itemName || "상품명 없음"),
    status: availability.label,
    impressions,
    clicks,
    ctr,
    adCost,
    adOrders,
    adSales,
    roas,
    conversionRate,
    outOfStock: availability.outOfStock,
    buyBoxRole: String(ad.buyBoxRole || "-") || "-",
    available: availability.available,
    recommendation: decision.recommendation,
    recommendationLabel: recommendationLabels[decision.recommendation],
    recommendationReason: decision.reason,
    sampleWarning: decision.sampleWarning,
    targetAllowedAdCost: adSales / 10,
    duplicateCount,
    raw: ad,
  };
}

export function parseCoupangAdsSnapshot(value: unknown): CoupangAdsParsedSnapshot {
  if (!value || typeof value !== "object") throw new Error("JSON 최상위 값이 객체가 아닙니다.");
  const source = value as CoupangAdsSnapshotSource;
  if (!Array.isArray(source.pages) || source.pages.length === 0) throw new Error("pages 배열이 없거나 비어 있습니다.");
  const rawAds = source.pages.flatMap((page, index) => {
    if (!page?.data || !Array.isArray(page.data.ads)) throw new Error(`${index + 1}번째 페이지에 data.ads 배열이 없습니다.`);
    return page.data.ads;
  });
  const expectedTotalCount = Math.max(0, ...source.pages.map(page => numberValue(page.data?.pageInfo?.totalCount)));
  const grouped = new Map<string, CoupangAdsRawAd[]>();
  rawAds.forEach((ad, index) => {
    const key = String(ad.vendoritemid ?? "").trim();
    if (!key) throw new Error(`${index + 1}번째 광고 상품에 vendoritemid가 없습니다.`);
    grouped.set(key, [...(grouped.get(key) || []), ad]);
  });
  const items = [...grouped.values()].map(matches => {
    const selected = [...matches].sort((a, b) => scoreCompleteness(b) - scoreCompleteness(a))[0];
    return analyzeAd(selected, matches.length - 1);
  });
  const duplicateCount = rawAds.length - items.length;
  const missingCount = Math.max(0, expectedTotalCount - rawAds.length);
  const warnings: string[] = [];
  if (missingCount) warnings.push(`파일 메타데이터는 ${expectedTotalCount}개지만 실제 ads는 ${rawAds.length}개입니다. ${missingCount}개가 수집되지 않았습니다.`);
  if (duplicateCount) warnings.push(`중복 vendoritemid ${duplicateCount}건을 지표가 가장 완전한 1건으로 통합했습니다. 원본 pages는 snapshot에 그대로 보존됩니다.`);
  return {
    source,
    items,
    groupId: String(source.groupId ?? ""),
    startDate: dateText(source.startDate),
    endDate: dateText(source.endDate),
    downloadedAt: String(source.downloadedAt || ""),
    expectedTotalCount,
    collectedCount: rawAds.length,
    uniqueCount: items.length,
    duplicateCount,
    missingCount,
    warnings,
  };
}

export function summarizeCoupangAds(items: CoupangAdsAnalyzedItem[]): CoupangAdsSummary {
  const summary: CoupangAdsSummary = {
    products: items.length,
    impressions: 0,
    clicks: 0,
    adCost: 0,
    adSales: 0,
    adOrders: 0,
    roas: 0,
    recommendations: { focus: 0, expand: 0, observe: 0, stop: 0 },
  };
  for (const item of items) {
    summary.impressions += item.impressions;
    summary.clicks += item.clicks;
    summary.adCost += item.adCost;
    summary.adSales += item.adSales;
    summary.adOrders += item.adOrders;
    summary.recommendations[item.recommendation] += 1;
  }
  summary.roas = summary.adCost > 0 ? summary.adSales / summary.adCost * 100 : 0;
  return summary;
}
