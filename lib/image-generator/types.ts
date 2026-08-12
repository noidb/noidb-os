export type ColorCode = "RG" | "GO" | "SI";

export type PhotoRole =
  | "front"
  | "back"
  | "side"
  | "clasp"
  | "pair"
  | "wear-reference"
  | "size-reference"
  | "detail-reference"
  | "other";

export type ReferencePhoto = {
  id: string;
  name: string;
  role: PhotoRole;
  dataUrl: string;
  primary?: boolean;
};

export type GeneratorProduct = {
  category: string;
  model: string;
  photographedColor: ColorCode;
  colors: ColorCode[];
  wearColor: ColorCode;
  widthMm: string;
  heightMm: string;
  thicknessMm: string;
};

export type ProductAnalysis = {
  detectedType: string;
  detectedColor: string;
  estimatedSize: string;
  confirmedViews: string[];
  missingPhotos: string[];
  canGenerate: boolean;
  reason: string;
  confidence: number;
};

export type AssetKind =
  | "baseline"
  | "color"
  | "wear"
  | "all-colors"
  | "detail"
  | "model-template";

export type GeneratedAsset = {
  id: string;
  kind: AssetKind;
  label: string;
  filename: string;
  dataUrl: string;
  approved: boolean;
  createdAt: number;
  regenerationCount: number;
  color?: ColorCode;
  variant?: number;
  checks?: QualityCheck[];
};

export type QualityCheck = {
  key: string;
  label: string;
  status: "pass" | "fail" | "review";
  message: string;
};

export type GeneratorSession = {
  version: 1;
  updatedAt: number;
  product: GeneratorProduct;
  photos: ReferencePhoto[];
  headerImage?: ReferencePhoto;
  modelTemplate?: GeneratedAsset;
  modelTemplateApproved: boolean;
  analysis?: ProductAnalysis;
  assets: GeneratedAsset[];
  detailOrder: string[];
  detailPage?: string;
  detailOptions: string[];
};
