"use client";

import { useEffect, useState } from "react";
import { useWarehouseRepository } from "@/lib/warehouse/context";
import { validateWarehouse } from "@/lib/warehouse/validation";
import { listCatalogModelNames } from "@/lib/warehouse/sample-data";
import { WarehouseScreen, StatTile, BigNavButton, wmsColors } from "@/lib/warehouse/ui";

interface Summary {
  zoneCount: number;
  shelfCount: number;
  boxCount: number;
  locatedModelCount: number;
  unassignedModelCount: number;
  skuExceptionCount: number;
}

export default function WmsWarehouseHomePage() {
  const repository = useWarehouseRepository();
  const [summary, setSummary] = useState<Summary | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const [zones, shelves, boxes, modelLocations, skuExceptions] = await Promise.all([
        repository.listZones(),
        repository.listShelves(),
        repository.listBoxes(),
        repository.listModelLocations(),
        repository.listSkuExceptions(),
      ]);
      const catalogModelNames = listCatalogModelNames();
      const issues = validateWarehouse({ boxes, modelLocations, skuExceptions, catalogModelNames });
      const unassignedModelCount = issues.filter(issue => issue.type === "unassigned_model").length;
      if (cancelled) return;
      setSummary({
        zoneCount: zones.length,
        shelfCount: shelves.length,
        boxCount: boxes.length,
        locatedModelCount: modelLocations.length,
        unassignedModelCount,
        skuExceptionCount: skuExceptions.length,
      });
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [repository]);

  return (
    <WarehouseScreen>
      <h1 style={{ fontSize: "20px", margin: "0 0 4px" }}>창고관리</h1>
      <p style={{ fontSize: "13px", color: wmsColors.muted, margin: "0 0 16px" }}>
        실제 창고 정리용 위치 등록 화면 (로컬 임시 저장, 구글시트 쓰기 없음)
      </p>

      {!summary ? (
        <p>불러오는 중...</p>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "8px", marginBottom: "20px" }}>
          <StatTile label="구역 수" value={summary.zoneCount} />
          <StatTile label="선반 수" value={summary.shelfCount} />
          <StatTile label="BOX 수" value={summary.boxCount} />
          <StatTile label="위치 등록 모델 수" value={summary.locatedModelCount} />
          <StatTile label="미배치 모델 수" value={summary.unassignedModelCount} />
          <StatTile label="SKU 예외 위치 수" value={summary.skuExceptionCount} />
        </div>
      )}

      <BigNavButton href="/wms/warehouse/layout" label="구역·선반 관리" sub="Zone/Shelf 등록 및 정렬순서" />
      <BigNavButton href="/wms/warehouse/boxes/new" label="BOX 등록" sub="새 BOX ID 자동 추천" />
      <BigNavButton href="/wms/warehouse/boxes" label="BOX 목록" sub="등록된 BOX 조회/상세" />
      <BigNavButton href="/wms/warehouse/model-locations" label="모델 위치 등록" sub="모델별 기본/보조 BOX 지정" />
      <BigNavButton href="/wms/warehouse/sku-exceptions" label="SKU 예외 위치" sub="옵션별 예외 위치만 별도 등록" />
      <BigNavButton href="/wms/warehouse/migration" label="기존 창고번호 이전" sub="legacyLocation → 새 BOX ID 매핑" />
      <BigNavButton href="/wms/warehouse/validation" label="위치 검증" sub="미배치·중복·고아 BOX 등 점검" />
      <BigNavButton href="/wms/warehouse/boxes" label="QR 미리보기" sub="BOX를 선택하면 QR 값을 볼 수 있습니다" />
    </WarehouseScreen>
  );
}
