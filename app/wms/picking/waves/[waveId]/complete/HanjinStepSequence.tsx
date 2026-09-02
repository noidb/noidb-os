"use client";

import { useEffect, useState } from "react";
import { usePickingWaveRepository } from "@/lib/wms/picking-wave/context";
import type { BasketAssignment, PickingWaveItem, ShipmentOutputGeneration } from "@/lib/wms/picking-wave/types";
import { wmsColors } from "@/lib/wms/ui-tokens";
import HanjinUploadSection from "./HanjinUploadSection";
import HanjinAutoShipmentSection from "./HanjinAutoShipmentSection";
import type { HanjinGenerationResult } from "./HanjinUploadSection";

interface Props {
  waveId: string;
  baskets: BasketAssignment[];
  items: PickingWaveItem[];
}

type StepStatus = "done" | "current";

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

  useEffect(() => {
    repository.getWave(waveId).then(wave => {
      const stored = wave?.outputGenerations || [];
      setGenerations(stored);
      setActiveGenerationId(current => current || stored.at(-1)?.generationId || null);
      setStep1Done(stored.length > 0);
    }).catch(() => undefined);
  }, [repository, waveId]);

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
    await repository.saveWave({ ...wave, outputGenerations, updatedAt: now });
    setGenerations(outputGenerations);
    setActiveGenerationId(generation.generationId);
    setStep1Done(true);
  }

  async function markShipmentGenerated(generationId: string, fileName: string) {
    const wave = await repository.getWave(waveId);
    if (!wave) return;
    const now = new Date().toISOString();
    const outputGenerations = (wave.outputGenerations || []).map(generation => generation.generationId === generationId ? { ...generation, shipmentFileName: fileName, status: "shipment_generated" as const, updatedAt: now } : generation);
    await repository.saveWave({ ...wave, outputGenerations, updatedAt: now });
    setGenerations(outputGenerations);
  }

  const activeGeneration = generations.find(generation => generation.generationId === activeGenerationId) || generations.at(-1);

  const step1Status: StepStatus = step1Done ? "done" : "current";
  const currentStepLabel = step1Done ? "2단계(쉽먼트파일 생성) 진행 가능" : "1단계 진행 가능";

  return (
    <div style={{ marginTop: "20px" }}>
      <div style={{ background: wmsColors.surfaceBeige, border: `1px solid ${wmsColors.borderStrong}`, borderRadius: "10px", padding: "10px 12px", marginBottom: "14px" }}>
        <div style={{ fontSize: "11px", color: wmsColors.muted, marginBottom: "2px" }}>한진택배 후속 업무 — 현재 단계</div>
        <div style={{ fontSize: "13px", fontWeight: 800, color: wmsColors.ink }}>{currentStepLabel}</div>
      </div>

      <StepCard step={1} title="송장출력용 업로드파일 생성" subtitle="한진택배 업로드용 — 로켓입고 요청" status={step1Status}>
        <HanjinUploadSection baskets={baskets} items={items} generations={generations} onGenerated={saveGeneration} />
      </StepCard>

      {generations.length > 0 && <div style={{ marginBottom: "10px", fontSize: "11px" }}>
        <strong>저장된 출력 묶음</strong>
        <div style={{ display: "flex", gap: "6px", overflowX: "auto", paddingTop: "6px" }}>
          {generations.map((generation, index) => <button key={generation.generationId} type="button" onClick={() => setActiveGenerationId(generation.generationId)} style={{ border: `1px solid ${generation.generationId === activeGeneration?.generationId ? wmsColors.slate : wmsColors.border}`, borderRadius: "999px", background: generation.generationId === activeGeneration?.generationId ? "rgba(83,109,120,0.12)" : "#fff", padding: "7px 10px", whiteSpace: "nowrap" }}>
            묶음 {index + 1} · 발주 {generation.purchaseOrderNumbers.length}건
          </button>)}
        </div>
      </div>}

      <StepCard step={2} title="쉽먼트파일 생성" subtitle="재출력 세부내역·확정수량 파일 자동 탐색 — 파일 직접 선택 불필요" status="current">
        <HanjinAutoShipmentSection baskets={baskets} generation={activeGeneration} onGenerated={markShipmentGenerated} />
      </StepCard>
    </div>
  );
}

function StepCard({
  step,
  title,
  subtitle,
  status,
  children,
}: {
  step: number;
  title: string;
  subtitle?: string;
  status: StepStatus;
  children: React.ReactNode;
}) {
  const badge =
    status === "done"
      ? { label: "완료", bg: wmsColors.greenSoft, color: wmsColors.greenDark }
      : { label: "진행 가능", bg: "rgba(83,109,120,0.12)", color: wmsColors.slateDark };

  return (
    <div style={{ border: `1px solid ${wmsColors.border}`, borderRadius: "10px", padding: "12px", marginBottom: "10px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: subtitle ? "2px" : "8px" }}>
        <h3 style={{ margin: 0, fontSize: "14px" }}>
          {step}. {title}
        </h3>
        <span style={{ fontSize: "10px", fontWeight: 700, padding: "3px 8px", borderRadius: "999px", background: badge.bg, color: badge.color, flexShrink: 0 }}>
          {badge.label}
        </span>
      </div>
      {subtitle && <p style={{ fontSize: "10px", color: wmsColors.muted, margin: "0 0 8px" }}>{subtitle}</p>}
      {children}
    </div>
  );
}
