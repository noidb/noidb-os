"use client";

import type { ReactNode } from "react";
import { WmsPickingFlowProvider } from "@/lib/wms/picking-flow-context";
import { WarehouseRepositoryProvider } from "@/lib/warehouse/context";
import { PickingWaveRepositoryProvider } from "@/lib/wms/picking-wave/context";
import { VendorOrderRepositoryProvider } from "@/lib/wms/vendor-order/context";
import WmsHomeHeader from "./WmsHomeHeader";
import { WmsUndoProvider } from "@/lib/wms/undo-context";
import { ShipmentRepositoryProvider } from "@/lib/wms/shipment/context";

/**
 * /wms/* 전용 레이아웃. 기존 app/layout.tsx(루트)는 건드리지 않는다.
 * 작업센터 → 피킹 → 거래처발주 화면 사이에서 피킹 진행 상태를 공유하기 위해
 * 컨텍스트 프로바이더만 감싼다.
 *
 * 2026-08-19 확장: 웨이브/거래처 발주서 저장소 프로바이더를 여기로 올렸다 — 작업센터 첫 화면에서도
 * "부족분 거래처별 발주서 N건", "발주 변경 확인 필요 N건" 배너를 보여주려면 /wms/picking/waves
 * 하위가 아닌 곳에서도 같은 저장소에 접근해야 하기 때문이다(기존 lib/wms/picking-wave,
 * lib/wms/vendor-order 저장소를 그대로 재사용 — 새로 만들지 않음). app/wms/picking/waves/layout.tsx
 * 는 그대로 두었다(중첩 프로바이더라 안전하지만, 그 라우트에서는 사실상 중복이다).
 */
export default function WmsLayout({ children }: { children: ReactNode }) {
  return (
    <WmsPickingFlowProvider>
      <WarehouseRepositoryProvider>
        <PickingWaveRepositoryProvider>
          <ShipmentRepositoryProvider>
            <VendorOrderRepositoryProvider>
              <WmsUndoProvider>
                <WmsHomeHeader />
                <div className="wms-rounded-page-shell">{children}</div>
              </WmsUndoProvider>
            <style jsx global>{`
              .wms-rounded-page-shell main {
                width: 100% !important;
                max-width: none !important;
                margin-left: 0 !important;
                margin-right: 0 !important;
                box-sizing: border-box;
                border: 1px solid #ddd7cd;
                border-radius: 18px;
                overflow: hidden;
                box-shadow: 0 4px 16px rgba(30, 28, 25, 0.045);
              }
              .wms-rounded-page-shell {
                width: 100%;
                max-width: 1120px;
                margin: 0 auto;
                box-sizing: border-box;
              }
              @media (min-width: 761px) {
                .wms-rounded-page-shell {
                  padding: 0 24px 32px;
                }
                .wms-rounded-page-shell main {
                  min-height: 0 !important;
                  height: auto !important;
                }
              }
              @media (max-width: 760px) {
                .wms-rounded-page-shell {
                  padding: 0;
                  overflow-x: clip;
                }
              }
            `}</style>
            </VendorOrderRepositoryProvider>
          </ShipmentRepositoryProvider>
        </PickingWaveRepositoryProvider>
      </WarehouseRepositoryProvider>
    </WmsPickingFlowProvider>
  );
}
