"use client";

import { useEffect, useState, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import type { PickingBox, PickingModel, PickingOption } from "@/lib/wms/picking-sample-data";
import { countOptionsInBox } from "@/lib/wms/picking-sample-data";
import { useWmsPickingFlow } from "@/lib/wms/picking-flow-context";
import {
  WMS_MOBILE_WIDTH,
  wmsColors,
  wmsPrimaryButton,
  wmsSecondaryButton,
  wmsWarnButton,
  wmsGhostButton,
  wmsOuterCard,
} from "@/lib/wms/ui-tokens";

/**
 * BOX 중심 모바일 피킹 화면. 절대 SKU 목록을 먼저 보여주지 않는다.
 * 순서: 선반 → BOX → 모델 → SKU (한 번에 하나씩)
 * BOX 완료 시 확인 화면을 거쳐 사용자가 직접 다음 BOX로 이동한다 (자동 이동 아님).
 */
export default function WmsPickingPage() {
  const router = useRouter();
  const { activeBatch, progress, markFull, markPartial, markNotFound, finishPickingAndGroupShortage } = useWmsPickingFlow();

  const [selectedBoxId, setSelectedBoxId] = useState<string | null>(null);
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null);
  const [optionIndex, setOptionIndex] = useState(0);
  const [showPartialInput, setShowPartialInput] = useState(false);
  const [partialValue, setPartialValue] = useState("");
  const [detailOption, setDetailOption] = useState<PickingOption | null>(null);
  const [completedBoxIds, setCompletedBoxIds] = useState<Set<string>>(new Set());
  const [pendingBoxComplete, setPendingBoxComplete] = useState<string | null>(null);
  const [showAllComplete, setShowAllComplete] = useState(false);

  const selectedBox: PickingBox | undefined = activeBatch?.boxes.find(box => box.boxId === selectedBoxId);
  const selectedModel: PickingModel | undefined = selectedBox?.models.find(model => model.modelId === selectedModelId);

  const allOptions = activeBatch ? activeBatch.boxes.flatMap(box => box.models.flatMap(model => model.options)) : [];
  const totalBoxes = activeBatch?.boxes.length ?? 0;
  const doneBoxCount = activeBatch
    ? activeBatch.boxes.filter(box => box.models.flatMap(m => m.options).every(o => progress[o.skuId]?.status && progress[o.skuId].status !== "pending")).length
    : 0;

  // BOX 내 모든 SKU 결정 완료 감지 → BOX 완료 확인 화면 표시 (자동 이동 아님, 버튼으로 진행)
  useEffect(() => {
    if (!activeBatch || !selectedBoxId || pendingBoxComplete || showAllComplete) return;
    const box = activeBatch.boxes.find(b => b.boxId === selectedBoxId);
    if (!box) return;
    const options = box.models.flatMap(model => model.options);
    const allDone = options.every(option => progress[option.skuId]?.status && progress[option.skuId].status !== "pending");
    if (!allDone || completedBoxIds.has(box.boxId)) return;

    setCompletedBoxIds(prev => new Set(prev).add(box.boxId));
    setPendingBoxComplete(box.boxId);
  }, [progress, activeBatch, selectedBoxId, completedBoxIds, pendingBoxComplete, showAllComplete]);

  if (!activeBatch) {
    return (
      <main style={pageStyle}>
        <h1 style={{ fontSize: "18px" }}>피킹</h1>
        <p style={{ color: wmsColors.muted }}>선택된 작업이 없습니다. 작업센터에서 피킹을 먼저 시작해주세요.</p>
        <a href="/wms/work-center" style={{ color: wmsColors.green, fontWeight: 700 }}>
          작업센터로 이동
        </a>
      </main>
    );
  }

  function decide(option: PickingOption, type: "full" | "partial" | "notfound", pickedQty?: number) {
    if (type === "full") markFull(option);
    else if (type === "notfound") markNotFound(option);
    else markPartial(option, pickedQty ?? 0);

    setShowPartialInput(false);
    setPartialValue("");

    if (!selectedModel) return;
    if (optionIndex + 1 < selectedModel.options.length) {
      setOptionIndex(optionIndex + 1);
    } else {
      setSelectedModelId(null);
      setOptionIndex(0);
    }
  }

  function handleBoxCompleteNext() {
    if (!activeBatch || !pendingBoxComplete) return;
    const finishedBoxId = pendingBoxComplete;
    setPendingBoxComplete(null);

    const nextBox = activeBatch.boxes.find(candidate => {
      if (candidate.boxId === finishedBoxId) return false;
      const candidateOptions = candidate.models.flatMap(model => model.options);
      return candidateOptions.some(option => !progress[option.skuId] || progress[option.skuId].status === "pending");
    });

    if (nextBox) {
      setSelectedBoxId(nextBox.boxId);
      setSelectedModelId(null);
      setOptionIndex(0);
    } else {
      setSelectedBoxId(null);
      setShowAllComplete(true);
    }
  }

  function handleFinishAll() {
    finishPickingAndGroupShortage();
    router.push("/wms/vendor-orders");
  }

  // 화면: 전체 작업 완료 요약
  if (showAllComplete) {
    const totalFound = allOptions.reduce((sum, option) => sum + (progress[option.skuId]?.pickedQty ?? 0), 0);
    const totalShortage = allOptions.reduce((sum, option) => sum + Math.max(0, option.orderedQty - (progress[option.skuId]?.pickedQty ?? 0)), 0);
    const shortageSkuCount = allOptions.filter(option => option.orderedQty - (progress[option.skuId]?.pickedQty ?? 0) > 0).length;

    return (
      <main style={pageStyle}>
        <div style={{ textAlign: "center", padding: "24px 0" }}>
          <div style={{ fontSize: "40px" }}>✅</div>
          <h1 style={{ fontSize: "20px", margin: "8px 0" }}>전체 작업 완료</h1>
          <p style={{ color: wmsColors.muted, margin: 0 }}>{activeBatch.center}</p>
        </div>

        <div style={summaryGridStyle}>
          <SummaryTile label="BOX 완료" value={`${totalBoxes} / ${totalBoxes}`} />
          <SummaryTile label="전체 찾은 수량" value={String(totalFound)} />
          <SummaryTile label="전체 부족 수량" value={String(totalShortage)} highlight={totalShortage > 0} />
          <SummaryTile label="거래처 발주 예정 SKU" value={`${shortageSkuCount}개`} highlight={shortageSkuCount > 0} />
        </div>

        <button onClick={handleFinishAll} style={{ ...wmsPrimaryButton, width: "100%", marginTop: "20px" }}>
          작업 완료
        </button>
      </main>
    );
  }

  // 화면: BOX 완료 확인
  if (pendingBoxComplete) {
    const box = activeBatch.boxes.find(b => b.boxId === pendingBoxComplete);
    const options = box ? box.models.flatMap(model => model.options) : [];
    const found = options.reduce((sum, option) => sum + (progress[option.skuId]?.pickedQty ?? 0), 0);
    const shortage = options.reduce((sum, option) => sum + Math.max(0, option.orderedQty - (progress[option.skuId]?.pickedQty ?? 0)), 0);
    const hasNextBox = activeBatch.boxes.some(candidate => {
      if (candidate.boxId === pendingBoxComplete) return false;
      const candidateOptions = candidate.models.flatMap(model => model.options);
      return candidateOptions.some(option => !progress[option.skuId] || progress[option.skuId].status === "pending");
    });

    return (
      <main style={pageStyle}>
        <div style={{ textAlign: "center", padding: "24px 0" }}>
          <div style={{ fontSize: "40px" }}>📦</div>
          <h1 style={{ fontSize: "20px", margin: "8px 0" }}>BOX {box?.boxId} 완료</h1>
          <p style={{ color: wmsColors.muted, margin: 0 }}>
            전체 BOX 진행률 {doneBoxCount} / {totalBoxes}
          </p>
        </div>

        <div style={summaryGridStyle}>
          <SummaryTile label="찾은 수량" value={String(found)} />
          <SummaryTile label="부족 수량" value={String(shortage)} highlight={shortage > 0} />
        </div>

        <button onClick={handleBoxCompleteNext} style={{ ...wmsPrimaryButton, width: "100%", marginTop: "20px" }}>
          {hasNextBox ? "다음 BOX로 이동" : "전체 완료 화면 보기"}
        </button>
      </main>
    );
  }

  // 화면: BOX 목록 (선반별 그룹핑)
  if (!selectedBox) {
    const shelfIds = [...new Set(activeBatch.boxes.map(box => box.shelfId))];
    return (
      <main style={pageStyle}>
        <h1 style={{ fontSize: "18px", margin: "0 0 2px" }}>피킹</h1>
        <p style={{ color: wmsColors.muted, fontSize: "13px", margin: "0 0 4px" }}>
          {activeBatch.center} · 입고예정 {activeBatch.expectedDate}
        </p>
        <p style={{ color: wmsColors.green, fontSize: "13px", fontWeight: 700, margin: "0 0 16px" }}>
          전체 BOX 진행률 {doneBoxCount} / {totalBoxes}
        </p>

        {shelfIds.map(shelfId => (
          <div key={shelfId} style={{ marginBottom: "20px" }}>
            <h2 style={{ fontSize: "13px", color: wmsColors.muted, margin: "0 0 8px", textTransform: "uppercase", letterSpacing: "0.06em" }}>
              선반 {shelfId}
            </h2>
            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              {activeBatch.boxes
                .filter(box => box.shelfId === shelfId)
                .map(box => {
                  const total = countOptionsInBox(box);
                  const done = box.models
                    .flatMap(model => model.options)
                    .filter(option => progress[option.skuId]?.status && progress[option.skuId].status !== "pending").length;
                  const isBoxDone = done === total;
                  return (
                    <button
                      key={box.boxId}
                      onClick={() => {
                        setSelectedBoxId(box.boxId);
                        setSelectedModelId(null);
                        setOptionIndex(0);
                      }}
                      style={{
                        ...wmsSecondaryButton,
                        minHeight: "64px",
                        width: "100%",
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        padding: "12px 16px",
                        background: isBoxDone ? wmsColors.greenSoft : "#ffffff",
                        border: isBoxDone ? `2px solid ${wmsColors.green}` : `1px solid ${wmsColors.border}`,
                      }}
                    >
                      <span style={{ fontWeight: 800, fontSize: "18px", textAlign: "left" }}>BOX {box.boxId}</span>
                      <span style={{ fontWeight: 700, fontSize: "16px" }}>
                        {done} / {total}
                        {isBoxDone && <span style={{ marginLeft: "6px", color: wmsColors.greenDark }}>완료</span>}
                      </span>
                    </button>
                  );
                })}
            </div>
          </div>
        ))}
      </main>
    );
  }

  // 화면: 선택한 BOX의 모델 목록
  if (!selectedModel) {
    const boxOptions = selectedBox.models.flatMap(model => model.options);
    const boxDone = boxOptions.filter(option => progress[option.skuId]?.status && progress[option.skuId].status !== "pending").length;

    return (
      <main style={pageStyle}>
        <button onClick={() => setSelectedBoxId(null)} style={{ ...wmsGhostButton, marginBottom: "12px" }}>
          ← BOX 목록으로
        </button>

        <div style={{ textAlign: "center", margin: "8px 0 4px" }}>
          <div style={{ fontSize: "34px", fontWeight: 900, letterSpacing: "-0.02em" }}>BOX {selectedBox.boxId}</div>
          <div style={{ fontSize: "13px", color: wmsColors.muted }}>선반 {selectedBox.shelfId}</div>
        </div>
        <p style={{ textAlign: "center", color: wmsColors.green, fontWeight: 700, fontSize: "14px", margin: "8px 0 4px" }}>
          이 BOX {boxDone} / {boxOptions.length} · 전체 BOX {doneBoxCount} / {totalBoxes}
        </p>
        <p style={{ textAlign: "center", color: wmsColors.muted, fontSize: "12px", margin: "0 0 16px" }}>
          모델 {selectedBox.models.length}개 · SKU {boxOptions.length}개
        </p>

        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          {selectedBox.models.map(model => {
            const total = model.options.length;
            const done = model.options.filter(option => progress[option.skuId]?.status && progress[option.skuId].status !== "pending").length;
            const statusLabel = done === 0 ? "대기중" : done === total ? "완료" : `${done} / ${total}`;
            const isDone = done === total;
            return (
              <button
                key={model.modelId}
                onClick={() => {
                  setSelectedModelId(model.modelId);
                  setOptionIndex(0);
                }}
                style={{
                  ...wmsSecondaryButton,
                  height: "auto",
                  minHeight: "84px",
                  width: "100%",
                  display: "flex",
                  alignItems: "center",
                  gap: "12px",
                  padding: "10px 12px",
                  textAlign: "left",
                  background: isDone ? wmsColors.greenSoft : "#ffffff",
                  border: isDone ? `2px solid ${wmsColors.green}` : `1px solid ${wmsColors.border}`,
                }}
              >
                <img src={model.representativeImageDataUri} alt={model.modelName} width={56} height={56} style={{ borderRadius: "8px", flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: "15px", whiteSpace: "normal", overflowWrap: "anywhere", lineHeight: 1.35 }}>
                    {model.modelName}
                  </div>
                  <div style={{ fontSize: "12px", color: wmsColors.muted }}>옵션 {total}개</div>
                </div>
                <div style={{ fontSize: "13px", fontWeight: 700, color: isDone ? wmsColors.greenDark : wmsColors.ink }}>{statusLabel}</div>
              </button>
            );
          })}
        </div>
      </main>
    );
  }

  // 화면: 선택한 모델의 SKU 옵션 (한 번에 하나씩)
  const option = selectedModel.options[optionIndex];
  const entry = progress[option.skuId];
  const shortageQty = entry && entry.status !== "pending" ? Math.max(0, option.orderedQty - entry.pickedQty) : null;
  const displayedStock = entry?.status === "notfound" ? 0 : option.currentStock;

  return (
    <main style={pageStyle}>
      <button onClick={() => setSelectedModelId(null)} style={{ ...wmsGhostButton, marginBottom: "10px" }}>
        ← 모델 목록으로
      </button>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <h1 style={{ fontSize: "16px", margin: 0 }}>{selectedModel.modelName}</h1>
        <span style={{ fontSize: "12px", color: wmsColors.muted }}>
          {optionIndex + 1} / {selectedModel.options.length}
        </span>
      </div>

      <div style={{ ...wmsOuterCard, padding: "16px", textAlign: "center", marginTop: "10px" }}>
        <img
          src={option.imageDataUri}
          alt={option.optionLabel}
          width={WMS_MOBILE_WIDTH - 80}
          height={WMS_MOBILE_WIDTH - 80}
          style={{ borderRadius: "12px", width: "100%", maxWidth: "260px", height: "auto" }}
        />
        <h2 style={{ margin: "12px 0 2px", fontSize: "20px" }}>{option.optionLabel}</h2>
        <p style={{ margin: "0 0 4px", color: wmsColors.muted, fontSize: "13px" }}>{option.skuId}</p>
        <button
          onClick={() => setDetailOption(option)}
          style={{ background: "none", border: "none", color: wmsColors.green, fontWeight: 700, fontSize: "13px", padding: 0, cursor: "pointer" }}
        >
          상품보기 →
        </button>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "8px", margin: "16px 0", fontSize: "13px" }}>
          <InfoTile label="발주수량" value={option.orderedQty} />
          <InfoTile label="찾은수량" value={entry && entry.status !== "pending" ? entry.pickedQty : "-"} />
          <InfoTile label="부족수량" value={shortageQty ?? "-"} highlight={Boolean(shortageQty)} />
          <InfoTile label="임시 현재고" value={displayedStock} />
        </div>

        {!showPartialInput ? (
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            <button onClick={() => decide(option, "full")} style={{ ...wmsPrimaryButton, width: "100%" }}>
              전량찾음
            </button>
            <div style={{ display: "flex", gap: "8px" }}>
              <button onClick={() => setShowPartialInput(true)} style={{ ...wmsSecondaryButton, flex: 1 }}>
                부분찾음
              </button>
              <button onClick={() => decide(option, "notfound")} style={{ ...wmsWarnButton, flex: 1 }}>
                못 찾음
              </button>
            </div>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            <input
              type="number"
              min={0}
              max={option.orderedQty}
              value={partialValue}
              onChange={event => setPartialValue(event.target.value)}
              placeholder="찾은 수량"
              autoFocus
              style={{ width: "100%", minHeight: "48px", fontSize: "17px", textAlign: "center", borderRadius: "10px", border: `1px solid ${wmsColors.borderStrong}` }}
            />
            <div style={{ display: "flex", gap: "8px" }}>
              <button onClick={() => setShowPartialInput(false)} style={{ ...wmsGhostButton, flex: 1 }}>
                취소
              </button>
              <button onClick={() => decide(option, "partial", Number(partialValue) || 0)} style={{ ...wmsPrimaryButton, flex: 2 }}>
                입력 완료
              </button>
            </div>
          </div>
        )}
      </div>

      {detailOption && (
        <div
          onClick={() => setDetailOption(null)}
          style={{ position: "fixed", inset: 0, background: "rgba(37,37,37,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50, padding: "20px" }}
        >
          <div onClick={event => event.stopPropagation()} style={{ background: "#fff", borderRadius: "14px", padding: "24px", textAlign: "center", maxWidth: "320px" }}>
            <img src={detailOption.imageDataUri} alt={detailOption.optionLabel} width={200} height={200} style={{ borderRadius: "10px" }} />
            <h3 style={{ margin: "12px 0 4px" }}>{detailOption.productName}</h3>
            <p style={{ margin: "0 0 4px", color: wmsColors.muted }}>SKU: {detailOption.skuId}</p>
            <p style={{ margin: "0 0 12px", color: wmsColors.muted }}>거래처: {detailOption.vendorName}</p>
            <p style={{ fontSize: "12px", color: wmsColors.muted }}>* 샘플 데이터입니다. 실제 상품 링크 연동은 다음 스프린트에서 구현됩니다.</p>
            <button onClick={() => setDetailOption(null)} style={{ ...wmsSecondaryButton, marginTop: "8px" }}>
              닫기
            </button>
          </div>
        </div>
      )}
    </main>
  );
}

const pageStyle: CSSProperties = {
  maxWidth: WMS_MOBILE_WIDTH,
  margin: "0 auto",
  padding: "16px 16px calc(16px + env(safe-area-inset-bottom))",
  fontFamily: "sans-serif",
  background: wmsColors.background,
  color: wmsColors.ink,
  minHeight: "100vh",
};

const summaryGridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(2, 1fr)",
  gap: "10px",
};

function SummaryTile({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div style={{ background: wmsColors.surfaceBeige, border: `1px solid ${wmsColors.border}`, borderRadius: "12px", padding: "14px", textAlign: "center" }}>
      <div style={{ fontSize: "22px", fontWeight: 800, color: highlight ? wmsColors.warn : wmsColors.ink }}>{value}</div>
      <div style={{ fontSize: "12px", color: wmsColors.muted, marginTop: "2px" }}>{label}</div>
    </div>
  );
}

function InfoTile({ label, value, highlight }: { label: string; value: string | number; highlight?: boolean }) {
  return (
    <div style={{ background: wmsColors.surfaceBeige, borderRadius: "10px", padding: "10px" }}>
      <div style={{ color: wmsColors.muted, fontSize: "11px" }}>{label}</div>
      <div style={{ fontSize: "17px", fontWeight: 800, color: highlight ? wmsColors.warn : wmsColors.ink }}>{value}</div>
    </div>
  );
}
