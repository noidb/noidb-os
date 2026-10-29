"use client";

import { SUPPLIER_HUB_EXTENSION } from "@/lib/wms/extension-info";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  applyLogisticsFollowUpFixture,
  createLogisticsFollowUpFixture,
  createLogisticsReceiptsFixture,
  fixtureMarketingCandidates,
  routeLogisticsReceiptsFixtureItem,
  type FixtureFollowUp,
} from "@/lib/wms/logistics-receipts-fixture";
import type { LogisticsFollowUpResponse } from "@/lib/wms/logistics-follow-up-types";
import type {
  LogisticsReceiptBoard,
  LogisticsReceiptBoardLine,
  LogisticsReceiptTarget,
} from "@/lib/wms/logistics-receipts";
import styles from "./shipments.module.css";
import DiscontinueByCode from "./DiscontinueByCode";
import { saveReceiptTabCounts } from "@/lib/wms/receipt-tab-counts";
import { readLastView, saveLastView } from "@/lib/wms/last-view-cache";

/** 서버 규칙(lib/wms/discontinue-lists.ts DISCONTINUE_OLD_TAB_REASONS)과 같게 유지 — 서버 파일을 화면에서 불러오지 않으려고 따로 둠 */
const DISCONTINUE_OLD_TAB_REASONS = ["비관리SKU", "판매중지SKU", "실적저조SKU", "그 외 재등록SKU"];
type Tab = "anytime" | "results" | "pending" | "history";
type Decision = "vendor" | "discontinue" | "reorder" | "marketing";
type ApiPayload = {
  ok: true;
  status: "ready";
  source: "supplier-hub-shipments";
  schemaVersion: 3;
  collectedAt?: string;
  targets: LogisticsReceiptTarget[];
  board: LogisticsReceiptBoard;
  followUp?: LogisticsFollowUpResponse;
  /** 제품DB 표시(과재고·단종·누적입고 100+) — SKU별 */
  productDbStatuses?: Record<string, string[]>;
  /** 제품DB 이미지·제품링크 — SKU별 */
  productDbLooks?: Record<string, { imageUrl: string; productLink: string }>;
  /** 마케팅 무조건 제외(같은 모델 전체) 현황 */
  marketingExclusion?: { listedSkuCount: number; models: string[]; skuCount: number; userSkus?: Array<{ skuId: string; productName: string; at: string }> };
  /** 제품DB 기준 단종 대상·단종해제 대상 목록 */
  statusLists?: { discontinue: StatusListRow[]; release: StatusListRow[]; discontinuePending?: (StatusListRow & { clearedAt: string })[]; reregisteredExcluded?: string[] } | null;
  /** 가장 최근에 한꺼번에 비운 목록(되살리기용) */
  statusListLastCleared?: Partial<Record<"discontinue" | "release", { at: string; count: number } | null>>;
  /** 단종해제 신청 완료를 누른 SKU(SKU → 신청 시각) */
  statusListRequested?: Partial<Record<"discontinue" | "release", Record<string, string>>>;
  sheetHealth?: { unreadTabs: string[]; duplicateSkus: { skuId: string; tabs: string[] }[] } | null;
  /** 이미 거래처에 보낸 발주(입고대기·입고지연) — SKU별 */
  openVendorOrders?: Record<string, { quantity: number; vendors: string[]; sentOn: string; delayed: boolean }>;
  /** 마케팅 후보 줄별: 그 입고예정일 뒤에 같은 SKU로 나온 쿠팡 추가 발주(초도가 이미 팔린 신호) */
  laterOrders?: Record<string, { orderCount: number; quantity: number; latestExpectedDate: string }>;
  /** 마케팅 SKU의 발주상태(제품DB 발주가능상태, 없으면 쿠팡 조회값) */
  orderStatuses?: Record<string, string>;
  /** 마케팅 후보 줄별 원발주서 매입가(부가세 포함 단가) */
  marketingPrices?: Record<string, { price: number; fromOtherOrder?: boolean }>;
  /** SKU만 있는 곳에 보여 줄 상품명(제품DB·상태 탭·재등록·쉽먼트) */
  skuNames?: Record<string, string>;
  /** 기존 발주로 처리한 미납 줄 */
  coveredByVendorOrder?: Record<string, { skuId: string; productName: string; shipmentNumber: string; quantity: number; vendors: string[]; sentOn: string; at: string }>;
  /** 미납 SKU 리스트에서 '재발주요청 제외'로 뺀 줄(2026-10-21) */
  reorderExcluded?: Record<string, { skuId: string; productName: string; shipmentNumber: string; quantity: number; at: string }>;
  /** 쉽먼트별 내역과 처음 가져온 시각(2026-10-15) */
  shipmentDetails?: Record<string, { firstSeenAt: string; totalDelivered: number | null; totalReceived: number | null; lines: Array<{ purchaseOrderNumber: string; skuId: string; productName: string; deliveredQuantity: number; receivedQuantity: number }> }>;
  /** 공급상태가 정상이 아닌 SKU 확인 결과(단종확인·단종해제) */
  supplyStatusChecks?: Record<string, { decision: "discontinued" | "release"; productName: string; at: string; releasedListClearedAt?: string; /** 단종해제 SKU 직접 추가로 넣음 */ manual?: boolean }>;
};
type FollowUpPayload = LogisticsFollowUpResponse;
type StatusListRow = { skuId: string; productName: string; currentStatus: string; orderableStatus: string; reason: string; key: string };

function isFixtureMode() {
  return (
    process.env.NODE_ENV !== "production" &&
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("logisticsFixture") === "1"
  );
}
function asPayload(value: unknown): ApiPayload {
  const data = value as Partial<ApiPayload>;
  if (
    !data ||
    data.ok !== true ||
    data.status !== "ready" ||
    data.schemaVersion !== 3 ||
    !Array.isArray(data.targets) ||
    !data.board ||
    !Array.isArray(data.board.lines)
  )
    throw new Error("입고결과 응답 형식이 올바르지 않습니다.");
  return data as ApiPayload;
}
function asFollowUpPayload(value: unknown): FollowUpPayload {
  const data = value as Partial<FollowUpPayload>;
  if (
    !data ||
    data.ok !== true ||
    typeof data.token !== "string" ||
    !data.queues ||
    !Array.isArray(data.queues.marketing) ||
    !Array.isArray(data.exclusionHistory) ||
    !Array.isArray(data.proofs)
  )
    throw new Error("후속 처리 응답 형식이 올바르지 않습니다.");
  return data as FollowUpPayload;
}
function downloadMime(fileName: string) {
  return fileName.toLowerCase().endsWith(".zip")
    ? "application/zip"
    : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
}
function proofTargetCount(proof: {
  kind: string;
  sourceKeys: string[];
  couponCount?: number;
  discontinueCount?: number;
  reorderRows?: Array<{ pair: string }>;
}) {
  if (proof.kind === "reorder" && proof.reorderRows)
    return new Set(proof.reorderRows.map((row) => row.pair)).size;
  if (proof.kind === "marketing" && typeof proof.couponCount === "number")
    return proof.couponCount;
  if (
    proof.kind === "discontinue" &&
    typeof proof.discontinueCount === "number"
  )
    return proof.discontinueCount;
  return proof.sourceKeys.length;
}
function groupedTargets(targets: ApiPayload["targets"]) {
  const dates = new Map<string, Map<string, ApiPayload["targets"]>>();
  for (const target of targets) {
    const centers =
      dates.get(target.expectedDate) ||
      new Map<string, ApiPayload["targets"]>();
    centers.set(target.centerName, [
      ...(centers.get(target.centerName) || []),
      target,
    ]);
    dates.set(target.expectedDate, centers);
  }
  return [...dates.entries()].sort(([left], [right]) =>
    left.localeCompare(right),
  );
}
const decisionLabel: Record<Decision, string> = {
  vendor: "거래처 발주",
  reorder: "미납 재발주",
  discontinue: "단종",
  marketing: "쿠폰·광고",
};
const routeHref = (line: LogisticsReceiptBoardLine, fixture: boolean) => {
  if (fixture || !line.route) return undefined;
  if (line.route.decision === "vendor") return "/wms/vendor-orders/manage";
  if (line.route.decision === "reorder") return "/wms/inbound/reorder";
  return undefined;
};

export default function ShipmentReceiptsPage() {
  const [payload, setPayload] = useState<ApiPayload | null>(null);
  // '최신파일 확인하기'로 읽은 쿠팡 최신 발주가능상태(SKU ID별) — 단종·단종해제 표의 '발주상태' 칸에 보인다.
  const [latestOrderable, setLatestOrderable] = useState<{ orderable: Record<string, string>; fileMtime: string } | null>(null);
  // 2026-10-20 사용자 요청: 수시로 하는 일(수시 처리)과 입고결과를 가져온 뒤 하는 일(입고결과 처리)로 탭을 나눔.
  const [tab, setTab] = useState<Tab>("anytime");
  const [optimisticDone, setOptimisticDone] = useState<Set<string>>(new Set());
  const [openShipments, setOpenShipments] = useState<Set<string>>(new Set());
  /** 미납 SKU 리스트 보기: 지금 처리할 것만 / 모든 쉽먼트의 미납 전체(2026-10-21) */
  const [missView, setMissView] = useState<"todo" | "all">("todo");
  const [busy, setBusy] = useState(false);
  const [fixture, setFixture] = useState(false);
  const [modeReady, setModeReady] = useState(false);
  /** 마지막으로 본 목록을 먼저 보여 주는 중이면 그 저장 시각(2026-10-21). 최신 자료가 오면 비운다. */
  const [cachedViewAt, setCachedViewAt] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [followUp, setFollowUp] = useState<
    FollowUpPayload | FixtureFollowUp | null
  >(null);
  const [marketingSelected, setMarketingSelected] = useState<
    Record<string, boolean>
  >({});
  const [couponStartsOn, setCouponStartsOn] = useState("");
  const [couponExpiresOn, setCouponExpiresOn] = useState("");
  const [generatedDownloads, setGeneratedDownloads] = useState<
    Record<string, { fileName: string; href: string }>
  >({});
  const initialLoad = useRef(false);
  const followUpStale = useRef(false);
  const [routingKeys, setRoutingKeys] = useState<Record<string, boolean>>({});
  // 단종해제 SKU 직접 추가 입력칸(2026-10-22)
  const [releaseInput, setReleaseInput] = useState("");
  // 2026-10-11: '마케팅 제외'는 그 줄만 잠깐 막고, 성공하면 화면에서 바로 뺀다(전체 새로 불러오기 없음).
  const [skuExcludePending, setSkuExcludePending] = useState<Record<string, boolean>>({});
  const [skuExcludedNow, setSkuExcludedNow] = useState<Record<string, boolean>>({});
  async function excludeMarketingSkuQuick(skuId: string, productName: string) {
    setSkuExcludePending((current) => ({ ...current, [skuId]: true }));
    setError("");
    try {
      const response = await fetch("/api/wms/logistics/follow-up", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "excludeMarketingSku", skuId, productName }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok) throw new Error(data.error || "마케팅 제외를 저장하지 못했습니다.");
      setSkuExcludedNow((current) => ({ ...current, [skuId]: true }));
      setPayload((current) => current && current.marketingExclusion ? {
        ...current,
        marketingExclusion: { ...current.marketingExclusion, userSkus: data.response?.marketingExcludedSkuIds || data.marketingExcludedSkuIds || current.marketingExclusion.userSkus },
      } : current);
      setMessage(`SKU ${skuId}를 마케팅 제외 목록에 넣었습니다. 같은 모델의 다른 SKU는 다음 새로고침 때 빠집니다.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "마케팅 제외를 저장하지 못했습니다.");
    } finally {
      setSkuExcludePending((current) => { const next = { ...current }; delete next[skuId]; return next; });
    }
  }
  const fixturePayload = useRef<ApiPayload | null>(null);

  async function loadFollowUp(nextPayload: ApiPayload, fixtureMode: boolean) {
    if (fixtureMode) {
      setFollowUp(createLogisticsFollowUpFixture(nextPayload));
      return;
    }
    const response = await fetch("/api/wms/logistics/follow-up", {
      cache: "no-store",
    });
    const data = await response.json();
    if (!response.ok)
      throw new Error(data.error || "후속 처리 목록을 불러오지 못했습니다.");
    setFollowUp(asFollowUpPayload(data));
  }

  async function load(manual = false) {
    if (initialLoad.current && !manual) return;
    initialLoad.current = true;
    setBusy(true);
    setError("");
    try {
      if (isFixtureMode()) {
        setFixture(true);
        const next = fixturePayload.current || createLogisticsReceiptsFixture();
        fixturePayload.current = next;
        setPayload(next);
        await loadFollowUp(next, true);
        setMessage("");
        return;
      }
      setFixture(false);
      // 2026-10-21: 처음 열 때는 이 브라우저에 저장해 둔 마지막 목록을 바로 보여 주고, 뒤에서 최신 자료를 받아 바꾼다.
      // 최신 자료가 올 때까지는 busy라서 처리 버튼은 눌리지 않는다(지난 자료로 처리하지 않게).
      if (!manual) {
        void readLastView<unknown>("logistics-receipts-board").then(cached => {
          if (!cached) return;
          try {
            const view = asPayload(cached.data);
            setPayload(current => current || view);
            if (view.followUp) setFollowUp(current => current || view.followUp!);
            setCachedViewAt(cached.savedAt);
            setModeReady(true);
          } catch { /* 형식이 바뀐 옛 저장본 — 무시 */ }
        });
      }
      const response = await fetch("/api/wms/logistics/receipts?view=board", {
        cache: "no-store",
      });
      const data = await response.json();
      if (!response.ok)
        throw new Error(data.error || "입고결과를 불러오지 못했습니다.");
      const next = asPayload(data);
      setPayload(next);
      setCachedViewAt("");
      void saveLastView("logistics-receipts-board", data);
      if (next.followUp) setFollowUp(next.followUp);
      else await loadFollowUp(next, false);
      setMessage(manual ? "최신 입고결과와 후속 처리 목록을 다시 불러왔습니다." : "");
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "입고결과를 불러오지 못했습니다.",
      );
    } finally {
      setBusy(false);
      setModeReady(true);
    }
  }

  /** 화면을 막지 않고 뒤에서 목록만 다시 받는다(2026-10-15 — 처리완료 뒤 기다리지 않게). */
  async function quietReload() {
    if (isFixtureMode()) return;
    try {
      const response = await fetch("/api/wms/logistics/receipts?view=board", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) return;
      const next = asPayload(data);
      setPayload(next);
      if (next.followUp) setFollowUp(next.followUp);
      void saveLastView("logistics-receipts-board", data);
    } catch { /* 다음 새로고침 때 다시 받음 */ }
  }

  async function followUpAction(
    input: Record<string, unknown>,
    success: string,
  ) {
    if (!payload || !followUp) return;
    // 2026-10-15: 처리완료는 누르는 즉시 목록에서 빼고(화면을 막지 않음) 뒤에서 저장한다. 실패하면 되돌리고 알려 준다.
    const optimisticKeys = input.action === "complete" && typeof input.outputKey === "string"
      ? (followUp.proofs.find((proof) => proof.outputKey === input.outputKey)?.sourceKeys || [])
      : [];
    const background = optimisticKeys.length > 0;
    if (background) {
      setOptimisticDone((current) => new Set([...current, ...optimisticKeys]));
      setMessage("처리완료로 표시했습니다. 저장은 뒤에서 하니 다른 작업을 계속하셔도 됩니다.");
    } else setBusy(true);
    setError("");
    try {
      if (fixture) {
        const next = applyLogisticsFollowUpFixture(
          payload,
          input as Parameters<typeof applyLogisticsFollowUpFixture>[1],
        );
        setFollowUp(next);
        setMessage(
          `${success} 개발용 예시자료에만 표시했습니다. 실제 업무 변경은 없습니다.`,
        );
        return;
      }
      // 2026-10-11: 같은 화면에서 단종·거래처발주·단종확인 등을 누르면 저장소가 바뀌어, 화면을 열 때 받은
      // 확인값(token)이 낡아 "목록이 변경됐습니다"가 났다. 쿠폰·광고 모으기는 서버가 고른 줄이 지금도 후보인지
      // 다시 검사하므로, 보내기 직전에 최신 확인값을 받아 쓴다.
      let token = followUp.token;
      let expectedCollectedAt = payload.collectedAt || payload.board.collectedAt;
      // 파일 생성·처리완료도 같은 문제가 나서(화면 목록과 서버 저장본 읽는 시점 차이) 모든 후속처리에 적용한다.
      // 서버는 생성·완료 때 대상과 증빙을 다시 검사한다.
      {
        const fresh = await fetch("/api/wms/logistics/follow-up", { cache: "no-store" });
        const freshData = await fresh.json().catch(() => ({}));
        if (!fresh.ok || !freshData.token) throw new Error(freshData.error || "최신 후속 처리 목록을 확인하지 못했습니다.");
        token = freshData.token;
        expectedCollectedAt = freshData.collectedAt;
      }
      const response = await fetch("/api/wms/logistics/follow-up", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...input,
          token,
          expectedCollectedAt,
        }),
      });
      const data = await response.json();
      if (!response.ok || !data.ok)
        throw new Error(data.error || "후속 처리 저장에 실패했습니다.");
      if (data.base64 && data.outputKey && data.fileName) {
        setGeneratedDownloads((current) => ({
          ...current,
          [data.outputKey]: {
            fileName: data.fileName,
            href: `data:${downloadMime(data.fileName)};base64,${data.base64}`,
          },
        }));
      }
      if (data.followUp) setFollowUp(data.followUp);
      if (background) void quietReload();
      else await load(true);
      const skipped = Array.isArray(data.skippedCoupons) ? (data.skippedCoupons as Array<{ skuId: string; reason: string }>) : [];
      setMessage(skipped.length
        ? `${success} 쿠폰이 아직 걸려 있거나 예전 쿠폰 종료일을 모르는 ${skipped.length}건은 이번 파일에서 빼고 대기목록에 남겼습니다(목록에 이유 표시).`
        : success);
    } catch (cause) {
      if (background) setOptimisticDone((current) => new Set([...current].filter((key) => !optimisticKeys.includes(key))));
      setError(
        cause instanceof Error
          ? `${background ? "처리완료를 저장하지 못해 목록을 되돌렸습니다. " : ""}${cause.message}`
          : "후속 처리 저장에 실패했습니다.",
      );
    } finally {
      if (!background) setBusy(false);
    }
  }

  async function restoreGeneratedDownload(proof: {
    outputKey: string;
    fileName: string;
  }) {
    setBusy(true);
    setError("");
    try {
      if (fixture)
        throw new Error("개발용 예시자료에서는 파일을 다시 받지 않습니다.");
      const response = await fetch(
        `/api/wms/logistics/follow-up?outputKey=${encodeURIComponent(proof.outputKey)}`,
        { cache: "no-store", credentials: "same-origin" },
      );
      const data = await response.json();
      if (!response.ok || !data.ok || !data.base64)
        throw new Error(data.error || "생성 파일을 다시 받지 못했습니다.");
      setGeneratedDownloads((current) => ({
        ...current,
        [proof.outputKey]: {
          fileName: data.fileName || proof.fileName,
          href: `data:${downloadMime(data.fileName || proof.fileName)};base64,${data.base64}`,
        },
      }));
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "생성 파일을 다시 받지 못했습니다.",
      );
    } finally {
      setBusy(false);
    }
  }

  // 2026-10-23: 화면을 열면 뒤에서 제품DB 발주·입고 칸(누적입고·미입고·최근입고일 등)을 맞춘다. 화면은 기다리지 않는다.
  useEffect(() => { void fetch("/api/wms/product-db-tracking", { method: "POST" }).catch(() => undefined); }, []);
  useEffect(() => {
    const requestedTab = new URLSearchParams(window.location.search).get("tab");
    // 예전 '후속처리' 링크(tab=followup)는 입고결과 처리 탭으로 연다.
    if (requestedTab === "results" || requestedTab === "followup") setTab("results");
    else if (requestedTab === "pending" || requestedTab === "history") setTab(requestedTab);
    void load();
  }, []);

  // 누른 줄만 바로 처리한다: 화면 전체를 다시 불러오지 않고, 다른 줄 버튼도 잠그지 않는다.
  async function submitDecision(
    line: LogisticsReceiptBoardLine,
    decision: Decision,
  ) {
    if (!payload) return;
    setError("");
    if (fixture) {
      const next = routeLogisticsReceiptsFixtureItem(payload, line.lineKey, decision);
      fixturePayload.current = next;
      setPayload(next);
      setFollowUp(createLogisticsFollowUpFixture(next));
      setMessage("개발용 예시자료에만 후속 처리 상태를 표시했습니다. 실제 업무 변경은 없습니다.");
      return;
    }
    setRoutingKeys((current) => ({ ...current, [line.lineKey]: true }));
    try {
      const response = await fetch("/api/wms/logistics/receipts/route-item", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lineKey: line.lineKey,
          decision,
          expectedCollectedAt: payload.collectedAt || payload.board.collectedAt,
          ...(decision === "marketing" ? { confirmMarketing: true } : {}),
        }),
      });
      const data = await response.json();
      if (!response.ok || !data.ok)
        throw new Error(data.error || "후속 처리 연결에 실패했습니다.");
      const route = (data.route || { decision, runId: "", at: new Date().toISOString(), completed: true, quantity: line.remainingQuantity ?? 0, sourceFingerprint: "" }) as LogisticsReceiptBoardLine["route"];
      setPayload((current) => current && {
        ...current,
        board: {
          ...current.board,
          lines: current.board.lines.map((item) =>
            item.lineKey === line.lineKey ? { ...item, state: "routed", route, reviewReason: "후속 처리 중" } : item,
          ),
        },
      });
      followUpStale.current = true;
      setMessage(`SKU ${line.skuId} · ${decisionLabel[decision]}(으)로 보냈습니다.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "후속 처리 연결에 실패했습니다.");
    } finally {
      setRoutingKeys((current) => {
        const next = { ...current };
        delete next[line.lineKey];
        return next;
      });
    }
  }

  // 단종확인·단종해제·되돌리기·단종해제 목록 비우기. 저장된 결과로 화면만 바로 바꾼다.
  /** 실수로 비운 단종·단종해제 목록을 되살린다(2026-10-20). */
  async function restoreLastClear(kind: "discontinue" | "release") {
    const batch = payload?.statusListLastCleared?.[kind];
    if (!batch || fixture) return;
    const label = kind === "release" ? "단종해제 대상" : "단종 대상";
    if (!window.confirm(`${new Date(batch.at).toLocaleString("ko-KR")}에 비운 ${label} ${batch.count}건을 목록에 되살립니다.\n\n그 전에 하나씩 '삭제'한 SKU는 그대로 지워진 상태로 둡니다.`)) return;
    const key = `restore:${kind}`;
    setRoutingKeys((current) => ({ ...current, [key]: true }));
    setError("");
    try {
      const response = await fetch("/api/wms/logistics/supply-status-check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "restore-last-clear", kind }),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "되살리지 못했습니다.");
      await quietReload();
      setMessage(`${label} 목록을 되살렸습니다. 이미 쿠팡에서 정상으로 바뀐 SKU는 목록에 나오지 않습니다.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "되살리지 못했습니다.");
    } finally {
      setRoutingKeys((current) => {
        const next = { ...current };
        delete next[key];
        return next;
      });
    }
  }

  /** 단종해제 대상에 SKU 직접 추가(2026-10-22) — 붙여넣은 SKU ID를 넣고, 목록에 안 뜬 SKU는 이유를 알려 준다. */
  async function addReleaseSkus() {
    if (fixture) return;
    const skuIds = [...new Set(releaseInput.split(/[^0-9]+/).filter((id) => id.length >= 5 && id.length <= 20))];
    if (!skuIds.length) { setError("SKU ID(숫자)를 한 줄에 하나씩 넣어 주세요."); return; }
    const key = "supply:add-release";
    setRoutingKeys((current) => ({ ...current, [key]: true }));
    setError("");
    try {
      const response = await fetch("/api/wms/logistics/supply-status-check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "add-release", skuIds }),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "추가하지 못했습니다.");
      // 서버가 제품DB 기준으로 다시 계산한 목록을 받아, 빠진 SKU의 이유를 알려 준다.
      const reload = await fetch("/api/wms/logistics/receipts?view=board", { cache: "no-store" });
      const reloadData = await reload.json();
      if (!reload.ok) throw new Error("추가는 했지만 목록을 다시 불러오지 못했습니다. 새로고침해 주세요.");
      const next = asPayload(reloadData);
      setPayload(next);
      if (next.followUp) setFollowUp(next.followUp);
      void saveLastView("logistics-receipts-board", reloadData);
      followUpStale.current = true;
      const shown = new Set((next.statusLists?.release || []).map((row) => row.skuId));
      const reregistered = new Set(next.statusLists?.reregisteredExcluded || []);
      const added = skuIds.filter((id) => shown.has(id));
      const asRereg = skuIds.filter((id) => !shown.has(id) && reregistered.has(id));
      const asNormal = skuIds.filter((id) => !shown.has(id) && !reregistered.has(id));
      setReleaseInput([...asRereg, ...asNormal].join("\n"));
      const notes = [
        added.length ? `${added.length}개를 단종해제 대상에 넣었습니다.` : "",
        asRereg.length ? `재등록 대상(실적저조SKU·그 외 재등록SKU·판매중지SKU 탭·교체이력·재등록구분)이라 해제가 아니라 신규 재등록할 SKU: ${asRereg.join(", ")}` : "",
        asNormal.length ? `발주가능상태가 이미 정상이라 해제할 필요가 없는 SKU: ${asNormal.join(", ")}` : "",
      ].filter(Boolean);
      if (added.length) setMessage(notes.join(" "));
      else setError(notes.join(" "));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "추가하지 못했습니다.");
    } finally {
      setRoutingKeys((current) => {
        const next = { ...current };
        delete next[key];
        return next;
      });
    }
  }

  /** 2026-10-29: 쿠팡 최신 공급상태 파일의 발주가능상태를 직접 눌러 확인한다(시트에 반영이 안 된 SKU도 쿠팡 값으로 보임). 열 때마다 읽지 않는다. */
  async function checkLatestOrderable() {
    if (fixture) return;
    const key = "supply:latest-orderable";
    setRoutingKeys((current) => ({ ...current, [key]: true }));
    setError("");
    try {
      const response = await fetch("/api/wms/supply-status/audit", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok || data.error) throw new Error(data.error || "쿠팡 최신 공급상태를 읽지 못했습니다.");
      if (data.fileFound === false || !data.latestOrderable) throw new Error("상품공급상태 최신 파일을 찾지 못했습니다. 작업센터에서 파일이 올라와 있는지 확인해 주세요.");
      setLatestOrderable({ orderable: data.latestOrderable, fileMtime: data.fileMtime });
      setMessage(`쿠팡 최신 공급상태 파일(${new Date(data.fileMtime).toLocaleString("ko-KR")})로 발주상태를 다시 확인했습니다. 정상으로 바뀐 줄은 ✓로 표시됩니다.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "쿠팡 최신 공급상태를 읽지 못했습니다.");
    } finally {
      setRoutingKeys((current) => {
        const next = { ...current };
        delete next[key];
        return next;
      });
    }
  }

  async function supplyCheck(action: "discontinued" | "release" | "undo" | "clear-release" | "clear-list" | "clear-one" | "clear-many" | "mark-requested", skuId = "", productName = "", list?: { kind: "discontinue" | "release"; keys: string[]; skuIds?: string[] }) {
    if (fixture) return false;
    setError("");
    const key = `supply:${skuId || (list ? `${action}:${list.kind}` : action)}`;
    let ok = false;
    setRoutingKeys((current) => ({ ...current, [key]: true }));
    try {
      const response = await fetch("/api/wms/logistics/supply-status-check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, skuId, productName, ...(list || {}) }),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "저장하지 못했습니다.");
      ok = true;
      setPayload((current) => current && {
        ...current,
        supplyStatusChecks: data.supplyStatusChecks,
        statusListRequested: data.statusListRequested || current.statusListRequested,
        // 신청완료 표시는 목록을 그대로 두고 색만 바꾼다.
        statusLists: current.statusLists && list && action !== "mark-requested" ? {
          ...current.statusLists,
          [list.kind]: current.statusLists[list.kind].filter((row) => !list.keys.includes(row.key)),
          // 2026-10-29: 비운 단종 줄(옛 탭 출처)은 쿠팡이 처리할 때까지 '신청 완료 · 쿠팡 처리 대기' 칸으로 옮긴다(서버 계산과 같은 규칙).
          ...(list.kind === "discontinue" ? {
            discontinuePending: [
              ...(current.statusLists.discontinuePending || []).filter((row) => !list.keys.includes(row.key)),
              ...current.statusLists.discontinue
                .filter((row) => list.keys.includes(row.key) && DISCONTINUE_OLD_TAB_REASONS.includes(row.reason))
                .map((row) => ({ ...row, clearedAt: new Date().toISOString() })),
            ],
          } : {}),
        } : current.statusLists,
      });
      followUpStale.current = true;
      setMessage(
        action === "discontinued" ? `SKU ${skuId} 단종 확인했습니다.`
        : action === "release" ? `SKU ${skuId}를 단종해제 대상에 넣었습니다.`
        : action === "undo" ? `SKU ${skuId} 확인을 되돌렸습니다.`
        : action === "clear-one" ? `SKU ${skuId}를 단종해제 대상에서 지웠습니다.`
        : action === "clear-many" ? `정상으로 바뀐 ${list?.keys.length || 0}개를 단종해제 대상에서 지웠습니다. 잘못 지웠으면 아래 '되살리기'를 누르세요.`
        : action === "mark-requested" ? `단종해제 신청완료로 표시했습니다(${list?.skuIds?.length || 0}개). 쿠팡에서 정상으로 바뀐 것을 확인하면 줄마다 '삭제'를 누르세요.`
        : list?.kind === "discontinue" ? "단종 대상 목록을 비웠습니다."
        : "단종해제 대상 목록을 비웠습니다.",
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "저장하지 못했습니다.");
    } finally {
      setRoutingKeys((current) => {
        const next = { ...current };
        delete next[key];
        return next;
      });
    }
    return ok;
  }
  // 미납분을 새로 발주하지 않고 이미 보낸 거래처 발주로 처리(되돌리기 가능)
  async function coverByVendorOrder(line: LogisticsReceiptBoardLine, action: "cover" | "undo") {
    if (fixture || !payload) return;
    setError("");
    const order = payload.openVendorOrders?.[line.skuId];
    setRoutingKeys((current) => ({ ...current, [line.lineKey]: true }));
    try {
      const response = await fetch("/api/wms/logistics/cover-by-vendor-order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, lineKey: line.lineKey, skuId: line.skuId, productName: line.productName, shipmentNumber: line.shipmentNumber,
          quantity: line.remainingQuantity ?? 0, vendors: order?.vendors || [], sentOn: order?.sentOn || "" }),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "저장하지 못했습니다.");
      setPayload((current) => current && { ...current, coveredByVendorOrder: data.coveredByVendorOrder });
      followUpStale.current = true;
      setMessage(action === "cover" ? `SKU ${line.skuId} · 기존 거래처 발주로 처리했습니다.` : `SKU ${line.skuId} · 미납 목록으로 되돌렸습니다.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "저장하지 못했습니다.");
    } finally {
      setRoutingKeys((current) => {
        const next = { ...current };
        delete next[line.lineKey];
        return next;
      });
    }
  }
  // 2026-10-21: 미납 SKU 리스트는 '재발주요청 제외'만 고르고, 나머지는 파일 생성 때 한꺼번에 재발주요청으로 보낸다.
  /** 쿠폰·광고 제외 이력에서 줄 지우기(2026-10-21). 쿠폰·광고에서 빠진 상태는 그대로 두고 이력 목록에서만 숨긴다. */
  async function dismissExclusionHistory(lineKey: string) {
    if (fixture) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/wms/logistics/follow-up", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "dismissExclusion", lineKeys: [lineKey] }),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "삭제하지 못했습니다.");
      setFollowUp((current) => current && { ...current, exclusionHistory: current.exclusionHistory.filter((item) => item.lineKey !== lineKey) } as typeof current);
      setMessage("제외 이력에서 삭제했습니다.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "삭제하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }
  /** 쿠폰 겹침 상품 '포함'(2026-10-21): 확인기록만 바로 저장하고 화면의 빠짐 표시를 지운다. 목록 전체를 다시 계산하지 않는다. */
  async function includeBlockedCoupons(skuIds: string[]) {
    if (fixture || !skuIds.length) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/wms/logistics/follow-up", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "includeBlockedCoupon", skuIds }),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "포함하지 못했습니다.");
      const included = new Set(skuIds);
      setFollowUp((current) => current && {
        ...current,
        queues: { ...current.queues, marketing: current.queues.marketing.map((line) => included.has(line.skuId) ? { ...line, couponNote: undefined } : line) },
      } as typeof current);
      setMessage(`${skuIds.length === 1 ? `SKU ${skuIds[0]}` : `${skuIds.length}개`} · 다음 쿠폰·광고 파일 생성 때 포함합니다. 파일을 다시 생성해 주세요.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "포함하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }
  /** 거래처발주·단종·기존 발주 처리한 미납 줄을 재발주요청으로 바꾼다(2026-10-21). */
  async function moveToReorder(line: LogisticsReceiptBoardLine, status: string) {
    if (fixture || !payload) return;
    if (!window.confirm(`SKU ${line.skuId}는 지금 '${status}' 상태예요. 재발주요청으로 바꿀까요?`)) return;
    setError("");
    setRoutingKeys((current) => ({ ...current, [line.lineKey]: true }));
    try {
      const response = await fetch("/api/wms/logistics/receipts/reroute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lineKey: line.lineKey, expectedCollectedAt: payload.collectedAt || payload.board.collectedAt }),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "재발주요청으로 바꾸지 못했습니다.");
      followUpStale.current = true;
      await load(true);
      setMessage(`SKU ${line.skuId} · 재발주요청으로 바꿨습니다.${data.note ? ` ${data.note}` : ""}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "재발주요청으로 바꾸지 못했습니다.");
    } finally {
      setRoutingKeys((current) => {
        const next = { ...current };
        delete next[line.lineKey];
        return next;
      });
    }
  }
  async function toggleReorderExclusion(line: LogisticsReceiptBoardLine, action: "exclude" | "undo") {
    if (fixture || !payload) return;
    setError("");
    setRoutingKeys((current) => ({ ...current, [line.lineKey]: true }));
    try {
      const response = await fetch("/api/wms/logistics/reorder-exclusion", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, lineKey: line.lineKey, skuId: line.skuId, productName: line.productName, shipmentNumber: line.shipmentNumber, quantity: line.remainingQuantity ?? 0 }),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "저장하지 못했습니다.");
      setPayload((current) => current && { ...current, reorderExcluded: data.reorderExcluded });
      const routed = Boolean(line.route || payload.coveredByVendorOrder?.[line.lineKey]);
      setMessage(action === "exclude" ? `SKU ${line.skuId} · ${routed ? "미납 목록에서 삭제했습니다." : "재발주요청에서 제외했습니다."}` : `SKU ${line.skuId} · ${routed ? "삭제를 되돌렸습니다." : "제외를 취소했습니다."}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "저장하지 못했습니다.");
    } finally {
      setRoutingKeys((current) => {
        const next = { ...current };
        delete next[line.lineKey];
        return next;
      });
    }
  }
  /** 제외하지 않은 미납 줄을 모두 재발주요청으로 보낸 뒤 재발주요청 파일을 만든다. */
  async function sendReorderAndGenerate(targets: LogisticsReceiptBoardLine[]) {
    if (!payload) return;
    if (fixture) {
      for (const line of targets) await submitDecision(line, "reorder");
      return;
    }
    setBusy(true);
    setError("");
    const failed: string[] = [];
    try {
      for (const [index, line] of targets.entries()) {
        setMessage(`재발주요청으로 보내는 중… ${index + 1}/${targets.length}`);
        try {
          const response = await fetch("/api/wms/logistics/receipts/route-item", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ lineKey: line.lineKey, decision: "reorder", expectedCollectedAt: payload.collectedAt || payload.board.collectedAt }),
          });
          const data = await response.json();
          if (!response.ok || !data.ok) throw new Error(data.error || "보내지 못했습니다.");
          const route = (data.route || { decision: "reorder", runId: "", at: new Date().toISOString(), completed: true, quantity: line.remainingQuantity ?? 0, sourceFingerprint: "" }) as LogisticsReceiptBoardLine["route"];
          setPayload((current) => current && {
            ...current,
            board: { ...current.board, lines: current.board.lines.map((item) => item.lineKey === line.lineKey ? { ...item, state: "routed", route, reviewReason: "후속 처리 중" } : item) },
          });
        } catch (cause) {
          failed.push(`SKU ${line.skuId}: ${cause instanceof Error ? cause.message : "보내지 못했습니다."}`);
        }
      }
    } finally {
      setBusy(false);
    }
    followUpStale.current = true;
    if (failed.length) {
      setError(`재발주요청으로 못 보낸 상품 ${failed.length}건 — ${failed.join(" / ")}`);
      if (failed.length === targets.length) return;
    }
    await followUpAction({ action: "generate", kind: "reorder" }, "미납분 재발주요청 파일을 생성했습니다.");
  }
  const openOrderNote = (skuId: string) => {
    const order = payload?.openVendorOrders?.[skuId];
    if (!order) return null;
    const sent = order.sentOn ? `${Number(order.sentOn.slice(5, 7))}/${Number(order.sentOn.slice(8, 10))} 발주` : "발주";
    return (
      <span className={styles.openOrder}>
        거래처 발주중 {order.quantity}개 · {order.delayed ? "입고지연" : "입고대기"} · {sent}
        {order.vendors.length ? ` · ${order.vendors.join(", ")}` : ""}
      </span>
    );
  };
  // 단종해제 대상 SKU 엑셀 파일(SKU ID·상품명) — 누를 때만 만든다.
  async function downloadReleaseFile(scope: "fresh" | "all") {
    setError("");
    setRoutingKeys((current) => ({ ...current, "release-file": true }));
    try {
      const response = await fetch("/api/wms/logistics/status-list-file", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ scope }) });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "엑셀 파일을 만들지 못했습니다.");
      const link = document.createElement("a");
      link.href = `data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,${data.base64}`;
      link.download = data.fileName;
      document.body.append(link);
      link.click();
      link.remove();
      setMessage(`단종해제 대상 엑셀을 만들었습니다(${scope === "fresh" ? "신청 전" : "전체"} ${data.count}건).`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "엑셀 파일을 만들지 못했습니다.");
    } finally {
      setRoutingKeys((current) => {
        const next = { ...current };
        delete next["release-file"];
        return next;
      });
    }
  }
  const supplyButtons = (skuId: string, productName: string) => (
    <div className={styles.decisionRow}>
      <button
        type="button"
        className={`softBeigeButton ${styles.decisionButton}`}
        disabled={routingKeys[`supply:${skuId}`]}
        onClick={() => void supplyCheck("discontinued", skuId, productName)}
      >
        단종확인
      </button>
      <button
        type="button"
        className={`softSageButton ${styles.decisionButton}`}
        disabled={routingKeys[`supply:${skuId}`]}
        onClick={() => void supplyCheck("release", skuId, productName)}
      >
        단종해제
      </button>
    </div>
  );

  // 분류 후 후속처리·처리이력 탭을 열 때만 최신 목록을 한 번 불러온다.
  function openTab(value: Tab) {
    setTab(value);
    if (value !== "pending" && followUpStale.current) {
      followUpStale.current = false;
      void load(true);
    }
  }

  const lines = payload?.board.lines || [];
  const lineByKey = new Map(lines.map((line) => [line.lineKey, line]));
  const lineBySku = new Map(lines.map((line) => [line.skuId, line]));
  // 2026-10-11: 추가 발주가 나온(초도가 이미 팔린) 마케팅 후보는 기본으로 체크를 뺀다. 사용자가 직접 바꾸면 그 값을 따른다.
  const laterOrders = payload?.laterOrders || {};
  const isMarketingChecked = (lineKey: string) => marketingSelected[lineKey] ?? !laterOrders[lineKey];
  const supplyChecks = payload?.supplyStatusChecks || {};
  // 공급상태가 정상이 아니어서 검토로 빠진 줄(단종확인·단종해제 대상)
  const isSupplyReview = (line: LogisticsReceiptBoardLine) =>
    line.state === "review" && (line.reviewReason || "").startsWith("공급상태");
  const covered = payload?.coveredByVendorOrder || {};
  const supplyDecided = (line: LogisticsReceiptBoardLine) =>
    (isSupplyReview(line) && Boolean(supplyChecks[line.skuId])) || Boolean(covered[line.lineKey]);
  const shortageLines = lines.filter(
    (line) =>
      !supplyDecided(line) &&
      line.kind === "shortage" &&
      (line.state === "ready" || line.state === "review") &&
      (line.remainingQuantity ?? 0) > 0,
  );
  const shortageReviewLines = lines.filter(
    (line) =>
      !supplyDecided(line) &&
      line.kind === "shortage" &&
      line.state === "review" &&
      (line.remainingQuantity ?? 0) <= 0,
  );
  const rawMarketingLines = lines.filter(
    (line) =>
      line.kind === "marketing" &&
      (line.state === "ready" || line.state === "review"),
  );
  const followUpData = followUp as FollowUpPayload | FixtureFollowUp | null;
  const marketingLines =
    payload && followUpData && fixture
      ? fixtureMarketingCandidates(payload, followUpData as FixtureFollowUp)
      : rawMarketingLines.filter(
          (line) =>
            !skuExcludedNow[line.skuId] &&
            !followUpData?.queues.marketing.some(
              (item) => item.lineKey === line.lineKey,
            ) &&
            !followUpData?.exclusionHistory.some(
              (item) => item.lineKey === line.lineKey && !item.restoredAt,
            ) &&
            !followUpData?.proofs.some((proof) =>
              proof.sourceKeys.includes(line.lineKey),
            ),
        );
  const pendingShipmentNumbers = new Set(
    lines
      .filter((line) => line.state === "pending" || line.state === "unknown")
      .map((line) => line.shipmentNumber),
  );
  const reorderExcluded = payload?.reorderExcluded || {};
  const missStatusOf = (line: LogisticsReceiptBoardLine): string => {
    if (line.route) return line.route.decision === "reorder" ? "재발주요청 보냄" : `${decisionLabel[line.route.decision]}(으)로 보냄`;
    if (covered[line.lineKey]) return "기존 거래처 발주로 처리";
    if (isSupplyReview(line) && supplyChecks[line.skuId]) return supplyChecks[line.skuId].decision === "release" ? "단종해제 승인 대기" : "단종확인함";
    if (reorderExcluded[line.lineKey]) return "재발주요청 제외함";
    if (line.state === "ready") return "처리 전";
    return line.reviewReason || "확인 필요";
  };
  // 2026-10-21 사용자 요청: 지금까지 가져온 모든 쉽먼트에서 아직 미납분 재발주요청으로 보내지 않은 미납 줄을 다 보여 준다.
  // 거래처발주·단종·기존 발주 처리·단종확인·직접 제외한 줄도 다시 검토할 수 있게 상태와 함께 남긴다.
  const missRank = (line: LogisticsReceiptBoardLine) => {
    const status = missStatusOf(line);
    return status === "처리 전" ? 0 : status === "재발주요청 제외함" ? 2 : 1;
  };
  // 지금 발주가능상태(제품DB 기준). 정상이 아니면 쿠팡에 재발주요청을 할 수 없다.
  const currentOrderStatus = (skuId: string) => payload?.orderStatuses?.[skuId] || "";
  // 2026-10-21 사용자 요청: 단종확인한 SKU, 그리고 거래처발주·기존 발주로 처리한 뒤 이미 단종된(발주가능상태가 정상이 아니고 단종해제를 고르지 않은) SKU는 목록에서 뺀다.
  // 단종해제를 고른 SKU는 '단종해제 승인 대기'로 남기고, 쿠팡이 정상으로 바꾸면 자동으로 '처리 전'이 되어 재발주요청 대상이 된다.
  const hiddenAsDiscontinued = (line: LogisticsReceiptBoardLine) => {
    if (supplyChecks[line.skuId]?.decision === "discontinued") return true;
    // 거래처발주·기존 발주로 처리한 줄을 '삭제'했으면 목록에서 뺀다(최종 단종 답변을 받고 단종 처리한 것 등).
    if ((line.route || covered[line.lineKey]) && reorderExcluded[line.lineKey]) return true;
    const status = currentOrderStatus(line.skuId);
    return Boolean((line.route || covered[line.lineKey]) && status && status !== "정상" && supplyChecks[line.skuId]?.decision !== "release");
  };
  const resultLines = lines
    .filter((line) => line.kind === "shortage" && Boolean(line.skuId) && (line.remainingQuantity ?? 0) > 0 && line.route?.decision !== "reorder" && line.route?.decision !== "marketing" && !hiddenAsDiscontinued(line))
    .sort((left, right) => missRank(left) - missRank(right)
      || (right.target.expectedDate || "").localeCompare(left.target.expectedDate || "")
      || left.shipmentNumber.localeCompare(right.shipmentNumber) || left.skuId.localeCompare(right.skuId));
  const routedLines = lines.filter((line) => line.state === "routed");
  // 파일 생성 때 재발주요청으로 함께 보낼 미납 줄(처리 전인 것만 — 제외·거래처발주·단종·기존 발주 처리한 줄은 넣지 않음)
  const reorderReadyLines = resultLines.filter((line) => missStatusOf(line) === "처리 전");
  const reorderExcludedCount = resultLines.filter((line) => reorderExcluded[line.lineKey]).length;
  // 전체 미납 보기: 예전 쉽먼트까지 미납이 있었던 모든 줄(이미 보낸 줄 포함)을 입고예정일 최신순으로.
  const allMissLines = lines
    .filter((line) => line.kind === "shortage" && Boolean(line.skuId) && ((line.remainingQuantity ?? 0) > 0 || Boolean(line.route)))
    .sort((a, b) => (b.target.expectedDate || "").localeCompare(a.target.expectedDate || "") || a.shipmentNumber.localeCompare(b.shipmentNumber) || a.skuId.localeCompare(b.skuId));
  const allMissTodoCount = allMissLines.filter((line) => missStatusOf(line) === "처리 전").length;
  const unavailableShown = (payload?.board.unavailableSkus || []).filter((item) => !supplyChecks[item.skuId]);
  // 단종해제 대상: 서버가 제품DB·메모·화면 선택을 합친 목록. 화면에서 방금 누른 SKU도 바로 보이게 더한다.
  const serverRelease = payload?.statusLists?.release || [];
  const releaseList: StatusListRow[] = [
    ...serverRelease,
    ...Object.entries(supplyChecks)
      .filter(([skuId, check]) => check.decision === "release" && !check.releasedListClearedAt && !serverRelease.some((row) => row.skuId === skuId))
      .map(([skuId, check]) => ({ skuId, productName: check.productName, currentStatus: "", orderableStatus: "", reason: check.manual ? "직접 추가" : "입고결과", key: skuId })),
  ].sort((a, b) => a.skuId.localeCompare(b.skuId));
  const discontinueList: StatusListRow[] = payload?.statusLists?.discontinue || [];
  type FollowUpKind = "marketing" | "discontinue" | "reorder";
  const followUpQueueOf = (kind: FollowUpKind) => (followUpData?.queues[kind] || []).filter((item) => !optimisticDone.has(item.lineKey));
  const followUpProofOf = (kind: FollowUpKind) => {
    const completedSourceKeys = new Set(
      (followUpData?.proofs || [])
        .filter((proof) => String(proof.kind) === kind && Boolean(proof.completedAt))
        .flatMap((proof) => proof.sourceKeys),
    );
    return [...(followUpData?.proofs || [])]
      .filter(
        (proof) =>
          String(proof.kind) === kind &&
          !proof.completedAt &&
          !proof.sourceKeys.every((sourceKey) => optimisticDone.has(sourceKey)) &&
          !proof.sourceKeys.every((sourceKey) => completedSourceKeys.has(sourceKey)),
      )
      .sort((left, right) => right.at.localeCompare(left.at))[0];
  };
  const productDbBadge = (skuId: string) => {
    const badges = payload?.productDbStatuses?.[skuId];
    return badges?.length ? <>{badges.map((badge) => <span key={badge} className={styles.productDbBadge}>{badge}</span>)}</> : null;
  };
  // 상품 사진(작은 썸네일)과 상품명. 제품링크가 있으면 상품명을 눌러 새 창으로 연다.
  const productThumb = (skuId: string) => {
    const imageUrl = payload?.productDbLooks?.[skuId]?.imageUrl;
    return imageUrl ? <img className={styles.thumb} src={imageUrl} alt="" loading="lazy" /> : <span className={styles.thumbEmpty}>사진 없음</span>;
  };
  const productTitle = (skuId: string, name: string) => {
    const link = payload?.productDbLooks?.[skuId]?.productLink;
    return link ? <a className={styles.productLink} href={link} target="_blank" rel="noreferrer">{name}</a> : name;
  };
  // 쉽먼트·발주번호·입고예정일을 한 칸에 위아래로
  const shipInfo = (shipmentNumber: string, purchaseOrderNumber: string, expectedDate: string) => (
    <>
      <span>쉽먼트 {shipmentNumber}</span>
      <span>발주 {purchaseOrderNumber || "-"}</span>
      <span>입고예정 {expectedDate ? expectedDate.slice(5).replace("-", "/") : "-"}</span>
    </>
  );
  const resultColumns = (
    <colgroup>
      <col className={styles.colInfo} />
      <col />
      <col className={styles.colNum} />
      <col className={styles.colNum} />
      <col className={styles.colNum} />
      <col className={styles.colDecision} />
    </colgroup>
  );
  const resultHead = (
    <thead>
      <tr>
        <th>쉽먼트 정보</th>
        <th>상품명</th>
        <th>납품</th>
        <th>입고</th>
        <th>미납</th>
        <th className={styles.decisionCell}>후속 처리</th>
      </tr>
    </thead>
  );
  const renderResultRow = (line: LogisticsReceiptBoardLine) => (
    <tr key={line.lineKey}>
      <td className={styles.shipInfo}>{shipInfo(line.shipmentNumber, line.purchaseOrderNumber, line.target.expectedDate)}</td>
      <td className={styles.product}>
        <div className={styles.productRow}>
          {productThumb(line.skuId)}
          <div>
            <strong>{productDbBadge(line.skuId)}{productTitle(line.skuId, line.productName || "상품명 없음")}</strong>
            <span className={styles.meta}>SKU {line.skuId}</span>
            {line.kind === "shortage" && openOrderNote(line.skuId)}
          </div>
        </div>
      </td>
      <td>{line.deliveredQuantity ?? "-"}</td>
      <td>{line.receivedQuantity ?? "-"}</td>
      <td className={styles.shortageQty}>
        {line.remainingQuantity ??
          (typeof line.deliveredQuantity === "number" &&
          typeof line.receivedQuantity === "number"
            ? Math.max(0, line.deliveredQuantity - line.receivedQuantity)
            : "-")}
      </td>
      <td className={styles.decisionCell}>
        {(() => {
          // 2026-10-21: 재발주요청으로 안 보낸 미납 줄은 지금 상태를 보여 주고, 다시 고를 수 있게 한다.
          const status = missStatusOf(line);
          const busyLine = busy || routingKeys[line.lineKey];
          if (status === "처리 전") return (
            <div className={styles.decisionRow}>
              <button className={`softBeigeButton ${styles.decisionButton}`} style={{ gridColumn: "span 2" }} disabled={busyLine} onClick={() => void toggleReorderExclusion(line, "exclude")}>
                재발주요청 제외
              </button>
            </div>
          );
          if (status === "재발주요청 제외함") return (
            <div className={styles.decisionRow}>
              <span className={styles.meta} style={{ gridColumn: "span 2", textAlign: "center" }}>재발주요청 제외함</span>
              <button className={`softApricotButton ${styles.decisionButton}`} style={{ gridColumn: "span 2" }} disabled={busyLine} onClick={() => void toggleReorderExclusion(line, "undo")}>
                제외 취소
              </button>
            </div>
          );
          // 거래처발주·단종으로 보냈거나 기존 발주로 처리한 줄 → 재발주요청으로 바꿀 수 있다(단종신청 파일을 만든 뒤면 서버가 막고 이유를 알려 줌).
          if (((line.route && line.route.decision !== "reorder") || covered[line.lineKey]) && supplyChecks[line.skuId]?.decision === "release" && currentOrderStatus(line.skuId) !== "정상") return (
            <div className={styles.meta} style={{ textAlign: "center" }}>{status} · 단종해제 승인 대기</div>
          );
          if ((line.route && line.route.decision !== "reorder") || covered[line.lineKey]) return (
            <div className={styles.decisionRow}>
              <span className={styles.meta} style={{ gridColumn: "span 2", textAlign: "center" }}>{status}</span>
              {/* 2026-10-21: 두 버튼을 같은 크기로 한 줄에 */}
              <div style={{ gridColumn: "span 2", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
                <button className={`softSageButton ${styles.decisionButton}`} disabled={busyLine} onClick={() => void moveToReorder(line, status)}>
                  재발주요청
                </button>
                {/* 2026-10-21: 거래처에 발주했지만 최종 단종 답변을 받아 단종 처리한 줄 등 — 이 목록에서만 뺀다(거래처 발주 기록은 그대로). */}
                <button className={`softBeigeButton ${styles.decisionButton}`} disabled={busyLine} onClick={() => { if (window.confirm(`SKU ${line.skuId}를 이 목록에서 삭제할까요? 거래처 발주 기록은 그대로 남고, '모든 쉽먼트 미납 전체'에서 되돌릴 수 있어요.`)) void toggleReorderExclusion(line, "exclude"); }}>
                  삭제
                </button>
              </div>
            </div>
          );
          if (isSupplyReview(line) && !supplyChecks[line.skuId]) return (
            <>
              <div className={styles.meta} style={{ textAlign: "center" }}>{line.reviewReason}</div>
              {supplyButtons(line.skuId, line.productName)}
            </>
          );
          return <div className={styles.meta} style={{ textAlign: "center" }}>{status === "단종해제 승인 대기" ? "단종해제 승인 대기 · 정상으로 바뀌면 재발주요청 대상" : status}</div>;
        })()}
      </td>
    </tr>
  );
  // 2026-10-15: 가장 최근 수집에서 처음 들어온 쉽먼트를 '새로 가져옴'으로 맨 위에 보여 준다.
  const shipmentDetails = payload?.shipmentDetails || {};
  const latestFirstSeen = Object.values(shipmentDetails).map((detail) => detail.firstSeenAt).filter(Boolean).sort().slice(-1)[0] || "";
  const newTargets = latestFirstSeen ? (payload?.targets || []).filter((target) => shipmentDetails[target.shipmentNumber]?.firstSeenAt === latestFirstSeen) : [];
  const newTargetNumbers = new Set(newTargets.map((target) => target.shipmentNumber));
  // 2026-10-15: 1개 입고 줄이 마케팅 SKU 리스트에 왜 있는지/없는지 내역에서 바로 보이게 한다.
  const marketingState = (shipmentNumber: string, skuId: string) => {
    const line = payload?.board.lines.find((item) => item.kind === "marketing" && item.shipmentNumber === shipmentNumber && item.skuId === skuId);
    if (line) {
      if (line.state === "routed" || followUpData?.proofs.some((proof) => proof.sourceKeys.includes(line.lineKey))) return "쿠폰·광고 처리됨";
      if (followUpData?.queues.marketing.some((item) => item.lineKey === line.lineKey)) return "쿠폰·광고 대기";
      if (skuExcludedNow[skuId] || followUpData?.exclusionHistory.some((item) => item.lineKey === line.lineKey && !item.restoredAt)) return "마케팅 제외함";
      return "마케팅 후보";
    }
    return payload?.board.marketingNotes?.[`${shipmentNumber}|${skuId}`] || "";
  };
  const renderShipmentCard = (target: LogisticsReceiptTarget, isNew = false) => {
    const detail = shipmentDetails[target.shipmentNumber];
    const open = openShipments.has(target.shipmentNumber);
    const delivered = detail ? detail.lines.reduce((sum, line) => sum + line.deliveredQuantity, 0) : null;
    const received = detail ? detail.lines.reduce((sum, line) => sum + line.receivedQuantity, 0) : null;
    const shortage = delivered !== null && received !== null ? Math.max(0, delivered - received) : null;
    return (
      <article className={`${styles.shipment} ${open ? styles.shipmentOpen : ""}`} key={`${isNew ? "new-" : ""}${target.shipmentNumber}`} style={isNew ? { borderColor: "#dfbdb2", background: "#fff" } : undefined}>
        <button
          type="button"
          onClick={() => setOpenShipments((current) => { const next = new Set(current); if (next.has(target.shipmentNumber)) next.delete(target.shipmentNumber); else next.add(target.shipmentNumber); return next; })}
          style={{ all: "unset", cursor: "pointer", display: "block", width: "100%" }}
          aria-expanded={open}
        >
          <strong>
            {isNew && <span style={{ display: "inline-block", marginRight: "6px", padding: "1px 7px", borderRadius: "999px", background: "#f2dfd8", color: "#7f4032", fontSize: "11px" }}>새로 가져옴</span>}
            쉽먼트 {target.shipmentNumber} {open ? "▲" : "▼"}
          </strong>
          <p className={styles.meta}>
            {[isNew ? `${target.expectedDate} 입고 · ${target.centerName}` : "", !isNew && detail?.firstSeenAt ? `처음 가져옴 ${new Date(detail.firstSeenAt).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}` : "", detail ? `SKU ${new Set(detail.lines.map((line) => line.skuId)).size}종 · 납품 ${delivered} · 입고 ${received}` : "", shortage ? `미납 ${shortage}` : detail ? "미납 없음" : ""].filter(Boolean).join(" · ")}
          </p>
          <p className={styles.meta}>
            발주{" "}
            {target.purchaseOrderNumbers.length ? target.purchaseOrderNumbers.join(", ") : "복수 발주서 상세 확인 필요"}
          </p>
        </button>
        {pendingShipmentNumbers.has(target.shipmentNumber) && <p className={styles.meta}>마감 수량 미확인</p>}
        {open && (detail ? (
          <div className={styles.tableWrap}>
            <table className={styles.table} aria-label={`쉽먼트 ${target.shipmentNumber} 내역`}>
              <thead><tr><th>SKU</th><th>상품명</th><th>납품</th><th>입고</th><th>미납</th><th>미납 처리</th><th>마케팅</th></tr></thead>
              <tbody>
                {/* 2026-10-21: 미납이 많은 줄부터 보이게 */}
                {[...detail.lines].sort((a, b) => Math.max(0, b.deliveredQuantity - b.receivedQuantity) - Math.max(0, a.deliveredQuantity - a.receivedQuantity)).map((line, index) => {
                  const miss = Math.max(0, line.deliveredQuantity - line.receivedQuantity);
                  return (
                    <tr key={`${line.purchaseOrderNumber}-${line.skuId}-${index}`}>
                      <td>{line.skuId}</td>
                      <td>{line.productName}</td>
                      <td>{line.deliveredQuantity}</td>
                      <td>{line.receivedQuantity}</td>
                      <td style={{ color: miss ? "#b33f35" : undefined, fontWeight: miss ? 800 : undefined }}>{miss || "-"}</td>
                      {/* 2026-10-21: 미납 줄이 왜 미납 SKU 리스트에 없는지 여기서 바로 보이게 */}
                      <td style={{ fontSize: "12px" }}>{miss ? (() => {
                        const boardLine = lines.find((item) => item.kind === "shortage" && item.shipmentNumber === target.shipmentNumber && item.purchaseOrderNumber === line.purchaseOrderNumber && item.skuId === line.skuId);
                        return boardLine ? missStatusOf(boardLine) : "미납 목록에 없음(수량 확인 필요)";
                      })() : ""}</td>
                      <td style={{ fontSize: "12px" }}>{marketingState(target.shipmentNumber, line.skuId)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : <p className={styles.meta}>내역이 없습니다. 새로고침 후 다시 열어 주세요.</p>)}
      </article>
    );
  };
  // 탭 옆 할 일 숫자(2026-10-20): 수시 처리 = 거래처 발주 대기·단종·단종해제(신청 전), 입고결과 처리 = 미납·마케팅·마무리 대기.
  const releaseFreshCount = releaseList.filter((row) => !payload?.statusListRequested?.release?.[row.skuId]).length;
  const vendorCount = followUpData?.queues.vendor.length || 0;
  const anytimeCount = discontinueList.length + releaseFreshCount + followUpQueueOf("discontinue").length;
  const resultsCount = resultLines.length + marketingLines.length + followUpQueueOf("reorder").length + followUpQueueOf("marketing").length;
  // 메인 작업 메뉴에 같은 숫자를 보여 주도록 이 브라우저에 기억해 둔다(개발용 예시자료는 저장하지 않음).
  useEffect(() => {
    if (fixture || !payload || !followUpData) return;
    saveReceiptTabCounts({ vendor: vendorCount, anytime: anytimeCount, results: resultsCount });
  }, [fixture, payload, followUpData, vendorCount, anytimeCount, resultsCount]);
  // 후속처리(파일 만들기·처리완료)를 각 목록 바로 아래에서 끝내도록, 예전 '후속처리' 탭의 작업칸을 종류별로 그린다(2026-10-20).
  const renderFollowUpWork = (followUpKind: FollowUpKind) => {
    if (!followUpData) return null;
    const activeFollowUpQueue = followUpQueueOf(followUpKind);
    // 2026-10-21: 재발주요청은 미납 SKU 리스트에서 제외하지 않은 줄도 파일 생성 때 함께 들어가므로 목록에 미리 보여 준다.
    type QueueRow = (typeof activeFollowUpQueue)[number];
    const shownQueue: QueueRow[] = followUpKind === "reorder"
      ? [...activeFollowUpQueue, ...reorderReadyLines
          .filter((line) => !activeFollowUpQueue.some((item) => item.lineKey === line.lineKey))
          .map((line) => ({ lineKey: line.lineKey, productName: line.productName, skuId: line.skuId, shipmentNumber: line.shipmentNumber,
            purchaseOrderNumber: line.purchaseOrderNumber, kind: "shortage", expectedDate: line.target.expectedDate,
            shortageQuantity: line.remainingQuantity ?? 0 }) as unknown as QueueRow)]
      : activeFollowUpQueue;
    const activeFollowUpProof = followUpProofOf(followUpKind);
    return (
      <section className={styles.followUp} aria-label="후속처리">
            <article className={styles.workArea}>
              <h2>
                {followUpKind === "discontinue"
                  ? "미납 SKU에서 보낸 단종서류"
                  : followUpKind === "reorder"
                    ? "미납분 재발주요청 마무리"
                    : "쿠폰·광고 마무리"}
              </h2>
              <p className={styles.meta}>
                {followUpKind === "reorder"
                  ? `파일에 넣을 미납 ${activeFollowUpQueue.length + reorderReadyLines.length}건${reorderExcludedCount ? ` · 재발주요청 제외 ${reorderExcludedCount}건` : ""}`
                  : `현재 대기 ${activeFollowUpQueue.length}건`}
              </p>
              {/* 2026-10-11 사용자 요청: 쿠폰·광고로 보낸 상품을 입고결과 마케팅 SKU 리스트로 되돌리기 */}
              {followUpKind === "marketing" && !fixture && activeFollowUpQueue.length > 0 && (
                <button
                  type="button"
                  className={styles.button}
                  disabled={busy}
                  style={{ marginBottom: "8px" }}
                  onClick={() => {
                    if (!window.confirm(`쿠폰·광고 대기 ${activeFollowUpQueue.length}건을 모두 입고결과의 마케팅 SKU 리스트로 되돌릴까요?`)) return;
                    void followUpAction(
                      { action: "unqueueMarketing", lineKeys: activeFollowUpQueue.map((item) => item.lineKey) },
                      `쿠폰·광고 대기 ${activeFollowUpQueue.length}건을 마케팅 SKU 리스트로 되돌렸습니다.`,
                    );
                  }}
                >
                  전체 입고결과로 되돌리기
                </button>
              )}
              {followUpKind === "marketing" && (() => {
                // 2026-10-21: 기존 쿠폰과 겹쳐서(또는 종료일을 몰라서) 파일에서 빠지는 상품을 따로 보여 주고 포함·제외를 고르게 한다.
                const uniqueSkus = new Set(shownQueue.map((line) => line.skuId)).size;
                const blockedBySku = new Map<string, { productName: string; note: string; lineKeys: string[] }>();
                for (const line of shownQueue) {
                  const note = (line as { couponNote?: string }).couponNote;
                  if (!note) continue;
                  const current = blockedBySku.get(line.skuId) || { productName: line.productName, note: note.replace(/^쿠폰 파일에서 빠짐 · /, ""), lineKeys: [] };
                  current.lineKeys.push(line.lineKey);
                  blockedBySku.set(line.skuId, current);
                }
                const blocked = [...blockedBySku.entries()];
                return (
                  <>
                    {shownQueue.length > uniqueSkus && (
                      <p className={styles.meta} style={{ margin: "0 0 8px" }}>SKU {uniqueSkus}개 · 같은 SKU {shownQueue.length - uniqueSkus}건은 파일에서 한 줄로 합쳐집니다.</p>
                    )}
                    {blocked.length > 0 && !fixture && (
                      <div style={{ border: "1px solid #dfbdb2", background: "#fbf1ee", borderRadius: "10px", padding: "12px", margin: "0 0 12px" }}>
                        <strong style={{ display: "block", marginBottom: "8px" }}>기존 쿠폰과 겹쳐 파일에서 빠지는 상품 {blocked.length}개 — 포함할지 제외할지 골라 주세요</strong>
                        <div style={{ display: "grid", gap: "8px" }}>
                          {blocked.map(([skuId, item]) => (
                            <div key={skuId} style={{ display: "grid", gridTemplateColumns: "56px 1fr 300px", gap: "10px", alignItems: "center", background: "#fff", borderRadius: "8px", padding: "8px" }}>
                              {productThumb(skuId)}
                              <div>
                                <strong>{productTitle(skuId, item.productName || "상품명 없음")}</strong>
                                <span className={styles.meta} style={{ display: "block" }}>SKU {skuId} · {item.note}</span>
                              </div>
                              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
                                <button type="button" className="softSageButton" disabled={busy} onClick={() => void includeBlockedCoupons([skuId])}>포함</button>
                                <button type="button" className="softBeigeButton" disabled={busy} onClick={() => void followUpAction({ action: "excludeMarketing", lineKeys: item.lineKeys }, `SKU ${skuId} · 쿠폰·광고에서 제외했습니다.`)}>제외</button>
                              </div>
                            </div>
                          ))}
                        </div>
                        {blocked.length > 1 && (
                          <button type="button" className="softSageButton" style={{ width: "100%", marginTop: "8px" }} disabled={busy} onClick={() => void includeBlockedCoupons(blocked.map(([skuId]) => skuId))}>{blocked.length}개 모두 포함</button>
                        )}
                      </div>
                    )}
                  </>
                );
              })()}
              {shownQueue.length ? (
                // 2026-10-21: 마무리 목록도 미납 SKU 리스트와 같은 표(사진·상품명·쉽먼트 정보)로 보여 준다.
                <div className={styles.tableWrap} style={{ maxHeight: "560px", overflowY: "auto" }}>
                  <table className={`${styles.table} ${styles.fixedTable}`} aria-label={`${followUpKind === "reorder" ? "재발주요청" : followUpKind === "discontinue" ? "단종서류" : "쿠폰·광고"} 대기 목록`}>
                    <colgroup>
                      <col className={styles.colInfo} />
                      <col />
                      {followUpKind !== "marketing" && <col className={styles.colNum} />}
                      {followUpKind === "marketing" && !fixture && <col className={styles.colDecision} />}
                    </colgroup>
                    <thead>
                      <tr>
                        <th>쉽먼트 정보</th>
                        <th>상품명</th>
                        {followUpKind !== "marketing" && <th>미납</th>}
                        {followUpKind === "marketing" && !fixture && <th className={styles.decisionCell}>처리</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {shownQueue.map((line) => {
                        const extra = line as { expectedDate?: string; shortageQuantity?: number; couponNote?: string };
                        return (
                          <tr key={line.lineKey}>
                            <td className={styles.shipInfo}>{shipInfo(line.shipmentNumber, line.purchaseOrderNumber, extra.expectedDate || "")}</td>
                            <td className={styles.product}>
                              <div className={styles.productRow}>
                                {productThumb(line.skuId)}
                                <div>
                                  <strong>{productDbBadge(line.skuId)}{productTitle(line.skuId, line.productName || "상품명 없음")}</strong>
                                  <span className={styles.meta}>SKU {line.skuId}</span>
                                  {extra.couponNote && <span className={`${styles.meta} ${styles.error}`}>{extra.couponNote}</span>}
                                  {line.blockedReason && <span className={`${styles.meta} ${styles.error}`}>{line.blockedReason}</span>}
                                </div>
                              </div>
                            </td>
                            {followUpKind !== "marketing" && <td className={styles.shortageQty}>{extra.shortageQuantity || "-"}</td>}
                            {followUpKind === "marketing" && !fixture && (
                              <td className={styles.decisionCell}>
                                <div className={styles.decisionRow}>
                                  <button
                                    type="button"
                                    className={`softApricotButton ${styles.decisionButton}`}
                                    disabled={busy}
                                    onClick={() => void followUpAction({ action: "unqueueMarketing", lineKeys: [line.lineKey] }, `${line.productName} · 마케팅 SKU 리스트로 되돌렸습니다.`)}
                                  >
                                    입고결과로 되돌리기
                                  </button>
                                  <button
                                    type="button"
                                    className={`softBeigeButton ${styles.decisionButton}`}
                                    disabled={busy}
                                    onClick={() => void followUpAction({ action: "excludeMarketing", lineKeys: [line.lineKey] }, `${line.productName} · 쿠폰·광고에서 제외했습니다.`)}
                                  >
                                    쿠폰·광고 제외
                                  </button>
                                </div>
                              </td>
                            )}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className={styles.meta}>대기 대상 0건</p>
              )}
              {(() => {
                const blocked = activeFollowUpQueue.some((line) =>
                  Boolean(line.blockedReason),
                );
                const download =
                  activeFollowUpProof &&
                  generatedDownloads[activeFollowUpProof.outputKey];
                const datesValid = Boolean(
                  couponStartsOn &&
                  couponExpiresOn &&
                  couponStartsOn <= couponExpiresOn,
                );
                return (
                  <div className={styles.fileControls}>
                    <p className={styles.meta}>
                      {activeFollowUpProof
                        ? `현재 파일: ${activeFollowUpProof.fileName} · 생성 파일 대상 ${proofTargetCount(activeFollowUpProof)}건`
                        : "현재 생성 파일 없음"}
                    </p>
                    {activeFollowUpProof &&
                      (download ? (
                        <a
                          className={styles.linkButton}
                          href={download.href}
                          download={download.fileName}
                        >
                          파일 다운로드
                        </a>
                      ) : (
                        !fixture && (
                          <button
                            className={styles.button}
                            disabled={busy}
                            onClick={() =>
                              void restoreGeneratedDownload(activeFollowUpProof)
                            }
                          >
                            생성파일 다시받기
                          </button>
                        )
                      ))}
                    {followUpKind === "marketing" && (
                      <div className={styles.dateRow}>
                        <label className={styles.dateField}>
                          쿠폰 시작일{" "}
                          <input
                            type="date"
                            value={couponStartsOn}
                            onChange={(event) =>
                              setCouponStartsOn(event.target.value)
                            }
                          />
                        </label>
                        <label className={styles.dateField}>
                          쿠폰 종료일{" "}
                          <input
                            type="date"
                            value={couponExpiresOn}
                            onChange={(event) =>
                              setCouponExpiresOn(event.target.value)
                            }
                          />
                        </label>
                      </div>
                    )}
                    <div className={styles.workActions}>
                      <button
                        className={styles.button}
                        disabled={
                          busy || blocked || (!activeFollowUpQueue.length && !(followUpKind === "reorder" && reorderReadyLines.length))
                        }
                        onClick={() =>
                          followUpKind === "reorder" && reorderReadyLines.length
                            ? void sendReorderAndGenerate(reorderReadyLines)
                            : void followUpAction(
                                { action: "generate", kind: followUpKind },
                                `${followUpKind === "reorder" ? "미납분 재발주요청" : followUpKind === "discontinue" ? "단종" : "쿠폰·광고"} 누적 대상 파일을 생성했습니다.`,
                              )
                        }
                      >
                        {followUpKind === "discontinue"
                          ? "단종서류 생성"
                          : followUpKind === "reorder"
                            ? `미납분 재발주요청 파일 생성 (${activeFollowUpQueue.length + reorderReadyLines.length}건)`
                            : "쿠폰·광고 파일 생성"}
                      </button>
                      {followUpKind === "reorder" && !fixture && (
                        <button
                          className={styles.button}
                          disabled={busy || !activeFollowUpQueue.length}
                          onClick={() => {
                            if (!window.confirm(`미납분 재발주요청 ${activeFollowUpQueue.length}건을 파일 없이 처리완료로 끝낼까요? (쿠팡에 요청을 이미 했거나 하지 않기로 한 경우)`)) return;
                            void followUpAction({ action: "completeWithoutFile", kind: "reorder" }, `미납분 재발주요청 ${activeFollowUpQueue.length}건을 처리완료했습니다.`);
                          }}
                        >
                          파일 없이 처리완료
                        </button>
                      )}
                      <button
                        className={`${styles.button} ${styles.buttonPrimary}`}
                        disabled={
                          busy ||
                          blocked ||
                          !activeFollowUpProof ||
                          (followUpKind === "marketing" && !datesValid)
                        }
                        onClick={() =>
                          activeFollowUpProof &&
                          void followUpAction(
                            {
                              action: "complete",
                              kind: followUpKind,
                              outputKey: activeFollowUpProof.outputKey,
                              ...(followUpKind === "marketing"
                                ? {
                                    confirmCoupon: true,
                                    confirmAdvertising: true,
                                    couponStartsOn,
                                    couponExpiresOn,
                                  }
                                : followUpKind === "reorder"
                                  ? { confirmRequested: true }
                                  : { confirmSubmitted: true }),
                            },
                            "처리완료를 기록했습니다.",
                          )
                        }
                      >
                        {activeFollowUpProof
                          ? `이 파일 대상 ${proofTargetCount(activeFollowUpProof)}건 처리완료`
                          : "처리완료"}
                      </button>
                    </div>
                    <p className={styles.meta}>
                      쿠팡에서 처리한 뒤 눌러주세요. 생성 파일에 포함된 대상만
                      완료됩니다.
                    </p>
                  </div>
                );
              })()}
              {followUpData.proofs
                .filter(
                  (proof) =>
                    String(proof.kind) === followUpKind && proof.completedAt,
                )
                .map((proof) => (
                  <p className={styles.meta} key={proof.outputKey}>
                    {followUpKind === "reorder"
                      ? "미납분 재발주요청"
                      : followUpKind === "discontinue"
                        ? "단종서류"
                        : "쿠폰·광고"}{" "}
                    처리완료 이력 · {proof.fileName} · 대상{" "}
                    {proofTargetCount(proof)}건
                    {proof.completedAt ? ` · 완료 ${new Date(proof.completedAt).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}` : ""}
                  </p>
                ))}
            </article>
            {followUpKind === "marketing" &&
              followUpData.exclusionHistory.length > 0 && (
                <section
                  className={styles.exclusions}
                  aria-label="쿠폰·광고 제외 이력"
                >
                  <h3>제외 이력</h3>
                  {followUpData.exclusionHistory.map((line, index) => (
                    <div
                      className={styles.historyItem}
                      key={`${line.lineKey}:${line.at}:${index}`}
                    >
                      {/* 2026-10-11 사용자 요청: SKU만으로는 뭔지 몰라 상품명도 표시 */}
                      <strong>
                        {lineByKey.get(line.lineKey)?.productName || lineBySku.get(line.skuId)?.productName || payload?.skuNames?.[line.skuId] || "상품명 없음"}
                        <small style={{ display: "block", fontWeight: 400 }}>
                          SKU {line.skuId}
                          {(line as { reason?: string }).reason ? ` · ${(line as { reason?: string }).reason}` : ""}
                        </small>
                      </strong>
                      {/* 2026-10-21: 제외 이력도 이미 단종됐거나 곧 단종될 상품은 '삭제'로 목록에서 지운다(쿠폰·광고 제외는 그대로 유지). */}
                      <div style={{ display: "grid", gridTemplateColumns: line.restoredAt || (line as { autoBlocked?: boolean }).autoBlocked ? "1fr 120px" : "120px 120px", gap: "8px", alignItems: "center", marginTop: "6px" }}>
                        {line.restoredAt ? (
                          <span className={styles.meta}>복원완료</span>
                        ) : (line as { autoBlocked?: boolean }).autoBlocked ? (
                          <span className={styles.meta}>단종 처리 상품이라 복원할 수 없어요</span>
                        ) : (
                          <button
                            type="button"
                            className="softSageButton"
                            style={{ minHeight: 36, padding: "6px 10px", fontSize: 13 }}
                            disabled={busy}
                            onClick={() => void followUpAction({ action: "restoreMarketing", lineKeys: [line.lineKey] }, "초도입고 검토 후보로 복원했습니다.")}
                          >
                            제외 복원
                          </button>
                        )}
                        <button
                          type="button"
                          className="softBeigeButton"
                          style={{ minHeight: 36, padding: "6px 10px", fontSize: 13 }}
                          disabled={busy}
                          onClick={() => void dismissExclusionHistory(line.lineKey)}
                        >
                          삭제
                        </button>
                      </div>
                    </div>
                  ))}
                </section>
              )}
      </section>
    );
  };
  return (
    <main className={styles.page}>
      {/* 2026-10-21 사용자 요청: 수시 처리는 쉽먼트 입고결과와 상관없어서, 위쪽 쉽먼트 버튼·가져온 시각·쉽먼트 경고를 숨긴다. */}
      {tab === "anytime" ? (
        <header className={styles.header}>
          <h1 className={styles.title}>단종/해제 관리</h1>
          {/* 2026-10-21: 불러오는 동안 빈 화면처럼 보여서 진행 표시를 둔다. */}
          {!payload && !error && <p className={styles.meta} role="status">단종·단종해제 목록을 불러오는 중…</p>}
          {cachedViewAt && busy && <p className={styles.meta} role="status">마지막으로 본 목록({new Date(cachedViewAt).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })})입니다 · 최신 자료 확인 중…</p>}
        </header>
      ) : (<>
      <header className={styles.header}>
        <h1 className={styles.title}>쉽먼트 입고결과</h1>
        <div className={styles.actions}>
          {/* 2026-10-21: '입고결과 가져오기'는 작업센터 '자주 하는 일' 3번 '바로가기'와 겹쳐서 뺐다. */}
          <button
            className={`softSageButton ${styles.headerButton}`}
            type="button"
            disabled={busy}
            onClick={() => void load(true)}
          >
            {busy ? "처리 중…" : "새로고침"}
          </button>
          {/* 2026-10-15: 쿠팡 쉽먼트 화면에 '입고결과 일괄 가져오기' 칸을 띄우는 확장 기능. 같은 이름 zip을 같은 폴더에 덮어쓰고 새로고침. */}
          <a className={`softApricotButton ${styles.headerButton}`} href={SUPPLIER_HUB_EXTENSION.zip} download>
            확장 v{SUPPLIER_HUB_EXTENSION.version} 받기
          </a>
        </div>
      </header>
      </>)}
      {/* 결과 알림은 화면 아래에 떠서 어디까지 내려가 있어도 보인다 */}
      {(error || message) && (
        <div className={`${styles.toast} ${error ? styles.toastError : ""}`} role={error ? "alert" : "status"}>
          <span>{error || message}</span>
          <button type="button" onClick={() => { setError(""); setMessage(""); }} aria-label="알림 닫기">닫기</button>
        </div>
      )}
      {fixture && (
        <p className={styles.notice}>
          개발용 예시자료입니다. 실제 업무 변경은 없습니다.
        </p>
      )}
      {tab !== "anytime" && <>
      {cachedViewAt && busy && <p className={styles.notice} role="status">마지막으로 본 목록({new Date(cachedViewAt).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })})입니다 · 최신 자료 확인 중… 확인이 끝나면 버튼을 누를 수 있어요.</p>}
      {/* 2026-10-26: '입고예정일 9/13 이후 마감 쉽먼트 N건 · 가져온 시각' 안내 문구는 삭제(사용자 요청). 아직 가져온 게 없을 때의 안내만 남긴다. */}
      {!payload?.board.collectedAt && (
        <p className={styles.notice}>
          아직 가져온 입고결과가 없습니다. 작업센터 '자주 하는 일'의 입고결과 가져오기 '바로가기'로 쿠팡 쉽먼트 화면을 열고 '입고결과 일괄 가져오기'를 눌러 주세요.
        </p>
      )}
      {payload?.board.warnings
        .filter((warning) => !warning.startsWith("공급상태가 정상이 아닌"))
        .map((warning, index) => (
          <p className={`${styles.notice} ${styles.error}`} key={`${warning}:${index}`}>
            확인이 필요한 기록: {warning}
          </p>
        ))}
      {unavailableShown.length > 0 && (
        <details className={`${styles.notice} ${styles.error} ${styles.unavailable}`}>
          <summary>
            확인이 필요한 기록: 공급상태가 정상이 아닌 SKU {unavailableShown.length}건(불가·일시중단·조회안됨)은 미납·쿠폰광고 분류에서 뺐습니다. <b>목록 보기</b>
          </summary>
          <div className={styles.tableWrap}>
            <table className={`${styles.table} ${styles.fixedTable}`} aria-label="공급상태가 정상이 아닌 SKU">
              <colgroup>
                <col className={styles.colStatus} />
                <col className={styles.colInfo} />
                <col />
                <col className={styles.colNum} />
                <col className={styles.colNum} />
                <col className={styles.colNum} />
                <col className={styles.colDecision} />
              </colgroup>
              <thead>
                <tr>
                  <th>공급상태</th>
                  <th>쉽먼트 정보</th>
                  <th>상품명</th>
                  <th>납품</th>
                  <th>입고</th>
                  <th>미납</th>
                  <th className={styles.decisionCell}>확인</th>
                </tr>
              </thead>
              <tbody>
                {unavailableShown.map((item) => (
                  <tr key={`${item.shipmentNumber}:${item.purchaseOrderNumber}:${item.skuId}`}>
                    <td className={styles.statusCell}>
                      {item.orderStatus}
                      {item.fromProductDb && <span className={styles.meta}> (제품DB)</span>}
                    </td>
                    <td className={styles.shipInfo}>{shipInfo(item.shipmentNumber, item.purchaseOrderNumber, item.expectedDate)}</td>
                    <td className={styles.product}>
                      <div className={styles.productRow}>
                        {productThumb(item.skuId)}
                        <div>
                          <strong>{productDbBadge(item.skuId)}{productTitle(item.skuId, item.productName)}</strong>
                          <span className={styles.meta}>SKU {item.skuId}</span>
                        </div>
                      </div>
                    </td>
                    <td>{item.deliveredQuantity}</td>
                    <td>{item.receivedQuantity}</td>
                    <td className={styles.shortageQty}>{Math.max(0, item.deliveredQuantity - item.receivedQuantity) || ""}</td>
                    <td className={styles.decisionCell}>{supplyButtons(item.skuId, item.productName)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
      </>}
      {/* 2026-10-21 사용자 요청: 거래처발주·단종관리 화면에는 입고결과 탭이 상관없어서 숨기고, 입고결과 화면 탭에서도 이 화면은 뺀다(메인 메뉴에서 따로 들어감). */}
      {tab !== "anytime" && <nav className={styles.tabs} aria-label="입고결과 보기">
        {(
          [
            ["results", "입고결과 처리", resultsCount],
            ["pending", "가져온 쉽먼트", 0],
            ["history", "처리이력", 0],
          ] as const
        ).map(([value, label, count]) => (
          <button
            key={value}
            type="button"
            className={`${styles.tab} ${tab === value ? styles.tabActive : ""}`}
            onClick={() => openTab(value)}
          >
            {label}{count > 0 && <span className={styles.tabCount}>{count}</span>}
          </button>
        ))}
      </nav>}
      <section className={styles.panel}>
        {!payload && !busy && !error && (
          <p className={styles.empty}>
            저장된 입고결과가 없습니다.
          </p>
        )}
        {tab === "pending" && payload && newTargets.length > 0 && (
          <section className={styles.dateBlock} style={{ border: "2px solid #dfbdb2", borderRadius: "12px", padding: "12px", background: "#fbf1ee" }}>
            <h2 className={styles.dateTitle}>
              새로 가져온 쉽먼트 {newTargets.length}건 · {new Date(latestFirstSeen).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}
            </h2>
            <div className={styles.shipmentGrid}>{newTargets.map((target) => renderShipmentCard(target, true))}</div>
          </section>
        )}
        {tab === "pending" &&
          payload &&
          (payload.targets.length ? (
            // 2026-10-21: 맨 위 '새로 가져온 쉽먼트'에 있는 것은 아래 날짜별 목록에서 뺀다(같은 쉽먼트가 두 번 보여 헷갈림).
            groupedTargets(payload.targets.filter((target) => !newTargetNumbers.has(target.shipmentNumber))).map(([date, centers]) => (
              <section className={styles.dateBlock} key={date}>
                <h2 className={styles.dateTitle}>{date}</h2>
                {[...centers.entries()]
                  .sort(([left], [right]) => left.localeCompare(right, "ko"))
                  .map(([center, targets]) => (
                    <div className={styles.center} key={center}>
                      <h3 className={styles.centerTitle}>{center}</h3>
                      <div className={styles.shipmentGrid}>
                        {targets.map((target) => renderShipmentCard(target))}
                      </div>
                    </div>
                  ))}
              </section>
            ))
          ) : (
            <p className={styles.empty}>가져온 마감 쉽먼트가 없습니다.</p>
          ))}
        {tab === "anytime" && payload && (
          <>
            {/* 2026-10-23 사용자 요청: 거래처 발주는 메인 1번 칸에서 바로 들어가고, 이 화면은 단종/해제만 둔다. */}
            {/* 2026-10-20: AI상품등록 9번의 상품공급상태 최신파일 반영을 여기로 옮김 — 반영하면 아래 단종·단종해제 목록을 다시 계산한다. */}
            {/* 2026-10-21: 상품공급상태 최신파일 반영은 작업센터 '자주 하는 일' 1번으로 옮겨 여기서는 뺐다(반영하면 제품DB가 바뀌어 이 화면을 열 때 목록에 그대로 반영됨). */}
            {/* 2026-10-23: 탭을 못 읽었거나(이름 바뀜 등) 같은 SKU가 두 탭에 있으면 목록이 틀릴 수 있어 위에 알린다. */}
            {!fixture && payload?.sheetHealth?.unreadTabs?.length ? (
              <p className={`${styles.notice} ${styles.error}`}>못 읽은 구글시트 탭: {payload.sheetHealth.unreadTabs.join(", ")} — 이 탭의 SKU가 아래 목록에서 빠졌을 수 있어요. 탭 이름이 바뀌지 않았는지 확인해 주세요.</p>
            ) : null}
            {!fixture && payload?.sheetHealth?.duplicateSkus?.length ? (
              <details className={`${styles.notice} ${styles.error}`}>
                <summary>두 탭에 같이 있는 SKU {payload.sheetHealth.duplicateSkus.length}개 — 한 탭에서 지워 주세요</summary>
                {payload.sheetHealth.duplicateSkus.map((item) => <div key={item.skuId}>{item.skuId} · {item.tabs.join(" / ")}</div>)}
              </details>
            ) : null}
            {/* 2026-10-20 사용자 요청: 단종 대상 SKU와 바코드·SKU 직접 입력을 '단종 신청 목록' 하나로 합침(서류·완료 한 번). */}
            {!fixture && (
              <DiscontinueByCode
                autoRows={discontinueList}
                pendingRows={payload?.statusLists?.discontinuePending || []}
                latestOrderable={latestOrderable}
                onCheckLatest={() => void checkLatestOrderable()}
                checkingLatest={Boolean(routingKeys["supply:latest-orderable"])}
                clearing={Boolean(routingKeys["supply:clear-list:discontinue"])}
                onClearAuto={(keys) => supplyCheck("clear-list", "", "", { kind: "discontinue", keys })}
                onDone={(text, isError) => {
                  if (isError) setError(text);
                  else { setError(""); setMessage(text); }
                }}
              />
            )}
            {[
              { kind: "release" as const, title: "단종해제 대상 SKU", rows: releaseList, help: "제품DB 현재상태가 '과재고'·'재고있음'이 들어가거나 정상전환대상인데 발주가능상태가 정상이 아닌 SKU, 메모로 주신 SKU, 화면에서 단종해제를 누르거나 직접 추가한 SKU예요.", done: "단종해제 신청 완료 · 목록 비우기" },
            ].map((section) => (
              <section key={section.kind}>
                <h2 className={styles.listTitle}>
                  {section.title} <span>{section.rows.length}건</span>
                </h2>
                <p className={styles.meta}>
                  {section.help} {section.kind === "release" ? "표를 드래그해서 복사하거나, 많으면 엑셀 파일로 받으세요." : "아래 버튼으로 단종신청 엑셀과 공문을 만드세요."}
                  {section.kind === "release" && payload?.statusLists?.reregisteredExcluded?.length ? ` 재등록 대상 SKU(실적저조SKU·그 외 재등록SKU·판매중지SKU 탭 등) ${payload.statusLists.reregisteredExcluded.length}건은 해제가 아니라 신규 재등록 대상이라 뺐습니다.` : ""}
                </p>
                {section.rows.length > 0 ? (<>
                <div className={`${styles.tableWrap} ${styles.copyScroll}`}>
                  <table className={`${styles.table} ${styles.copyTable}`} aria-label={section.title}>
                    <thead>
                      <tr>
                        <th>SKU ID</th>
                        <th>상품명</th>
                        <th className={styles.orderableCol} title={latestOrderable ? `최신파일 ${new Date(latestOrderable.fileMtime).toLocaleString("ko-KR")}` : "제품DB 값 · 작업센터 '자주 하는 일'에서 상품공급상태 최신파일을 반영하면 쿠팡 최신값이 됩니다"}>
                          발주상태{latestOrderable ? "" : " (DB)"}
                        </th>
                        {section.kind === "release" && <th className={styles.deleteCol} aria-label="삭제" />}
                      </tr>
                    </thead>
                    <tbody>
                      {(() => {
                        // 단종해제: 신청 전 줄을 위에, 신청완료 줄은 신청 시각별로 묶어 색을 다르게(2026-10-20).
                        const requested = section.kind === "release" ? payload?.statusListRequested?.release || {} : {};
                        const fresh = section.rows.filter((row) => !requested[row.skuId]);
                        const batches = new Map<string, typeof section.rows>();
                        for (const row of section.rows) if (requested[row.skuId]) batches.set(requested[row.skuId], [...(batches.get(requested[row.skuId]) || []), row]);
                        const groups: Array<{ at: string; rows: typeof section.rows }> = [
                          ...(fresh.length ? [{ at: "", rows: fresh }] : []),
                          ...[...batches.entries()].sort(([left], [right]) => right.localeCompare(left)).map(([at, rows]) => ({ at, rows })),
                        ];
                        const showHeads = section.kind === "release" && batches.size > 0;
                        return groups.flatMap((group) => [
                          ...(showHeads ? [
                            <tr key={`head-${group.at || "fresh"}`} className={`${styles.groupHead} ${group.at ? styles.groupHeadDone : ""}`}>
                              <td colSpan={4}>
                                {group.at
                                  ? `단종해제 신청완료 · ${new Date(group.at).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })} · ${group.rows.length}개`
                                  : `신청 전 · ${group.rows.length}개`}
                              </td>
                            </tr>,
                          ] : []),
                          ...group.rows.map((item) => (
                        <tr key={item.skuId} className={group.at ? styles.requestedRow : undefined}>
                          <td>
                            {item.skuId}
                          </td>
                          <td>{item.productName}</td>
                          {(() => {
                            // 단종 대상은 '정상이 아님', 단종해제 대상은 '정상'이 되면 쿠팡 처리가 끝난 것 → 세이지로 표시
                            const value = latestOrderable ? latestOrderable.orderable[item.skuId] || "파일에 없음" : item.orderableStatus || "미확인";
                            // 2026-10-21: 최신파일 확인이 작업센터로 옮겨져, 확인 전에는 제품DB 발주가능상태(반영된 최신값)로 판단한다.
                            const done = (latestOrderable ? Boolean(latestOrderable.orderable[item.skuId]) : Boolean(item.orderableStatus)) && (section.kind === "release" ? value === "정상" : value !== "정상" && value !== "확인필요");
                            return (
                              <td className={`${styles.orderableCol} ${done ? styles.orderableDone : ""}`} title={done ? "쿠팡에서 처리 완료" : undefined}>
                                {value}{done ? " ✓" : ""}
                              </td>
                            );
                          })()}
                          {section.kind === "release" && (
                            <td className={styles.deleteCol}>
                              <button
                                type="button"
                                className="softPinkButton"
                                title="쿠팡에서 정상전환된 것을 확인한 SKU를 목록에서 지웁니다."
                                disabled={routingKeys[`supply:${item.skuId}`]}
                                onClick={() => void supplyCheck("clear-one", item.skuId, item.productName, { kind: "release", keys: [item.key] })}
                              >
                                {routingKeys[`supply:${item.skuId}`] ? "…" : "삭제"}
                              </button>
                            </td>
                          )}
                        </tr>
                          )),
                        ]);
                      })()}
                    </tbody>
                  </table>
                </div>
                {section.kind === "release" && !fixture && (() => {
                  // 2026-10-29 사용자 요청: 쿠팡에서 이미 '정상'으로 바뀐 줄은 표시만 해 두고, 지우는 건 사용자가 버튼으로 직접 한다.
                  const normalRows = section.rows.filter((row) => (latestOrderable ? latestOrderable.orderable[row.skuId] : row.orderableStatus) === "정상");
                  return (
                    <>
                      <p className={styles.meta} style={{ margin: "8px 0 4px" }}>
                        {normalRows.length
                          ? `정상으로 바뀐 SKU ${normalRows.length}개 (표에 ✓ 표시). 확인하고 아래 버튼으로 지우세요.`
                          : latestOrderable ? "쿠팡 최신 파일 기준으로 정상으로 바뀐 SKU가 없습니다." : "표의 발주상태는 제품DB 시트 값입니다. 시트에 반영이 안 된 SKU가 있으면 '쿠팡 최신파일로 확인'을 누르세요."}
                      </p>
                      <div className={styles.pairButtons}>
                        <button
                          type="button"
                          className={`softBeigeButton ${styles.fullButton}`}
                          title="상품공급상태 최신 파일을 읽어 표의 발주상태를 쿠팡 값으로 바꿔 보여 줍니다(시트는 바꾸지 않음)."
                          disabled={routingKeys["supply:latest-orderable"]}
                          onClick={() => void checkLatestOrderable()}
                        >
                          {routingKeys["supply:latest-orderable"] ? "읽는 중…" : latestOrderable ? "쿠팡 최신파일로 다시 확인" : "쿠팡 최신파일로 확인"}
                        </button>
                        <button
                          type="button"
                          className={`softPinkButton ${styles.fullButton}`}
                          title="발주상태가 정상인 줄만 목록에서 지웁니다. 다른 줄은 그대로 둡니다."
                          disabled={!normalRows.length || routingKeys["supply:clear-many:release"]}
                          onClick={() => {
                            if (!window.confirm(`정상으로 바뀐 ${normalRows.length}개를 단종해제 대상에서 지웁니다.\n\n(잘못 지우면 아래 '되살리기'로 돌릴 수 있습니다.)`)) return;
                            void supplyCheck("clear-many", "", "", { kind: "release", keys: normalRows.map((row) => row.key) });
                          }}
                        >
                          {routingKeys["supply:clear-many:release"] ? "지우는 중…" : `정상으로 바뀐 ${normalRows.length}개 지우기`}
                        </button>
                      </div>
                    </>
                  );
                })()}
                {section.kind === "release" && (() => {
                  // 2026-10-23 사용자 요청: 신청 전 SKU만 / 신청완료까지 전체를 나눠서 받는다.
                  const requested = payload?.statusListRequested?.release || {};
                  const freshCount = section.rows.filter((row) => !requested[row.skuId]).length;
                  return (
                    <div className={styles.pairButtons}>
                      <button type="button" className={`softSageButton ${styles.fullButton}`} disabled={routingKeys["release-file"] || !freshCount} onClick={() => void downloadReleaseFile("fresh")}>
                        {routingKeys["release-file"] ? "만드는 중…" : `신청 전만 엑셀 (${freshCount}개)`}
                      </button>
                      <button type="button" className={`softApricotButton ${styles.fullButton}`} disabled={routingKeys["release-file"] || !section.rows.length} onClick={() => void downloadReleaseFile("all")}>
                        {routingKeys["release-file"] ? "만드는 중…" : `전체 엑셀 (${section.rows.length}개)`}
                      </button>
                    </div>
                  );
                })()}
                <div className={styles.pairButtons}>
                  {section.kind === "release" && (() => {
                    const requested = payload?.statusListRequested?.release || {};
                    const freshIds = section.rows.filter((row) => !requested[row.skuId]).map((row) => row.skuId);
                    return (
                      <button
                        type="button"
                        className={`softBeigeButton ${styles.fullButton}`}
                        title="신청한 SKU를 목록에 그대로 두고 색으로 표시합니다. 쿠팡에서 정상으로 바뀌면 줄마다 '삭제'를 누르세요."
                        disabled={!freshIds.length || routingKeys["supply:mark-requested:release"]}
                        onClick={() => void supplyCheck("mark-requested", "", "", { kind: "release", keys: [], skuIds: freshIds })}
                      >
                        {routingKeys["supply:mark-requested:release"] ? "저장 중…" : freshIds.length ? `단종해제 신청 완료 (${freshIds.length}개)` : "단종해제 신청 완료"}
                      </button>
                    );
                  })()}
                  <button
                    type="button"
                    className={`softPinkButton ${styles.fullButton}`}
                    disabled={routingKeys[`supply:clear-list:${section.kind}`]}
                    onClick={() => {
                      // 단종해제는 승인된 SKU만 하나씩 지우기로 함 — 전부 비우기는 한 번 더 묻는다(2026-10-20 실수로 비움).
                      if (section.kind === "release" && !window.confirm(`단종해제 대상 ${section.rows.length}건을 모두 비웁니다.\n\n승인(정상전환)된 SKU만 지우려면 취소하고 줄마다 '삭제'를 누르세요.`)) return;
                      void supplyCheck("clear-list", "", "", { kind: section.kind, keys: section.rows.map((row) => row.key) });
                    }}
                  >
                    {section.kind === "release" ? "목록 비우기" : section.done}
                  </button>
                </div>
                </>) : <p className={styles.empty}>단종해제할 SKU가 없습니다.</p>}
                {section.kind === "release" && !fixture && (
                  <>
                    <label className={styles.meta} style={{ display: "block", marginTop: "8px", fontWeight: 700 }}>
                      SKU 직접 추가 <span style={{ fontWeight: 400 }}>· 재고가 있어 해제할 SKU ID를 한 줄에 하나씩 붙여넣으세요.</span>
                    </label>
                    <textarea
                      value={releaseInput}
                      onChange={(event) => setReleaseInput(event.target.value)}
                      rows={3}
                      placeholder={"40117827"}
                      style={{ width: "100%", boxSizing: "border-box", border: "1px solid #d8d3cc", borderRadius: "8px", padding: "8px", fontSize: "13px", fontFamily: "inherit" }}
                    />
                    <button
                      type="button"
                      className={`softSageButton ${styles.fullButton}`}
                      disabled={!releaseInput.trim() || routingKeys["supply:add-release"]}
                      onClick={() => void addReleaseSkus()}
                      style={{ width: "100%", minHeight: "40px", fontSize: "14px", fontWeight: 800, borderRadius: "8px" }}
                    >
                      {routingKeys["supply:add-release"] ? "추가하는 중…" : "단종해제 대상에 추가"}
                    </button>
                  </>
                )}
              </section>
            ))}
            {(["release", "discontinue"] as const).map((kind) => {
              const batch = payload?.statusListLastCleared?.[kind];
              if (!batch || fixture) return null;
              const label = kind === "release" ? "단종해제 대상" : "단종 대상";
              return (
                <button
                  key={`restore-${kind}`}
                  type="button"
                  className={`softApricotButton ${styles.fullButton}`}
                  disabled={routingKeys[`restore:${kind}`]}
                  onClick={() => void restoreLastClear(kind)}
                  style={{ marginTop: "8px" }}
                >
                  {routingKeys[`restore:${kind}`] ? "되살리는 중…" : `마지막으로 비운 ${label} ${batch.count}건 되살리기 (${new Date(batch.at).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })})`}
                </button>
              );
            })}
            {followUpQueueOf("discontinue").length > 0 && renderFollowUpWork("discontinue")}
            {/* 2026-10-21: 구글시트 정리는 작업센터 '자주 하는 일' 4번으로 옮겨 여기서는 뺐다. */}
          </>
        )}
        {tab === "results" && payload && (
          <>
            <h2 className={styles.listTitle}>
              미납 SKU 리스트 <span>{missView === "all" ? `전체 ${allMissLines.length}건 · 처리 전 ${allMissTodoCount}건` : `${resultLines.length}건 · 처리 전 ${reorderReadyLines.length}건`}</span>
            </h2>
            {/* 2026-10-21: 예전 쉽먼트 미납까지 모두 검토할 수 있게 보기 전환 */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", margin: "0 0 10px" }}>
              <button type="button" className={missView === "todo" ? "softSageButton" : "softApricotButton"} aria-pressed={missView === "todo"} onClick={() => setMissView("todo")}>재발주요청 안 보낸 미납 ({resultLines.length})</button>
              <button type="button" className={missView === "all" ? "softSageButton" : "softApricotButton"} aria-pressed={missView === "all"} onClick={() => setMissView("all")}>모든 쉽먼트 미납 전체 ({allMissLines.length})</button>
            </div>
            {missView === "all" ? (
              <div className={styles.tableWrap}>
                <table className={`${styles.table} ${styles.fixedTable}`} aria-label="모든 쉽먼트 미납 전체">
                  {resultColumns}
                  {resultHead}
                  <tbody>
                    {allMissLines.map((line) => {
                      const status = missStatusOf(line);
                      const canExclude = !line.route && !covered[line.lineKey] && line.state === "ready" && (line.remainingQuantity ?? 0) > 0;
                      return (
                        <tr key={`all-${line.lineKey}`} style={status === "처리 전" ? undefined : { opacity: 0.72 }}>
                          <td className={styles.shipInfo}>{shipInfo(line.shipmentNumber, line.purchaseOrderNumber, line.target.expectedDate)}</td>
                          <td className={styles.product}>
                            <div className={styles.productRow}>
                              {productThumb(line.skuId)}
                              <div>
                                <strong>{productDbBadge(line.skuId)}{productTitle(line.skuId, line.productName || "상품명 없음")}</strong>
                                <span className={styles.meta}>SKU {line.skuId}</span>
                                {openOrderNote(line.skuId)}
                              </div>
                            </div>
                          </td>
                          <td>{line.deliveredQuantity ?? "-"}</td>
                          <td>{line.receivedQuantity ?? "-"}</td>
                          <td className={styles.shortageQty}>{line.remainingQuantity ?? line.shortageQuantity ?? "-"}</td>
                          <td className={styles.decisionCell}>
                            <div className={styles.meta} style={{ textAlign: "center", fontWeight: status === "처리 전" ? 800 : 400 }}>{status}</div>
                            {canExclude && (
                              <div className={styles.decisionRow}>
                                <button
                                  className={`${reorderExcluded[line.lineKey] ? "softApricotButton" : "softBeigeButton"} ${styles.decisionButton}`}
                                  style={{ gridColumn: "span 2" }}
                                  disabled={busy || routingKeys[line.lineKey]}
                                  onClick={() => void toggleReorderExclusion(line, reorderExcluded[line.lineKey] ? "undo" : "exclude")}
                                >
                                  {reorderExcluded[line.lineKey] ? "제외 취소" : "재발주요청 제외"}
                                </button>
                              </div>
                            )}
                            {(line.route || covered[line.lineKey]) && line.route?.decision !== "reorder" && reorderExcluded[line.lineKey] && (
                              <div className={styles.decisionRow}>
                                <span className={styles.meta} style={{ gridColumn: "span 2", textAlign: "center" }}>미납 목록에서 삭제함</span>
                                <button className={`softApricotButton ${styles.decisionButton}`} style={{ gridColumn: "span 2" }} disabled={busy || routingKeys[line.lineKey]} onClick={() => void toggleReorderExclusion(line, "undo")}>
                                  삭제 되돌리기
                                </button>
                              </div>
                            )}
                            {!line.route && isSupplyReview(line) && !supplyChecks[line.skuId] && supplyButtons(line.skuId, line.productName)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
            <div className={styles.tableWrap}>
              <table className={`${styles.table} ${styles.fixedTable}`} aria-label="미납 SKU 리스트">
                {resultColumns}
                {resultHead}
                <tbody>{resultLines.map(renderResultRow)}</tbody>
              </table>
            </div>
            )}
            {missView === "todo" && !resultLines.length && (
              <p className={styles.empty}>검토할 미납 상품이 없습니다.</p>
            )}
            {shortageReviewLines.length > 0 && (
              <details className={styles.reviewDetails}>
                <summary>확인 필요 {shortageReviewLines.length}건</summary>
                <div className={styles.tableWrap}>
                  <table className={`${styles.table} ${styles.fixedTable}`} aria-label="수량 재확인">
                    {resultColumns}
                    {resultHead}
                    <tbody>{shortageReviewLines.map(renderResultRow)}</tbody>
                  </table>
                </div>
              </details>
            )}
            {renderFollowUpWork("reorder")}
            {marketingLines.length > 0 && (
              <section>
                <h2 className={styles.listTitle}>
                  마케팅 SKU 리스트 <span>{marketingLines.length}건</span>
                </h2>
                <div className={styles.listTools}>
                  <p className={styles.meta}>
                    처음 1개 입고된 SKU입니다. 쿠폰 할인율은 기본 20%, 과재고·누적입고 100개 이상은 30%로 만들어집니다.
                    {payload?.marketingExclusion?.models.length ? ` 무조건 제외 모델 ${payload.marketingExclusion.models.join(", ")}는 목록에서 뺐습니다.` : ""}
                  </p>
                  {(payload?.marketingExclusion?.userSkus?.length || 0) > 0 && (
                    <details style={{ fontSize: "13px" }}>
                      <summary style={{ cursor: "pointer" }}>마케팅 제외 SKU {payload!.marketingExclusion!.userSkus!.length}개 (같은 모델 전체 자동 제외)</summary>
                      <div style={{ display: "grid", gap: "4px", marginTop: "6px" }}>
                        {payload!.marketingExclusion!.userSkus!.map((item) => (
                          <div key={item.skuId} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px" }}>
                            <span>{item.productName || "상품명 없음"} <small>SKU {item.skuId}</small></span>
                            <button type="button" className="softBeigeButton" disabled={busy || fixture} style={{ minHeight: "28px", padding: "2px 10px", fontSize: "12px" }}
                              onClick={() => void followUpAction({ action: "includeMarketingSku", skuId: item.skuId }, `SKU ${item.skuId}를 마케팅 제외 목록에서 뺐습니다.`)}>
                              제외 해제
                            </button>
                          </div>
                        ))}
                      </div>
                    </details>
                  )}
                  <div className={styles.selectButtons} style={marketingLines.some((line) => laterOrders[line.lineKey]) ? { gridTemplateColumns: "repeat(3, minmax(88px, 1fr))" } : undefined}>
                    <button
                      type="button"
                      className={`softSageButton ${styles.decisionButton}`}
                      onClick={() => setMarketingSelected(Object.fromEntries(marketingLines.map((line) => [line.lineKey, true])))}
                    >
                      전체선택
                    </button>
                    <button
                      type="button"
                      className={`softApricotButton ${styles.decisionButton}`}
                      onClick={() => setMarketingSelected(Object.fromEntries(marketingLines.map((line) => [line.lineKey, false])))}
                    >
                      전체해제
                    </button>
                    {marketingLines.some((line) => laterOrders[line.lineKey]) && (
                      <button
                        type="button"
                        className={`softBeigeButton ${styles.decisionButton}`}
                        onClick={() => setMarketingSelected((current) => ({ ...current, ...Object.fromEntries(marketingLines.filter((line) => laterOrders[line.lineKey]).map((line) => [line.lineKey, false])) }))}
                      >
                        추가발주 나온 SKU 해제 ({marketingLines.filter((line) => laterOrders[line.lineKey]).length})
                      </button>
                    )}
                  </div>
                </div>
                {(
                  <div className={styles.marketingReview}>
                    {/* 2026-10-11 사용자 요청: 입고예정일별로 묶어 최근 날짜부터 보이고, 날짜마다 선택/해제 */}
                    {[...new Set(marketingLines.map((line) => line.target.expectedDate || ""))]
                      .sort((a, b) => b.localeCompare(a))
                      .map((date) => {
                        const dateLines = marketingLines.filter((line) => (line.target.expectedDate || "") === date);
                        const checkedCount = dateLines.filter((line) => isMarketingChecked(line.lineKey)).length;
                        return (
                          <div key={date || "none"} style={{ display: "contents" }}>
                            <div style={{ gridColumn: "1 / -1", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px", padding: "8px 4px 2px", borderTop: "1px solid #e5dace", fontSize: "14px" }}>
                              <strong>입고예정일 {date || "미정"} · {dateLines.length}건 (선택 {checkedCount})</strong>
                              <span style={{ display: "flex", gap: "6px" }}>
                                <button type="button" className={`softSageButton ${styles.decisionButton}`} style={{ minHeight: "32px", padding: "4px 10px", fontSize: "12px" }}
                                  onClick={() => setMarketingSelected((current) => ({ ...current, ...Object.fromEntries(dateLines.map((line) => [line.lineKey, true])) }))}>이 날짜 선택</button>
                                <button type="button" className={`softApricotButton ${styles.decisionButton}`} style={{ minHeight: "32px", padding: "4px 10px", fontSize: "12px" }}
                                  onClick={() => setMarketingSelected((current) => ({ ...current, ...Object.fromEntries(dateLines.map((line) => [line.lineKey, false])) }))}>이 날짜 해제</button>
                              </span>
                            </div>
                    {dateLines.map((line) => (
                      <label className={styles.choice} key={line.lineKey}>
                        <input
                          type="checkbox"
                          checked={isMarketingChecked(line.lineKey)}
                          onChange={(event) =>
                            setMarketingSelected((current) => ({
                              ...current,
                              [line.lineKey]: event.target.checked,
                            }))
                          }
                        />
                        {productThumb(line.skuId)}
                        <span>
                          <strong>{productDbBadge(line.skuId)}{productTitle(line.skuId, line.productName)}</strong>
                          <small>
                            SKU {line.skuId} · 발주 {line.purchaseOrderNumber}
                          </small>
                          <small>
                            입고예정일 {line.target.expectedDate || "-"}
                            {(() => {
                              // 예전 응답(숫자)과 새 응답({ price }) 모두 받는다.
                              const raw = payload?.marketingPrices?.[line.lineKey] as unknown;
                              const price = typeof raw === "number" ? raw : (raw as { price?: number } | undefined)?.price;
                              const other = typeof raw === "object" && raw !== null && Boolean((raw as { fromOtherOrder?: boolean }).fromOtherOrder);
                              return price ? ` · 매입가 ${price.toLocaleString("ko-KR")}원${other ? " (다른 발주 기준)" : ""}` : "";
                            })()}
                          </small>
                          {/* 2026-10-11 사용자 요청: 정상은 표시하지 않고, 정상이 아닌 것만 빨간색으로 눈에 띄게 */}
                          {payload?.orderStatuses?.[line.skuId] && payload.orderStatuses[line.skuId] !== "정상" && (
                            <small style={{ color: "#fff", background: "#b5524a", borderRadius: "6px", padding: "2px 8px", fontWeight: 800, alignSelf: "flex-start" }}>
                              발주상태 {payload.orderStatuses[line.skuId]}
                            </small>
                          )}
                          {laterOrders[line.lineKey] && (
                            <small style={{ color: "#a6614e", fontWeight: 700 }}>
                              추가발주 있음 · 발주 {laterOrders[line.lineKey].orderCount}건 {laterOrders[line.lineKey].quantity}개 · 최근 입고예정 {laterOrders[line.lineKey].latestExpectedDate || "-"}
                            </small>
                          )}
                        </span>
                        {/* 2026-10-11 사용자 요청: 버튼을 상품명 길이와 상관없이 오른쪽 같은 폭으로 */}
                        {!fixture && (
                          <span style={{ marginLeft: "auto", width: "132px", flexShrink: 0, display: "grid", gap: "6px", alignContent: "start" }}>
                          {!fixture && (
                            <button
                              type="button"
                              className="softApricotButton"
                              disabled={Boolean(skuExcludePending[line.skuId])}
                              style={{ width: "100%", minHeight: "32px", padding: "4px 8px", fontSize: "12px" }}
                              onClick={(event) => {
                                event.preventDefault();
                                if (!window.confirm(`${line.productName}\n이 SKU(같은 모델 전체)를 마케팅 제외 목록에 넣을까요? 앞으로 이 목록에 나오지 않습니다.`)) return;
                                void excludeMarketingSkuQuick(line.skuId, line.productName);
                              }}
                            >
                              {skuExcludePending[line.skuId] ? "넣는 중…" : "마케팅 제외"}
                            </button>
                          )}
                          {payload?.orderStatuses?.[line.skuId] && payload.orderStatuses[line.skuId] !== "정상" && !fixture && (
                            supplyChecks[line.skuId]?.decision === "release" ? (
                              <small style={{ color: "#4d6358", fontWeight: 700 }}>단종해제 대상에 넣음</small>
                            ) : (
                              <button
                                type="button"
                                className="softBeigeButton"
                                disabled={busy}
                                style={{ width: "100%", minHeight: "32px", padding: "4px 8px", fontSize: "12px" }}
                                onClick={(event) => { event.preventDefault(); void supplyCheck("release", line.skuId, line.productName); }}
                              >
                                단종해제 대상에 넣기
                              </button>
                            )
                          )}
                          </span>
                        )}
                      </label>
                    ))}
                          </div>
                        );
                      })}
                    <button
                      className={`softPinkButton ${styles.fullButton}`}
                      disabled={busy}
                      onClick={() => {
                        const selected = marketingLines
                          .filter(
                            (line) => isMarketingChecked(line.lineKey),
                          )
                          .map((line) => line.lineKey);
                        const excluded = marketingLines
                          .filter(
                            (line) => !isMarketingChecked(line.lineKey),
                          )
                          .map((line) => line.lineKey);
                        // 2026-10-11 사용자 요청: 한 번 처리하면 목록을 비운다 — 체크한 건 쿠폰·광고로, 체크 안 한 건 제외 이력으로.
                        if (!window.confirm(`체크한 ${selected.length}건은 쿠폰·광고 대기목록으로 보내고, 체크 안 한 ${excluded.length}건은 이번 입고분만 목록에서 뺍니다(다음에 입고되면 다시 나옵니다). 진행할까요?`)) return;
                        void followUpAction(
                          {
                            action: "queueMarketing",
                            lineKeys: selected,
                            excludedLineKeys: excluded,
                            confirmMarketing: true,
                          },
                          `쿠폰·광고 ${selected.length}건 모으고, 나머지 ${excluded.length}건은 이번 목록에서 뺐습니다.`,
                        );
                      }}
                    >
                      체크한 상품은 쿠폰·광고로 보내고 이번 목록 비우기
                    </button>
                  </div>
                )}
              </section>
            )}
            {renderFollowUpWork("marketing")}
            <p className={styles.meta}>
              미납 검토 {resultLines.length}건
              {shortageReviewLines.length > 0
                ? ` · 확인 필요 ${shortageReviewLines.length}건`
                : ""}{" "}
              · 초도입고 후보 {marketingLines.length}건 · 마지막 수집{" "}
              {payload.collectedAt || payload.board.collectedAt || "기록 없음"}
            </p>
          </>
        )}
        {tab === "history" && (
          <div className={styles.history}>
            {Object.entries(covered).map(([lineKey, item]) => (
              <article className={styles.historyItem} key={lineKey}>
                <strong>기존 거래처 발주로 처리 · SKU {item.skuId} · {item.quantity}개</strong>
                <div className={styles.meta}>
                  {item.productName} · 쉽먼트 {item.shipmentNumber} · {item.vendors.join(", ") || "거래처"} {item.sentOn} 발주
                </div>
                <button
                  type="button"
                  className={`softApricotButton ${styles.decisionButton}`}
                  disabled={routingKeys[lineKey]}
                  onClick={() => {
                    const line = lines.find((value) => value.lineKey === lineKey);
                    if (line) void coverByVendorOrder(line, "undo");
                  }}
                >
                  미납 목록으로 되돌리기
                </button>
              </article>
            ))}
            {routedLines.map((line) => (
              <article className={styles.historyItem} key={line.lineKey}>
                <strong>
                  {line.route
                    ? decisionLabel[line.route.decision]
                    : "후속 처리"}{" "}
                  대기열로 이동 · SKU {line.skuId}
                </strong>
                <div className={styles.meta}>
                  쉽먼트 {line.shipmentNumber} · 발주 {line.purchaseOrderNumber}{" "}
                  · {line.reviewReason || "후속 관리에 연결했습니다."}
                </div>
                {routeHref(line, fixture) && (
                  <a
                    className={styles.linkButton}
                    href={routeHref(line, fixture)}
                  >
                    후속 관리 열기
                  </a>
                )}
                {(line.route?.decision === "marketing" ||
                  line.route?.decision === "discontinue") && (
                  <button
                    className={styles.button}
                    onClick={() => openTab(line.route?.decision === "discontinue" ? "anytime" : "results")}
                  >
                    이 페이지에서 처리하기
                  </button>
                )}
              </article>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
