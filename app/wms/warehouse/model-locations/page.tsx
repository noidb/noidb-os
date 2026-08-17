"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { WarehouseBox, ModelLocation } from "@/lib/wms/types";
import { useWarehouseRepository } from "@/lib/warehouse/context";
import { SAMPLE_CATALOG } from "@/lib/warehouse/sample-data";
import { WarehouseScreen, BackLink, Card, FormField, inputStyle, selectStyle, textareaStyle, wmsColors, wmsPrimaryButton, wmsSecondaryButton } from "@/lib/warehouse/ui";

export default function WmsWarehouseModelLocationsPage() {
  const repository = useWarehouseRepository();
  const [prefillBoxId, setPrefillBoxId] = useState("");

  const [boxes, setBoxes] = useState<WarehouseBox[]>([]);
  const [locations, setLocations] = useState<ModelLocation[]>([]);
  const [query, setQuery] = useState("");
  const [selectedModel, setSelectedModel] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    setPrefillBoxId(params.get("box") || "");
    const modelParam = params.get("model");
    if (modelParam) setQuery(modelParam);
  }, []);

  const [primaryBoxId, setPrimaryBoxId] = useState(prefillBoxId);
  const [secondaryBoxId, setSecondaryBoxId] = useState("");
  const [allOptionsSameBox, setAllOptionsSameBox] = useState(true);
  const [isSetProduct, setIsSetProduct] = useState(false);
  const [memo, setMemo] = useState("");

  const load = useCallback(async () => {
    const [boxList, locationList] = await Promise.all([repository.listBoxes(), repository.listModelLocations()]);
    setBoxes(boxList);
    setLocations(locationList);
  }, [repository]);

  useEffect(() => {
    load();
  }, [load]);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    const models = new Map<string, { modelName: string; productName: string; category: string; legacyLocation: string; skuCount: number }>();
    for (const item of SAMPLE_CATALOG) {
      if (q && !item.modelName.toLowerCase().includes(q) && !item.skuId.toLowerCase().includes(q) && !item.productName.toLowerCase().includes(q)) continue;
      const entry = models.get(item.modelName) || { modelName: item.modelName, productName: item.productName, category: item.category, legacyLocation: item.legacyLocation, skuCount: 0 };
      entry.skuCount += 1;
      models.set(item.modelName, entry);
    }
    return [...models.values()];
  }, [query]);

  function selectModel(modelName: string) {
    setSelectedModel(modelName);
    const existing = locations.find(location => location.modelName === modelName);
    setPrimaryBoxId(existing?.primaryBoxId || prefillBoxId);
    setSecondaryBoxId(existing?.secondaryBoxId || "");
    setAllOptionsSameBox(existing ? existing.allOptionsSameBox : true);
    setIsSetProduct(existing?.isSetProduct || false);
    setMemo(existing?.memo || "");
  }

  async function save() {
    if (!selectedModel) return;
    if (!primaryBoxId) {
      alert("기본 BOX를 선택해주세요.");
      return;
    }
    const existing = locations.find(location => location.modelName === selectedModel);
    await repository.saveModelLocation({
      modelName: selectedModel,
      primaryBoxId,
      secondaryBoxId: secondaryBoxId || undefined,
      allOptionsSameBox,
      isSetProduct,
      memo: memo.trim() || undefined,
      updatedBy: existing?.updatedBy,
      createdAt: existing?.createdAt || "",
      updatedAt: "",
    });
    await load();
    setSelectedModel(null);
  }

  const catalogEntry = SAMPLE_CATALOG.find(item => item.modelName === selectedModel);
  const savedLocation = locations.find(location => location.modelName === selectedModel);

  return (
    <WarehouseScreen>
      <BackLink href="/wms/warehouse" />
      <h1 style={{ fontSize: "18px", margin: "0 0 12px" }}>모델 위치 등록</h1>

      <FormField label="검색" hint="모델명 · SKU · 상품명으로 검색">
        <input value={query} onChange={e => setQuery(e.target.value)} placeholder="예: GN-9001, 4001001, 나비" style={inputStyle} />
      </FormField>

      {matches.map(match => {
        const located = locations.some(location => location.modelName === match.modelName);
        return (
          <Card key={match.modelName} style={{ cursor: "pointer" }}>
            <div onClick={() => selectModel(match.modelName)}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <strong>{match.modelName}</strong>
                <span style={{ fontSize: "12px", color: located ? wmsColors.green : wmsColors.warn }}>{located ? "위치 등록됨" : "미배치"}</span>
              </div>
              <div style={{ fontSize: "12px", color: wmsColors.muted }}>
                {match.productName} · 옵션 {match.skuCount}개
              </div>
              <div style={{ fontSize: "11px", color: wmsColors.muted }}>기존 창고번호: {match.legacyLocation}</div>
            </div>
          </Card>
        );
      })}

      {selectedModel && (
        <Card>
          <h3 style={{ fontSize: "14px", margin: "0 0 4px" }}>{selectedModel} 위치 지정</h3>
          <p style={{ fontSize: "12px", color: wmsColors.muted, margin: "0 0 12px" }}>기존 창고번호: {catalogEntry?.legacyLocation || "-"}</p>

          <FormField label="기본 BOX">
            <select value={primaryBoxId} onChange={e => setPrimaryBoxId(e.target.value)} style={selectStyle}>
              <option value="">선택</option>
              {boxes.map(box => (
                <option key={box.id} value={box.id}>
                  {box.id}
                </option>
              ))}
            </select>
          </FormField>

          <FormField label="보조 BOX (선택)" hint="한 모델이 여러 BOX에 나뉘어 있을 때만">
            <select value={secondaryBoxId} onChange={e => setSecondaryBoxId(e.target.value)} style={selectStyle}>
              <option value="">없음</option>
              {boxes.map(box => (
                <option key={box.id} value={box.id}>
                  {box.id}
                </option>
              ))}
            </select>
          </FormField>

          <FormField label="전체 옵션이 같은 BOX인가요?">
            <label style={{ display: "flex", alignItems: "center", gap: "8px", minHeight: "48px" }}>
              <input type="checkbox" checked={allOptionsSameBox} onChange={e => setAllOptionsSameBox(e.target.checked)} style={{ width: "22px", height: "22px" }} />
              예 — 옵션 전체가 기본 BOX 하나에 있습니다
            </label>
          </FormField>

          <FormField label="세트상품 여부" hint="상품명으로 추측하지 않고 여기서 명시적으로 지정합니다">
            <label style={{ display: "flex", alignItems: "center", gap: "8px", minHeight: "48px" }}>
              <input type="checkbox" checked={isSetProduct} onChange={e => setIsSetProduct(e.target.checked)} style={{ width: "22px", height: "22px" }} />
              세트상품입니다
            </label>
          </FormField>

          <FormField label="위치 메모 (선택)">
            <textarea value={memo} onChange={e => setMemo(e.target.value)} style={textareaStyle} />
          </FormField>

          <button onClick={save} style={{ ...wmsPrimaryButton, width: "100%", marginBottom: "8px" }}>
            저장
          </button>

          {!allOptionsSameBox && (
            <a
              href={`/wms/warehouse/sku-exceptions?model=${encodeURIComponent(selectedModel)}`}
              style={{ ...wmsSecondaryButton, width: "100%", display: "block", textAlign: "center", textDecoration: "none", lineHeight: "48px" }}
            >
              SKU 예외 등록
            </a>
          )}

          {savedLocation && (
            <p style={{ fontSize: "11px", color: wmsColors.muted, marginTop: "8px" }}>
              마지막 수정: {savedLocation.updatedAt ? new Date(savedLocation.updatedAt).toLocaleString() : "-"}
            </p>
          )}
        </Card>
      )}
    </WarehouseScreen>
  );
}
