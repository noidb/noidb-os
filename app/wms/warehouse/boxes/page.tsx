"use client";

import { useEffect, useState } from "react";
import type { WarehouseBox, ModelLocation } from "@/lib/wms/types";
import { useWarehouseRepository } from "@/lib/warehouse/context";
import { BOX_KIND_LABEL, BOX_STATUS_LABEL } from "@/lib/warehouse/labels";
import { WarehouseScreen, BackLink, Card, wmsColors } from "@/lib/warehouse/ui";

export default function WmsWarehouseBoxListPage() {
  const repository = useWarehouseRepository();
  const [boxes, setBoxes] = useState<WarehouseBox[]>([]);
  const [modelLocations, setModelLocations] = useState<ModelLocation[]>([]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([repository.listBoxes(), repository.listModelLocations()]).then(([boxList, locationList]) => {
      if (cancelled) return;
      setBoxes(boxList);
      setModelLocations(locationList);
    });
    return () => {
      cancelled = true;
    };
  }, [repository]);

  function currentModelCount(boxId: string): number {
    return modelLocations.filter(location => location.primaryBoxId === boxId || location.secondaryBoxId === boxId).length;
  }

  return (
    <WarehouseScreen>
      <BackLink href="/wms/warehouse" />
      <h1 style={{ fontSize: "18px", margin: "0 0 12px" }}>BOX 목록 ({boxes.length}개)</h1>

      {boxes.length === 0 && <p style={{ color: wmsColors.muted, fontSize: "14px" }}>등록된 BOX가 없습니다. "BOX 등록"에서 먼저 만들어주세요.</p>}

      {boxes.map(box => (
        <a key={box.id} href={`/wms/warehouse/boxes/${encodeURIComponent(box.id)}`} style={{ textDecoration: "none", color: "inherit" }}>
          <Card style={{ cursor: "pointer" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
              <strong style={{ fontSize: "18px" }}>{box.id}</strong>
              <span style={{ fontSize: "12px", color: wmsColors.muted }}>{BOX_STATUS_LABEL[box.status]}</span>
            </div>
            <div style={{ fontSize: "12px", color: wmsColors.muted, marginTop: "4px" }}>
              {box.shelfId} · {box.category}
              {box.series ? ` · ${box.series}` : ""} · {BOX_KIND_LABEL[box.kind]}
            </div>
            <div style={{ fontSize: "13px", marginTop: "6px" }}>
              현재 모델 수: <strong>{currentModelCount(box.id)}</strong>
              {box.maxModelCount ? ` / ${box.maxModelCount}` : ""}
            </div>
          </Card>
        </a>
      ))}
    </WarehouseScreen>
  );
}
