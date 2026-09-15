const STORAGE_KEY = "noidbPocLastSeen";
const INBOUND_KEY = "noidbPocInboundRows";
const INBOUND_COLLECTION_STATE_KEY = "noidbPocInboundCollectionState";
const PURCHASE_ORDER_LINES_KEY = "noidbPocPurchaseOrderLines";
const PURCHASE_ORDER_LINES_STATE_KEY = "noidbPocPurchaseOrderLinesState";
const PURCHASE_ORDER_LINES_DIAG_KEY = "noidbPocPurchaseOrderLinesDiagnostics";
const PURCHASE_ORDER_LINES_PROBE_STATE_KEY = "noidbPocPurchaseOrderLinesProbeState";
const ORDER_LIST_KEY = "noidbPocOrderListRows";
const ORDER_LIST_ACCUMULATED_KEY = "noidbPocOrderListAccumulated";
const DIAGNOSTICS_KEY = "noidbPocOrderListDiagnostics";
const AUTO_FILTER_APPLIED_KEY = "noidbPocAutoFilterApplied";
const AUTO_FILTER_DIAG_KEY = "noidbPocAutoFilterDiagnostics";
const FILTER_BAR_DIAG_KEY = "noidbPocFilterBarDiagnostics";
const NOIDB_STATUS_ENDPOINT = "https://noidb-os.vercel.app/api/wms/vendor-orders/supplier-hub-status";
const NOIDB_INBOUND_EVENTS_ENDPOINT = "https://noidb-os.vercel.app/api/wms/vendor-orders/supplier-hub-inbound-events";
let inboundProgressTimer = null;
let inboundStartRequestPending = false;

function hasInboundRun(collectionState) {
  return typeof collectionState?.runId === "string" && Boolean(collectionState.runId);
}

function renderPurchaseOrderLinesSummary(data, state, diagnostic) {
  const el = document.getElementById("purchaseOrderLinesSummary");
  if (diagnostic) {
    const detailProbe = diagnostic.detailProbe || state;
    const url = diagnostic.urlCheck ? "성공" : "실패";
    const table = diagnostic.tableCheck ? "성공" : "실패";
    const orderList = diagnostic.orderListRecognized ? "성공" : "실패";
    const orderNo = detailProbe?.fieldChecks?.orderNo || diagnostic.orderNoCheck ? "확인" : "실패";
    const detail = diagnostic.detailPathCheck ? "확인" : "실패";
    const required = detailProbe
      ? `${["orderNo", "skuId", "confirmedOrderQuantity"].filter(field => detailProbe.fieldChecks?.[field]).length}/3`
      : `${diagnostic.requiredHeaderCount || 0}/${diagnostic.requiredHeaderTotal || 4}`;
    const samples = `${detailProbe?.sampleMatchCount ?? diagnostic.sampleMatchCount ?? 0}/${detailProbe?.sampleCount ?? diagnostic.sampleCount ?? 0}`;
    const skuId = detailProbe?.fieldChecks?.skuId || diagnostic.fieldChecks?.skuId ? "확인" : "실패";
    const quantity = detailProbe?.fieldChecks?.confirmedOrderQuantity || diagnostic.fieldChecks?.confirmedOrderQuantity ? "확인" : "실패";
    const expectedDate = detailProbe?.expectedDateAvailable || diagnostic.fieldChecks?.expectedDate ? "확인" : "없음";
    const sourceSku = detailProbe?.sourceSkuScreenCheck ? "확인" : "실패";
    const count = detailProbe?.collectableSkuCount ?? diagnostic.collectableSkuCount ?? 0;
    const finalResult = detailProbe?.status === "running" ? "상세/SKU 조회 중" : (diagnostic.finalResult || (diagnostic.ok ? "자동 조사 필요" : "추가조사 필요"));
    const errorCount = detailProbe ? (detailProbe.diagnosticErrors?.length || 0) : (diagnostic.errorCount || 0);
    el.textContent = `신규 발주 원본 검증\n발주목록: ${orderList} · URL 인식: ${url} · 테이블: ${table}\n상세/SKU 경로: ${detail} · 원본 SKU 화면: ${sourceSku}\n발주번호: ${orderNo} · SKU ID: ${skuId} · 확정 발주수량: ${quantity} · 입고예정일: ${expectedDate}\n필수 필드: ${required} · 샘플 검증: ${samples} 일치 · 수집 가능 SKU: ${count}개 · 오류: ${errorCount}개\n최종 결과: ${finalResult}`;
    return;
  }
  if (state?.status === "running") {
    el.textContent = `신규 발주 원본 수집 중: ${state.currentPage || 0}/${state.totalPages || "?"} 페이지 / ${state.collectedLineCount || 0}개`;
  } else if (state?.status === "complete") {
    const transfer = state.transferStatus === "sent" ? ` · 전송 ${state.sentCount || 0}개` : state.transferStatus === "failed" ? ` · 전송 실패: ${state.transferError || "원인 확인 필요"}` : " · 전송 대기";
    el.textContent = `신규 발주 ${state.newCount || 0}건 · 신규 SKU ${state.newSkuCount || 0}건 · 변경 ${state.updatedCount || 0}건 · 중복 제외 ${state.duplicateCount || 0}건${transfer}`;
  } else if (state?.status === "stopped") {
    el.textContent = `신규 발주 원본 수집 중단: ${state.stopReason || "원인 확인 필요"}`;
  } else {
    el.textContent = `누적 원본 SKU ${Array.isArray(data?.lines) ? data.lines.length : 0}개`;
  }
}

function renderSnapshot(data) {
  const statusEl = document.getElementById("status");
  const dataEl = document.getElementById("data");

  if (!data) {
    statusEl.textContent =
      "아직 수집된 데이터가 없습니다. supplier.coupang.com 페이지를 새로고침한 뒤 다시 열어보세요.";
    dataEl.textContent = "";
    return;
  }

  statusEl.textContent = "마지막으로 읽은 페이지 정보:";
  dataEl.textContent = JSON.stringify(data, null, 2);
}

// 항상 보이는 요약 한 줄만 표시한다(원본 JSON은 상세 진단 안에서만).
function renderInboundSummary(data, collectionState) {
  const el = document.getElementById("inboundSummary");
  const hasCurrentRun = hasInboundRun(collectionState);
  if (hasCurrentRun && collectionState.collectionStatus === "running") {
    const collected = data?.collectedRowCount ?? collectionState.collectedRowCount ?? 0;
    el.textContent = `전체수집 중: ${collectionState.currentPage || 0}/${collectionState.totalPages || "?"} 페이지 / 누적 ${collected}건`;
    return;
  }
  if (hasCurrentRun && collectionState.collectionStatus === "complete") {
    const collected = data?.collectedRowCount ?? data?.rows?.length ?? 0;
    el.textContent = `전체수집 완료: ${collected}건`;
    return;
  }
  if (hasCurrentRun && collectionState.collectionStatus === "stopped") {
    el.textContent = `전체수집 중단${collectionState.collectionStopReason ? `: ${collectionState.collectionStopReason}` : ""}`;
    return;
  }
  if (!data || !data.found || !data.rowCount) {
    el.textContent = "수집된 데이터 없음 (해당 화면에서 '현재 화면 다시 읽기' 필요)";
    return;
  }
  const collected = data.collectedRowCount ?? data.rows?.length ?? data.rowCount;
  el.textContent = `현재 ${data.rowCount}행 / 누적 ${collected}행 (전체수집 시작 전)`;
}

function updateInboundControls(data, collectionState) {
  const startButton = document.getElementById("startInboundCollection");
  const sendButton = document.getElementById("sendInboundToNoidb");
  const isRunning = collectionState?.collectionStatus === "running"
    && hasInboundRun(collectionState);
  const isComplete = collectionState?.collectionStatus === "complete"
    && typeof collectionState?.runId === "string"
    && data?.runId === collectionState.runId;
  if (!isRunning) inboundStartRequestPending = false;
  startButton.disabled = inboundStartRequestPending;
  sendButton.disabled = !isComplete;
}

function renderInbound(data) {
  const statusEl = document.getElementById("inboundStatus");
  const dataEl = document.getElementById("inboundData");

  if (!data || !data.found || !data.rowCount) {
    statusEl.textContent =
      "입고상세내역 표를 아직 찾지 못했습니다. 해당 화면을 연 상태에서 '현재 화면 다시 읽기'를 눌러보세요.";
    dataEl.textContent = "";
    return;
  }

  const matchedColumns = Object.keys(data.columnMap || {}).join(", ");
  statusEl.textContent = `현재 ${data.rowCount}행, 누적 ${data.collectedRowCount ?? data.rows.length}행 읽음 (매칭된 컬럼: ${matchedColumns})`;
  dataEl.textContent = JSON.stringify(data.rows.slice(0, 3), null, 2);
}

function formatDistinct(distinct) {
  const entries = Object.entries(distinct || {});
  if (!entries.length) return "(데이터 없음)";
  return entries.map(([value, count]) => `"${value}": ${count}건`).join(", ");
}

function renderOrderList(data) {
  const statusEl = document.getElementById("orderListStatus");
  const dataEl = document.getElementById("orderListData");
  const purchaseTypeDiagEl = document.getElementById("purchaseTypeDiag");

  if (!data || !data.found) {
    statusEl.textContent =
      "발주리스트 표를 아직 찾지 못했습니다. 발주리스트 화면을 연 상태에서 '발주리스트 다시 읽기'를 눌러보세요.";
    dataEl.textContent = "";
    purchaseTypeDiagEl.textContent = "";
    return;
  }

  const matchedColumns = Object.keys(data.columnMap || {}).join(", ");
  statusEl.textContent =
    `총 ${data.totalRowCount}행(고유) 중 매입용 제외 ${data.excludedPurchaseTypeCount}건, ` +
    `수집 ${data.rowCount}행 (매칭된 컬럼: ${matchedColumns})`;
  dataEl.textContent = JSON.stringify(data.rows, null, 2);

  const purchaseTypeColText =
    data.purchaseTypeColIdx != null
      ? `"발주유형" 컬럼 (index ${data.purchaseTypeColIdx})`
      : "찾지 못함 (제외 처리 보류 — 아무 것도 제외 안 함)";
  const scrollText = data.scrolled
    ? `예 (스크롤 컨테이너 발견, 추정 전체 행수 ${data.estimatedTotalRows ?? "측정 실패"})`
    : "아니요 (스크롤 없이 화면에 이미 전체 행이 있었음)";
  purchaseTypeDiagEl.textContent =
    `화면 추정 행수(스크롤 컨테이너 측정): ${data.estimatedTotalRows ?? "-"}\n` +
    `실제 수집 고유 행수: ${data.totalRowCount}\n` +
    `매입용 제외 수: ${data.excludedPurchaseTypeCount}\n` +
    `일반(수집) 수: ${data.rowCount}\n` +
    `매입용 판정 컬럼: ${purchaseTypeColText}\n` +
    `가상스크롤 감지/수집 여부: ${scrollText}\n` +
    `발주유형 distinct: ${formatDistinct(data.purchaseTypeDistinct)}`;
}

function renderOrderListAccumulated(data) {
  const statusEl = document.getElementById("orderListAccStatus");
  const dataEl = document.getElementById("orderListAccData");

  if (!data || !data.byOrderNo || Object.keys(data.byOrderNo).length === 0) {
    statusEl.textContent =
      "아직 누적된 발주리스트 결과가 없습니다. 발주리스트 화면을 열면 자동으로 쌓입니다.";
    dataEl.textContent = "";
    return;
  }

  const rows = Object.values(data.byOrderNo).sort((a, b) =>
    (a.orderNo || "").localeCompare(b.orderNo || "")
  );
  statusEl.textContent =
    `발주번호 기준 누적 ${rows.length}건 (스캔 ${data.scanCount}회, ` +
    `누적 매입용 제외 ${data.cumulativeExcludedPurchaseTypeCount}건, ` +
    `마지막 스캔: ${data.lastCapturedAt || "-"})`;
  dataEl.textContent = JSON.stringify(rows, null, 2);
}

// 발주리스트 요약 7개 지표를 계산한다. 누적(byOrderNo)에는 매입용 행이
// 애초에(수집 단계에서) 들어가지 않으므로, "일반 수집 수"는 "누적 고유
// 발주서 수"와 같은 값이 나오는 게 정상이다(교차검증용으로 둘 다 표시).
// 정산완료/미정산/오류는 누적된 각 발주서의 settlementStatus 텍스트를 그대로
// 집계할 뿐 새로운 판정 로직을 추가하지 않는다 — settlementStatus가 비어
// 있으면(화면에서 값을 못 읽었거나 아직 상태가 없는 경우) "오류(미확인)"로
// 센다.
function computeOrderListSummary(currentScan, accumulated) {
  const currentCount = currentScan && currentScan.found ? currentScan.rowCount : null;
  const byOrderNo = accumulated && accumulated.byOrderNo ? accumulated.byOrderNo : {};
  const rows = Object.values(byOrderNo);

  let settled = 0;
  let unsettled = 0;
  let errorCount = 0;
  for (const row of rows) {
    const status = (row.settlementStatus || "").trim();
    if (!status) errorCount += 1;
    else if (status === "정산완료") settled += 1;
    else unsettled += 1;
  }

  return {
    currentCount,
    uniqueCount: rows.length,
    excludedCumulative: accumulated ? accumulated.cumulativeExcludedPurchaseTypeCount || 0 : 0,
    normalCount: rows.length,
    settled,
    unsettled,
    errorCount,
    hasData: currentCount != null || rows.length > 0,
  };
}

function renderOrderListSummary(currentScan, accumulated) {
  const el = document.getElementById("orderListSummary");
  const s = computeOrderListSummary(currentScan, accumulated);

  if (!s.hasData) {
    el.textContent = "아직 수집된 발주리스트 데이터가 없습니다. 발주리스트 화면을 열어보세요.";
    return;
  }

  el.textContent = [
    `현재 화면 수집 건수: ${s.currentCount != null ? s.currentCount + "건" : "-"}`,
    `누적 고유 발주서 수: ${s.uniqueCount}건`,
    `매입용 제외 수(누적): ${s.excludedCumulative}건`,
    `일반 수집 수(누적): ${s.normalCount}건`,
    `정산완료 수: ${s.settled}건`,
    `미정산 수: ${s.unsettled}건`,
    `오류 수(정산상태 미확인): ${s.errorCount}건`,
  ].join("\n");
}

function renderDiagnostics(data) {
  const statusEl = document.getElementById("diagStatus");
  const dataEl = document.getElementById("diagData");

  if (!data) {
    statusEl.textContent = "아직 진단 정보가 없습니다.";
    dataEl.textContent = "";
    return;
  }

  statusEl.textContent =
    `수집 시각: ${data.collectedAt} (${data.reason}) — table 후보 ${data.tableCandidates.length}개, ` +
    `ARIA grid 후보 ${data.ariaGridCandidates.length}개, 숫자텍스트 행패턴 ${data.numericTextRowPatterns.length}개`;
  dataEl.textContent = JSON.stringify(data, null, 2);
}

// 기본 화면에는 이 한 줄(성공/실패 + 실패 단계)만 보여준다. 원본 DOM/진단
// JSON은 아래 renderAutoFilter가 채우는 "상세 진단" 안에서만 볼 수 있다.
function renderAutoFilterSummary(applied, diag) {
  const el = document.getElementById("autoFilterSummary");
  if (applied) {
    el.textContent = "자동조회 상태: 이전 실행 성공";
  } else if (diag && diag.failedStep) {
    el.textContent = `자동조회 상태: 실패\n실패 단계: ${diag.failedStep}`;
  } else if (diag) {
    el.textContent = "자동조회 상태: 실패";
  } else {
    el.textContent = "자동조회 상태: 대기 중 (아직 발주리스트 화면에 진입한 적 없음)";
  }
}

function renderAutoFilter(applied, diag) {
  const statusEl = document.getElementById("autoFilterStatus");
  const dataEl = document.getElementById("autoFilterData");

  if (applied) {
    statusEl.textContent =
      "이전 실행 완료 — 현재 화면이 목표 상태가 아니면 다음 진입 시 자동으로 다시 확인합니다.";
  } else if (diag?.failedStep) {
    statusEl.textContent = `미적용 — '${diag.failedStep}' 단계에서 확인되지 않아 중단됨(검색 안 누름). 다음 진입 시 자동 재시도합니다.`;
  } else if (diag) {
    statusEl.textContent = "미적용 — 진단 정보는 있으나 실패 단계 정보 없음. 다음 진입 시 자동 재시도합니다.";
  } else {
    statusEl.textContent = "아직 발주리스트 화면에 진입한 적이 없거나 정보가 없습니다.";
  }
  dataEl.textContent = diag ? JSON.stringify(diag, null, 2) : "";
}

function renderFilterBarDiagnostics(data) {
  const statusEl = document.getElementById("filterBarDiagStatus");
  const dataEl = document.getElementById("filterBarDiagData");

  if (!data) {
    statusEl.textContent =
      "아직 진단 정보가 없습니다. 발주리스트 화면을 열거나 '필터바 진단 다시 수집'을 눌러보세요.";
    dataEl.textContent = "";
    return;
  }

  statusEl.textContent =
    `수집 시각: ${data.collectedAt} (${data.reason}) — 후보 ${data.candidateCount}개, ` +
    `select ${data.selectOptions?.length || 0}개`;
  dataEl.textContent = JSON.stringify(data, null, 2);
}

function loadAll() {
  chrome.storage.local.get(
    [
      STORAGE_KEY,
      INBOUND_KEY,
      INBOUND_COLLECTION_STATE_KEY,
      ORDER_LIST_KEY,
      ORDER_LIST_ACCUMULATED_KEY,
      PURCHASE_ORDER_LINES_KEY,
      PURCHASE_ORDER_LINES_STATE_KEY,
      PURCHASE_ORDER_LINES_DIAG_KEY,
      DIAGNOSTICS_KEY,
      AUTO_FILTER_APPLIED_KEY,
      AUTO_FILTER_DIAG_KEY,
      FILTER_BAR_DIAG_KEY,
    ],
    (result) => {
      renderSnapshot(result[STORAGE_KEY]);
      renderInboundSummary(result[INBOUND_KEY], result[INBOUND_COLLECTION_STATE_KEY]);
      updateInboundControls(result[INBOUND_KEY], result[INBOUND_COLLECTION_STATE_KEY]);
      renderInbound(result[INBOUND_KEY]);
      renderPurchaseOrderLinesSummary(result[PURCHASE_ORDER_LINES_KEY], result[PURCHASE_ORDER_LINES_STATE_KEY] || result[PURCHASE_ORDER_LINES_PROBE_STATE_KEY], result[PURCHASE_ORDER_LINES_DIAG_KEY]);
      document.getElementById("collectPurchaseOrderLines").disabled = false;
      renderOrderListSummary(result[ORDER_LIST_KEY], result[ORDER_LIST_ACCUMULATED_KEY]);
      renderOrderList(result[ORDER_LIST_KEY]);
      renderOrderListAccumulated(result[ORDER_LIST_ACCUMULATED_KEY]);
      renderDiagnostics(result[DIAGNOSTICS_KEY]);
      renderAutoFilterSummary(result[AUTO_FILTER_APPLIED_KEY], result[AUTO_FILTER_DIAG_KEY]);
      renderAutoFilter(result[AUTO_FILTER_APPLIED_KEY], result[AUTO_FILTER_DIAG_KEY]);
      renderFilterBarDiagnostics(result[FILTER_BAR_DIAG_KEY]);
      const isRunning = result[INBOUND_COLLECTION_STATE_KEY]?.collectionStatus === "running"
        && hasInboundRun(result[INBOUND_COLLECTION_STATE_KEY]);
      if (isRunning && !inboundProgressTimer) {
        inboundProgressTimer = setInterval(loadAll, 500);
      } else if (!isRunning && inboundProgressTimer) {
        clearInterval(inboundProgressTimer);
        inboundProgressTimer = null;
      }
    }
  );
}

document.getElementById("refresh").addEventListener("click", loadAll);

document.addEventListener("click", (event) => {
  const button = event.target instanceof Element
    ? event.target.closest("#startInboundCollection")
    : null;
  if (!button) return;
  const summaryEl = document.getElementById("inboundSummary");
  if (inboundStartRequestPending) return;
  inboundStartRequestPending = true;
  button.disabled = true;
  summaryEl.textContent = "수집 시작 요청 중...";
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (chrome.runtime.lastError) {
      summaryEl.textContent = `수집 시작 실패: ${chrome.runtime.lastError.message}`;
      inboundStartRequestPending = false;
      button.disabled = false;
      return;
    }
    const tab = tabs[0];
    let isInboundDetail = false;
    try {
      isInboundDetail = new URL(tab?.url || "").pathname === "/scm/receive/detail";
    } catch {
      isInboundDetail = false;
    }
    if (!tab?.id || !isInboundDetail) {
      summaryEl.textContent = "수집 시작 실패: 현재 탭이 입고상세 화면이 아닙니다.";
      inboundStartRequestPending = false;
      button.disabled = false;
      return;
    }
    summaryEl.textContent = "입고상세 화면 확인 완료";
    let settled = false;
    const fail = (reason) => {
      if (settled) return;
      settled = true;
      summaryEl.textContent = `수집 시작 실패: ${reason}`;
      inboundStartRequestPending = false;
      button.disabled = false;
    };
    const timeout = setTimeout(() => fail("content script 응답 없음 (페이지 새로고침 필요)"), 2000);
    try {
      chrome.tabs.sendMessage(tab.id, { type: "NOIDB_POC_START_INBOUND_COLLECTION" }, (response) => {
        if (settled) return;
        clearTimeout(timeout);
        if (chrome.runtime.lastError) {
          fail(chrome.runtime.lastError.message || "content script 응답 없음 (페이지 새로고침 필요)");
          return;
        }
        if (!response?.ok || response.started !== true) {
          fail(response?.reason || "content script ACK 없음");
          return;
        }
        settled = true;
        summaryEl.textContent = "전체수집 시작됨";
        setTimeout(loadAll, 250);
      });
    } catch (error) {
      clearTimeout(timeout);
      fail(error instanceof Error ? error.message : "content script 호출 실패");
    }
  });
});

document.getElementById("rescan").addEventListener("click", () => {
  const statusEl = document.getElementById("inboundStatus");
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs[0];
    if (!tab?.id) {
      statusEl.textContent = "현재 탭 정보를 가져오지 못했습니다.";
      return;
    }
    chrome.tabs.sendMessage(tab.id, { type: "NOIDB_POC_RESCAN" }, () => {
      if (chrome.runtime.lastError) {
        statusEl.textContent =
          "이 탭에는 content script가 없습니다. supplier.coupang.com 페이지에서 실행해주세요.";
        return;
      }
      setTimeout(loadAll, 300);
    });
  });
});

document.getElementById("collectPurchaseOrderLines").addEventListener("click", () => {
  const button = document.getElementById("collectPurchaseOrderLines");
  const statusEl = document.getElementById("purchaseOrderLinesSummary");
  button.disabled = true;
  statusEl.textContent = "신규 발주 원본 검증 중...";
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (chrome.runtime.lastError) {
      statusEl.textContent = `수집 시작 실패: ${chrome.runtime.lastError.message}`;
      button.disabled = false;
      return;
    }
    const tab = tabs[0];
    let url;
    try { url = new URL(tab?.url || ""); } catch { url = null; }
    if (!tab?.id || url?.hostname !== "supplier.coupang.com") {
      statusEl.textContent = "수집 시작 실패: Supplier Hub 탭을 확인해 주세요.";
      button.disabled = false;
      return;
    }
    const finish = (response) => {
      if (chrome.runtime.lastError) {
        statusEl.textContent = `검증 실패: ${chrome.runtime.lastError.message}`;
        button.disabled = false;
        return;
      }
      if (!response?.ok && response?.diagnostic) {
        renderPurchaseOrderLinesSummary(null, null, response.diagnostic);
        button.disabled = false;
        return;
      }
      if (!response?.ok) {
        statusEl.textContent = `검증 실패: ${response?.reason || "content script 응답 없음"}`;
        button.disabled = false;
        return;
      }
      if (response?.diagnostic) renderPurchaseOrderLinesSummary(null, null, response.diagnostic);
      else statusEl.textContent = "신규 발주 원본 자동진단 완료";
      setTimeout(loadAll, 250);
    };
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      statusEl.textContent = "신규 발주 원본 자동진단 실패\n발주목록 인식: 확인하지 못함 · content script 응답 없음";
      button.disabled = false;
    }, 2000);
    try {
      chrome.tabs.sendMessage(tab.id, { type: "NOIDB_POC_DISCOVER_PURCHASE_ORDER_SOURCE" }, (response) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        finish(response);
      });
    } catch (error) {
      clearTimeout(timeout);
      settled = true;
      statusEl.textContent = `검증 실패: ${error instanceof Error ? error.message : "content script 호출 실패"}`;
      button.disabled = false;
    }
  });
});

document.getElementById("copyPurchaseOrderLinesDiagnostics").addEventListener("click", () => {
  const statusEl = document.getElementById("purchaseOrderLinesSummary");
  chrome.storage.local.get(PURCHASE_ORDER_LINES_DIAG_KEY, (result) => {
    const diagnostic = result[PURCHASE_ORDER_LINES_DIAG_KEY];
    if (!diagnostic) {
      statusEl.textContent = "복사할 진단결과가 없습니다.";
      return;
    }
    const lines = [
      "[신규 발주 원본 자동진단]",
      `현재 URL: ${diagnostic.url || ""}`,
      `발주목록 인식: ${diagnostic.orderListRecognized ? "성공" : "실패"}`,
      `발주번호 인식: ${diagnostic.orderNoCheck ? "확인" : "실패"}`,
      `상세/SKU 경로 발견: ${diagnostic.detailPathCheck ? "성공" : "실패"}`,
      `실제 헤더: ${(diagnostic.headers || []).join(" | ")}`,
      `필드 매핑: ${JSON.stringify(diagnostic.mappedHeaders || {})}`,
      `샘플 검증: ${diagnostic.sampleMatchCount || 0}/${diagnostic.sampleCount || 0}`,
      `상세/SKU 후보: ${(diagnostic.detailLinkCandidates || diagnostic.navigationCandidates || []).map(candidate => candidate.value).join(" | ") || "없음"}`,
      `상세 URL: ${diagnostic.detailUrl || diagnostic.detailProbe?.url || "아직 실행 전"}`,
      `상세 구조: ${(diagnostic.detailSurfaceTypes || []).join(", ") || "없음"}`,
      `iframe: ${(diagnostic.iframeUrls || []).map(frame => frame.url).join(" | ") || "없음"}`,
      `조회 리소스: ${(diagnostic.observedResourceUrls || []).join(" | ") || "없음"}`,
      `탐지 응답 필드: ${(diagnostic.detectedResponseFields || []).join(", ") || "없음"}`,
      `SKU ID 원본 필드: ${diagnostic.sourceSkuIdField || "없음"}`,
      `확정 발주수량 원본 필드: ${diagnostic.sourceQuantityField || "없음"}`,
      `샘플 검증: ${diagnostic.sampleValidation ? `${diagnostic.sampleValidation.matched}/${diagnostic.sampleValidation.count}` : "아직 실행 전"}`,
      `상세/SKU 진단 오류: ${(diagnostic.diagnosticErrors || []).join(" | ") || "없음"}`,
      `정확한 실패 지점: ${diagnostic.finalResult || diagnostic.reason || "없음"}`,
      `다음 기술 조치: ${diagnostic.nextTechnicalAction || "없음"}`,
    ];
    const value = lines.join("\n");
    const copy = navigator.clipboard?.writeText
      ? navigator.clipboard.writeText(value)
      : Promise.reject(new Error("clipboard-api-unavailable"));
    copy.then(() => { statusEl.textContent = "진단결과를 복사했습니다."; }).catch(() => {
      const textarea = document.createElement("textarea");
      textarea.value = value;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      const copied = document.execCommand("copy");
      textarea.remove();
      statusEl.textContent = copied ? "진단결과를 복사했습니다." : "진단결과 복사에 실패했습니다.";
    });
  });
});

function getInboundEvents(data) {
  if (!data || !data.found || !Array.isArray(data.rows) || data.rows.length === 0) return [];
  const fields = ["orderNo", "skuId", "inboundDate", "quantity", "division", "warehouse", "skuName"];
  return data.rows.map((row) => {
    if (!row || typeof row !== "object" || fields.some((field) => typeof row[field] !== "string" || !row[field].trim())) {
      throw new Error("입고상세 필드 누락");
    }
    return {
      orderNo: row.orderNo,
      skuId: row.skuId,
      inboundDate: row.inboundDate,
      quantity: row.quantity,
      division: row.division,
      warehouse: row.warehouse,
      skuName: row.skuName,
    };
  });
}

async function verifyInboundEvents() {
  const response = await fetch(NOIDB_INBOUND_EVENTS_ENDPOINT, { cache: "no-store" });
  if (!response.ok) throw new Error(`GET ${response.status}`);
  const result = await response.json();
  if (!result || result.ok !== true || typeof result.count !== "number") throw new Error("GET 응답 확인 실패");
  return result.count;
}

document.getElementById("sendInboundToNoidb").addEventListener("click", async (event) => {
  const button = event.currentTarget;
  const statusEl = document.getElementById("inboundTransferStatus");
  button.disabled = true;
  statusEl.textContent = "전송 중...";
  try {
    const stored = await chrome.storage.local.get([INBOUND_KEY, INBOUND_COLLECTION_STATE_KEY]);
    const inboundData = stored[INBOUND_KEY];
    const collectionState = stored[INBOUND_COLLECTION_STATE_KEY];
    if (collectionState?.collectionStatus !== "complete"
      || !collectionState.runId
      || inboundData?.runId !== collectionState.runId) {
      statusEl.textContent = "전체 페이지 수집이 끝난 뒤 전송할 수 있습니다.";
      return;
    }
    const events = getInboundEvents(inboundData);
    if (!events.length) {
      statusEl.textContent = "전송할 입고상세 행이 없습니다.";
      return;
    }
    const response = await fetch(NOIDB_INBOUND_EVENTS_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        source: "supplier-hub-extension",
        collectedAt: new Date().toISOString(),
        events,
      }),
    });
    if (!response.ok) throw new Error(`POST ${response.status}`);
    await response.json();
    const count = await verifyInboundEvents();
    statusEl.textContent = `입고상세 전송 완료: ${events.length}행 (운영 누적 ${count}행)`;
  } catch (error) {
    const reason = error instanceof Error ? error.message : "전송 오류";
    statusEl.textContent = `입고상세 전송 실패: ${reason}`;
  } finally {
    button.disabled = false;
  }
});

// 버튼 1회 클릭으로 지정한 <pre> 텍스트 전체를 클립보드에 복사한다.
// 드래그로 선택할 필요 없이, 복사 성공 시 버튼 문구를 잠깐 "복사됨"으로 바꿔 표시.
function copyPreToClipboard(preId, buttonEl) {
  const text = document.getElementById(preId).textContent || "";
  const showCopied = () => {
    const original = buttonEl.textContent;
    buttonEl.textContent = "복사됨";
    setTimeout(() => {
      buttonEl.textContent = original;
    }, 1200);
  };
  const fallbackCopy = () => {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    try {
      document.execCommand("copy");
      showCopied();
    } catch {
      buttonEl.textContent = "복사 실패";
      setTimeout(() => {
        buttonEl.textContent = "전체 복사";
      }, 1200);
    }
    document.body.removeChild(textarea);
  };

  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text).then(showCopied, fallbackCopy);
  } else {
    fallbackCopy();
  }
}

document.getElementById("copyAutoFilter").addEventListener("click", (e) => {
  copyPreToClipboard("autoFilterData", e.target);
});

// 플래그만 지워서 "1회 자동적용"을 다시 시도할 수 있게 한다(실제 클릭은
// 다음에 발주리스트 화면을 열 때 content script가 수행). 팝업은 storage만
// 직접 지우면 되고 페이지 조작은 전혀 하지 않는다.
document.getElementById("resetAutoFilter").addEventListener("click", (e) => {
  chrome.storage.local.remove([AUTO_FILTER_APPLIED_KEY, AUTO_FILTER_DIAG_KEY], () => {
    const original = e.target.textContent;
    e.target.textContent = "초기화됨";
    setTimeout(() => {
      e.target.textContent = original;
    }, 1200);
    loadAll();
  });
});

document.getElementById("copyDiag").addEventListener("click", (e) => {
  copyPreToClipboard("diagData", e.target);
});

document.getElementById("copyPurchaseTypeDiag").addEventListener("click", (e) => {
  copyPreToClipboard("purchaseTypeDiag", e.target);
});

document.getElementById("copyOrderListData").addEventListener("click", (e) => {
  copyPreToClipboard("orderListData", e.target);
});

document.getElementById("copyOrderListAcc").addEventListener("click", (e) => {
  copyPreToClipboard("orderListAccData", e.target);
});

function getTransferOrders(accumulated) {
  const ordersByNo = new Map();
  const byOrderNo = accumulated?.byOrderNo || {};
  const excludedByOrderNo = accumulated?.excludedByOrderNo || {};

  for (const [key, value] of Object.entries(byOrderNo)) {
    if (!value || typeof value !== "object") continue;
    const orderNo = typeof value.orderNo === "string" ? value.orderNo.trim() : key.trim();
    if (!orderNo) continue;
    ordersByNo.set(orderNo, {
      orderNo,
      purchaseType: typeof value.purchaseType === "string" ? value.purchaseType : "",
      settlementStatus: typeof value.settlementStatus === "string" ? value.settlementStatus : "",
      progressStatus: typeof value.progressStatus === "string" ? value.progressStatus : "",
    });
  }

  for (const [key, value] of Object.entries(excludedByOrderNo)) {
    if (!value || typeof value !== "object") continue;
    const orderNo = typeof value.orderNo === "string" ? value.orderNo.trim() : key.trim();
    if (!orderNo) continue;
    if (!ordersByNo.has(orderNo)) {
      ordersByNo.set(orderNo, {
        orderNo,
        purchaseType: typeof value.purchaseType === "string" ? value.purchaseType : "",
        settlementStatus: typeof value.settlementStatus === "string" ? value.settlementStatus : "",
        progressStatus: typeof value.progressStatus === "string" ? value.progressStatus : "",
      });
    }
  }

  return [...ordersByNo.values()];
}

async function verifyTransferredOrders(orders) {
  const response = await fetch(NOIDB_STATUS_ENDPOINT);
  if (!response.ok) throw new Error(`GET ${response.status}`);
  const result = await response.json();
  const stored = new Set(
    Array.isArray(result.statuses)
      ? result.statuses.map((status) => status?.orderNo).filter((orderNo) => typeof orderNo === "string")
      : []
  );
  if (!result.ok || orders.some((order) => !stored.has(order.orderNo))) {
    throw new Error("저장 확인 실패");
  }
  return result.count;
}

document.getElementById("sendToNoidb").addEventListener("click", async (event) => {
  const button = event.currentTarget;
  const statusEl = document.getElementById("transferStatus");
  button.disabled = true;
  statusEl.textContent = "전송 중...";
  try {
    const stored = await chrome.storage.local.get(ORDER_LIST_ACCUMULATED_KEY);
    const orders = getTransferOrders(stored[ORDER_LIST_ACCUMULATED_KEY]);
    if (!orders.length) throw new Error("전송할 발주 없음");
    const response = await fetch(NOIDB_STATUS_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        source: "supplier-hub-extension",
        collectedAt: new Date().toISOString(),
        orders,
      }),
    });
    if (!response.ok) throw new Error(`POST ${response.status}`);
    await response.json();
    await verifyTransferredOrders(orders);
    statusEl.textContent = `전송 완료: ${orders.length}건`;
  } catch (error) {
    const reason = error instanceof Error ? error.message : "알 수 없는 오류";
    statusEl.textContent = `전송 실패: ${reason}`;
  } finally {
    button.disabled = false;
  }
});

document.getElementById("collectDiag").addEventListener("click", () => {
  const statusEl = document.getElementById("diagStatus");
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs[0];
    if (!tab?.id) {
      statusEl.textContent = "현재 탭 정보를 가져오지 못했습니다.";
      return;
    }
    chrome.tabs.sendMessage(tab.id, { type: "NOIDB_POC_COLLECT_DIAGNOSTICS" }, () => {
      if (chrome.runtime.lastError) {
        statusEl.textContent =
          "이 탭에는 content script가 없습니다. supplier.coupang.com 페이지에서 실행해주세요.";
        return;
      }
      setTimeout(loadAll, 300);
    });
  });
});

document.getElementById("collectFilterBarDiag").addEventListener("click", () => {
  const statusEl = document.getElementById("filterBarDiagStatus");
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs[0];
    if (!tab?.id) {
      statusEl.textContent = "현재 탭 정보를 가져오지 못했습니다.";
      return;
    }
    chrome.tabs.sendMessage(tab.id, { type: "NOIDB_POC_COLLECT_FILTER_BAR_DIAGNOSTICS" }, () => {
      if (chrome.runtime.lastError) {
        statusEl.textContent =
          "이 탭에는 content script가 없습니다. supplier.coupang.com 페이지에서 실행해주세요.";
        return;
      }
      setTimeout(loadAll, 300);
    });
  });
});

document.getElementById("copyFilterBarDiag").addEventListener("click", (e) => {
  copyPreToClipboard("filterBarDiagData", e.target);
});

document.getElementById("rescanOrderList").addEventListener("click", () => {
  const statusEl = document.getElementById("orderListStatus");
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs[0];
    if (!tab?.id) {
      statusEl.textContent = "현재 탭 정보를 가져오지 못했습니다.";
      return;
    }
    chrome.tabs.sendMessage(tab.id, { type: "NOIDB_POC_RESCAN_ORDER_LIST" }, () => {
      if (chrome.runtime.lastError) {
        statusEl.textContent =
          "이 탭에는 content script가 없습니다. supplier.coupang.com 페이지에서 실행해주세요.";
        return;
      }
      setTimeout(loadAll, 300);
    });
  });
});

loadAll();
