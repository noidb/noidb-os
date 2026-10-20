"use client";

import type { VendorOrderDraftLine, VendorOrderDraftStatus } from "@/lib/wms/vendor-order/types";
import type { PickingWave } from "@/lib/wms/picking-wave/types";
import { wmsColors, wmsGreenDarkButton } from "@/lib/wms/ui-tokens";

interface Props {
  wave: PickingWave;
  vendorName: string;
  lines: VendorOrderDraftLine[];
  status: VendorOrderDraftStatus;
  productLinksBySku?: Record<string, string>;
  readOnly: boolean;
  busy: boolean;
  statusSaving: boolean;
  onBeforeExport: () => Promise<VendorOrderDraftLine[]>;
  onMarkSent: () => void | Promise<void>;
  orderDate: string;
}

/** 카톡으로 보낸 뒤 발주중(전송완료)을 기록한다. */
export default function VendorOrderExportPanel({ status, readOnly, busy, statusSaving, onMarkSent }: Props) {
  if (status === "sent") return null;
  // 2026-10-20 사용자 요청: 카드를 화면에서 바로 복사해 카톡으로 보내므로 '카카오톡용 이미지 저장'은 뺐다.
  // 보낸 뒤에는 이 버튼으로 발주중(결과처리 버튼이 보이는 상태)으로 넘긴다.
  return (
    <div style={{ marginTop: "12px", paddingTop: "12px", borderTop: `1px dashed ${wmsColors.border}` }}>
      <button
        onClick={() => { if (!readOnly) void onMarkSent(); }}
        disabled={readOnly || busy || statusSaving}
        style={{ ...wmsGreenDarkButton, width: "100%", minHeight: "48px", fontSize: "13px", padding: "0 6px", borderRadius: "8px", whiteSpace: "normal", lineHeight: 1.25, opacity: readOnly || busy || statusSaving ? 0.65 : 1 }}
      >
        카톡으로 보냈어요 · 발주중으로 넘기기
      </button>
    </div>
  );
}
