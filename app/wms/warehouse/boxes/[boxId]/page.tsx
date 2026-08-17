"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import type { WarehouseBox, WarehouseBoxKind, WarehouseBoxStatus, ModelLocation, SkuLocation } from "@/lib/wms/types";
import { useWarehouseRepository } from "@/lib/warehouse/context";
import { BOX_KIND_LABEL, BOX_STATUS_LABEL } from "@/lib/warehouse/labels";
import { WarehouseScreen, BackLink, Card, FormField, inputStyle, selectStyle, textareaStyle, wmsColors, wmsPrimaryButton, wmsSecondaryButton, wmsGhostButton } from "@/lib/warehouse/ui";

export default function WmsWarehouseBoxDetailPage() {
  const params = useParams<{ boxId: string }>();
  const boxId = decodeURIComponent(String(params.boxId || ""));
  const repository = useWarehouseRepository();

  const [box, setBox] = useState<WarehouseBox | null | undefined>(undefined);
  const [allBoxes, setAllBoxes] = useState<WarehouseBox[]>([]);
  const [modelsInBox, setModelsInBox] = useState<ModelLocation[]>([]);
  const [skuExceptionsInBox, setSkuExceptionsInBox] = useState<SkuLocation[]>([]);
  const [editing, setEditing] = useState(false);
  const [moveTarget, setMoveTarget] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    const [current, boxes, modelLocations, skuExceptions] = await Promise.all([
      repository.getBox(boxId),
      repository.listBoxes(),
      repository.listModelLocations(),
      repository.listSkuExceptions(),
    ]);
    setBox(current);
    setAllBoxes(boxes);
    setModelsInBox(modelLocations.filter(location => location.primaryBoxId === boxId || location.secondaryBoxId === boxId));
    setSkuExceptionsInBox(skuExceptions.filter(exception => exception.boxId === boxId));
  }, [repository, boxId]);

  useEffect(() => {
    load();
  }, [load]);

  async function moveModel(location: ModelLocation) {
    const target = moveTarget[location.modelName];
    if (!target) {
      alert("이동할 BOX를 선택해주세요.");
      return;
    }
    const field = location.primaryBoxId === boxId ? "primaryBoxId" : "secondaryBoxId";
    await repository.saveModelLocation({ ...location, [field]: target });
    load();
  }

  async function emptyBox() {
    if (!box) return;
    if (!window.confirm(`BOX ${box.id}를 비우시겠습니까?\n연결된 모델 위치·SKU 예외가 모두 해제되고 상태가 "비어있음"으로 바뀝니다. (삭제되는 것은 아닙니다)`)) {
      return;
    }
    const [modelLocations, skuExceptions] = await Promise.all([repository.listModelLocations(), repository.listSkuExceptions()]);
    for (const location of modelLocations) {
      if (location.primaryBoxId === boxId || location.secondaryBoxId === boxId) {
        await repository.saveModelLocation({
          ...location,
          primaryBoxId: location.primaryBoxId === boxId ? "" : location.primaryBoxId,
          secondaryBoxId: location.secondaryBoxId === boxId ? undefined : location.secondaryBoxId,
        });
      }
    }
    for (const exception of skuExceptions) {
      if (exception.boxId === boxId) await repository.deleteSkuException(exception.skuId);
    }
    await repository.saveBox({ ...box, currentModelCount: 0, status: "empty" });
    load();
  }

  async function saveEdit(next: WarehouseBox) {
    await repository.saveBox(next);
    setEditing(false);
    load();
  }

  if (box === undefined) return <WarehouseScreen>불러오는 중...</WarehouseScreen>;
  if (box === null) {
    return (
      <WarehouseScreen>
        <BackLink href="/wms/warehouse/boxes" />
        <p>BOX "{boxId}"를 찾을 수 없습니다.</p>
      </WarehouseScreen>
    );
  }

  if (editing) {
    return <BoxEditForm box={box} onCancel={() => setEditing(false)} onSave={saveEdit} />;
  }

  return (
    <WarehouseScreen>
      <BackLink href="/wms/warehouse/boxes" />
      <div style={{ textAlign: "center", margin: "4px 0 12px" }}>
        <div style={{ fontSize: "32px", fontWeight: 900 }}>{box.id}</div>
        <div style={{ fontSize: "13px", color: wmsColors.muted }}>
          {box.shelfId} · {box.category}
          {box.series ? ` · ${box.series}` : ""} · {BOX_KIND_LABEL[box.kind]} · {BOX_STATUS_LABEL[box.status]}
          {box.isSetBox ? " · 세트전용" : ""}
        </div>
      </div>

      {box.memo && (
        <Card>
          <div style={{ fontSize: "12px", color: wmsColors.muted }}>메모</div>
          <div>{box.memo}</div>
        </Card>
      )}

      <div style={{ display: "flex", gap: "8px", marginBottom: "16px" }}>
        <a href={`/wms/warehouse/boxes/${encodeURIComponent(box.id)}/qr`} style={{ ...wmsSecondaryButton, flex: 1, display: "flex", alignItems: "center", justifyContent: "center", textDecoration: "none" }}>
          QR 미리보기
        </a>
        <button onClick={() => setEditing(true)} style={{ ...wmsSecondaryButton, flex: 1 }}>
          BOX 수정
        </button>
      </div>

      <a href={`/wms/warehouse/model-locations?box=${encodeURIComponent(box.id)}`} style={{ ...wmsPrimaryButton, width: "100%", display: "block", textAlign: "center", textDecoration: "none", lineHeight: "48px", marginBottom: "16px" }}>
        모델 추가
      </a>

      <h2 style={{ fontSize: "14px", margin: "0 0 8px" }}>들어있는 모델 ({modelsInBox.length}개)</h2>
      {modelsInBox.length === 0 && <p style={{ fontSize: "13px", color: wmsColors.muted }}>이 BOX에 연결된 모델이 없습니다.</p>}
      {modelsInBox.map(location => (
        <Card key={location.modelName}>
          <div style={{ fontWeight: 700 }}>{location.modelName}</div>
          <div style={{ fontSize: "12px", color: wmsColors.muted }}>
            {location.primaryBoxId === boxId ? "기본 BOX" : "보조 BOX"} · {location.allOptionsSameBox ? "옵션 전체 같은 BOX" : "옵션별 위치 다를 수 있음"}
            {location.isSetProduct ? " · 세트상품" : ""}
          </div>
          <div style={{ display: "flex", gap: "6px", marginTop: "8px" }}>
            <select
              value={moveTarget[location.modelName] || ""}
              onChange={e => setMoveTarget({ ...moveTarget, [location.modelName]: e.target.value })}
              style={{ ...selectStyle, minHeight: "40px", flex: 1 }}
            >
              <option value="">이동할 BOX 선택</option>
              {allBoxes.filter(candidate => candidate.id !== boxId).map(candidate => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.id}
                </option>
              ))}
            </select>
            <button onClick={() => moveModel(location)} style={{ ...wmsSecondaryButton, minHeight: "40px" }}>
              이동
            </button>
          </div>
        </Card>
      ))}

      <h2 style={{ fontSize: "14px", margin: "16px 0 8px" }}>SKU 예외 위치 ({skuExceptionsInBox.length}개)</h2>
      {skuExceptionsInBox.length === 0 && <p style={{ fontSize: "13px", color: wmsColors.muted }}>이 BOX를 가리키는 SKU 예외가 없습니다.</p>}
      {skuExceptionsInBox.map(exception => (
        <Card key={exception.skuId}>
          <div style={{ fontWeight: 700 }}>
            {exception.skuId} <span style={{ fontWeight: 400, color: wmsColors.muted }}>({exception.optionLabel || "-"})</span>
          </div>
          <div style={{ fontSize: "12px", color: wmsColors.muted }}>모델 {exception.modelName}</div>
        </Card>
      ))}

      <button onClick={emptyBox} style={{ ...wmsGhostButton, width: "100%", marginTop: "20px", color: wmsColors.warn, borderColor: wmsColors.warn }}>
        BOX 비우기
      </button>
    </WarehouseScreen>
  );
}

function BoxEditForm({ box, onCancel, onSave }: { box: WarehouseBox; onCancel: () => void; onSave: (box: WarehouseBox) => void }) {
  const [kind, setKind] = useState<WarehouseBoxKind>(box.kind);
  const [series, setSeries] = useState(box.series || "");
  const [isSetBox, setIsSetBox] = useState(box.isSetBox);
  const [maxModelCount, setMaxModelCount] = useState(box.maxModelCount ? String(box.maxModelCount) : "");
  const [status, setStatus] = useState<WarehouseBoxStatus>(box.status);
  const [memo, setMemo] = useState(box.memo || "");
  const [sortOrder, setSortOrder] = useState(String(box.sortOrder));

  return (
    <WarehouseScreen>
      <h1 style={{ fontSize: "18px", margin: "0 0 12px" }}>BOX 수정: {box.id}</h1>

      <FormField label="BOX 종류">
        <select value={kind} onChange={e => setKind(e.target.value as WarehouseBoxKind)} style={selectStyle}>
          <option value="small_tool_box">소형 공구박스</option>
          <option value="large_living_box">큰 리빙박스</option>
          <option value="other">기타</option>
        </select>
      </FormField>
      <FormField label="시리즈">
        <input value={series} onChange={e => setSeries(e.target.value)} style={inputStyle} />
      </FormField>
      <FormField label="세트상품 전용 여부">
        <label style={{ display: "flex", alignItems: "center", gap: "8px", minHeight: "48px" }}>
          <input type="checkbox" checked={isSetBox} onChange={e => setIsSetBox(e.target.checked)} style={{ width: "22px", height: "22px" }} />
          세트상품 전용 BOX입니다
        </label>
      </FormField>
      <FormField label="최대 모델 수">
        <input type="number" min={0} value={maxModelCount} onChange={e => setMaxModelCount(e.target.value)} style={inputStyle} />
      </FormField>
      <FormField label="사용상태">
        <select value={status} onChange={e => setStatus(e.target.value as WarehouseBoxStatus)} style={selectStyle}>
          <option value="active">사용중</option>
          <option value="empty">비어있음</option>
          <option value="full">가득참</option>
          <option value="retired">폐기</option>
        </select>
      </FormField>
      <FormField label="정렬순서">
        <input type="number" value={sortOrder} onChange={e => setSortOrder(e.target.value)} style={inputStyle} />
      </FormField>
      <FormField label="메모">
        <textarea value={memo} onChange={e => setMemo(e.target.value)} style={textareaStyle} />
      </FormField>

      <div style={{ display: "flex", gap: "8px" }}>
        <button onClick={onCancel} style={{ ...wmsGhostButton, flex: 1 }}>
          취소
        </button>
        <button
          onClick={() =>
            onSave({
              ...box,
              kind,
              series: series.trim() || undefined,
              isSetBox,
              maxModelCount: maxModelCount ? Number(maxModelCount) : undefined,
              status,
              memo: memo.trim() || undefined,
              sortOrder: Number(sortOrder) || 0,
            })
          }
          style={{ ...wmsPrimaryButton, flex: 2 }}
        >
          저장
        </button>
      </div>
    </WarehouseScreen>
  );
}
