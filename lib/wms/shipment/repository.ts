import type { ShipmentOutputGeneration } from "../picking-wave/types";
import type { Shipment, ShipmentSplitPreview, ShipmentStatus } from "./types";

export interface ShipmentRepository {
  listShipments(): Promise<Shipment[]>;
  getShipment(shipmentId: string): Promise<Shipment | null>;
  createFromPreviews(previews: readonly ShipmentSplitPreview[], now?: string): Promise<Shipment[]>;
  renameShipment(shipmentId: string, name: string): Promise<Shipment>;
  updateShipmentStatus(shipmentId: string, status: ShipmentStatus): Promise<Shipment>;
  updateShipmentGeneration(shipmentId: string, generation: ShipmentOutputGeneration): Promise<Shipment>;
  deleteShipment(shipmentId: string): Promise<void>;
}
