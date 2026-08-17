"use client";

import type { ReactNode } from "react";
import { WarehouseRepositoryProvider } from "@/lib/warehouse/context";

/**
 * /wms/warehouse/* 전용 레이아웃. 창고 설정/위치 등록 화면들이 공유하는
 * WarehouseRepository를 제공한다. 기존 /wms/layout.tsx(피킹 흐름 컨텍스트)와는
 * 별개이며, 이 레이아웃은 그 안쪽에서 한 번 더 감싸는 형태로 동작한다.
 */
export default function WarehouseLayout({ children }: { children: ReactNode }) {
  return <WarehouseRepositoryProvider>{children}</WarehouseRepositoryProvider>;
}
