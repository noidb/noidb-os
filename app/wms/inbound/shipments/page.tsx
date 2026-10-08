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
};
type FollowUpPayload = LogisticsFollowUpResponse;

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
      const response = await fetch("/api/wms/logistics/follow-up", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...input,
          token: followUp.token,
          expectedCollectedAt: payload.collectedAt || payload.board.collectedAt,
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
      setMessage(success);
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

  // 분류 후 후속처리·처리이력 탭을 열 때만 최신 목록을 한 번 불러온다.
  function openTab(value: Tab) {
    setTab(value);
    if ((value === "followup" || value === "history") && followUpStale.current) {
      followUpStale.current = false;
      void load(true);
    }
  }

  const lines = payload?.board.lines || [];
  const shortageLines = lines.filter(
    (line) =>
      line.kind === "shortage" &&
      (line.state === "ready" || line.state === "review") &&
      (line.remainingQuantity ?? 0) > 0,
  );
  const shortageReviewLines = lines.filter(
    (line) =>
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
  const renderResultRow = (line: LogisticsReceiptBoardLine) => (
    <tr key={line.lineKey}>
      <td>{line.shipmentNumber}</td>
      <td>{line.purchaseOrderNumber}</td>
      <td className={styles.product}>
        <strong>{productDbBadge(line.skuId)}{line.productName || "상품명 없음"}</strong>
        <span className={styles.meta}>SKU {line.skuId}</span>
      </td>
      <td className={styles.expectedDate}>{line.target.expectedDate || "-"}</td>
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
        {line.reviewReason && (
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
            <button
              className={`softSageButton ${styles.decisionButton}`}
              disabled={busy || routingKeys[line.lineKey]}
              onClick={() => void submitDecision(line, "vendor")}
            >
              거래처발주
            </button>
            <button
              className={`softApricotButton ${styles.decisionButton}`}
              disabled={busy || routingKeys[line.lineKey]}
              onClick={() => void submitDecision(line, "reorder")}
            >
              미납분 재발주요청
            </button>
          </div>
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
      {message && (
        <p className={styles.notice} role="status">
          {message}
        </p>
      )}
      {error && (
        <p className={`${styles.notice} ${styles.error}`} role="alert">
          {error}
        </p>
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
      {(payload?.board.unavailableSkus?.length ?? 0) > 0 && (
        <details className={`${styles.notice} ${styles.error} ${styles.unavailable}`}>
          <summary>
            확인이 필요한 기록: 공급상태가 정상이 아닌 SKU {payload!.board.unavailableSkus!.length}건(불가·일시중단·조회안됨)은 미납·쿠폰광고 분류에서 뺐습니다. <b>목록 보기</b>
          </summary>
          <div className={styles.tableWrap}>
            <table className={styles.table} aria-label="공급상태가 정상이 아닌 SKU">
              <thead>
                <tr>
                  <th>공급상태</th>
                  <th>상품명</th>
                  <th>쉽먼트</th>
                  <th>입고예정일</th>
                  <th>납품</th>
                  <th>입고</th>
                  <th>미납</th>
                </tr>
              </thead>
              <tbody>
                {payload!.board.unavailableSkus!.map((item) => (
                  <tr key={`${item.shipmentNumber}:${item.purchaseOrderNumber}:${item.skuId}`}>
                    <td className={styles.statusCell}>
                      {item.orderStatus}
                      {item.fromProductDb && <span className={styles.meta}> (제품DB)</span>}
                    </td>
                    <td className={styles.product}>
                      <strong>{productDbBadge(item.skuId)}{item.productName}</strong>
                      <span className={styles.meta}>SKU {item.skuId} · 발주 {item.purchaseOrderNumber}</span>
                    </td>
                    <td>{item.shipmentNumber}</td>
                    <td className={styles.expectedDate}>{item.expectedDate}</td>
                    <td>{item.deliveredQuantity}</td>
                    <td>{item.receivedQuantity}</td>
                    <td className={styles.shortageQty}>{Math.max(0, item.deliveredQuantity - item.receivedQuantity) || ""}</td>
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
              <table className={styles.table} aria-label="미납 SKU 리스트">
                <thead>
                  <tr>
                    <th>쉽먼트</th>
                    <th>발주번호</th>
                    <th>상품명</th>
                    <th>입고예정일</th>
                    <th>납품</th>
                    <th>입고</th>
                    <th>미납</th>
                    <th className={styles.decisionCell}>후속 처리</th>
                  </tr>
                </thead>
                <tbody>{resultLines.map(renderResultRow)}</tbody>
              </table>
            </div>
            {!resultLines.length && (
              <p className={styles.empty}>검토할 미납 상품이 없습니다.</p>
            )}
            {marketingLines.length > 0 && (
              <section>
                <h2 className={styles.listTitle}>
                  마케팅 SKU 리스트 <span>{marketingLines.length}건</span>
                </h2>
                <p className={styles.meta}>처음 1개 입고된 SKU입니다. 쿠폰·광고에서 뺄 상품만 체크를 풀어 주세요.</p>
                {(
                  <div className={styles.marketingReview}>
                    {marketingLines.map((line) => (
                      <label className={styles.choice} key={line.lineKey}>
                        <input
                          type="checkbox"
                          checked={marketingSelected[line.lineKey] !== false}
                          onChange={(event) =>
                            setMarketingSelected((current) => ({
                              ...current,
                              [line.lineKey]: event.target.checked,
                            }))
                          }
                        />
                        <span>
                          <strong>{productDbBadge(line.skuId)}{line.productName}</strong>
                          <small>
                            SKU {line.skuId} · 쉽먼트 {line.shipmentNumber} ·
                            발주 {line.purchaseOrderNumber}
                          </small>
                          <small>
                            입고예정일 {line.target.expectedDate || "-"}
                          </small>
                        </span>
                      </label>
                    ))}
                    <button
                      className={`softPinkButton ${styles.fullButton}`}
                      disabled={busy}
                      onClick={() => {
                        const selected = marketingLines
                          .filter(
                            (line) => marketingSelected[line.lineKey] !== false,
                          )
                          .map((line) => line.lineKey);
                        const excluded = marketingLines
                          .filter(
                            (line) => marketingSelected[line.lineKey] === false,
                          )
                          .map((line) => line.lineKey);
                        void followUpAction(
                          {
                            action: "queueMarketing",
                            lineKeys: selected,
                            excludedLineKeys: excluded,
                            confirmMarketing: true,
                          },
                          selected.length
                            ? `쿠폰·광고 대상 ${selected.length}건을 후속처리 목록에 모았습니다.`
                            : "선택한 후보를 모두 제외로 저장했습니다.",
                        );
                      }}
                    >
                      체크한 상품 쿠폰·광고 대기목록에 모으기
                    </button>
                  </div>
                )}
              </section>
            )}
            {shortageReviewLines.length > 0 && (
              <details className={styles.reviewDetails}>
                <summary>확인 필요 {shortageReviewLines.length}건</summary>
                <div className={styles.tableWrap}>
                  <table className={styles.table} aria-label="수량 재확인">
                    <thead>
                      <tr>
                        <th>쉽먼트</th>
                        <th>발주번호</th>
                        <th>상품명</th>
                        <th>입고예정일</th>
                        <th>납품</th>
                        <th>입고</th>
                        <th>미납</th>
                        <th className={styles.decisionCell}>후속 처리</th>
                      </tr>
                    </thead>
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
              {activeFollowUpQueue.length ? (
                <ul className={styles.workList}>
                  {activeFollowUpQueue.map((line) => (
                    <li key={line.lineKey}>
                      <strong>{line.productName}</strong>
                      <small>
                        SKU {line.skuId} · 쉽먼트 {line.shipmentNumber} · 발주{" "}
                        {line.purchaseOrderNumber}
                      </small>
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
                      <strong>SKU {line.skuId}</strong>
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
