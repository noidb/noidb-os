"use client";
import { useEffect, useState } from "react";
import VendorOrderEditor from "./VendorOrderEditor";

/** Existing bookmarks open the common queue; sent history remains addressable. */
export default function VendorOrdersPage({ params }: { params: { waveId: string } }) {
  const [history, setHistory] = useState(false);
  const [draftId, setDraftId] = useState<string | undefined>();
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("history") === "1") { setDraftId(new URLSearchParams(window.location.search).get("draftId") || undefined); setHistory(true); }
    else window.location.replace("/wms/vendor-orders/manage");
  }, []);
  return history ? <VendorOrderEditor params={params} historyView historyDraftId={draftId} /> : <p>거래처 발주관리로 이동 중…</p>;
}
