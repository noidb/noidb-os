"use client";

import { useMemo, useState } from "react";
import { useInvoiceGroupRepository } from "@/lib/wms/invoice-group/context";
import type { InvoiceGroup } from "@/lib/wms/invoice-group/types";
import { WMS_MOBILE_WIDTH, wmsColors, wmsGhostButton, wmsPrimaryButton, wmsSecondaryButton } from "@/lib/wms/ui-tokens";

/**
 * ②③ 발주확정 (2026-09-18 신규 — 1차 재구성 2단계, 기록전용으로 축소).
 *
 * 실제 흐름(05_사이트_SupplierHub.md, 2026-09-18 사용자 확정): Supplier Hub에서 EDD로 검색 →
 * 전체선택 → 표준양식 다운로드 → 그대로(수정 없이) 재업로드해 발주확정 처리하는 것은 전부
 * Supplier Hub 사이트에서 직접 한다. NOID-B OS는 "이 발주서를 발주확정 처리했다"는 사실만
 * 기록한다 — 예전(GenerateAllPoConfirmButton)처럼 확정수량을 편집하거나 통합파일을 생성하지
 * 않는다. 파일 자체는 사용자가 `발주서업로드완성` 폴더에 직접 저장한다.
 *
 * 같은 입고예정일의 발주서는 Supplier Hub에서 한 번에 검색·재업로드하는 게 보통이라, 날짜
 * 단위 일괄 기록 버튼을 기본으로 두고 개별 발주서 단위 토글도 남겨둔다.
 */
export default function WmsPoConfirmationPage() {
  const invoiceGroupRepository = useInvoiceGroupRepository();
  const [groups, setGroups] = useState<InvoiceGroup[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [openDates, setOpenDates] = useState<Set<string>>(new Set());

  async function load() {
    try {
      const list = await invoiceGroupRepository.list();
      setGroups(list.filter(group => !group.supersededByGroupId));
      setLoadError(null);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "발주묶음을 불러오지 못했습니다.");
    }
  }

  const groupsByDate = useMemo(() => {
    const map = new Map<string, InvoiceGroup[]>();
    for (const group of groups || []) map.set(group.expectedDate, [...(map.get(group.expectedDate) || []), group]);
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [groups]);

  function isConfirmed(group: InvoiceGroup, po: string): boolean {
    return group.poConfirmations.some(entry => entry.purchaseOrderNumber === po);
  }

  function toggleDateOpen(expectedDate: string) {
    setOpenDates(previous => { const next = new Set(previous); if (next.has(expectedDate)) next.delete(expectedDate); else next.add(expectedDate); return next; });
  }

  async function handleTogglePo(group: InvoiceGroup, po: string) {
    setSavingKey(`${group.id}:${po}`);
    setSaveError(null);
    try {
      const now = new Date().toISOString();
      const updated: InvoiceGroup = isConfirmed(group, po)
        ? { ...group, poConfirmations: group.poConfirmations.filter(entry => entry.purchaseOrderNumber !== po), updatedAt: now }
        : { ...group, poConfirmations: [...group.poConfirmations, { purchaseOrderNumber: po, confirmedFileName: "", confirmedFilePath: "", confirmedAt: now }], updatedAt: now };
      await invoiceGroupRepository.save(updated);
      await load();
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "발주확정 기록을 저장하지 못했습니다.");
    } finally {
      setSavingKey(null);
    }
  }

  async function handleConfirmDate(expectedDate: string, dateGroups: InvoiceGroup[]) {
    const missingCount = dateGroups.reduce((sum, group) => sum + group.purchaseOrderNumbers.filter(po => !isConfirmed(group, po)).length, 0);
    if (missingCount === 0) return;
    if (!window.confirm(`${expectedDate} 발주서 ${missingCount}건을 발주확정 완료로 기록할까요?\nSupplier Hub에서 실제로 발주서 업로드 양식을 그대로 재업로드해 발주확정 처리를 이미 마친 경우에만 눌러 주세요.`)) return;
    setSavingKey(`date:${expectedDate}`);
    setSaveError(null);
    try {
      const now = new Date().toISOString();
      for (const group of dateGroups) {
        const missing = group.purchaseOrderNumbers.filter(po => !isConfirmed(group, po));
        if (!missing.length) continue;
        const updated: InvoiceGroup = {
          ...group,
          poConfirmations: [...group.poConfirmations, ...missing.map(po => ({ purchaseOrderNumber: po, confirmedFileName: "", confirmedFilePath: "", confirmedAt: now }))],
          updatedAt: now,
        };
        await invoiceGroupRepository.save(updated);
      }
      await load();
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "발주확정 기록을 저장하지 못했습니다.");
    } finally {
      setSavingKey(null);
    }
  }

  return (
    <main style={{ maxWidth: WMS_MOBILE_WIDTH, margin: "0 auto", padding: "12px 12px calc(20px + env(safe-area-inset-bottom))", fontFamily: "sans-serif", color: wmsColors.ink, background: wmsColors.background, minHeight: "100vh" }}>
      <a href="/wms/logistics/new-orders" style={{ color: wmsColors.slateDark, fontSize: "13px" }}>← 신규발주서 검색</a>
      <h1 style={{ margin: "10px 0 4px", fontSize: "20px" }}>발주확정 기록</h1>
      <p style={{ margin: "0 0 14px", color: wmsColors.muted, fontSize: "12px", lineHeight: 1.6 }}>
        발주확정 자체는 Supplier Hub에서 직접 합니다(EDD 검색 → 전체선택 → 업로드 양식 다운로드 → 그대로 재업로드). 이 화면은 "이 발주서는 발주확정 처리를 마쳤다"는 사실만 기록합니다.
      </p>

      <button type="button" disabled={savingKey !== null} onClick={() => void load()} style={{ ...wmsGhostButton, width: "100%", marginBottom: "14px", opacity: savingKey !== null ? 0.5 : 1 }}>발주확정 기록 조회</button>

      {loadError && <p style={{ color: "#c0392b", fontSize: "13px" }}>{loadError}</p>}
      {saveError && <p style={{ color: "#c0392b", fontSize: "13px" }}>{saveError}</p>}
      {!loadError && groups === null && <p style={{ color: wmsColors.muted, fontSize: "13px" }}>불러오는 중...</p>}
      {groups && groups.length === 0 && <p style={{ color: wmsColors.muted, fontSize: "13px" }}>기록할 발주묶음이 없습니다. 먼저 신규발주서 검색에서 발주묶음을 만들어 주세요.</p>}

      <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
        {groupsByDate.map(([expectedDate, dateGroups]) => {
          const totalPo = dateGroups.reduce((sum, group) => sum + group.purchaseOrderNumbers.length, 0);
          const confirmedPo = dateGroups.reduce((sum, group) => sum + group.purchaseOrderNumbers.filter(po => isConfirmed(group, po)).length, 0);
          const allConfirmed = confirmedPo === totalPo;
          const open = openDates.has(expectedDate);
          return (
            <section key={expectedDate} style={{ border: `2px solid ${allConfirmed ? wmsColors.green : wmsColors.borderStrong}`, borderRadius: "12px", overflow: "hidden" }}>
              <button
                type="button"
                aria-expanded={open}
                onClick={() => toggleDateOpen(expectedDate)}
                style={{ width: "100%", border: 0, padding: "12px", background: allConfirmed ? wmsColors.greenSoft : wmsColors.surfaceBeige, display: "flex", alignItems: "center", gap: "8px", textAlign: "left", cursor: "pointer" }}
              >
                <span style={{ flex: 1, minWidth: 0 }}>
                  <strong style={{ display: "block", fontSize: "14px" }}>{expectedDate} <span style={{ fontWeight: 700, color: allConfirmed ? wmsColors.greenDark : wmsColors.slateDark }}>· 발주확정 {confirmedPo}/{totalPo}건</span></strong>
                  <span style={{ fontSize: "11px", color: wmsColors.muted }}>{[...new Set(dateGroups.map(group => group.fulfillmentCenter))].join(", ")}</span>
                </span>
                <span style={{ fontSize: "11px", color: wmsColors.muted }}>{open ? "▲" : "▼"}</span>
              </button>
              {open && (
                <div style={{ padding: "10px", display: "flex", flexDirection: "column", gap: "8px" }}>
                  <button
                    type="button"
                    disabled={savingKey !== null || allConfirmed}
                    onClick={() => void handleConfirmDate(expectedDate, dateGroups)}
                    style={{ ...wmsPrimaryButton, width: "100%", opacity: savingKey !== null || allConfirmed ? 0.5 : 1 }}
                  >
                    {savingKey === `date:${expectedDate}` ? "기록 중..." : allConfirmed ? "이 날짜 전부 발주확정 완료" : `이 날짜 전체 발주확정 기록 (${totalPo - confirmedPo}건)`}
                  </button>
                  {dateGroups.map(group => (
                    <div key={group.id} style={{ border: `1px solid ${wmsColors.border}`, borderRadius: "10px", padding: "9px", background: "#fff" }}>
                      <div style={{ fontSize: "12px", fontWeight: 800, marginBottom: "6px" }}>{group.fulfillmentCenter}{group.mergedFromMultiplePo ? " (합배송)" : ""}</div>
                      <div style={{ display: "flex", flexDirection: "column", gap: "5px" }}>
                        {group.purchaseOrderNumbers.map(po => {
                          const confirmed = isConfirmed(group, po);
                          const key = `${group.id}:${po}`;
                          return (
                            <div key={po} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px", padding: "7px 9px", border: `1px solid ${confirmed ? wmsColors.green : wmsColors.border}`, borderRadius: "8px", background: confirmed ? wmsColors.greenSoft : wmsColors.surfaceBeige }}>
                              <span style={{ fontSize: "12px" }}>
                                발주서 {po}
                                {confirmed && <span style={{ display: "block", fontSize: "10px", color: wmsColors.greenDark }}>발주확정됨 · {new Date(group.poConfirmations.find(entry => entry.purchaseOrderNumber === po)!.confirmedAt).toLocaleString("ko-KR")}</span>}
                              </span>
                              <button
                                type="button"
                                disabled={savingKey !== null}
                                onClick={() => void handleTogglePo(group, po)}
                                style={{ ...wmsSecondaryButton, minHeight: "32px", padding: "0 10px", fontSize: "11px", opacity: savingKey !== null ? 0.5 : 1 }}
                              >
                                {savingKey === key ? "처리 중..." : confirmed ? "취소" : "확정 기록"}
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          );
        })}
      </div>

      <a href="/wms/logistics/new-orders" style={{ display: "block", marginTop: "16px" }}>
        <button type="button" style={{ ...wmsGhostButton, width: "100%" }}>신규발주서 검색으로</button>
      </a>
    </main>
  );
}
