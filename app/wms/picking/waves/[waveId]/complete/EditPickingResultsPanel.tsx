"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { proposeShortageAllocation } from "@/lib/wms/picking-wave/allocate";
import { resolveGroup } from "@/lib/wms/picking-wave/grouping";
import { resolveLiveFields, type LiveCatalogLookup } from "@/lib/wms/picking-wave/live-catalog";
import type { PickingWaveItem, PickingWaveItemStatus } from "@/lib/wms/picking-wave/types";
import { wmsColors, wmsPrimaryButton, wmsGhostButton, wmsOuterCard } from "@/lib/wms/ui-tokens";
import { getWmsDisplayImageUrl } from "@/lib/wms/image-display-url";
import { openProductLinkPreview } from "@/lib/wms/product-link-preview";
import { ExternalLinkIcon } from "../../../../icons";

interface Props {
  items: PickingWaveItem[];
  liveCatalogByProductCode: LiveCatalogLookup;
  onCancel: () => void;
  onSave: (updatedItems: PickingWaveItem[]) => Promise<void>;
}

function computeStatus(found: number, requested: number): PickingWaveItemStatus {
  if (found <= 0) return "notfound";
  if (found >= requested) return "full";
  return "partial";
}

const STATUS_LABEL: Record<PickingWaveItemStatus, string> = {
  pending: "미처리",
  full: "전량찾음",
  partial: "부분찾음",
  notfound: "못찾음",
};

/**
 * 완료된 웨이브의 찾은 수량/상태를 다시 수정하는 패널 (2026-08-19 2차 실사용 테스트 반영).
 * 발주수량(원본)은 읽기 전용, 찾은 수량만 고칠 수 있다. 저장 전까지는 로컬 상태에만 있고
 * [수정 취소]를 누르면 전부 버려진다. [수정 완료]를 눌러야 실제 웨이브 아이템에 반영된다.
 */
export default function EditPickingResultsPanel({ items, liveCatalogByProductCode, onCancel, onSave }: Props) {
  // 찾은수량 입력은 문자열 draft로 관리한다 — 숫자 상태(value={number})만 쓰면 사용자가 "0"을
  // 지워 빈칸으로 만들 수 없어 "1"을 입력해도 "01"이 된다(2026-08-20 실기기 테스트 반영).
  // 입력 중에는 빈 문자열도 그대로 허용하고, blur/Enter 시점에만 숫자로 확정한다.
  const [draftByCode, setDraftByCode] = useState<Record<string, string>>(() =>
    Object.fromEntries(items.map(item => [item.productCode, String(item.pickedQuantity)]))
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sortedItems = useMemo(
    () => [...items].sort((a, b) => resolveGroup(a, liveCatalogByProductCode).sortKey.localeCompare(resolveGroup(b, liveCatalogByProductCode).sortKey)),
    [items, liveCatalogByProductCode]
  );

  /** 입력 중인 draft 문자열을 숫자로 계산 — 빈칸은 0으로 취급(최종 확정 전까지만). */
  function draftAsNumber(productCode: string, fallback: number): number {
    const raw = draftByCode[productCode];
    if (raw === undefined) return fallback;
    if (raw === "") return 0;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function updateDraft(productCode: string, raw: string) {
    // 숫자만 허용(빈 문자열은 삭제 중일 수 있으므로 통과) — 앞자리 0이 남는 "01" 같은 값은
    // 애초에 만들지 않고, 커서 이동 없이 그대로 draft 문자열을 저장한다.
    if (raw !== "" && !/^\d+$/.test(raw)) return;
    setDraftByCode(prev => ({ ...prev, [productCode]: raw }));
  }

  /** blur 또는 Enter 시 최종 숫자로 확정 — 음수 금지, 발주수량 초과 금지. */
  function commitDraft(item: PickingWaveItem) {
    setDraftByCode(prev => {
      const raw = prev[item.productCode];
      const parsed = raw === "" || raw === undefined ? 0 : Number(raw);
      const clamped = Math.max(0, Math.min(item.totalQuantity, Number.isFinite(parsed) ? parsed : 0));
      return { ...prev, [item.productCode]: String(clamped) };
    });
  }

  async function handleSave() {
    setError(null);
    for (const item of items) {
      const found = draftAsNumber(item.productCode, item.pickedQuantity);
      if (found < 0) {
        setError(`${item.productName}: 찾은 수량은 0 이상이어야 합니다.`);
        return;
      }
      if (found > item.totalQuantity) {
        setError(`${item.productName}: 찾은 수량(${found})이 발주수량(${item.totalQuantity})을 초과할 수 없습니다.`);
        return;
      }
    }

    setSaving(true);
    try {
      const updatedItems = items.map(item => {
        const found = draftAsNumber(item.productCode, item.pickedQuantity);
        const status = computeStatus(found, item.totalQuantity);
        const allocations = proposeShortageAllocation(item.sources, found);
        return {
          ...item,
          pickedQuantity: found,
          shortageQuantity: item.totalQuantity - found,
          status,
          allocations,
          updatedAt: new Date().toISOString(),
        };
      });
      await onSave(updatedItems);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ ...wmsOuterCard, padding: "14px" }}>
      <div style={{ background: wmsColors.warnSoft, color: wmsColors.warn, borderRadius: "8px", padding: "8px 10px", fontSize: "11px", marginBottom: "12px" }}>
        피킹 내용 수정 모드 — 발주수량은 읽기 전용이며, 찾은 수량만 고칠 수 있습니다. [수정 완료]를 눌러야 저장됩니다.
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginBottom: "12px" }}>
        {sortedItems.map(item => {
          const draftRaw = draftByCode[item.productCode] ?? String(item.pickedQuantity);
          const found = draftAsNumber(item.productCode, item.pickedQuantity);
          const status = computeStatus(found, item.totalQuantity);
          const invalid = found < 0 || found > item.totalQuantity;
          const live = resolveLiveFields(item, liveCatalogByProductCode);
          return (
            <div key={item.productCode} style={rowStyle}>
              <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "6px" }}>
                {live.productLink ? (
                  <button
                    type="button"
                    onClick={() => openProductLinkPreview(live.productLink)}
                    title="제품링크 열기"
                    style={{ background: "none", border: "none", padding: 0, margin: 0, cursor: "pointer", flexShrink: 0, lineHeight: 0 }}
                  >
                    <EditPanelThumbnail imageUrl={live.imageUrl} />
                  </button>
                ) : (
                  <div title="제품링크 미등록" style={{ flexShrink: 0 }}>
                    <EditPanelThumbnail imageUrl={live.imageUrl} />
                  </div>
                )}
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: "13px", fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {live.name}
                  </div>
                  <div style={{ fontSize: "12px", fontWeight: 700, color: wmsColors.greenDark, whiteSpace: "normal", wordBreak: "keep-all", lineHeight: 1.3 }}>
                    {live.optionLabel || "옵션 없음"}
                  </div>
                  <div style={{ fontSize: "10px", color: wmsColors.muted }}>
                    SKU {item.productCode}
                    {live.liveSkuId && live.liveSkuId !== item.productCode && (
                      <span style={{ color: wmsColors.greenDark, fontWeight: 700 }}> (최신 SKU ID: {live.liveSkuId})</span>
                    )}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => openProductLinkPreview(live.productLink)}
                  disabled={!live.productLink}
                  title={live.productLink ? "제품링크 열기" : "제품링크 미등록"}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: "28px",
                    height: "28px",
                    flexShrink: 0,
                    borderRadius: "7px",
                    border: `1px solid ${wmsColors.border}`,
                    background: live.productLink ? "#ffffff" : wmsColors.surfaceBeige,
                    color: live.productLink ? wmsColors.slateDark : wmsColors.muted,
                    cursor: live.productLink ? "pointer" : "not-allowed",
                    opacity: live.productLink ? 1 : 0.5,
                  }}
                >
                  <ExternalLinkIcon size={13} />
                </button>
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
                <div style={{ fontSize: "11px", color: wmsColors.muted }}>
                  발주수량(읽기전용) <strong style={{ color: wmsColors.ink }}>{item.totalQuantity}</strong>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                  <span style={{ fontSize: "11px", color: wmsColors.muted }}>찾은수량</span>
                  <input
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    value={draftRaw}
                    onChange={e => updateDraft(item.productCode, e.target.value)}
                    onBlur={() => commitDraft(item)}
                    onKeyDown={e => {
                      if (e.key === "Enter") {
                        commitDraft(item);
                        (e.target as HTMLInputElement).blur();
                      }
                    }}
                    style={{ width: "56px", fontSize: "13px", padding: "4px 6px", borderRadius: "6px", border: `1px solid ${invalid ? "#c0392b" : wmsColors.borderStrong}`, textAlign: "center" }}
                  />
                </div>
                <span style={{ fontSize: "11px", fontWeight: 700, color: status === "full" ? wmsColors.greenDark : status === "notfound" ? wmsColors.warn : wmsColors.ink }}>
                  {STATUS_LABEL[status]}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {error && <p style={{ fontSize: "12px", color: "#c0392b", marginBottom: "10px" }}>{error}</p>}

      <div style={{ display: "flex", gap: "8px" }}>
        <button onClick={onCancel} disabled={saving} style={{ ...wmsGhostButton, flex: 1 }}>
          수정 취소
        </button>
        <button onClick={handleSave} disabled={saving} style={{ ...wmsPrimaryButton, flex: 2, opacity: saving ? 0.6 : 1 }}>
          {saving ? "저장 중..." : "수정 완료"}
        </button>
      </div>
    </div>
  );
}

const rowStyle: CSSProperties = {
  border: `1px solid ${wmsColors.border}`,
  borderRadius: "12px",
  padding: "10px",
  background: "#ffffff",
};

/** 이미지 로드가 실패하면 깨진 아이콘 대신 빈 placeholder로 전환한다(2026-08-20 신규,
 *  [waveId]/page.tsx의 ItemThumbnail과 같은 규칙). */
function EditPanelThumbnail({ imageUrl }: { imageUrl?: string }) {
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
        width={44}
        height={44}
        onError={() => setFailed(true)}
        style={{ width: "44px", height: "44px", borderRadius: "6px", objectFit: "cover", flexShrink: 0 }}
      />
    );
  }
  return <div style={{ width: "44px", height: "44px", borderRadius: "6px", background: wmsColors.surfaceBeige, flexShrink: 0 }} />;
}
