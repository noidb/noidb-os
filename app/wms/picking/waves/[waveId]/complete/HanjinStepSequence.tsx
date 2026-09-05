"use client";

import { useEffect, useState } from "react";
import { usePickingWaveRepository } from "@/lib/wms/picking-wave/context";
import type { BasketAssignment, PickingWaveItem, ShipmentOutputGeneration } from "@/lib/wms/picking-wave/types";
import { wmsColors } from "@/lib/wms/ui-tokens";
import HanjinUploadSection from "./HanjinUploadSection";
import HanjinAutoShipmentSection from "./HanjinAutoShipmentSection";
import type { HanjinGenerationResult } from "./HanjinUploadSection";
import ShipmentOutputSetSection from "./ShipmentOutputSetSection";
import ShipmentWorkflowStepCard from "./ShipmentWorkflowStepCard";
import { chooseOutputGenerationId } from "@/lib/wms/output-generation-progress";

interface Props {
  waveId: string;
  baskets: BasketAssignment[];
  items: PickingWaveItem[];
}

/**
 * 발주확정 다음 단계(한진택배 후속 업무)를 순서대로 보여주는 화면 (2026-08-19 5차 실사용 테스트
 * 신규, 6차 실사용 테스트에서 1·3단계 파일 분리 반영, 7차에서 2단계를 화면 state가 아니라 실제
 * 파일 검증 기준으로 바꿈).
 *
 * 2026-08-24 9차 — UI 단순화: 예전 2단계(운송장번호 입력 파일을 사용자가 직접 선택)·3단계
 * (그 파일로 쉽먼트 업로드파일 생성)·4단계(쉽먼트 결과 파일 미리보기)·5단계(미구현 안내)를
 * 이 화면에서 뺐다 — "쉽먼트파일 생성" 버튼 하나(HanjinAutoShipmentSection)가 Google Drive/로컬
 * G드라이브에서 최신 재출력 세부내역·발주서업로드완성 확정수량 파일을 자동으로 찾아 옛
 * 2·3단계를 한 번에 대신한다(lib/wms/hanjin-shipment-auto.ts 참고). 뺀 컴포넌트/라우트
 * (HanjinTrackingMatchSection, HanjinShipmentUploadSection, HanjinShipmentResultUploadSection,
 * 그리고 그 API들)는 삭제하지 않고 그대로 남겨뒀다 — 기존 쉽먼트 생성 로직 자체는 바뀐 게
 * 없고, 이 화면에 다시 연결해야 할 경우를 대비한 것뿐이다.
 */
export default function HanjinStepSequence({ waveId, baskets, items }: Props) {
  const repository = usePickingWaveRepository();
  const [step1Done, setStep1Done] = useState(false);
  const [generations, setGenerations] = useState<ShipmentOutputGeneration[]>([]);
  const [activeGenerationId, setActiveGenerationId] = useState<string | null>(null);
  const activeGenerationStorageKey = `noidb:wms:active-output-generation:${waveId}`;

  useEffect(() => {
    repository.getWave(waveId).then(wave => {
      const stored = wave?.outputGenerations || [];
      setGenerations(stored);
      setActiveGenerationId(current => {
        if (current) return current;
        const saved = sessionStorage.getItem(activeGenerationStorageKey);
        const shared = wave?.selectedOutputGenerationId;
        return chooseOutputGenerationId(stored, shared, saved);
      });
      setStep1Done(stored.length > 0);
    }).catch(() => undefined);
  }, [activeGenerationStorageKey, repository, waveId]);

  useEffect(() => {
    if (activeGenerationId) sessionStorage.setItem(activeGenerationStorageKey, activeGenerationId);
  }, [activeGenerationId, activeGenerationStorageKey]);

  async function saveGeneration(result: HanjinGenerationResult) {
    const wave = await repository.getWave(waveId);
    if (!wave) throw new Error("웨이브를 찾을 수 없어 출력 묶음을 저장하지 못했습니다.");
    const now = new Date().toISOString();
    const existing = (wave.outputGenerations || []).find(generation => {
      if (generation.purchaseOrderNumbers.length !== result.purchaseOrderNumbers.length) return false;
      const selected = new Set(result.purchaseOrderNumbers);
      return generation.purchaseOrderNumbers.every(po => selected.has(po));
    });
    const generation: ShipmentOutputGeneration = existing
      ? { ...existing, updatedAt: now, expectedShippingGroupCount: result.preview.shippingGroupCount, invoiceFileName: result.fileName }
      : { generationId: crypto.randomUUID(), waveId, purchaseOrderNumbers: [...result.purchaseOrderNumbers], createdAt: now, updatedAt: now, expectedShippingGroupCount: result.preview.shippingGroupCount, invoiceFileName: result.fileName, status: "invoice_generated" };
    const outputGenerations = existing
      ? (wave.outputGenerations || []).map(item => item.generationId === existing.generationId ? generation : item)
      : [...(wave.outputGenerations || []), generation];
    await repository.saveWave({ ...wave, outputGenerations, selectedOutputGenerationId: generation.generationId, updatedAt: now });
    setGenerations(outputGenerations);
    setActiveGenerationId(generation.generationId);
    setStep1Done(true);
  }

  async function selectGeneration(generationId: string) {
    setActiveGenerationId(generationId);
    const wave = await repository.getWave(waveId);
    if (!wave || wave.selectedOutputGenerationId === generationId) return;
    await repository.saveWave({ ...wave, selectedOutputGenerationId: generationId, updatedAt: new Date().toISOString() });
  }

  async function markShipmentGenerated(generationId: string, fileName: string) {
    const wave = await repository.getWave(waveId);
    if (!wave) return;
    const now = new Date().toISOString();
    const outputGenerations = (wave.outputGenerations || []).map(generation => generation.generationId === generationId ? { ...generation, shipmentFileName: fileName, status: "shipment_generated" as const, updatedAt: now } : generation);
    await repository.saveWave({ ...wave, outputGenerations, selectedOutputGenerationId: generationId, updatedAt: now });
    setGenerations(outputGenerations);
  }

  async function markOutputSetGenerated(generationId: string, fileName: string) {
    const wave = await repository.getWave(waveId);
    if (!wave) return;
    const now = new Date().toISOString();
    const outputGenerations = (wave.outputGenerations || []).map(generation => generation.generationId === generationId
      ? { ...generation, outputSetFileName: fileName, outputSetGeneratedAt: now, updatedAt: now }
      : generation);
    const selectedOutputGenerationId = chooseOutputGenerationId(outputGenerations) || generationId;
    await repository.saveWave({ ...wave, outputGenerations, selectedOutputGenerationId, updatedAt: now });
    setGenerations(outputGenerations);
    setActiveGenerationId(selectedOutputGenerationId);
  }

  async function removeUnusedGeneration(generationId: string) {
    const wave = await repository.getWave(waveId);
    const target = wave?.outputGenerations?.find(generation => generation.generationId === generationId);
    if (!wave || !target || target.status === "shipment_generated") return;
    const outputGenerations = (wave.outputGenerations || []).filter(generation => generation.generationId !== generationId);
    const selectedOutputGenerationId = wave.selectedOutputGenerationId === generationId
      ? outputGenerations.at(-1)?.generationId
      : wave.selectedOutputGenerationId;
    await repository.saveWave({ ...wave, outputGenerations, selectedOutputGenerationId, updatedAt: new Date().toISOString() });
    setGenerations(outputGenerations);
    if (activeGenerationId === generationId) setActiveGenerationId(outputGenerations.at(-1)?.generationId || null);
  }

  const activeGeneration = generations.find(generation => generation.generationId === activeGenerationId) || generations.at(-1);
  const recentGenerations = [...generations].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 5);

  const step1Status = step1Done ? "done" as const : "current" as const;

  return (
    <div>
      <ShipmentWorkflowStepCard step={2} title="송장출력용 업로드파일" subtitle="발주서 단위로 묶음을 자동 제안하고 선택한 발주 집합을 다음 단계까지 고정합니다." status={step1Status}>
        <HanjinUploadSection baskets={baskets} items={items} generations={generations} onGenerated={saveGeneration} />
      </ShipmentWorkflowStepCard>

      {recentGenerations.length > 0 && <div style={{ marginBottom: "10px", fontSize: "11px" }}>
        <strong>최근 출력 묶음</strong>
        <div style={{ display: "flex", gap: "6px", overflowX: "auto", paddingTop: "6px" }}>
          {recentGenerations.map(generation => {
            const originalIndex = generations.findIndex(item => item.generationId === generation.generationId);
            return <span key={generation.generationId} style={{ display: "inline-flex", border: `1px solid ${generation.generationId === activeGeneration?.generationId ? wmsColors.slate : wmsColors.border}`, borderRadius: "999px", background: generation.generationId === activeGeneration?.generationId ? "rgba(83,109,120,0.12)" : "#fff", whiteSpace: "nowrap", overflow: "hidden" }}>
              <button type="button" onClick={() => void selectGeneration(generation.generationId)} style={{ border: 0, background: "transparent", padding: "7px 9px", fontSize: "11px" }}>묶음 {originalIndex + 1} · 발주 {generation.purchaseOrderNumbers.length}건</button>
              {generation.status !== "shipment_generated" && <button type="button" aria-label={`묶음 ${originalIndex + 1} 삭제`} onClick={() => void removeUnusedGeneration(generation.generationId)} style={{ border: 0, borderLeft: `1px solid ${wmsColors.border}`, background: "transparent", padding: "0 8px", color: wmsColors.muted }}>×</button>}
            </span>;
          })}
        </div>
      </div>}

      <ShipmentWorkflowStepCard step={3} title="Shipment 업로드파일" subtitle="현재 묶음의 한진 결과를 자동 확인하고 발주서 원본 SKU·바코드·수량만 사용합니다." status={activeGeneration?.status === "shipment_generated" ? "done" : "current"}>
        <HanjinAutoShipmentSection
          generation={activeGeneration}
          generationLabel={activeGeneration ? `묶음 ${generations.findIndex(item => item.generationId === activeGeneration.generationId) + 1}` : undefined}
          blockedByGeneration={activeGeneration ? (() => {
            const poSet = new Set(activeGeneration.purchaseOrderNumbers);
            const overlap = generations.find(item => item.generationId !== activeGeneration.generationId && item.status === "shipment_generated" && item.purchaseOrderNumbers.some(po => poSet.has(po)));
            return overlap ? "이미 다른 Shipment 묶음에 포함된 발주번호가 있어 신규 생성을 차단했습니다. 동일 generation 재생성만 허용됩니다." : undefined;
          })() : undefined}
          onGenerated={markShipmentGenerated}
        />
      </ShipmentWorkflowStepCard>

      <ShipmentWorkflowStepCard step={4} title="Shipment 출력세트" subtitle="현재 묶음의 발주만 포함하며 상태와 관계없이 언제든 다시 생성할 수 있습니다." status={activeGeneration?.outputSetGeneratedAt ? "done" : "current"}>
        <ShipmentOutputSetSection waveId={waveId} items={items} generation={activeGeneration} generationLabel={activeGeneration ? `묶음 ${generations.findIndex(item => item.generationId === activeGeneration.generationId) + 1}` : undefined} onGenerated={markOutputSetGenerated} />
      </ShipmentWorkflowStepCard>
    </div>
  );
}
