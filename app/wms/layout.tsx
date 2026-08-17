"use client";

import type { ReactNode } from "react";
import { WmsPickingFlowProvider } from "@/lib/wms/picking-flow-context";

/**
 * /wms/* 전용 레이아웃. 기존 app/layout.tsx(루트)는 건드리지 않는다.
 * 작업센터 → 피킹 → 거래처발주 화면 사이에서 피킹 진행 상태를 공유하기 위해
 * 컨텍스트 프로바이더만 감싼다.
 */
export default function WmsLayout({ children }: { children: ReactNode }) {
  return <WmsPickingFlowProvider>{children}</WmsPickingFlowProvider>;
}
