"use client";

import { discontinueMarkMessage } from "@/lib/wms/discontinue-mark-message";
import { useEffect, useRef, useState } from "react";
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
  const [busy, setBusy] = useState<"check" | "make" | "mark" | null>(null);
  const [lookup, setLookup] = useState<Lookup[] | null>(null);
  const codes = [...new Set(text.split(/[\s,]+/).map(value => value.trim()).filter(Boolean))];
  // 입력 내용은 서버에 자동 저장해, 단종할 코드가 생길 때마다 붙여넣어 모아 두고 나중에 한 번에 만든다(2026-10-19).
  // 회사·집·모바일 어디서 열어도 같은 목록이 이어진다.
  const [saveState, setSaveState] = useState<"loading" | "saved" | "saving" | "error">("loading");
  const loaded = useRef(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/wms/logistics/discontinue-code-draft", { cache: "no-store" })
      .then(response => response.json())
      .then(data => {
        if (cancelled) return;
        if (!data.ok) throw new Error();
        // 불러오기 전에 이미 입력을 시작했으면 그 입력을 지우지 않는다.
        setText(current => current || data.text || "");
        loaded.current = true;
        setSaveState("saved");
      })
      // 불러오지 못했을 때 저장하면 모아 둔 목록을 덮어쓸 수 있어, 이때는 저장하지 않는다.
      .catch(() => { if (!cancelled) setSaveState("error"); });
    return () => { cancelled = true; };
  }, []);

  function saveDraft(next: string, delay = 700) {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    setSaveState("saving");
    saveTimer.current = setTimeout(() => {
      fetch("/api/wms/logistics/discontinue-code-draft", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: next }) })
        .then(response => response.json())
        .then(data => setSaveState(data.ok ? "saved" : "error"))
        .catch(() => setSaveState("error"));
    }, delay);
  }

  function changeText(next: string) {
    setText(next);
    setLookup(null);
    if (loaded.current) saveDraft(next, 400);
  }

  async function run(check: boolean, markOnly = false) {
    if (busy || !codes.length) return;
    setBusy(markOnly ? "mark" : check ? "check" : "make");
    try {
      const response = await fetch("/api/wms/logistics/discontinue-file-by-code", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ codes, check, markOnly }) });
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
        onDone(`단종신청 엑셀과 공문을 만들었습니다(SKU ${data.count}건).${missing}${discontinueMarkMessage(data.productDb)}`, false);
      } else if (markOnly) onDone(`SKU ${data.count}건을 찾았습니다.${missing}${discontinueMarkMessage(data.productDb)}`, Boolean(data.productDb?.warning));
      else onDone(`SKU ${data.count}건을 찾았습니다.${missing}`, false);
    } catch (cause) {
      onDone(cause instanceof Error ? cause.message : "단종신청 파일을 만들지 못했습니다.", true);
    } finally { setBusy(null); }
  }

  return (
    <section>
      <h2 className={styles.listTitle}>바코드·SKU로 단종서류 만들기</h2>
      <p className={styles.meta}>바코드(R0…)나 SKU ID를 한 줄에 하나씩 붙여넣으세요. 같은 코드는 한 번만 들어갑니다. 입력은 자동 저장되니 생길 때마다 모아 두고 한 번에 만드세요.
        {" "}<span style={{ color: saveState === "error" ? "#b33f35" : undefined }}>{saveState === "loading" ? "· 저장해 둔 목록 불러오는 중…" : saveState === "saving" ? "· 저장 중…" : saveState === "error" ? (loaded.current ? "· 저장 실패(다시 입력하면 다시 저장합니다)" : "· 저장해 둔 목록을 불러오지 못했습니다. 새로고침해 주세요.") : codes.length ? `· ${codes.length}개 저장됨` : ""}</span></p>
      <textarea
        value={text}
        onChange={event => changeText(event.target.value)}
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
      <button type="button" className={`softApricotButton ${styles.fullButton}`} disabled={!codes.length || Boolean(busy)} onClick={() => void run(false, true)} style={{ width: "100%", marginTop: "8px" }}>
        {busy === "mark" ? "제품DB에 적는 중…" : "이미 신청한 단종 · 제품DB에 거래처단종만 입력"}
      </button>
      {(text || lookup) && (
        <button
          type="button"
          className={`softPinkButton ${styles.fullButton}`}
          disabled={Boolean(busy)}
          onClick={() => { setText(""); setLookup(null); saveDraft("", 0); onDone("단종 신청 완료 · 입력한 바코드를 비웠습니다.", false); }}
          style={{ width: "100%", marginTop: "8px" }}
        >
          단종 신청 완료 · 입력 비우기
        </button>
      )}
    </section>
  );
}
