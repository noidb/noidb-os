"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./shipments.module.css";

type Move = { source: "창고재확인" | "보관" | "제품DB" | "재등록SKU"; rowNumber: number; skuId: string; productName: string; result: string; orderableStatus: string; target: "보관" | "제품DB" | "재등록SKU"; mode: "append" | "clear-status" | "delete-only" | "fill"; release: boolean; pair?: string };
type Preview = { token: string; pending: number; moves: Move[]; unknown: Array<{ rowNumber: number; skuId: string; productName: string; result: string }>; problems: string[] };

/** 창고재확인 탭 정리: 미리보기로 옮길 행을 확인한 뒤 실행해야 시트가 바뀐다. */
export default function WarehouseRecheckCleanup({ onDone, embedded = false, autoLoad = false, onClose }: {
  onDone: (message: string, isError?: boolean) => void;
  /** 작업센터 '자주 하는 일'(2026-10-21): 제목·설명·미리보기 버튼 없이 정리할 행 목록만 */
  embedded?: boolean;
  /** 화면에 나오자마자 정리할 행을 읽는다 */
  autoLoad?: boolean;
  /** '닫기'를 눌렀을 때(바깥에서 칸을 접기) */
  onClose?: () => void;
}) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState("");
  const autoLoaded = useRef(false);
  useEffect(() => {
    if (!autoLoad || autoLoaded.current) return;
    autoLoaded.current = true;
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoLoad]);

  async function load() {
    setBusy("preview");
    try {
      const response = await fetch("/api/wms/warehouse-recheck-cleanup", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "구글시트를 읽지 못했습니다.");
      setPreview(data);
    } catch (cause) { onDone(cause instanceof Error ? cause.message : "구글시트를 읽지 못했습니다.", true); }
    finally { setBusy(""); }
  }
  async function run() {
    if (!preview) return;
    if (!window.confirm(`${preview.moves.length}행을 옮기고 원래 탭(비관리SKU·제품DB)에서 지울까요? (옮기기 전에 탭 백업을 남깁니다)`)) return;
    setBusy("run");
    try {
      const response = await fetch("/api/wms/warehouse-recheck-cleanup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: preview.token }) });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "정리하지 못했습니다.");
      setPreview(null);
      if (data.reregRebuilt) { onDone(`재등록SKU 탭을 제품DB와 같은 열로 맞췄어요(${data.reregRebuilt}줄 · 제품DB/비관리SKU 정보로 채운 줄 ${data.reregFilled}줄). 정리행 미리보기를 한 번 더 눌러 나머지를 정리해 주세요.`); return; }
      onDone(`정리 완료: 비관리SKU로 ${data.toStorage}건(제품DB에서 ${data.fromProductDb}건) · 제품DB로 ${data.toProductDb}건(비관리SKU 탭에서 ${data.fromStorage}건)${data.toRereg ? ` · 재등록SKU 탭에 ${data.toRereg}건 추가` : ""}${data.release ? ` · 단종해제 대상 ${data.release}건 추가` : ""}. 새로고침하면 단종해제 목록에 반영돼요.`);
    } catch (cause) { onDone(cause instanceof Error ? cause.message : "정리하지 못했습니다.", true); }
    finally { setBusy(""); }
  }

  return (
    <section>
      {!embedded && <h2 className={styles.listTitle}>구글시트 정리</h2>}
      {!embedded && <p className={styles.meta}>제품DB: 현재상태에 '단종'이 들어간 행(거래처단종·단종(중복등록) 등)·비관리(중복등록) → 비관리SKU(적어 둔 이유도 함께). 현재상태에 '재등록'이 들어간 행·재등록SKU 탭에 있는 SKU → 재등록SKU 탭. 보관: 현재상태에 '재고있음'이 들어간 행 → 제품DB(현재상태 비움, 발주가능상태가 정상이 아니면 단종해제 대상). 단, 판매중지·실적저조·교체된 옛 SKU는 재고있음이어도 제품DB로 가지 않고 재등록SKU로.</p>}
      {!preview ? (
        embedded ? <p className={styles.meta}>{busy === "preview" ? "정리할 행 읽는 중…" : "정리할 행을 읽지 못했습니다. 다시 눌러 주세요."}</p> : (
        <button type="button" className={`softSageButton ${styles.fullButton}`} disabled={Boolean(busy)} onClick={() => void load()}>
          {busy === "preview" ? "읽는 중…" : "정리할 행 미리보기"}
        </button>
        )
      ) : (
        <>
          {preview.problems.length > 0 && <p className={`${styles.notice} ${styles.error}`}>{preview.problems.join(" ")}</p>}
          <p className={styles.meta}>
            옮길 행 {preview.moves.length}건 (비관리SKU {preview.moves.filter((m) => m.target === "보관").length} · 제품DB {preview.moves.filter((m) => m.target === "제품DB").length}{preview.moves.some((m) => m.target === "재등록SKU") ? ` · 재등록SKU ${preview.moves.filter((m) => m.target === "재등록SKU").length}` : ""}
            {preview.moves.some((m) => m.release) ? ` · 그중 단종해제 대상 ${preview.moves.filter((m) => m.release).length}` : ""}) · 확인 중(공란) {preview.pending}건
            {preview.unknown.length ? ` · 기준 없는 결과 ${preview.unknown.length}건(그대로 둠)` : ""}
          </p>
          {preview.moves.length > 0 && (
            <div className={`${styles.tableWrap} ${styles.copyScroll}`}>
              <table className={`${styles.table} ${styles.copyTable}`} aria-label="옮길 행">
                <thead><tr><th>있던 탭</th><th>SKU ID</th><th>상품명</th><th>확인결과</th><th>옮길 곳</th><th>발주가능상태</th></tr></thead>
                <tbody>
                  {preview.moves.map((move) => (
                    <tr key={`${move.source}:${move.rowNumber}`}>
                      <td>{move.source === "보관" ? "비관리SKU" : move.source}</td>
                      <td>{move.skuId}</td>
                      <td>{move.productName}</td>
                      <td>{move.result}</td>
                      <td>{move.target === "보관" ? "비관리SKU" : move.target}{move.mode === "fill" ? " (제품DB 정보 채우기)" : move.mode === "clear-status" ? ` (제품DB에 이미 있음 · ${move.source === "보관" ? "비관리SKU" : move.source}에서 지움)` : move.mode === "delete-only" ? (move.source === "보관" && move.target !== "재등록SKU" ? " (중복 · 비관리SKU에서만 지움)" : move.target === "재등록SKU" ? ` (재등록SKU에 이미 있음 · ${move.source === "보관" ? "비관리SKU" : move.source}에서만 지움)` : " (비관리SKU에 이미 있음 · 제품DB에서만 지움)") : ""}</td>
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
            <button type="button" className={`softApricotButton ${styles.fullButton}`} disabled={Boolean(busy)} onClick={() => { setPreview(null); onClose?.(); }}>닫기</button>
            <button type="button" className={`softPinkButton ${styles.fullButton}`} disabled={Boolean(busy) || !preview.moves.length || preview.problems.length > 0} onClick={() => void run()}>
              {busy === "run" ? "옮기는 중…" : `정리 실행 (${preview.moves.length}건)`}
            </button>
          </div>
        </>
      )}
    </section>
  );
}
