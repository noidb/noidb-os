"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { wmsColors } from "@/lib/wms/ui-tokens";
import type { ProductCatalogItem } from "@/lib/wms/product-catalog";
import type { ImageHit } from "@/lib/image-search";
import type { WimsRegistrationRow, WimsRegistrationSnapshot } from "@/lib/wms/wims-registration";

type PhotoState = { loading: boolean; hits: ImageHit[]; error?: string };

const SNAPSHOT_KEY = "noidb_wims_registration_snapshot_v1";

function readSnapshot(): WimsRegistrationSnapshot | null {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(SNAPSHOT_KEY) || "null");
    if (!parsed || !Array.isArray(parsed.rows)) return null;
    return parsed as WimsRegistrationSnapshot;
  } catch {
    return null;
  }
}

function clean(value: string): string {
  return String(value || "").trim().toLowerCase();
}

function findWimsRow(item: ProductCatalogItem, rows: WimsRegistrationRow[]): WimsRegistrationRow | null {
  const skuId = clean(item.skuId);
  const modelSku = clean(item.modelSku);
  return rows.find(row => skuId && clean(row.skuId) === skuId)
    || rows.find(row => modelSku && clean(row.modelSku) === modelSku)
    || null;
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
          {[["전체 행", summary.total], ["SKU 발급", summary.issued], ["SKU 대기", summary.pending], ["상품군", summary.models]].map(([label, value]) => (
            <div key={String(label)} style={{ background: wmsColors.surface, borderRadius: 10, padding: "10px 12px" }}><div style={{ color: wmsColors.muted, fontSize: 11 }}>{label}</div><strong style={{ color: wmsColors.ink, fontSize: 20 }}>{value}</strong></div>
          ))}
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
          <input value={query} onChange={event => setQuery(event.target.value)} placeholder="모델명·모델SKU·SKU ID·바코드·상품명 검색" style={{ flex: "1 1 340px", minHeight: 42, border: `1px solid ${wmsColors.border}`, borderRadius: 9, padding: "0 12px" }} />
          <select value={status} onChange={event => setStatus(event.target.value)} style={{ minHeight: 42, border: `1px solid ${wmsColors.border}`, borderRadius: 9, padding: "0 10px", background: "#fff" }}>
            <option value="all">전체 상태</option><option value="pending">SKU 발급 전</option><option value="issued">SKU 발급 완료</option><option value="wims">WIMS 스냅샷 일치</option>
          </select>
        </div>
      </div>

      {!configured && !loading && <div style={{ border: `1px solid ${wmsColors.warn}`, background: wmsColors.warnSoft, borderRadius: 12, padding: 14, marginBottom: 14 }}>Google Sheets 연결 설정이 없어 상품을 읽지 못했습니다.</div>}
      {error && <div style={{ border: `1px solid ${wmsColors.warnSoftBorder}`, background: wmsColors.warnSoft, borderRadius: 12, padding: 14, marginBottom: 14 }}>{error}</div>}
      {snapshot && <div style={{ border: `1px solid ${wmsColors.green}`, background: wmsColors.greenSoft, borderRadius: 12, padding: 12, marginBottom: 14, fontSize: 12 }}>현재 브라우저의 WIMS 스냅샷 {snapshot.rows.length}건을 SKU ID 우선, 모델SKU 차선으로 대조했습니다. 자동 저장은 하지 않습니다.</div>}

      {loading ? <p style={{ color: wmsColors.muted }}>상품 연결 대장을 읽는 중입니다.</p> : (
        <div style={{ display: "grid", gap: 10 }}>
          {filteredItems.slice(0, 200).map((item, index) => {
            const rowKey = `${item.skuId}|${item.modelSku}|${item.modelName}|${index}`;
            const wims = snapshot ? findWimsRow(item, snapshot.rows) : null;
            const photoKey = item.modelSku || item.modelName || item.productName;
            const photos = photoStates[photoKey];
            return <article key={rowKey} style={{ border: `1px solid ${wmsColors.border}`, background: "#fff", borderRadius: 12, padding: 12 }}>
              <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", gap: 12 }}>
                <div>
                  <div style={{ color: wmsColors.ink, fontWeight: 800 }}>{item.modelName || "모델명 없음"} <span style={{ color: wmsColors.muted, fontWeight: 600 }}>· {item.optionLabel || item.modelSku || "옵션 미확인"}</span></div>
                  <div style={{ color: wmsColors.muted, fontSize: 12, marginTop: 4 }}>{item.productName || "상품명 없음"}</div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 9, fontSize: 12 }}><span>모델SKU: <b>{item.modelSku || "-"}</b></span><span>SKU ID: <b>{item.skuId || "발급 전"}</b></span><span>바코드: <b>{item.barcode || "-"}</b></span></div>
                </div>
                <div style={{ textAlign: "right", minWidth: 120 }}><div style={{ color: item.skuId ? wmsColors.greenDark : wmsColors.warn, fontWeight: 800, fontSize: 12 }}>{item.skuId ? "SKU 발급 완료" : "SKU 발급 전"}</div><div style={{ color: wmsColors.muted, fontSize: 11, marginTop: 5 }}>{wims ? `WIMS · ${wims.statusLabel || "확인됨"}` : "WIMS 스냅샷 없음"}</div></div>
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginTop: 10 }}>
                <button type="button" onClick={() => void searchPhotos(item)} disabled={!photoKey || photos?.loading} style={{ border: `1px solid ${wmsColors.border}`, borderRadius: 8, background: "#fff", padding: "7px 10px", cursor: "pointer", fontWeight: 700, color: wmsColors.ink }}>{photos?.loading ? "사진 검색 중…" : "사진 후보 검색"}</button>
                {item.imageUrl && <a href={item.imageUrl} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: wmsColors.slate }}>제품DB 대표이미지</a>}
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
