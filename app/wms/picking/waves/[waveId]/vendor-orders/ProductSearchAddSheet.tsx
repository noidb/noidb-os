"use client";

import { useEffect, useMemo, useState } from "react";
import { wmsColors, wmsGhostButton } from "@/lib/wms/ui-tokens";

interface CatalogItem {
  skuId: string;
  modelName: string;
  category: string;
  productName: string;
  optionLabel: string;
  imageUrl: string;
  warehouseNumber: string;
  boxNumber: string;
  currentStock: string;
  vendorName: string;
  barcode: string;
}

interface Props {
  onClose: () => void;
  onSelect: (item: CatalogItem) => void;
}

/**
 * 제품DB에서 SKU ID/상품명/모델명으로 상품을 검색해 거래처 발주서에 추가하는 바텀시트.
 * 선택하면 SKU ID/상품명/옵션명/대표이미지/쿠팡바코드/거래처/현재고를 제품DB에서 그대로 불러온다
 * (2026-08-19 신규 — 부족분 이외에 추가로 발주할 상품이 생겼을 때 쓴다).
 */
export default function ProductSearchAddSheet({ onClose, onSelect }: Props) {
  const [catalog, setCatalog] = useState<CatalogItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const response = await fetch("/api/wms/product-catalog", { cache: "no-store" });
        const data = await response.json();
        if (!response.ok || !data.configured) {
          setError("제품DB(구글시트) 연결이 안 되어 있어 검색할 수 없습니다.");
          return;
        }
        setCatalog(data.items || []);
      } catch {
        setError("제품DB를 불러오지 못했습니다.");
      }
    })();
  }, []);

  const results = useMemo(() => {
    if (!catalog) return [];
    const q = query.trim().toLowerCase();
    if (!q) return catalog.slice(0, 30);
    return catalog
      .filter(
        item =>
          item.skuId.toLowerCase().includes(q) ||
          item.productName.toLowerCase().includes(q) ||
          item.modelName.toLowerCase().includes(q)
      )
      .slice(0, 30);
  }, [catalog, query]);

  return (
    <div
      onClick={onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(37,37,37,0.6)", display: "flex", alignItems: "flex-end", zIndex: 65 }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{ background: "#ffffff", borderRadius: "16px 16px 0 0", padding: "20px", width: "100%", maxWidth: "420px", margin: "0 auto", maxHeight: "80vh", display: "flex", flexDirection: "column" }}
      >
        <h3 style={{ margin: "0 0 10px", fontSize: "15px" }}>상품 검색 추가</h3>
        <input
          autoFocus
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="SKU ID, 상품명, 모델명으로 검색"
          style={{ width: "100%", minHeight: "40px", fontSize: "13px", padding: "8px 10px", borderRadius: "8px", border: `1px solid ${wmsColors.borderStrong}`, marginBottom: "10px" }}
        />

        {error && <p style={{ fontSize: "12px", color: "#c0392b" }}>{error}</p>}
        {!error && catalog === null && <p style={{ fontSize: "12px", color: wmsColors.muted }}>불러오는 중...</p>}

        <div style={{ overflowY: "auto", flex: 1 }}>
          {catalog && results.length === 0 && <p style={{ fontSize: "12px", color: wmsColors.muted }}>검색 결과가 없습니다.</p>}
          {results.map(item => (
            <button
              key={item.skuId}
              onClick={() => onSelect(item)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "10px",
                width: "100%",
                textAlign: "left",
                background: "#ffffff",
                border: `1px solid ${wmsColors.border}`,
                borderRadius: "10px",
                padding: "8px",
                marginBottom: "6px",
                cursor: "pointer",
              }}
            >
              {item.imageUrl ? (
                <img src={item.imageUrl} alt="" width={44} height={44} style={{ width: "44px", height: "44px", borderRadius: "6px", objectFit: "cover", flexShrink: 0 }} />
              ) : (
                <div style={{ width: "44px", height: "44px", borderRadius: "6px", background: wmsColors.surfaceBeige, flexShrink: 0 }} />
              )}
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: "12px", fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.productName}</div>
                <div style={{ fontSize: "11px", color: wmsColors.greenDark }}>{item.optionLabel || "옵션 없음"}</div>
                <div style={{ fontSize: "10px", color: wmsColors.muted }}>SKU {item.skuId} · {item.vendorName || "거래처 미등록"}</div>
              </div>
            </button>
          ))}
        </div>

        <button onClick={onClose} style={{ ...wmsGhostButton, width: "100%", marginTop: "10px" }}>
          닫기
        </button>
      </div>
    </div>
  );
}
