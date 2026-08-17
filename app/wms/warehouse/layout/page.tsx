"use client";

import { useEffect, useState, useCallback } from "react";
import type { WarehouseZone, Shelf, WarehouseUsageStatus } from "@/lib/wms/types";
import { useWarehouseRepository } from "@/lib/warehouse/context";
import { WarehouseScreen, BackLink, Card, FormField, inputStyle, selectStyle, wmsColors, wmsPrimaryButton, wmsSecondaryButton } from "@/lib/warehouse/ui";

export default function WarehouseLayoutPage() {
  const repository = useWarehouseRepository();
  const [zones, setZones] = useState<WarehouseZone[]>([]);
  const [shelves, setShelves] = useState<Shelf[]>([]);

  const [zoneForm, setZoneForm] = useState({ id: "", name: "", category: "", sortOrder: "10", status: "active" as WarehouseUsageStatus });
  const [shelfForm, setShelfForm] = useState({ zoneId: "", code: "", name: "", sortOrder: "10", status: "active" as WarehouseUsageStatus });

  const load = useCallback(async () => {
    const [zoneList, shelfList] = await Promise.all([repository.listZones(), repository.listShelves()]);
    setZones(zoneList);
    setShelves(shelfList);
    if (!shelfForm.zoneId && zoneList[0]) setShelfForm(prev => ({ ...prev, zoneId: zoneList[0].id }));
  }, [repository, shelfForm.zoneId]);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repository]);

  async function saveZone() {
    const id = zoneForm.id.trim().toUpperCase();
    if (!id || !zoneForm.name.trim() || !zoneForm.category.trim()) {
      alert("Zone ID, 이름, 카테고리를 모두 입력해주세요.");
      return;
    }
    const existing = zones.find(zone => zone.id === id);
    await repository.saveZone({
      id,
      name: zoneForm.name.trim(),
      category: zoneForm.category.trim(),
      sortOrder: Number(zoneForm.sortOrder) || 0,
      status: zoneForm.status,
      createdAt: existing?.createdAt || "",
      updatedAt: "",
    });
    setZoneForm({ id: "", name: "", category: "", sortOrder: "10", status: "active" });
    load();
  }

  function editZone(zone: WarehouseZone) {
    setZoneForm({ id: zone.id, name: zone.name, category: zone.category, sortOrder: String(zone.sortOrder), status: zone.status });
  }

  async function saveShelf() {
    const code = shelfForm.code.trim().toUpperCase();
    if (!shelfForm.zoneId || !code || !shelfForm.name.trim()) {
      alert("구역, 선반코드, 선반명을 모두 입력해주세요.");
      return;
    }
    const id = `${shelfForm.zoneId}-${code}`;
    const existing = shelves.find(shelf => shelf.id === id);
    await repository.saveShelf({
      id,
      zoneId: shelfForm.zoneId,
      name: shelfForm.name.trim(),
      sortOrder: Number(shelfForm.sortOrder) || 0,
      status: shelfForm.status,
      createdAt: existing?.createdAt || "",
      updatedAt: "",
    });
    setShelfForm(prev => ({ ...prev, code: "", name: "", sortOrder: "10" }));
    load();
  }

  function editShelf(shelf: Shelf) {
    const code = shelf.id.slice(shelf.zoneId.length + 1);
    setShelfForm({ zoneId: shelf.zoneId, code, name: shelf.name, sortOrder: String(shelf.sortOrder), status: shelf.status });
  }

  return (
    <WarehouseScreen>
      <BackLink href="/wms/warehouse" />
      <h1 style={{ fontSize: "18px", margin: "0 0 12px" }}>구역·선반 관리</h1>

      <h2 style={{ fontSize: "14px", margin: "0 0 8px" }}>구역(Zone) 목록</h2>
      {zones.map(zone => (
        <Card key={zone.id}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <strong style={{ fontSize: "16px" }}>{zone.id}</strong>
              <span style={{ marginLeft: "8px" }}>{zone.name}</span>
              <div style={{ fontSize: "12px", color: wmsColors.muted }}>
                카테고리 {zone.category} · 정렬 {zone.sortOrder} · {zone.status === "active" ? "사용중" : "미사용"}
              </div>
            </div>
            <button onClick={() => editZone(zone)} style={{ ...wmsSecondaryButton, minHeight: "40px" }}>
              수정
            </button>
          </div>
        </Card>
      ))}

      <Card>
        <h3 style={{ fontSize: "13px", margin: "0 0 10px" }}>{zones.some(z => z.id === zoneForm.id.trim().toUpperCase()) ? "구역 수정" : "구역 추가"}</h3>
        <FormField label="Zone ID (카테고리 코드)" hint="예: E, P, N, R, B, S">
          <input value={zoneForm.id} onChange={e => setZoneForm({ ...zoneForm, id: e.target.value.toUpperCase() })} style={inputStyle} maxLength={2} />
        </FormField>
        <FormField label="이름">
          <input value={zoneForm.name} onChange={e => setZoneForm({ ...zoneForm, name: e.target.value })} style={inputStyle} />
        </FormField>
        <FormField label="카테고리">
          <input value={zoneForm.category} onChange={e => setZoneForm({ ...zoneForm, category: e.target.value })} style={inputStyle} />
        </FormField>
        <FormField label="정렬순서">
          <input type="number" value={zoneForm.sortOrder} onChange={e => setZoneForm({ ...zoneForm, sortOrder: e.target.value })} style={inputStyle} />
        </FormField>
        <FormField label="사용상태">
          <select value={zoneForm.status} onChange={e => setZoneForm({ ...zoneForm, status: e.target.value as WarehouseUsageStatus })} style={selectStyle}>
            <option value="active">사용중</option>
            <option value="inactive">미사용</option>
          </select>
        </FormField>
        <button onClick={saveZone} style={{ ...wmsPrimaryButton, width: "100%" }}>
          저장
        </button>
      </Card>

      <h2 style={{ fontSize: "14px", margin: "20px 0 8px" }}>선반(Shelf) 목록</h2>
      {shelves.length === 0 && <p style={{ fontSize: "13px", color: wmsColors.muted }}>등록된 선반이 없습니다.</p>}
      {shelves.map(shelf => (
        <Card key={shelf.id}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <strong style={{ fontSize: "16px" }}>{shelf.id}</strong>
              <span style={{ marginLeft: "8px" }}>{shelf.name}</span>
              <div style={{ fontSize: "12px", color: wmsColors.muted }}>
                정렬 {shelf.sortOrder} · {shelf.status === "active" ? "사용중" : "미사용"}
              </div>
            </div>
            <button onClick={() => editShelf(shelf)} style={{ ...wmsSecondaryButton, minHeight: "40px" }}>
              수정
            </button>
          </div>
        </Card>
      ))}

      <Card>
        <h3 style={{ fontSize: "13px", margin: "0 0 10px" }}>선반 추가/수정</h3>
        <FormField label="구역">
          <select value={shelfForm.zoneId} onChange={e => setShelfForm({ ...shelfForm, zoneId: e.target.value })} style={selectStyle}>
            {zones.map(zone => (
              <option key={zone.id} value={zone.id}>
                {zone.id} · {zone.name}
              </option>
            ))}
          </select>
        </FormField>
        <FormField label="선반코드" hint="예: A → 최종 Shelf ID는 E-A 형태가 됩니다">
          <input value={shelfForm.code} onChange={e => setShelfForm({ ...shelfForm, code: e.target.value.toUpperCase() })} style={inputStyle} maxLength={2} />
        </FormField>
        <FormField label="선반명">
          <input value={shelfForm.name} onChange={e => setShelfForm({ ...shelfForm, name: e.target.value })} style={inputStyle} />
        </FormField>
        <FormField label="정렬순서">
          <input type="number" value={shelfForm.sortOrder} onChange={e => setShelfForm({ ...shelfForm, sortOrder: e.target.value })} style={inputStyle} />
        </FormField>
        <FormField label="사용상태">
          <select value={shelfForm.status} onChange={e => setShelfForm({ ...shelfForm, status: e.target.value as WarehouseUsageStatus })} style={selectStyle}>
            <option value="active">사용중</option>
            <option value="inactive">미사용</option>
          </select>
        </FormField>
        <button onClick={saveShelf} style={{ ...wmsPrimaryButton, width: "100%" }}>
          저장
        </button>
      </Card>
    </WarehouseScreen>
  );
}
