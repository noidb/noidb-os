export interface PurchaseOrderSourceRecord {
  purchaseOrderNumber: string;
  sourceContainerFile: string;
  sourceEntryFile: string;
  sourceSheet: string;
  sourceRow: number;
  fulfillmentCenterName: string;
  expectedArrivalDate: string;
  recipientName: string;
  phone: string;
  postalCode: string;
  address: string;
  skuId: string;
  barcode: string;
  productName: string;
  optionName: string;
  orderedQuantity: number;
}

export interface PurchaseOrderSourceDocument {
  purchaseOrderNumber: string;
  sourceContainerFile: string;
  sourceEntryFile: string;
  sourceSheet: string;
  sourceRow: number;
  fulfillmentCenterName: string;
  expectedArrivalDate: string;
  recipientName: string;
  phone: string;
  postalCode: string;
  address: string;
  records: PurchaseOrderSourceRecord[];
}

export interface PurchaseOrderDuplicate {
  purchaseOrderNumber: string;
  sources: string[];
}

export interface PurchaseOrderParseError {
  sourceContainerFile: string;
  sourceEntryFile: string;
  message: string;
}

export interface PurchaseOrderIndex {
  byPurchaseOrderNumber: Map<string, PurchaseOrderSourceDocument>;
  duplicateFiles: PurchaseOrderDuplicate[];
  identicalDuplicates: PurchaseOrderDuplicate[];
  conflicts: PurchaseOrderDuplicate[];
  parseErrors: PurchaseOrderParseError[];
  sourceContainerCount: number;
  sourceEntryCount: number;
}

export interface PurchaseOrderBinaryInput {
  sourceContainerFile: string;
  sourceEntryFile: string;
  buffer: Buffer;
}
