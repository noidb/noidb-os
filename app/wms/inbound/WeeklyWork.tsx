"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { downloadBlobPreservingPage } from "@/lib/wms/download-client";
import type { WeeklyBrowserSource, WeeklyPeriod, WeeklyReview, WeeklyRun, WeeklyVendorItem, WeeklyWorkspace } from "@/lib/wms/weekly-work-types";
import { WEEKLY_RULES_VERSION } from "@/lib/wms/weekly-work-types";
import { defaultReview, displayImageUrl, prepareWeeklyDownload, recentMonthPeriod, recentPeriod, resizeProductPhoto, reviewNeedsAttention, reorderNeedsAttention, type WeeklyDownload } from "./weekly-client";
import styles from "./weekly-work.module.css";
import { weeklyFreshVendorItem, weeklyReviewCompletion, weeklyReviewIsActive } from "@/lib/wms/weekly-work-progress";
import { weeklyCouponCompletion } from "@/lib/wms/weekly-coupon-completion";
import { weeklyReorderQueueRuns } from "@/lib/wms/weekly-reorder-queue-view";

const LegacyInbound = dynamic(() => import("./LegacyInbound"), { loading: () => <p>이전 입고기록을 불러오는 중입니다.</p> });
import WeeklyCouponHistory from "./WeeklyCouponHistory";
type OutputKind = "all" | "coupon" | "vendors" | "discontinue" | "reorder" | "marketing";
type AdvertisingPreview = { resolved: Array<{ skuId: string; optionId: string }>; optionIds: string[]; missingSkuIds: string[]; conflictingSkuIds: string[] };
type SaveState = "saved" | "pending" | "saving" | "error";
type ApiResult = { success?: boolean; run?: WeeklyRun; error?: string; code?: string };
const samePeriod = (left: WeeklyPeriod, right: WeeklyPeriod) => left.startDate === right.startDate && left.endDate === right.endDate;
const formatTime = (value?: string) => value ? new Date(value).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "";

function ProductReviewCard({ item, review, vendors, disabled, sent, requested, previouslyRequested, onChange, onRoute, onImageWork, onImageFailure }: {
  item: WeeklyVendorItem; review: WeeklyReview; vendors: string[]; disabled: boolean; sent: boolean; requested: boolean; previouslyRequested: Set<string>;
  onChange: (skuId: string, patch: Partial<WeeklyReview>) => void; onRoute: (skuId: string, decision: WeeklyReview["decision"]) => void; onImageWork: (delta: number) => void; onImageFailure: (skuId: string) => void;
}) {
  const [uploading, setUploading] = useState(false);
  const [imageError, setImageError] = useState("");
  const [previewFailed, setPreviewFailed] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  useEffect(() => setPreviewFailed(false), [review.imageUrl]);
  async function addImage(file?: File) {
    if (!file || uploading || disabled || sent || requested || review.decision === "reorder") return;
    setUploading(true); setImageError(""); onImageWork(1);
    try {
      const dataUrl = await resizeProductPhoto(file);
      const response = await fetch("/api/wms/weekly-work/image", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ dataUrl }) });
      const data = await response.json();
      if (!response.ok || !data.success || !data.imageUrl) throw new Error(data.error || "사진을 저장하지 못했습니다.");
      onChange(item.skuId, { imageUrl: data.imageUrl });
    } catch (error) { setImageError(error instanceof Error ? error.message : "사진을 추가하지 못했습니다."); }
    finally { setUploading(false); onImageWork(-1); if (fileInput.current) fileInput.current.value = ""; }
  }
  const attention = reviewNeedsAttention(review) || previewFailed && review.decision === "order" || review.decision === "reorder" && reorderNeedsAttention(item);
  return <article className={`${styles.product} ${attention ? styles.productAttention : ""} ${review.decision === "discontinue" ? styles.productDiscontinued : ""}`}>
    <div className={styles.photoArea} tabIndex={disabled ? -1 : 0} aria-label={`${item.skuId} 상품 사진. 사진을 붙여넣거나 추가할 수 있습니다.`} onPaste={event => {
      const image = Array.from(event.clipboardData.files).find(file => file.type.startsWith("image/"));
      if (image) { event.preventDefault(); void addImage(image); }
    }}>
      {review.imageUrl && !previewFailed ? <img src={displayImageUrl(review.imageUrl)} alt={item.productName} loading="lazy" onError={() => { setPreviewFailed(true); onImageFailure(item.skuId); }} /> : <div className={styles.photoEmpty}><span aria-hidden="true">{review.decision === "reorder" ? "✓" : "＋"}</span><span>{review.decision === "reorder" ? "사진 없이 요청 가능" : previewFailed ? "사진 확인 필요" : "사진을 추가하세요"}</span></div>}
      {review.decision !== "reorder" ? <button type="button" className={styles.photoButton} disabled={disabled || uploading || sent || requested} onClick={() => fileInput.current?.click()}>{uploading ? "사진 저장 중…" : review.imageUrl ? "사진 변경" : "사진 추가"}</button> : null}
      <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/bmp,image/avif" hidden aria-label={`${item.skuId} 사진 선택`} onChange={event => void addImage(event.target.files?.[0])} />
      {review.decision !== "reorder" ? <small>여기에 사진 붙여넣기도 가능</small> : null}
    </div>
    <div className={styles.productBody}>
      <div className={styles.productHeading}><span className={styles.sku}>SKU {item.skuId}</span><span className={review.decision === "discontinue" ? styles.badgeMuted : attention ? styles.badgeWarn : styles.badgeGood}>{review.decision === "discontinue" ? "단종 신청" : review.decision === "hold" ? "이번 발주 보류" : review.decision === "reorder" ? requested ? "재발주 요청 완료" : attention ? "발주별 수량 확인 필요" : "재발주요청" : attention ? "확인 필요" : "발주 준비 완료"}</span></div>
      <h3>{item.productName}</h3>
      {item.optionLabel ? <p className={styles.option}>{item.optionLabel}</p> : null}
      {previouslyRequested.size && review.decision !== "reorder" ? <p className={styles.outputHint}>이미 재발주 요청한 발주번호: {[...previouslyRequested].join(", ")}. 거래처에 추가 주문할 때 이 요청분을 중복 주문하지 않도록 수량을 확인하세요.</p> : null}
      {item.productLink ? <a className={styles.productLink} href={item.productLink} target="_blank" rel="noreferrer">제품 정보 확인 ↗</a> : null}
      <div className={styles.quantities}><span>실제 미입고 <strong>{item.shortageQuantity.toLocaleString()}개</strong></span>{item.confirmedQuantity !== undefined ? <span>발주 확정 <strong>{item.confirmedQuantity.toLocaleString()}개</strong></span> : null}{item.receivedQuantity !== undefined ? <span>실제 누적 입고 <strong>{item.receivedQuantity.toLocaleString()}개</strong></span> : null}</div>
      <fieldset disabled={disabled || uploading || requested} className={styles.reviewFields}>
        <legend className={styles.srOnly}>SKU {item.skuId} 발주 검토</legend>
        <label className={styles.field}><span>처리 방법 · 선택하면 바로 이동</span><select aria-label={`SKU ${item.skuId} 처리 방법`} value="" onChange={event => onRoute(item.skuId, event.target.value as WeeklyReview["decision"])}><option value="" disabled>처리 방법 선택</option><option value="order" disabled={item.discontinued || sent && review.decision !== "order"}>거래처 발주</option><option value="reorder" disabled={sent}>재발주요청 · 재고 있음</option><option value="hold" disabled={sent}>이번에는 보류</option><option value="discontinue">단종 · 생산 종료</option></select></label>
        {review.decision === "order" ? <>
          <label className={styles.field}><span>거래처{!review.vendorName.trim() ? <b className={styles.required}> 선택 필요</b> : null}</span><input disabled={sent} list={`vendors-${item.skuId}`} value={review.vendorName} placeholder="거래처 선택 또는 입력" onChange={event => onChange(item.skuId, { vendorName: event.target.value })} /><datalist id={`vendors-${item.skuId}`}>{vendors.map(name => <option key={name} value={name} />)}</datalist></label>
        </> : review.decision === "reorder" ? <div className={styles.reorderNote}>
          <p>보유 재고로 출고할 미납분을 쿠팡에 재발주 요청합니다. 원래 발주서별 미납수량이 그대로 들어갑니다.</p>
          {reorderNeedsAttention(item) ? <p role="alert" className={styles.inlineError}>발주번호별 미납수량을 다시 확인해야 합니다. 위의 ‘최신 자료로 다시 확인’을 누른 뒤 재발주요청을 선택해 주세요.</p> : <div className={styles.reorderTable}><table><caption>SKU {item.skuId} 재발주 요청 내역</caption><thead><tr><th scope="col">원래 발주번호</th><th scope="col">미납수량</th><th scope="col">처리</th></tr></thead><tbody>{item.shortageDetails!.map(row => <tr key={row.purchaseOrderNumber}><td>{row.purchaseOrderNumber}</td><td>{row.shortageQuantity.toLocaleString()}개</td><td>{previouslyRequested.has(row.purchaseOrderNumber) ? "기요청 · 제외" : requested ? "요청 완료" : "파일에 포함"}</td></tr>)}</tbody></table></div>}
          <p>요청입고예정일: 생성일 다음 첫 금요일<br />요청사유: 업체실수로 인한 출고누락</p>
        </div> : <p className={styles.decisionNote}>{review.decision === "discontinue" ? "거래처 발주에서 제외합니다. 단종관리로 보내면 공용 목록에서 파일과 완료를 처리합니다." : "이번 발주 파일에서 제외합니다. 검토 내용은 저장됩니다."}</p>}
      </fieldset>
      {item.discontinued ? <p className={styles.outputHint}>단종으로 등록된 상품이라 거래처 발주를 선택할 수 없습니다. <a href="/wms/vendor-orders/status-requests">단종·해제 관리에서 상태 확인 ↗</a></p> : null}
      {imageError ? <p role="alert" className={styles.inlineError}>{imageError}</p> : null}
      {sent ? <p className={styles.decisionNote}>이미 보낸 발주입니다. 생산 종료 답변을 받으면 여기에서 단종으로 체크하세요.</p> : null}
      {item.issues.length && review.decision !== "reorder" ? <div className={styles.sourceIssues}>{item.issues.filter(issue => !issue.includes("사용 가능한 현재고") && !issue.includes("추가 주문 제안")).map((issue, index) => <p key={`${index}-${issue}`}>{issue}</p>)}</div> : null}
      {item.relatedPurchaseOrderNumbers.length > 0 ? <details className={styles.rowDetails}><summary>관련 발주번호 확인</summary><p>{item.relatedPurchaseOrderNumbers.join(", ")}</p></details> : null}
    </div>
  </article>;
}

export default function WeeklyWork({ processingOnly = false }: { processingOnly?: boolean }) {
  const routing = useRef(false);
  const [period, setPeriod] = useState<WeeklyPeriod>(recentMonthPeriod);
  const [preset, setPreset] = useState("month");
  const [runs, setRuns] = useState<WeeklyRun[]>([]);
  const [run, setRun] = useState<WeeklyRun | null>(null);
  const [reviews, setReviews] = useState<Record<string, WeeklyReview>>({});
  const [knownVendors, setKnownVendors] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [imageWork, setImageWork] = useState(0);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [couponSearch, setCouponSearch] = useState("");
  const [couponStartsOn, setCouponStartsOn] = useState("");
  const [couponExpiresOn, setCouponExpiresOn] = useState("");
  const [advertising, setAdvertising] = useState<{ key: string; data?: AdvertisingPreview; error?: string } | null>(null);
  const [advertisingRefresh, setAdvertisingRefresh] = useState(0);
  const [visibleLimit, setVisibleLimit] = useState(40);
  const [invalidImages, setInvalidImages] = useState<Set<string>>(() => new Set());
  const [outputProgress, setOutputProgress] = useState("");
  const [outputError, setOutputError] = useState("");
  const outputLock = useRef(false);
  const [downloads, setDownloads] = useState<WeeklyDownload[]>([]);
  const [bundle, setBundle] = useState<{ name: string; url: string } | null>(null);
  const [showLegacy, setShowLegacy] = useState(false);
  const [driveReconnect, setDriveReconnect] = useState(false);
  const runRef = useRef<WeeklyRun | null>(null);
  const reviewsRef = useRef<Record<string, WeeklyReview>>({});
  const periodRef = useRef(period);
  const dirty = useRef(new Map<string, number>());
  const editVersion = useRef(0);
  const savePromise = useRef<Promise<boolean> | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout>>();
  const collectTimer = useRef<ReturnType<typeof setTimeout>>();
  const collection = useRef<{ requestId: string; period: WeeklyPeriod; acknowledged: boolean } | null>(null);
  const seenTransfers = useRef(new Set<string>());
  const mounted = useRef(true);
  const outputUrls = useRef<string[]>([]);
  const uploadInput = useRef<HTMLInputElement>(null);
  const requestNumber = useRef(0);
  const couponSaving = useRef(false);
  periodRef.current = period;

  const clearDownloads = useCallback(() => {
    outputUrls.current.forEach(url => URL.revokeObjectURL(url)); outputUrls.current = [];
    setDownloads([]); setBundle(null); setOutputProgress(""); setOutputError("");
  }, []);

  const installRun = useCallback((next: WeeklyRun, resetReviews = true) => {
    setCouponStartsOn(next.couponStartsOn || "");
    setCouponExpiresOn(next.couponExpiresOn || "");
    runRef.current = next; setRun(next);
    setRuns(previous => [next, ...previous.filter(item => item.id !== next.id)].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
    if (resetReviews) {
      const mapped = Object.fromEntries(next.snapshot.vendorItems.map(item => [item.skuId, next.reviews[item.skuId] || defaultReview(item)]));
      reviewsRef.current = mapped; setReviews(mapped); dirty.current.clear(); setSaveState("saved");
    }
  }, []);

  const flushSave = useCallback(async (): Promise<boolean> => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    if (savePromise.current) return savePromise.current;
    if (!dirty.current.size || !runRef.current) return true;
    const pending = (async () => {
      setSaveState("saving");
      try {
        let retries = 0;
        while (dirty.current.size) {
          const current = runRef.current;
          if (!current) return false;
          const versions = new Map(dirty.current);
          const changed = Array.from(versions.keys(), skuId => reviewsRef.current[skuId]);
          const response = await fetch("/api/wms/weekly-work", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "review", runId: current.id, expectedRevision: current.revision, reviews: changed }) });
          const data = await response.json() as ApiResult;
          if (response.status === 409 && data.error?.includes("다른 화면에서") && retries++ < 2) {
            const refresh = await fetch("/api/wms/weekly-work", { cache: "no-store" });
            const workspace = await refresh.json() as WeeklyWorkspace & ApiResult;
            const latest = workspace.runs?.find(item => item.id === current.id);
            if (refresh.ok && workspace.success && latest) {
              const canonical = (review: WeeklyReview | undefined) => review ? JSON.stringify({ ...review, vendorName: review.vendorName.trim(), imageUrl: review.imageUrl.trim() }) : "";
              const conflicts = changed.filter(review => canonical(latest.reviews[review.skuId]) !== canonical(current.reviews[review.skuId]) && canonical(latest.reviews[review.skuId]) !== canonical(review));
              if (conflicts.length) throw new Error(`다른 화면에서 같은 상품을 수정했습니다(SKU ${conflicts.map(item => item.skuId).join(", ")}). 지금 입력한 내용은 화면에 보관되어 있습니다. 다른 화면의 작업을 확인해 주세요.`);
              runRef.current = latest;
              const merged = { ...latest.reviews, ...Object.fromEntries(Array.from(dirty.current.keys(), skuId => [skuId, reviewsRef.current[skuId]])) };
              reviewsRef.current = merged;
              if (mounted.current) { setRun(latest); setReviews(merged); }
              continue;
            }
          }
          if (!response.ok || !data.success || !data.run) throw new Error(data.error || "검토 내용을 저장하지 못했습니다. 다시 저장해 주세요.");
          for (const [sku, version] of versions) if (dirty.current.get(sku) === version) dirty.current.delete(sku);
          runRef.current = data.run;
          const merged = { ...data.run.reviews, ...Object.fromEntries(Array.from(dirty.current.keys(), skuId => [skuId, reviewsRef.current[skuId]])) };
          reviewsRef.current = merged;
          if (mounted.current) {
            setRun(data.run);
            setReviews(merged);
            setRuns(previous => [data.run!, ...previous.filter(item => item.id !== data.run!.id)]);
          }
        }
        if (mounted.current) { setSaveState("saved"); setError(""); }
        return true;
      } catch (failure) {
        if (mounted.current) { setSaveState("error"); setError(failure instanceof Error ? failure.message : "검토 내용을 저장하지 못했습니다."); }
        return false;
      }
    })();
    savePromise.current = pending;
    try { return await pending; } finally { if (savePromise.current === pending) savePromise.current = null; }
  }, []);

  const changeReview = useCallback((skuId: string, patch: Partial<WeeklyReview>) => {
    const previous = reviewsRef.current[skuId]; if (!previous) return;
    const next = { ...reviewsRef.current, [skuId]: { ...previous, ...patch, skuId } };
    reviewsRef.current = next; setReviews(next); dirty.current.set(skuId, ++editVersion.current); setSaveState("pending");
    if (patch.imageUrl !== undefined) setInvalidImages(previous => { const remaining = new Set(previous); remaining.delete(skuId); return remaining; });
    clearDownloads();
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => void flushSave(), 650);
  }, [clearDownloads, flushSave]);

  useEffect(() => setVisibleLimit(40), [filter, search, run?.id]);
  useEffect(() => setInvalidImages(new Set()), [run?.id]);

  useEffect(() => {
    mounted.current = true;
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch("/api/wms/weekly-work", { cache: "no-store" });
        const data = await response.json() as WeeklyWorkspace & ApiResult;
        if (!response.ok || !data.success) throw new Error(data.error || "주간 업무를 불러오지 못했습니다.");
        if (cancelled) return;
        const saved = (data.runs || []).sort((a, b) => b.snapshot.createdAt.localeCompare(a.snapshot.createdAt) || b.updatedAt.localeCompare(a.updatedAt));
        setRuns(saved);
        setKnownVendors(Array.from(new Set(Object.values(data.productOverrides || {}).map(item => item.vendorName).filter(Boolean))).sort());
        const initial = processingOnly ? weeklyReorderQueueRuns(saved)[0] : saved[0];
        if (initial && !initial.completedAt) { installRun(initial); setPeriod(initial.snapshot.period); setPreset("custom"); }
        else if (saved.length) { setPeriod(recentPeriod(7)); setPreset("week"); }
      } catch (failure) { if (!cancelled) setError(failure instanceof Error ? failure.message : "주간 업무를 불러오지 못했습니다."); }
      finally { if (!cancelled) setLoading(false); }
    })();
    const beforeUnload = (event: BeforeUnloadEvent) => { if (dirty.current.size) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("beforeunload", beforeUnload);
    return () => { cancelled = true; mounted.current = false; window.removeEventListener("beforeunload", beforeUnload); if (saveTimer.current) clearTimeout(saveTimer.current); if (collectTimer.current) clearTimeout(collectTimer.current); outputUrls.current.forEach(url => URL.revokeObjectURL(url)); if (dirty.current.size) void flushSave(); };
  }, [flushSave, installRun]);

  const analyze = useCallback(async (selectedPeriod: WeeklyPeriod, browserSource?: WeeklyBrowserSource, files?: File[]) => {
    if (!await flushSave()) { setBusy(""); return; }
    const sequence = ++requestNumber.current;
    setBusy("자료를 대조하고 중복 SKU를 정리하고 있습니다…"); setError(""); setMessage(""); clearDownloads();
    try {
      let body: BodyInit;
      let headers: HeadersInit | undefined;
      if (files?.length) { const form = new FormData(); form.set("action", "analyze"); form.set("period", JSON.stringify(selectedPeriod)); files.forEach(file => form.append("files", file)); body = form; }
      else { headers = { "Content-Type": "application/json" }; body = JSON.stringify({ action: "analyze", period: selectedPeriod, ...(browserSource ? { browserSource } : {}) }); }
      const response = await fetch("/api/wms/weekly-work", { method: "POST", headers, body });
      const data = await response.json() as ApiResult;
      if (!response.ok || !data.success || !data.run) { setDriveReconnect(data.code === "DRIVE_RECONNECT_REQUIRED"); throw new Error(data.error || "자료를 분석하지 못했습니다."); }
      if (sequence !== requestNumber.current || !samePeriod(periodRef.current, selectedPeriod)) return;
      installRun(data.run); setDriveReconnect(false); setFilter("all"); setSearch("");
      setMessage(`실제 입고일 ${selectedPeriod.startDate} ~ ${selectedPeriod.endDate} 기준으로 준비했습니다. 아래 확인할 상품만 검토해 주세요.`);
      if (browserSource) { seenTransfers.current.add(browserSource.transferId); window.postMessage({ type: "NOIDB_INBOUND_EXTENSION_ACK", transferId: browserSource.transferId, accepted: true }, window.location.origin); }
    } catch (failure) { if (sequence === requestNumber.current) setError(failure instanceof Error ? failure.message : "자료를 분석하지 못했습니다."); }
    finally { if (sequence === requestNumber.current) { setBusy(""); collection.current = null; } }
  }, [clearDownloads, flushSave, installRun]);

  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (event.source !== window || event.origin !== window.location.origin || !event.data || typeof event.data !== "object") return;
      const data = event.data;
      const pending = collection.current;
      if (data.type === "NOIDB_WEEKLY_COLLECT_ACK" && pending && pending.requestId === data.requestId) {
        if (collectTimer.current) clearTimeout(collectTimer.current);
        if (data.accepted) { pending.acknowledged = true; setBusy("서플라이 허브에서 선택한 기간의 입고 내역을 가져오고 있습니다…"); }
        else { collection.current = null; setMessage("브라우저 연결을 사용할 수 없어 저장된 입고파일로 준비합니다."); void analyze(pending.period); }
      }
      if (data.type === "NOIDB_WEEKLY_COLLECT_STATUS" && pending && pending.requestId === data.requestId) {
        if (data.status === "error") { collection.current = null; setBusy(""); setError(String(data.message || "입고 내역을 가져오지 못했습니다. 저장된 파일로 준비하거나 다시 시도해 주세요.")); }
        else setBusy(String(data.message || "서플라이 허브에서 입고 자료를 확인하고 있습니다…"));
      }
      if (data.type === "NOIDB_INBOUND_EXTENSION_TRANSFER") {
        const payload = data.payload as WeeklyBrowserSource | undefined;
        if (!payload?.transferId || !Array.isArray(payload.rows) || !Array.isArray(payload.headers) || payload.coverageComplete !== true) return;
        if (seenTransfers.current.has(payload.transferId)) { window.postMessage({ type: "NOIDB_INBOUND_EXTENSION_ACK", transferId: payload.transferId, accepted: true }, window.location.origin); return; }
        if (!pending || pending.requestId !== payload.transferId || !samePeriod(pending.period, payload)) return;
        if (collectTimer.current) clearTimeout(collectTimer.current);
        collection.current = null;
        void analyze(pending.period, payload);
      }
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, [analyze]);

  const staleRules = !!run && run.snapshot.rulesVersion !== WEEKLY_RULES_VERSION;
  const readyRun = run && !staleRules && samePeriod(period, run.snapshot.period) ? run : null;
  const couponExcluded = new Set(readyRun?.couponExcludedSkuIds || []);
  const couponCompletion = readyRun ? weeklyCouponCompletion(readyRun, runs) : undefined;
  const selectedCoupons = readyRun && !couponCompletion && !readyRun.completedAt ? readyRun.snapshot.couponItems.filter(item => !couponExcluded.has(item.skuId)) : [];
  const completedCoupons = readyRun?.couponUploadedAt ? readyRun.snapshot.couponItems.filter(item => !couponExcluded.has(item.skuId)) : [];
  const advertisingSelectionKey = readyRun ? JSON.stringify([readyRun.id, selectedCoupons.map(item => item.skuId)]) : "";
  const advertisingReady = !selectedCoupons.length || advertising?.key === advertisingSelectionKey && !!advertising.data && !advertising.data.missingSkuIds.length && !advertising.data.conflictingSkuIds.length;
  const advertisingLoading = !!selectedCoupons.length && advertising?.key !== advertisingSelectionKey;
  useEffect(() => {
    if (couponSaving.current || !advertisingSelectionKey) return;
    const [runId, skuIds] = JSON.parse(advertisingSelectionKey) as [string, string[]];
    if (!skuIds.length) return;
    const controller = new AbortController();
    setAdvertising(null);
    void (async () => {
      try {
        const response = await fetch(`/api/wms/weekly-work/advertising?runId=${encodeURIComponent(runId)}`, { cache: "no-store", signal: controller.signal });
        const data = await response.json() as AdvertisingPreview & ApiResult;
        if (!response.ok || !data.success) throw new Error(data.error || "광고 옵션ID를 확인하지 못했습니다.");
        const returned = [...data.resolved.map(item => item.skuId), ...data.missingSkuIds, ...data.conflictingSkuIds].sort();
        if (JSON.stringify(returned) !== JSON.stringify([...skuIds].sort())) throw new Error("쿠폰 선택이 변경됐습니다. 광고 옵션ID를 다시 확인해 주세요.");
        if (!controller.signal.aborted) setAdvertising({ key: advertisingSelectionKey, data });
      } catch (failure) {
        if (!controller.signal.aborted) setAdvertising({ key: advertisingSelectionKey, error: failure instanceof Error ? failure.message : "광고 옵션ID를 확인하지 못했습니다." });
      }
    })();
    return () => controller.abort();
  }, [advertisingSelectionKey, advertisingRefresh]);
  const visibleCoupons = readyRun?.snapshot.couponItems.filter(item => !couponSearch.trim() || `${item.skuId} ${item.productName}`.toLowerCase().includes(couponSearch.trim().toLowerCase())) || [];
  const currentReviews = readyRun ? reviews : {};
  const queuedSkuIds = new Set(readyRun?.vendorQueueTransfers?.flatMap(t => t.lines.map(l => l.skuId)) || []);
  const allEntries = useMemo(() => readyRun?.snapshot.vendorItems.map(item => ({ item, review: currentReviews[item.skuId] || defaultReview(item) })) || [], [readyRun, currentReviews]);
  const entries = allEntries.filter(({ item, review }) => {
    if (!readyRun || !weeklyReviewIsActive(readyRun, review, processingOnly)) return false;
    if (processingOnly || readyRun.itemRoutes?.[review.skuId] && !readyRun.itemRoutes[review.skuId].completed) return true;
    if (review.decision === "discontinue") return !runs.some(other => other.id !== readyRun.id && other.discontinueQueueRequestIds?.[review.skuId]?.length);
    return !!weeklyFreshVendorItem(item, runs, readyRun.id);
  });
  const completedEntries = allEntries.flatMap(entry => { const completion = readyRun && weeklyReviewCompletion(readyRun, entry.review); return completion ? [{ ...entry, completion }] : []; });
  const vendorNeeds = entries.filter(entry => reviewNeedsAttention(entry.review) || entry.review.decision === "order" && invalidImages.has(entry.item.skuId));
  const orders = entries.filter(entry => entry.review.decision === "order");
  const discontinued = entries.filter(entry => entry.review.decision === "discontinue");
  const reorders = entries.filter(entry => entry.review.decision === "reorder");
  const reorderNeeds = reorders.filter(entry => reorderNeedsAttention(entry.item));
  const needs = [...vendorNeeds, ...reorderNeeds];
  const held = entries.filter(entry => entry.review.decision === "hold");
  const vendorNames = Array.from(new Set([...knownVendors, ...entries.map(entry => entry.review.vendorName.trim()).filter(Boolean)])).sort((a, b) => a.localeCompare(b, "ko"));
  const orderedVendors = Array.from(new Set(orders.map(entry => entry.review.vendorName.trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b, "ko"));
  const reviewEntries = entries.filter(({ review }) => !(review.decision === "reorder" && readyRun?.generated?.reorderCount));
  const discontinueWork = allEntries.filter(({review}) => review.decision === "discontinue" && !readyRun?.routedElsewhereSkuIds?.includes(review.skuId) && !weeklyReviewCompletion(readyRun!, review));
  const filtered = reviewEntries.filter(({ item, review }) => (filter === "all" || filter === "needs" && (reviewNeedsAttention(review) || review.decision === "order" && invalidImages.has(item.skuId) || review.decision === "reorder" && reorderNeedsAttention(item)) || filter === "reorder" && review.decision === "reorder" || filter === "discontinue" && review.decision === "discontinue" || filter === "hold" && review.decision === "hold") && (!search.trim() || `${item.skuId} ${item.productName} ${item.optionLabel} ${review.vendorName}`.toLowerCase().includes(search.trim().toLowerCase())));
  const visible = filtered.slice(0, visibleLimit);
  const groups = visible.reduce((all, entry) => { const key = entry.review.decision === "discontinue" ? "단종 신청 대상" : entry.review.decision === "reorder" ? "쿠팡 재발주요청" : entry.review.vendorName.trim() || "거래처를 선택해 주세요"; if (!all.has(key)) all.set(key, []); all.get(key)!.push(entry); return all; }, new Map<string, typeof filtered>());
  const disabled = !!busy || loading;
  const outputDisabled = disabled || imageWork > 0 || saveState === "error" || !!readyRun?.snapshot.blockers.length;
  const outputOptions: Array<{ kind: OutputKind; label: string; reason: string; count: number }> = [
    { kind: "marketing", label: "30% 쿠폰·광고등록 엑셀", count: selectedCoupons.length, reason: !selectedCoupons.length ? "대상 없음" : !advertisingReady ? "광고 옵션ID 확인 필요" : "" },
    { kind: "reorder", label: "미납발주건 재발주요청 엑셀", count: reorders.length, reason: !reorders.length ? "대상 없음" : reorderNeeds.length ? "발주별 수량 확인 필요" : "" },
  ];
  const reviewImageWork = useCallback((delta: number) => setImageWork(value => Math.max(0, value + delta)), []);
  const reportImageFailure = useCallback((skuId: string) => setInvalidImages(previous => previous.has(skuId) ? previous : new Set([...previous, skuId])), []);

  async function syncDiscontinueQueue(navigate = true) {
    if (disabled || imageWork || !await flushSave()) return;
    const current=runRef.current;
    if (!current) return;
    setBusy("단종관리로 보내고 있습니다…"); setError("");
    try {
      const response=await fetch("/api/wms/weekly-work", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({action:"transfer-discontinue",runId:current.id,expectedRevision:current.revision}) });
      const data=await response.json() as ApiResult;
      if(!response.ok || !data.success || !data.run)throw new Error(data.error || "단종대기를 불러오지 못했습니다.");
      installRun(data.run); if (navigate) window.location.assign("/wms/vendor-orders/status-requests");
    } catch(failure) { setError(failure instanceof Error ? failure.message : "단종대기를 불러오지 못했습니다."); await refreshCurrent(current.id).catch(()=>undefined); }
    finally { setBusy(""); }
  }

  async function openVendorQueue() {
    if (disabled || imageWork || !await flushSave()) return;
    const current = runRef.current;
    if (!current) return;
    setBusy("발주관리로 보내는 중…"); setError("");
    try {
      const response = await fetch("/api/wms/vendor-orders/queue", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ runId: current.id, expectedRevision: current.revision }) });
      const data = await response.json();
      if (!response.ok || !data.success || !data.run) throw new Error(data.error || "발주대기로 이동하지 못했습니다.");
      installRun(data.run);
      window.location.assign("/wms/vendor-orders/manage");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "발주대기로 이동하지 못했습니다."); await refreshCurrent(current.id).catch(() => undefined); }
    finally { setBusy(""); }
  }

  async function routeItem(skuId: string, decision: WeeklyReview["decision"]) {
    if (routing.current || disabled || imageWork) return;
    if (decision === "hold") { changeReview(skuId, { decision }); return; }
    routing.current = true;
    try {
      if (!await flushSave()) return;
      const current = runRef.current;
      if (!current) return;
      setBusy(`SKU ${skuId} 이동 중…`); setError("");
      const response = await fetch("/api/wms/weekly-work/route-item", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ runId: current.id, expectedRevision: current.revision, skuId, decision }) });
      const data = await response.json() as ApiResult;
      if (!response.ok || !data.success || !data.run) throw new Error(data.error || "이동하지 못했습니다. 같은 처리 방법으로 다시 시도해 주세요.");
      installRun(data.run); clearDownloads();
      setMessage(`SKU ${skuId} · ${decision === "order" ? "거래처 발주관리" : decision === "discontinue" ? "단종·해제 관리" : "재발주요청 대기"}로 이동했습니다.`);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "이동하지 못했습니다. 다시 시도해 주세요.");
      if (runRef.current) await refreshCurrent(runRef.current.id).catch(() => undefined);
    } finally { routing.current = false; setBusy(""); }
  }

  function updatePeriod(next: WeeklyPeriod, nextPreset = "custom") { setPeriod(next); periodRef.current = next; setPreset(nextPreset); clearDownloads(); setMessage(""); setError(""); }
  async function prepare() {
    if (disabled || imageWork) return;
    if (!period.startDate || !period.endDate || period.startDate > period.endDate) { setError("시작일과 종료일을 확인해 주세요."); return; }
    if (!await flushSave()) return;
    const requestId = `weekly-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    collection.current = { requestId, period: { ...period }, acknowledged: false };
    setError(""); setMessage(""); setBusy("브라우저 연결을 확인하고 있습니다…");
    window.postMessage({ type: "NOIDB_WEEKLY_COLLECT_REQUEST", requestId, startDate: period.startDate, endDate: period.endDate }, window.location.origin);
    collectTimer.current = setTimeout(() => { const pending = collection.current; if (pending?.requestId === requestId && !pending.acknowledged) { collection.current = null; void analyze(pending.period); } }, 3000);
  }

  async function chooseRun(id: string) {
    const next = runs.find(item => item.id === id); if (!next || disabled || imageWork) return;
    if (!await flushSave()) return;
    const selected = runRef.current?.id === id ? runRef.current : next;
    installRun(selected); updatePeriod(selected.snapshot.period); setFilter("all"); setSearch("");
  }

  async function refreshCurrent(id: string) {
    const response = await fetch("/api/wms/weekly-work", { cache: "no-store" });
    const data = await response.json() as WeeklyWorkspace & ApiResult;
    if (!response.ok || !data.success) throw new Error("파일은 생성했지만 작업 이력을 다시 불러오지 못했습니다. 화면을 새로 열어 주세요.");
    const next = data.runs.find(item => item.id === id);
    if (!next) throw new Error("작업 이력을 찾지 못했습니다. 화면을 새로 열어 주세요.");
    installRun(next);
  }

  async function selectCoupons(excludedSkuIds: string[]) {
    if (!readyRun || disabled || imageWork || readyRun.couponUploadedAt || couponSaving.current) return;
    couponSaving.current = true;
    setBusy("쿠폰 선택을 저장하고 있습니다…"); setError(""); setMessage("");
    let current: WeeklyRun | null = null;
    try {
      if (!await flushSave()) return;
      current = runRef.current;
      if (!current) return;
      setRun({ ...current, couponExcludedSkuIds: excludedSkuIds }); clearDownloads();
      const response = await fetch("/api/wms/weekly-work", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "coupon-selection", runId: current.id, expectedRevision: current.revision, excludedSkuIds }) });
      const data = await response.json() as ApiResult;
      if (!response.ok || !data.success || !data.run) throw new Error(data.error || "쿠폰 선택을 저장하지 못했습니다.");
      installRun(data.run);
    } catch (failure) {
      if (current) { installRun(current); try { await refreshCurrent(current.id); } catch { /* Keep the last confirmed selection. */ } }
      setError(failure instanceof Error ? failure.message : "쿠폰 선택을 저장하지 못했습니다.");
    } finally { couponSaving.current = false; setAdvertisingRefresh(value => value + 1); setBusy(""); }
  }

  async function generate(selection: OutputKind | OutputKind[]) {
    if (!readyRun || outputDisabled || outputLock.current) return;
    const kinds = Array.isArray(selection) ? selection : [selection];
    if (!kinds.length) return;
    outputLock.current = true;
    clearDownloads(); setError(""); setMessage("");
    const progress = (value: string) => { setBusy(value); setOutputProgress(value); };
    progress("검토 내용을 저장하고 파일을 준비하고 있습니다…");
    const preparedFiles: WeeklyDownload[] = [];
    let current = runRef.current!;
    try {
      if (!await flushSave()) throw new Error("검토 내용을 저장하지 못했습니다. 저장 후 다시 받아 주세요.");
      current = runRef.current!;
      const JSZip = (await import("jszip")).default;
      const combined = new JSZip();
      let name = "주간업무_" + current.snapshot.period.startDate + "_" + current.snapshot.period.endDate + "_선택.zip";
      for (const [index, kind] of kinds.entries()) {
        const label = outputOptions.find(option => option.kind === kind)?.label || (kind === "all" ? "전체 파일" : "쿠폰 엑셀");
        progress((index + 1) + "/" + kinds.length + " · " + label + " 생성 중…");
        const response = await fetch("/api/wms/weekly-work/output", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ runId: current.id, expectedRevision: current.revision, kind }) });
        if (!response.ok) { const data = await response.json().catch(() => ({})); throw new Error(data.error || "파일을 만들지 못했습니다."); }
        if (kinds.length === 1) {
          name = response.headers.get("X-NOIDB-File-Name") || name;
          try { name = decodeURIComponent(name); } catch { /* Keep the literal filename. */ }
        }
        progress((index + 1) + "/" + kinds.length + " · " + label + " 사진·파일 확인 중…");
        const prepared = await prepareWeeklyDownload(await response.blob());
        preparedFiles.push(...prepared.files);
        const outputKey = response.headers.get("X-NOIDB-Output-Key");
        if (!outputKey) throw new Error("생성파일 확인 정보가 없습니다. 다시 생성해 주세요.");
        const archive = await JSZip.loadAsync(await prepared.blob.arrayBuffer());
        for (const entry of Object.values(archive.files)) if (!entry.dir) combined.file(entry.name, await entry.async("arraybuffer"));
        const acknowledge = await fetch("/api/wms/weekly-work", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "generated", runId: current.id, expectedRevision: current.revision, outputKey }) });
        const acknowledged = await acknowledge.json() as ApiResult;
        if (!acknowledge.ok || !acknowledged.success || !acknowledged.run) throw new Error(acknowledged.error || "생성한 파일을 기록하지 못했습니다. 다시 생성해 주세요.");
        current = acknowledged.run;
        installRun(current);
      }
      progress("선택한 파일을 ZIP 하나로 묶고 있습니다…");
      const blob = new Blob([await combined.generateAsync({ type: "arraybuffer", compression: "DEFLATE" })], { type: "application/zip" });
      const url = URL.createObjectURL(blob);
      outputUrls.current = [...preparedFiles.map(file => file.url), url];
      setDownloads(preparedFiles); setBundle({ name, url });
      downloadBlobPreservingPage(blob, name);
      setOutputProgress("파일 " + preparedFiles.length + "개 준비 완료 · ZIP 다운로드를 요청했습니다.");
      return true;
    } catch (failure) {
      preparedFiles.forEach(file => URL.revokeObjectURL(file.url));
      const detail = failure instanceof Error ? failure.message : "파일을 만들지 못했습니다.";
      setOutputProgress(""); setOutputError(detail); setError(detail);
      if (failure && typeof failure === "object" && "skuIds" in failure && Array.isArray(failure.skuIds)) { setInvalidImages(previous => new Set([...previous, ...failure.skuIds as string[]])); setFilter("all"); setSearch(""); }
      try { await refreshCurrent(current.id); } catch { /* Preserve the original error. */ }
    } finally { outputLock.current = false; setBusy(""); }
  }

  async function generateDiscontinue() {
    if (await generate("discontinue")) await syncDiscontinueQueue(false);
  }

  async function markStatus(kind: "coupon" | "discontinue" | "vendor" | "complete" | "reorder", vendorName?: string) {
    if (!readyRun || disabled || imageWork || !await flushSave()) return;
    const current = runRef.current!;
    setBusy("처리 완료를 기록하고 있습니다…"); setError("");
    try {
      const response = await fetch("/api/wms/weekly-work", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "status", runId: current.id, expectedRevision: current.revision, kind, ...(kind === "coupon" ? { couponStartsOn, couponExpiresOn } : {}), ...(vendorName ? { vendorName } : {}) }) });
      const data = await response.json() as ApiResult;
      if (!response.ok || !data.success || !data.run) throw new Error(data.error || "처리 상태를 기록하지 못했습니다.");
      installRun(data.run); clearDownloads();
      if (kind === "coupon") requestAnimationFrame(() => document.getElementById("weekly-review-title")?.scrollIntoView({ behavior: "smooth", block: "start" }));
      setMessage(kind === "complete" ? "이번 주간 업무를 완료로 기록했습니다. 다음에는 최근 일주일로 시작합니다." : "처리 완료를 저장했습니다. 완료한 항목은 목록에서 제외하고 아래 완료 이력에 보관했습니다.");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "처리 상태를 기록하지 못했습니다.");
      try { await refreshCurrent(current.id); } catch { /* Preserve the original error for a safe retry. */ }
    }
    finally { setBusy(""); }
  }

  if (processingOnly) return <main className={styles.page}>
    <div className={styles.topLinks}><a href="/wms/inbound">← 새 미입고 검토</a><a href="/wms/vendor-orders/manage">거래처 발주관리</a><a href="/wms/vendor-orders/status-requests">단종관리</a></div>
    <header className={styles.header}><div><h1>재발주요청 대기</h1><p>재발주요청으로 선택한 상품은 여기에 보관됩니다. 쿠팡에서 실제 요청을 마친 뒤 완료를 기록하세요.</p></div></header>
    {error ? <p className={styles.error} role="alert">{error}</p> : null}
    {busy ? <p role="status">{busy}</p> : null}
    {message ? <p role="status">{message}</p> : null}
    <label className={styles.field}><span>처리할 작업</span><select aria-label="재발주요청 작업" value={run?.id || ""} disabled={disabled} onChange={event => void chooseRun(event.target.value)}><option value="">작업 선택</option>{weeklyReorderQueueRuns(runs).map(item => <option key={item.id} value={item.id}>{item.snapshot.period.startDate} ~ {item.snapshot.period.endDate} · {formatTime(item.snapshot.createdAt)} · {item.reorderRequestedAt ? "요청 완료" : "요청 대기"}</option>)}</select></label>
    {readyRun ? <section><h2>재발주요청 {reorders.length}개 SKU</h2><p>발주번호별 미납수량으로 생성합니다. 요청입고예정일은 생성일 다음 첫 금요일입니다.</p>
      <div className={styles.couponTable}><table><thead><tr><th>SKU</th><th>상품명</th><th>발주번호 · 미납수량</th></tr></thead><tbody>{reorders.map(({item}) => <tr key={item.skuId}><td>{item.skuId}</td><td>{item.productName}</td><td>{item.shortageDetails?.map(detail => <div key={detail.purchaseOrderNumber}>{detail.purchaseOrderNumber} · {detail.shortageQuantity}개</div>)}</td></tr>)}</tbody></table></div>
      <div className={styles.inlineActions}><button className={styles.primary} disabled={outputDisabled || !reorders.length || reorderNeeds.length > 0} onClick={() => void generate("reorder")}>재발주요청 파일 받기</button><a href="https://supplier.coupang.com/plan/ticket/reportIssue/Reorder" target="_blank" rel="noreferrer">쿠팡 재발주요청 화면 ↗</a><button className={styles.secondary} disabled={disabled || !reorders.length || !readyRun.generated?.reorderCount} onClick={() => void markStatus("reorder")}>쿠팡 재발주 요청 완료</button></div>
      {bundle ? <a href={bundle.url} download={bundle.name}>생성한 파일 다시 받기</a> : null}
      {readyRun.reorderRequestedAt ? <p>요청 완료 · {formatTime(readyRun.reorderRequestedAt)}</p> : null}
    </section> : <p>{loading ? "불러오는 중…" : "재발주요청 대기 작업이 없습니다."}</p>}
  </main>;

  return <main className={styles.page}>
    <div className={styles.topLinks} style={{ flexWrap: "wrap" }}><a href="/wms/work-center">← 작업센터</a><a href="/downloads/noidb-weekly-work-manual-v1.4.pdf" target="_blank" rel="noreferrer">사용설명서 PDF ↗</a><a href="/wms/vendor-orders/manage">거래처 발주관리 ↗</a><a href="/wms/inbound/reorder">재발주요청 대기 ↗</a><a href="/wms/vendor-orders/status-requests">단종관리 ↗</a></div>
    <header className={styles.header}><div><p className={styles.eyebrow}>NOID-B · WEEKLY WORK</p><h1>주간 업무</h1><p className={styles.lead}>입고 확인부터 쿠폰, 거래처 발주, 재발주요청, 단종 신청까지 한곳에서.</p></div><span className={styles.weeklyBadge}>매주 한 번, 세 단계</span></header>
    <ol className={styles.steps} aria-label="주간 업무 진행 순서"><li className={styles.activeStep}><span>1</span> 기간·자료 준비</li><li className={readyRun ? styles.activeStep : ""}><span>2</span> 확인할 상품 검토</li><li className={readyRun?.generated ? styles.activeStep : ""}><span>3</span> 파일 받기·완료</li></ol>

    {error ? <div className={styles.error} role="alert"><strong>확인이 필요합니다</strong><p>{error}</p>{saveState === "error" ? <button type="button" className={styles.secondary} disabled={disabled} onClick={() => { setError(""); void flushSave(); }}>검토 내용 다시 저장</button> : null}</div> : null}
    {message ? <p className={styles.message} role="status">{message}</p> : null}
    {busy ? <div className={styles.busy} role="status"><span className={styles.spinner} aria-hidden="true" />{busy}{collection.current?.acknowledged ? <button type="button" className={styles.textButton} onClick={() => { collection.current = null; setBusy(""); setMessage("자료 수집 대기를 끝냈습니다. 저장된 입고파일로 준비할 수 있습니다."); }}>대기 끝내기</button> : null}</div> : null}

    <section className={styles.panel} aria-labelledby="weekly-period-title">
      <div className={styles.sectionHeading}><div><span className={styles.stepNumber}>01</span><h2 id="weekly-period-title">이번에 처리할 기간</h2></div>{runs.length ? <label className={styles.historySelect}><span>지난 작업 이어보기</span><select aria-label="지난 주간 작업" disabled={disabled || imageWork > 0} value={run?.id || ""} onChange={event => void chooseRun(event.target.value)}><option value="">작업 선택</option>{runs.map(item => <option key={item.id} value={item.id}>{item.snapshot.period.startDate} ~ {item.snapshot.period.endDate} · {item.completedAt ? "완료" : "진행 중"}</option>)}</select></label> : null}</div>
      <div className={styles.periodRow}><div className={styles.presets} aria-label="기간 빠른 선택"><button type="button" aria-pressed={preset === "week"} className={preset === "week" ? styles.selected : ""} disabled={disabled || imageWork > 0} onClick={() => updatePeriod(recentPeriod(7), "week")}>최근 일주일</button><button type="button" aria-pressed={preset === "month"} className={preset === "month" ? styles.selected : ""} disabled={disabled || imageWork > 0} onClick={() => updatePeriod(recentMonthPeriod(), "month")}>최근 한 달</button></div><div className={styles.dateRange}><label><span>실제 입고일 시작</span><input aria-label="실제 입고 시작일" type="date" value={period.startDate} max={period.endDate} disabled={disabled || imageWork > 0} onChange={event => updatePeriod({ ...period, startDate: event.target.value })} /></label><span aria-hidden="true">—</span><label><span>실제 입고일 종료</span><input aria-label="실제 입고 종료일" type="date" value={period.endDate} min={period.startDate} max={recentPeriod(1).endDate} disabled={disabled || imageWork > 0} onChange={event => updatePeriod({ ...period, endDate: event.target.value })} /></label></div><button type="button" className={styles.primary} disabled={disabled || imageWork > 0} onClick={() => void prepare()}>{loading ? "이전 작업 확인 중…" : readyRun ? "최신 자료로 다시 확인" : "이 기간 업무 준비"}<span aria-hidden="true"> →</span></button></div>
      <p className={styles.help}>쿠폰은 <strong>실제 입고일</strong> 기준으로 선택 기간의 <strong>입고수량 합계가 정확히 1개인 SKU</strong>만 모읍니다. 쿠폰 적용 여부는 아래에서 직접 선택합니다. 브라우저가 연결되어 있으면 서플라이 허브에서 가져오고, 연결이 없으면 Drive의 입고파일을 확인합니다.</p>
      {driveReconnect ? <p className={styles.inlineError}>Drive 연결이 만료되었습니다. <a href="/api/auth/google-drive/start" target="_blank" rel="noreferrer">Google Drive 다시 연결 ↗</a></p> : null}
      <details className={styles.sourceOptions}><summary>이미 받은 파일 사용 · 브라우저 연결 안내</summary><p>입고상세내역 XLSX 파일을 여러 개 선택해도 선택한 기간으로 함께 분석합니다.</p><div className={styles.inlineActions}><button type="button" className={styles.secondary} disabled={disabled || imageWork > 0} onClick={() => uploadInput.current?.click()}>입고상세내역 파일 선택</button><button type="button" className={styles.secondary} disabled={disabled || imageWork > 0} onClick={() => void analyze(period)}>Drive에 저장된 파일로 준비</button><a href="https://supplier.coupang.com/scm/receive/detail" target="_blank" rel="noreferrer">서플라이 허브 입고상세내역 ↗</a><a href="/api/auth/google-drive/start" target="_blank" rel="noreferrer">Google Drive 다시 연결 ↗</a><a href="/downloads/noidb-supplier-sync.zip" download>브라우저 연결 확장 다운로드 ↓</a></div><input ref={uploadInput} type="file" accept=".xlsx" multiple hidden aria-label="입고상세내역 파일 선택" onChange={event => { const files = Array.from(event.target.files || []); if (files.some(file => !/\.xlsx$/i.test(file.name))) setError("입고상세내역 XLSX 파일을 선택해 주세요."); else if (files.length) void analyze(period, undefined, files); event.target.value = ""; }} /><p>자동 가져오기는 NOID-B 브라우저 연결 확장 프로그램이 필요합니다. 처음 한 번 설치하거나 기존 확장을 업데이트한 뒤 이 화면을 새로고침해 주세요. 로그인이나 본인 인증 화면이 열리면 직접 진행해 주세요.</p></details>
      {run && !readyRun ? <p className={styles.periodChanged}>{staleRules ? <>쿠폰·미입고 기준이 변경되었습니다. 이전 작업을 계속하려면 <strong>이 기간 업무 준비</strong>를 눌러 새 기준으로 다시 확인하세요.</> : <>기간이 바뀌었습니다. <strong>이 기간 업무 준비</strong>를 눌러 새 결과를 확인하세요.</>}</p> : null}
    </section>

    <section className={styles.panel} aria-label="매주 처리 순서">
      <strong>매주 이 순서로 완료하세요</strong>
      <p className={styles.help}>정규 실행일은 매주 수요일, 대상은 전날 화요일까지의 입고분입니다. 이미 처리한 날짜가 있으면 그 다음 날부터 시작하세요.</p>
      <ol><li>지난 종료일 다음 날부터 이번 종료일까지 입고상세내역을 내려받고 같은 기간으로 업무를 준비합니다.</li><li>쿠폰 대상과 미입고 처리 방법을 검토하고 필요한 파일을 받습니다.</li><li>쿠팡 쿠폰 등록·계약 상태와 종료일을 확인하고, 재발주요청·단종 신청 및 거래처 발송을 실제로 처리합니다.</li><li>아래에서 각 <strong>실제 처리 완료</strong>를 기록한 뒤 <strong>이번 주간 업무 완료</strong>를 누릅니다.</li></ol>
      <p className={styles.help}>파일 다운로드만으로는 완료되지 않습니다. 일부 상품만 성공했다면 전체 완료를 누르지 말고 실패 항목을 먼저 확인하세요. 화면 밖에서 새로 등록하거나 기간을 변경한 쿠폰은 ‘기존 쿠폰 중복 관리’에도 반영하세요.</p>
      <a href="/downloads/weekly-work-checklist.md" target="_blank" rel="noreferrer">매주 업무 체크리스트 보기 ↗</a>
    </section>
    <WeeklyCouponHistory disabled={disabled || imageWork > 0 || saveState !== "saved"} onSaved={() => { clearDownloads(); setRun(null); runRef.current = null; setReviews({}); reviewsRef.current = {}; setMessage("쿠폰 이력을 저장했습니다. 위에서 이 기간 업무 준비를 눌러 중복을 다시 대조하세요."); }} />
    {!readyRun ? <section className={styles.emptyStart}><span className={styles.emptySymbol} aria-hidden="true">✓</span><h2>파일을 날짜마다 만들 필요 없어요.</h2><p>기간을 정해 한 번 준비하면<br />30% 쿠폰, 거래처별 발주, 재발주요청, 단종 신청을 이어서 처리할 수 있습니다.</p></section> : <>
      <section className={styles.sourceSummary} aria-label="확인한 입고 자료"><div><span>분석 기간 · 실제 입고일 기준</span><strong>{readyRun.snapshot.period.startDate} ~ {readyRun.snapshot.period.endDate}</strong></div><div><span>자료의 최신 실제 입고일</span><strong>{readyRun.snapshot.source.latestActualDate || "입고 기록 없음"}</strong></div><div><span>확인한 시각</span><strong>{formatTime(readyRun.snapshot.createdAt)}</strong></div><details><summary>{readyRun.snapshot.source.mode === "browser" ? "서플라이 허브" : readyRun.snapshot.source.mode === "upload" ? "직접 선택한 파일" : "Drive 입고파일"} · 자료 확인</summary><p>선택 기간 입고·반출 기록 {readyRun.snapshot.source.selectedEventCount.toLocaleString()}건 · 겹친 기록 {readyRun.snapshot.source.duplicateCount.toLocaleString()}건 제외</p>{readyRun.snapshot.source.files.map((file, index) => <p key={`${index}-${file}`}>{file}</p>)}</details></section>
      {readyRun.snapshot.blockers.length ? <div className={styles.error} role="alert"><strong>자료를 다시 확인해야 파일을 만들 수 있습니다.</strong>{readyRun.snapshot.blockers.map((item, index) => <p key={`${index}-${item}`}>{item}</p>)}</div> : null}
      {readyRun.snapshot.warnings.length ? <details className={styles.warnings}><summary>자료 확인 안내 {readyRun.snapshot.warnings.length}건</summary>{readyRun.snapshot.warnings.map((item, index) => <p key={`${index}-${item}`}>{item}</p>)}</details> : null}
      {readyRun.snapshot.source.purchaseFiles?.length ? <details className={styles.sourceOptions}><summary>업로드 발주서 원문 확인 · {readyRun.snapshot.source.purchaseFiles.length}개 파일</summary><p>발주서의 업체납품가능수량과 입고상세내역의 실제 누적 입고를 대조했습니다. 기존 이력에 없던 발주 상품행 {readyRun.snapshot.source.supplementedPurchaseRows || 0}건을 원문으로 연결했습니다.</p>{readyRun.snapshot.source.purchaseFiles.map(file => <p key={file}>{file}</p>)}</details> : null}
      {readyRun.snapshot.unresolvedItems?.length ? <details className={styles.warnings}><summary>자료 확인 필요 · {readyRun.snapshot.unresolvedItems.length}개 SKU · 미납 목록에서 제외</summary><p>확정수량이나 실제 누적 입고수량을 정확히 대조하지 못한 상품입니다. 미납 건수와 거래처 발주·재발주요청 파일에 포함하지 않습니다.</p>{readyRun.snapshot.unresolvedItems.map(item => <div key={item.skuId}><p><strong>SKU {item.skuId} · {item.productName}</strong><br />발주번호 {item.relatedPurchaseOrderNumbers.join(", ")}</p>{item.issues.map((issue, index) => <p key={index}>{issue}</p>)}</div>)}</details> : null}
      <div className={styles.overview}><div className={styles.couponSummary}><span>30% 쿠폰 · 선택한 상품</span><strong>{selectedCoupons.length.toLocaleString()}<small>개 SKU</small></strong></div><div><span>거래처 발주 후보</span><strong>{orders.length.toLocaleString()}<small>개 SKU · {orderedVendors.length}개 거래처</small></strong></div><div><span>확인할 상품</span><strong className={needs.length ? styles.warningNumber : ""}>{needs.length.toLocaleString()}<small>개 SKU</small></strong></div><div><span>재발주요청 · 재고 있음</span><strong>{reorders.length.toLocaleString()}<small>개 SKU</small></strong></div><div><span>단종 신청</span><strong>{discontinued.length.toLocaleString()}<small>개 SKU</small></strong></div></div>

      {couponCompletion ? <p role="status" className={styles.help}>쿠폰·광고 업무 완료 · {couponCompletion.couponStartsOn} ~ {couponCompletion.couponExpiresOn}</p> : null}
      {!couponCompletion && !readyRun.completedAt && readyRun.snapshot.couponItems.length > 0 ? <section className={styles.panel} aria-labelledby="weekly-coupon-title">
        <div className={styles.sectionHeading}><div><span className={styles.stepNumber}>02</span><h2 id="weekly-coupon-title">쿠폰 적용 상품을 선택하세요</h2></div><span className={styles.saveState} role="status">{couponSaving.current ? "쿠폰 선택 저장 중…" : readyRun.couponUploadedAt ? "쿠팡 등록 완료 · 선택 고정" : "✓ 쿠폰 선택 저장됨"}</span></div>
        <p className={styles.help}>선택 기간에 실제 입고된 수량을 SKU별로 합쳐 <strong>정확히 1개인 상품</strong>만 표시합니다. 곧 단종되거나 생산 계획이 없는 상품은 체크를 해제하세요. <strong>체크한 SKU만 30% 쿠폰 엑셀에 들어갑니다.</strong></p>
        <div className={styles.couponControls}><strong>쿠폰 적용 {selectedCoupons.length}개 <span>· 제외 {readyRun.snapshot.couponItems.length - selectedCoupons.length}개</span></strong><div className={styles.inlineActions}><button type="button" className={styles.secondary} disabled={disabled || imageWork > 0 || !!readyRun.couponUploadedAt || !couponExcluded.size} onClick={() => void selectCoupons([])}>전체 선택</button><button type="button" className={styles.secondary} disabled={disabled || imageWork > 0 || !!readyRun.couponUploadedAt || !selectedCoupons.length} onClick={() => void selectCoupons(readyRun.snapshot.couponItems.map(item => item.skuId))}>전체 해제</button></div><input className={styles.search} type="search" aria-label="쿠폰 SKU 또는 상품명 검색" placeholder="SKU, 상품명 검색" value={couponSearch} onChange={event => setCouponSearch(event.target.value)} /></div>
        {visibleCoupons.length ? <div className={styles.couponTable}><table><thead><tr><th scope="col">쿠폰 적용</th><th scope="col">SKU</th><th scope="col">상품명</th><th scope="col">기간 입고</th></tr></thead><tbody>{visibleCoupons.map(item => <tr key={item.skuId} className={couponExcluded.has(item.skuId) ? styles.couponExcluded : ""}><td><label className={styles.couponChoice}><input type="checkbox" aria-label={"SKU " + item.skuId + " 쿠폰 적용"} checked={!couponExcluded.has(item.skuId)} disabled={disabled || imageWork > 0 || !!readyRun.couponUploadedAt} onChange={event => void selectCoupons(event.target.checked ? [...couponExcluded].filter(skuId => skuId !== item.skuId) : [...couponExcluded, item.skuId])} /><span>{couponExcluded.has(item.skuId) ? "제외" : "적용"}</span></label></td><td>{item.skuId}</td><td>{item.productName}{item.productLink ? <> <a href={item.productLink} target="_blank" rel="noreferrer" aria-label={item.productName + " 제품 정보 확인"}>↗</a></> : null}</td><td>1개</td></tr>)}</tbody></table></div> : <p className={styles.help}>{couponSearch.trim() ? "검색한 상품이 없습니다." : "선택 기간에 입고수량 합계가 1개인 미등록 쿠폰 대상이 없습니다."}</p>}
        <p className={styles.help}>체크 해제는 이번 작업의 쿠폰 대상에서만 제외합니다. 입고 기록이나 상품의 단종 상태는 변경하지 않습니다. 이 업무를 완료하면 제외한 상품도 같은 입고 건으로 다시 나오지 않습니다.</p>
        <div className={styles.advertisingSummary} aria-live="polite">
          <strong>선택한 쿠폰 SKU의 광고등록 파일</strong>
          <p>옵션ID만 500개씩 나눠 <b>3-1_광고등록.xlsx, 3-2_광고등록.xlsx…</b>로 함께 만듭니다. 같은 옵션ID는 한 번만 넣습니다.</p>
          {advertisingLoading ? <p>광고 옵션ID를 확인하고 있습니다…</p> : advertising?.key === advertisingSelectionKey && advertising.error ? <p className={styles.inlineError}>{advertising.error}</p> : advertising?.key === advertisingSelectionKey && advertising.data ? <>
            <p>옵션ID 연결 {advertising.data.resolved.length}개 SKU · 광고 대상 {advertising.data.optionIds.length}개 · 광고파일 {Math.ceil(advertising.data.optionIds.length / 500)}개</p>
            {advertising.data.missingSkuIds.length || advertising.data.conflictingSkuIds.length ? <details className={styles.warnings}><summary>옵션ID 확인 필요 {advertising.data.missingSkuIds.length + advertising.data.conflictingSkuIds.length}개 SKU</summary><p>모든 선택 SKU의 옵션ID가 확인되어야 쿠폰·광고 파일을 함께 만들 수 있습니다. 쿠폰만 먼저 받을 수도 있습니다.</p>{advertising.data.missingSkuIds.map(skuId => <p key={skuId}>SKU {skuId} · 옵션ID 없음 · {selectedCoupons.find(item => item.skuId === skuId)?.productName}</p>)}{advertising.data.conflictingSkuIds.map(skuId => <p key={skuId}>SKU {skuId} · 옵션ID 불일치 · {selectedCoupons.find(item => item.skuId === skuId)?.productName}</p>)}</details> : null}
          </> : null}
          <div className={styles.inlineActions}><button type="button" className={styles.secondary} disabled={outputDisabled || !selectedCoupons.length || !advertisingReady} onClick={() => void generate("marketing")}>쿠폰·광고 파일 함께 받기</button><button type="button" className={styles.secondary} disabled={outputDisabled || !selectedCoupons.length} onClick={() => void generate("coupon")}>쿠폰만 받기</button><button type="button" className={styles.secondary} disabled={advertisingLoading || disabled || !selectedCoupons.length} onClick={() => setAdvertisingRefresh(value => value + 1)}>광고 옵션ID 다시 확인</button></div>
          <div className={styles.couponCompletion}>
            <strong>쿠팡 등록 후 여기에서 완료하세요</strong>
            <label className={styles.field}><span>쿠폰 시작일</span><input type="date" aria-label="쿠팡 쿠폰 시작일" value={couponStartsOn} max={couponExpiresOn || undefined} disabled={disabled} onChange={event => setCouponStartsOn(event.target.value)} /></label>
            <label className={styles.field}><span>쿠폰 종료일</span><input type="date" aria-label="쿠팡 쿠폰 종료일" value={couponExpiresOn} min={couponStartsOn || undefined} disabled={disabled} onChange={event => setCouponExpiresOn(event.target.value)} /></label>
            <small>쿠팡에 등록한 쿠폰 기간을 입력하세요. 쿠폰 등록·계약과 광고 등록을 마친 뒤 처리완료를 누르면 아래 미입고 검토 단계로 이동합니다.</small>
            <button type="button" className={styles.primary} disabled={disabled || imageWork > 0 || !readyRun.generated?.couponCount || !couponStartsOn || !couponExpiresOn || couponStartsOn > couponExpiresOn} onClick={() => void markStatus("coupon")}>{readyRun.generated?.advertisingCount ? "쿠폰·광고 처리완료 → 다음 단계" : "쿠폰 처리완료 → 다음 단계"}</button>
          </div>
        </div>
      </section> : null}

      <section className={styles.panel} aria-labelledby="weekly-review-title"><div className={styles.sectionHeading}><div><span className={styles.stepNumber}>02</span><h2 id="weekly-review-title">미입고 상품을 검토하세요</h2></div><span className={saveState === "error" ? styles.saveError : styles.saveState} role="status">{imageWork > 0 ? "사진 저장 중…" : saveState === "saved" ? "✓ 검토 내용 저장됨" : saveState === "pending" ? "변경 내용 저장 대기…" : saveState === "saving" ? "자동 저장 중…" : "저장 실패 · 다시 저장 필요"}</span></div><p className={styles.help}><strong>실제 입고가 확인된 발주서에서, 확정수량보다 입고가 적거나 0인 SKU</strong>만 대조합니다. 아직 입고가 전혀 잡히지 않은 발주서는 제외합니다. 확정수량과 실제 누적 입고를 정확히 대조하지 못한 상품은 별도 자료 확인 안내로 옮기며, 미납 목록과 발주 파일에서 제외합니다. 실제 미입고 수량을 확인하고 처리 방법을 선택하세요. 거래처 발주수량과 사진·거래처는 통합 발주대기에서 수정할 수 있습니다. 재고가 있지만 출고하지 못한 상품은 <strong>재발주요청 · 재고 있음</strong>으로 선택하세요. 생산이 끝난 상품은 처리 방법을 <strong>단종 · 생산 종료</strong>로 바꾸면 됩니다. 쿠폰 파일은 이 검토와 별도로 받을 수 있습니다.</p>

        <p className={styles.help}>처리 방법을 선택하면 해당 대기 목록에 바로 저장되고 여기에서는 사라집니다. 화면은 이동하지 않습니다. 재발주요청은 <a href="/wms/inbound/reorder">재발주요청 대기</a>에서 확인할 수 있습니다.</p><div className={styles.reviewToolbar}><div className={styles.filters} aria-label="상품 필터">{[["needs", "확인 필요", needs.length], ["all", "전체", reviewEntries.length], ["discontinue", "단종", discontinued.length], ["hold", "보류", held.length]].map(([key, label, count]) => <button key={key} type="button" className={filter === key ? styles.selected : ""} aria-pressed={filter === key} onClick={() => setFilter(String(key))}>{label} <span>{count}</span></button>)}</div><input type="search" className={styles.search} value={search} placeholder="SKU, 상품명, 거래처 검색" aria-label="검토 상품 검색" onChange={event => setSearch(event.target.value)} /></div>
        {!filtered.length ? <div className={styles.reviewEmpty}><strong>{filter === "needs" && !search ? "현재 목록에 검토할 미납 상품이 없습니다." : "해당하는 상품이 없습니다."}</strong><p>{filter === "needs" && entries.length ? "전체 탭에서 다시 확인하거나 아래에서 필요한 파일을 받으세요." : "선택한 기간과 자료를 확인해 주세요."}</p></div> : Array.from(groups, ([vendor, rows]) => <section key={vendor} className={styles.vendorGroup}><div className={styles.vendorHeading}><h3>{vendor}</h3><span>{rows.length}개 SKU</span></div>{rows.map(({ item, review }) => <ProductReviewCard key={item.skuId} item={item} review={review} vendors={vendorNames} disabled={disabled || Boolean(readyRun.pendingDiscontinueSubmission?.skuIds.includes(item.skuId)) || review.decision === "order" && Boolean(readyRun.pendingVendorSends?.[review.vendorName])} sent={review.decision === "order" && Boolean(readyRun.sentVendors[review.vendorName])} requested={review.decision === "reorder" && Boolean(readyRun.reorderRequestedAt)} previouslyRequested={new Set((readyRun.reorderPreviouslyRequestedLines || []).filter(row => row.skuId === item.skuId).map(row => row.purchaseOrderNumber))} onChange={changeReview} onRoute={(skuId, decision) => void routeItem(skuId, decision)} onImageWork={reviewImageWork} onImageFailure={reportImageFailure} />)}</section>)}
        {filtered.length > 0 ? <div className={styles.loadMore}><span>조회 결과 {filtered.length}개 중 {visible.length}개 표시</span>{visible.length < filtered.length ? <button type="button" className={styles.secondary} onClick={() => setVisibleLimit(value => value + 40)}>다음 40개 더 보기</button> : null}</div> : null}

      </section>

      <section className={styles.panel} aria-labelledby="weekly-output-title">
        <div className={styles.sectionHeading}><div><span className={styles.stepNumber}>03</span><h2 id="weekly-output-title">이동한 상품 처리하기</h2></div></div>
        <div className={styles.workActions}>
          <a className={styles.secondary} href="/wms/vendor-orders/manage">거래처 발주관리</a>
          <a className={styles.secondary} href="/wms/vendor-orders/status-requests">단종·해제 관리</a>
          <a className={styles.secondary} href="/wms/inbound/reorder">재발주요청 대기</a>
        </div>
        {outputProgress ? <p role="status">{outputProgress}</p> : null}
        {outputError ? <p role="alert" className={styles.error}>{outputError}</p> : null}
        {bundle ? <div className={styles.downloads}><strong>{bundle.name}</strong><a href={bundle.url} download={bundle.name}>생성한 서류 다시 받기</a></div> : null}
        <p className={styles.help}>서류를 받는 것과 실제 처리완료는 별개입니다. 완료한 내역은 아래 이력에 남습니다.</p>
        {!reviewEntries.length ? <p>미입고 상품 이동 완료 · 각 대기 목록에서 이어서 처리하세요.</p> : null}
        {completedCoupons.length || completedEntries.length ? <details className={styles.completedHistory}>
          <summary>처리 완료 이력 · {completedCoupons.length + completedEntries.length}개 항목</summary>
          <p>직접 완료한 내역과 이전 처리 이력으로 자동 제외한 내역입니다. 원본 미입고 수량과 이력은 보존하며, 다른 발주번호의 새 미입고는 다시 검토합니다.</p>
          {completedCoupons.length ? <details><summary>쿠폰{readyRun.generated?.advertisingCount ? "·광고" : ""} 등록 완료 · {completedCoupons.length}개 SKU · {formatTime(readyRun.couponUploadedAt)} · 기간 {readyRun.couponStartsOn || "시작일 미확인"} ~ {readyRun.couponExpiresOn || "종료일 미확인"}</summary><ul>{completedCoupons.map(item => <li key={item.skuId}>SKU {item.skuId} · {item.productName}</li>)}</ul></details> : null}
          <ul>{completedEntries.map(({ item, review, completion }) => <li key={item.skuId}><strong>{completion.label}</strong> · SKU {item.skuId} · {item.productName}{review.vendorName ? " · " + review.vendorName : ""} · {formatTime(completion.at)}</li>)}</ul>
        </details> : null}
      </section>
    </>}
    <details className={styles.legacy} onToggle={event => setShowLegacy(event.currentTarget.open)}><summary>이전 입고기록 화면 열기</summary><p>저장된 입고기록을 날짜별로 확인하는 기존 화면입니다. 기간 통합 파일은 위 주간 업무에서 만드세요.</p>{showLegacy ? <LegacyInbound /> : null}</details>
  </main>;
}
