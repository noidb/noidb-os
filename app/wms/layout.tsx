"use client";

import type { ReactNode } from "react";
import { WmsPickingFlowProvider } from "@/lib/wms/picking-flow-context";
import { WarehouseRepositoryProvider } from "@/lib/warehouse/context";
import { PickingWaveRepositoryProvider } from "@/lib/wms/picking-wave/context";
import { VendorOrderRepositoryProvider } from "@/lib/wms/vendor-order/context";
import WmsHomeHeader from "./WmsHomeHeader";
import { WmsUndoProvider } from "@/lib/wms/undo-context";
import { ShipmentRepositoryProvider } from "@/lib/wms/shipment/context";
import { InvoiceGroupRepositoryProvider } from "@/lib/wms/invoice-group/context";

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
 *
 * 2026-09-18 추가: InvoiceGroupRepositoryProvider — 발주확정~출력세트 파이프라인 전용 저장소.
 * 웨이브 시스템과 완전히 독립된 저장소라 다른 Provider에 의존하지 않는다(어느 위치에 둬도 무방).
 *
 * 2026-09-18 수정: .wms-rounded-page-shell 스타일을 <style jsx global>에서 app/globals.css로
 * 옮겼다 — 이 레이아웃이 "use client"라서 styled-jsx 스타일이 SSR HTML에 바로 포함되지 않고
 * 하이드레이션 이후에야 주입돼, 새로고침할 때마다 좁은 기본 레이아웃이 잠깐 보였다가 넓은
 * 레이아웃으로 바뀌는 깜빡임이 있었다. globals.css는 <head>에서 렌더 전에 로드되는 일반
 * 스타일시트라 이 문제가 없다(이미 .wms-work-center-menu 등 다른 /wms 전용 클래스들도
 * globals.css에 있다 — 이번에 그 관례를 따랐을 뿐).
 */
export default function WmsLayout({ children }: { children: ReactNode }) {
  return (
    <WmsPickingFlowProvider>
      <WarehouseRepositoryProvider>
        <PickingWaveRepositoryProvider>
          <ShipmentRepositoryProvider>
            <VendorOrderRepositoryProvider>
              <InvoiceGroupRepositoryProvider>
                <WmsUndoProvider>
                  <WmsHomeHeader />
                  <div className="wms-rounded-page-shell">{children}</div>
                </WmsUndoProvider>
              </InvoiceGroupRepositoryProvider>
            </VendorOrderRepositoryProvider>
          </ShipmentRepositoryProvider>
        </PickingWaveRepositoryProvider>
      </WarehouseRepositoryProvider>
    </WmsPickingFlowProvider>
  );
}
