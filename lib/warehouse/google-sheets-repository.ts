import type {
  WarehouseZone,
  Shelf,
  WarehouseBox,
  ModelLocation,
  SkuLocation,
  WarehouseMigrationMapping,
} from "@/lib/wms/types";
import type { WarehouseRepository } from "./repository";

/**
 * 구글시트 기반 저장소 자리표시자(placeholder).
 * 이번 스프린트에서는 실제 구글시트 쓰기를 구현하지 않는다 — 화면은
 * LocalWarehouseRepository만 사용한다. 다음 스프린트에서 이 클래스의 메서드를
 * 채워 넣으면(BOX마스터/모델위치/SKU예외위치 3개 시트, Sprint 4 설계 참고)
 * 화면 코드는 전혀 바꾸지 않고 저장소만 교체할 수 있다.
 */
export class GoogleSheetsWarehouseRepository implements WarehouseRepository {
  private notImplemented(): never {
    throw new Error("GoogleSheetsWarehouseRepository는 아직 구현되지 않았습니다 (다음 스프린트 예정).");
  }

  async listZones(): Promise<WarehouseZone[]> {
    this.notImplemented();
  }
  async saveZone(_zone: WarehouseZone): Promise<void> {
    this.notImplemented();
  }
  async listShelves(): Promise<Shelf[]> {
    this.notImplemented();
  }
  async saveShelf(_shelf: Shelf): Promise<void> {
    this.notImplemented();
  }
  async listBoxes(): Promise<WarehouseBox[]> {
    this.notImplemented();
  }
  async getBox(_boxId: string): Promise<WarehouseBox | null> {
    this.notImplemented();
  }
  async saveBox(_box: WarehouseBox): Promise<void> {
    this.notImplemented();
  }
  async listModelLocations(): Promise<ModelLocation[]> {
    this.notImplemented();
  }
  async getModelLocation(_modelName: string): Promise<ModelLocation | null> {
    this.notImplemented();
  }
  async saveModelLocation(_location: ModelLocation): Promise<void> {
    this.notImplemented();
  }
  async listSkuExceptions(): Promise<SkuLocation[]> {
    this.notImplemented();
  }
  async saveSkuException(_exception: SkuLocation): Promise<void> {
    this.notImplemented();
  }
  async deleteSkuException(_skuId: string): Promise<void> {
    this.notImplemented();
  }
  async listMigrationMappings(): Promise<WarehouseMigrationMapping[]> {
    this.notImplemented();
  }
  async saveMigrationMapping(_mapping: WarehouseMigrationMapping): Promise<void> {
    this.notImplemented();
  }
}
