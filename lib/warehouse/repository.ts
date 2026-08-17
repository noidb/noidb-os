import type {
  WarehouseZone,
  Shelf,
  WarehouseBox,
  ModelLocation,
  SkuLocation,
  WarehouseMigrationMapping,
} from "@/lib/wms/types";

/**
 * 창고 위치 데이터 저장소 인터페이스.
 * 화면(UI)은 이 인터페이스에만 의존하고, 실제 저장 방식(localStorage/구글시트 등)에는
 * 의존하지 않는다 — 나중에 구현체만 GoogleSheetsWarehouseRepository로 교체하면 된다.
 * 이번 스프린트는 구글시트에 쓰지 않으므로 LocalWarehouseRepository만 사용한다.
 */
export interface WarehouseRepository {
  listZones(): Promise<WarehouseZone[]>;
  saveZone(zone: WarehouseZone): Promise<void>;

  listShelves(): Promise<Shelf[]>;
  saveShelf(shelf: Shelf): Promise<void>;

  listBoxes(): Promise<WarehouseBox[]>;
  getBox(boxId: string): Promise<WarehouseBox | null>;
  saveBox(box: WarehouseBox): Promise<void>;

  listModelLocations(): Promise<ModelLocation[]>;
  getModelLocation(modelName: string): Promise<ModelLocation | null>;
  saveModelLocation(location: ModelLocation): Promise<void>;

  listSkuExceptions(): Promise<SkuLocation[]>;
  saveSkuException(exception: SkuLocation): Promise<void>;
  deleteSkuException(skuId: string): Promise<void>;

  listMigrationMappings(): Promise<WarehouseMigrationMapping[]>;
  saveMigrationMapping(mapping: WarehouseMigrationMapping): Promise<void>;
}
