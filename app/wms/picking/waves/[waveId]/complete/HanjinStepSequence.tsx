"use client";

import { useState } from "react";
import type { BasketAssignment } from "@/lib/wms/picking-wave/types";
import { wmsColors } from "@/lib/wms/ui-tokens";
import HanjinUploadSection from "./HanjinUploadSection";
import HanjinTrackingMatchSection from "./HanjinTrackingMatchSection";
import HanjinShipmentUploadSection from "./HanjinShipmentUploadSection";
import HanjinShipmentResultUploadSection from "./HanjinShipmentResultUploadSection";

interface Props {
  waveId: string;
  baskets: BasketAssignment[];
}

type StepStatus = "done" | "current" | "locked" | "not_implemented";

/**
 * 발주확정 다음 단계(한진택배 후속 업무)를 순서대로 보여주는 화면 (2026-08-19 5차 실사용 테스트
 * 신규, 6차 실사용 테스트에서 1·3단계 파일 분리 반영).
 *
 * 6차 실사용 테스트에서 확인된 문제: 1단계(한진택배 송장출력용 업로드파일)와 3단계(Supplier
 * Hub 쉽먼트 생성 업로드파일)가 둘 다 HanjinUploadSection을 재사용해서 실제로는 "로켓입고*발주번호"
 * 행만 있는 같은 한진 서식 파일을 두 번 만들고 있었다 — 3단계 파일에 송장번호가 전혀 들어가지
 * 않는 잘못된 구조였다. 이제 3단계는 완전히 다른 컴포넌트(HanjinShipmentUploadSection)로
 * 분리했고, 2단계에서 업로드한 원본의 실제 행 데이터(발주번호/물류센터/SKU/송장번호 등)를 이어받아
 * 그 안에서 송장번호가 실제로 채워진 행만 새 파일로 만든다 — 1단계 파일과 템플릿·컬럼·용도가
 * 완전히 다르고, 매칭 실패 행은 포함하지 않는다. 2단계 업로드가 없으면 3단계 버튼 자체가
 * 비활성화된다(lib/wms/hanjin-upload.ts의 buildShipmentCreationUploadFile 참고).
 *
 * 5단계(바코드/라벨/거래명세서 출력)는 실제 샘플 파일을 확인한 결과 한진택배 자체 시스템에서
 * 내려받는 결과물(예: "재출력_세부내역_*.xlsx")이라, 이 앱이 생성하는 것이 아니다 — 그래서
 * 생성 버튼을 만들지 않고, "미구현" 상태를 안내 문구와 함께 명확히 표시한다(실제 쉽먼트 결과
 * 파일 샘플을 받으면 구현 가능 — 임의로 바코드/라벨 생성기를 만들지 않음).
 */
export default function HanjinStepSequence({ waveId, baskets }: Props) {
  const [step1Done, setStep1Done] = useState(false);
  const [trackingMatch, setTrackingMatch] = useState<{ matched: number; total: number; fileBase64: string } | null>(null);
  const [step4Loaded, setStep4Loaded] = useState(false);

  const step2Success = trackingMatch !== null && trackingMatch.matched > 0;

  const step1Status: StepStatus = step1Done ? "done" : "current";
  const step2Status: StepStatus = step2Success ? "done" : step1Done ? "current" : "locked";
  const step3Status: StepStatus = step2Success ? "current" : "locked";
  const step4Status: StepStatus = step4Loaded ? "done" : "current";

  const currentStepLabel = !step1Done
    ? "1단계 진행 중"
    : !step2Success
      ? "2단계 진행 중"
      : "3~4단계 진행 가능";

  return (
    <div style={{ marginTop: "20px" }}>
      <div style={{ background: wmsColors.surfaceBeige, border: `1px solid ${wmsColors.borderStrong}`, borderRadius: "10px", padding: "10px 12px", marginBottom: "14px" }}>
        <div style={{ fontSize: "11px", color: wmsColors.muted, marginBottom: "2px" }}>한진택배 후속 업무 — 현재 단계</div>
        <div style={{ fontSize: "13px", fontWeight: 800, color: wmsColors.ink }}>{currentStepLabel}</div>
      </div>

      <StepCard step={1} title="송장출력용 업로드파일 생성" subtitle="한진택배 업로드용 — 로켓입고 요청" status={step1Status}>
        <HanjinUploadSection baskets={baskets} onGenerated={() => setStep1Done(true)} />
      </StepCard>

      <StepCard step={2} title="운송장번호 입력 파일 불러오기" subtitle="한진택배가 송장번호를 채워 돌려준 결과" status={step2Status} lockedReason="1단계에서 업로드파일을 먼저 생성해주세요.">
        <HanjinTrackingMatchSection
          baskets={baskets}
          onMatchResult={(matched, total, fileBase64) => setTrackingMatch({ matched, total, fileBase64 })}
        />
      </StepCard>

      <StepCard
        step={3}
        title="쉽먼트 생성 업로드파일 생성"
        subtitle="Supplier Hub 업로드용 — 실제 송장번호 포함, 1단계와 다른 파일"
        status={step3Status}
        lockedReason="2단계에서 운송장번호가 정상 매칭되어야 활성화됩니다."
      >
        <HanjinShipmentUploadSection waveId={waveId} baskets={baskets} trackingFileBase64={trackingMatch?.fileBase64 ?? null} />
      </StepCard>

      <StepCard step={4} title="쉽먼트 결과 파일 불러오기" subtitle="Supplier Hub 처리 후 쉽먼트번호가 들어간 파일 확인" status={step4Status}>
        <HanjinShipmentResultUploadSection onLoaded={() => setStep4Loaded(true)} />
      </StepCard>

      <StepCard step={5} title="출력 (쉽먼트 바코드 · 라벨 · 거래명세서)" status="not_implemented">
        <p style={{ fontSize: "12px", color: wmsColors.ink, lineHeight: 1.6, margin: 0 }}>
          <strong>아직 구현되지 않았습니다.</strong> 쉽먼트 바코드·라벨·거래명세서는 한진택배 자체
          시스템(웹 포털)에서 직접 출력하는 결과물이라, 이 화면이 대신 만들 수 없습니다. 4단계에서
          불러온 쉽먼트 결과 파일의 실제 샘플(쉽먼트번호가 포함된 파일)을 받으면, 그 구조에 맞춰
          바코드·라벨·거래명세서 출력 기능을 추가로 구현할 수 있습니다.
        </p>
      </StepCard>
    </div>
  );
}

function StepCard({
  step,
  title,
  subtitle,
  status,
  lockedReason,
  children,
}: {
  step: number;
  title: string;
  subtitle?: string;
  status: StepStatus;
  lockedReason?: string;
  children: React.ReactNode;
}) {
  const badge =
    status === "done"
      ? { label: "완료", bg: wmsColors.greenSoft, color: wmsColors.greenDark }
      : status === "current"
        ? { label: "진행 가능", bg: "rgba(83,109,120,0.12)", color: wmsColors.slateDark }
        : status === "not_implemented"
          ? { label: "미구현", bg: wmsColors.bronzeSoft, color: wmsColors.bronze }
          : { label: "대기", bg: wmsColors.surfaceBeige, color: wmsColors.muted };

  return (
    <div style={{ border: `1px solid ${wmsColors.border}`, borderRadius: "10px", padding: "12px", marginBottom: "10px", opacity: status === "locked" ? 0.75 : 1 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: subtitle ? "2px" : "8px" }}>
        <h3 style={{ margin: 0, fontSize: "14px" }}>
          {step}. {title}
        </h3>
        <span style={{ fontSize: "10px", fontWeight: 700, padding: "3px 8px", borderRadius: "999px", background: badge.bg, color: badge.color, flexShrink: 0 }}>
          {badge.label}
        </span>
      </div>
      {subtitle && <p style={{ fontSize: "10px", color: wmsColors.muted, margin: "0 0 8px" }}>{subtitle}</p>}
      {status === "locked" && (
        <p style={{ fontSize: "11px", color: wmsColors.muted, margin: "0 0 8px" }}>
          {lockedReason || "이전 단계를 먼저 완료해주세요."}
        </p>
      )}
      {children}
    </div>
  );
}
