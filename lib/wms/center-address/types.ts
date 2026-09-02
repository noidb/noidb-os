export type CenterAddressVerificationSource =
  | "juso-api"
  | "kakao-postcode"
  | "center-address-ledger"
  | "verified-postal-codes"
  | "hanjin-template";

export interface CenterAddressLedgerEntry {
  key: string;
  fulfillmentCenterName: string;
  sourceAddress: string;
  normalizedSourceAddress: string;
  postalCode: string;
  matchedAddress: string;
  verificationSource: Exclude<CenterAddressVerificationSource, "center-address-ledger">;
  verifiedAt: string;
  updatedAt: string;
}

export interface CenterAddressLedger {
  schemaVersion: 1;
  updatedAt: string;
  entries: CenterAddressLedgerEntry[];
}

export interface AddressSearchCandidate {
  postalCode: string;
  roadAddress: string;
  jibunAddress: string;
  source: "juso-api" | "kakao-postcode";
}

export interface AddressVerificationResult {
  approved: boolean;
  candidate?: AddressSearchCandidate;
  validCandidateCount: number;
  reason: string;
}

export interface CenterAddressResolution {
  fulfillmentCenterName: string;
  sourceAddress: string;
  postalCode: string;
  matchedAddress: string;
  source: CenterAddressVerificationSource | "";
  status: "approved" | "needs_review";
  candidateCount: number;
  reason: string;
}
