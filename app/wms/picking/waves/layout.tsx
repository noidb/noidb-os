"use client";

import type { ReactNode } from "react";
import { WarehouseRepositoryProvider } from "@/lib/warehouse/context";
import { PickingWaveRepositoryProvider } from "@/lib/wms/picking-wave/context";

/**
 * /wms/picking/waves/* 전용 레이아웃. 통합 피킹 화면이 창고 위치 데이터(WarehouseRepository)와
 * 웨이브 저장소(PickingWaveRepository)를 함께 쓰므로 여기서 감싼다. 기존 /wms/layout.tsx(피킹 흐름
 * 컨텍스트), /wms/picking/page.tsx(샘플 피킹)는 건드리지 않는다 — 이 레이아웃은 그 안쪽에서 한 번 더
 * 감싸는 형태로 동작한다.
 */
export default function PickingWavesLayout({ children }: { children: ReactNode }) {
  return (
    <WarehouseRepositoryProvider>
      <PickingWaveRepositoryProvider>{children}</PickingWaveRepositoryProvider>
    </WarehouseRepositoryProvider>
  );
}
