"use client";

import { useCallback, useEffect, useState } from "react";
import type { WarehouseZone, Shelf, WarehouseBox, WarehouseBoxKind } from "@/lib/wms/types";
import { useWarehouseRepository } from "@/lib/warehouse/context";
import { suggestNextBoxId, isValidBoxIdFormat, isBoxIdTaken } from "@/lib/warehouse/box-id";
import { BOX_KIND_LABEL } from "@/lib/warehouse/labels";
import { WarehouseScreen, BackLink, Card, FormField, inputStyle, selectStyle, textareaStyle, wmsColors, wmsPrimaryButton, wmsSecondaryButton } from "@/lib/warehouse/ui";

export default function WmsWarehouseBoxNewPage() {
  const repository = useWarehouseRepository();
  const [zones, setZones] = useState<WarehouseZone[]>([]);
  const [shelves, setShelves] = useState<Shelf[]>([]);
  const [boxes, setBoxes] = useState<WarehouseBox[]>([]);

  const [zoneId, setZoneId] = useState("");
  const [shelfId, setShelfId] = useState("");
  const [boxId, setBoxId] = useState("");
  const [boxIdTouched, setBoxIdTouched] = useState(false);
  const [kind, setKind] = useState<WarehouseBoxKind>("small_tool_box");
  const [category, setCategory] = useState("");
  const [series, setSeries] = useState("");
  const [isSetBox, setIsSetBox] = useState(false);
  const [maxModelCount, setMaxModelCount] = useState("");
  const [memo, setMemo] = useState("");
  const [error, setError] = useState("");
  const [savedBox, setSavedBox] = useState<WarehouseBox | null>(null);

  const load = useCallback(async () => {
    const [zoneList, shelfList, boxList] = await Promise.all([repository.listZones(), repository.listShelves(), repository.listBoxes()]);
    setZones(zoneList);
    setShelves(shelfList);
    setBoxes(boxList);
    if (!zoneId && zoneList[0]) setZoneId(zoneList[0].id);
  }, [repository, zoneId]);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repository]);

  const shelvesInZone = shelves.filter(shelf => shelf.zoneId === zoneId);

  useEffect(() => {
    if (!shelfId && shelvesInZone[0]) setShelfId(shelvesInZone[0].id);
    const zone = zones.find(z => z.id === zoneId);
    if (zone) setCategory(zone.category);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoneId, shelves]);

  useEffect(() => {
    if (boxIdTouched) return;
    if (!zoneId || !shelfId) return;
    setBoxId(suggestNextBoxId(boxes, zoneId, shelfId));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoneId, shelfId, boxes, boxIdTouched]);

  function resetFormForNextBox() {
    setBoxIdTouched(false);
    setSeries("");
    setIsSetBox(false);
    setMaxModelCount("");
    setMemo("");
    setSavedBox(null);
    setError("");
  }

  async function handleSave() {
    setError("");
    const trimmedId = boxId.trim().toUpperCase();
    if (!zoneId || !shelfId) {
      setError("구역과 선반을 선택해주세요.");
      return;
    }
    if (!isValidBoxIdFormat(trimmedId)) {
      setError("BOX ID 형식이 올바르지 않습니다. 예: E-A-001");
      return;
    }
    if (isBoxIdTaken(boxes, trimmedId)) {
      setError(`이미 사용 중인 BOX ID입니다: ${trimmedId}`);
      return;
    }
    const box: WarehouseBox = {
      id: trimmedId,
      shelfId,
      label: trimmedId,
      kind,
      zoneId,
      category: category.trim(),
      series: series.trim() || undefined,
      isSetBox,
      currentModelCount: 0,
      maxModelCount: maxModelCount ? Number(maxModelCount) : undefined,
      qrValue: trimmedId,
      status: "empty",
      memo: memo.trim() || undefined,
      sortOrder: boxes.length + 1,
      createdAt: "",
      updatedAt: "",
    };
    await repository.saveBox(box);
    setSavedBox(box);
    await load();
  }

  if (savedBox) {
    return (
      <WarehouseScreen>
        <BackLink href="/wms/warehouse" />
        <Card style={{ textAlign: "center" }}>
          <div style={{ fontSize: "36px" }}>📦</div>
          <div style={{ fontSize: "28px", fontWeight: 900, margin: "8px 0" }}>{savedBox.id}</div>
          <p style={{ color: wmsColors.muted, margin: 0 }}>
            {BOX_KIND_LABEL[savedBox.kind]} · {savedBox.category}
            {savedBox.series ? ` · ${savedBox.series}` : ""}
          </p>
          <p style={{ fontSize: "13px", color: wmsColors.muted, marginTop: "8px" }}>QR 값(미리보기): {savedBox.qrValue}</p>
        </Card>
        <a href={`/wms/warehouse/boxes/${encodeURIComponent(savedBox.id)}`} style={{ ...wmsPrimaryButton, width: "100%", display: "block", textAlign: "center", textDecoration: "none", marginBottom: "10px", lineHeight: "48px" }}>
          모델 등록하러 가기
        </a>
        <button onClick={resetFormForNextBox} style={{ ...wmsSecondaryButton, width: "100%" }}>
          다음 BOX 연속 등록
        </button>
      </WarehouseScreen>
    );
  }

  return (
    <WarehouseScreen>
      <BackLink href="/wms/warehouse" />
      <h1 style={{ fontSize: "18px", margin: "0 0 12px" }}>BOX 등록</h1>

      <FormField label="구역">
        <select value={zoneId} onChange={e => { setZoneId(e.target.value); setShelfId(""); }} style={selectStyle}>
          {zones.map(zone => (
            <option key={zone.id} value={zone.id}>
              {zone.id} · {zone.name}
            </option>
          ))}
        </select>
      </FormField>

      <FormField label="선반">
        <select value={shelfId} onChange={e => setShelfId(e.target.value)} style={selectStyle}>
          {shelvesInZone.length === 0 && <option value="">등록된 선반 없음</option>}
          {shelvesInZone.map(shelf => (
            <option key={shelf.id} value={shelf.id}>
              {shelf.id} · {shelf.name}
            </option>
          ))}
        </select>
      </FormField>

      <FormField label="BOX 종류">
        <select value={kind} onChange={e => setKind(e.target.value as WarehouseBoxKind)} style={selectStyle}>
          <option value="small_tool_box">소형 공구박스</option>
          <option value="large_living_box">큰 리빙박스</option>
          <option value="other">기타</option>
        </select>
      </FormField>

      <FormField label="카테고리">
        <input value={category} onChange={e => setCategory(e.target.value)} style={inputStyle} />
      </FormField>

      <FormField label="시리즈 (선택)" hint="예: 나비, 하트, 코인">
        <input value={series} onChange={e => setSeries(e.target.value)} style={inputStyle} />
      </FormField>

      <FormField label="세트상품 전용 여부">
        <label style={{ display: "flex", alignItems: "center", gap: "8px", minHeight: "48px" }}>
          <input type="checkbox" checked={isSetBox} onChange={e => setIsSetBox(e.target.checked)} style={{ width: "22px", height: "22px" }} />
          세트상품 전용 BOX입니다
        </label>
      </FormField>

      <FormField label="최대 모델 수 (선택)">
        <input type="number" min={0} value={maxModelCount} onChange={e => setMaxModelCount(e.target.value)} style={inputStyle} />
      </FormField>

      <FormField label="메모 (선택)">
        <textarea value={memo} onChange={e => setMemo(e.target.value)} style={textareaStyle} />
      </FormField>

      <FormField label="BOX ID" hint="구역·선반 선택 시 자동 추천됩니다. 저장 전 직접 수정할 수 있습니다.">
        <input
          value={boxId}
          onChange={e => {
            setBoxId(e.target.value.toUpperCase());
            setBoxIdTouched(true);
          }}
          style={{ ...inputStyle, fontSize: "20px", fontWeight: 800, textAlign: "center" }}
        />
      </FormField>

      {error && <p style={{ color: wmsColors.warn, fontSize: "13px" }}>{error}</p>}

      <button onClick={handleSave} style={{ ...wmsPrimaryButton, width: "100%" }}>
        저장
      </button>
    </WarehouseScreen>
  );
}
