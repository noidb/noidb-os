"use client";

import { discontinueMarkMessage } from "@/lib/wms/discontinue-mark-message";
import { useEffect, useRef, useState } from "react";
import styles from "./shipments.module.css";

type Match = { skuId: string; productName: string; barcode: string; sheetName: string };
type Lookup = { code: string; matches: Match[] };
export type DiscontinueAutoRow = { skuId: string; productName: string; orderableStatus: string; key: string };
type LatestOrderable = { fileMtime: string; orderable: Record<string, string> } | null;
type Row = { skuId: string; productName: string; orderable: string; auto: boolean; autoKey: string; codes: string[]; sheetName: string };

/**
 * 단종 신청 목록 (2026-10-20 사용자 요청으로 하나로 합침).
 *
 * 예전에는 '단종 대상 SKU'(제품DB에서 자동으로 뽑힘)와 '바코드·SKU로 단종서류 만들기'(직접 붙여넣기)가
 * 서류·완료를 따로 해야 해서, 같은 SKU가 양쪽에 있는지 직접 비교하고 일을 두 번 했다.
 * 이제 표 하나에 두 출처를 같이 보여 주고(같은 SKU는 한 줄), 서류 한 번·완료 한 번으로 끝낸다.
 * 직접 입력은 예전처럼 서버에 자동 저장되어 회사·집·모바일 어디서든 이어진다(2026-10-19).
 */
const LOOKUP_MEMORY_KEY = "noidb-discontinue-code-lookup-v1";
const DRAFT_MEMORY_KEY = "noidb-discontinue-code-draft-v1";
const LOOKUP_MEMORY_MS = 24 * 60 * 60 * 1000;
type LookupMemory = Record<string, { at: number; matches: Match[] }>;
function readLookupMemory(): LookupMemory {
  try { return JSON.parse(window.localStorage.getItem(LOOKUP_MEMORY_KEY) || "{}") as LookupMemory; } catch { return {}; }
}
function saveLookupMemory(lookup: Lookup[]) {
  try {
    const memory = readLookupMemory();
    const now = Date.now();
    for (const entry of lookup) memory[entry.code] = { at: now, matches: entry.matches };
    // 너무 커지지 않게 최근 500개만 둔다.
    const recent = Object.entries(memory).sort((a, b) => b[1].at - a[1].at).slice(0, 500);
    window.localStorage.setItem(LOOKUP_MEMORY_KEY, JSON.stringify(Object.fromEntries(recent)));
  } catch { /* 저장 못 해도 화면은 그대로 동작 */ }
}

export default function DiscontinueByCode({ autoRows, latestOrderable, clearing, onClearAuto, onDone }: {
  autoRows: DiscontinueAutoRow[];
  latestOrderable: LatestOrderable;
  clearing: boolean;
  onClearAuto: (keys: string[]) => Promise<boolean>;
  onDone: (text: string, isError: boolean) => void;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState<"make" | "mark" | "clear" | null>(null);
  const [lookup, setLookup] = useState<Lookup[] | null>(null);
  const [lookupState, setLookupState] = useState<"idle" | "loading" | "error">("idle");
  const codes = [...new Set(text.split(/[\s,]+/).map(value => value.trim()).filter(Boolean))];
  const codesKey = codes.join("\n");
  const [saveState, setSaveState] = useState<"loading" | "saved" | "saving" | "error">("loading");
  const loaded = useRef(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lookupVersion = useRef(0);

  const typed = useRef(false);
  useEffect(() => {
    let cancelled = false;
    // 2026-10-21: 서버 응답을 기다리지 않고 이 브라우저에 기억해 둔 입력을 먼저 보여 준다(서버 내용이 오면 그걸로 맞춤).
    try { const remembered = window.localStorage.getItem(DRAFT_MEMORY_KEY); if (remembered) setText(current => current || remembered); } catch { /* 없음 */ }
    fetch("/api/wms/logistics/discontinue-code-draft", { cache: "no-store" })
      .then(response => response.json())
      .then(data => {
        if (cancelled) return;
        if (!data.ok) throw new Error();
        // 불러오기 전에 이미 입력을 시작했으면 그 입력을 지우지 않는다.
        if (!typed.current) setText(data.text || "");
        try { window.localStorage.setItem(DRAFT_MEMORY_KEY, data.text || ""); } catch { /* 저장 못 해도 동작 */ }
        loaded.current = true;
        setSaveState("saved");
      })
      // 불러오지 못했을 때 저장하면 모아 둔 목록을 덮어쓸 수 있어, 이때는 저장하지 않는다.
      .catch(() => { if (!cancelled) setSaveState("error"); });
    return () => { cancelled = true; };
  }, []);

  // 직접 넣은 코드는 잠시 뒤 자동으로 찾아서 표에 같이 보여 준다(따로 '확인' 버튼을 누르지 않아도 됨).
  // 2026-10-21: 새로고침·다시 들어올 때마다 같은 코드를 처음부터 다시 찾아 기다려야 했다 →
  // 찾은 결과를 이 브라우저에 코드별로 기억해 바로 보여 주고, 처음 보는 코드만 찾는다(기억은 하루 지나면 조용히 다시 확인).
  useEffect(() => {
    const version = ++lookupVersion.current;
    if (!codesKey) { setLookup(null); setLookupState("idle"); return; }
    const list = codesKey.split("\n");
    const memory = readLookupMemory();
    const known = list.filter(code => memory[code]);
    const fresh = known.length === list.length && known.every(code => Date.now() - memory[code].at < LOOKUP_MEMORY_MS);
    if (known.length) setLookup(known.map(code => ({ code, matches: memory[code].matches })));
    if (fresh) { setLookupState("idle"); return; }
    if (known.length !== list.length) setLookupState("loading");
    const timer = setTimeout(() => {
      fetch("/api/wms/logistics/discontinue-file-by-code", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ codes: list, check: true }) })
        .then(response => response.json())
        .then(data => {
          if (version !== lookupVersion.current) return;
          if (!data.ok) throw new Error();
          setLookup(data.lookup);
          setLookupState("idle");
          saveLookupMemory(data.lookup as Lookup[]);
        })
        .catch(() => { if (version === lookupVersion.current && known.length !== list.length) setLookupState("error"); });
    }, known.length === list.length ? 0 : 700);
    return () => clearTimeout(timer);
  }, [codesKey]);

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
    typed.current = true;
    setText(next);
    try { window.localStorage.setItem(DRAFT_MEMORY_KEY, next); } catch { /* 저장 못 해도 동작 */ }
    if (loaded.current) saveDraft(next, 400);
  }

  async function removeRow(row: Row) {
    if (row.auto) {
      if (!window.confirm(`SKU ${row.skuId}를 단종 신청 목록에서 뺄까요? 뺀 SKU는 다시 뜨지 않습니다.`)) return;
      if (!await onClearAuto([row.autoKey])) return;
    }
    if (row.codes.length) removeCodes(row.codes);
  }

  // 직접 넣은 코드 줄만 입력칸에서 뺀다.
  function removeCodes(remove: string[]) {
    const drop = new Set(remove);
    changeText(text.split("\n").filter(line => !drop.has(line.trim())).join("\n"));
  }

  const orderableOf = (skuId: string, fallback: string) => latestOrderable ? latestOrderable.orderable[skuId] || "파일에 없음" : fallback || "미확인";
  const rows = new Map<string, Row>();
  for (const row of autoRows) rows.set(row.skuId, { skuId: row.skuId, productName: row.productName, orderable: orderableOf(row.skuId, row.orderableStatus), auto: true, autoKey: row.key, codes: [], sheetName: "" });
  for (const entry of lookup || []) for (const match of entry.matches) {
    const existing = rows.get(match.skuId);
    if (existing) existing.codes.push(entry.code);
    else rows.set(match.skuId, { skuId: match.skuId, productName: match.productName, orderable: orderableOf(match.skuId, ""), auto: false, autoKey: "", codes: [entry.code], sheetName: match.sheetName });
  }
  const list = [...rows.values()];
  const notFound = (lookup || []).filter(entry => !entry.matches.length).map(entry => entry.code);
  const working = Boolean(busy) || clearing;

  function download(data: { base64: string; fileName: string }) {
    const link = document.createElement("a");
    link.href = `data:application/zip;base64,${data.base64}`;
    link.download = data.fileName;
    document.body.append(link);
    link.click();
    link.remove();
  }

  async function makeFiles() {
    if (working || !list.length) return;
    setBusy("make");
    try {
      const response = await fetch("/api/wms/logistics/discontinue-file", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ skuIds: autoRows.map(row => row.skuId), codes }) });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "단종신청 파일을 만들지 못했습니다.");
      download(data);
      const missing = (data.notFound as string[] | undefined)?.length ? ` 못 찾은 코드 ${data.notFound.length}개는 빠졌습니다.` : "";
      onDone(`단종신청 엑셀과 공문을 만들었습니다(SKU ${data.count}건).${missing}${discontinueMarkMessage(data.productDb)} 쿠팡에 신청한 뒤 '단종 신청 완료 · 목록 비우기'를 눌러 주세요.`, false);
    } catch (cause) {
      onDone(cause instanceof Error ? cause.message : "단종신청 파일을 만들지 못했습니다.", true);
    } finally { setBusy(null); }
  }

  // 예전에 이미 단종서류를 만든 코드: 파일 없이 제품DB 현재상태만 거래처단종으로 적는다.
  async function markOnly() {
    if (working || !codes.length) return;
    setBusy("mark");
    try {
      const response = await fetch("/api/wms/logistics/discontinue-file-by-code", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ codes, markOnly: true }) });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "제품DB에 적지 못했습니다.");
      const missing = (data.notFound as string[]).length ? ` 못 찾은 코드 ${data.notFound.length}개는 빠졌습니다.` : "";
      onDone(`직접 입력한 SKU ${data.count}건을 찾았습니다.${missing}${discontinueMarkMessage(data.productDb)}`, Boolean(data.productDb?.warning));
    } catch (cause) {
      onDone(cause instanceof Error ? cause.message : "제품DB에 적지 못했습니다.", true);
    } finally { setBusy(null); }
  }

  // 신청 완료: 자동 목록과 직접 입력을 한 번에 비운다. 자동 목록에서 비운 SKU는 다시 뜨지 않는다.
  async function finish() {
    if (working || (!autoRows.length && !text.trim())) return;
    if (!window.confirm(`단종 신청 목록 ${list.length}건을 비웁니다.\n쿠팡에 단종 신청을 마친 뒤에 눌러 주세요.`)) return;
    setBusy("clear");
    try {
      if (autoRows.length && !(await onClearAuto(autoRows.map(row => row.key)))) return;
      setText("");
      setLookup(null);
      saveDraft("", 0);
      onDone(`단종 신청 완료 · 목록 ${list.length}건을 비웠습니다.`, false);
    } finally { setBusy(null); }
  }

  const saveNote = saveState === "loading" ? "저장해 둔 입력 불러오는 중…" : saveState === "saving" ? "저장 중…" : saveState === "error" ? (loaded.current ? "저장 실패(다시 입력하면 다시 저장합니다)" : "저장해 둔 입력을 불러오지 못했습니다. 새로고침해 주세요.") : codes.length ? `직접 입력 ${codes.length}개 저장됨` : "";

  return (
    <section>
      <h2 className={styles.listTitle}>단종 신청 목록 {list.length > 0 && <span>{list.length}건</span>}</h2>
      <p className={styles.meta}>
        제품DB·비관리SKU 탭 현재상태가 판매중지·단종·거래처단종·가품중단인데 발주가능상태가 아직 정상인 SKU와, 아래 칸에 직접 넣은 바코드·SKU를 한 표로 보여 줘요. 같은 SKU는 한 번만 들어가요.
      </p>
      {list.length > 0 ? (
        <div className={`${styles.tableWrap} ${styles.copyScroll}`}>
          <table className={`${styles.table} ${styles.copyTable}`} aria-label="단종 신청 목록">
            <thead>
              <tr>
                <th>SKU ID</th>
                <th>상품명</th>
                <th className={styles.orderableCol} title={latestOrderable ? `최신파일 ${new Date(latestOrderable.fileMtime).toLocaleString("ko-KR")}` : "제품DB 값 · 작업센터 '자주 하는 일'에서 상품공급상태 최신파일을 반영하면 쿠팡 최신값이 됩니다"}>
                  발주상태{latestOrderable ? "" : " (DB)"}
                </th>
                <th className={styles.deleteCol} aria-label="빼기" />
              </tr>
            </thead>
            <tbody>
              {list.map(row => {
                // 단종 대상은 쿠팡 발주가능상태가 '정상이 아님'이 되면 처리가 끝난 것 → 세이지로 표시
                const done = Boolean(latestOrderable?.orderable[row.skuId]) && row.orderable !== "정상" && row.orderable !== "확인필요";
                const source = row.auto ? (row.codes.length ? "제품DB · 직접 입력" : "제품DB") : `직접 입력${row.sheetName && row.sheetName !== "제품DB" ? ` · ${row.sheetName}` : ""}`;
                return (
                  <tr key={row.skuId}>
                    <td>{row.skuId}</td>
                    <td>{row.productName} <span style={{ fontSize: "12px", color: "#8a8379", whiteSpace: "nowrap" }}>({source})</span></td>
                    <td className={`${styles.orderableCol} ${done ? styles.orderableDone : ""}`} title={done ? "쿠팡에서 처리 완료" : undefined}>{row.orderable}{done ? " ✓" : ""}</td>
                    <td className={styles.deleteCol}>
                      {/* 2026-10-21: 이미 처리했거나 단종인 SKU는 어느 출처든 여기서 뺀다(자동 목록에서 뺀 SKU는 다시 뜨지 않음). */}
                      <button type="button" className="softPinkButton" title={row.auto ? "이 SKU를 목록에서 뺍니다. 다시 뜨지 않습니다." : "직접 넣은 코드를 입력칸에서 뺍니다."} disabled={working} onClick={() => void removeRow(row)}>빼기</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <p className={styles.empty}>{lookupState === "loading" ? "직접 넣은 코드 찾는 중…" : "단종 신청할 SKU가 없습니다."}</p>
      )}
      {notFound.length > 0 && (
        <p className={styles.meta} style={{ color: "#b33f35" }}>
          제품DB에서 못 찾은 코드 {notFound.length}개(서류에서 빠짐): {notFound.join(", ")}{" "}
          <button type="button" className="softApricotButton" style={{ borderRadius: "8px", padding: "2px 8px", fontSize: "12px" }} disabled={working} onClick={() => removeCodes(notFound)}>입력칸에서 빼기</button>
        </p>
      )}
      {lookupState === "error" && <p className={styles.meta} style={{ color: "#b33f35" }}>직접 넣은 코드를 찾지 못했습니다. 잠시 후 입력칸을 한 번 고치면 다시 찾습니다.</p>}
      <label className={styles.meta} style={{ display: "block", marginTop: "8px", fontWeight: 700 }}>
        바코드·SKU 직접 추가 <span style={{ fontWeight: 400 }}>· 바코드(R0…)나 SKU ID를 한 줄에 하나씩 붙여넣으면 위 표에 들어가요. {saveNote}</span>
      </label>
      <textarea
        value={text}
        onChange={event => changeText(event.target.value)}
        rows={4}
        placeholder={"R016057300019\nR015747600064"}
        style={{ width: "100%", boxSizing: "border-box", border: "1px solid #d8d3cc", borderRadius: "8px", padding: "8px", fontSize: "13px", fontFamily: "inherit" }}
      />
      <div className={styles.pairButtons}>
        <button type="button" className={`softSageButton ${styles.fullButton}`} disabled={!list.length || working || lookupState === "loading"} onClick={() => void makeFiles()}>
          {busy === "make" ? "만드는 중…" : `단종신청 엑셀·공문 만들기${list.length ? ` (${list.length}건)` : ""}`}
        </button>
        <button type="button" className={`softPinkButton ${styles.fullButton}`} disabled={(!autoRows.length && !text.trim()) || working} onClick={() => void finish()}>
          {busy === "clear" || clearing ? "비우는 중…" : "단종 신청 완료 · 목록 비우기"}
        </button>
      </div>
      {codes.length > 0 && (
        <button type="button" className={`softApricotButton ${styles.fullButton}`} disabled={working} onClick={() => void markOnly()} style={{ width: "100%", marginTop: "8px" }}>
          {busy === "mark" ? "제품DB에 적는 중…" : "직접 입력한 SKU가 이미 신청한 단종이면 · 제품DB에 거래처단종만 입력"}
        </button>
      )}
    </section>
  );
}
