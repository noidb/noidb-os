"use client";

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
import WarehouseRecheckCleanup from "./WarehouseRecheckCleanup";

type Tab = "pending" | "results" | "followup" | "history";
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
  statusLists?: { discontinue: StatusListRow[]; release: StatusListRow[]; reregisteredExcluded?: string[] } | null;
  /** 이미 거래처에 보낸 발주(입고대기·입고지연) — SKU별 */
  openVendorOrders?: Record<string, { quantity: number; vendors: string[]; sentOn: string; delayed: boolean }>;
  /** 마케팅 후보 줄별: 그 입고예정일 뒤에 같은 SKU로 나온 쿠팡 추가 발주(초도가 이미 팔린 신호) */
  laterOrders?: Record<string, { orderCount: number; quantity: number; latestExpectedDate: string }>;
  /** 마케팅 SKU의 발주상태(제품DB 발주가능상태, 없으면 쿠팡 조회값) */
  orderStatuses?: Record<string, string>;
  /** 마케팅 후보 줄별 원발주서 매입가(부가세 포함 단가) */
  marketingPrices?: Record<string, { price: number; fromOtherOrder?: boolean }>;
  /** 기존 발주로 처리한 미납 줄 */
  coveredByVendorOrder?: Record<string, { skuId: string; productName: string; shipmentNumber: string; quantity: number; vendors: string[]; sentOn: string; at: string }>;
  /** 공급상태가 정상이 아닌 SKU 확인 결과(단종확인·단종해제) */
  supplyStatusChecks?: Record<string, { decision: "discontinued" | "release"; productName: string; at: string; releasedListClearedAt?: string }>;
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
  const [tab, setTab] = useState<Tab>("results");
  const [busy, setBusy] = useState(false);
  const [fixture, setFixture] = useState(false);
  const [modeReady, setModeReady] = useState(false);
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
  const [followUpKind, setFollowUpKind] = useState<
    "marketing" | "discontinue" | "reorder"
  >("discontinue");
  const [generatedDownloads, setGeneratedDownloads] = useState<
    Record<string, { fileName: string; href: string }>
  >({});
  const initialLoad = useRef(false);
  const followUpStale = useRef(false);
  const [routingKeys, setRoutingKeys] = useState<Record<string, boolean>>({});
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
      const response = await fetch("/api/wms/logistics/receipts?view=board", {
        cache: "no-store",
      });
      const data = await response.json();
      if (!response.ok)
        throw new Error(data.error || "입고결과를 불러오지 못했습니다.");
      const next = asPayload(data);
      setPayload(next);
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

  async function followUpAction(
    input: Record<string, unknown>,
    success: string,
  ) {
    if (!payload || !followUp) return;
    setBusy(true);
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
      await load(true);
      const skipped = Array.isArray(data.skippedCoupons) ? (data.skippedCoupons as Array<{ skuId: string; reason: string }>) : [];
      setMessage(skipped.length
        ? `${success} 쿠폰이 아직 걸려 있거나 예전 쿠폰 종료일을 모르는 ${skipped.length}건은 이번 파일에서 빼고 대기목록에 남겼습니다(목록에 이유 표시).`
        : success);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "후속 처리 저장에 실패했습니다.",
      );
    } finally {
      setBusy(false);
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

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("tab") === "followup") setTab("followup");
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
  async function supplyCheck(action: "discontinued" | "release" | "undo" | "clear-release" | "clear-list", skuId = "", productName = "", list?: { kind: "discontinue" | "release"; keys: string[] }) {
    if (fixture) return;
    setError("");
    const key = `supply:${skuId || (list ? `${action}:${list.kind}` : action)}`;
    setRoutingKeys((current) => ({ ...current, [key]: true }));
    try {
      const response = await fetch("/api/wms/logistics/supply-status-check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, skuId, productName, ...(list || {}) }),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "저장하지 못했습니다.");
      setPayload((current) => current && {
        ...current,
        supplyStatusChecks: data.supplyStatusChecks,
        statusLists: current.statusLists && list ? {
          ...current.statusLists,
          [list.kind]: current.statusLists[list.kind].filter((row) => !list.keys.includes(row.key)),
        } : current.statusLists,
      });
      followUpStale.current = true;
      setMessage(
        action === "discontinued" ? `SKU ${skuId} 단종 확인했습니다.`
        : action === "release" ? `SKU ${skuId}를 단종해제 대상에 넣었습니다.`
        : action === "undo" ? `SKU ${skuId} 확인을 되돌렸습니다.`
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
  // 단종 대상 SKU로 단종신청 엑셀 + 공문 PDF(압축파일)를 만들어 바로 내려받는다.
  async function downloadDiscontinueFiles(skuIds: string[]) {
    setError("");
    setRoutingKeys((current) => ({ ...current, "discontinue-file": true }));
    try {
      const response = await fetch("/api/wms/logistics/discontinue-file", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ skuIds }),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "단종신청 파일을 만들지 못했습니다.");
      const link = document.createElement("a");
      link.href = `data:application/zip;base64,${data.base64}`;
      link.download = data.fileName;
      document.body.append(link);
      link.click();
      link.remove();
      setMessage(`단종신청 엑셀과 공문을 만들었습니다(${data.count}건). 쿠팡에 신청한 뒤 '단종 신청 완료 · 목록 비우기'를 눌러 주세요.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "단종신청 파일을 만들지 못했습니다.");
    } finally {
      setRoutingKeys((current) => {
        const next = { ...current };
        delete next["discontinue-file"];
        return next;
      });
    }
  }
  // 단종해제 대상 SKU 엑셀 파일(SKU ID·상품명) — 누를 때만 만든다.
  async function downloadReleaseFile() {
    setError("");
    setRoutingKeys((current) => ({ ...current, "release-file": true }));
    try {
      const response = await fetch("/api/wms/logistics/status-list-file", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "엑셀 파일을 만들지 못했습니다.");
      const link = document.createElement("a");
      link.href = `data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,${data.base64}`;
      link.download = data.fileName;
      document.body.append(link);
      link.click();
      link.remove();
      setMessage(`단종해제 대상 엑셀을 만들었습니다(${data.count}건).`);
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
    if ((value === "followup" || value === "history") && followUpStale.current) {
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
  const resultLines = [...shortageLines].sort(
    (left, right) =>
      (left.state === "ready" ? 0 : 1) - (right.state === "ready" ? 0 : 1) ||
      left.shipmentNumber.localeCompare(right.shipmentNumber),
  );
  const routedLines = lines.filter((line) => line.state === "routed");
  const unavailableShown = (payload?.board.unavailableSkus || []).filter((item) => !supplyChecks[item.skuId]);
  // 단종해제 대상: 서버가 제품DB·메모·화면 선택을 합친 목록. 화면에서 방금 누른 SKU도 바로 보이게 더한다.
  const serverRelease = payload?.statusLists?.release || [];
  const releaseList: StatusListRow[] = [
    ...serverRelease,
    ...Object.entries(supplyChecks)
      .filter(([skuId, check]) => check.decision === "release" && !check.releasedListClearedAt && !serverRelease.some((row) => row.skuId === skuId))
      .map(([skuId, check]) => ({ skuId, productName: check.productName, currentStatus: "", orderableStatus: "", reason: "입고결과", key: skuId })),
  ].sort((a, b) => a.skuId.localeCompare(b.skuId));
  const discontinueList: StatusListRow[] = payload?.statusLists?.discontinue || [];
  const activeFollowUpQueue = followUpData?.queues[followUpKind] || [];
  const completedSourceKeys = new Set(
    (followUpData?.proofs || [])
      .filter(
        (proof) =>
          String(proof.kind) === followUpKind && Boolean(proof.completedAt),
      )
      .flatMap((proof) => proof.sourceKeys),
  );
  const activeFollowUpProof = [...(followUpData?.proofs || [])]
    .filter(
      (proof) =>
        String(proof.kind) === followUpKind &&
        !proof.completedAt &&
        !proof.sourceKeys.every((sourceKey) =>
          completedSourceKeys.has(sourceKey),
        ),
    )
    .sort((left, right) => right.at.localeCompare(left.at))[0];
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
        {line.reviewReason && !isSupplyReview(line) && (
          <div className={styles.meta}>{line.reviewReason}</div>
        )}
        {line.kind === "shortage" &&
        line.state === "ready" &&
        (line.remainingQuantity ?? 0) > 0 ? (
          <div className={styles.decisionRow}>
            <button
              className={`softBeigeButton ${styles.decisionButton}`}
              disabled={busy || routingKeys[line.lineKey]}
              onClick={() => void submitDecision(line, "discontinue")}
            >
              단종
            </button>
            {payload?.openVendorOrders?.[line.skuId] ? (
              <>
                <button
                  className={`softSageButton ${styles.decisionButton}`}
                  disabled={busy || routingKeys[line.lineKey]}
                  onClick={() => void coverByVendorOrder(line, "cover")}
                >
                  기존 발주로 처리
                </button>
                <button
                  className={`softPinkButton ${styles.decisionButton}`}
                  disabled={busy || routingKeys[line.lineKey]}
                  onClick={() => void submitDecision(line, "vendor")}
                >
                  추가 발주
                </button>
              </>
            ) : (
              <button
                className={`softSageButton ${styles.decisionButton}`}
                disabled={busy || routingKeys[line.lineKey]}
                onClick={() => void submitDecision(line, "vendor")}
              >
                거래처발주
              </button>
            )}
            <button
              className={`softApricotButton ${styles.decisionButton}`}
              disabled={busy || routingKeys[line.lineKey]}
              onClick={() => void submitDecision(line, "reorder")}
            >
              미납분 재발주요청
            </button>
          </div>
        ) : isSupplyReview(line) ? (
          supplyButtons(line.skuId, line.productName)
        ) : line.state === "review" ? (
          "확인 필요"
        ) : (
          "대기 없음"
        )}
      </td>
    </tr>
  );
  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>쉽먼트 입고결과</h1>
        <div className={styles.actions}>
          {fixture ? (
            <span className={`softBeigeButton ${styles.headerButton}`}>입고결과 가져오기</span>
          ) : (
            <a
              className={`softBeigeButton ${styles.headerButton}`}
              href="https://supplier.coupang.com/ibs/asn/active"
              target="_blank"
              rel="noreferrer"
            >
              입고결과 가져오기
            </a>
          )}
          <button
            className={`softSageButton ${styles.headerButton}`}
            type="button"
            disabled={busy}
            onClick={() => void load(true)}
          >
            {busy ? "처리 중…" : "새로고침"}
          </button>
        </div>
      </header>
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
      <p className={styles.notice}>
        {payload?.board.collectedAt
          ? `입고예정일 9/13 이후 마감 쉽먼트 ${payload.targets.length}건 · 가져온 시각 ${new Date(payload.board.collectedAt).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}`
          : "아직 가져온 입고결과가 없습니다. '입고결과 가져오기'로 쿠팡 쉽먼트 화면을 열고 '입고결과 일괄 가져오기'를 눌러 주세요."}
      </p>
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
      <nav className={styles.tabs} aria-label="입고결과 보기">
        {(
          [
            ["results", "입고결과"],
            ["pending", "가져온 쉽먼트"],
            ["followup", "후속처리"],
            ["history", "처리이력"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            className={`${styles.tab} ${tab === value ? styles.tabActive : ""}`}
            onClick={() => openTab(value)}
          >
            {label}
          </button>
        ))}
      </nav>
      <section className={styles.panel}>
        {!payload && !busy && !error && (
          <p className={styles.empty}>
            저장된 입고결과가 없습니다.
          </p>
        )}
        {tab === "pending" &&
          payload &&
          (payload.targets.length ? (
            groupedTargets(payload.targets).map(([date, centers]) => (
              <section className={styles.dateBlock} key={date}>
                <h2 className={styles.dateTitle}>{date}</h2>
                {[...centers.entries()]
                  .sort(([left], [right]) => left.localeCompare(right, "ko"))
                  .map(([center, targets]) => (
                    <div className={styles.center} key={center}>
                      <h3 className={styles.centerTitle}>{center}</h3>
                      <div className={styles.shipmentGrid}>
                        {targets.map((target) => (
                          <article
                            className={styles.shipment}
                            key={target.shipmentNumber}
                          >
                            <strong>쉽먼트 {target.shipmentNumber}</strong>
                            <p className={styles.meta}>
                              발주{" "}
                              {target.purchaseOrderNumbers.length
                                ? target.purchaseOrderNumbers.join(", ")
                                : "복수 발주서 상세 확인 필요"}
                            </p>
                            {pendingShipmentNumbers.has(target.shipmentNumber) && (
                              <p className={styles.meta}>마감 수량 미확인</p>
                            )}
                          </article>
                        ))}
                      </div>
                    </div>
                  ))}
              </section>
            ))
          ) : (
            <p className={styles.empty}>가져온 마감 쉽먼트가 없습니다.</p>
          ))}
        {tab === "results" && payload && (
          <>
            <h2 className={styles.listTitle}>
              미납 SKU 리스트 <span>{resultLines.length}건</span>
            </h2>
            <div className={styles.tableWrap}>
              <table className={`${styles.table} ${styles.fixedTable}`} aria-label="미납 SKU 리스트">
                {resultColumns}
                {resultHead}
                <tbody>{resultLines.map(renderResultRow)}</tbody>
              </table>
            </div>
            {!resultLines.length && (
              <p className={styles.empty}>검토할 미납 상품이 없습니다.</p>
            )}
            {[
              { kind: "discontinue" as const, title: "단종 대상 SKU", rows: discontinueList, help: "제품DB·보관 탭의 현재상태가 판매중지·단종·거래처단종·가품중단인데 쿠팡 발주가능상태가 아직 정상인 SKU예요.", done: "단종 신청 완료 · 목록 비우기" },
              { kind: "release" as const, title: "단종해제 대상 SKU", rows: releaseList, help: "제품DB 현재상태가 과재고·정상전환대상·제품DB로 이동(재고있음)인데 발주가능상태가 정상이 아닌 SKU, 메모로 주신 SKU, 화면에서 단종해제를 누른 SKU예요.", done: "단종해제 신청 완료 · 목록 비우기" },
            ].filter((section) => section.rows.length > 0).map((section) => (
              <section key={section.kind}>
                <h2 className={styles.listTitle}>
                  {section.title} <span>{section.rows.length}건</span>
                </h2>
                <p className={styles.meta}>
                  {section.help} {section.kind === "release" ? "표를 드래그해서 복사하거나, 많으면 엑셀 파일로 받으세요." : "아래 버튼으로 단종신청 엑셀과 공문을 만드세요."}
                  {section.kind === "release" && payload?.statusLists?.reregisteredExcluded?.length ? ` 재등록 대상 SKU(재등록SKU 탭·판매량저조영구정지 등) ${payload.statusLists.reregisteredExcluded.length}건은 해제가 아니라 신규 재등록 대상이라 뺐습니다.` : ""}
                </p>
                <div className={`${styles.tableWrap} ${styles.copyScroll}`}>
                  <table className={`${styles.table} ${styles.copyTable}`} aria-label={section.title}>
                    <thead>
                      <tr>
                        <th>SKU ID</th>
                        <th>상품명</th>
                      </tr>
                    </thead>
                    <tbody>
                      {section.rows.map((item) => (
                        <tr key={item.skuId}>
                          <td>{item.skuId}</td>
                          <td>{item.productName}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className={styles.pairButtons}>
                  {section.kind === "release" && (
                    <button
                      type="button"
                      className={`softSageButton ${styles.fullButton}`}
                      disabled={routingKeys["release-file"]}
                      onClick={() => void downloadReleaseFile()}
                    >
                      {routingKeys["release-file"] ? "만드는 중…" : "엑셀 파일 만들기"}
                    </button>
                  )}
                  {section.kind === "discontinue" && (
                    <button
                      type="button"
                      className={`softSageButton ${styles.fullButton}`}
                      disabled={routingKeys["discontinue-file"]}
                      onClick={() => void downloadDiscontinueFiles(section.rows.map((row) => row.skuId))}
                    >
                      {routingKeys["discontinue-file"] ? "만드는 중…" : "단종신청 엑셀·공문 만들기"}
                    </button>
                  )}
                  <button
                    type="button"
                    className={`softPinkButton ${styles.fullButton}`}
                    disabled={routingKeys[`supply:clear-list:${section.kind}`]}
                    onClick={() => void supplyCheck("clear-list", "", "", { kind: section.kind, keys: section.rows.map((row) => row.key) })}
                  >
                    {section.done}
                  </button>
                </div>
              </section>
            ))}
            {!fixture && (
              <WarehouseRecheckCleanup
                onDone={(text, isError) => {
                  if (isError) setError(text);
                  else { setError(""); setMessage(text); }
                }}
              />
            )}
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
            <p className={styles.meta}>
              미납 검토 {shortageLines.length}건
              {shortageReviewLines.length > 0
                ? ` · 확인 필요 ${shortageReviewLines.length}건`
                : ""}{" "}
              · 초도입고 후보 {marketingLines.length}건 · 마지막 수집{" "}
              {payload.collectedAt || payload.board.collectedAt || "기록 없음"}
            </p>
          </>
        )}
        {tab === "followup" && followUpData && (
          <section className={styles.followUp} aria-label="후속처리">
            <div
              className={styles.workTabs}
              role="tablist"
              aria-label="서류 업무 선택"
            >
              {(
                [
                  ["discontinue", "단종서류"],
                  ["reorder", "미납분 재발주요청"],
                  ["marketing", "쿠폰·광고"],
                ] as const
              ).map(([kind, label]) => (
                <button
                  key={kind}
                  type="button"
                  role="tab"
                  aria-selected={followUpKind === kind}
                  className={`${styles.workTab} ${followUpKind === kind ? styles.workTabActive : ""}`}
                  onClick={() => setFollowUpKind(kind)}
                >
                  {label} <span>{followUpData.queues[kind].length}</span>
                </button>
              ))}
            </div>
            <article className={styles.workArea}>
              <h2>
                {followUpKind === "discontinue"
                  ? "단종서류"
                  : followUpKind === "reorder"
                    ? "미납분 재발주요청"
                    : "쿠폰·광고"}
              </h2>
              <p className={styles.meta}>
                현재 대기 {activeFollowUpQueue.length}건
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
              {activeFollowUpQueue.length ? (
                <ul className={styles.workList}>
                  {activeFollowUpQueue.map((line) => (
                    <li key={line.lineKey}>
                      <strong>{line.productName}</strong>
                      <small>
                        SKU {line.skuId} · 쉽먼트 {line.shipmentNumber} · 발주{" "}
                        {line.purchaseOrderNumber}
                      </small>
                      {/* 2026-10-11 사용자 요청: 어느 입고예정일 건의 미납인지, 몇 개 미납인지 */}
                      {(() => {
                        const extra = line as { expectedDate?: string; shortageQuantity?: number };
                        const shortage = line.kind === "shortage" && extra.shortageQuantity ? extra.shortageQuantity : 0;
                        if (!extra.expectedDate && !shortage) return null;
                        return (
                          <small>
                            {extra.expectedDate ? `입고예정일 ${extra.expectedDate}` : ""}
                            {extra.expectedDate && shortage ? " · " : ""}
                            {shortage ? <b style={{ color: "#a6614e" }}>미납 {shortage}개</b> : null}
                          </small>
                        );
                      })()}
                      {(line as { couponNote?: string }).couponNote && (
                        <small className={styles.error}>{(line as { couponNote?: string }).couponNote}</small>
                      )}
                      {followUpKind === "marketing" && !fixture && (
                        <span style={{ display: "flex", gap: "6px", marginTop: "4px" }}>
                          <button
                            type="button"
                            className={styles.button}
                            disabled={busy}
                            onClick={() =>
                              void followUpAction(
                                { action: "unqueueMarketing", lineKeys: [line.lineKey] },
                                `${line.productName} · 마케팅 SKU 리스트로 되돌렸습니다.`,
                              )
                            }
                          >
                            입고결과로 되돌리기
                          </button>
                          <button
                            type="button"
                            className={styles.button}
                            disabled={busy}
                            onClick={() =>
                              void followUpAction(
                                { action: "excludeMarketing", lineKeys: [line.lineKey] },
                                `${line.productName} · 쿠폰·광고에서 제외했습니다.`,
                              )
                            }
                          >
                            제외
                          </button>
                        </span>
                      )}
                      {line.blockedReason && (
                        <small className={styles.error}>
                          {line.blockedReason}
                        </small>
                      )}
                    </li>
                  ))}
                </ul>
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
                          busy || blocked || !activeFollowUpQueue.length
                        }
                        onClick={() =>
                          void followUpAction(
                            { action: "generate", kind: followUpKind },
                            `${followUpKind === "reorder" ? "미납분 재발주요청" : followUpKind === "discontinue" ? "단종" : "쿠폰·광고"} 누적 대상 파일을 생성했습니다.`,
                          )
                        }
                      >
                        {followUpKind === "discontinue"
                          ? "단종서류 생성"
                          : followUpKind === "reorder"
                            ? "미납분 재발주요청 파일 생성"
                            : "쿠폰·광고 파일 생성"}
                      </button>
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
                        {lineByKey.get(line.lineKey)?.productName || lineBySku.get(line.skuId)?.productName || "상품명 없음"}
                        <small style={{ display: "block", fontWeight: 400 }}>SKU {line.skuId}</small>
                      </strong>
                      {line.restoredAt ? (
                        <span className={styles.meta}>복원완료</span>
                      ) : (
                        <button
                          className={styles.button}
                          disabled={busy}
                          onClick={() =>
                            void followUpAction(
                              {
                                action: "restoreMarketing",
                                lineKeys: [line.lineKey],
                              },
                              "초도입고 검토 후보로 복원했습니다.",
                            )
                          }
                        >
                          제외 복원
                        </button>
                      )}
                    </div>
                  ))}
                </section>
              )}
            <article className={styles.vendorArea}>
              <div>
                <h2>거래처발주</h2>
                <p>
                  초안 검토 후 카톡으로 전송하고, 답변에 따라 단종·지연·거래처
                  수정·재발주를 처리합니다.
                </p>
                <p className={styles.meta}>
                  대기 {followUpData.queues.vendor.length}건 · 거래처 업무가
                  남아 있어도 서류 업무 완료는 막지 않습니다.
                </p>
              </div>
              {fixture ? (
                <span className={styles.linkButton}>
                  개발용 예시자료에서는 관리 화면 연결 없음
                </span>
              ) : (
                <Link
                  className={styles.linkButton}
                  href="/wms/vendor-orders/manage"
                >
                  거래처발주 관리 열기
                </Link>
              )}
            </article>
          </section>
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
                    onClick={() => openTab("followup")}
                  >
                    이 페이지 후속처리 열기
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
