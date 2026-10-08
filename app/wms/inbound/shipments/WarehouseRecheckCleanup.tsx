"use client";

import { useState } from "react";
import styles from "./shipments.module.css";

type Move = { rowNumber: number; skuId: string; productName: string; result: string; orderableStatus: string; target: "보관" | "제품DB"; mode: "append" | "clear-status"; release: boolean };
type Preview = { token: string; pending: number; moves: Move[]; unknown: Array<{ rowNumber: number; skuId: string; productName: string; result: string }>; problems: string[] };

/** 창고재확인 탭 정리: 미리보기로 옮길 행을 확인한 뒤 실행해야 시트가 바뀐다. */
export default function WarehouseRecheckCleanup({ onDone }: { onDone: (message: string, isError?: boolean) => void }) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState("");

  async function load() {
    setBusy("preview");
    try {
      const response = await fetch("/api/wms/warehouse-recheck-cleanup", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "창고재확인 탭을 읽지 못했습니다.");
      setPreview(data);
    } catch (cause) { onDone(cause instanceof Error ? cause.message : "창고재확인 탭을 읽지 못했습니다.", true); }
    finally { setBusy(""); }
  }
  async function run() {
    if (!preview) return;
    if (!window.confirm(`창고재확인 ${preview.moves.length}행을 옮기고 창고재확인 탭에서 지울까요? (옮기기 전에 탭 백업을 남깁니다)`)) return;
    setBusy("run");
    try {
      const response = await fetch("/api/wms/warehouse-recheck-cleanup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: preview.token }) });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "정리하지 못했습니다.");
      setPreview(null);
      onDone(`창고재확인 정리 완료: 보관 ${data.toStorage}건 · 제품DB ${data.toProductDb}건${data.release ? ` · 단종해제 대상 ${data.release}건 추가` : ""}. 새로고침하면 단종해제 목록에 반영돼요.`);
    } catch (cause) { onDone(cause instanceof Error ? cause.message : "정리하지 못했습니다.", true); }
    finally { setBusy(""); }
  }

  return (
    <section>
      <h2 className={styles.listTitle}>창고재확인 정리</h2>
      <p className={styles.meta}>창고 확인결과가 적힌 행만 옮겨요. 거래처단종 → 보관 탭, 제품DB로 이동(재고있음) → 제품DB(현재상태 비움, 발주가능상태가 정상이 아니면 단종해제 대상). 확인결과가 빈 행은 그대로 둬요.</p>
      {!preview ? (
        <button type="button" className={`softSageButton ${styles.fullButton}`} disabled={Boolean(busy)} onClick={() => void load()}>
          {busy === "preview" ? "읽는 중…" : "창고재확인 미리보기"}
        </button>
      ) : (
        <>
          {preview.problems.length > 0 && <p className={`${styles.notice} ${styles.error}`}>{preview.problems.join(" ")}</p>}
          <p className={styles.meta}>
            옮길 행 {preview.moves.length}건 (보관 {preview.moves.filter((m) => m.target === "보관").length} · 제품DB {preview.moves.filter((m) => m.target === "제품DB").length}
            {preview.moves.some((m) => m.release) ? ` · 그중 단종해제 대상 ${preview.moves.filter((m) => m.release).length}` : ""}) · 확인 중(공란) {preview.pending}건
            {preview.unknown.length ? ` · 기준 없는 결과 ${preview.unknown.length}건(그대로 둠)` : ""}
          </p>
          {preview.moves.length > 0 && (
            <div className={`${styles.tableWrap} ${styles.copyScroll}`}>
              <table className={`${styles.table} ${styles.copyTable}`} aria-label="옮길 행">
                <thead><tr><th>SKU ID</th><th>상품명</th><th>확인결과</th><th>옮길 곳</th><th>발주가능상태</th></tr></thead>
                <tbody>
                  {preview.moves.map((move) => (
                    <tr key={move.rowNumber}>
                      <td>{move.skuId}</td>
                      <td>{move.productName}</td>
                      <td>{move.result}</td>
                      <td>{move.target}{move.mode === "clear-status" ? " (이미 있음 · 현재상태만 비움)" : ""}</td>
                      <td className={move.release ? styles.statusCell : undefined}>{move.orderableStatus}{move.release ? " → 단종해제" : ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {preview.unknown.length > 0 && (
            <p className={styles.meta}>기준 없는 결과(그대로 둠): {preview.unknown.map((u) => `${u.skuId} '${u.result}'`).join(", ")}</p>
          )}
          <div className={styles.pairButtons}>
            <button type="button" className={`softApricotButton ${styles.fullButton}`} disabled={Boolean(busy)} onClick={() => setPreview(null)}>닫기</button>
            <button type="button" className={`softPinkButton ${styles.fullButton}`} disabled={Boolean(busy) || !preview.moves.length || preview.problems.length > 0} onClick={() => void run()}>
              {busy === "run" ? "옮기는 중…" : `정리 실행 (${preview.moves.length}건)`}
            </button>
          </div>
        </>
      )}
    </section>
  );
}
