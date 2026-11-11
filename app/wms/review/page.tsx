"use client";

import { useCallback, useEffect, useState } from "react";
import { wmsColors } from "@/lib/wms/ui-tokens";
import { openReviewOnThisComputer } from "@/lib/review/client";
import type { ReviewCheck, ReviewImageRef, ReviewListItem, ReviewRecord, ReviewStatus } from "@/lib/review/types";

/**
 * 2026-11-11 상품등록 검수 화면.
 * 다른 사용자가 AI상품등록에서 '검수 요청'을 누르면 여기에 올라온다. 빠진 칸·사진·견적서 문제는 서버가 미리 검사해 두므로
 * 사장님은 빨간 줄과 사진만 확인하고 검수완료 또는 보완요청(메모)을 누르면 된다.
 */
const STATUS_LABEL: Record<ReviewStatus, string> = { pending: "검수 대기", approved: "검수완료", revise: "보완요청" };
const LEVEL_MARK: Record<ReviewCheck["level"], { mark: string; color: string }> = {
  ok: { mark: "✓", color: wmsColors.greenDark },
  warn: { mark: "▲", color: wmsColors.bronze },
  fail: { mark: "✕", color: "#d92d20" },
};
const imageUrl = (model: string, ref: string) => `/api/review?image=${encodeURIComponent(`${model}/${ref}`)}`;

function ImageGrid({ model, title, items, record, wide }: { model: string; title: string; items: ReviewImageRef[]; record: ReviewRecord; wide?: boolean }) {
  if (!items.length) return null;
  return (
    <section style={{ marginTop: 14 }}>
      <h3 style={{ margin: "0 0 6px", fontSize: 15 }}>{title} ({items.filter(item => item.ref).length}/{items.length})</h3>
      <div style={{ display: "grid", gridTemplateColumns: `repeat(auto-fill,minmax(${wide ? 220 : 150}px,1fr))`, gap: 8 }}>
        {items.map((item, index) => {
          const info = item.ref ? record.images[item.ref] : null;
          return (
            <figure key={`${item.label}-${index}`} style={{ margin: 0, border: `1px solid ${item.ref ? wmsColors.border : "#d92d20"}`, borderRadius: 8, padding: 6, background: "#fff" }}>
              {item.ref
                ? <a href={imageUrl(model, item.ref)} target="_blank" rel="noreferrer"><img src={imageUrl(model, item.ref)} alt={item.label} loading="lazy" style={{ width: "100%", aspectRatio: "1 / 1", objectFit: "contain", background: wmsColors.surface, display: "block" }} /></a>
                : <div style={{ aspectRatio: "1 / 1", display: "grid", placeItems: "center", color: "#d92d20", fontWeight: 800, background: "#fdf1ef" }}>사진 빠짐</div>}
              <figcaption style={{ fontSize: 12, marginTop: 4, overflowWrap: "anywhere" }}>{item.label}{info ? <span style={{ color: wmsColors.muted }}> · {info.width}×{info.height}</span> : null}</figcaption>
            </figure>
          );
        })}
      </div>
    </section>
  );
}

export default function ReviewPage() {
  const [items, setItems] = useState<ReviewListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState("");
  const [record, setRecord] = useState<ReviewRecord | null>(null);
  const [memo, setMemo] = useState("");
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");

  const loadList = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const response = await fetch("/api/review", { cache: "no-store" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.ok === false) throw new Error(data.error || "검수 목록을 불러오지 못했습니다.");
      setItems(data.items || []);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "검수 목록을 불러오지 못했습니다."); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void loadList(); }, [loadList]);

  const open = async (model: string) => {
    setSelected(model); setRecord(null); setMessage(""); setBusy("load");
    try {
      const response = await fetch(`/api/review?model=${encodeURIComponent(model)}`, { cache: "no-store" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.ok === false) throw new Error(data.error || "내용을 불러오지 못했습니다.");
      setRecord(data.record); setMemo(data.record.memo || "");
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : "내용을 불러오지 못했습니다."); }
    finally { setBusy(""); }
  };

  const post = async (body: Record<string, unknown>) => {
    const response = await fetch("/api/review", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model: selected, ...body }) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.ok === false) throw new Error(data.error || "처리하지 못했습니다.");
    return data;
  };
  const run = async (name: string, work: () => Promise<void>) => {
    setBusy(name); setMessage("");
    try { await work(); } catch (cause) { setMessage(cause instanceof Error ? cause.message : "처리하지 못했습니다."); }
    finally { setBusy(""); }
  };

  const review = (status: "approved" | "revise") => run(status, async () => {
    await post({ action: "review", status, memo });
    setMessage(status === "approved" ? "검수완료로 처리했습니다." : "보완요청을 보냈습니다. 요청한 사람 화면의 임시저장 목록에 메모가 보입니다.");
    await Promise.all([loadList(), open(selected)]);
  });
  const recheck = () => run("recheck", async () => { const data = await post({ action: "recheck" }); setRecord(data.record); setMessage("다시 검사했습니다."); await loadList(); });
  const openHere = () => run("open", async () => {
    if (!record) return;
    await openReviewOnThisComputer(record, setMessage);
    window.location.href = `/?openDraft=${encodeURIComponent(record.model)}`;
  });
  const remove = () => run("delete", async () => {
    if (!window.confirm(`${selected} 검수 요청과 올라온 사진을 서버에서 지울까요? (요청한 사람의 임시저장은 그대로 남습니다)`)) return;
    await post({ action: "delete" });
    setSelected(""); setRecord(null); await loadList();
  });

  const pending = items.filter(item => item.status === "pending").length;
  return (
    <main style={{ maxWidth: 1000, margin: "0 auto", padding: 16, boxSizing: "border-box", color: wmsColors.ink, overflowWrap: "anywhere" }}>
      <a href="/wms/work-center" style={{ color: wmsColors.slateDark }}>← 작업센터</a>
      <h1 style={{ margin: "8px 0 4px" }}>상품등록 검수</h1>
      <p style={{ margin: "0 0 12px", color: wmsColors.muted, fontSize: 14 }}>AI상품등록에서 '검수 요청'을 누른 상품입니다. 빠진 칸·사진·쿠팡 필수 칸은 자동으로 검사해 두었습니다. 검수 대기 {pending}건</p>
      <button type="button" className="softBeigeButton" onClick={() => void loadList()} disabled={loading} style={{ marginBottom: 12 }}>{loading ? "불러오는 중..." : "목록 새로고침"}</button>
      {error && <p role="alert" style={{ color: "#d92d20", fontWeight: 700 }}>{error}</p>}
      {!loading && !items.length && !error && <p>검수 요청이 아직 없습니다.</p>}

      <div style={{ display: "grid", gap: 8 }}>
        {items.map(item => (
          <button key={item.model} type="button" onClick={() => void open(item.model)}
            style={{ textAlign: "left", border: `${selected === item.model ? 2 : 1}px solid ${selected === item.model ? wmsColors.green : wmsColors.border}`, borderRadius: 10, background: "#fff", padding: 12, cursor: "pointer", color: wmsColors.ink }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
              <strong>{item.model} <span style={{ fontWeight: 500 }}>{item.summary.gender} {item.summary.category}</span></strong>
              <span style={{ fontWeight: 800, color: item.status === "pending" ? wmsColors.bronze : item.status === "approved" ? wmsColors.greenDark : "#d92d20" }}>{STATUS_LABEL[item.status]}</span>
            </div>
            <div style={{ fontSize: 13, marginTop: 4 }}>{item.summary.title}</div>
            <div style={{ fontSize: 12, color: wmsColors.muted, marginTop: 4 }}>
              {new Date(item.submittedAt).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })} · {item.failCount ? <span style={{ color: "#d92d20", fontWeight: 700 }}>고칠 곳 {item.failCount}개</span> : "고칠 곳 없음"}{item.warnCount ? ` · 확인할 곳 ${item.warnCount}개` : ""}
            </div>
          </button>
        ))}
      </div>

      {selected && (
        <section style={{ marginTop: 16, border: `2px solid ${wmsColors.slate}`, borderRadius: 14, padding: 14, background: wmsColors.surface }}>
          <h2 style={{ margin: "0 0 8px", fontSize: 18 }}>{selected}</h2>
          {busy === "load" && <p>불러오는 중...</p>}
          {record && (
            <>
              <div style={{ fontSize: 14, display: "grid", gap: 3 }}>
                <div><b>상품명</b> {record.summary.title}</div>
                <div><b>거래처</b> {record.summary.supplier} · <b>색상</b> {record.summary.colors} · <b>사이즈</b> {record.summary.sizes}</div>
                <div><b>원가</b> {record.summary.cost} · <b>판매가</b> {record.summary.price} · <b>치수</b> {record.summary.dimension || "없음"}</div>
                <div><b>검색태그</b> {record.summary.tags || "없음"}</div>
              </div>

              <h3 style={{ margin: "14px 0 6px", fontSize: 15 }}>자동 검사 결과 <small style={{ fontWeight: 500, color: wmsColors.muted }}>{new Date(record.checkedAt).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}</small></h3>
              <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 4 }}>
                {[...record.checks].sort((a, b) => ["fail", "warn", "ok"].indexOf(a.level) - ["fail", "warn", "ok"].indexOf(b.level)).map((check, index) => (
                  <li key={index} style={{ fontSize: 14, color: check.level === "ok" ? wmsColors.ink : LEVEL_MARK[check.level].color, fontWeight: check.level === "fail" ? 700 : 400 }}>
                    <span style={{ display: "inline-block", width: 20, fontWeight: 800, color: LEVEL_MARK[check.level].color }}>{LEVEL_MARK[check.level].mark}</span>[{check.group}] {check.text}
                  </li>
                ))}
              </ul>

              <ImageGrid model={record.model} title="대표 썸네일(옵션별)" items={record.thumbs} record={record} />
              <ImageGrid model={record.model} title="추가이미지" items={record.slots} record={record} />
              <ImageGrid model={record.model} title="상세 사진" items={record.details} record={record} />
              {record.detailPreviewRef && (
                <section style={{ marginTop: 14 }}>
                  <h3 style={{ margin: "0 0 6px", fontSize: 15 }}>상세페이지 이미지 <small style={{ fontWeight: 500, color: wmsColors.muted }}>(누르면 원본 크기로 열림)</small></h3>
                  <a href={imageUrl(record.model, record.detailPreviewRef)} target="_blank" rel="noreferrer">
                    <img src={imageUrl(record.model, record.detailPreviewRef)} alt="상세페이지" loading="lazy" style={{ width: "100%", maxWidth: 520, display: "block", border: `1px solid ${wmsColors.border}`, background: "#fff" }} />
                  </a>
                </section>
              )}

              <h3 style={{ margin: "16px 0 6px", fontSize: 15 }}>검수 처리</h3>
              <textarea value={memo} onChange={event => setMemo(event.target.value)} rows={3} maxLength={500} placeholder="보완요청 메모(예: 3번 썸네일 사진을 다시 넣어주세요)"
                style={{ width: "100%", boxSizing: "border-box", padding: 10, borderRadius: 8, border: `1px solid ${wmsColors.borderStrong}`, fontSize: 14 }} />
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 8, marginTop: 8 }}>
                <button type="button" className="softSageButton" disabled={Boolean(busy)} onClick={() => void review("approved")}>{busy === "approved" ? "처리 중..." : "검수완료"}</button>
                <button type="button" className="softPinkButton" disabled={Boolean(busy)} onClick={() => void review("revise")}>{busy === "revise" ? "처리 중..." : "보완요청"}</button>
                <button type="button" className="softBeigeButton" disabled={Boolean(busy)} onClick={() => void openHere()}>{busy === "open" ? "여는 중..." : "이 컴퓨터에서 열기"}</button>
                <button type="button" className="softApricotButton" disabled={Boolean(busy)} onClick={() => void recheck()}>{busy === "recheck" ? "검사 중..." : "다시 검사"}</button>
                <button type="button" className="softApricotButton" disabled={Boolean(busy)} onClick={() => void remove()}>요청 삭제</button>
              </div>
            </>
          )}
          {message && <p role="status" style={{ marginTop: 8, fontSize: 14 }}>{message}</p>}
        </section>
      )}
    </main>
  );
}
