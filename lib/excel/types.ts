export type ExportProduct = {
  supplier: string;
  category: string;
  gender: string;
  material: string;
  colors: string;
  sizes: string;
  modelNo: string;
  keyword: string;
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
