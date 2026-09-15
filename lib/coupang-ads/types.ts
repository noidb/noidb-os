export type CoupangAdsRecommendation = "focus" | "expand" | "observe" | "stop";

export interface CoupangAdsRawAd {
  vendoritemid?: string | number;
  itemName?: string;
  impressions?: number;
  clicks?: number;
  ctr?: string | number;
  deliveredAdCost?: number;
  adAttributedOrders?: number;
  adAttributedSales?: number;
  roas?: number;
  clickToOrder?: number;
  isActive?: boolean;
  isDeleted?: boolean;
  isSuspended?: boolean;
  isApsExcludedProduct?: boolean;
  servingStatus?: { status?: string; hints?: unknown[] } | null;
  buyBoxRole?: string | null;
  [key: string]: unknown;
}

export interface CoupangAdsPage {
  page?: number;
  data?: {
    ads?: CoupangAdsRawAd[];
    pageInfo?: { page?: number; pageSize?: number; totalCount?: number };
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface CoupangAdsSnapshotSource {
  source?: string;
  groupId?: string | number;
  startDate?: string | number;
  endDate?: string | number;
  downloadedAt?: string;
  pages?: CoupangAdsPage[];
  [key: string]: unknown;
}

export interface CoupangAdsAnalyzedItem {
  vendorItemId: string;
  itemName: string;
  status: string;
  impressions: number;
  clicks: number;
  ctr: number;
  adCost: number;
  adOrders: number;
  adSales: number;
  roas: number;
  conversionRate: number;
  outOfStock: boolean;
  buyBoxRole: string;
  available: boolean;
  recommendation: CoupangAdsRecommendation;
  recommendationLabel: string;
  recommendationReason: string;
  sampleWarning: boolean;
  targetAllowedAdCost: number;
  duplicateCount: number;
  raw: CoupangAdsRawAd;
}

export interface CoupangAdsParsedSnapshot {
  source: CoupangAdsSnapshotSource;
  items: CoupangAdsAnalyzedItem[];
  groupId: string;
  startDate: string;
  endDate: string;
  downloadedAt: string;
  expectedTotalCount: number;
  collectedCount: number;
  uniqueCount: number;
  duplicateCount: number;
  missingCount: number;
  warnings: string[];
}

export interface CoupangAdsSummary {
  products: number;
  impressions: number;
  clicks: number;
  adCost: number;
  adSales: number;
  adOrders: number;
  roas: number;
  recommendations: Record<CoupangAdsRecommendation, number>;
}
