"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { wmsColors } from "@/lib/wms/ui-tokens";
import { getWmsDisplayImageUrl } from "@/lib/wms/image-display-url";
import type { ProductCatalogItem } from "@/lib/wms/product-catalog";
import type { ImageHit } from "@/lib/image-search";
import type { WimsRegistrationRow, WimsRegistrationSnapshot } from "@/lib/wms/wims-registration";

type PhotoState = { loading: boolean; hits: ImageHit[]; error?: string };

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

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const response = await fetch("/api/wms/product-registration-catalog", { cache: "no-store" });
        const data = await response.json();
        if (!response.ok) throw new Error(data?.error || "상품 연결 대장을 읽지 못했습니다.");
        if (active) {
          setItems(Array.isArray(data.items) ? data.items : []);
          setConfigured(Boolean(data.configured));
          setSnapshot(readSnapshot());
        }
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : "상품 연결 대장을 읽지 못했습니다.");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const refreshSnapshot = () => setSnapshot(readSnapshot());
    window.addEventListener("focus", refreshSnapshot);
    window.addEventListener("storage", refreshSnapshot);
    return () => {
      window.removeEventListener("focus", refreshSnapshot);
      window.removeEventListener("storage", refreshSnapshot);
    };
  }, []);

  const filteredItems = useMemo(() => {
    const needle = clean(query);
    return items.filter(item => {
      const wims = snapshot ? findWimsRow(item, snapshot.rows) : null;
      const searchable = [item.modelName, item.modelSku, item.skuId, item.barcode, item.productName, item.optionLabel].map(clean).join(" ");
      const matchesQuery = !needle || searchable.includes(needle);
      const matchesStatus = status === "all"
        || (status === "pending" && !item.skuId)
        || (status === "issued" && Boolean(item.skuId))
        || (status === "wims" && Boolean(wims));
      return matchesQuery && matchesStatus;
    });
  }, [items, query, snapshot, status]);

  const summary = useMemo(() => ({
    total: items.length,
    issued: items.filter(item => item.skuId).length,
    pending: items.filter(item => !item.skuId).length,
    models: new Set(items.map(item => item.modelName).filter(Boolean)).size,
  }), [items]);

  async function searchPhotos(item: ProductCatalogItem) {
    const key = item.modelSku || item.modelName || item.productName;
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
          {[["전체 행", summary.total], ["DB에 SKU 있음", summary.issued], ["DB에 SKU 없음", summary.pending], ["상품군", summary.models]].map(([label, value]) => (
            <div key={String(label)} style={{ background: wmsColors.surface, borderRadius: 10, padding: "10px 12px" }}><div style={{ color: wmsColors.muted, fontSize: 11 }}>{label}</div><strong style={{ color: wmsColors.ink, fontSize: 20 }}>{value}</strong></div>
          ))}
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
          <input value={query} onChange={event => setQuery(event.target.value)} placeholder="모델명·모델SKU·SKU ID·바코드·상품명 검색" style={{ flex: "1 1 340px", minHeight: 42, border: `1px solid ${wmsColors.border}`, borderRadius: 9, padding: "0 12px" }} />
          <select value={status} onChange={event => setStatus(event.target.value)} style={{ minHeight: 42, border: `1px solid ${wmsColors.border}`, borderRadius: 9, padding: "0 10px", background: "#fff" }}>
            <option value="all">전체 상태</option><option value="pending">DB에 SKU 없음</option><option value="issued">DB에 SKU 있음</option><option value="wims">WIMS 대조 후보 있음</option>
          </select>
        </div>
      </div>

      {!configured && !loading && <div style={{ border: `1px solid ${wmsColors.warn}`, background: wmsColors.warnSoft, borderRadius: 12, padding: 14, marginBottom: 14 }}>Google Sheets 연결 설정이 없어 상품을 읽지 못했습니다.</div>}
      {error && <div style={{ border: `1px solid ${wmsColors.warnSoftBorder}`, background: wmsColors.warnSoft, borderRadius: 12, padding: 14, marginBottom: 14 }}>{error}</div>}
      <p style={{ fontSize: 12, color: wmsColors.muted }}>제품DB의 공란만으로 쿠팡 승인 여부를 판단할 수 없습니다. {snapshot ? `이 브라우저·사이트에 저장된 WIMS ${snapshot.rows.length}건의 대조 후보를 함께 표시합니다. 재등록 이력 검증과 DB 반영은 별도입니다.` : "이 브라우저·사이트에서 읽을 수 있는 WIMS 자료가 없습니다. 다른 브라우저나 운영 사이트의 저장 자료는 여기와 공유되지 않습니다."} <Link href="/product-registration#wims-registration">WIMS 대조 화면 열기</Link></p>

      {loading ? <p style={{ color: wmsColors.muted }}>상품 연결 대장을 읽는 중입니다.</p> : (
        <div style={{ display: "grid", gap: 10 }}>
          {filteredItems.slice(0, 200).map((item, index) => {
            const rowKey = `${item.skuId}|${item.modelSku}|${item.modelName}|${index}`;
            const wims = snapshot ? findWimsRow(item, snapshot.rows) : null;
            const photoKey = item.modelSku || item.modelName || item.productName;
            const photos = photoStates[photoKey];
            const imageUrl = getWmsDisplayImageUrl(externalUrl(item.imageUrl));
            const productLink = externalUrl(item.productLink);
            return <article key={rowKey} style={{ border: `1px solid ${wmsColors.border}`, background: "#fff", borderRadius: 12, padding: 12 }}>
              <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", gap: 12 }}>
                <div>
                  <div style={{ color: wmsColors.ink, fontWeight: 800 }}>{item.modelName || "모델명 없음"} <span style={{ color: wmsColors.muted, fontWeight: 600 }}>· {item.optionLabel || item.modelSku || "옵션 미확인"}</span></div>
                  <div style={{ color: wmsColors.muted, fontSize: 12, marginTop: 4 }}>{item.productName || "상품명 없음"}</div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 9, fontSize: 12 }}><span>모델SKU: <b>{item.modelSku || "-"}</b></span><span>SKU ID: <b>{item.skuId || "DB 미입력"}</b></span><span>바코드: <b>{item.barcode || "DB 미입력"}</b></span></div>
                  {wims && <div style={{ marginTop: 6, fontSize: 12, color: wmsColors.muted }}>WIMS 대조 후보 · {wims.statusLabel || "상태 미확인"} · SKU {wims.skuId || "미확인"} · 바코드 {wims.barcode || "미확인"} · 등록일 {wims.registeredAt || "미확인"} (DB 연결 확정 전)</div>}
                </div>
                <div style={{ textAlign: "right", minWidth: 120 }}><div style={{ color: item.skuId ? wmsColors.greenDark : wmsColors.warn, fontWeight: 800, fontSize: 12 }}>{item.skuId ? "DB에 SKU 있음" : "승인정보 연결 필요"}</div><div style={{ color: wmsColors.muted, fontSize: 11, marginTop: 5 }}>DB 상태: {item.currentStatus || "미입력"}</div></div>
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginTop: 10 }}>
                <button type="button" onClick={() => void searchPhotos(item)} disabled={!photoKey || photos?.loading} style={{ border: `1px solid ${wmsColors.border}`, borderRadius: 8, background: "#fff", padding: "7px 10px", cursor: "pointer", fontWeight: 700, color: wmsColors.ink }}>{photos?.loading ? "사진 검색 중…" : "사진 후보 검색"}</button>
                {imageUrl && <a href={imageUrl} target="_blank" rel="noreferrer" aria-label="대표이미지 크게 보기" style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: wmsColors.slate }}><img src={imageUrl} alt="대표이미지" width={42} height={42} loading="lazy" style={{ width: 42, height: 42, objectFit: "contain", border: `1px solid ${wmsColors.border}`, borderRadius: 6, background: wmsColors.surface }} /><span>대표이미지 원본 열기 ↗</span></a>}
                {productLink ? <a href={productLink} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: wmsColors.slate }}>쿠팡 제품페이지 열기 ↗</a> : <span style={{ color: wmsColors.muted, fontSize: 11 }}>쿠팡 제품주소: DB 미입력 (실제 주소 별도 확인 필요)</span>}
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
