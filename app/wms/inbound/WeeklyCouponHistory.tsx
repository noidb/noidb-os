"use client";

import { useState } from "react";
import styles from "./weekly-work.module.css";

type Block = { skuId: string; expiresOn?: string; reason: string };
export default function WeeklyCouponHistory({ disabled, onSaved }: { disabled: boolean; onSaved: () => void }) {
  const [revision, setRevision] = useState<number>();
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [rows, setRows] = useState("");
  const [source, setSource] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  async function refresh() {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/wms/weekly-work", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || "쿠폰 이력을 불러오지 못했습니다.");
      setRevision(data.revision); setBlocks(data.couponBlocks || []);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "쿠폰 이력 조회 실패"); }
    finally { setBusy(false); }
  }
  async function save() {
    setBusy(true); setError(""); setMessage("");
    try {
      const parsed = rows.trim().split(/\r?\n/).filter(row => row.trim()).map(row => {
        const values = row.trim().split(/[\t, ]+/);
        if (values.length !== 2) throw new Error("한 줄에 SKU와 종료일 두 값만 입력해 주세요.");
        return { skuId: values[0], expiresOn: values[1] };
      });
      const response = await fetch("/api/wms/weekly-work", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "coupon-history", expectedRevision: revision, rows: parsed, source }) });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || "쿠폰 이력을 저장하지 못했습니다.");
      setRevision(data.revision); setBlocks(data.couponBlocks || []); setRows("");
      setMessage(`${data.count}개 SKU의 종료일을 저장했습니다. 이 기간 업무를 다시 준비하면 반영됩니다.`);
      onSaved();
    } catch (failure) { setError(failure instanceof Error ? failure.message : "쿠폰 이력 저장 실패"); }
    finally { setBusy(false); }
  }
  return <details className={styles.panel} onToggle={event => { if (event.currentTarget.open && revision === undefined && !busy) void refresh(); }}>
    <summary><strong>기존 쿠폰 중복 관리</strong></summary>
    <p className={styles.help}>쿠팡에 등록된 쿠폰의 마지막 종료일을 저장하면 같은 SKU가 다시 입고돼도 종료일 당일까지 제외합니다. 예약된 쿠폰도 포함합니다. 종료일이 없는 과거 완료 기록은 확인 전까지 제외합니다.</p>
    <button type="button" className={styles.secondary} disabled={disabled || busy} onClick={() => void refresh()}>쿠폰 현황 다시 불러오기</button>
    <label className={styles.field}><span>확인 자료 · 쿠팡 프로모션 주소 또는 파일명</span><input value={source} onChange={event => setSource(event.target.value)} disabled={disabled || busy} placeholder="쿠팡 프로모션 주소" /></label>
    <label className={styles.field}><span>SKU와 마지막 종료일 · 엑셀 두 열 붙여넣기</span><textarea rows={5} value={rows} onChange={event => setRows(event.target.value)} disabled={disabled || busy} placeholder={"12345678\t2026-09-20"} /></label>
    <p className={styles.help}>같은 SKU에 여러 쿠폰이 있으면 가장 늦은 종료일을 입력하세요. 실제 쿠팡 화면에서 확인한 날짜만 저장하며, 쿠팡의 쿠폰을 생성하거나 종료하지 않습니다.</p>
    <button type="button" className={styles.secondary} disabled={disabled || busy || revision === undefined || !rows.trim() || !source.trim()} onClick={() => void save()}>확인한 쿠폰 종료일 저장</button>
    {message ? <p role="status">{message}</p> : null}{error ? <p role="alert">{error}</p> : null}
    {revision !== undefined ? <details><summary>자동 제외 SKU 확인 ({blocks.length}개)</summary><ul>{blocks.map(item => <li key={item.skuId}>SKU {item.skuId} · {item.reason}</li>)}</ul></details> : null}
  </details>;
}
