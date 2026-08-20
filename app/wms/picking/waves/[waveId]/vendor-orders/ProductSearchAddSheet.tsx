"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { wmsColors, wmsGhostButton, wmsSecondaryButton } from "@/lib/wms/ui-tokens";
import { resolveWarehouseCategoryBucket, warehouseCategorySortIndex } from "@/lib/wms/category-order";
import { resolveDisplayNameAndOption } from "@/lib/wms/display-name";
import { getWmsDisplayImageUrl } from "@/lib/wms/image-display-url";

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
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");

  /**
   * 다른 WMS 화면(작업센터/웨이브 상세/완료 화면)과 동일한 /api/wms/product-catalog를 그대로
   * 재사용한다(중복 구글시트 연결 코드 없음). 실패 원인을 두 가지로 정확히 구분해서 보여준다
   * (2026-08-19 3차 실사용 테스트 반영):
   *  - data.configured === false → 서비스 계정/환경변수 자체가 설정 안 됨(설정 문제)
   *  - response.ok === false(500 등) → 설정은 있지만 이번 조회가 일시적으로 실패함(재시도 대상)
   * "연결 실패"라고 하면서 동시에 검색 결과를 보여주는 모순을 없애기 위해, 실패 시 catalog를
   * null로 유지해 결과 목록이 함께 보이지 않게 한다.
   */
  const loadCatalog = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/wms/product-catalog", { cache: "no-store" });
      const data = await response.json();
      if (!data.configured) {
        setCatalog(null);
        setError("제품DB(구글시트) 연동이 아직 설정되지 않았습니다 — 관리자에게 Google Sheets 연결 설정을 확인해달라고 요청해주세요.");
        return;
      }
      if (!response.ok) {
        setCatalog(null);
        setError(data.error ? `제품DB 조회가 일시적으로 실패했습니다 (${data.error}) — 아래에서 다시 시도해주세요.` : "제품DB 조회가 일시적으로 실패했습니다 — 아래에서 다시 시도해주세요.");
        return;
      }
      setCatalog(data.items || []);
    } catch {
      setCatalog(null);
      setError("제품DB를 불러오지 못했습니다 — 네트워크 상태를 확인하고 다시 시도해주세요.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadCatalog();
  }, [loadCatalog]);

  // 창고 동선 순서(카테고리 버킷)로 정렬 — 최신 제품DB 카테고리 기준, 계산 결과를 저장하지 않고
  // 검색할 때마다 새로 계산한다 (2026-08-19 사용자 확정).
  function byWarehouseOrder(a: CatalogItem, b: CatalogItem): number {
    const diff = warehouseCategorySortIndex(resolveWarehouseCategoryBucket(a.category)) - warehouseCategorySortIndex(resolveWarehouseCategoryBucket(b.category));
    if (diff !== 0) return diff;
    return a.productName.localeCompare(b.productName);
  }

  const results = useMemo(() => {
    if (!catalog) return [];
    const q = query.trim().toLowerCase();
    if (!q) return [...catalog].sort(byWarehouseOrder).slice(0, 30);
    return catalog
      .filter(
        item =>
          item.skuId.toLowerCase().includes(q) ||
          item.productName.toLowerCase().includes(q) ||
          item.modelName.toLowerCase().includes(q) ||
          item.optionLabel.toLowerCase().includes(q) ||
          item.vendorName.toLowerCase().includes(q)
      )
      .sort(byWarehouseOrder)
      .slice(0, 30);
  }, [catalog, query]);

  return (
    <div
      onClick={onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(37,37,37,0.6)", display: "flex", alignItems: "flex-end", zIndex: 65 }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: "#ffffff",
          borderRadius: "16px 16px 0 0",
          padding: "20px 20px calc(20px + env(safe-area-inset-bottom))",
          width: "100%",
          maxWidth: "min(420px, calc(100dvw - 16px))",
          margin: "0 auto",
          maxHeight: "80dvh",
          display: "flex",
          flexDirection: "column",
          boxSizing: "border-box",
          overflowX: "hidden",
          touchAction: "pan-y",
          overscrollBehaviorY: "contain",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px", marginBottom: "10px" }}>
          <h3 style={{ margin: 0, fontSize: "15px", minWidth: 0, flexShrink: 1, overflowWrap: "anywhere" }}>상품 검색 추가</h3>
          <button onClick={loadCatalog} disabled={loading} style={{ ...wmsGhostButton, minHeight: "28px", padding: "0 10px", fontSize: "11px", flexShrink: 0, whiteSpace: "nowrap" }}>
            {loading ? "불러오는 중..." : (
              <>
                <span className="wms-refresh-label-full">제품DB 다시 불러오기</span>
                <span className="wms-refresh-label-short">DB 새로고침</span>
              </>
            )}
          </button>
        </div>
        <input
          className="wms-input"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="SKU ID, 상품명, 모델명, 옵션명, 거래처로 검색"
          style={{ width: "100%", minWidth: 0, boxSizing: "border-box", minHeight: "40px", fontSize: "16px", padding: "8px 10px", borderRadius: "8px", border: `1px solid ${wmsColors.borderStrong}`, marginBottom: "10px" }}
        />

        {error && (
          <div style={{ fontSize: "12px", color: "#c0392b", marginBottom: "8px" }}>
            {error}
            <button onClick={loadCatalog} disabled={loading} style={{ ...wmsGhostButton, minHeight: "28px", padding: "0 8px", fontSize: "11px", marginLeft: "6px" }}>
              재시도
            </button>
          </div>
        )}
        {!error && loading && catalog === null && <p style={{ fontSize: "12px", color: wmsColors.muted }}>불러오는 중...</p>}

        <div style={{ overflowY: "auto", overflowX: "hidden", flex: 1, minWidth: 0, touchAction: "pan-y", overscrollBehaviorY: "contain" }}>
          {catalog && results.length === 0 && <p style={{ fontSize: "12px", color: wmsColors.muted }}>검색 결과가 없습니다.</p>}
          {results.map(item => {
            const { name: displayName, option: displayOption } = resolveDisplayNameAndOption(item.productName, item.optionLabel);
            return (
            <button
              key={item.skuId}
              onClick={() => onSelect({ ...item, optionLabel: displayOption })}
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: "10px",
                width: "100%",
                textAlign: "left",
                background: "#ffffff",
                border: `1px solid ${wmsColors.border}`,
                borderRadius: "10px",
                padding: "10px",
                marginBottom: "6px",
                cursor: "pointer",
              }}
            >
              <SearchResultThumbnail imageUrl={item.imageUrl} />
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: "13px", fontWeight: 700, color: wmsColors.ink, whiteSpace: "normal", wordBreak: "keep-all", lineHeight: 1.3 }}>{displayName}</div>
                <div style={{ fontSize: "12px", fontWeight: 700, color: wmsColors.greenDark, whiteSpace: "normal", wordBreak: "keep-all", marginTop: "2px" }}>{displayOption || "옵션 없음"}</div>
                <div style={{ fontSize: "10px", color: wmsColors.muted, marginTop: "3px" }}>SKU {item.skuId} · {item.vendorName || "거래처 미등록"}</div>
              </div>
            </button>
            );
          })}
        </div>

        <button onClick={onClose} style={{ ...wmsGhostButton, width: "100%", marginTop: "10px" }}>
          닫기
        </button>
      </div>
    </div>
  );
}

/** 검색 결과 썸네일 — Google Drive 이미지는 image-proxy를 거치고, 로드 실패 시 "이미지 없음"으로
 *  전환한다(2026-08-20 신규, [waveId]/page.tsx의 ItemThumbnail과 같은 규칙). */
function SearchResultThumbnail({ imageUrl }: { imageUrl?: string }) {
  const displaySrc = getWmsDisplayImageUrl(imageUrl);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setFailed(false);
  }, [displaySrc]);

  if (displaySrc && !failed) {
    return (
      <img
        src={displaySrc}
        alt=""
        width={52}
        height={52}
        onError={() => setFailed(true)}
        style={{ width: "52px", height: "52px", borderRadius: "8px", objectFit: "cover", flexShrink: 0, background: wmsColors.surfaceBeige }}
      />
    );
  }
  return (
    <div style={{ width: "52px", height: "52px", borderRadius: "8px", background: wmsColors.surfaceBeige, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "9px", color: wmsColors.muted, textAlign: "center" }}>
      이미지
      <br />
      {displaySrc && failed ? "실패" : "미등록"}
    </div>
  );
}
