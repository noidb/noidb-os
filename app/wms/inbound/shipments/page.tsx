"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import asideBaseline from "@/lib/wms/logistics-aside-baseline.json";
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
const koreanUnresolvedKind: Record<string, string> = {
  multiple_purchase_orders: "복수 발주서",
  purchase_unavailable_status: "공급 상태",
};
const unresolvedNote = (item: { kind: string; note: string }) =>
  item.kind === "multiple_purchase_orders"
    ? "발주번호는 다음 쉽먼트 상세 수집에서 확인합니다."
    : item.note;
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
  const [tab, setTab] = useState<Tab>("pending");
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
  const [marketingReviewOpen, setMarketingReviewOpen] = useState(false);
  const initialLoad = useRef(false);
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
      const response = await fetch("/api/wms/logistics/receipts", {
        cache: "no-store",
      });
      const data = await response.json();
      if (!response.ok)
        throw new Error(data.error || "입고결과를 불러오지 못했습니다.");
      const next = asPayload(data);
      setPayload(next);
      if (next.followUp) setFollowUp(next.followUp);
      else await loadFollowUp(next, false);
      setMessage(
        manual
          ? "최신 입고결과와 후속 처리 목록을 다시 불러왔습니다."
          : "저장된 입고결과를 불러왔습니다.",
      );
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

  async function importBackup(file: File) {
    setBusy(true);
    setError("");
    try {
      const raw = JSON.parse(await file.text());
      if (isFixtureMode())
        throw new Error(
          "개발용 예시자료에서는 백업 가져오기를 사용할 수 없습니다.",
        );
      const response = await fetch("/api/wms/logistics/receipts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(raw),
      });
      const data = await response.json();
      if (!response.ok)
        throw new Error(data.error || "JSON 백업을 저장하지 못했습니다.");
      const next = asPayload(data);
      setPayload(next);
      if (next.followUp) setFollowUp(next.followUp);
      else await loadFollowUp(next, false);
      setMessage("쉽먼트 입고결과 백업을 저장했습니다.");
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "JSON 백업을 저장하지 못했습니다.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function submitDecision(
    line: LogisticsReceiptBoardLine,
    decision: Decision,
  ) {
    if (!payload) return;
    setBusy(true);
    setError("");
    try {
      if (fixture) {
        const next = routeLogisticsReceiptsFixtureItem(
          payload,
          line.lineKey,
          decision,
        );
        fixturePayload.current = next;
        setPayload(next);
        setFollowUp(createLogisticsFollowUpFixture(next));
        setMessage(
          "개발용 예시자료에만 후속 처리 상태를 표시했습니다. 실제 업무 변경은 없습니다.",
        );
        return;
      }
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
      await load(true);
      setMessage(
        "후속 처리 대기열에 연결하고 최신 입고결과를 다시 불러왔습니다.",
      );
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "후속 처리 연결에 실패했습니다.",
      );
    } finally {
      setBusy(false);
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
  const pendingTargets =
    payload?.targets.filter((target) =>
      pendingShipmentNumbers.has(target.shipmentNumber),
    ) || [];
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
  const renderResultRow = (line: LogisticsReceiptBoardLine) => (
    <tr key={line.lineKey}>
      <td>{line.shipmentNumber}</td>
      <td>{line.purchaseOrderNumber}</td>
      <td className={styles.product}>
        <strong>{line.productName || "상품명 없음"}</strong>
        <span className={styles.meta}>SKU {line.skuId}</span>
      </td>
      <td className={styles.expectedDate}>{line.target.expectedDate || "-"}</td>
      <td>{line.deliveredQuantity ?? "-"}</td>
      <td>{line.receivedQuantity ?? "-"}</td>
      <td>
        {line.remainingQuantity ??
          (typeof line.deliveredQuantity === "number" &&
          typeof line.receivedQuantity === "number"
            ? Math.max(0, line.deliveredQuantity - line.receivedQuantity)
            : "-")}
      </td>
      <td>
        {line.reviewReason && (
          <div className={styles.meta}>{line.reviewReason}</div>
        )}
        {line.kind === "shortage" &&
        line.state === "ready" &&
        (line.remainingQuantity ?? 0) > 0 ? (
          <>
            <button
              className={styles.button}
              disabled={busy}
              onClick={() => void submitDecision(line, "discontinue")}
            >
              단종
            </button>
            <button
              className={styles.button}
              disabled={busy}
              onClick={() => void submitDecision(line, "vendor")}
            >
              거래처발주
            </button>
            <button
              className={styles.button}
              disabled={busy}
              onClick={() => void submitDecision(line, "reorder")}
            >
              미납분 재발주요청
            </button>
          </>
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
        <div>
          <p className={styles.eyebrow}>입고 · 후속 처리</p>
          <h1 className={styles.title}>쉽먼트 입고결과</h1>
          <p className={styles.subtitle}>
            날짜, 센터, 쉽먼트 순서로 확인합니다. 저장된 결과는 자동 재조회하지
            않으며, 새로고침을 눌러야만 최신 자료를 요청합니다.
          </p>
        </div>
        <div className={styles.actions}>
          {!modeReady ? (
            <span className={styles.linkButton}>화면 준비 중…</span>
          ) : fixture ? (
            <span className={styles.linkButton}>입고결과 가져오기</span>
          ) : (
            <a
              className={styles.linkButton}
              href="https://supplier.coupang.com/ibs/asn/active"
              target="_blank"
              rel="noreferrer"
            >
              입고결과 가져오기
            </a>
          )}
          {!modeReady ? null : fixture ? (
            <span className={styles.linkButton}>
              개발용 예시자료에서는 백업 가져오기 불가
            </span>
          ) : (
            <label className={styles.linkButton}>
              .json 백업 가져오기
              <input
                className={styles.fileInput}
                type="file"
                accept=".json,application/json"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  if (file) void importBackup(file);
                }}
              />
            </label>
          )}
          <button
            className={`${styles.button} ${styles.buttonPrimary}`}
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
        Aside의 9월 17일 기록을 반영했습니다. 당시 마감 25건은 다시 처리하지
        않고, 미마감 18건은 계속 확인합니다.
      </p>
      {payload?.board.warnings.map((warning, index) => (
        <p
          className={`${styles.notice} ${styles.error}`}
          key={`${warning}:${index}`}
        >
          확인이 필요한 기록: {warning}
        </p>
      ))}
      <nav className={styles.tabs} aria-label="입고결과 보기">
        {(
          [
            ["pending", "마감대기"],
            ["results", "입고결과"],
            ["followup", "후속처리"],
            ["history", "처리이력"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            className={`${styles.tab} ${tab === value ? styles.tabActive : ""}`}
            onClick={() => setTab(value)}
          >
            {label}
          </button>
        ))}
      </nav>
      <section className={styles.panel}>
        {!payload && !busy && !error && (
          <p className={styles.empty}>
            저장된 입고결과가 없습니다. 쿠팡에서 결과를 가져온 뒤 JSON 백업을
            저장하거나 새로고침하세요.
          </p>
        )}
        {tab === "pending" &&
          payload &&
          (pendingTargets.length ? (
            groupedTargets(pendingTargets).map(([date, centers]) => (
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
                            <p className={styles.meta}>
                              기준{" "}
                              {fixture && target.source === "aside"
                                ? "이전 미마감 예시"
                                : target.source === "aside"
                                  ? "이전 미마감 이력"
                                  : "현재 출고 기록"}
                            </p>
                          </article>
                        ))}
                      </div>
                    </div>
                  ))}
              </section>
            ))
          ) : (
            <p className={styles.empty}>마감을 기다리는 쉽먼트가 없습니다.</p>
          ))}
        {tab === "results" && payload && (
          <>
            <div className={styles.tableWrap}>
              <table className={styles.table} aria-label="미납 상품 검토">
                <thead>
                  <tr>
                    <th>쉽먼트</th>
                    <th>발주번호</th>
                    <th>상품명</th>
                    <th>입고예정일</th>
                    <th>납품</th>
                    <th>입고</th>
                    <th>미납</th>
                    <th>후속 처리</th>
                  </tr>
                </thead>
                <tbody>{resultLines.map(renderResultRow)}</tbody>
              </table>
            </div>
            {!resultLines.length && (
              <p className={styles.empty}>검토할 미납 상품이 없습니다.</p>
            )}
            {marketingLines.length > 0 && (
              <details
                className={styles.reviewDetails}
                onToggle={(event) =>
                  setMarketingReviewOpen(event.currentTarget.open)
                }
              >
                <summary>
                  초도입고 후보 · 쿠폰·광고 검토 {marketingLines.length}건
                </summary>
                {marketingReviewOpen && (
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
                          <strong>{line.productName}</strong>
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
                      className={`${styles.button} ${styles.buttonPrimary}`}
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
                      검토완료 · 대기목록에 모으기
                    </button>
                  </div>
                )}
              </details>
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
                        <th>후속 처리</th>
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
            <details className={styles.historyItem}>
              <summary>2026-09-17 기준 당시 마감·분류 완료 쉽먼트 25건</summary>
              <div className={styles.meta}>
                {asideBaseline.closedShipmentNumbers.join(", ")}
              </div>
            </details>
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
                    onClick={() => setTab("followup")}
                  >
                    이 페이지 후속처리 열기
                  </button>
                )}
              </article>
            ))}
            {asideBaseline.handledLines.map((line) => (
              <article
                className={styles.historyItem}
                key={`${line.shipmentNumber}:${line.purchaseOrderNumber}:${line.skuId}`}
              >
                <strong>
                  {line.classification} · SKU {line.skuId} · {line.quantity}개
                </strong>
                <div className={styles.meta}>
                  쉽먼트 {line.shipmentNumber} · 발주 {line.purchaseOrderNumber}{" "}
                  · Aside 처리 기록 · {line.note || "처리 이력"}
                </div>
              </article>
            ))}
            <details className={styles.historyItem}>
              <summary>
                Aside 원본의 참고사항 ({asideBaseline.unresolved.length}건)
              </summary>
              {asideBaseline.unresolved.map((item, index) => (
                <div
                  className={styles.meta}
                  key={`${item.kind}:${item.shipmentNumber || item.skuId || index}`}
                >
                  이전 기록 참고 · {koreanUnresolvedKind[item.kind] || "기록"} ·{" "}
                  {item.shipmentNumber
                    ? `쉽먼트 ${item.shipmentNumber} · `
                    : ""}
                  {item.skuId ? `SKU ${item.skuId} · ` : ""}
                  {unresolvedNote(item)}
                </div>
              ))}
            </details>
          </div>
        )}
      </section>
      <p className={styles.meta}>
        <Link href="/wms/work-center">작업센터로</Link>
      </p>
    </main>
  );
}
