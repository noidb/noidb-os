export type ExportProduct = {
  supplier: string;
  category: string;
  gender: string;
  material: string;
  colors: string;
  sizes: string;
  modelNo: string;
  warehouse: string;
  replacementSku: string;
  keyword: string;
  dimension: string;
  cost: string;
  price: string;
};

export type ExportPayload = {
  product: ExportProduct;
  model: string;
  title: string;
  tags: string;
  /** Extra image filenames list */
  additionalImages?: string[];
  /** Comma-joined extras for one cell: wr0001-01.jpg,wr0001-02.jpg,wr0001-03.jpg */
  additionalImagesCsv?: string;
  sourcingUrl?: string;
  /** 색상 옵션명 → 실제 썸네일 data URL */
  optionImages?: Record<string, string>;
};

export type SkuRow = {
  color: string;
  size: string;
  colorCode: string;
  sku: string;
  thumbFile: string;
  detailFile: string;
  labelFile: string;
};
