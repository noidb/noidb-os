"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { WarehouseBox, WarehouseZone, WarehouseMigrationMapping } from "@/lib/wms/types";
import { useWarehouseRepository } from "@/lib/warehouse/context";
import { SAMPLE_CATALOG } from "@/lib/warehouse/sample-data";
import { MIGRATION_STATUS_LABEL } from "@/lib/warehouse/labels";
import { WarehouseScreen, BackLink, Card, FormField, selectStyle, wmsColors, wmsPrimaryButton, wmsSecondaryButton, wmsGhostButton } from "@/lib/warehouse/ui";

export default function WmsWarehouseMigrationPage() {
  const repository = useWarehouseRepository();
  const [mappings, setMappings] = useState<WarehouseMigrationMapping[]>([]);
  const [boxes, setBoxes] = useState<WarehouseBox[]>([]);
  const [zones, setZones] = useState<WarehouseZone[]>([]);
  const [chosenBox, setChosenBox] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    const [mappingList, boxList, zoneList] = await Promise.all([repository.listMigrationMappings(), repository.listBoxes(), repository.listZones()]);
    setMappings(mappingList);
    setBoxes(boxList);
    setZones(zoneList);
  }, [repository]);

  useEffect(() => {
    load();
  }, [load]);

  const categoryByLegacyLocation = useMemo(() => {
    const map = new Map<string, string>();
    for (const item of SAMPLE_CATALOG) {
      if (!map.has(item.legacyLocation)) map.set(item.legacyLocation, item.category);
    }
    return map;
  }, []);

  function suggestedBoxFor(mapping: WarehouseMigrationMapping): WarehouseBox | null {
    const category = categoryByLegacyLocation.get(mapping.legacyLocation);
    const zone = zones.find(z => z.category === category);
    if (!zone) return null;
    return boxes.find(box => box.zoneId === zone.id) || null;
  }

  async function setStatus(mapping: WarehouseMigrationMapping, status: WarehouseMigrationMapping["status"]) {
    await repository.saveMigrationMapping({ ...mapping, status });
    load();
  }

  async function confirmMapping(mapping: WarehouseMigrationMapping) {
    const boxId = chosenBox[mapping.id];
    if (!boxId) {
      alert("확정할 새 BOX ID를 선택해주세요.");
      return;
    }
    await repository.saveMigrationMapping({ ...mapping, confirmedBoxId: boxId, status: "confirmed" });
    load();
  }

  return (
    <WarehouseScreen>
      <BackLink href="/wms/warehouse" />
      <h1 style={{ fontSize: "18px", margin: "0 0 4px" }}>기존 창고번호 이전</h1>
      <p style={{ fontSize: "12px", color: wmsColors.muted, margin: "0 0 12px" }}>
        기존 "창고번호"(legacyLocation)는 노이드비 내부 위치 정보입니다. 자동으로 확정하지 않고,
        실물을 확인한 뒤에만 새 BOX ID와 매핑을 확정해주세요. 원본 값은 절대 수정되지 않습니다.
      </p>

      {mappings.map(mapping => {
        const suggested = suggestedBoxFor(mapping);
        return (
          <Card key={mapping.id}>
            <div style={{ fontWeight: 700, fontSize: "15px" }}>{mapping.legacyLocation}</div>
            <div style={{ fontSize: "12px", color: wmsColors.muted, margin: "4px 0" }}>
              연결된 모델 {mapping.connectedModelCount}개 · 연결된 SKU {mapping.connectedSkuCount}개
            </div>
            <div style={{ fontSize: "12px", color: wmsColors.muted, marginBottom: "8px" }}>
              추천 새 BOX ID: {suggested ? suggested.id : "추천 없음 (해당 구역에 BOX를 먼저 등록해주세요)"}
            </div>
            <div
              style={{
                display: "inline-block",
                fontSize: "12px",
                fontWeight: 700,
                padding: "2px 8px",
                borderRadius: "999px",
                background: mapping.status === "confirmed" ? wmsColors.greenSoft : wmsColors.surfaceBeige,
                color: mapping.status === "confirmed" ? wmsColors.greenDark : wmsColors.muted,
                marginBottom: "10px",
              }}
            >
              {MIGRATION_STATUS_LABEL[mapping.status]}
              {mapping.confirmedBoxId ? ` · ${mapping.confirmedBoxId}` : ""}
            </div>

            {mapping.status !== "confirmed" && mapping.status !== "skipped" && (
              <>
                {mapping.status === "unverified" && (
                  <button onClick={() => setStatus(mapping, "checking")} style={{ ...wmsSecondaryButton, width: "100%", marginBottom: "8px" }}>
                    실물 확인 시작
                  </button>
                )}
                {mapping.status === "checking" && (
                  <>
                    <FormField label="확정 새 BOX ID">
                      <select
                        value={chosenBox[mapping.id] || suggested?.id || ""}
                        onChange={e => setChosenBox({ ...chosenBox, [mapping.id]: e.target.value })}
                        style={selectStyle}
                      >
                        <option value="">선택</option>
                        {boxes.map(box => (
                          <option key={box.id} value={box.id}>
                            {box.id}
                          </option>
                        ))}
                      </select>
                    </FormField>
                    <button onClick={() => confirmMapping(mapping)} style={{ ...wmsPrimaryButton, width: "100%", marginBottom: "8px" }}>
                      실물 확인 완료 · 확정
                    </button>
                  </>
                )}
                <button onClick={() => setStatus(mapping, "skipped")} style={{ ...wmsGhostButton, width: "100%" }}>
                  건너뛰기
                </button>
              </>
            )}
          </Card>
        );
      })}
    </WarehouseScreen>
  );
}
