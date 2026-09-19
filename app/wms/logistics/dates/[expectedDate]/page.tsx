"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useInvoiceGroupRepositoryState } from "@/lib/wms/invoice-group/context";
import { INVOICE_GROUP_STAGE_LABEL, missingInvoiceGroupDispatchRequirements, type InvoiceGroup } from "@/lib/wms/invoice-group/types";
import type { ShipmentOutputPreview } from "@/lib/wms/shipment-output-context";
import { closeReservedDownloadTarget, downloadBlobPreservingPage, reserveDownloadTarget } from "@/lib/wms/download-client";
import { WMS_MOBILE_WIDTH, wmsColors, wmsGhostButton, wmsPrimaryButton, wmsSecondaryButton } from "@/lib/wms/ui-tokens";
import ShipmentWorkflowStepCard from "../../ShipmentWorkflowStepCard";
import { loadShipmentPrintGroupsByDate } from "@/lib/wms/load-shipment-print-groups";
import { buildFourUpLabelPdf, buildLogisticsBarTenderWorkbook, buildMergedManifestPdf, buildShipmentPrintZip } from "@/lib/wms/shipment-print-client";

/**
 * 입고예정일 단위 처리 화면 (2026-09-18 — 그룹(물류센터) 하나씩 따로 열어야 했던 문제 수정).
 *
 * 같은 입고예정일에 물류센터가 여러 개면 발주묶음(InvoiceGroup)도 여러 개로 나뉘는데, 실제
 * 업무는 "이 날짜 전체"를 한 번에 처리한다(EDD로 검색해 전체선택하는 식). 다행히 송장·쉽먼트·
 * 바코드 엔진(buildShipmentOutputContext)은 발주번호를 한 번에 여러 개 넣으면 내부적으로
 * 센터·주소별로 알아서 나눠 처리하므로, 이 화면은 그 날짜의 모든 발주묶음을 합쳐 발주번호
 * 전체를 한 번에 API에 넘긴다 — 그룹마다 따로 누를 필요가 없다.
 */
export default function InvoiceGroupsByDatePage({ params }: { params: { expectedDate: string } }) {
  const { repository: invoiceGroupRepository, ready: repositoryReady, fixture: fixtureMode } = useInvoiceGroupRepositoryState();
  const expectedDate = decodeURIComponent(params.expectedDate);
  const [groups, setGroups] = useState<InvoiceGroup[] | null>(null);
  const [loadingGroups, setLoadingGroups] = useState(false);
  const [completedGroupCount, setCompletedGroupCount] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [confirming, setConfirming] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);

  const [preview, setPreview] = useState<ShipmentOutputPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [generatingInvoice, setGeneratingInvoice] = useState(false);
  const [invoiceMessage, setInvoiceMessage] = useState<string | null>(null);
  const [invoiceError, setInvoiceError] = useState<string | null>(null);

  const [generatingShipment, setGeneratingShipment] = useState(false);
  const [shipmentMessage, setShipmentMessage] = useState<string | null>(null);
  const [shipmentError, setShipmentError] = useState<string | null>(null);
  const [shipmentReasons, setShipmentReasons] = useState<string[] | null>(null);

  const [generatingBarcode, setGeneratingBarcode] = useState(false);
  const [barcodeMessage, setBarcodeMessage] = useState<string | null>(null);
  const [barcodeError, setBarcodeError] = useState<string | null>(null);

  const [generatingOutputSet, setGeneratingOutputSet] = useState(false);
  const [outputSetMessage, setOutputSetMessage] = useState<string | null>(null);
  const [outputSetError, setOutputSetError] = useState<string | null>(null);

  const [advancing, setAdvancing] = useState(false);
  const [advanceError, setAdvanceError] = useState<string | null>(null);

  const [savingShipmentNumbers, setSavingShipmentNumbers] = useState(false);
  const [shipmentNumberDrafts, setShipmentNumberDrafts] = useState<Record<string, string>>({});
  const [shipmentNumberSaveMessage, setShipmentNumberSaveMessage] = useState<string | null>(null);
  const [shipmentNumberSaveError, setShipmentNumberSaveError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<"confirm" | "dispatched" | null>(null);
  const initialLoadKey = useRef<string | null>(null);
  const initialLoadRepository = useRef<typeof invoiceGroupRepository | null>(null);
  const loadRequestId = useRef(0);
  const refreshRequestId = useRef(0);
  const pendingActionPanelRef = useRef<HTMLElement | null>(null);

  async function loadGroups(): Promise<InvoiceGroup[] | null> {
    const requestId = ++loadRequestId.current;
    try {
      const all = await invoiceGroupRepository.list();
      if (requestId !== loadRequestId.current) return null;
      const allDateGroups = all.filter(group => !group.supersededByGroupId && group.expectedDate === expectedDate);
      const dateGroups = allDateGroups.filter(group => group.stage !== "dispatched" && group.stage !== "shipment_closed");
      setCompletedGroupCount(allDateGroups.length - dateGroups.length);
      setGroups(dateGroups);
      setLoadError(null);
      return dateGroups;
    } catch (error) {
      if (requestId !== loadRequestId.current) return null;
      setLoadError(error instanceof Error ? error.message : "발주묶음을 불러오지 못했습니다.");
      return null;
    }
  }

  const purchaseOrderNumbers = useMemo(() => (groups || []).flatMap(group => group.purchaseOrderNumbers), [groups]);
  const invoiceGroups = useMemo(() => (groups || []).map(group => group.purchaseOrderNumbers), [groups]);
  const fulfillmentCenters = useMemo(() => [...new Set((groups || []).map(group => group.fulfillmentCenter))], [groups]);
  const skuCount = useMemo(() => (groups || []).reduce((sum, group) => sum + group.skuCount, 0), [groups]);
  const totalQuantity = useMemo(() => (groups || []).reduce((sum, group) => sum + group.totalQuantity, 0), [groups]);

  async function handlePreview(targetGroups = groups) {
    const requestId = loadRequestId.current;
    const targetPurchaseOrderNumbers = (targetGroups || []).flatMap(group => group.purchaseOrderNumbers);
    const targetInvoiceGroups = (targetGroups || []).map(group => group.purchaseOrderNumbers);
    if (!targetPurchaseOrderNumbers.length) { setPreview(null); return; }
    if (fixtureMode) {
      setPreview({ requestedPurchaseOrderCount: targetPurchaseOrderNumbers.length, matchedPurchaseOrderCount: targetPurchaseOrderNumbers.length, missingPurchaseOrderNumbers: [], duplicatePurchaseOrderCount: 0, conflictPurchaseOrderNumbers: [], fulfillmentCenterCount: new Set((targetGroups || []).map(group => group.fulfillmentCenter)).size, shippingGroupCount: targetGroups?.length || 0, shippingGroups: [], expectedInvoiceRowCount: targetGroups?.length || 0, missingAddressPurchaseOrders: [], missingPhonePurchaseOrders: [], missingPostalCodeCenters: [], destinationResolutions: [], missingSkuRows: [], missingBarcodeRows: [], quantityErrorRows: [], oversizedPurchaseOrderNumbers: [], sourceRecordCount: (targetGroups || []).reduce((sum, group) => sum + group.skuCount, 0), totalOrderedQuantity: (targetGroups || []).reduce((sum, group) => sum + group.totalQuantity, 0), blockingReasons: [], canGenerate: true });
      setPreviewError(null);
      return;
    }
    setPreviewLoading(true);
    setPreviewError(null);
    try {
      const response = await fetch("/api/wms/hanjin-upload/preview", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ purchaseOrderNumbers: targetPurchaseOrderNumbers, invoiceGroups: targetInvoiceGroups }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "송장 완전성 검사에 실패했습니다.");
      if (requestId === loadRequestId.current) setPreview(data.preview as ShipmentOutputPreview);
    } catch (cause) {
      if (requestId === loadRequestId.current) setPreviewError(cause instanceof Error ? cause.message : "송장 완전성 검사에 실패했습니다.");
    } finally { if (requestId === loadRequestId.current) setPreviewLoading(false); }
  }

  async function handleRefresh(force = false) {
    if (loadingGroups && !force) return;
    const refreshId = ++refreshRequestId.current;
    setLoadingGroups(true);
    try {
      const dateGroups = await loadGroups();
      if (dateGroups?.length) {
        setShipmentNumberDrafts({});
        await handlePreview(dateGroups);
      }
    } finally { if (refreshId === refreshRequestId.current) setLoadingGroups(false); }
  }

  useEffect(() => {
    if (initialLoadRepository.current !== invoiceGroupRepository) {
      initialLoadRepository.current = invoiceGroupRepository;
      initialLoadKey.current = null;
    }
    const key = `${expectedDate}:ready`;
    if (!repositoryReady || initialLoadKey.current === key) return;
    initialLoadKey.current = key;
    loadRequestId.current += 1;
    setGroups(null);
    setCompletedGroupCount(0);
    setPreview(null);
    setShipmentNumberDrafts({});
    void handleRefresh(true);
  }, [repositoryReady, expectedDate, invoiceGroupRepository]); // exactly once for each ready repository/date pair

  useEffect(() => {
    if (!pendingAction) return;
    pendingActionPanelRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    pendingActionPanelRef.current?.focus();
  }, [pendingAction]);

  if (groups === null) return <main style={{ maxWidth: WMS_MOBILE_WIDTH, margin: "0 auto", padding: "24px 16px", fontFamily: "sans-serif" }}><p>이 날짜 작업을 불러오는 중...</p>{loadError && <><p style={{ color: "#c0392b", fontSize: "13px" }}>{loadError}</p><button type="button" disabled={loadingGroups} onClick={() => void handleRefresh()} style={{ ...wmsPrimaryButton, width: "100%", opacity: loadingGroups ? 0.5 : 1 }}>다시 시도</button></>}</main>;
  if (!groups.length) return <main style={{ maxWidth: WMS_MOBILE_WIDTH, margin: "0 auto", padding: "24px 16px", fontFamily: "sans-serif" }}><h1 style={{ margin: "0 0 8px", fontSize: "20px" }}>{expectedDate}</h1>{fixtureMode && <p style={{ padding: "10px", background: "#fff4d8", color: "#7a4d00", fontSize: "12px" }}>개발용 예시자료의 출고완료 결과입니다. 실제 출고 기록은 변경하지 않았습니다.</p>}<p>{completedGroupCount ? `이 날짜의 발주묶음 ${completedGroupCount}건은 출고완료 기록으로 남아 있습니다. 새 생성이나 번호 변경 없이 완료 이력으로 유지됩니다.` : loadError || "이 날짜의 발주묶음을 찾지 못했습니다."}</p><a href={`/wms/logistics/new-orders${fixtureMode ? "?logisticsFixture=1" : ""}`}>신규발주서 검색으로</a></main>;
  if (groups.every(group => group.stage === "dispatched" || group.stage === "shipment_closed")) return <main style={{ maxWidth: WMS_MOBILE_WIDTH, margin: "0 auto", padding: "24px 16px", fontFamily: "sans-serif" }}><h1 style={{ margin: "0 0 8px", fontSize: "20px" }}>{expectedDate}</h1>{fixtureMode && <p style={{ padding: "10px", background: "#fff4d8", color: "#7a4d00", fontSize: "12px" }}>개발용 예시자료의 출고완료 결과입니다. 실제 출고 기록은 변경하지 않았습니다.</p>}<p>발주묶음 {groups.length}건 · 발주 {groups.reduce((sum, group) => sum + group.purchaseOrderNumbers.length, 0)}건 출고완료 기록이 저장되었습니다. 이 화면에서는 생성·번호변경을 잠급니다.</p><a href={`/wms/logistics/new-orders${fixtureMode ? "?logisticsFixture=1" : ""}`}>신규발주서 검색으로</a></main>;

  const isConfirmed = (group: InvoiceGroup, po: string) => group.poConfirmations.some(entry => entry.purchaseOrderNumber === po);
  const confirmedCount = groups.reduce((sum, group) => sum + group.purchaseOrderNumbers.filter(po => isConfirmed(group, po)).length, 0);
  const hasUnsavedShipmentNumbers = groups.some(group => (shipmentNumberDrafts[group.id] ?? group.shipmentNumbers[0] ?? "").trim() !== (group.shipmentNumbers[0] ?? ""));

  async function updateAllGroups(patch: (group: InvoiceGroup) => InvoiceGroup) {
    for (const group of groups || []) {
      const next = patch(group);
      if (next === group) continue;
      await invoiceGroupRepository.save(next);
      setGroups(previous => (previous || []).map(item => item.id === group.id ? next : item));
    }
  }

  async function handleFillFixture() {
    if (!fixtureMode || !groups) return;
    const now = new Date().toISOString();
    await updateAllGroups(group => ({
      ...group,
      poConfirmations: group.purchaseOrderNumbers.map(purchaseOrderNumber => ({ purchaseOrderNumber, confirmedFileName: "TEST_CONFIRM.xlsx", confirmedFilePath: "development-memory", confirmedAt: now })),
      invoiceFileName: "TEST_HANJIN.xlsx", invoiceGeneratedAt: now,
      shipmentInvoiceNumbers: group.purchaseOrderNumbers.map((purchaseOrderNumber, index) => ({ purchaseOrderNumber, invoiceNumber: `TEST-${purchaseOrderNumber}-${index + 1}` })),
      shipmentFileName: "TEST_SHIPMENT.xlsx", shipmentFileGeneratedAt: now, shipmentRegisteredAt: now,
      shipmentNumbers: [`80${group.id.replace(/\D/g, "").slice(-6).padStart(6, "0")}`],
      barcodeFileName: "TEST_BARCODE.xlsx", barcodeGeneratedAt: now, outputSetGeneratedAt: now, stage: "shipment_completed", updatedAt: now,
    }));
    setShipmentNumberDrafts({});
  }

  async function handleConfirmAll() {
    if (confirming) return;
    const missingCount = (groups || []).reduce((sum, group) => sum + group.purchaseOrderNumbers.filter(po => !isConfirmed(group, po)).length, 0);
    if (!missingCount) return;
    setPendingAction("confirm");
  }

  async function executeConfirmAll() {
    setConfirming(true);
    setConfirmError(null);
    try {
      const now = new Date().toISOString();
      await updateAllGroups(group => {
        const missing = group.purchaseOrderNumbers.filter(po => !isConfirmed(group, po));
        if (!missing.length) return group;
        return { ...group, poConfirmations: [...group.poConfirmations, ...missing.map(po => ({ purchaseOrderNumber: po, confirmedFileName: "", confirmedFilePath: "", confirmedAt: now }))], updatedAt: now };
      });
    } catch (error) {
      setConfirmError(error instanceof Error ? error.message : "발주확정 기록을 저장하지 못했습니다.");
    } finally {
      setConfirming(false);
      setPendingAction(null);
    }
  }

  function responseFileName(response: Response, fallback: string): string {
    const disposition = response.headers.get("Content-Disposition") || "";
    const encoded = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
    if (!encoded) return fallback;
    try { return decodeURIComponent(encoded); } catch { return fallback; }
  }

  function responsePoNumbers(response: Response, header: string): Set<string> {
    const raw = response.headers.get(header);
    return new Set(raw ? decodeURIComponent(raw).split(",").map(value => value.trim()).filter(Boolean) : []);
  }

  function hasExactPoSet(actual: Set<string>): boolean {
    return actual.size === purchaseOrderNumbers.length && purchaseOrderNumbers.every(po => actual.has(po));
  }

  async function handleGenerateInvoice() {
    if (generatingInvoice || !preview?.canGenerate || confirmedCount !== purchaseOrderNumbers.length) return;
    if (fixtureMode) { setInvoiceError("개발용 데이터에서는 실제 파일 생성 API를 호출하지 않습니다. ‘테스트 단계 기록 채우기’를 사용하세요."); return; }
    const downloadTarget = reserveDownloadTarget();
    setGeneratingInvoice(true);
    setInvoiceError(null);
    setInvoiceMessage(null);
    try {
      const response = await fetch("/api/wms/hanjin-upload/generate", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ purchaseOrderNumbers, invoiceGroups }),
      });
      if (!response.ok) { const data = await response.json().catch(() => ({})); throw new Error(data.error || "한진택배 업로드파일 생성에 실패했습니다."); }
      const included = responsePoNumbers(response, "X-Added-Po-Numbers");
      if (!hasExactPoSet(included)) throw new Error("한진 파일에 이 날짜의 모든 발주서가 정확히 포함되지 않았습니다. 일부만 기록하지 않았습니다.");
      const fileName = responseFileName(response, "한진택배_업로드.xlsx");
      const driveSaved = response.headers.get("X-NOIDB-Drive-Saved") === "true";
      if (driveSaved) closeReservedDownloadTarget(downloadTarget);
      else downloadBlobPreservingPage(await response.blob(), fileName, downloadTarget);
      const now = new Date().toISOString();
      await updateAllGroups(group => ({ ...group, invoiceFileName: fileName, invoiceGeneratedAt: now, barcodeFileName: undefined, barcodeGeneratedAt: undefined, outputSetGeneratedAt: undefined, outputSetFiles: undefined, updatedAt: now }));
      setInvoiceMessage(`송장파일 생성 완료 · ${fileName}${driveSaved ? " · Drive 자동저장 완료" : ""} · 물류센터 ${fulfillmentCenters.length}곳 전체 포함`);
    } catch (error) {
      closeReservedDownloadTarget(downloadTarget);
      setInvoiceError(error instanceof Error ? error.message : "송장파일 생성 중 오류가 발생했습니다.");
    } finally {
      setGeneratingInvoice(false);
    }
  }

  async function handleGenerateShipment() {
    if (generatingShipment || !groups?.every(group => group.invoiceFileName)) return;
    if (fixtureMode) { setShipmentError("개발용 데이터에서는 실제 파일 생성 API를 호출하지 않습니다. ‘테스트 단계 기록 채우기’를 사용하세요."); return; }
    const downloadTarget = reserveDownloadTarget();
    setGeneratingShipment(true);
    setShipmentError(null);
    setShipmentReasons(null);
    setShipmentMessage(null);
    try {
      const response = await fetch("/api/wms/logistics/build-shipment", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ purchaseOrderNumbers, invoiceGroups }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        setShipmentReasons(Array.isArray(data.reasons) ? data.reasons : null);
        throw new Error(data.error || "쉽먼트파일 생성에 실패했습니다.");
      }
      const included = responsePoNumbers(response, "X-Included-Po-Numbers");
      if (!hasExactPoSet(included)) throw new Error("쉽먼트 파일에 이 날짜의 모든 발주서가 정확히 포함되지 않았습니다. 일부만 기록하지 않았습니다.");
      const trackingByPo = JSON.parse(decodeURIComponent(response.headers.get("X-Po-Tracking-Numbers") || "{}")) as Record<string, string>;
      if (!purchaseOrderNumbers.every(po => typeof trackingByPo[po] === "string" && trackingByPo[po].trim())) {
        throw new Error("쉽먼트 생성 결과의 PO별 한진 송장번호가 모두 확인되지 않아 기록과 다운로드를 중단했습니다.");
      }
      const fileName = responseFileName(response, "쉽먼트생성_업로드파일.xlsx");
      const driveSaved = response.headers.get("X-NOIDB-Drive-Saved") === "true";
      const trackingNumbers = decodeURIComponent(response.headers.get("X-Tracking-Numbers-Used") || "");
      if (driveSaved) closeReservedDownloadTarget(downloadTarget);
      else downloadBlobPreservingPage(await response.blob(), fileName, downloadTarget);
      const now = new Date().toISOString();
      await updateAllGroups(group => ({ ...group, shipmentFileName: fileName, shipmentFileGeneratedAt: now, shipmentInvoiceNumbers: group.purchaseOrderNumbers.map(purchaseOrderNumber => ({ purchaseOrderNumber, invoiceNumber: trackingByPo[purchaseOrderNumber] || "" })), barcodeFileName: undefined, barcodeGeneratedAt: undefined, outputSetGeneratedAt: undefined, outputSetFiles: undefined, updatedAt: now }));
      setShipmentMessage(`쉽먼트파일 생성 완료 · ${fileName}${trackingNumbers ? ` · 송장번호 ${trackingNumbers}` : ""}${driveSaved ? " · Drive 자동저장 완료" : ""}`);
    } catch (error) {
      closeReservedDownloadTarget(downloadTarget);
      setShipmentError(error instanceof Error ? error.message : "쉽먼트파일 생성 중 오류가 발생했습니다.");
    } finally {
      setGeneratingShipment(false);
    }
  }

  /** 물류센터+입고예정일 → 쉽먼트번호. lib/wms/shipment-output-files.ts의 logisticsBarcodeGroupKey와
   *  같은 형식("센터 날짜")을 클라이언트에서 그대로 맞춘다 — 그 파일은 exceljs를 물고 있어
   *  클라이언트 번들에 넣고 싶지 않아 문자열 포맷만 복제했다. */
  function shipmentNumberGroupKey(fulfillmentCenter: string, date: string) {
    return `${fulfillmentCenter} ${date}`;
  }

  async function handleSaveShipmentNumbers() {
    if (savingShipmentNumbers || !groups) return;
    const values = groups.map(group => ({ group, value: (shipmentNumberDrafts[group.id] ?? group.shipmentNumbers[0] ?? "").trim() }));
    const invalid = values.find(entry => !/^\d{8}$/.test(entry.value));
    if (invalid) { setShipmentNumberSaveMessage(null); setShipmentNumberSaveError(`${invalid.group.fulfillmentCenter} 쉽먼트번호를 8자리 숫자로 입력해 주세요. 저장하지 않았습니다.`); return; }
    if (new Set(values.map(entry => entry.value)).size !== values.length) { setShipmentNumberSaveMessage(null); setShipmentNumberSaveError("같은 쉽먼트번호를 서로 다른 물류센터 묶음에 저장할 수 없습니다. 저장하지 않았습니다."); return; }
    const pending = values.filter(({ group, value }) => group.shipmentNumbers[0] !== value || !group.shipmentRegisteredAt);
    if (!pending.length) { setShipmentNumberSaveError(null); setShipmentNumberSaveMessage("변경된 쉽먼트번호가 없습니다. 이미 저장된 기록을 유지합니다."); return; }
    setSavingShipmentNumbers(true);
    setShipmentNumberSaveMessage(null);
    setShipmentNumberSaveError(null);
    let saved = 0;
    try {
      for (const { group, value } of pending) {
        const now = new Date().toISOString();
        const updated: InvoiceGroup = { ...group, shipmentNumbers: [value], shipmentRegisteredAt: now, barcodeFileName: undefined, barcodeGeneratedAt: undefined, outputSetGeneratedAt: undefined, outputSetFiles: undefined, updatedAt: now };
        await invoiceGroupRepository.save(updated);
        saved += 1;
        setGroups(previous => (previous || []).map(item => item.id === group.id ? updated : item));
      }
      setShipmentNumberSaveMessage(`쉽먼트번호 ${saved}건을 저장했습니다.`);
    } catch (error) {
      setShipmentNumberSaveError(`${saved}건 저장 후 중단되었습니다. 저장하지 못한 번호를 확인해 다시 전체 저장하세요. ${error instanceof Error ? error.message : ""}`.trim());
    } finally { setSavingShipmentNumbers(false); }
  }

  async function handleGenerateBarcode() {
    if (generatingBarcode || !groups?.every(group => group.shipmentNumbers.some(value => value.trim()))) return;
    if (fixtureMode) { setBarcodeError("개발용 데이터에서는 실제 파일 생성 API를 호출하지 않습니다. ‘테스트 단계 기록 채우기’를 사용하세요."); return; }
    const downloadTarget = reserveDownloadTarget();
    setGeneratingBarcode(true);
    setBarcodeError(null);
    setBarcodeMessage(null);
    try {
      const shipmentNumbersByGroupKey = Object.fromEntries(
        (groups || [])
          .filter(group => group.shipmentNumbers[0])
          .map(group => [shipmentNumberGroupKey(group.fulfillmentCenter, group.expectedDate), group.shipmentNumbers[0]])
      );
      const response = await fetch("/api/wms/generation-barcode-output", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ purchaseOrderNumbers, shipmentNumbersByGroupKey }),
      });
      if (!response.ok) { const data = await response.json().catch(() => ({})); throw new Error(data.error || "바코드 파일 생성에 실패했습니다."); }
      const fileName = responseFileName(response, "바코드출력_최종.xlsx");
      downloadBlobPreservingPage(await response.blob(), fileName, downloadTarget);
      const now = new Date().toISOString();
      await updateAllGroups(group => ({ ...group, barcodeFileName: fileName, barcodeGeneratedAt: now, updatedAt: now }));
      setBarcodeMessage(`바코드 파일 생성 완료 · ${fileName}`);
    } catch (error) {
      closeReservedDownloadTarget(downloadTarget);
      setBarcodeError(error instanceof Error ? error.message : "바코드 파일 생성 중 오류가 발생했습니다.");
    } finally {
      setGeneratingBarcode(false);
    }
  }

  /** ④ 출력세트 생성 — Supplier Hub 물류>쉽먼트에서 다운로드해 이미 저장해 둔 Label·내역서 PDF를
   *  기준으로 부착문서·동봉내역서·바코드 3종을 만든다. PDF 원본이 아직 저장 전이면 auto-source API가
   *  안내 메시지를 그대로 돌려준다. */
  async function handleGenerateOutputSet() {
    if (generatingOutputSet) return;
    if (hasUnsavedShipmentNumbers) { setOutputSetError("변경한 쉽먼트번호를 전체 저장한 뒤 출력세트를 생성하세요."); return; }
    if (fixtureMode) { setOutputSetError("개발용 데이터에서는 실제 파일 생성 API를 호출하지 않습니다. ‘테스트 단계 기록 채우기’를 사용하세요."); return; }
    const shipmentFileName = groups?.find(group => group.shipmentFileName)?.shipmentFileName;
    if (!shipmentFileName) { setOutputSetError("먼저 쉽먼트 업로드파일을 생성해 주세요."); return; }
    const downloadTarget = reserveDownloadTarget();
    setGeneratingOutputSet(true);
    setOutputSetError(null);
    setOutputSetMessage(null);
    try {
      const { groups: printGroups } = await loadShipmentPrintGroupsByDate(expectedDate, purchaseOrderNumbers, shipmentFileName, {
        expectedShipmentNumbers: groups.flatMap(group => group.shipmentNumbers),
      });
      const [labelsPdf, manifestsPdf, barcodeXlsx] = await Promise.all([
        buildFourUpLabelPdf(printGroups), buildMergedManifestPdf(printGroups), buildLogisticsBarTenderWorkbook(printGroups),
      ]);
      const outputDateToken = expectedDate.replace(/-/g, "");
      const outputFiles = [
        { name: "01_부착문서_4분할.pdf", bytes: labelsPdf },
        { name: "02_동봉내역서_통합.pdf", bytes: manifestsPdf },
        { name: `03_바코드출력_${outputDateToken}_최종.xlsx`, bytes: barcodeXlsx },
      ];
      const fileList = new TextEncoder().encode(["Shipment 출력세트 생성 파일", ...outputFiles.map(file => file.name), "06_생성파일목록.txt"].join("\r\n"));
      const zip = await buildShipmentPrintZip([...outputFiles, { name: "06_생성파일목록.txt", bytes: fileList }]);
      const fileName = `Shipment_출력세트_${outputDateToken}.zip`;
      downloadBlobPreservingPage(zip, fileName, downloadTarget);
      const now = new Date().toISOString();
      await updateAllGroups(group => {
        const candidate: InvoiceGroup = { ...group, barcodeFileName: `03_바코드출력_${outputDateToken}_최종.xlsx`, barcodeGeneratedAt: now, outputSetGeneratedAt: now, updatedAt: now };
        return candidate.stage === "new" && missingInvoiceGroupDispatchRequirements(candidate).length === 0
          ? { ...candidate, stage: "shipment_completed" }
          : candidate;
      });
      setOutputSetMessage(`출력세트 생성 완료 · ${fileName} · 부착문서+동봉내역서+바코드`);
    } catch (error) {
      closeReservedDownloadTarget(downloadTarget);
      setOutputSetError(error instanceof Error ? error.message : "출력세트 생성 중 오류가 발생했습니다.");
    } finally {
      setGeneratingOutputSet(false);
    }
  }

  async function handleMarkDispatched() {
    if (advancing) return;
    if (!groups) return;
    if (hasUnsavedShipmentNumbers) { setAdvanceError("변경한 쉽먼트번호를 전체 저장한 뒤 단계 기록을 진행하세요."); return; }
    const blocked = groups.filter(group => missingInvoiceGroupDispatchRequirements(group).length > 0);
    if (blocked.length) { setAdvanceError(`단계 기록에 필요한 항목: ${[...new Set(blocked.flatMap(missingInvoiceGroupDispatchRequirements))].join(", ")}`); return; }
    setPendingAction("dispatched");
  }

  async function executeStageAction() {
    if (!groups || !pendingAction || pendingAction === "confirm") return;
    if (hasUnsavedShipmentNumbers) { setAdvanceError("변경한 쉽먼트번호를 전체 저장한 뒤 단계 기록을 진행하세요."); setPendingAction(null); return; }
    setAdvancing(true);
    setAdvanceError(null);
    try {
      const now = new Date().toISOString();
      const blocked = groups.filter(group => missingInvoiceGroupDispatchRequirements(group).length > 0);
      if (blocked.length) throw new Error(`출고완료로 표시하려면 모든 묶음의 ${[...new Set(blocked.flatMap(missingInvoiceGroupDispatchRequirements))].join(", ")} 기록이 필요합니다.`);
      for (const group of groups) {
        let current = group;
        if (current.stage === "new") {
          current = { ...current, stage: "shipment_completed", updatedAt: now };
          await invoiceGroupRepository.save(current);
          setGroups(previous => (previous || []).map(item => item.id === current.id ? current : item));
        }
        if (current.stage === "shipment_completed") {
          const dispatched = { ...current, stage: "dispatched" as const, updatedAt: now };
          await invoiceGroupRepository.save(dispatched);
          setGroups(previous => (previous || []).map(item => item.id === dispatched.id ? dispatched : item));
        }
      }
    } catch (error) {
      setAdvanceError(error instanceof Error ? error.message : "단계를 변경하지 못했습니다.");
    } finally {
      setAdvancing(false);
      setPendingAction(null);
    }
  }

  const readyForDispatchCount = groups.filter(group => missingInvoiceGroupDispatchRequirements(group).length === 0).length;
  const canDispatchAll = readyForDispatchCount === groups.length;
  const invoiceGeneratedForAll = groups.every(group => group.invoiceGeneratedAt);
  const shipmentGeneratedForAll = groups.every(group => group.shipmentFileName);
  const barcodeGeneratedForAll = groups.every(group => group.barcodeFileName);
  const outputSetGeneratedForAll = groups.every(group => group.outputSetGeneratedAt);

  return (
    <main style={{ maxWidth: WMS_MOBILE_WIDTH, margin: "0 auto", padding: "12px 12px calc(20px + env(safe-area-inset-bottom))", fontFamily: "sans-serif", color: wmsColors.ink, background: wmsColors.background, minHeight: "100vh" }}>
      <a href={`/wms/logistics/new-orders${fixtureMode ? "?logisticsFixture=1" : ""}`} style={{ color: wmsColors.slateDark, fontSize: "13px" }}>← 신규발주서 검색</a>
      <h1 style={{ margin: "10px 0 4px", fontSize: "20px" }}>{expectedDate}</h1>
      <p style={{ margin: "0 0 14px", color: wmsColors.muted, fontSize: "12px", lineHeight: 1.6 }}>
        {fulfillmentCenters.join(", ")} · 발주 {purchaseOrderNumbers.length}건 · SKU {skuCount}종 · 총수량 {totalQuantity}개
      </p>
      {fixtureMode && <div style={{ margin: "0 0 16px", padding: "12px", borderRadius: "10px", background: "#fff4d8", color: "#7a4d00", fontSize: "12px", fontWeight: 800 }}>개발용 테스트 데이터입니다. 생성 버튼은 실제 파일 API를 호출하지 않습니다.<button type="button" onClick={() => void handleFillFixture()} style={{ ...wmsSecondaryButton, display: "block", width: "100%", marginTop: "8px" }}>테스트 단계 기록 채우기</button></div>}
      {pendingAction && <section ref={pendingActionPanelRef} tabIndex={-1} role="alert" style={{ margin: "0 0 16px", padding: "14px", border: `2px solid ${wmsColors.slateDark}`, borderRadius: "12px", background: wmsColors.surfaceBeige }}>
        <strong style={{ display: "block", fontSize: "14px" }}>{pendingAction === "confirm" ? "발주확정 기록을 저장할까요?" : "출고완료로 기록할까요?"}</strong>
        <p style={{ margin: "7px 0 12px", fontSize: "12px", lineHeight: 1.6 }}>{expectedDate} · 발주 {purchaseOrderNumbers.length}건 · 묶음 {groups.length}건. {pendingAction === "confirm" ? "Supplier Hub에서 실제 발주확정을 마친 경우에만 확인하세요." : "실제 출고를 확인한 뒤에만 저장하세요."}</p>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
          <button type="button" onClick={() => setPendingAction(null)} style={wmsGhostButton}>취소</button>
          <button type="button" disabled={confirming || advancing} onClick={() => void (pendingAction === "confirm" ? executeConfirmAll() : executeStageAction())} style={{ ...wmsPrimaryButton, opacity: confirming || advancing ? 0.5 : 1 }}>{confirming || advancing ? "저장 중..." : "확인하고 기록"}</button>
        </div>
      </section>}
      <button type="button" disabled={previewLoading || loadingGroups} onClick={() => void handleRefresh()} style={{ ...wmsGhostButton, width: "100%", marginBottom: "16px", opacity: previewLoading || loadingGroups ? 0.5 : 1 }}>
        {previewLoading || loadingGroups ? "현재 기록 확인 중..." : "현재 기록 새로고침 · 송장 생성 조건 확인"}
      </button>

      <ShipmentWorkflowStepCard step={1} title="발주확정 기록" subtitle="Supplier Hub에서 이 날짜 전체를 검색·재업로드한 뒤, 여기서는 사실만 기록합니다." status={confirmedCount === purchaseOrderNumbers.length ? "done" : "current"}>
        <p style={{ fontSize: "12px", margin: "0 0 8px" }}>발주확정 {confirmedCount}/{purchaseOrderNumbers.length}건</p>
        {confirmError && <p style={{ color: "#c0392b", fontSize: "12px" }}>{confirmError}</p>}
        <button type="button" disabled={confirming || confirmedCount === purchaseOrderNumbers.length} onClick={() => void handleConfirmAll()} style={{ ...wmsSecondaryButton, width: "100%", opacity: confirming || confirmedCount === purchaseOrderNumbers.length ? 0.5 : 1 }}>
          {confirming ? "기록 중..." : confirmedCount === purchaseOrderNumbers.length ? "이 날짜 전부 발주확정 완료" : `이 날짜 전체 발주확정 기록 (${purchaseOrderNumbers.length - confirmedCount}건)`}
        </button>
      </ShipmentWorkflowStepCard>

      <ShipmentWorkflowStepCard step={2} title="한진 송장생성" subtitle="이 날짜 전체 발주를 한 번에 넣으면 물류센터별로 자동 분리·합배송됩니다." status={invoiceGeneratedForAll ? "done" : confirmedCount === purchaseOrderNumbers.length ? "current" : "blocked"}>
        <div style={{ padding: "9px", marginBottom: "8px", borderRadius: "8px", background: preview?.canGenerate ? "#f0f7f3" : "#fff4f1", fontSize: "11px", lineHeight: 1.6 }}>
          {previewLoading ? "발주서·주소·우편번호 자동 확인 중…" : preview ? `센터 ${preview.fulfillmentCenterCount} · 예상 송장 ${preview.shippingGroupCount}건` : previewError || "확인 대기 중"}
          {preview && <span style={{ display: "block", color: preview.canGenerate ? wmsColors.greenDark : wmsColors.warnText }}>{preview.canGenerate ? "송장 생성 준비 완료" : "송장 생성 전 확인이 필요합니다"}</span>}
          {preview?.blockingReasons?.length ? <div style={{ color: "#b33f35", marginTop: "4px" }}>{preview.blockingReasons.join(" · ")}</div> : null}
        </div>
        {invoiceError && <p style={{ color: "#c0392b", fontSize: "12px" }}>{invoiceError}</p>}
        {invoiceMessage && <p style={{ color: wmsColors.greenDark, fontSize: "12px" }}>{invoiceMessage}</p>}
        <button type="button" disabled={generatingInvoice || previewLoading || !preview?.canGenerate || confirmedCount !== purchaseOrderNumbers.length} onClick={() => void handleGenerateInvoice()} style={{ ...wmsPrimaryButton, width: "100%", opacity: generatingInvoice || previewLoading || !preview?.canGenerate || confirmedCount !== purchaseOrderNumbers.length ? 0.5 : 1 }}>
          {generatingInvoice ? "생성 중..." : invoiceGeneratedForAll ? "송장파일 다시 생성" : "이 날짜 송장파일 한 번에 생성"}
        </button>
      </ShipmentWorkflowStepCard>

      <ShipmentWorkflowStepCard step={3} title="한진 결과 연결 · 쉽먼트 업로드파일" subtitle="한진 결과는 PO·날짜·센터 일치 검증 후 자동 연결됩니다. 쉽먼트 파일은 실제 다운로드한 확정수량 양식을 정확히 찾을 때만 생성됩니다." status={shipmentGeneratedForAll ? "done" : invoiceGeneratedForAll ? "current" : "blocked"}>
        {shipmentError && <div style={{ fontSize: "12px", color: "#c0392b" }}><p style={{ margin: "0 0 4px" }}>{shipmentError}</p>{shipmentReasons?.length ? <ul style={{ margin: 0, paddingLeft: "18px" }}>{shipmentReasons.map((reason, index) => <li key={index}>{reason}</li>)}</ul> : null}</div>}
        {shipmentMessage && <p style={{ color: wmsColors.greenDark, fontSize: "12px" }}>{shipmentMessage}</p>}
        <button type="button" disabled={generatingShipment || !groups.every(group => group.invoiceFileName)} onClick={() => void handleGenerateShipment()} style={{ ...wmsPrimaryButton, width: "100%", opacity: generatingShipment || !groups.every(group => group.invoiceFileName) ? 0.5 : 1 }}>
          {generatingShipment ? "생성 중..." : shipmentGeneratedForAll ? "쉽먼트파일 다시 생성" : "이 날짜 쉽먼트파일 한 번에 생성"}
        </button>
      </ShipmentWorkflowStepCard>

      <ShipmentWorkflowStepCard step={4} title="출력세트 생성" subtitle="Supplier Hub 물류>쉽먼트에서 Label·내역서를 먼저 다운로드해 지정 폴더에 저장한 뒤 눌러 주세요. 부착문서·동봉내역서·바코드가 함께 생성됩니다." status={outputSetGeneratedForAll ? "done" : groups.every(group => group.shipmentNumbers.some(value => /^\d{8}$/.test(value.trim()))) ? "current" : "blocked"}>
        {outputSetError && <p style={{ color: "#c0392b", fontSize: "12px", whiteSpace: "pre-wrap" }}>{outputSetError}</p>}
        {outputSetMessage && <p style={{ color: wmsColors.greenDark, fontSize: "12px" }}>{outputSetMessage}</p>}
        <button type="button" disabled={generatingOutputSet || hasUnsavedShipmentNumbers || !groups.every(group => group.shipmentNumbers.some(value => /^\d{8}$/.test(value.trim())))} onClick={() => void handleGenerateOutputSet()} style={{ ...wmsPrimaryButton, width: "100%", opacity: generatingOutputSet || hasUnsavedShipmentNumbers || !groups.every(group => group.shipmentNumbers.some(value => /^\d{8}$/.test(value.trim()))) ? 0.5 : 1 }}>
          {generatingOutputSet ? "생성 중..." : outputSetGeneratedForAll ? "출력세트 다시 생성" : "이 날짜 출력세트 한 번에 생성"}
        </button>
      </ShipmentWorkflowStepCard>

      {advanceError && <p style={{ color: "#c0392b", fontSize: "12px" }}>{advanceError}</p>}
      {hasUnsavedShipmentNumbers && <p style={{ color: "#c0392b", fontSize: "12px" }}>변경한 쉽먼트번호를 전체 저장해주세요.</p>}
      {readyForDispatchCount > 0 && <p style={{ color: wmsColors.greenDark, fontSize: "12px" }}>출고 준비 기록 {readyForDispatchCount}/{groups.length}건</p>}
      {groups.some(group => group.stage !== "dispatched") && (
        <button type="button" disabled={advancing || hasUnsavedShipmentNumbers || !canDispatchAll} onClick={() => void handleMarkDispatched()} style={{ ...wmsPrimaryButton, width: "100%", marginTop: "8px", opacity: advancing || hasUnsavedShipmentNumbers || !canDispatchAll ? 0.6 : 1 }}>
          {advancing ? "기록 중..." : "실제 출고 확인 후 이 날짜 전체 출고완료로 기록"}
        </button>
      )}
      {groups.every(group => group.stage === "dispatched") && <p style={{ textAlign: "center", color: wmsColors.greenDark, fontSize: "13px", fontWeight: 800, marginTop: "10px" }}>이 날짜 전체 출고완료 기록</p>}

      <details style={{ marginTop: "14px" }} open>
        <summary style={{ cursor: "pointer", fontSize: "12px", color: wmsColors.muted }}>물류센터별 묶음 상세 · 쉽먼트번호 입력 ({groups.length}개)</summary>
        <p style={{ fontSize: "11px", color: wmsColors.muted, lineHeight: 1.6, margin: "6px 0" }}>
          쉽먼트번호는 Supplier Hub에 쉽먼트를 등록해야 발급됩니다. 각 묶음의 8자리 번호를 입력한 뒤 아래에서 전체 저장하면 출력세트를 만들 수 있습니다.
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
          {groups.map(group => (
            <div key={group.id} style={{ padding: "8px 10px", border: `1px solid ${wmsColors.border}`, borderRadius: "9px", fontSize: "11px", color: wmsColors.muted }}>
              <strong style={{ color: wmsColors.ink }}>{group.fulfillmentCenter}</strong> · 발주 {group.purchaseOrderNumbers.join(", ")} · 상태 {missingInvoiceGroupDispatchRequirements(group).length === 0 ? "출고준비 완료" : INVOICE_GROUP_STAGE_LABEL[group.stage]}
              <p style={{ margin: "8px 0", fontSize: "11px" }}>한진 송장번호 {group.shipmentInvoiceNumbers.length}/{group.purchaseOrderNumbers.length}건은 쉽먼트 파일 생성 결과에서 PO·날짜·센터를 검증한 뒤 자동 기록됩니다.</p>
              <div style={{ marginTop: "6px" }}>
                <input
                  type="text"
                  value={shipmentNumberDrafts[group.id] ?? group.shipmentNumbers[0] ?? ""}
                  placeholder="쉽먼트번호 입력"
                  disabled={savingShipmentNumbers}
                  onChange={event => setShipmentNumberDrafts(previous => ({ ...previous, [group.id]: event.target.value }))}
                  style={{ width: "100%", minHeight: "36px", boxSizing: "border-box", border: `1px solid ${wmsColors.borderStrong}`, borderRadius: "7px", padding: "0 8px", fontSize: "12px" }}
                />
              </div>
            </div>
          ))}
        </div>
        {shipmentNumberSaveError && <p style={{ color: "#c0392b", fontSize: "12px", margin: "10px 0 0" }}>{shipmentNumberSaveError}</p>}
        {shipmentNumberSaveMessage && <p style={{ color: wmsColors.greenDark, fontSize: "12px", margin: "10px 0 0" }}>{shipmentNumberSaveMessage}</p>}
        <button type="button" disabled={savingShipmentNumbers} onClick={() => void handleSaveShipmentNumbers()} style={{ ...wmsSecondaryButton, width: "100%", marginTop: "10px", opacity: savingShipmentNumbers ? 0.5 : 1 }}>{savingShipmentNumbers ? "쉽먼트번호 전체 저장 중..." : "이 날짜 쉽먼트번호 전체 저장"}</button>
      </details>

      <a href={`/wms/logistics/new-orders${fixtureMode ? "?logisticsFixture=1" : ""}`} style={{ display: "block", marginTop: "16px" }}>
        <button type="button" style={{ ...wmsGhostButton, width: "100%" }}>신규발주서 검색으로</button>
      </a>
    </main>
  );
}
