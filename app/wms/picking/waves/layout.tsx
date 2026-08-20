"use client";

import type { ReactNode } from "react";

/**
 * /wms/picking/waves/* 전용 레이아웃.
 *
 * 2026-08-19: WarehouseRepositoryProvider/PickingWaveRepositoryProvider/VendorOrderRepositoryProvider는
 * 상위 app/wms/layout.tsx로 이동했다(작업센터 첫 화면 배너에서도 같은 저장소가 필요해졌기 때문).
 * 저장소 클래스(Local*Repository)는 상태를 메모리에 캐시하지 않고 매 호출마다 localStorage를
 * 직접 읽고 쓰는 완전한 stateless 래퍼라 중첩 자체는 안전했지만, 상위에서 이미 제공하므로 여기서
 * 다시 감싸는 것은 불필요한 중복이라 제거했다. 데이터 접근 방식은 동일하게 유지된다.
 */
export default function PickingWavesLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
