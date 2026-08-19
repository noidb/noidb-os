"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { usePickingWaveRepository } from "@/lib/wms/picking-wave/context";
import { useVendorOrderRepository } from "@/lib/wms/vendor-order/context";
import { buildVendorOrderDraftsFromWaveItems } from "@/lib/wms/vendor-order/aggregate";
import {
  UNASSIGNED_VENDOR_NAME,
  VENDOR_ORDER_STATUS_LABEL,
  type VendorOrderDraft,
  type VendorOrderDraftLine,
  type VendorOrderDraftStatus,
} from "@/lib/wms/vendor-order/types";
import type { PickingWave } from "@/lib/wms/picking-wave/types";
import { WMS_MOBILE_WIDTH, wmsColors, wmsPrimaryButton, wmsSecondaryButton, wmsGhostButton } from "@/lib/wms/ui-tokens";
import Barcode from "./Barcode";
import VendorOrderExportPanel from "./ExportPanel";
import ProductSearchAddSheet from "./ProductSearchAddSheet";

/**
 * 거래처별 부족분 발주서(초안) 화면. 완료된 통합 피킹(웨이브)의 부족 수량을 제품DB "거래처" 기준으로
 * 자동 그룹핑해 보여주고, 수량 수정·행 삭제·새 상품 추가·거래처 변경·메모 입력·임시저장·승인을
 * 지원한다. 이 화면은 자동으로 아무것도 발송하지 않는다 — 승인은 항상 사용자가 직접 누른다.
 */
export default function VendorOrdersPage({ params }: { params: { waveId: string } }) {
  const waveRepository = usePickingWaveRepository();
  const vendorOrderRepository = useVendorOrderRepository();

  const [wave, setWave] = useState<PickingWave | null>(null);
  const [loading, setLoading] = useState(true);
  const [lines, setLines] = useState<VendorOrderDraftLine[]>([]);
  const [draftsByVendor, setDraftsByVendor] = useState<Record<string, VendorOrderDraft>>({});
  const [removedLineIds, setRemovedLineIds] = useState<Set<string>>(new Set());
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [searchAddVendor, setSearchAddVendor] = useState<string | null>(null);
  const [manualVendorNames, setManualVendorNames] = useState<string[]>([]);
  const [addingManualVendor, setAddingManualVendor] = useState(false);
  const [newVendorNameInput, setNewVendorNameInput] = useState("");

  useEffect(() => {
    (async () => {
      const [loadedWave, waveItems, existingDrafts, existingLines] = await Promise.all([
        waveRepository.getWave(params.waveId),
        waveRepository.listItems(params.waveId),
        vendorOrderRepository.listDrafts(params.waveId),
        vendorOrderRepository.listLines(params.waveId),
      ]);
      setWave(loadedWave);

      if (existingLines.length > 0) {
        setLines(existingLines);
        setDraftsByVendor(Object.fromEntries(existingDrafts.map(draft => [draft.vendorName, draft])));
      } else if (loadedWave?.status === "completed") {
        const now = new Date().toISOString();
        const seeded = buildVendorOrderDraftsFromWaveItems(params.waveId, waveItems, now);
        await Promise.all(seeded.drafts.map(draft => vendorOrderRepository.saveDraft(draft)));
        await Promise.all(seeded.lines.map(line => vendorOrderRepository.saveLine(line)));
        setLines(seeded.lines);
        setDraftsByVendor(Object.fromEntries(seeded.drafts.map(draft => [draft.vendorName, draft])));
      }
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.waveId]);

  const groups = useMemo(() => {
    const map = new Map<string, VendorOrderDraftLine[]>();
    for (const line of lines) {
      const vendor = line.vendorName || UNASSIGNED_VENDOR_NAME;
      const list = map.get(vendor) || [];
      list.push(line);
      map.set(vendor, list);
    }
    // 상품 없이 "발주서 수동 추가"로 막 만든 거래처도 빈 그룹으로 보여준다 (2026-08-19 신규).
    for (const vendorName of manualVendorNames) {
      if (!map.has(vendorName)) map.set(vendorName, []);
    }
    return Array.from(map.entries())
      .map(([vendorName, groupLines]) => ({ vendorName, lines: groupLines }))
      .sort((a, b) => (a.vendorName === UNASSIGNED_VENDOR_NAME ? 1 : b.vendorName === UNASSIGNED_VENDOR_NAME ? -1 : a.vendorName.localeCompare(b.vendorName)));
  }, [lines, manualVendorNames]);

  function statusOf(vendorName: string): VendorOrderDraftStatus {
    return draftsByVendor[vendorName]?.status ?? "draft";
  }

  function updateLine(id: string, patch: Partial<VendorOrderDraftLine>) {
    setLines(prev => prev.map(line => (line.id === id ? { ...line, ...patch, updatedAt: new Date().toISOString() } : line)));
    setDirty(true);
  }

  function removeLine(id: string) {
    setLines(prev => prev.filter(line => line.id !== id));
    setRemovedLineIds(prev => new Set(prev).add(id));
    setDirty(true);
  }

  function addProductFromSearch(
    vendorName: string,
    product: { skuId: string; modelName: string; productName: string; optionLabel: string; imageUrl: string; barcode: string; currentStock: string }
  ) {
    const now = new Date().toISOString();
    const newLine: VendorOrderDraftLine = {
      id: `${params.waveId}::${vendorName}::manual-${Date.now()}`,
      draftId: `${params.waveId}::${vendorName}`,
      waveId: params.waveId,
      vendorName,
      skuId: product.skuId,
      modelName: product.modelName,
      optionLabel: product.optionLabel,
      productName: product.productName,
      imageUrl: product.imageUrl,
      barcode: product.barcode,
      shortageQuantity: 1,
      currentStock: product.currentStock,
      relatedPurchaseOrderNumbers: [],
      memo: "",
      isManuallyAdded: true,
      createdAt: now,
      updatedAt: now,
    };
    setLines(prev => [...prev, newLine]);
    setSearchAddVendor(null);
    setDirty(true);
  }

  function createManualVendorOrder() {
    const name = newVendorNameInput.trim();
    if (!name) return;
    setManualVendorNames(prev => (prev.includes(name) ? prev : [...prev, name]));
    setNewVendorNameInput("");
    setAddingManualVendor(false);
  }

  function stepQuantity(line: VendorOrderDraftLine, delta: number) {
    updateLine(line.id, { shortageQuantity: Math.max(0, line.shortageQuantity + delta) });
  }

  /** 라인들을 저장(임시저장)한다 — draftId를 현재 vendorName 기준으로 다시 맞추고, 삭제된 라인을 반영한다. */
  async function persistAll(overrideStatus?: { vendorName: string; status: VendorOrderDraftStatus }) {
    setSaving(true);
    const now = new Date().toISOString();

    for (const id of removedLineIds) {
      await vendorOrderRepository.deleteLine(id);
    }
    setRemovedLineIds(new Set());

    const vendorNames = new Set(lines.map(line => line.vendorName || UNASSIGNED_VENDOR_NAME));
    if (overrideStatus) vendorNames.add(overrideStatus.vendorName);

    const nextDraftsByVendor = { ...draftsByVendor };
    for (const vendorName of vendorNames) {
      const existing = nextDraftsByVendor[vendorName];
      const isOverride = overrideStatus?.vendorName === vendorName;
      const draft: VendorOrderDraft = existing
        ? {
            ...existing,
            status: isOverride ? overrideStatus!.status : existing.status,
            updatedAt: now,
            approvedAt: isOverride && overrideStatus!.status === "approved" ? now : existing.approvedAt,
            sentAt: isOverride && overrideStatus!.status === "sent" ? now : existing.sentAt,
          }
        : {
            id: `${params.waveId}::${vendorName}`,
            waveId: params.waveId,
            vendorName,
            status: isOverride ? overrideStatus!.status : "draft",
            createdAt: now,
            updatedAt: now,
            approvedAt: isOverride && overrideStatus!.status === "approved" ? now : undefined,
            sentAt: isOverride && overrideStatus!.status === "sent" ? now : undefined,
          };
      nextDraftsByVendor[vendorName] = draft;
      await vendorOrderRepository.saveDraft(draft);
    }
    setDraftsByVendor(nextDraftsByVendor);

    const linesToSave = lines.map(line => ({
      ...line,
      vendorName: line.vendorName || UNASSIGNED_VENDOR_NAME,
      draftId: `${params.waveId}::${line.vendorName || UNASSIGNED_VENDOR_NAME}`,
    }));
    await Promise.all(linesToSave.map(line => vendorOrderRepository.saveLine(line)));
    setLines(linesToSave);

    setDirty(false);
    setSaving(false);
  }

  async function handleApprove(vendorName: string) {
    await persistAll({ vendorName, status: "approved" });
  }

  if (loading) {
    return (
      <main style={pageStyle}>
        <p style={{ color: wmsColors.muted }}>불러오는 중...</p>
      </main>
    );
  }

  if (!wave) {
    return (
      <main style={pageStyle}>
        <h1 style={{ fontSize: "18px" }}>거래처별 부족분 발주서</h1>
        <p style={{ color: "#c0392b" }}>해당 통합 피킹 작업을 찾을 수 없습니다.</p>
        <a href="/wms/picking/waves" style={{ color: wmsColors.green, fontWeight: 700 }}>목록으로</a>
      </main>
    );
  }

  if (wave.status !== "completed") {
    return (
      <main style={pageStyle}>
        <h1 style={{ fontSize: "18px" }}>거래처별 부족분 발주서</h1>
        <p style={{ color: wmsColors.muted, fontSize: "13px" }}>
          이 통합 피킹({wave.id})이 아직 완료되지 않았습니다. 피킹을 완료하면 부족 수량이 거래처별로
          자동 집계됩니다.
        </p>
        <a href={`/wms/picking/waves/${wave.id}`} style={{ color: wmsColors.green, fontWeight: 700 }}>
          피킹으로 이동
        </a>
      </main>
    );
  }

  return (
    <main style={pageStyle}>
      <h1 style={{ fontSize: "18px", margin: "0 0 4px" }}>거래처별 부족분 발주서</h1>
      <p style={{ fontSize: "12px", color: wmsColors.muted, margin: "0 0 16px" }}>
        {wave.id} · 부족 수량을 제품DB "거래처" 기준으로 자동 분리했습니다. 거래처 정보가 없는 SKU는
        "{UNASSIGNED_VENDOR_NAME}"로 별도 표시됩니다. 자동 발송은 없으며, 승인은 직접 눌러야 합니다.
      </p>

      {!addingManualVendor ? (
        <button onClick={() => setAddingManualVendor(true)} style={{ ...wmsGhostButton, width: "100%", marginBottom: "14px" }}>
          + 발주서 수동 추가
        </button>
      ) : (
        <div style={{ display: "flex", gap: "6px", marginBottom: "14px" }}>
          <input
            autoFocus
            value={newVendorNameInput}
            onChange={e => setNewVendorNameInput(e.target.value)}
            placeholder="거래처명 입력 (기존 거래처명도 가능)"
            style={{ ...inputStyle, flex: 1 }}
          />
          <button onClick={createManualVendorOrder} style={{ ...wmsPrimaryButton, minHeight: "36px", fontSize: "12px" }}>
            만들기
          </button>
          <button onClick={() => setAddingManualVendor(false)} style={{ ...wmsGhostButton, minHeight: "36px", fontSize: "12px" }}>
            취소
          </button>
        </div>
      )}

      {groups.length === 0 ? (
        <p style={{ fontSize: "13px", color: wmsColors.muted }}>부족 수량이 없습니다. 모든 SKU가 전량 피킹되었습니다. 위 [발주서 수동 추가]로 새 발주서를 만들 수 있습니다.</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "16px", marginBottom: "20px" }}>
          {groups.map(group => {
            const status = statusOf(group.vendorName);
            const editable = status === "draft" || status === "review" || status === "resend_needed";
            const totalShortage = group.lines.reduce((sum, l) => sum + l.shortageQuantity, 0);

            return (
              <div key={group.vendorName} style={cardStyle}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px" }}>
                  <h2 style={{ margin: 0, fontSize: "15px" }}>
                    {group.vendorName}
                    <span style={{ marginLeft: "8px", fontSize: "11px", color: wmsColors.muted, fontWeight: 400 }}>
                      부족 {totalShortage}개 · {group.lines.length}종
                    </span>
                  </h2>
                  <StatusBadge status={status} />
                </div>
                <div style={{ fontSize: "11px", color: wmsColors.muted, marginBottom: "8px" }}>
                  발주일 {new Date().toLocaleDateString("ko-KR")}
                </div>

                <div style={{ overflowX: "auto", marginBottom: "10px" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12px" }}>
                    <thead>
                      <tr style={{ textAlign: "left", borderBottom: `1px solid ${wmsColors.border}`, color: wmsColors.muted }}>
                        <th style={{ padding: "4px" }}>상품 이미지</th>
                        <th style={{ padding: "4px" }}>모델명/SKU</th>
                        <th style={{ padding: "4px" }}>옵션</th>
                        <th style={{ padding: "4px" }}>쿠팡 바코드</th>
                        <th style={{ padding: "4px" }}>부족수량</th>
                        <th style={{ padding: "4px" }}>현재고</th>
                        <th style={{ padding: "4px" }}>관련 발주서</th>
                        <th style={{ padding: "4px" }}>거래처</th>
                        <th style={{ padding: "4px" }}>메모</th>
                        {editable && <th style={{ padding: "4px" }} />}
                      </tr>
                    </thead>
                    <tbody>
                      {group.lines.map(line => (
                        <tr key={line.id} style={{ borderBottom: "1px solid #eee" }}>
                          <td style={{ padding: "4px" }}>
                            {line.imageUrl ? (
                              <img src={line.imageUrl} alt="" width={72} height={72} style={{ width: "72px", height: "72px", borderRadius: "8px", objectFit: "cover" }} />
                            ) : (
                              <div style={{ width: "72px", height: "72px", borderRadius: "8px", background: wmsColors.warnSoft, color: wmsColors.warn, fontSize: "10px", fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", textAlign: "center" }}>
                                이미지
                                <br />
                                미등록
                              </div>
                            )}
                          </td>
                          <td style={{ padding: "4px", minWidth: "140px" }}>
                            {editable ? (
                              <>
                                <input
                                  value={line.modelName}
                                  placeholder="모델명"
                                  onChange={e => updateLine(line.id, { modelName: e.target.value })}
                                  style={inputStyle}
                                />
                                <input
                                  value={line.skuId}
                                  placeholder="SKU"
                                  onChange={e => updateLine(line.id, { skuId: e.target.value })}
                                  style={{ ...inputStyle, marginTop: "2px", fontSize: "10px", color: wmsColors.muted }}
                                />
                              </>
                            ) : (
                              <>
                                <div>{line.modelName}</div>
                                <div style={{ fontSize: "10px", color: wmsColors.muted }}>{line.skuId}</div>
                              </>
                            )}
                          </td>
                          <td style={{ padding: "4px", minWidth: "80px" }}>
                            {editable ? (
                              <input
                                value={line.optionLabel}
                                onChange={e => updateLine(line.id, { optionLabel: e.target.value })}
                                style={inputStyle}
                              />
                            ) : (
                              line.optionLabel || "-"
                            )}
                          </td>
                          <td style={{ padding: "4px", minWidth: "110px" }}>
                            <Barcode value={line.barcode} height={26} moduleWidth={1} />
                          </td>
                          <td style={{ padding: "4px", minWidth: "90px" }}>
                            {editable ? (
                              <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                                <button onClick={() => stepQuantity(line, -1)} style={stepperButtonStyle}>
                                  −
                                </button>
                                <input
                                  type="number"
                                  min={0}
                                  value={line.shortageQuantity}
                                  onChange={e => updateLine(line.id, { shortageQuantity: Math.max(0, Number(e.target.value) || 0) })}
                                  style={{ ...inputStyle, width: "40px", textAlign: "center" }}
                                />
                                <button onClick={() => stepQuantity(line, 1)} style={stepperButtonStyle}>
                                  +
                                </button>
                              </div>
                            ) : (
                              <strong>{line.shortageQuantity}</strong>
                            )}
                          </td>
                          <td style={{ padding: "4px" }}>{line.currentStock || "미입력"}</td>
                          <td style={{ padding: "4px", fontSize: "11px", color: wmsColors.muted }}>
                            {line.relatedPurchaseOrderNumbers.join(", ") || (line.isManuallyAdded ? "수동추가" : "-")}
                          </td>
                          <td style={{ padding: "4px", minWidth: "100px" }}>
                            {editable ? (
                              <input
                                value={line.vendorName}
                                onChange={e => updateLine(line.id, { vendorName: e.target.value || UNASSIGNED_VENDOR_NAME })}
                                style={inputStyle}
                              />
                            ) : (
                              line.vendorName
                            )}
                          </td>
                          <td style={{ padding: "4px", minWidth: "100px" }}>
                            {editable ? (
                              <input
                                value={line.memo}
                                onChange={e => updateLine(line.id, { memo: e.target.value })}
                                style={inputStyle}
                              />
                            ) : (
                              line.memo || "-"
                            )}
                          </td>
                          {editable && (
                            <td style={{ padding: "4px" }}>
                              <button
                                onClick={() => removeLine(line.id)}
                                style={{ ...wmsGhostButton, minHeight: "28px", padding: "0 8px", fontSize: "11px" }}
                              >
                                삭제
                              </button>
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {editable && (
                  <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                    <button onClick={() => setSearchAddVendor(group.vendorName)} style={{ ...wmsGhostButton, minHeight: "36px", fontSize: "12px" }}>
                      + 상품 검색 추가
                    </button>
                    <button onClick={() => persistAll()} disabled={saving} style={{ ...wmsSecondaryButton, minHeight: "36px", fontSize: "12px" }}>
                      {saving ? "저장 중..." : "임시저장"}
                    </button>
                    <button
                      onClick={() => handleApprove(group.vendorName)}
                      disabled={saving || group.lines.length === 0}
                      style={{ ...wmsPrimaryButton, minHeight: "36px", fontSize: "12px" }}
                    >
                      승인
                    </button>
                  </div>
                )}

                {(status === "approved" || status === "sent") && (
                  <VendorOrderExportPanel
                    wave={wave}
                    vendorName={group.vendorName}
                    lines={group.lines}
                    status={status}
                    onMarkSent={() => persistAll({ vendorName: group.vendorName, status: "sent" })}
                    onReviseAgain={() => persistAll({ vendorName: group.vendorName, status: "resend_needed" })}
                  />
                )}
              </div>
            );
          })}
        </div>
      )}

      {dirty && (
        <p style={{ fontSize: "11px", color: wmsColors.warn, marginBottom: "10px" }}>
          저장하지 않은 변경사항이 있습니다 — "임시저장"을 눌러야 반영됩니다.
        </p>
      )}

      <a href={`/wms/picking/waves/${wave.id}/complete`} style={{ display: "block", textDecoration: "none" }}>
        <button style={{ ...wmsGhostButton, width: "100%" }}>피킹 완료 화면으로</button>
      </a>

      {searchAddVendor && (
        <ProductSearchAddSheet
          onClose={() => setSearchAddVendor(null)}
          onSelect={product => addProductFromSearch(searchAddVendor, product)}
        />
      )}
    </main>
  );
}

function StatusBadge({ status }: { status: VendorOrderDraftStatus }) {
  const colorMap: Record<VendorOrderDraftStatus, { bg: string; text: string }> = {
    draft: { bg: wmsColors.surfaceBeige, text: wmsColors.muted },
    review: { bg: "#fff3e0", text: "#a6614e" },
    approved: { bg: wmsColors.greenSoft, text: wmsColors.greenDark },
    sent: { bg: wmsColors.green, text: "#ffffff" },
    resend_needed: { bg: wmsColors.warnSoft, text: wmsColors.warn },
  };
  const color = colorMap[status];
  return (
    <span style={{ fontSize: "11px", fontWeight: 700, padding: "3px 10px", borderRadius: "999px", background: color.bg, color: color.text }}>
      {VENDOR_ORDER_STATUS_LABEL[status]}
    </span>
  );
}

const pageStyle: CSSProperties = {
  maxWidth: WMS_MOBILE_WIDTH,
  margin: "0 auto",
  padding: "16px",
  fontFamily: "sans-serif",
  background: wmsColors.background,
  color: wmsColors.ink,
  minHeight: "100vh",
};

const cardStyle: CSSProperties = {
  border: `1px solid ${wmsColors.border}`,
  borderRadius: "12px",
  padding: "14px",
  background: "#ffffff",
};

const inputStyle: CSSProperties = {
  width: "100%",
  minWidth: "60px",
  fontSize: "12px",
  padding: "4px 6px",
  borderRadius: "6px",
  border: `1px solid ${wmsColors.border}`,
};

const stepperButtonStyle: CSSProperties = {
  width: "24px",
  height: "24px",
  flexShrink: 0,
  borderRadius: "6px",
  border: `1px solid ${wmsColors.borderStrong}`,
  background: "#ffffff",
  fontSize: "14px",
  fontWeight: 700,
  cursor: "pointer",
  lineHeight: 1,
};
