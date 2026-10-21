"use client";

import { useEffect, useState } from "react";
import { wmsColors } from "@/lib/wms/ui-tokens";

type Candidate = { skuId: string; productName: string; barcode: string; orderableStatus: string; score: number };

/**
 * 반려 카드의 '쿠팡에 남아 있는 예전 SKU 후보'(2026-10-21 사용자 요청).
 * 재등록이 '기존 상품과 중복'으로 반려되면 예전 SKU를 먼저 단종해야 하는데, 제품DB·보관 탭에 없는 SKU도 있어 찾기 어려웠다.
 * '_SKU마스터'(쿠팡 전체 SKU)에서 상품명이 비슷한 SKU를 찾아 보여 주고, 고른 것을 '단종 신청 목록'에 바로 넣는다.
 */
export default function LegacySkuCandidates({ names }: { names: string[] }) {
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [error, setError] = useState("");
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const key = [...new Set(names.map(name => name.trim()).filter(Boolean))].sort().join("\n");

  useEffect(() => {
    let active = true;
    if (!key) { setCandidates([]); return; }
    // 2026-10-21: 화면을 열 때마다 _SKU마스터 전체에서 다시 찾지 않도록, 같은 상품명으로 찾은 결과는 하루 동안 이 브라우저에 기억해 바로 보여 준다.
    const memoryKey = `noidb-legacy-sku:${key}`;
    try {
      const remembered = JSON.parse(window.localStorage.getItem(memoryKey) || "null") as { at: number; list: Candidate[] } | null;
      if (remembered && Date.now() - remembered.at < 24 * 60 * 60 * 1000) {
        setCandidates(remembered.list);
        setPicked(Object.fromEntries(remembered.list.map(item => [item.skuId, true])));
        return;
      }
    } catch { /* 기억 없음 */ }
    void fetch("/api/wms/legacy-sku-candidates", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ names: key.split("\n") }) })
      .then(response => response.json())
      .then((data: { ok?: boolean; candidates?: Candidate[]; error?: string }) => {
        if (!active) return;
        if (!data.ok) throw new Error(data.error || "예전 SKU를 찾지 못했습니다.");
        const list = data.candidates || [];
        setCandidates(list);
        try { window.localStorage.setItem(memoryKey, JSON.stringify({ at: Date.now(), list })); } catch { /* 저장 못 해도 동작 */ }
        setPicked(Object.fromEntries(list.map(item => [item.skuId, true])));
      })
      .catch(cause => { if (active) setError(cause instanceof Error ? cause.message : "예전 SKU를 찾지 못했습니다."); });
    return () => { active = false; };
  }, [key]);

  async function addToDiscontinueList() {
    const chosen = (candidates || []).filter(item => picked[item.skuId]);
    if (!chosen.length || busy) return;
    setBusy(true);
    setMessage("");
    setError("");
    try {
      const current = await fetch("/api/wms/logistics/discontinue-code-draft", { cache: "no-store" }).then(response => response.json());
      if (!current.ok) throw new Error("단종 신청 목록을 읽지 못했습니다. 잠시 뒤 다시 눌러 주세요.");
      const lines = String(current.text || "").split(/\r?\n/).map((line: string) => line.trim()).filter(Boolean);
      const have = new Set(lines.map((line: string) => line.toUpperCase()));
      const codes = chosen.filter(item => !(item.barcode && have.has(item.barcode.toUpperCase())) && !have.has(item.skuId)).map(item => item.barcode || item.skuId);
      if (!codes.length) { setMessage("고른 SKU는 이미 단종 신청 목록에 있습니다."); return; }
      const saved = await fetch("/api/wms/logistics/discontinue-code-draft", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: [...lines, ...codes].join("\n") }) }).then(response => response.json());
      if (!saved.ok) throw new Error("단종 신청 목록에 넣지 못했습니다.");
      setMessage(`${codes.length}개를 단종 신청 목록에 넣었습니다. '거래처발주·단종관리'에서 단종신청 엑셀·공문을 만들어 주세요.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "단종 신청 목록에 넣지 못했습니다.");
    } finally { setBusy(false); }
  }

  if (error && !candidates) return <p style={{ margin: "8px 0 0", fontSize: 12, color: wmsColors.warnText }}>예전 SKU 찾기: {error}</p>;
  if (!candidates) return <p style={{ margin: "8px 0 0", fontSize: 12, color: wmsColors.muted }}>쿠팡에 남아 있는 예전 SKU를 찾는 중…</p>;
  if (!candidates.length) return <p style={{ margin: "8px 0 0", fontSize: 12, color: wmsColors.muted }}>쿠팡 SKU 목록(_SKU마스터)에서 이름이 비슷한 예전 SKU를 찾지 못했습니다.</p>;
  const count = candidates.filter(item => picked[item.skuId]).length;
  return (
    <div style={{ marginTop: 10, border: `1px solid ${wmsColors.warnSoftBorder}`, borderRadius: 10, background: "#fff", padding: 10 }}>
      <strong style={{ display: "block", fontSize: 13, color: wmsColors.ink }}>쿠팡에 남아 있는 예전 SKU 후보 {candidates.length}개 — '기존 상품과 중복' 반려면 이 SKU를 먼저 단종 신청하세요</strong>
      <span style={{ display: "block", fontSize: 11, color: wmsColors.muted, margin: "2px 0 6px" }}>쿠팡 SKU 목록(_SKU마스터)에서 상품명이 비슷한 것입니다. 다른 상품이면 체크를 빼 주세요.</span>
      <div style={{ display: "grid", gap: 4 }}>
        {candidates.map(item => (
          <label key={item.skuId} style={{ display: "grid", gridTemplateColumns: "20px 90px 130px minmax(0, 1fr) 70px", gap: 8, alignItems: "center", fontSize: 12 }}>
            <input type="checkbox" checked={Boolean(picked[item.skuId])} onChange={event => setPicked(current => ({ ...current, [item.skuId]: event.target.checked }))} />
            <span style={{ fontWeight: 800 }}>{item.skuId}</span>
            <span>{item.barcode || "바코드 없음"}</span>
            <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={item.productName}>{item.productName}</span>
            <span style={{ color: item.orderableStatus === "정상" ? wmsColors.greenDark : wmsColors.warnText, fontWeight: 700 }}>{item.orderableStatus || "-"}</span>
          </label>
        ))}
      </div>
      <button type="button" className="softBeigeButton" style={{ width: "100%", marginTop: 8 }} disabled={busy || !count} onClick={() => void addToDiscontinueList()}>
        {busy ? "넣는 중…" : `고른 ${count}개 단종 신청 목록에 넣기`}
      </button>
      {message && <p style={{ margin: "6px 0 0", fontSize: 12, color: wmsColors.greenDark }}>{message}</p>}
      {error && <p style={{ margin: "6px 0 0", fontSize: 12, color: wmsColors.warnText }}>{error}</p>}
    </div>
  );
}
