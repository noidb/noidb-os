import type { ShipmentOutputGeneration } from "../picking-wave/types";

export type ShipmentStatus =
  | "draft"
  | "invoice_generated"
  | "tracking_verified"
  | "upload_generated"
  | "output_generated"
  | "dispatched";

export interface ShipmentPurchaseOrder {
  purchaseOrderNumber: string;
  sourceWaveId: string;
  basketNumber: string;
  fulfillmentCenter: string;
  expectedDate: string;
  skuCount: number;
  totalQuantity: number;
  pickingCompletedAt: string;
}

export interface Shipment {
  /** 생성 후 바뀌지 않는 영구 ID */
  id: string;
  /** 사용자가 바꿀 수 있는 표시 이름 */
  name: string;
  status: ShipmentStatus;
  purchaseOrders: ShipmentPurchaseOrder[];
  /** 이 Shipment 발주 묶음으로 만든 최신 송장/Shipment 출력 generation. */
  outputGeneration?: ShipmentOutputGeneration;
  createdAt: string;
  updatedAt: string;
}

export interface ShipmentSplitPreview {
  sequence: number;
  suggestedName: string;
  fulfillmentCenter: string;
  expectedDate: string;
  purchaseOrders: ShipmentPurchaseOrder[];
  purchaseOrderCount: number;
  skuCount: number;
  totalQuantity: number;
  firstPurchaseOrderNumber: string;
  lastPurchaseOrderNumber: string;
}
