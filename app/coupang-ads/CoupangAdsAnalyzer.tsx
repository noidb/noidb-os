"use client";

import { DragEvent, useEffect, useMemo, useRef, useState } from "react";
import { parseCoupangAdsSnapshot, summarizeCoupangAds } from "../../lib/coupang-ads/analysis";
import { COUPANG_ADS_BOOKMARKLET, COUPANG_PRODUCT_LINK_BOOKMARKLET } from "../../lib/coupang-ads/bookmarklet";
import { exportCoupangAdsAnalysis } from "../../lib/coupang-ads/excel";
import { listCoupangAdsSnapshots, saveCoupangAdsSnapshot, type StoredCoupangAdsSnapshot } from "../../lib/coupang-ads/snapshot-store";
import type { CoupangAdsAnalyzedItem, CoupangAdsParsedSnapshot } from "../../lib/coupang-ads/types";
import styles from "./coupang-ads.module.css";

type SortKey = "roas" | "adCost" | "adSales" | "clicks" | "ctr";
type FilterKey = "all" | "zero-orders" | "out-of-stock" | "active" | "inactive" | "focus" | "stop";

const numberFormat = new Intl.NumberFormat("ko-KR");
const decimalFormat = new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 2 });

function won(value: number): string { return `${numberFormat.format(Math.round(value))}원`; }
function percent(value: number): string { return `${decimalFormat.format(value)}%`; }

export default function CoupangAdsAnalyzer() {
  const inputRef = useRef<HTMLInputElement>(null);
  const bookmarkletRef = useRef<HTMLAnchorElement>(null);
  const productLinkBookmarkletRef = useRef<HTMLAnchorElement>(null);
  const [parsed, setParsed] = useState<CoupangAdsParsedSnapshot | null>(null);
  const [snapshots, setSnapshots] = useState<StoredCoupangAdsSnapshot[]>([]);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [dragging, setDragging] = useState(false);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("roas");
  const [filter, setFilter] = useState<FilterKey>("all");
  const [visibleLimit, setVisibleLimit] = useState(100);

  useEffect(() => {
    void listCoupangAdsSnapshots().then(setSnapshots).catch(() => undefined);
    bookmarkletRef.current?.setAttribute("href", COUPANG_ADS_BOOKMARKLET);
    productLinkBookmarkletRef.current?.setAttribute("href", COUPANG_PRODUCT_LINK_BOOKMARKLET);
  }, []);

  const summary = useMemo(() => parsed ? summarizeCoupangAds(parsed.items) : null, [parsed]);
  const visibleItems = useMemo(() => {
    if (!parsed) return [];
    const keyword = query.trim().toLowerCase();
    return parsed.items.filter(item => {
      if (keyword && !`${item.itemName} ${item.vendorItemId}`.toLowerCase().includes(keyword)) return false;
      if (filter === "zero-orders") return item.adOrders === 0;
      if (filter === "out-of-stock") return item.outOfStock;
      if (filter === "active") return item.available;
      if (filter === "inactive") return !item.available;
      if (filter === "focus") return item.recommendation === "focus";
      if (filter === "stop") return item.recommendation === "stop";
      return true;
    }).sort((a, b) => b[sort] - a[sort]);
  }, [filter, parsed, query, sort]);

  useEffect(() => {
    setVisibleLimit(100);
  }, [filter, query, sort]);

  async function loadFile(file: File | undefined) {
    if (!file) return;
    setError(""); setMessage("");
    try {
      if (!file.name.toLowerCase().endsWith(".json")) throw new Error("coupang_ads_*.json 파일만 선택해주세요.");
      const source = JSON.parse(await file.text());
      const next = parseCoupangAdsSnapshot(source);
      setParsed(next);
      await saveCoupangAdsSnapshot(next);
      setSnapshots(await listCoupangAdsSnapshots());
      setMessage(`${next.uniqueCount}개 상품 분석 완료 · 원본 snapshot 저장 완료`);
    } catch (cause) {
      setParsed(null);
      setError(cause instanceof Error ? cause.message : "JSON 파일을 읽지 못했습니다.");
    }
  }

  async function copyBookmarklet() {
    try {
      await navigator.clipboard.writeText(COUPANG_ADS_BOOKMARKLET);
      setMessage("북마클릿을 복사했습니다. Chrome 북마크의 URL 칸에 붙여넣으세요.");
    } catch {
      setError("브라우저가 클립보드 복사를 차단했습니다. 아래 버튼을 북마크바로 끌어놓아 설치해주세요.");
    }
  }

  function drop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault(); setDragging(false); void loadFile(event.dataTransfer.files[0]);
  }

  return (
    <div className={styles.content}>
      <section className={styles.importGrid}>
        <article className={styles.panel}>
          <h2>JSON 파일 업로드</h2>
          <div className={`${styles.dropZone} ${dragging ? styles.dragging : ""}`} onClick={() => inputRef.current?.click()}
            onDragEnter={event => { event.preventDefault(); setDragging(true); }} onDragOver={event => event.preventDefault()}
            onDragLeave={() => setDragging(false)} onDrop={drop} role="button" tabIndex={0}>
            <strong>coupang_ads_*.json</strong>
            <span>클릭해서 선택하거나 여기에 끌어다 놓으세요.</span>
            <input ref={inputRef} type="file" accept="application/json,.json" onChange={event => { void loadFile(event.target.files?.[0]); event.target.value = ""; }} />
          </div>
        </article>
        <article className={styles.panel}>
          <h2>쿠팡 광고수집 버튼 설치</h2>
          <p className={styles.help}>최초 1회 설치 후 광고 상품 성과 화면에서 클릭하면 전체 페이지가 JSON으로 저장됩니다.</p>
          <div className={styles.bookmarkActions}>
            <button type="button" onClick={copyBookmarklet}>북마클릿 복사</button>
            <a ref={bookmarkletRef} href="#bookmarklet" draggable onClick={event => event.preventDefault()} title="Chrome 북마크바로 끌어놓으세요">NOID-B 쿠팡 광고수집</a>
          </div>
          <ol className={styles.steps}><li>Chrome 북마크를 하나 만듭니다.</li><li>복사한 내용을 북마크 URL에 붙여넣습니다.</li><li>쿠팡 광고 상품 성과 화면에서 북마크를 클릭합니다.</li></ol>
          <small>쿠팡 로그인 쿠키나 토큰은 JSON 또는 NOID-B 서버로 전송되지 않습니다.</small>
        </article>
        <article className={styles.panel}>
          <h2>상품링크 수집 버튼 설치</h2>
          <p className={styles.help}>광고 만들기 화면에서 검색한 SKU의 실제 쿠팡 상품 링크를 저장합니다.</p>
          <div className={styles.bookmarkActions}>
            <a ref={productLinkBookmarkletRef} href="#product-link-bookmarklet" draggable title="Chrome 북마크바로 끌어놓으세요">NOID-B 상품링크 수집</a>
          </div>
          <ol className={styles.steps}><li>광고 만들기에서 검색 기준을 SKU ID로 선택합니다.</li><li>SKU ID를 검색하고 결과가 보이면 이 북마크를 클릭합니다.</li><li>다운로드된 JSON을 상품등록 화면의 쿠팡 추출DB 업데이트에 올립니다.</li></ol>
          <small>상품명이나 모델명이 아닌 SKU ID로만 제품DB 행을 연결합니다.</small>
        </article>
      </section>

      {error && <p className={styles.error} role="alert">{error}</p>}
      {message && <p className={styles.message}>{message}</p>}

      {parsed && summary && <>
        <section className={styles.snapshotMeta}>
          <div><span>광고그룹</span><strong>{parsed.groupId || "확인 불가"}</strong></div>
          <div><span>조회기간</span><strong>{parsed.startDate} ~ {parsed.endDate}</strong></div>
          <div><span>수집 상품</span><strong>{parsed.collectedCount}건 / 메타 {parsed.expectedTotalCount}건</strong></div>
        </section>
        {parsed.warnings.map(warning => <p className={styles.warning} key={warning}>{warning}</p>)}
        <section className={styles.summaryGrid}>
          {[
            ["총 상품 수", numberFormat.format(summary.products)], ["총 노출", numberFormat.format(summary.impressions)],
            ["총 클릭", numberFormat.format(summary.clicks)], ["총 광고비", won(summary.adCost)],
            ["광고매출", won(summary.adSales)], ["전체 ROAS", percent(summary.roas)], ["광고주문수", numberFormat.format(summary.adOrders)],
          ].map(([label, value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}
        </section>
        <section className={styles.classificationGrid}>
          {(["focus", "expand", "observe", "stop"] as const).map(key => <button key={key} type="button" onClick={() => setFilter(key === "focus" || key === "stop" ? key : "all")}>
            <span>{{ focus: "집중 광고", expand: "확대 테스트", observe: "관찰", stop: "중지 후보" }[key]}</span><strong>{summary.recommendations[key]}개</strong>
          </button>)}
        </section>
        <section className={styles.resultsPanel}>
          <div className={styles.resultsHeader}>
            <div><h2>상품별 분석</h2><p>{visibleItems.length}개 표시</p></div>
            <button type="button" onClick={() => void exportCoupangAdsAnalysis(parsed)}>분석 결과 Excel 저장</button>
          </div>
          <div className={styles.filters}>
            <input value={query} onChange={event => setQuery(event.target.value)} placeholder="상품명 또는 Vendor Item ID 검색" />
            <select value={sort} onChange={event => setSort(event.target.value as SortKey)} aria-label="정렬">
              <option value="roas">ROAS 높은순</option><option value="adCost">광고비 높은순</option><option value="adSales">광고매출 높은순</option><option value="clicks">클릭 높은순</option><option value="ctr">CTR 높은순</option>
            </select>
            <select value={filter} onChange={event => setFilter(event.target.value as FilterKey)} aria-label="필터">
              <option value="all">전체 상품</option><option value="zero-orders">주문 0건</option><option value="out-of-stock">품절</option><option value="active">판매 가능</option><option value="inactive">비활성/집행 불가</option><option value="focus">집중 광고만</option><option value="stop">중지 후보만</option>
            </select>
          </div>
          <div className={styles.tableWrap}>
            <table><thead><tr><th>상품</th><th>상태</th><th>노출/클릭</th><th>CTR</th><th>광고비</th><th>주문/매출</th><th>ROAS</th><th>전환율</th><th>추천</th><th>허용 광고비</th></tr></thead>
              <tbody>{visibleItems.slice(0, visibleLimit).map(item => <AdRow item={item} key={item.vendorItemId} />)}</tbody></table>
          </div>
          {visibleItems.length > visibleLimit && <button className={styles.moreButton} type="button" onClick={() => setVisibleLimit(limit => limit + 100)}>
            상품 100개 더 보기 ({Math.min(visibleLimit, visibleItems.length)}/{visibleItems.length})
          </button>}
        </section>
      </>}

      {snapshots.length > 0 && <section className={styles.snapshotList}><h2>저장된 분석 snapshot</h2>{snapshots.slice(0, 8).map(snapshot => <div key={snapshot.id}><strong>{snapshot.groupId}</strong><span>{snapshot.startDate} ~ {snapshot.endDate}</span><span>{snapshot.uniqueCount}개 · 저장 {new Date(snapshot.savedAt).toLocaleString("ko-KR")}</span></div>)}</section>}
    </div>
  );
}

function AdRow({ item }: { item: CoupangAdsAnalyzedItem }) {
  return <tr className={styles[item.recommendation]}>
    <td data-label="상품"><strong>{item.itemName}</strong><small>{item.vendorItemId}</small></td>
    <td data-label="상태">{item.status}<small>BuyBox {item.buyBoxRole}</small></td>
    <td data-label="노출/클릭">{numberFormat.format(item.impressions)} / {numberFormat.format(item.clicks)}</td>
    <td data-label="CTR">{percent(item.ctr)}</td><td data-label="광고비">{won(item.adCost)}</td>
    <td data-label="주문/매출">{numberFormat.format(item.adOrders)}건 / {won(item.adSales)}</td>
    <td data-label="ROAS"><strong>{percent(item.roas)}</strong>{item.sampleWarning && <small className={styles.sample}>데이터 부족</small>}</td>
    <td data-label="전환율">{percent(item.conversionRate)}</td>
    <td data-label="추천"><strong>{item.recommendationLabel}</strong><small>{item.recommendationReason}</small></td>
    <td data-label="허용 광고비">{won(item.targetAllowedAdCost)}</td>
  </tr>;
}
