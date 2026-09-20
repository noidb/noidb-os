"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { wmsColors } from "@/lib/wms/ui-tokens";
import { getWmsDisplayImageUrl } from "@/lib/wms/image-display-url";
import type { ProductCatalogItem } from "@/lib/wms/product-catalog";
import type { ImageHit } from "@/lib/image-search";
import type { WimsRegistrationRow, WimsRegistrationSnapshot } from "@/lib/wms/wims-registration";

type PhotoState = { loading: boolean; hits: ImageHit[]; error?: string };
type LinkCheckState = { loading: boolean; state?: string; message?: string; status?: number; checkedAt?: string };

const SNAPSHOT_KEY = "noidb_wims_registration_snapshot_v1";

function readSnapshot(): WimsRegistrationSnapshot | null {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(SNAPSHOT_KEY) || "null");
    const snapshot = parsed?.snapshot ?? parsed;
    if (!snapshot || !Array.isArray(snapshot.rows)) return null;
    return snapshot as WimsRegistrationSnapshot;
  } catch {
    return null;
  }
}

function clean(value: string): string {
  return String(value || "").trim().toLowerCase();
}

function modelGroupKey(item: ProductCatalogItem): string {
  const modelName = clean(item.modelName);
  return modelName || `modelsku:${clean(item.modelSku)}`;
}

function isSalesStopped(item: ProductCatalogItem): boolean {
  // 거래처단종은 재등록이 아니라 공급 종료일 수 있으므로 자동 재등록 큐에서 제외한다.
  return /판매중지|판매중단/i.test(item.currentStatus || "");
}

function isRocketRegistered(item: ProductCatalogItem): boolean {
  return /^R/i.test(String(item.barcode || "").trim());
}

function externalUrl(value: string): string {
  const trimmed = String(value || "").trim();
  return /^https?:\/\//i.test(trimmed) ? trimmed : "";
}

function findWimsRow(item: ProductCatalogItem, rows: WimsRegistrationRow[]): WimsRegistrationRow | null {
  const skuId = clean(item.skuId);
  const modelSku = clean(item.modelSku);
  const matches = skuId
    ? rows.filter(row => clean(row.skuId) === skuId && (!row.modelSku || clean(row.modelSku) === modelSku))
    : rows.filter(row => modelSku && clean(row.modelSku) === modelSku);
  return matches.length === 1 ? matches[0] : null;
}

export default function ProductCatalogPage() {
  const [items, setItems] = useState<ProductCatalogItem[]>([]);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [snapshot, setSnapshot] = useState<WimsRegistrationSnapshot | null>(null);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [photoStates, setPhotoStates] = useState<Record<string, PhotoState>>({});
  const [linkChecks, setLinkChecks] = useState<Record<string, LinkCheckState>>({});

  const stoppedModelKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const item of items) if (isSalesStopped(item)) keys.add(modelGroupKey(item));
    return keys;
  }, [items]);

  const isReregistrationTarget = useCallback((item: ProductCatalogItem) => stoppedModelKeys.has(modelGroupKey(item)), [stoppedModelKeys]);

  const loadCatalog = useCallback(async (activeRef?: { current: boolean }) => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/wms/product-registration-catalog", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || "상품 연결 대장을 읽지 못했습니다.");
      if (!activeRef || activeRef.current) {
        setItems(Array.isArray(data.items) ? data.items : []);
        setConfigured(Boolean(data.configured));
        setSnapshot(readSnapshot());
      }
    } catch (cause) {
      if (!activeRef || activeRef.current) setError(cause instanceof Error ? cause.message : "상품 연결 대장을 읽지 못했습니다.");
    } finally {
      if (!activeRef || activeRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const active = { current: true };
    void loadCatalog(active);
    return () => { active.current = false; };
  }, [loadCatalog]);

  useEffect(() => {
    let lastRefresh = 0;
    const refreshCatalog = () => {
      // 탭을 오갈 때마다 Sheets를 읽지 않고, 20초 이상 지난 경우에만 다시 읽는다.
      if (Date.now() - lastRefresh < 20_000) return;
      lastRefresh = Date.now();
      void loadCatalog();
    };
    const refreshSnapshot = () => setSnapshot(readSnapshot());
    window.addEventListener("focus", refreshCatalog);
    window.addEventListener("focus", refreshSnapshot);
    window.addEventListener("storage", refreshSnapshot);
    return () => {
      window.removeEventListener("focus", refreshCatalog);
      window.removeEventListener("focus", refreshSnapshot);
      window.removeEventListener("storage", refreshSnapshot);
    };
  }, [loadCatalog]);

  const filteredItems = useMemo(() => {
    const needle = clean(query);
    return items.filter(item => {
      const wims = snapshot ? findWimsRow(item, snapshot.rows) : null;
      const searchable = [item.modelName, item.modelSku, item.skuId, item.barcode, item.productName, item.optionLabel].map(clean).join(" ");
      const matchesQuery = !needle || searchable.includes(needle);
      const reregistration = isReregistrationTarget(item);
      const rocketPending = !isRocketRegistered(item);
      const matchesStatus = status === "all"
        || (status === "pending" && !item.skuId)
        || (status === "issued" && Boolean(item.skuId))
        || (status === "wims" && Boolean(wims))
        || (status === "reregister" && reregistration)
        || (status === "rocket-pending" && rocketPending);
      return matchesQuery && matchesStatus;
    }).sort((a, b) => Number(isReregistrationTarget(b)) - Number(isReregistrationTarget(a)));
  }, [items, query, snapshot, status, isReregistrationTarget]);

  const rejectedRows = useMemo(() => {
    const needle = clean(query);
    return (snapshot?.rows || []).filter(row => row.status === "rejected" && (!needle || [row.productName, row.modelSku].map(clean).join(" ").includes(needle)));
  }, [snapshot, query]);

  const summary = useMemo(() => ({
    total: items.length,
    issued: items.filter(item => item.skuId).length,
    pending: items.filter(item => !item.skuId).length,
    models: new Set(items.map(item => item.modelName).filter(Boolean)).size,
    reregisterModels: stoppedModelKeys.size,
    reregisterOptions: items.filter(item => isReregistrationTarget(item)).length,
    rocketPending: items.filter(item => !isRocketRegistered(item)).length,
  }), [items, isReregistrationTarget, stoppedModelKeys]);

  const reregistrationGroups = useMemo(() => {
    if (status !== "reregister") return [];
    const groups = new Map<string, ProductCatalogItem[]>();
    for (const item of filteredItems) {
      const key = modelGroupKey(item);
      groups.set(key, [...(groups.get(key) || []), item]);
    }
    return [...groups.entries()].map(([key, groupItems]) => ({ key, modelName: groupItems[0].modelName || groupItems[0].modelSku || "모델명 없음", items: groupItems }));
  }, [filteredItems, status]);

  async function searchPhotos(item: ProductCatalogItem) {
    // 사진 폴더는 모델 단위이므로 같은 모델의 옵션들이 검색 결과를 공유한다.
    const key = item.modelName || item.modelSku || item.productName;
    if (!key || photoStates[key]?.loading) return;
    setPhotoStates(current => ({ ...current, [key]: { loading: true, hits: current[key]?.hits || [] } }));
    try {
      const response = await fetch("/api/image-search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: item.modelName || item.modelSku, rootIds: ["mybox"] }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || "사진 후보를 찾지 못했습니다.");
      setPhotoStates(current => ({ ...current, [key]: { loading: false, hits: Array.isArray(data.hits) ? data.hits : [] } }));
    } catch (cause) {
      setPhotoStates(current => ({ ...current, [key]: { loading: false, hits: [], error: cause instanceof Error ? cause.message : "사진 후보를 찾지 못했습니다." } }));
    }
  }

  async function checkProductLink(item: ProductCatalogItem) {
    const url = externalUrl(item.productLink);
    if (!url) return;
    const key = item.skuId || item.modelSku || url;
    setLinkChecks(current => ({ ...current, [key]: { loading: true } }));
    try {
      const response = await fetch(`/api/wms/product-link-check?url=${encodeURIComponent(url)}`, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.message || "링크 확인에 실패했습니다.");
      setLinkChecks(current => ({ ...current, [key]: { loading: false, state: data.state, message: data.message, status: data.status, checkedAt: new Date().toLocaleTimeString("ko-KR") } }));
    } catch (cause) {
      setLinkChecks(current => ({ ...current, [key]: { loading: false, state: "error", message: cause instanceof Error ? cause.message : "링크 확인에 실패했습니다.", checkedAt: new Date().toLocaleTimeString("ko-KR") } }));
    }
  }

  return (
    <main style={{ maxWidth: 1180, margin: "0 auto", padding: "20px 16px 48px", fontFamily: "sans-serif" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "start", marginBottom: 18 }}>
        <div>
          <p style={{ margin: 0, color: wmsColors.muted, fontSize: 12, fontWeight: 700 }}>상품등록 · 연결 대장</p>
          <h1 style={{ margin: "4px 0 6px", color: wmsColors.ink, fontSize: 26 }}>모델·옵션·SKU·사진 연결</h1>
          <p style={{ margin: 0, color: wmsColors.muted, fontSize: 13 }}>모델명은 상품군, 모델SKU는 옵션 키입니다. 이 화면은 읽기 전용입니다.</p>
        </div>
        <Link href="/wms/work-center" style={{ color: wmsColors.ink, fontWeight: 800, fontSize: 13 }}>작업센터로 돌아가기</Link>
      </div>

      <div style={{ border: `1px solid ${wmsColors.border}`, background: "#fff", borderRadius: 14, padding: 14, marginBottom: 14 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 8 }}>
          {[["전체 행", summary.total], ["재등록 모델", summary.reregisterModels], ["재등록 옵션", summary.reregisterOptions], ["로켓 등록 전", summary.rocketPending]].map(([label, value]) => (
            <div key={String(label)} style={{ background: wmsColors.surface, borderRadius: 10, padding: "10px 12px" }}><div style={{ color: wmsColors.muted, fontSize: 11 }}>{label}</div><strong style={{ color: wmsColors.ink, fontSize: 20 }}>{value}</strong></div>
          ))}
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
          <input value={query} onChange={event => setQuery(event.target.value)} placeholder="모델명·모델SKU·SKU ID·바코드·상품명 검색" style={{ flex: "1 1 340px", minHeight: 42, border: `1px solid ${wmsColors.border}`, borderRadius: 9, padding: "0 12px" }} />
          <button type="button" onClick={() => void loadCatalog()} disabled={loading} style={{ minHeight: 42, border: `1px solid ${wmsColors.border}`, borderRadius: 9, padding: "0 12px", background: "#fff", color: wmsColors.ink, fontWeight: 700, cursor: loading ? "wait" : "pointer" }}>{loading ? "새로 읽는 중…" : "제품DB 새로고침"}</button>
          <select value={status} onChange={event => setStatus(event.target.value)} style={{ minHeight: 42, border: `1px solid ${wmsColors.border}`, borderRadius: 9, padding: "0 10px", background: "#fff" }}>
            <option value="all">전체 상태</option><option value="reregister">재등록 필요(모델 전체)</option><option value="rocket-pending">로켓 등록 전/확인 필요</option><option value="pending">DB에 SKU 없음</option><option value="issued">DB에 SKU 있음</option><option value="wims">WIMS 대조 후보 있음</option>
          </select>
        </div>
      </div>

      {!configured && !loading && <div style={{ border: `1px solid ${wmsColors.warn}`, background: wmsColors.warnSoft, borderRadius: 12, padding: 14, marginBottom: 14 }}>Google Sheets 연결 설정이 없어 상품을 읽지 못했습니다.</div>}
      {error && <div style={{ border: `1px solid ${wmsColors.warnSoftBorder}`, background: wmsColors.warnSoft, borderRadius: 12, padding: 14, marginBottom: 14 }}>{error}</div>}
      <p style={{ fontSize: 12, color: wmsColors.muted }}>제품DB의 공란만으로 쿠팡 승인 여부를 판단할 수 없습니다. {snapshot ? `이 브라우저·사이트에 저장된 WIMS ${snapshot.rows.length}건의 대조 후보를 함께 표시합니다. 재등록 이력 검증과 DB 반영은 별도입니다.` : "이 브라우저·사이트에서 읽을 수 있는 WIMS 자료가 없습니다. 다른 브라우저나 운영 사이트의 저장 자료는 여기와 공유되지 않습니다."} <Link href="/product-registration#wims-registration">WIMS 대조 화면 열기</Link></p>
      <p style={{ fontSize: 12, color: wmsColors.muted }}>제품페이지 주소가 비어 있는 행은 SKU ID를 임의로 URL로 바꾸지 않습니다. 쿠팡에서 내려받은 <b>쿠팡쇼핑몰 추출DB.xlsx</b>를 <Link href="/#coupang-data-import">작업센터의 ‘쿠팡 추출DB 업데이트’</Link>에 올리면 SKU ID/옵션ID로 기존 행의 제품링크만 연결할 수 있습니다.</p>

      {rejectedRows.length > 0 && <section style={{ border: `2px solid ${wmsColors.warn}`, background: wmsColors.warnSoft, borderRadius: 14, padding: 14, marginBottom: 14 }}>
        <div style={{ color: wmsColors.warnText, fontWeight: 900, fontSize: 18 }}>반려 · 보완 후 재등록</div>
        <p style={{ margin: "6px 0 12px", color: wmsColors.ink, fontSize: 12 }}>제품DB의 기존 SKU 유무와 관계없이 독립적인 WIMS 등록건입니다. DB 행이 있다고 신규승인으로 판단하지 마세요.</p>
        <p style={{ margin: "0 0 12px", color: wmsColors.muted, fontSize: 12 }}>등록일은 반려일이 아닙니다. 상세 반려 사유와 반려일은 쿠팡 반려 안내에서 확인해 주세요.</p>
        <div style={{ display: "grid", gap: 8 }}>
          {rejectedRows.map((row, index) => <article key={`${row.modelSku}|${row.estimateId}|${index}`} style={{ border: `1px solid ${wmsColors.warnSoftBorder}`, background: "#fff", borderRadius: 10, padding: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "start" }}>
              <div style={{ color: wmsColors.ink, fontWeight: 800 }}>{row.productName || "상품명 미확인"}</div>
              <span style={{ color: wmsColors.warnText, fontWeight: 900, fontSize: 13 }}>반려</span>
            </div>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 8, color: wmsColors.muted, fontSize: 12 }}>
              <span>WIMS모델SKU: <b>{row.modelSku || "-"}</b></span>
              <span>견적서ID: <b>{row.estimateId || "-"}</b></span>
              <span>등록일: <b>{row.registeredAt || "미확인"}</b></span>
              <span>반려일: <b>미확인</b></span>
            </div>
            <div style={{ marginTop: 7, color: wmsColors.ink, fontSize: 12 }}>상태: <b>{row.statusLabel || ""}</b></div>
          </article>)}
        </div>
      </section>}

      {loading ? <p style={{ color: wmsColors.muted }}>상품 연결 대장을 읽는 중입니다.</p> : (
        <div style={{ display: "grid", gap: 10 }}>
          {status === "reregister" && <section style={{ border: `2px solid ${wmsColors.warnSoftBorder}`, background: wmsColors.warnSoft, borderRadius: 14, padding: 14, marginBottom: 2 }}>
            <div style={{ color: wmsColors.warnText, fontWeight: 900, fontSize: 16 }}>재등록 작업 묶음 · {reregistrationGroups.length}개 모델</div>
            <p style={{ color: wmsColors.ink, fontSize: 12, margin: "6px 0 12px" }}>모델 하나에 옵션이 여러 개 있어도 사진 폴더 검색은 한 번만 합니다. 아래 옵션 목록은 각각 별도 모델SKU로 유지됩니다.</p>
            <div style={{ display: "grid", gap: 8 }}>
              {reregistrationGroups.map(group => {
                const first = group.items[0];
                const photos = photoStates[group.modelName];
                return <article key={group.key} style={{ border: `1px solid ${wmsColors.warnSoftBorder}`, background: "#fff", borderRadius: 10, padding: 10 }}>
                  <div style={{ display: "flex", alignItems: "start", justifyContent: "space-between", gap: 10 }}>
                    <div><div style={{ color: wmsColors.ink, fontWeight: 800 }}>{group.modelName}</div><div style={{ color: wmsColors.muted, fontSize: 11, marginTop: 4 }}>{group.items.length}개 옵션 · {group.items.map(item => item.modelSku || item.optionLabel || "옵션 미확인").join(" · ")}</div></div>
                    <button type="button" onClick={() => void searchPhotos(first)} disabled={!group.modelName || photos?.loading} style={{ border: `1px solid ${wmsColors.border}`, borderRadius: 8, background: "#fff", padding: "7px 10px", cursor: photos?.loading ? "wait" : "pointer", fontWeight: 700, color: wmsColors.ink }}>{photos?.loading ? "사진 검색 중…" : "이 모델 사진 검색"}</button>
                  </div>
                  {photos?.error && <div style={{ color: wmsColors.warnText, fontSize: 11, marginTop: 7 }}>{photos.error}</div>}
                  {photos && !photos.loading && !photos.error && <div style={{ color: wmsColors.muted, fontSize: 11, marginTop: 7 }}>사진 후보 {photos.hits.length}개{photos.hits.length > 0 ? ` · ${photos.hits.slice(0, 3).map(hit => hit.fileName).join(" · ")}` : ""}</div>}
                </article>;
              })}
            </div>
          </section>}
          {filteredItems.slice(0, 200).map((item, index) => {
            const rowKey = `${item.skuId}|${item.modelSku}|${item.modelName}|${index}`;
            const wims = snapshot ? findWimsRow(item, snapshot.rows) : null;
            const photoKey = item.modelName || item.modelSku || item.productName;
            const photos = photoStates[photoKey];
            const imageUrl = getWmsDisplayImageUrl(externalUrl(item.imageUrl));
            const productLink = externalUrl(item.productLink);
            const linkCheck = linkChecks[item.skuId || item.modelSku || productLink];
            const reregistration = isReregistrationTarget(item);
            const rocketPending = !isRocketRegistered(item);
            return <article key={rowKey} style={{ border: `1px solid ${wmsColors.border}`, background: "#fff", borderRadius: 12, padding: 12 }}>
              <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", gap: 12 }}>
                <div>
                  <div style={{ color: wmsColors.ink, fontWeight: 800 }}>{item.modelName || "모델명 없음"} <span style={{ color: wmsColors.muted, fontWeight: 600 }}>· {item.optionLabel || item.modelSku || "옵션 미확인"}</span></div>
                  <div style={{ color: wmsColors.muted, fontSize: 12, marginTop: 4 }}>{item.productName || "상품명 없음"}</div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 9, fontSize: 12 }}><span>모델SKU: <b>{item.modelSku || "-"}</b></span><span>SKU ID: <b>{item.skuId || "DB 미입력"}</b></span><span>바코드: <b>{item.barcode || "DB 미입력"}</b></span><span>발주가능상태: <b>{item.orderableStatus || "미입력"}</b></span></div>
                  {wims && <div style={{ marginTop: 6, fontSize: 12, color: wmsColors.muted }}>WIMS 대조 후보 · {wims.statusLabel || "상태 미확인"} · SKU {wims.skuId || "미확인"} · 바코드 {wims.barcode || "미확인"} · 등록일 {wims.registeredAt || "미확인"} (DB 연결 확정 전)</div>}
                </div>
                <div style={{ textAlign: "right", minWidth: 150 }}><div style={{ color: reregistration ? wmsColors.warnText : item.skuId ? wmsColors.greenDark : wmsColors.warn, fontWeight: 800, fontSize: 12 }}>{reregistration ? "모델 전체 재등록 대상" : item.skuId ? "DB에 SKU 있음" : "승인정보 연결 필요"}</div><div style={{ color: wmsColors.muted, fontSize: 11, marginTop: 5 }}>DB 상태: {item.currentStatus || "미입력"}</div>{rocketPending && <div style={{ color: wmsColors.warnText, fontSize: 11, marginTop: 3 }}>로켓 등록 전/확인 필요</div>}</div>
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginTop: 10 }}>
                <button type="button" onClick={() => void searchPhotos(item)} disabled={!photoKey || photos?.loading} style={{ border: `1px solid ${wmsColors.border}`, borderRadius: 8, background: "#fff", padding: "7px 10px", cursor: "pointer", fontWeight: 700, color: wmsColors.ink }}>{photos?.loading ? "사진 검색 중…" : "사진 후보 검색"}</button>
                {imageUrl && <a href={imageUrl} target="_blank" rel="noreferrer" aria-label="대표이미지 크게 보기" style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: wmsColors.slate }}><img src={imageUrl} alt="대표이미지" width={42} height={42} loading="lazy" style={{ width: 42, height: 42, objectFit: "contain", border: `1px solid ${wmsColors.border}`, borderRadius: 6, background: wmsColors.surface }} /><span>대표이미지 원본 열기 ↗</span></a>}
                {productLink ? <>
                  <a href={productLink} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: wmsColors.slate }}>쿠팡 제품페이지 열기 ↗</a>
                  <button type="button" onClick={() => void checkProductLink(item)} disabled={linkCheck?.loading} style={{ border: `1px solid ${wmsColors.border}`, borderRadius: 8, background: "#fff", padding: "7px 10px", cursor: linkCheck?.loading ? "wait" : "pointer", fontWeight: 700, color: wmsColors.ink }}>{linkCheck?.loading ? "링크 확인 중…" : "링크 상태 확인"}</button>
                  {linkCheck && !linkCheck.loading && <span style={{ color: linkCheck.state === "reachable" ? wmsColors.greenDark : wmsColors.warnText, fontSize: 11 }}>{linkCheck.message}{linkCheck.checkedAt ? ` · ${linkCheck.checkedAt}` : ""}</span>}
                </> : <span style={{ color: wmsColors.muted, fontSize: 11 }}>쿠팡 제품주소: 미등록 · 해당 SKU를 광고센터에서 SKU ID로 검색해야 합니다.</span>}
                {item.skuId && <Link href={`/wms/products/${encodeURIComponent(item.skuId)}`} style={{ fontSize: 12, color: wmsColors.slate }}>SKU 상세 보기</Link>}
                {photos?.error && <span style={{ color: wmsColors.warnText, fontSize: 11 }}>{photos.error}</span>}
                {photos && !photos.loading && !photos.error && <span style={{ color: wmsColors.muted, fontSize: 11 }}>사진 후보 {photos.hits.length}개</span>}
              </div>
              {photos && photos.hits.length > 0 && <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 6, marginTop: 10 }}>{photos.hits.slice(0, 8).map(hit => <div key={hit.id} style={{ border: `1px solid ${wmsColors.border}`, borderRadius: 8, padding: 7, fontSize: 10, overflow: "hidden" }}><div style={{ fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{hit.fileName}</div><div style={{ color: wmsColors.muted, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{hit.path}</div></div>)}</div>}
            </article>;
          })}
          {filteredItems.length > 200 && <p style={{ color: wmsColors.muted, fontSize: 12 }}>검색 결과가 많아 처음 200개만 표시합니다. 검색어를 좁혀 주세요.</p>}
          {filteredItems.length === 0 && <p style={{ color: wmsColors.muted }}>조건에 맞는 상품이 없습니다.</p>}
        </div>
      )}
    </main>
  );
}
