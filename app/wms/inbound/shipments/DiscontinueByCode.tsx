"use client";

import { useState } from "react";
import styles from "./shipments.module.css";

type Match = { skuId: string; productName: string; barcode: string; sheetName: string };
type Lookup = { code: string; matches: Match[] };

/**
 * 바코드·SKU ID로 단종서류 만들기 (2026-10-15 사용자 요청).
 * 출력하고 남은 바코드 라벨처럼 단종 대상 목록에 없는 상품도, 바코드나 SKU ID를 붙여넣으면
 * 제품DB(없으면 다른 탭)에서 찾아 기존과 같은 단종신청 엑셀 + 공문 PDF를 만든다.
 */
export default function DiscontinueByCode({ onDone }: { onDone: (text: string, isError: boolean) => void }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState<"check" | "make" | null>(null);
  const [lookup, setLookup] = useState<Lookup[] | null>(null);
  const codes = [...new Set(text.split(/[\s,]+/).map(value => value.trim()).filter(Boolean))];

  async function run(check: boolean) {
    if (busy || !codes.length) return;
    setBusy(check ? "check" : "make");
    try {
      const response = await fetch("/api/wms/logistics/discontinue-file-by-code", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ codes, check }) });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "단종신청 파일을 만들지 못했습니다.");
      setLookup(data.lookup);
      const missing = (data.notFound as string[]).length ? ` 못 찾은 코드 ${data.notFound.length}개는 빠졌습니다.` : "";
      if (!check && data.base64) {
        const link = document.createElement("a");
        link.href = `data:application/zip;base64,${data.base64}`;
        link.download = data.fileName;
        document.body.append(link);
        link.click();
        link.remove();
        onDone(`단종신청 엑셀과 공문을 만들었습니다(SKU ${data.count}건).${missing}`, false);
      } else onDone(`SKU ${data.count}건을 찾았습니다.${missing}`, false);
    } catch (cause) {
      onDone(cause instanceof Error ? cause.message : "단종신청 파일을 만들지 못했습니다.", true);
    } finally { setBusy(null); }
  }

  return (
    <section>
      <h2 className={styles.listTitle}>바코드·SKU로 단종서류 만들기</h2>
      <p className={styles.meta}>바코드(R0…)나 SKU ID를 한 줄에 하나씩 붙여넣으세요. 같은 코드는 한 번만 들어갑니다.</p>
      <textarea
        value={text}
        onChange={event => { setText(event.target.value); setLookup(null); }}
        rows={6}
        placeholder={"R016057300019\nR015747600064"}
        style={{ width: "100%", boxSizing: "border-box", border: "1px solid #d8d3cc", borderRadius: "8px", padding: "8px", fontSize: "13px", fontFamily: "inherit" }}
      />
      {lookup && (
        <div className={styles.tableWrap}>
          <table className={styles.table} aria-label="찾은 단종 SKU">
            <thead><tr><th>입력</th><th>SKU ID</th><th>상품명</th></tr></thead>
            <tbody>
              {lookup.flatMap(entry => entry.matches.length
                ? entry.matches.map(match => <tr key={`${entry.code}-${match.skuId}`}><td>{entry.code}</td><td>{match.skuId}</td><td>{match.productName}{match.sheetName !== "제품DB" ? ` (${match.sheetName})` : ""}</td></tr>)
                : [<tr key={entry.code}><td>{entry.code}</td><td colSpan={2} style={{ color: "#b33f35" }}>못 찾음</td></tr>])}
            </tbody>
          </table>
        </div>
      )}
      <div className={styles.pairButtons}>
        <button type="button" className={`softBeigeButton ${styles.fullButton}`} disabled={!codes.length || Boolean(busy)} onClick={() => void run(true)}>
          {busy === "check" ? "찾는 중…" : `입력한 ${codes.length}개 SKU 확인`}
        </button>
        <button type="button" className={`softSageButton ${styles.fullButton}`} disabled={!codes.length || Boolean(busy)} onClick={() => void run(false)}>
          {busy === "make" ? "만드는 중…" : "단종신청 엑셀·공문 만들기"}
        </button>
      </div>
      {(text || lookup) && (
        <button
          type="button"
          className={`softPinkButton ${styles.fullButton}`}
          disabled={Boolean(busy)}
          onClick={() => { setText(""); setLookup(null); onDone("단종 신청 완료 · 입력한 바코드를 비웠습니다.", false); }}
          style={{ width: "100%", marginTop: "8px" }}
        >
          단종 신청 완료 · 입력 비우기
        </button>
      )}
    </section>
  );
}
