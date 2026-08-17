"use client";

import { useCallback, useEffect, useState } from "react";
import type { WarehouseBox, SkuLocation } from "@/lib/wms/types";
import { useWarehouseRepository } from "@/lib/warehouse/context";
import { SAMPLE_CATALOG } from "@/lib/warehouse/sample-data";
import { WarehouseScreen, BackLink, Card, FormField, inputStyle, selectStyle, textareaStyle, wmsColors, wmsPrimaryButton, wmsGhostButton } from "@/lib/warehouse/ui";

export default function WmsWarehouseSkuExceptionsPage() {
  const repository = useWarehouseRepository();
  const [modelFilter, setModelFilter] = useState("");

  useEffect(() => {
    if (typeof window === "undefined") return;
    setModelFilter(new URLSearchParams(window.location.search).get("model") || "");
  }, []);

  const [boxes, setBoxes] = useState<WarehouseBox[]>([]);
  const [exceptions, setExceptions] = useState<SkuLocation[]>([]);

  const [skuId, setSkuId] = useState("");
  const [boxId, setBoxId] = useState("");
  const [reason, setReason] = useState("");
  const [memo, setMemo] = useState("");

  const load = useCallback(async () => {
    const [boxList, exceptionList] = await Promise.all([repository.listBoxes(), repository.listSkuExceptions()]);
    setBoxes(boxList);
    setExceptions(exceptionList);
  }, [repository]);

  useEffect(() => {
    load();
  }, [load]);

  const catalogChoices = modelFilter ? SAMPLE_CATALOG.filter(item => item.modelName === modelFilter) : SAMPLE_CATALOG;
  const selectedCatalogItem = SAMPLE_CATALOG.find(item => item.skuId === skuId);

  async function save() {
    if (!skuId || !boxId) {
      alert("SKU와 예외 BOX를 선택해주세요.");
      return;
    }
    const catalogItem = SAMPLE_CATALOG.find(item => item.skuId === skuId);
    const existing = exceptions.find(exception => exception.skuId === skuId);
    await repository.saveSkuException({
      skuId,
      modelName: catalogItem?.modelName || existing?.modelName || "",
      boxId,
      optionLabel: catalogItem?.optionLabel || existing?.optionLabel,
      isException: true,
      reason: reason.trim() || undefined,
      memo: memo.trim() || undefined,
      updatedBy: existing?.updatedBy,
      createdAt: existing?.createdAt || "",
      updatedAt: "",
    });
    setSkuId("");
    setBoxId("");
    setReason("");
    setMemo("");
    await load();
  }

  async function remove(id: string) {
    if (!window.confirm(`SKU "${id}"의 예외 위치를 삭제할까요?`)) return;
    await repository.deleteSkuException(id);
    load();
  }

  return (
    <WarehouseScreen>
      <BackLink href="/wms/warehouse" />
      <h1 style={{ fontSize: "18px", margin: "0 0 4px" }}>SKU 예외 위치</h1>
      <p style={{ fontSize: "12px", color: wmsColors.muted, margin: "0 0 12px" }}>
        모델 기본 위치와 다른 BOX에 있는 SKU만 여기에 등록합니다. 대부분의 SKU는 등록할 필요가 없습니다.
      </p>

      <Card>
        <FormField label="SKU">
          <select value={skuId} onChange={e => setSkuId(e.target.value)} style={selectStyle}>
            <option value="">선택</option>
            {catalogChoices.map(item => (
              <option key={item.skuId} value={item.skuId}>
                {item.skuId} · {item.modelName} · {item.optionLabel}
              </option>
            ))}
          </select>
        </FormField>

        {selectedCatalogItem && (
          <p style={{ fontSize: "12px", color: wmsColors.muted, margin: "-8px 0 12px" }}>
            모델명: {selectedCatalogItem.modelName} · 옵션명: {selectedCatalogItem.optionLabel}
          </p>
        )}

        <FormField label="예외 BOX ID">
          <select value={boxId} onChange={e => setBoxId(e.target.value)} style={selectStyle}>
            <option value="">선택</option>
            {boxes.map(box => (
              <option key={box.id} value={box.id}>
                {box.id}
              </option>
            ))}
          </select>
        </FormField>

        <FormField label="예외 사유 (선택)">
          <input value={reason} onChange={e => setReason(e.target.value)} style={inputStyle} placeholder="예: 재고 과다로 별도 박스 사용" />
        </FormField>

        <FormField label="메모 (선택)">
          <textarea value={memo} onChange={e => setMemo(e.target.value)} style={textareaStyle} />
        </FormField>

        <button onClick={save} style={{ ...wmsPrimaryButton, width: "100%" }}>
          저장
        </button>
      </Card>

      <h2 style={{ fontSize: "14px", margin: "16px 0 8px" }}>등록된 예외 ({exceptions.length}건)</h2>
      {exceptions.map(exception => (
        <Card key={exception.skuId}>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <div>
              <strong>{exception.skuId}</strong>
              <span style={{ marginLeft: "6px", color: wmsColors.muted }}>({exception.optionLabel || "-"})</span>
              <div style={{ fontSize: "12px", color: wmsColors.muted }}>
                {exception.modelName} → BOX {exception.boxId}
              </div>
            </div>
            <button onClick={() => remove(exception.skuId)} style={{ ...wmsGhostButton, minHeight: "36px" }}>
              삭제
            </button>
          </div>
        </Card>
      ))}
    </WarehouseScreen>
  );
}
