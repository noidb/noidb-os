function noidbGetExtensionApi() {
  try {
    return globalThis.chrome || null;
  } catch {
    return null;
  }
}

function noidbGetStorageLocal() {
  try {
    return noidbGetExtensionApi()?.storage?.local || null;
  } catch {
    return null;
  }
}

function noidbGetRuntimeLastError() {
  try {
    return noidbGetExtensionApi()?.runtime?.lastError || null;
  } catch {
    return null;
  }
}

function noidbSafeStorageSet(value, callback) {
  const storage = noidbGetStorageLocal();
  if (!storage) return false;
  try {
    storage.set(value, (...args) => {
      try { callback?.(...args); } catch {}
    });
    return true;
  } catch {
    return false;
  }
}

function noidbSafeStorageGet(keys, callback) {
  const storage = noidbGetStorageLocal();
  if (!storage) {
    callback?.({});
    return false;
  }
  try {
    storage.get(keys, (result) => {
      try { callback?.(noidbGetRuntimeLastError() ? {} : (result || {})); } catch {}
    });
    return true;
  } catch {
    callback?.({});
    return false;
  }
}

function noidbSafeStorageGetAsync(keys) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolve(result || {});
    };
    const timer = setTimeout(() => finish({}), 2000);
    noidbSafeStorageGet(keys, (result) => {
      clearTimeout(timer);
      finish(result);
    });
  });
}

function noidbSafeStorageSetAsync(value) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (ok) => {
      if (settled) return;
      settled = true;
      resolve(ok);
    };
    const timer = setTimeout(() => finish(false), 2000);
    if (!noidbSafeStorageSet(value, () => {
      clearTimeout(timer);
      finish(!noidbGetRuntimeLastError());
    })) {
      clearTimeout(timer);
      finish(false);
    }
  });
}

function noidbSafeAddRuntimeMessageListener(listener) {
  try {
    const onMessage = noidbGetExtensionApi()?.runtime?.onMessage;
    if (!onMessage?.addListener) return false;
    onMessage.addListener(listener);
    return true;
  } catch {
    return false;
  }
}

function noidbSafeRuntimeSendMessage(message, callback) {
  let settled = false;
  const finish = (response) => {
    if (settled) return;
    settled = true;
    try { callback?.(response); } catch {}
  };
  const timer = setTimeout(() => finish({ ok: false, reason: "extension-context-unavailable" }), 2000);
  try {
    const runtime = noidbGetExtensionApi()?.runtime;
    if (!runtime?.sendMessage) {
      clearTimeout(timer);
      finish({ ok: false, reason: "extension-context-unavailable" });
      return false;
    }
    runtime.sendMessage(message, (response) => {
      clearTimeout(timer);
      finish(response);
    });
    return true;
  } catch {
    clearTimeout(timer);
    finish({ ok: false, reason: "extension-context-unavailable" });
    return false;
  }
}

// 1단계 POC content script.
// 목적: Supplier Hub 페이지에서 이 스크립트가 실제로 실행되는지,
//       그리고 비민감 정보(제목/URL)를 읽을 수 있는지만 확인한다.
// 금지: DOM 클릭/폼 조작/쿠키·토큰 읽기, 어떠한 쓰기 동작도 하지 않는다.

(() => {
  const STORAGE_KEY = "noidbPocLastSeen";

  const snapshot = {
    title: document.title,
    url: location.href,
    hostname: location.hostname,
    pathname: location.pathname,
    capturedAt: new Date().toISOString(),
  };

  console.log("[NOIDB-POC] content script loaded on Supplier Hub page:", snapshot);

  if (noidbGetStorageLocal()) {
    noidbSafeStorageSet({ [STORAGE_KEY]: snapshot }, () => {
      if (noidbGetRuntimeLastError()) return;
      console.log("[NOIDB-POC] snapshot saved to chrome.storage.local (popup에서 확인 가능)");
    });
  } else console.warn("[NOIDB-POC] chrome.storage.local을 사용할 수 없습니다.");
})();

// 2단계 POC: 입고상세내역 표 읽기 (읽기 전용)
//
// 원칙: 특정 CSS class 이름을 추측해서 하드코딩하지 않는다.
// 대신 화면에 실제로 렌더링된 <table>들을 훑어서, 각 표의 헤더 셀 텍스트가
// 아래 목표 컬럼명과 얼마나 일치하는지 점수를 매기고, 가장 잘 맞는 표를
// "입고상세내역 표"로 판단한다. 그 표의 헤더 순서를 기준으로 각 데이터
// 행의 값을 읽는다. 클릭/입력/네트워크 호출은 전혀 하지 않는다.
(() => {
  const INBOUND_STORAGE_KEY = "noidbPocInboundRows";
  const INBOUND_COLLECTION_STATE_KEY = "noidbPocInboundCollectionState";
  const MIN_MATCHED_COLUMNS = 4; // 이 이상 컬럼이 매칭되어야 "입고상세내역 표"로 간주
  const MAX_INBOUND_PAGES = 150;

  // chrome?.storage?.local는 확장이 리로드/비활성화된 뒤에도 여전히 존재하는
  // 객체라 이 존재 체크만으로는 안전하지 않다 — 실제로 .set()/.get()을 호출할
  // 때 "Extension context invalidated" 예외가 던져질 수 있다(개발 중 확장을
  // 리로드했지만 이 페이지는 새로고침하지 않은 경우 흔히 발생하며, 이 예외를
  // 못 잡으면 setTimeout 콜백 안에서 발생해 크롬 확장 오류 로그에 그대로
  // 쌓인다). 아래 두 래퍼로 감싸 항상 안전하게 실패하도록 한다.
  function safeStorageSet(obj, cb) {
    noidbSafeStorageSet(obj, cb);
  }

  function safeStorageGet(keys) {
    return noidbSafeStorageGetAsync(keys);
  }

  function safeStorageSetAsync(obj) {
    return noidbSafeStorageSetAsync(obj);
  }

  const COLUMN_DEFS = [
    { key: "division", labels: ["구분"] },
    { key: "orderNo", labels: ["발주/반출번호", "발주반출번호", "발주번호", "반출번호", "번호"] },
    { key: "skuId", labels: ["SKU번호"] },
    { key: "skuName", labels: ["SKU명"] },
    { key: "inboundDate", labels: ["입고/반출일자", "입고반출일자", "입고일자", "반출일자"] },
    { key: "warehouse", labels: ["물류센터"] },
    { key: "quantity", labels: ["수량"] },
  ];

  function normalize(text) {
    return (text || "").replace(/\s+/g, "").trim();
  }

  function buildColumnMap(headerTexts) {
    const normalizedHeaders = headerTexts.map(normalize);
    const map = {};
    for (const def of COLUMN_DEFS) {
      let foundIndex = -1;
      for (const label of def.labels) {
        const idx = normalizedHeaders.indexOf(label);
        if (idx !== -1) {
          foundIndex = idx;
          break;
        }
      }
      if (foundIndex === -1) {
        for (const label of def.labels) {
          const idx = normalizedHeaders.findIndex((h) => h.includes(label));
          if (idx !== -1) {
            foundIndex = idx;
            break;
          }
        }
      }
      if (foundIndex !== -1) map[def.key] = foundIndex;
    }
    return map;
  }

  function getHeaderRow(tableEl) {
    return tableEl.querySelector("thead tr") || tableEl.querySelector("tr");
  }

  function getHeaderCells(headerRow) {
    if (!headerRow) return [];
    return Array.from(headerRow.querySelectorAll("th, td"));
  }

  function getBodyRows(tableEl, headerRow) {
    const tbody = tableEl.querySelector("tbody");
    const rows = tbody
      ? Array.from(tbody.querySelectorAll("tr"))
      : Array.from(tableEl.querySelectorAll("tr"));
    return rows.filter((row) => row !== headerRow && row.querySelector("td"));
  }

  function scanForInboundTable() {
    const tables = Array.from(document.querySelectorAll("table"));
    let best = null;
    let bestScore = 0;
    let bestMap = null;
    let bestHeaderRow = null;
    let bestHeaderTexts = null;

    for (const table of tables) {
      const headerRow = getHeaderRow(table);
      const headerCells = getHeaderCells(headerRow);
      if (headerCells.length === 0) continue;
      const headerTexts = headerCells.map((c) => (c.textContent || "").trim());
      const map = buildColumnMap(headerTexts);
      const score = Object.keys(map).length;
      if (score > bestScore) {
        bestScore = score;
        best = table;
        bestMap = map;
        bestHeaderRow = headerRow;
        bestHeaderTexts = headerTexts;
      }
    }

    if (!best || bestScore < MIN_MATCHED_COLUMNS) {
      return { found: false, bestScore, bestHeaderTexts };
    }

    const rows = getBodyRows(best, bestHeaderRow);
    const parsedRows = rows.map((row) => {
      const cells = Array.from(row.querySelectorAll("td, th")).map((c) =>
        (c.textContent || "").trim()
      );
      const obj = {};
      for (const [key, idx] of Object.entries(bestMap)) {
        obj[key] = cells[idx] ?? null;
      }
      obj.__rawCells = cells; // 매핑 확인/디버깅용 원본 셀 텍스트
      return obj;
    });

    return {
      found: true,
      columnMap: bestMap,
      headerTexts: bestHeaderTexts,
      rowCount: parsedRows.length,
      rows: parsedRows,
    };
  }

  function inboundEventKey(row) {
    return JSON.stringify([
      row?.orderNo ?? null,
      row?.skuId ?? null,
      row?.inboundDate ?? null,
      row?.quantity ?? null,
      row?.division ?? null,
    ]);
  }

  function mergeInboundRows(existingRows, incomingRows) {
    const byKey = new Map();
    for (const row of [...(existingRows || []), ...(incomingRows || [])]) {
      if (!row || typeof row !== "object") continue;
      const key = inboundEventKey(row);
      if (!byKey.has(key)) byKey.set(key, row);
    }
    return [...byKey.values()];
  }

  function readInboundTotalCount() {
    const tables = Array.from(document.querySelectorAll("table"));
    for (const table of tables) {
      const rows = Array.from(table.querySelectorAll("tr"));
      for (let rowIndex = 0; rowIndex < rows.length - 1; rowIndex += 1) {
        const labels = Array.from(rows[rowIndex].querySelectorAll("th, td")).map((cell) => normalize(cell.textContent));
        const countIndex = labels.findIndex((label) => label === "검색건수");
        if (countIndex === -1) continue;
        const value = normalize(rows[rowIndex + 1].querySelectorAll("th, td")[countIndex]?.textContent);
        const count = Number(value.replace(/,/g, ""));
        if (Number.isInteger(count) && count >= 0) return count;
      }
    }
    return null;
  }

  function readInboundUrlPage() {
    const page = Number(new URL(location.href).searchParams.get("page"));
    return Number.isInteger(page) && page > 0 ? page : 1;
  }

  function readInboundUrlTotalCount() {
    const rawValue = new URL(location.href).searchParams.get("totalCount");
    if (!rawValue) return null;
    const value = Number(rawValue);
    return Number.isInteger(value) && value >= 0 ? value : null;
  }

  function navigateInboundToPage(page) {
    const url = new URL(location.href);
    url.searchParams.set("page", String(page));
    if (url.href === location.href) return false;
    location.assign(url.href);
    return true;
  }

  function isVisibleInboundPaginationItem(item) {
    if (!item) return false;
    const style = window.getComputedStyle(item);
    return style.display !== "none" && style.visibility !== "hidden" && item.getClientRects().length > 0;
  }

  function getInboundPaginationRoot() {
    const pageItems = Array.from(document.querySelectorAll(
      'li[data-lp], li.ant-pagination-item, li[class*="ant-pagination-item"]'
    ));
    const roots = [...new Set(pageItems.flatMap((item) => {
      const root = item.closest('ul, ol, nav, [role="navigation"], [class*="pagination"]');
      return root ? [root] : item.parentElement ? [item.parentElement] : [];
    }))];
    return roots.find((root) => root.querySelector(
      'li[data-lp], li.ant-pagination-item, li[class*="ant-pagination-item"]'
    )) || null;
  }

  function getInboundPaginationItems(root) {
    if (!root) return [];
    return Array.from(root.querySelectorAll(
      'li[data-lp], li.ant-pagination-item, li[class*="ant-pagination-item"]'
    )).filter(isVisibleInboundPaginationItem);
  }

  function getInboundPaginationItemPage(item) {
    const dataPage = item?.getAttribute("data-lp");
    if (/^\d+$/.test(dataPage || "")) return Number(dataPage);
    const pageClass = [...(item?.classList || [])].find((name) => /^ant-pagination-item-\d+$/.test(name));
    if (pageClass) return Number(pageClass.replace("ant-pagination-item-", ""));
    const linkText = normalize(item?.querySelector("a, button")?.textContent);
    return /^\d+$/.test(linkText) ? Number(linkText) : null;
  }

  function findInboundNextPageTarget(pagination) {
    const expectedPage = pagination.currentPage + 1;
    const candidates = pagination.pageItems
      .filter((item) => getInboundPaginationItemPage(item) === expectedPage)
      .map((item) => item.querySelector("a, button"))
      .filter(Boolean);
    if (candidates.length === 1) return { link: candidates[0], ambiguous: false };
    if (candidates.length > 1) return { link: null, ambiguous: true };
    return { link: null, ambiguous: false };
  }

  function readInboundPagination() {
    const root = getInboundPaginationRoot();
    const pageItems = getInboundPaginationItems(root);
    const activeItem = pageItems.find((item) => item.classList.contains("ant-pagination-item-active")
      || item.classList.contains("active"));
    const activeLink = activeItem?.querySelector("a, button");
    const currentPage = getInboundPaginationItemPage(activeItem)
      || Number(new URL(location.href).searchParams.get("page")) || 1;
    const nextItem = root?.querySelector("li.ant-pagination-next, .ant-pagination-next, li.next");
    const nextLink = nextItem?.querySelector("a, button");
    const nextButton = nextItem?.querySelector("button");
    const nextDisabled = Boolean(nextItem) && (
      nextItem.getAttribute("aria-disabled") === "true"
      || nextLink?.getAttribute("aria-disabled") === "true"
      || nextItem.classList.contains("disabled")
      || nextLink?.classList.contains("disabled")
      || Boolean(nextButton?.disabled)
    );
    const nextFound = Boolean(nextItem && nextLink);
    const activePage = getInboundPaginationItemPage(activeItem);
    const pagination = { root, pageItems, activeLink, activePage, currentPage, nextLink, nextFound, nextDisabled, nextEnabled: nextFound && !nextDisabled };
    return { ...pagination, nextPageTarget: findInboundNextPageTarget(pagination) };
  }

  function getDateValue(name) {
    return document.querySelector(`input[name="${name}"]`)?.value || "";
  }

  function readInboundRecentDateRange() {
    const startDate = getDateValue("startDate");
    const endDate = getDateValue("endDate");
    const parseDate = (value) => {
      const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
      if (!match) return null;
      const timestamp = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
      const date = new Date(timestamp);
      return date.getUTCFullYear() === Number(match[1])
        && date.getUTCMonth() === Number(match[2]) - 1
        && date.getUTCDate() === Number(match[3])
        ? timestamp
        : null;
    };
    const startTimestamp = parseDate(startDate);
    const endTimestamp = parseDate(endDate);
    const daySpan = startTimestamp != null && endTimestamp != null
      ? (endTimestamp - startTimestamp) / 86400000
      : null;
    return {
      ok: startTimestamp != null && endTimestamp != null
        && startTimestamp < endTimestamp
        && daySpan >= 27 && daySpan <= 32,
      startDate,
      endDate,
      daySpan,
    };
  }

  function waitForInboundPageChange(previousPage, previousKey, expectedPage = null) {
    return new Promise((resolve) => {
      const startedAt = Date.now();
      const check = () => {
        const result = scanForInboundTable();
        const pagination = readInboundPagination();
        const firstKey = result.rows?.[0] ? inboundEventKey(result.rows[0]) : "";
        const pageChanged = expectedPage == null
          ? pagination.currentPage !== previousPage
          : pagination.currentPage === expectedPage;
        if (pageChanged && firstKey !== previousKey) {
          resolve(true);
          return;
        }
        if (Date.now() - startedAt >= 15000) {
          resolve(false);
          return;
        }
        setTimeout(check, 250);
      };
      setTimeout(check, 250);
    });
  }

  async function waitForInboundReady() {
    const startedAt = Date.now();
    while (Date.now() - startedAt < 15000) {
      if (getDateValue("startDate") && getDateValue("endDate")
        && Array.from(document.querySelectorAll("button")).some((button) => normalize(button.textContent) === "최근1달")
        && scanForInboundTable().found) return true;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    return false;
  }

  async function applyInboundDateFilter() {
    let range = readInboundRecentDateRange();
    if (range.ok) return { ...range, changed: false };

    const monthButton = Array.from(document.querySelectorAll("button")).find((button) => normalize(button.textContent) === "최근1달");
    if (!monthButton) return { ok: false, reason: "최근1달 프리셋을 찾지 못함" };
    monthButton.click();
    const startedAt = Date.now();
    while (Date.now() - startedAt < 5000) {
      range = readInboundRecentDateRange();
      if (range.ok) break;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    range = readInboundRecentDateRange();
    if (!range.ok) {
      return { ok: false, reason: "최근1달 적용값 확인 실패" };
    }

    const searchButton = document.querySelector("#formButton");
    if (!searchButton || normalize(searchButton.textContent) !== "검색") return { ok: false, reason: "검색 버튼 확인 실패" };
    searchButton.click();
    await new Promise((resolve) => setTimeout(resolve, 800));
    return { ...range, changed: true };
  }

  let inboundCollectionPromise = null;

  function createInboundRunState(runId) {
    return {
      runId,
      currentPage: 0,
      totalPages: null,
      pageSize: null,
      totalCount: null,
      lastCollectedPage: null,
      expectedNextPage: 1,
      collectedRowCount: 0,
      collectionComplete: false,
      collectionStatus: "running",
      collectionStopReason: null,
      visitedPages: [],
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }

  async function initializeInboundRun(runState) {
    const stored = await safeStorageGet([INBOUND_STORAGE_KEY]);
    const previous = stored[INBOUND_STORAGE_KEY] || {};
    const rows = Array.isArray(previous.rows) ? previous.rows : [];
    const now = new Date().toISOString();
    runState.updatedAt = now;
    await safeStorageSetAsync({
      [INBOUND_STORAGE_KEY]: {
        ...previous,
        rows,
        collectedRowCount: rows.length,
        collectionComplete: false,
        collectionStatus: "running",
        collectionStopReason: null,
        runId: runState.runId,
        expectedNextPage: runState.expectedNextPage,
        visitedPages: [],
        updatedAt: now,
      },
      [INBOUND_COLLECTION_STATE_KEY]: runState,
    });
  }

  async function saveInboundPage(result, pagination, dateFilter, collectionComplete, totalPages, pageSize, runState = null) {
    const stored = await safeStorageGet([INBOUND_STORAGE_KEY, INBOUND_COLLECTION_STATE_KEY]);
    const previous = stored[INBOUND_STORAGE_KEY] || {};
    const rows = mergeInboundRows(previous.rows, result.rows);
    const previousState = stored[INBOUND_COLLECTION_STATE_KEY] || {};
    const stateBase = runState || previousState;
    const visitedPages = runState
      ? [...runState.visitedPages]
      : [...new Set([...(previousState.visitedPages || []), pagination.currentPage])];
    const state = {
      ...stateBase,
      currentPage: pagination.currentPage,
      totalPages: totalPages ?? null,
      pageSize: pageSize || stateBase.pageSize || result.rows.length,
      totalCount: readInboundTotalCount(),
      lastCollectedPage: pagination.currentPage,
      expectedNextPage: stateBase.expectedNextPage ?? null,
      collectedRowCount: rows.length,
      collectionComplete: runState ? collectionComplete : Boolean(previousState.collectionComplete),
      collectionStatus: runState
        ? (collectionComplete ? "complete" : "running")
        : previousState.collectionStatus,
      visitedPages,
      dateStart: dateFilter.startDate,
      dateEnd: dateFilter.endDate,
      updatedAt: new Date().toISOString(),
    };
    await safeStorageSetAsync({
      [INBOUND_STORAGE_KEY]: {
        ...result,
        rows,
        rowCount: result.rows.length,
        collectedRowCount: rows.length,
        totalCount: state.totalCount,
        totalPages: state.totalPages,
        currentPage: state.currentPage,
        collectionComplete: state.collectionComplete,
        collectionStatus: state.collectionStatus,
        visitedPages: state.visitedPages,
        runId: state.runId,
        expectedNextPage: state.expectedNextPage ?? null,
        capturedAt: new Date().toISOString(),
        url: location.href,
      },
      [INBOUND_COLLECTION_STATE_KEY]: state,
    });
    return rows.length;
  }

  async function markInboundCollectionStopped(reason, runState = null) {
    const stored = await safeStorageGet([INBOUND_STORAGE_KEY, INBOUND_COLLECTION_STATE_KEY]);
    const previous = stored[INBOUND_STORAGE_KEY] || {};
    const state = runState || stored[INBOUND_COLLECTION_STATE_KEY] || {};
    const updatedAt = new Date().toISOString();
    await safeStorageSetAsync({
      [INBOUND_STORAGE_KEY]: {
        ...previous,
        collectionComplete: false,
        collectionStatus: "stopped",
        collectionStopReason: reason,
        runId: state.runId,
        updatedAt,
      },
      [INBOUND_COLLECTION_STATE_KEY]: {
        ...state,
        collectionComplete: false,
        collectionStatus: "stopped",
        collectionStopReason: reason,
        updatedAt,
      },
    });
  }

  async function moveInboundToFirstPage() {
    let attempts = 0;
    while (attempts < MAX_INBOUND_PAGES) {
      const pagination = readInboundPagination();
      if (pagination.currentPage === 1) return true;
      const firstPageLink = pagination.pageItems
        .filter((item) => getInboundPaginationItemPage(item) === 1
          && !item.classList.contains("prev")
          && !item.classList.contains("ant-pagination-prev"))
        .map((item) => item.querySelector("a, button"))
        .find(Boolean);
      const previousItem = document.querySelector("li.ant-pagination-prev, .ant-pagination-prev, li.prev");
      const previousLink = previousItem?.querySelector("a, button");
      const link = firstPageLink || previousLink;
      if (!link || previousItem?.classList.contains("disabled")) return false;
      const result = scanForInboundTable();
      const previousKey = result.rows?.[0] ? inboundEventKey(result.rows[0]) : "";
      const previousPage = pagination.currentPage;
      link.click();
      if (!await waitForInboundPageChange(previousPage, previousKey)) return false;
      attempts += 1;
    }
    return false;
  }

  async function runInboundScan(reason) {
    const result = scanForInboundTable();
    if (!result.found) {
      console.log(
        `[NOIDB-POC] inbound detail rows: 조건에 맞는 표를 찾지 못함 (${reason}, ` +
          `최고 매칭 컬럼 수=${result.bestScore}, 후보 헤더=${JSON.stringify(
            result.bestHeaderTexts
          )})`
      );
      return result;
    }

    console.log("[NOIDB-POC] inbound detail rows", result);

    const pagination = readInboundPagination();
    const dateFilter = {
      startDate: getDateValue("startDate"),
      endDate: getDateValue("endDate"),
    };
    await saveInboundPage(result, pagination, dateFilter, false, null);

    return result;
  }

  async function runInboundCollection(runState, options = {}) {
    const isResume = options.resume === true;
    if (!isResume) await initializeInboundRun(runState);

    if (!await waitForInboundReady()) {
      console.warn("[NOIDB-POC] inbound collection stopped: page not ready");
      await markInboundCollectionStopped("입고상세 화면 준비 실패", runState);
      return;
    }
    const dateFilter = await applyInboundDateFilter();
    if (!dateFilter.ok) {
      console.warn("[NOIDB-POC] inbound collection stopped:", dateFilter.reason);
      await markInboundCollectionStopped(dateFilter.reason, runState);
      return;
    }

    const initialPagination = readInboundPagination();
    const currentPage = readInboundUrlPage();
    if (initialPagination.activePage != null && initialPagination.activePage !== currentPage) {
      await markInboundCollectionStopped(
        `URL 페이지와 pagination 현재 페이지 불일치: URL ${currentPage}, DOM ${initialPagination.activePage}`,
        runState
      );
      return;
    }
    const expectedNextPage = Number.isInteger(runState.expectedNextPage)
      ? runState.expectedNextPage
      : (Number.isInteger(runState.lastCollectedPage) ? runState.lastCollectedPage + 1 : 1);
    runState.expectedNextPage = expectedNextPage;
    if (!isResume) {
      if (currentPage !== 1) {
        runState.expectedNextPage = 1;
        if (!navigateInboundToPage(1)) {
          await markInboundCollectionStopped("1페이지 URL 이동 실패", runState);
        }
        return;
      }
    } else if (currentPage !== expectedNextPage) {
      const canAdvanceFromVisitedPage = currentPage === runState.currentPage
        && runState.visitedPages.includes(currentPage);
      if (!canAdvanceFromVisitedPage || expectedNextPage !== currentPage + 1) {
        await markInboundCollectionStopped(
          `재개 페이지 불일치: 현재 ${currentPage}, 다음 ${expectedNextPage}`,
          runState
        );
        return;
      }
      if (!navigateInboundToPage(expectedNextPage)) {
        await markInboundCollectionStopped("재개할 다음 페이지 URL 이동 실패", runState);
        return;
      }
      return;
    }

    let pageCount = runState.visitedPages.length;
    let lastPage = runState.visitedPages.length ? Math.max(...runState.visitedPages) : 0;
    let pageSize = runState.pageSize || null;
    while (pageCount < MAX_INBOUND_PAGES) {
      const result = scanForInboundTable();
      if (!result.found) {
        await new Promise((resolve) => setTimeout(resolve, 500));
        continue;
      }
      const pagination = readInboundPagination();
      const urlPage = readInboundUrlPage();
      if (pagination.activePage != null && pagination.activePage !== urlPage) {
        await markInboundCollectionStopped(
          `URL 페이지와 pagination 현재 페이지 불일치: URL ${urlPage}, DOM ${pagination.activePage}`,
          runState
        );
        return;
      }
      if (urlPage <= lastPage) {
        console.warn("[NOIDB-POC] inbound collection stopped: pagination did not advance");
        await markInboundCollectionStopped("페이지 번호가 증가하지 않음", runState);
        return;
      }
      if (runState.visitedPages.includes(urlPage)) {
        await markInboundCollectionStopped(`동일 페이지 재방문 감지: ${urlPage}`, runState);
        return;
      }
      const totalCount = readInboundUrlTotalCount() ?? readInboundTotalCount();
      pageSize = pageSize || result.rows.length || null;
      const totalPages = totalCount != null && pageSize ? Math.ceil(totalCount / pageSize) : null;
      if (!totalPages) {
        await markInboundCollectionStopped("총 페이지 계산 실패", runState);
        return;
      }
      if (urlPage > totalPages) {
        await markInboundCollectionStopped(`총 페이지 초과: 현재 ${urlPage}, 총 ${totalPages}`, runState);
        return;
      }
      const reachedLast = urlPage >= totalPages;
      pageCount += 1;
      lastPage = urlPage;
      runState.currentPage = urlPage;
      runState.totalPages = totalPages;
      runState.pageSize = pageSize;
      runState.totalCount = totalCount;
      runState.lastCollectedPage = urlPage;
      runState.visitedPages = [...runState.visitedPages, urlPage];
      runState.expectedNextPage = reachedLast ? null : urlPage + 1;
      await saveInboundPage(result, pagination, dateFilter, false, totalPages, pageSize, runState);

      if (reachedLast) {
        runState.collectionComplete = true;
        runState.collectionStatus = "complete";
        const collected = await saveInboundPage(result, pagination, dateFilter, true, totalPages, pageSize, runState);
        console.log("[NOIDB-POC] inbound collection complete", { totalCount, totalPages, collected });
        return;
      }

      if (!navigateInboundToPage(runState.expectedNextPage)) {
        await markInboundCollectionStopped("다음 페이지 URL 이동 실패", runState);
        return;
      }
      return;
    }
    console.warn("[NOIDB-POC] inbound collection stopped: page safety limit reached", MAX_INBOUND_PAGES);
    await markInboundCollectionStopped(`페이지 안전 상한 ${MAX_INBOUND_PAGES} 초과`, runState);
  }

  function trackInboundCollection(runState, options = {}) {
    inboundCollectionPromise = runInboundCollection(runState, options)
      .catch(async (error) => {
        const reason = error instanceof Error ? error.message : "알 수 없는 수집 오류";
        console.warn("[NOIDB-POC] inbound collection error:", error);
        await markInboundCollectionStopped(reason, runState);
      })
      .finally(() => {
        inboundCollectionPromise = null;
      });
  }

  function startInboundCollection() {
    if (!location.pathname.includes("/scm/receive/detail")) {
      return { ok: false, reason: "입고상세 화면이 아닙니다." };
    }
    if (inboundCollectionPromise) {
      return { ok: false, reason: "전체수집이 이미 실행 중입니다." };
    }
    const runId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const runState = createInboundRunState(runId);
    trackInboundCollection(runState);
    return { ok: true, runId };
  }

  async function resumeInboundCollectionIfActive() {
    if (!location.pathname.includes("/scm/receive/detail") || inboundCollectionPromise) return;
    const stored = await safeStorageGet([INBOUND_COLLECTION_STATE_KEY]);
    const savedState = stored[INBOUND_COLLECTION_STATE_KEY];
    if (savedState?.collectionStatus !== "running" || !savedState.runId) return;
    if (inboundCollectionPromise) return;
    const runState = {
      ...savedState,
      visitedPages: Array.isArray(savedState.visitedPages) ? [...savedState.visitedPages] : [],
    };
    console.log("[NOIDB-POC] resuming inbound collection", {
      runId: runState.runId,
      currentPage: runState.currentPage,
      expectedNextPage: runState.expectedNextPage,
    });
    trackInboundCollection(runState, { resume: true });
  }

  resumeInboundCollectionIfActive().catch((error) => {
    console.warn("[NOIDB-POC] inbound collection resume check failed:", error);
  });

  noidbSafeAddRuntimeMessageListener((message, _sender, sendResponse) => {
    if (message?.type === "NOIDB_POC_START_INBOUND_COLLECTION") {
      try {
        const result = startInboundCollection();
        sendResponse(result.ok
          ? { ok: true, started: true, runId: result.runId }
          : result);
      } catch (error) {
        sendResponse({ ok: false, reason: error instanceof Error ? error.message : "전체수집 시작 실패" });
      }
      return false;
    }
    if (message?.type === "NOIDB_POC_RESCAN") {
      try {
        runInboundScan("manual-rescan").then((result) => {
          sendResponse({ ok: true, found: result.found, rowCount: result.rowCount || 0 });
        }).catch((error) => {
          sendResponse({ ok: false, error: String(error) });
        });
      } catch (e) {
        console.warn("[NOIDB-POC] NOIDB_POC_RESCAN 처리 중 오류:", e);
        try {
          sendResponse({ ok: false, error: String(e) });
        } catch {
          // 메시지 포트가 이미 닫혔을 수 있음 — 무시
        }
      }
      return true;
    }
    return undefined;
  });
})();

// 신규 발주 원본 수집: 발주 SKU 리스트의 현재 화면을 읽고, page query로
// 다음 화면을 이동한다. 기존 발주리스트/입고상세 수집기와 저장 키를 공유하지 않는다.
(() => {
  const LINES_KEY = "noidbPocPurchaseOrderLines";
  const STATE_KEY = "noidbPocPurchaseOrderLinesState";
  const DIAGNOSTIC_KEY = "noidbPocPurchaseOrderLinesDiagnostics";
  const PROBE_STATE_KEY = "noidbPocPurchaseOrderLinesProbeState";
  const SKU_LIST_PATH = "/scm/purchase/order/sku/list";
  const API_ENDPOINT = "https://noidb-os.vercel.app/api/wms/vendor-orders/supplier-hub-order-lines";
  const MAX_PAGES = 150;
  let collectionPromise = null;

  const text = (value) => typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
  const headerText = (value) => text(value).replace(/\s+/g, "");
  const lineKey = (line) => JSON.stringify([line?.orderNo || "", line?.skuId || ""]);
  const sameLine = (left, right) => JSON.stringify(left) === JSON.stringify(right);

  function currentPage() {
    const value = Number(new URL(location.href).searchParams.get("page"));
    return Number.isInteger(value) && value > 0 ? value : 1;
  }

  function totalCount() {
    const fromUrl = Number(new URL(location.href).searchParams.get("totalCount"));
    if (Number.isInteger(fromUrl) && fromUrl >= 0) return fromUrl;
    const body = document.body?.innerText || "";
    const match = body.match(/(?:검색결과|검색건수|전체)\s*[:：]?\s*([\d,]+)\s*건/);
    const value = Number((match?.[1] || "").replace(/,/g, ""));
    return Number.isInteger(value) && value >= 0 ? value : null;
  }

  function headerIndex(headers, labels) {
    return labels.map(headerText).reduce((found, label) => {
      if (found !== -1) return found;
      const exact = headers.findIndex(header => header === label);
      return exact !== -1 ? exact : headers.findIndex(header => header.includes(label));
    }, -1);
  }

  function normalizeExpectedDate(value) {
    const raw = text(value);
    if (!raw) return "";
    const match = raw.match(/(\d{4})[./-](\d{1,2})[./-](\d{1,2})/);
    if (!match) return "";
    return `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
  }

  function parseConfirmedQuantity(value) {
    const raw = text(value).replace(/,/g, "");
    if (!/^\d+$/.test(raw)) return null;
    const parsed = Number(raw);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
  }

  function scanSkuTable() {
    let best = null;
    for (const table of Array.from(document.querySelectorAll("table"))) {
      const headerRows = table.tHead ? Array.from(table.tHead.rows) : Array.from(table.querySelectorAll("tr")).slice(0, 2);
      const headerRow = headerRows[headerRows.length - 1];
      const headers = Array.from(headerRow?.querySelectorAll("th, td") || []).map(cell => headerText(cell.textContent));
      if (!headers.length) continue;
      const indexes = {
        orderNo: headerIndex(headers, ["발주번호", "발주/반출번호", "번호"]),
        skuId: headerIndex(headers, ["SKU ID", "SKU번호"]),
        confirmedOrderQuantity: headerIndex(headers, ["확정 발주수량", "확정수량"]),
        skuName: headerIndex(headers, ["SKU명", "상품명"]),
        expectedDate: headerIndex(headers, ["입고예정일", "입고예정일시"]),
        warehouse: headerIndex(headers, ["물류센터", "물류센터명"]),
        purchaseType: headerIndex(headers, ["발주유형"]),
      };
      const bodyRows = Array.from(table.tBodies?.[0]?.rows || table.querySelectorAll("tr")).filter(row => row !== headerRow);
      const allRows = bodyRows.map(row => {
        const cells = Array.from(row.querySelectorAll("td, th")).map(cell => text(cell.textContent));
        const rawQuantity = cells[indexes.confirmedOrderQuantity] || "";
        const quantity = parseConfirmedQuantity(rawQuantity);
        const rawExpectedDate = cells[indexes.expectedDate] || "";
        return {
          orderNo: cells[indexes.orderNo] || "",
          skuId: cells[indexes.skuId] || "",
          confirmedOrderQuantity: quantity,
          skuName: cells[indexes.skuName] || "",
          expectedDate: normalizeExpectedDate(rawExpectedDate),
          warehouse: cells[indexes.warehouse] || "",
          purchaseType: cells[indexes.purchaseType] || "",
          __rawConfirmedOrderQuantity: rawQuantity,
          __rawExpectedDate: rawExpectedDate,
          ...(quantity == null ? { sourceIssue: "확정 발주수량 확인 필요" } : {}),
        };
      });
      const lines = allRows.filter(line => line.orderNo && line.skuId);
      const score = Object.values(indexes).filter(index => index >= 0).length;
      if (!best || score > best.score || (score === best.score && lines.length > best.lines.length)) {
        best = { lines, allRows, headers, indexes, score };
      }
    }
    return best || { lines: [], allRows: [], headers: [], indexes: {}, score: 0 };
  }

  function readNavigationClues(element) {
    const clues = [];
    const push = (kind, value) => {
      const normalized = text(value);
      if (!normalized || normalized === "#" || normalized.toLowerCase().startsWith("javascript:")) return;
      if (!clues.some(clue => clue.kind === kind && clue.value === normalized)) clues.push({ kind, value: normalized });
    };

    for (const attr of Array.from(element?.attributes || [])) {
      if (/^(href|data-(?:href|url|path|route|link|target|detail|order|sku)|onclick)$/i.test(attr.name)) {
        push(attr.name, attr.value);
      }
    }
    const anchor = element.matches?.("a") ? element : element.querySelector?.("a[href], a[data-href], a[data-url]");
    if (anchor) push("href", anchor.href || anchor.getAttribute("href"));
    return clues;
  }

  function scanPurchaseOrderSurface() {
    const surfaces = Array.from(document.querySelectorAll("table, [role='table'], [role='grid']"));
    const surfaceCandidates = [];
    let best = null;
    for (const surface of surfaces) {
      const rows = Array.from(surface.querySelectorAll("tr, [role='row']"));
      if (!rows.length) continue;
      const headerCandidates = Array.from(surface.querySelectorAll("thead tr, thead [role='row'], [role='row']"));
      if (!headerCandidates.length) headerCandidates.push(rows[0]);
      const headerRow = headerCandidates
        .map(row => ({ row, cells: Array.from(row.querySelectorAll("th, td, [role='columnheader']")) }))
        .filter(candidate => candidate.cells.length)
        .sort((left, right) => {
          const leftHeaders = left.cells.map(cell => text(cell.textContent));
          const rightHeaders = right.cells.map(cell => text(cell.textContent));
          const leftScore = headerIndex(leftHeaders, ["발주번호"]) >= 0 ? 10 : 0;
          const rightScore = headerIndex(rightHeaders, ["발주번호"]) >= 0 ? 10 : 0;
          return rightScore + right.cells.length - leftScore - left.cells.length;
        })[0]?.row || rows[0];
      const headerCells = headerRow.matches?.("th, td, [role='columnheader']")
        ? [headerRow]
        : Array.from(headerRow.querySelectorAll("th, td, [role='columnheader']"));
      const headers = headerCells
        .map(cell => text(cell.textContent));
      if (!headers.length) continue;

      const indexes = {
        orderNo: headerIndex(headers, ["발주번호"]),
        skuId: headerIndex(headers, ["SKU ID", "SKU번호"]),
        confirmedOrderQuantity: headerIndex(headers, ["확정 발주수량", "확정수량"]),
        skuName: headerIndex(headers, ["SKU명", "상품명"]),
        expectedDate: headerIndex(headers, ["입고예정일", "입고예정일시"]),
        warehouse: headerIndex(headers, ["물류센터", "물류센터명"]),
        purchaseType: headerIndex(headers, ["발주유형"]),
      };
      const bodyRows = rows.filter(row => row !== headerRow && !row.querySelector("th") && row.querySelectorAll("td, [role='gridcell'], [role='cell']").length);
      const rowRecords = bodyRows.map(row => {
        const cells = Array.from(row.querySelectorAll("td, th, [role='gridcell'], [role='cell']"))
          .map(cell => text(cell.textContent));
        const orderNo = indexes.orderNo >= 0 ? cells[indexes.orderNo] || "" : "";
        const links = Array.from(row.querySelectorAll("a, button, [role='button']"))
          .flatMap(element => readNavigationClues(element).map(clue => ({ ...clue, text: text(element.textContent), orderNo })));
        const rowClues = readNavigationClues(row).map(clue => ({ ...clue, text: "", orderNo }));
        return {
          orderNo,
          skuId: indexes.skuId >= 0 ? cells[indexes.skuId] || "" : "",
          confirmedOrderQuantity: indexes.confirmedOrderQuantity >= 0 ? cells[indexes.confirmedOrderQuantity] || "" : "",
          skuName: indexes.skuName >= 0 ? cells[indexes.skuName] || "" : "",
          expectedDate: indexes.expectedDate >= 0 ? cells[indexes.expectedDate] || "" : "",
          warehouse: indexes.warehouse >= 0 ? cells[indexes.warehouse] || "" : "",
          purchaseType: indexes.purchaseType >= 0 ? cells[indexes.purchaseType] || "" : "",
          navigationClues: [...links, ...rowClues],
        };
      });
      const surfaceClues = Array.from(surface.querySelectorAll("a, button, [role='button']"))
        .flatMap(element => readNavigationClues(element).map(clue => ({ ...clue, text: text(element.textContent), orderNo: "" })));
      const navigationCandidates = [...rowRecords.flatMap(row => row.navigationClues), ...surfaceClues]
        .filter(clue => {
          const haystack = `${clue.value} ${clue.text}`.toLowerCase();
          return Boolean(clue.orderNo) || /detail|sku|order|purchase|po|발주|상세|sku/i.test(haystack);
        })
        .filter((clue, index, all) => all.findIndex(candidate => candidate.kind === clue.kind && candidate.value === clue.value) === index)
        .slice(0, 30);
      const rowOrderNoCount = rowRecords.filter(row => row.orderNo).length;
      const score = (indexes.orderNo >= 0 ? 10 : 0) + rowOrderNoCount * 2 + navigationCandidates.length;
      const candidate = {
        surfaceType: surface.matches("table") ? "table" : "aria-grid",
        headers,
        indexes,
        rows: rowRecords,
        navigationCandidates,
        score,
      };
      surfaceCandidates.push(candidate);
      if (!best || candidate.score > best.score) best = candidate;
    }
    return best
      ? { ...best, surfaceCandidates }
      : { surfaceType: null, headers: [], indexes: {}, rows: [], navigationCandidates: [], surfaceCandidates: [], score: 0 };
  }

  function scanLabeledValues() {
    const labels = {
      orderNo: ["발주번호"],
      skuId: ["SKU ID", "SKU번호"],
      confirmedOrderQuantity: ["확정 발주수량", "확정수량"],
      skuName: ["SKU명", "상품명"],
      expectedDate: ["입고예정일", "입고예정일시"],
      warehouse: ["물류센터", "물류센터명"],
      purchaseType: ["발주유형"],
    };
    const result = {};
    for (const element of Array.from(document.querySelectorAll("dt, label, [aria-label]"))) {
      const label = headerText(element.getAttribute("aria-label") || element.textContent);
      const field = Object.keys(labels).find(key => labels[key].some(value => label === headerText(value)));
      if (!field || result[field]) continue;
      const valueElement = element.matches("dt, label") ? element.nextElementSibling : element;
      const value = text(valueElement?.textContent || "");
      if (value && headerText(value) !== label) result[field] = value;
    }
    return result;
  }

  function safeReadOnlyCandidate(candidate) {
    if (!candidate?.value || candidate.kind === "onclick") return null;
    let candidateUrl;
    try { candidateUrl = new URL(candidate.value, location.href); } catch { return null; }
    if (candidateUrl.origin !== location.origin || !/^https?:$/.test(candidateUrl.protocol)) return null;
    const currentPath = location.pathname.replace(/\/+$/, "") || "/";
    const candidatePath = candidateUrl.pathname.replace(/\/+$/, "") || "/";
    if (candidateUrl.href === location.href || candidatePath === currentPath) return null;
    const haystack = `${candidateUrl.pathname} ${candidateUrl.search} ${candidate.text || ""}`.toLowerCase();
    if (/confirm|approve|modify|edit|cancel|delete|remove|save|submit|send|transfer|update|create|reject|확정|수정|취소|삭제|저장|전송|등록|승인|반려/.test(haystack)) return null;
    if (!/detail|sku|product|item|purchase|order|po|발주|상세|상품|품목/i.test(haystack)) return null;
    return { ...candidate, url: candidateUrl.href };
  }

  function detailCandidatesFromDiagnostic(diagnostic) {
    return Array.isArray(diagnostic?.detailLinkCandidates)
      ? diagnostic.detailLinkCandidates
      : Array.isArray(diagnostic?.navigationCandidates) ? diagnostic.navigationCandidates : [];
  }

  function scanDetailSkuSource(probe) {
    const scanned = scanPurchaseOrderSurface();
    const candidates = scanned.surfaceCandidates
      .filter(candidate => candidate.indexes.skuId >= 0 || candidate.indexes.confirmedOrderQuantity >= 0)
      .sort((left, right) => {
        const leftScore = (left.indexes.skuId >= 0 ? 10 : 0) + (left.indexes.confirmedOrderQuantity >= 0 ? 10 : 0) + left.rows.length;
        const rightScore = (right.indexes.skuId >= 0 ? 10 : 0) + (right.indexes.confirmedOrderQuantity >= 0 ? 10 : 0) + right.rows.length;
        return rightScore - leftScore;
      });
    const surface = candidates[0] || scanned;
    const cardFields = scanLabeledValues();
    const fallbackOrderNo = text(probe?.orderNo) || cardFields.orderNo || "";
    const rows = (surface.rows || []).map(row => ({
      ...row,
      orderNo: row.orderNo || fallbackOrderNo,
      skuId: row.skuId || "",
      confirmedOrderQuantity: row.confirmedOrderQuantity || "",
      expectedDate: row.expectedDate || cardFields.expectedDate || "",
    }));
    const validRows = rows.filter(row => row.skuId);
    const fieldChecks = {
      orderNo: Boolean(fallbackOrderNo || rows.some(row => row.orderNo)),
      skuId: surface.indexes.skuId >= 0 && validRows.length > 0,
      confirmedOrderQuantity: surface.indexes.confirmedOrderQuantity >= 0,
      expectedDate: surface.indexes.expectedDate >= 0 || Boolean(cardFields.expectedDate),
      skuName: surface.indexes.skuName >= 0,
      warehouse: surface.indexes.warehouse >= 0 || Boolean(cardFields.warehouse),
      purchaseType: surface.indexes.purchaseType >= 0 || Boolean(cardFields.purchaseType),
    };
    const mappedHeaders = Object.fromEntries(Object.keys(fieldChecks).map(field => [
      field,
      surface.indexes[field] >= 0 ? surface.headers[surface.indexes[field]] : (cardFields[field] ? "화면 label/value" : null),
    ]));
    const samples = validRows.slice(0, 3).map(row => {
      const parsedQuantity = parseConfirmedQuantity(row.confirmedOrderQuantity);
      const parsedExpectedDate = normalizeExpectedDate(row.expectedDate);
      const expectedDateMatch = !fieldChecks.expectedDate || parsedExpectedDate === normalizeExpectedDate(row.expectedDate);
      return {
        orderNo: row.orderNo,
        screenSkuId: row.skuId,
        parsedSkuId: text(row.skuId),
        skuIdMatch: Boolean(row.skuId && text(row.skuId) === row.skuId),
        screenQuantity: row.confirmedOrderQuantity,
        parsedConfirmedOrderQuantity: parsedQuantity,
        quantityMatch: parsedQuantity != null && parsedQuantity > 0,
        screenExpectedDate: row.expectedDate,
        parsedExpectedDate,
        expectedDateMatch,
      };
    });
    const sampleMatchCount = samples.filter(sample => sample.skuIdMatch && sample.quantityMatch && sample.expectedDateMatch).length;
    const sourceSkuScreenCheck = fieldChecks.orderNo && fieldChecks.skuId && fieldChecks.confirmedOrderQuantity;
    const ready = sourceSkuScreenCheck && samples.length === 3 && sampleMatchCount === 3;
    return {
      status: ready ? "complete" : "stopped",
      capturedAt: new Date().toISOString(),
      url: location.href,
      surfaceType: surface.surfaceType || null,
      headers: surface.headers || [],
      mappedHeaders,
      fieldChecks,
      sourceSkuScreenCheck,
      expectedDateAvailable: fieldChecks.expectedDate,
      samples,
      sampleCount: samples.length,
      sampleMatchCount,
      collectableSkuCount: validRows.filter(row => parseConfirmedQuantity(row.confirmedOrderQuantity) != null).length,
      reason: ready ? null : "상세/SKU 화면에서 발주번호·SKU ID·확정 발주수량 3건 검증 실패",
      nextTechnicalAction: ready ? "원본 위치 검증 완료" : "상세/SKU 화면의 실제 원본 필드 추가 확인 필요",
    };
  }

  function collectDetailStructureDiagnostics() {
    const normalizePath = (value) => {
      try {
        const url = new URL(value, location.href);
        return { origin: url.origin, path: url.pathname, sameOrigin: url.origin === location.origin };
      } catch { return null; }
    };
    const sameOriginResources = Array.from(performance.getEntriesByType("resource"))
      .map(entry => normalizePath(entry.name))
      .filter(entry => entry?.sameOrigin)
      .map(entry => `${entry.origin}${entry.path}`)
      .filter((value, index, all) => all.indexOf(value) === index)
      .slice(0, 80);
    const iframeUrls = Array.from(document.querySelectorAll("iframe[src]"))
      .map(frame => normalizePath(frame.src))
      .filter(Boolean)
      .map(entry => ({ url: `${entry.origin}${entry.path}`, sameOrigin: entry.sameOrigin }))
      .filter((entry, index, all) => all.findIndex(candidate => candidate.url === entry.url) === index)
      .slice(0, 20);
    const tabsOrSections = Array.from(document.querySelectorAll("[role='tab'], details > summary, button, [role='button']"))
      .map(element => ({
        text: text(element.textContent).slice(0, 100),
        role: element.getAttribute("role") || element.tagName.toLowerCase(),
        selected: element.getAttribute("aria-selected"),
        expanded: element.getAttribute("aria-expanded"),
        disabled: element.disabled === true || element.getAttribute("aria-disabled") === "true",
      }))
      .filter(entry => entry.text && /조회|상세|상품|SKU|품목|발주|입고|예약|order|sku|product|item/i.test(entry.text))
      .slice(0, 40);
    const collapsedSections = Array.from(document.querySelectorAll("[hidden], details:not([open]), [aria-expanded='false']"))
      .map(element => text(element.textContent).slice(0, 120))
      .filter(Boolean)
      .slice(0, 30);
    const detailSurfaceTypes = [
      ...Array.from(document.querySelectorAll("table")).map(() => "table"),
      ...Array.from(document.querySelectorAll("[role='grid']")).map(() => "aria-grid"),
      ...Array.from(document.querySelectorAll("[role='table']")).map(() => "aria-table"),
      ...Array.from(document.querySelectorAll("dl, [role='list'], [role='listitem']")).map(() => "card/list"),
      ...iframeUrls.map(() => "iframe"),
    ].filter((value, index, all) => all.indexOf(value) === index);
    const knownFieldTokens = ["orderNo", "poId", "skuId", "skuName", "confirmedOrderQuantity", "expectedDate", "warehouse", "purchaseType"];
    const jsonScriptHints = Array.from(document.querySelectorAll("script[type='application/json'], script#__NEXT_DATA__"))
      .map(script => {
        const raw = script.textContent || "";
        return {
          id: script.id || "",
          type: script.type || "",
          detectedFields: knownFieldTokens.filter(field => raw.includes(field)),
        };
      })
      .filter(entry => entry.detectedFields.length)
      .slice(0, 20);
    const readOnlyResourceCandidates = sameOriginResources
      .filter(url => /detail|purchase|order|sku|product|item|api|query/i.test(url))
      .filter(url => !/confirm|approve|modify|edit|cancel|delete|save|submit|send|update|create/i.test(url));
    return {
      detailSurfaceTypes,
      iframeUrls,
      tabsOrSections,
      collapsedSections,
      observedResourceUrls: sameOriginResources,
      observedRequestMethods: ["document navigation GET", "resource method unavailable from PerformanceResourceTiming; no request replayed"],
      readOnlyResourceCandidates,
      jsonScriptHints,
      detectedResponseFields: [...new Set(jsonScriptHints.flatMap(entry => entry.detectedFields))],
      detectedReadOnlyDataSource: readOnlyResourceCandidates[0] || (jsonScriptHints.length ? "application/json page state" : null),
    };
  }

  function readOnlyDetailTabCandidate() {
    const blocked = /확정|수정|취소|삭제|저장|전송|등록|승인|반려|confirm|approve|modify|edit|cancel|delete|save|submit|send|update/i;
    const allowed = /조회|상세|상품|SKU|품목|발주내역|입고내역|order|detail|product|item|sku/i;
    return Array.from(document.querySelectorAll("[role='tab']"))
      .map(element => ({ element, text: text(element.textContent), selected: element.getAttribute("aria-selected"), disabled: element.disabled === true || element.getAttribute("aria-disabled") === "true" }))
      .find(candidate => !candidate.disabled && candidate.selected !== "true" && allowed.test(candidate.text) && !blocked.test(candidate.text)) || null;
  }

  async function probeDetailPage(probe) {
    let structure = collectDetailStructureDiagnostics();
    let detail = scanDetailSkuSource(probe);
    let clickedReadOnlyTab = null;
    if (!detail.sourceSkuScreenCheck) {
      const tab = readOnlyDetailTabCandidate();
      if (tab) {
        clickedReadOnlyTab = tab.text;
        tab.element.click();
        await new Promise(resolve => setTimeout(resolve, 800));
        structure = collectDetailStructureDiagnostics();
        detail = scanDetailSkuSource(probe);
      }
    }
    return {
      ...detail,
      ...structure,
      clickedReadOnlyTab,
      finalSourceLocation: detail.sourceSkuScreenCheck ? `${location.origin}${location.pathname} (${detail.surfaceType || "detail surface"})` : structure.detectedReadOnlyDataSource,
      sourceSkuRows: detail.samples,
      sourceQuantityField: detail.mappedHeaders.confirmedOrderQuantity || null,
      sourceSkuIdField: detail.mappedHeaders.skuId || null,
      sampleValidation: { count: detail.sampleCount, matched: detail.sampleMatchCount, ok: detail.status === "complete" },
      diagnosticErrors: detail.reason ? [detail.reason] : [],
    };
  }

  async function diagnoseSkuTable() {
    const result = scanPurchaseOrderSurface();
    const url = new URL(location.href);
    const normalizedPath = url.pathname.replace(/\/+$/, "") || "/";
    const urlCheck = url.hostname === "supplier.coupang.com";
    const fields = ["orderNo", "skuId", "confirmedOrderQuantity", "skuName", "expectedDate", "warehouse", "purchaseType"];
    const fieldChecks = Object.fromEntries(fields.map(field => [field, result.indexes[field] >= 0]));
    const mappedHeaders = Object.fromEntries(fields.map(field => [field, result.indexes[field] >= 0 ? result.headers[result.indexes[field]] : null]));
    const sampleRows = result.rows.filter(row => row.orderNo).slice(0, 3);
    const samples = sampleRows.map(row => {
      const parsedQuantity = parseConfirmedQuantity(row.confirmedOrderQuantity);
      const parsedExpectedDate = normalizeExpectedDate(row.expectedDate);
      const quantityMatch = !fieldChecks.confirmedOrderQuantity || (parsedQuantity != null && parsedQuantity > 0);
      const expectedDateMatch = !fieldChecks.expectedDate || (Boolean(parsedExpectedDate) && parsedExpectedDate === normalizeExpectedDate(row.expectedDate));
      return {
        orderNo: row.orderNo,
        skuId: row.skuId,
        screenQuantity: row.confirmedOrderQuantity,
        parsedConfirmedOrderQuantity: parsedQuantity,
        quantityMatch,
        screenExpectedDate: row.expectedDate,
        parsedExpectedDate,
        expectedDateMatch,
        navigationClues: row.navigationClues,
      };
    });
    const invalidQuantityCount = fieldChecks.confirmedOrderQuantity
      ? result.rows.filter(row => row.orderNo && parseConfirmedQuantity(row.confirmedOrderQuantity) == null).length
      : 0;
    const sampleMatchCount = samples.filter(sample => sample.quantityMatch && sample.expectedDateMatch).length;
    const headerCheck = fields.every(field => fieldChecks[field]);
    const requiredFields = ["orderNo", "skuId", "confirmedOrderQuantity", "expectedDate"];
    const requiredHeaderCount = requiredFields.filter(field => fieldChecks[field]).length;
    const tableCheck = result.score > 0 && result.rows.length > 0;
    const orderNoCheck = fieldChecks.orderNo && result.rows.some(row => row.orderNo);
    const detailPathCheck = result.navigationCandidates.some(candidate => {
      const haystack = `${candidate.value} ${candidate.text}`.toLowerCase();
      return /detail|sku|order|purchase|po|발주|상세/i.test(haystack)
        || (candidate.orderNo && candidate.value.includes(candidate.orderNo));
    });
    const directSkuDataCheck = requiredHeaderCount === requiredFields.length;
    const sampleCheck = directSkuDataCheck && samples.length === 3 && sampleMatchCount === 3 && invalidQuantityCount === 0;
    const readyToCollect = orderNoCheck && detailPathCheck && directSkuDataCheck && sampleCheck;
    const nextTechnicalAction = readyToCollect
      ? "현재 화면의 원본 SKU 필드 수집 준비 완료"
      : !orderNoCheck
        ? "발주번호 열/행 구조 확인 필요"
        : !detailPathCheck
          ? "발주번호 행의 조회성 상세/SKU 이동 단서 확인 필요"
          : !directSkuDataCheck
            ? "발견된 조회성 상세/SKU 후보 화면에서 원본 SKU 헤더 확인 필요"
            : "확정 발주수량 또는 입고예정일 샘플 확인 필요";
    const investigationItemCount = [!orderNoCheck, !detailPathCheck, !fieldChecks.skuId, !fieldChecks.confirmedOrderQuantity, !fieldChecks.expectedDate, !sampleCheck]
      .filter(Boolean).length;
    const ok = urlCheck && tableCheck && orderNoCheck;
    const diagnostic = {
      capturedAt: new Date().toISOString(),
      url: location.href,
      urlCheck,
      normalizedPath,
      expectedPath: SKU_LIST_PATH,
      pathMatch: normalizedPath === SKU_LIST_PATH.replace(/\/+$/, ""),
      tableCheck,
      orderListRecognized: ok,
      orderNoCheck,
      detailPathCheck,
      directSkuDataCheck,
      readyToCollect,
      finalResult: readyToCollect ? "수집 준비 완료" : `자동 조사 필요 항목 ${investigationItemCount}개`,
      nextTechnicalAction,
      surfaceType: result.surfaceType,
      headers: result.headers,
      mappedHeaders,
      columnMap: result.indexes,
      fieldChecks,
      headerCheck: { ok: headerCheck, expectedFieldCount: fields.length, foundFieldCount: fields.filter(field => fieldChecks[field]).length },
      requiredHeaderCount,
      requiredHeaderTotal: requiredFields.length,
      samples,
      sampleCount: samples.length,
      sampleMatchCount,
      collectableSkuCount: directSkuDataCheck
        ? result.rows.filter(row => row.orderNo && row.skuId && parseConfirmedQuantity(row.confirmedOrderQuantity) != null).length
        : 0,
      errorCount: (headerCheck ? 0 : fields.filter(field => !fieldChecks[field]).length) + invalidQuantityCount,
      invalidQuantityCount,
      navigationCandidates: result.navigationCandidates,
      detailLinkCandidates: result.navigationCandidates,
      orderRows: result.rows.slice(0, 3),
      recent30: {
        existingOrderListFilterApplied: false,
        note: "이번 진단은 현재 발주목록 화면만 읽으며 기존 최근30일 흐름은 변경하지 않음",
        startDate: url.searchParams.get("startDate") || "",
        endDate: url.searchParams.get("endDate") || "",
      },
      pagination: {
        currentPage: currentPage(),
        totalCount: totalCount(),
        pageSize: result.rows.length,
        totalPages: result.rows.length && totalCount() != null ? Math.ceil(totalCount() / result.rows.length) : null,
        usesUrlPageQuery: url.searchParams.has("page"),
        usesUrlTotalCount: url.searchParams.has("totalCount"),
      },
      reloadResume: {
        stateKey: STATE_KEY,
        activeRun: false,
        note: "이번 진단은 수집 run을 시작하거나 재개하지 않음",
      },
      ok,
      reason: ok ? null : "Supplier Hub 발주목록 표 또는 발주번호 행 확인 실패",
    };
    await noidbSafeStorageSetAsync({ [DIAGNOSTIC_KEY]: diagnostic });
    return diagnostic;
  }

  async function waitForTable() {
    const startedAt = Date.now();
    while (Date.now() - startedAt < 15000) {
      if (location.pathname === SKU_LIST_PATH) {
        const result = scanSkuTable();
        const hasCoreHeaders = ["orderNo", "skuId", "confirmedOrderQuantity"].every(field => result.indexes[field] >= 0);
        if (hasCoreHeaders && (result.lines.length || result.allRows.length)) return result;
      }
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    throw new Error("발주 SKU 리스트 표 준비 실패");
  }

  async function readState() {
    const stored = await noidbSafeStorageGetAsync([LINES_KEY, STATE_KEY]);
    return { data: stored[LINES_KEY] || { lines: [] }, state: stored[STATE_KEY] || null };
  }

  async function mergeAndSave(result, state) {
    const stored = await readState();
    const byKey = new Map((Array.isArray(stored.data.lines) ? stored.data.lines : []).map(line => [lineKey(line), line]));
    let newCount = 0;
    let updatedCount = 0;
    let duplicateCount = 0;
    for (const line of result.lines) {
      const key = lineKey(line);
      const previous = byKey.get(key);
      if (!previous) newCount += 1;
      else if (sameLine(previous, line)) duplicateCount += 1;
      else updatedCount += 1;
      byKey.set(key, line);
    }
    const lines = [...byKey.values()];
    const nextState = {
      ...state,
      collectedLineCount: lines.length,
      newCount: (state.newCount || 0) + newCount,
      newSkuCount: (state.newSkuCount || 0) + newCount,
      updatedCount: (state.updatedCount || 0) + updatedCount,
      duplicateCount: (state.duplicateCount || 0) + duplicateCount,
      updatedAt: new Date().toISOString(),
    };
    await noidbSafeStorageSetAsync({ [LINES_KEY]: { lines, capturedAt: nextState.updatedAt, url: location.href }, [STATE_KEY]: nextState });
    return { lines, state: nextState };
  }

  async function stop(state, reason) {
    await noidbSafeStorageSetAsync({ [STATE_KEY]: { ...state, status: "stopped", stopReason: reason, updatedAt: new Date().toISOString() } });
  }

  async function sendToNoidb(lines, state) {
    const response = await fetch(API_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source: "supplier-hub-extension", collectedAt: new Date().toISOString(), lines }),
    });
    if (!response.ok) throw new Error(`원본 전송 실패: POST ${response.status}`);
    const result = await response.json();
    await noidbSafeStorageSetAsync({ [STATE_KEY]: { ...state, transferStatus: "sent", sentCount: result.count, updatedAt: new Date().toISOString() } });
  }

  async function run(state, resume) {
    if (location.pathname !== SKU_LIST_PATH) return;
    if (!resume) await noidbSafeStorageSetAsync({ [STATE_KEY]: state });
    const page = currentPage();
    const expected = Number.isInteger(state.expectedNextPage) ? state.expectedNextPage : 1;
    if (page !== expected) {
      const canResumeNext = resume && page === state.currentPage && state.visitedPages.includes(page) && expected === page + 1;
      if ((!resume && page !== 1) || canResumeNext) {
        const url = new URL(location.href);
        url.searchParams.set("page", String(!resume ? 1 : expected));
        location.assign(url.href);
        return;
      }
      await stop(state, `재개 페이지 불일치: 현재 ${page}, 다음 ${expected}`);
      return;
    }
    const result = await waitForTable();
    if (state.visitedPages.includes(page)) {
      await stop(state, `동일 페이지 재방문 감지: ${page}`);
      return;
    }
    const count = totalCount();
    const pageSize = state.pageSize || result.lines.length;
    if (!pageSize || count == null) {
      await stop(state, "총 발주 SKU 수 확인 실패");
      return;
    }
    const pages = Math.ceil(count / pageSize);
    if (pages < 1 || pages > MAX_PAGES) {
      await stop(state, `페이지 안전 상한 초과: ${pages}`);
      return;
    }
    const merged = await mergeAndSave(result, {
      ...state, currentPage: page, totalPages: pages, totalCount: count, pageSize,
      visitedPages: [...state.visitedPages, page], expectedNextPage: page + 1,
    });
    if (page >= pages) {
      const completeState = { ...merged.state, status: "complete", expectedNextPage: null, completedAt: new Date().toISOString() };
      await noidbSafeStorageSetAsync({ [STATE_KEY]: completeState });
      try {
        await sendToNoidb(merged.lines, completeState);
      } catch (error) {
        await noidbSafeStorageSetAsync({ [STATE_KEY]: {
          ...completeState,
          transferStatus: "failed",
          transferError: error instanceof Error ? error.message : "원본 전송 실패",
          updatedAt: new Date().toISOString(),
        } });
      }
      return;
    }
    await noidbSafeStorageSetAsync({ [STATE_KEY]: merged.state });
    const url = new URL(location.href);
    url.searchParams.set("page", String(page + 1));
    location.assign(url.href);
  }

  function track(state, resume) {
    collectionPromise = run(state, resume).catch(error => stop(state, error instanceof Error ? error.message : "알 수 없는 수집 오류"))
      .finally(() => { collectionPromise = null; });
  }

  function start() {
    if (location.pathname !== SKU_LIST_PATH) return { ok: false, reason: "발주 SKU 리스트 화면이 아닙니다." };
    if (collectionPromise) return { ok: false, reason: "신규 발주 원본 수집이 이미 실행 중입니다." };
    const now = new Date().toISOString();
    const state = {
      runId: `${Date.now()}-${Math.random().toString(36).slice(2)}`, status: "running", currentPage: 0,
      totalPages: null, pageSize: null, totalCount: null, expectedNextPage: 1, visitedPages: [],
      collectedLineCount: 0, newCount: 0, newSkuCount: 0, updatedCount: 0, duplicateCount: 0,
      startedAt: now, updatedAt: now,
    };
    track(state, false);
    return { ok: true, started: true, runId: state.runId };
  }

  async function startDetailProbe() {
    const stored = await noidbSafeStorageGetAsync([DIAGNOSTIC_KEY, PROBE_STATE_KEY]);
    let diagnostic = stored[DIAGNOSTIC_KEY] || null;
    if (!detailCandidatesFromDiagnostic(diagnostic).length) diagnostic = await diagnoseSkuTable();
    const candidates = detailCandidatesFromDiagnostic(diagnostic)
      .map(candidate => safeReadOnlyCandidate(candidate))
      .filter(Boolean);
    const selected = candidates[0];
    if (!selected) {
      const stopped = { status: "stopped", reason: "실행 가능한 조회 전용 상세/SKU 경로를 찾지 못함", updatedAt: new Date().toISOString() };
      await noidbSafeStorageSetAsync({
        [DIAGNOSTIC_KEY]: { ...(diagnostic || {}), detailProbe: stopped, finalResult: "추가조사 필요", nextTechnicalAction: stopped.reason },
        [PROBE_STATE_KEY]: stopped,
      });
      return { ok: false, diagnostic: { ...(diagnostic || {}), detailProbe: stopped, finalResult: "추가조사 필요", nextTechnicalAction: stopped.reason } };
    }
    const now = new Date().toISOString();
    const probe = {
      runId: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      status: "running",
      candidateUrl: selected.url,
      candidate: selected,
      orderNo: selected.orderNo || diagnostic?.orderRows?.find(row => row.orderNo)?.orderNo || "",
      startedAt: now,
      updatedAt: now,
    };
    await noidbSafeStorageSetAsync({
      [PROBE_STATE_KEY]: probe,
      [DIAGNOSTIC_KEY]: {
        ...(diagnostic || {}),
        detailProbe: { status: "running", candidateUrl: selected.url, orderNo: probe.orderNo, startedAt: now },
        finalResult: "상세/SKU 조회 중",
      },
    });
    try {
      location.assign(selected.url);
      return { ok: true, started: true, candidateUrl: selected.url, runId: probe.runId };
    } catch (error) {
      const reason = error instanceof Error ? error.message : "상세/SKU 조회 화면 이동 실패";
      const stopped = { ...probe, status: "stopped", reason, updatedAt: new Date().toISOString() };
      await noidbSafeStorageSetAsync({ [PROBE_STATE_KEY]: stopped, [DIAGNOSTIC_KEY]: { ...(diagnostic || {}), detailProbe: stopped, finalResult: "추가조사 필요", nextTechnicalAction: reason } });
      return { ok: false, diagnostic: { ...(diagnostic || {}), detailProbe: stopped, finalResult: "추가조사 필요", nextTechnicalAction: reason } };
    }
  }

  async function resumeDetailProbe() {
    const stored = await noidbSafeStorageGetAsync([DIAGNOSTIC_KEY, PROBE_STATE_KEY]);
    const probe = stored[PROBE_STATE_KEY];
    if (probe?.status !== "running" || !probe.candidateUrl) return;
    let expected;
    try { expected = new URL(probe.candidateUrl); } catch { return; }
    const current = location.href.replace(/#.*$/, "");
    if (expected.origin !== location.origin || current !== expected.href.replace(/#.*$/, "")) return;
    await new Promise(resolve => setTimeout(resolve, 700));
    const detailProbe = await probeDetailPage(probe);
    const latest = await noidbSafeStorageGetAsync(DIAGNOSTIC_KEY);
    const baseDiagnostic = latest[DIAGNOSTIC_KEY] || stored[DIAGNOSTIC_KEY] || {};
    const nextProbe = { ...probe, ...detailProbe, status: detailProbe.status, updatedAt: new Date().toISOString() };
    const diagnostic = {
      ...baseDiagnostic,
      capturedAt: detailProbe.capturedAt,
      url: location.href,
      detailPathCheck: true,
      detailProbe: nextProbe,
      detailUrl: detailProbe.url,
      detailSurfaceTypes: detailProbe.detailSurfaceTypes,
      iframeUrls: detailProbe.iframeUrls,
      tabsOrSections: detailProbe.tabsOrSections,
      observedResourceUrls: detailProbe.observedResourceUrls,
      observedRequestMethods: detailProbe.observedRequestMethods,
      detectedReadOnlyDataSource: detailProbe.detectedReadOnlyDataSource,
      detectedResponseFields: detailProbe.detectedResponseFields,
      sourceSkuRows: detailProbe.sourceSkuRows,
      sourceQuantityField: detailProbe.sourceQuantityField,
      sourceSkuIdField: detailProbe.sourceSkuIdField,
      sampleValidation: detailProbe.sampleValidation,
      finalSourceLocation: detailProbe.finalSourceLocation,
      diagnosticErrors: detailProbe.diagnosticErrors,
      finalResult: detailProbe.status === "complete" ? "원본 위치 검증 성공" : "추가조사 필요",
      nextTechnicalAction: detailProbe.nextTechnicalAction,
    };
    await noidbSafeStorageSetAsync({ [PROBE_STATE_KEY]: nextProbe, [DIAGNOSTIC_KEY]: diagnostic });
  }

  noidbSafeAddRuntimeMessageListener((message, _sender, sendResponse) => {
    if (message?.type === "NOIDB_POC_DISCOVER_PURCHASE_ORDER_SOURCE") {
      startDetailProbe().then(sendResponse).catch(error => sendResponse({ ok: false, reason: error instanceof Error ? error.message : "상세/SKU 자동조사 실패" }));
      return true;
    }
    if (message?.type === "NOIDB_POC_DIAGNOSE_PURCHASE_ORDER_LINES") {
      diagnoseSkuTable().then(diagnostic => sendResponse({
        ok: diagnostic.ok,
        diagnostic: {
          ok: diagnostic.ok,
          urlCheck: diagnostic.urlCheck,
          tableCheck: diagnostic.tableCheck,
          orderListRecognized: diagnostic.orderListRecognized,
          orderNoCheck: diagnostic.orderNoCheck,
          detailPathCheck: diagnostic.detailPathCheck,
          directSkuDataCheck: diagnostic.directSkuDataCheck,
          readyToCollect: diagnostic.readyToCollect,
          finalResult: diagnostic.finalResult,
          nextTechnicalAction: diagnostic.nextTechnicalAction,
          headerCheck: diagnostic.headerCheck,
          requiredHeaderCount: diagnostic.requiredHeaderCount,
          requiredHeaderTotal: diagnostic.requiredHeaderTotal,
          fieldChecks: diagnostic.fieldChecks,
          headers: diagnostic.headers,
          mappedHeaders: diagnostic.mappedHeaders,
          navigationCandidates: diagnostic.navigationCandidates,
          sampleCount: diagnostic.sampleCount,
          sampleMatchCount: diagnostic.sampleMatchCount,
          collectableSkuCount: diagnostic.collectableSkuCount,
          errorCount: diagnostic.errorCount,
        },
        reason: diagnostic.reason,
      })).catch(error => sendResponse({ ok: false, reason: error instanceof Error ? error.message : "SKU 리스트 진단 실패" }));
      return true;
    }
    if (message?.type !== "NOIDB_POC_START_PURCHASE_ORDER_LINES_COLLECTION") return undefined;
    try {
      sendResponse(start());
    } catch (error) {
      sendResponse({ ok: false, reason: error instanceof Error ? error.message : "원본 수집 시작 실패" });
    }
    return false;
  });

  (async () => {
    if (location.pathname !== SKU_LIST_PATH || collectionPromise) return;
    const stored = await noidbSafeStorageGetAsync(STATE_KEY);
    const state = stored[STATE_KEY];
    if (state?.status === "running" && state.runId) track(state, true);
  })().catch(() => undefined);
  resumeDetailProbe().catch(() => undefined);
})();

// 3단계 POC: 발주리스트(발주서 목록) 화면 읽기 (읽기 전용)
//
// 목적: 발주번호 / 발주구분 / 진행상태 / 정산상태를 화면에 보이는 텍스트 그대로 읽는다.
// 업무 규칙: 발주구분에 "매입용"이 포함된 행은 수집 대상에서 제외한다
// (제외된 건수는 별도로 기록하며, 조용히 버리지 않는다).
// 2단계와 동일한 원칙: 특정 class 이름을 추측하지 않고 헤더 텍스트 매칭으로
// 표를 찾는다. 클릭/입력/페이지 넘김 자동화/네트워크 호출은 하지 않으며,
// 현재 화면에 렌더링된 행만 읽는다(1페이지 한정).
(() => {
  const ORDER_LIST_STORAGE_KEY = "noidbPocOrderListRows";
  const ORDER_LIST_ACCUMULATED_KEY = "noidbPocOrderListAccumulated";
  const DIAGNOSTICS_KEY = "noidbPocOrderListDiagnostics";
  const AUTO_FILTER_APPLIED_KEY = "noidbPocAutoFilterApplied";
  const AUTO_FILTER_DIAG_KEY = "noidbPocAutoFilterDiagnostics";
  const ORDER_LIST_URL_PATH = "/po-web/purchase/order/list";
  const MIN_MATCHED_COLUMNS = 2; // COLUMN_DEFS가 3개(orderNo/progressStatus/settlementStatus)로 줄어듦

  // chrome?.storage?.local는 확장이 리로드/비활성화된 뒤에도 여전히 존재하는
  // 객체라 이 존재 체크만으로는 안전하지 않다 — 실제로 .set()/.get()을 호출할
  // 때 "Extension context invalidated" 예외가 던져질 수 있다. 이 IIFE는 여러
  // setTimeout(1500ms/4000ms 재시도, 자동필터 1500ms 지연)과 여러 단계의
  // await sleep(...)을 거치는 긴 비동기 흐름을 갖고 있어, 함수 진입 시점의
  // 체크만으로는 부족하다(그 사이 확장이 리로드될 수 있음) — 그래서 실제
  // 호출부마다 try/catch로 감싸는 이 래퍼를 쓴다.
  function safeStorageSet(obj, cb) {
    noidbSafeStorageSet(obj, cb);
  }
  function safeStorageGet(keys, cb) {
    noidbSafeStorageGet(keys, cb);
  }

  // 실제 화면 확인 결과(2026-09-13): 매입용 제외 판정은 오직 "발주유형" 헤더
  // 컬럼만 사용한다. "발주구분"(리오더 등)과 "주문유형"은 제외 판정에 절대
  // 사용하지 않는다(사용자가 실제 데이터로 확정).
  const COLUMN_DEFS = [
    { key: "orderNo", labels: ["발주번호"] },
    { key: "progressStatus", labels: ["발주상태", "진행상태", "진행 상태"] },
    { key: "settlementStatus", labels: ["계산서상태", "정산상태", "정산 상태"] },
  ];

  const EXCLUDED_PURCHASE_TYPE_TEXT = "매입용";
  const PURCHASE_TYPE_COLUMN_LABEL = "발주유형";

  function normalize(text) {
    return (text || "").replace(/\s+/g, "").trim();
  }

  function buildColumnMap(headerTexts) {
    const normalizedHeaders = headerTexts.map(normalize);
    const map = {};
    for (const def of COLUMN_DEFS) {
      let foundIndex = -1;
      for (const label of def.labels) {
        const idx = normalizedHeaders.indexOf(label);
        if (idx !== -1) {
          foundIndex = idx;
          break;
        }
      }
      if (foundIndex === -1) {
        for (const label of def.labels) {
          const idx = normalizedHeaders.findIndex((h) => h.includes(label));
          if (idx !== -1) {
            foundIndex = idx;
            break;
          }
        }
      }
      if (foundIndex !== -1) map[def.key] = foundIndex;
    }
    return map;
  }

  // 실제 발주리스트 화면은 다단(그룹) 헤더 구조였다 — 예: 상위 행에 그룹
  // 라벨(rowspan/colspan)이 있고, 실제 leaf 라벨(발주번호/발주구분/진행상태/
  // 정산상태)은 그 아래 행에 나뉘어 있을 수 있다. 첫 번째 헤더 행 하나만 읽던
  // 기존 방식은 이런 구조에서 실패한다. 대신 <thead>(또는 thead가 없으면
  // th로만 구성된 선두 행들)의 "모든" 헤더 행을 rowspan/colspan까지 반영해
  // 격자(grid)로 펼친 뒤, 각 컬럼 위치의 헤더 텍스트를 위→아래로 이어붙여
  // ("정산확인"+"정산상태" → "정산확인정산상태") 실제 leaf 라벨을 포함하는
  // 하나의 문자열로 만든다. 이렇게 하면 단순 문자열 일치(.includes)만으로도
  // 다단 헤더의 leaf 라벨을 찾아낼 수 있다 — 특정 구조를 추측해 하드코딩하지
  // 않는다.
  function getHeaderRows(tableEl) {
    if (tableEl.tHead) return Array.from(tableEl.tHead.rows);
    const rows = Array.from(tableEl.rows || tableEl.querySelectorAll("tr"));
    const headerRows = [];
    for (const row of rows) {
      const cells = Array.from(row.cells || row.querySelectorAll("th, td"));
      if (cells.length > 0 && cells.every((c) => c.tagName === "TH")) {
        headerRows.push(row);
      } else {
        break;
      }
    }
    return headerRows.length ? headerRows : rows.slice(0, 1);
  }

  function buildHeaderGrid(headerRows) {
    const grid = [];
    const pendingRowSpans = []; // pendingRowSpans[colIdx] = { remaining, text }
    for (let r = 0; r < headerRows.length; r++) {
      grid[r] = [];
      const cells = Array.from(headerRows[r].querySelectorAll("th, td"));
      let colIdx = 0;
      let cellPtr = 0;
      while (cellPtr < cells.length || (pendingRowSpans[colIdx] && pendingRowSpans[colIdx].remaining > 0)) {
        if (pendingRowSpans[colIdx] && pendingRowSpans[colIdx].remaining > 0) {
          grid[r][colIdx] = pendingRowSpans[colIdx].text;
          pendingRowSpans[colIdx].remaining -= 1;
          colIdx += 1;
          continue;
        }
        const cell = cells[cellPtr];
        if (!cell) break;
        const text = (cell.textContent || "").trim();
        const colSpan = cell.colSpan || 1;
        const rowSpan = cell.rowSpan || 1;
        for (let s = 0; s < colSpan; s++) {
          grid[r][colIdx] = text;
          if (rowSpan > 1) pendingRowSpans[colIdx] = { remaining: rowSpan - 1, text };
          colIdx += 1;
        }
        cellPtr += 1;
      }
    }
    return grid;
  }

  function flattenColumnHeaders(grid) {
    const numCols = grid.reduce((m, row) => Math.max(m, row.length), 0);
    const flattened = [];
    for (let c = 0; c < numCols; c++) {
      const parts = [];
      for (let r = 0; r < grid.length; r++) {
        const text = (grid[r] && grid[r][c]) || "";
        if (text && parts[parts.length - 1] !== text) parts.push(text);
      }
      flattened.push(parts.join(""));
    }
    return flattened;
  }

  function getDataRows(tableEl, headerRows) {
    const headerRowSet = new Set(headerRows);
    if (tableEl.tBodies && tableEl.tBodies.length) {
      return Array.from(tableEl.tBodies).flatMap((tb) => Array.from(tb.rows));
    }
    return Array.from(tableEl.rows || tableEl.querySelectorAll("tr")).filter(
      (row) => !headerRowSet.has(row)
    );
  }

  // 발주번호 셀에 "142186781SKU 바코드 출력"처럼 부가 텍스트가 붙어 있어도
  // 8~10자리 숫자만 정확히 뽑아낸다. 값 전체를 추측하지 않고 실제 텍스트에서
  // 패턴으로 추출만 한다.
  function extractOrderNo(text) {
    const match = String(text || "").match(/\d{8,10}/);
    return match ? match[0] : null;
  }

  function findColumnIndexByLabel(normalizedHeaders, label) {
    const exact = normalizedHeaders.indexOf(label);
    if (exact !== -1) return exact;
    const partial = normalizedHeaders.findIndex((h) => h.includes(label));
    return partial !== -1 ? partial : null;
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // 표를 감싼 "실제로 스크롤되는" 조상 요소를 찾는다(스크롤 가능한 높이 +
  // overflow-y:auto/scroll). 가상 스크롤(지연 렌더링) 목록은 보통 이런 컨테이너
  // 안에서 보이는 행만 DOM에 렌더링하고 나머지는 스크롤해야 생성한다.
  function findScrollableAncestor(el) {
    let node = el.parentElement;
    for (let depth = 0; depth < 12 && node; depth++) {
      if (node.scrollHeight > node.clientHeight + 4) {
        let overflowY = "";
        try {
          overflowY = getComputedStyle(node).overflowY;
        } catch {
          overflowY = "";
        }
        if (overflowY === "auto" || overflowY === "scroll") return node;
      }
      node = node.parentElement;
    }
    return null;
  }

  // 현재 스크롤 위치에서 화면에 보이는 데이터 행만 읽는다(부수효과 없는 순수 읽기).
  function readVisibleDataRows(table, headerRows, bestMap) {
    const dataRows = getDataRows(table, headerRows);
    return dataRows
      .map((row) => {
        const cells = Array.from(row.querySelectorAll("td, th")).map((c) => (c.textContent || "").trim());
        if (cells.every((c) => !c)) return null; // 완전히 빈 행(구분선 등)은 제외
        const obj = {};
        for (const [key, idx] of Object.entries(bestMap)) obj[key] = cells[idx] ?? null;
        obj.__rawCells = cells;
        return obj;
      })
      .filter(Boolean);
  }

  // 가상스크롤/지연렌더링 대응: 표를 감싼 스크롤 컨테이너를 읽기 전용으로
  // 끝까지 내리면서(클릭/입력/네트워크 호출 없음), 매 위치에서 보이는 행을
  // "발주번호(orderNo)" 기준으로 중복 없이 누적한다. 스크롤이 끝나면(더 이상
  // scrollTop이 늘지 않으면, 또는 최대 반복 횟수 도달) 원래 스크롤 위치로
  // 되돌린다. 스크롤 컨테이너를 찾지 못하면(가상스크롤이 아니면) 현재 보이는
  // 행만 그대로 반환한다 — 이 경우 화면에 이미 전체 행이 다 있다는 뜻이다.
  async function collectAllVisibleRows(table, headerRows, bestMap, orderNoColIdx) {
    const byKey = new Map();
    let noKeyCounter = 0;
    const addRows = (rows) => {
      for (const row of rows) {
        const orderNo = extractOrderNo(orderNoColIdx != null ? row.__rawCells[orderNoColIdx] : null);
        const key = orderNo || `__nokey_${noKeyCounter++}`;
        byKey.set(key, { ...row, orderNo });
      }
    };

    addRows(readVisibleDataRows(table, headerRows, bestMap));

    const scrollContainer = findScrollableAncestor(table);
    let estimatedTotalRows = null;
    let scrolled = false;

    if (scrollContainer) {
      scrolled = true;
      const originalScrollTop = scrollContainer.scrollTop;

      const sampleRow = table.querySelector("tbody tr") || table.querySelector("tr");
      const rowHeight = sampleRow ? sampleRow.getBoundingClientRect().height : 0;
      if (rowHeight > 0) {
        estimatedTotalRows = Math.round(scrollContainer.scrollHeight / rowHeight);
      }

      scrollContainer.scrollTop = 0;
      await sleep(150);
      addRows(readVisibleDataRows(table, headerRows, bestMap));

      let lastScrollTop = -1;
      const step = Math.max(scrollContainer.clientHeight - 40, 80);
      for (let i = 0; i < 60; i++) {
        scrollContainer.scrollTop += step;
        await sleep(180); // 가상 렌더링이 새 행을 그릴 시간을 준다
        addRows(readVisibleDataRows(table, headerRows, bestMap));
        if (scrollContainer.scrollTop === lastScrollTop) break; // 더 내려가지 않으면 끝
        lastScrollTop = scrollContainer.scrollTop;
      }

      scrollContainer.scrollTop = originalScrollTop; // 원래 위치로 복귀
    }

    return { rows: Array.from(byKey.values()), estimatedTotalRows, scrolled };
  }

  // 1단계: 헤더만으로 표를 선택하고 컬럼 인덱스를 정한다(동기, 스크롤 없음).
  function selectOrderListTable() {
    const tables = Array.from(document.querySelectorAll("table"));
    let best = null;
    let bestScore = 0;
    let bestMap = null;
    let bestHeaderRows = null;
    let bestFlattenedHeaders = null;

    for (const table of tables) {
      const headerRows = getHeaderRows(table);
      if (!headerRows.length) continue;
      const grid = buildHeaderGrid(headerRows);
      const flattenedHeaders = flattenColumnHeaders(grid);
      const map = buildColumnMap(flattenedHeaders);
      const score = Object.keys(map).length;
      if (score > bestScore) {
        bestScore = score;
        best = table;
        bestMap = map;
        bestHeaderRows = headerRows;
        bestFlattenedHeaders = flattenedHeaders;
      }
    }

    if (!best || bestScore < MIN_MATCHED_COLUMNS) {
      return { found: false, bestScore, bestFlattenedHeaders };
    }

    const normalizedFlattenedHeaders = bestFlattenedHeaders.map(normalize);

    // "정산 판정 컬럼은 마지막 계산서상태로 사용" — 동일한 정확 일치 헤더가
    // 여러 개 있을 가능성에 대비해, buildColumnMap의 첫 매칭이 아니라 항상
    // 가장 마지막(오른쪽) "계산서상태" 정확 일치 컬럼을 우선한다.
    const settlementLabelNormalized = normalize("계산서상태");
    let lastExactSettlementIdx = -1;
    normalizedFlattenedHeaders.forEach((h, i) => {
      if (h === settlementLabelNormalized) lastExactSettlementIdx = i;
    });
    if (lastExactSettlementIdx !== -1) bestMap.settlementStatus = lastExactSettlementIdx;

    // 매입용 제외 판정은 오직 "발주유형" 컬럼만 사용한다 — "발주구분"/"주문유형"은
    // 절대 쓰지 않는다.
    const purchaseTypeColIdx = findColumnIndexByLabel(
      normalizedFlattenedHeaders,
      normalize(PURCHASE_TYPE_COLUMN_LABEL)
    );

    return {
      found: true,
      table: best,
      headerRows: bestHeaderRows,
      bestMap,
      flattenedHeaders: bestFlattenedHeaders,
      purchaseTypeColIdx,
    };
  }

  // 2단계: 선택된 표에서 실제 행을 전부 모은다(가상스크롤 대응, 비동기).
  async function scanForOrderListTable() {
    const selection = selectOrderListTable();
    if (!selection.found) return selection;

    const { table, headerRows, bestMap, flattenedHeaders, purchaseTypeColIdx } = selection;

    // 헤더 매칭으로 찾은 "발주번호" 컬럼이 실제로 발주번호 패턴을 담고 있는지는
    // 이 시점엔 아직 몇 행만 봤을 수 있으므로, 우선 현재 보이는 행으로 1차
    // 판단하고, 전체 수집 후 아래에서 다시 한 번 확정한다.
    let orderNoColIdx = bestMap.orderNo;

    const { rows: rawRows, estimatedTotalRows, scrolled } = await collectAllVisibleRows(
      table,
      headerRows,
      bestMap,
      orderNoColIdx
    );

    // 헤더 매칭으로 찾은 "발주번호" 컬럼이 실제로 발주번호 패턴을 담고 있는지
    // 실제 행 데이터로 재확인한다. 다단 헤더 오인식 등으로 적중률이 낮으면
    // (행의 절반 미만에서만 숫자 패턴이 나오면), 전체 컬럼 중 발주번호 패턴
    // 적중률이 가장 높은 컬럼으로 안전하게 대체한다 — 추측이 아니라 실제
    // 행 데이터 기준 판단이다.
    const maxCols = rawRows.reduce((m, r) => Math.max(m, r.__rawCells.length), 0);
    const hitRateForCol = (colIdx) => {
      if (colIdx == null || !rawRows.length) return 0;
      let hits = 0;
      for (const r of rawRows) {
        if (extractOrderNo(r.__rawCells[colIdx])) hits += 1;
      }
      return hits / rawRows.length;
    };
    if (hitRateForCol(orderNoColIdx) < 0.5) {
      let bestColIdx = orderNoColIdx;
      let bestHitRate = hitRateForCol(orderNoColIdx);
      for (let c = 0; c < maxCols; c++) {
        const rate = hitRateForCol(c);
        if (rate > bestHitRate) {
          bestHitRate = rate;
          bestColIdx = c;
        }
      }
      orderNoColIdx = bestColIdx;
    }

    // 발주번호 컬럼이 스크롤 도중 바뀌었을 수 있으니(위 재확인 결과), 최종
    // 발주번호와 매입용 판정값(발주유형 컬럼)을 다시 한 번 확정해 붙인다.
    const rowsWithKeys = new Map();
    for (const row of rawRows) {
      const orderNo = extractOrderNo(orderNoColIdx != null ? row.__rawCells[orderNoColIdx] : null);
      const purchaseType =
        purchaseTypeColIdx != null ? (row.__rawCells[purchaseTypeColIdx] ?? "").trim() : null;
      const key = orderNo || row.orderNo || JSON.stringify(row.__rawCells);
      rowsWithKeys.set(key, { ...row, orderNo, purchaseType });
    }
    const allRowsFinal = Array.from(rowsWithKeys.values());

    const purchaseTypeDistinct = {};
    for (const row of allRowsFinal) {
      const key = row.purchaseType === null || row.purchaseType === "" ? "(빈값)" : row.purchaseType;
      purchaseTypeDistinct[key] = (purchaseTypeDistinct[key] || 0) + 1;
    }

    // purchaseType === "매입용"이면 제외, 그 외(대부분 "일반")는 전부 수집한다.
    // 발주유형 컬럼을 찾지 못했으면(purchaseTypeColIdx == null) 판단 근거가 없어
    // 아무 것도 제외하지 않는다 — 추측하지 않는다.
    const excludedRows =
      purchaseTypeColIdx != null
        ? allRowsFinal.filter((row) => normalize(row.purchaseType) === normalize(EXCLUDED_PURCHASE_TYPE_TEXT))
        : [];
    const collectedRows =
      purchaseTypeColIdx != null
        ? allRowsFinal.filter((row) => normalize(row.purchaseType) !== normalize(EXCLUDED_PURCHASE_TYPE_TEXT))
        : allRowsFinal;

    return {
      found: true,
      columnMap: bestMap,
      flattenedHeaders,
      // 실제 thead 원본 구조(행/열 병합 포함) — 자동 매칭이 특정 컬럼(특히
      // 정산상태처럼 그룹 헤더 아래 있을 수 있는 값)을 못 찾았을 때, 개발자
      // 도구 없이 이 값만으로 다음 라운드에서 인덱스를 다시 판단할 수 있게 한다.
      theadStructure: headerRows.map((row) =>
        Array.from(row.querySelectorAll("th, td")).map((c) => ({
          text: (c.textContent || "").trim(),
          rowSpan: c.rowSpan || 1,
          colSpan: c.colSpan || 1,
        }))
      ),
      orderNoColIdx,
      purchaseTypeColIdx,
      // 가상스크롤 여부/추정 전체 행수(측정값, 추측 아님) — 팝업에 그대로 표시한다.
      scrolled,
      estimatedTotalRows,
      purchaseTypeDistinct,
      totalRowCount: allRowsFinal.length,
      excludedPurchaseTypeCount: excludedRows.length,
      rowCount: collectedRows.length,
      rows: collectedRows,
      excludedRows,
    };
  }

  // 여러 페이지에 걸쳐 읽은 결과를 발주번호(orderNo) 기준으로 합친다.
  // 자동 페이지 넘김은 하지 않는다 — 사용자가 직접 다음 페이지로 이동해
  // 이 확장이 다시 스캔(초기 로드 또는 "발주리스트 다시 읽기")할 때마다
  // 누적 저장소에 upsert 방식으로 병합될 뿐이다. 같은 발주번호가 다시
  // 읽히면 최신 스캔 값으로 덮어써 중복 없이 상태만 갱신한다.
  function mergeIntoAccumulated(rows, excludedRows = []) {
    safeStorageGet([ORDER_LIST_ACCUMULATED_KEY], (stored) => {
      const prev = stored[ORDER_LIST_ACCUMULATED_KEY] || {
        byOrderNo: {},
        excludedByOrderNo: {},
        scanCount: 0,
        cumulativeExcludedPurchaseTypeCount: 0,
        firstCapturedAt: new Date().toISOString(),
      };
      const byOrderNo = { ...prev.byOrderNo };
      const excludedByOrderNo = { ...(prev.excludedByOrderNo || {}) };
      let skippedNoOrderNo = 0;
      for (const row of rows) {
        if (!row.orderNo) {
          skippedNoOrderNo += 1; // 발주번호가 없으면 키로 쓸 수 없어 병합에서 제외
          continue;
        }
        byOrderNo[row.orderNo] = {
          orderNo: row.orderNo,
          purchaseType: row.purchaseType,
          progressStatus: row.progressStatus,
          settlementStatus: row.settlementStatus,
        };
      }
      for (const row of excludedRows) {
        if (row.orderNo) excludedByOrderNo[row.orderNo] = { orderNo: row.orderNo, purchaseType: row.purchaseType };
      }

      const merged = {
        byOrderNo,
        excludedByOrderNo,
        scanCount: prev.scanCount + 1,
        cumulativeExcludedPurchaseTypeCount: Math.max(
          prev.cumulativeExcludedPurchaseTypeCount || 0,
          Object.keys(excludedByOrderNo).length
        ),
        firstCapturedAt: prev.firstCapturedAt,
        lastCapturedAt: new Date().toISOString(),
        lastUrl: location.href,
      };

      safeStorageSet({ [ORDER_LIST_ACCUMULATED_KEY]: merged }, () => {
        console.log(
          `[NOIDB-POC] order list accumulated: 누적 ${
            Object.keys(byOrderNo).length
          }건 (이번 스캔 ${rows.length}건 병합${
            skippedNoOrderNo ? `, 발주번호 없음 ${skippedNoOrderNo}건 스킵` : ""
          }, 누적 매입용 제외 ${merged.cumulativeExcludedPurchaseTypeCount}건, 스캔 횟수 ${
            merged.scanCount
          })`
        );
      });
    });
  }

  // --- 진단 기능 (발주리스트를 <table>로 찾지 못했을 때만 사용) ---
  // 목적: 실제 화면의 DOM 구조(표/ARIA grid/일반 div)를 개발자도구 없이
  // 확장 팝업에서 바로 확인할 수 있게 한다. 클릭/입력 없음, 텍스트만 읽는다.
  const PO_NUMBER_LIKE_RE = /^\d{8,10}$/; // 실제 로컬 발주서 데이터 기준: 9자리 숫자

  function collectTableCandidates() {
    const tables = Array.from(document.querySelectorAll("table")).slice(0, 10);
    return tables.map((table, index) => {
      const headerRows = getHeaderRows(table);
      const grid = buildHeaderGrid(headerRows);
      const flattenedHeaders = flattenColumnHeaders(grid);
      const theadStructure = headerRows.map((row) =>
        Array.from(row.querySelectorAll("th, td")).map((c) => ({
          text: (c.textContent || "").trim(),
          rowSpan: c.rowSpan || 1,
          colSpan: c.colSpan || 1,
        }))
      );
      const bodyRows = getDataRows(table, headerRows);
      const sampleFirstRowCells = bodyRows[0]
        ? Array.from(bodyRows[0].querySelectorAll("td, th")).map((c) => (c.textContent || "").trim())
        : [];
      return { index, flattenedHeaders, theadStructure, rowCount: bodyRows.length, sampleFirstRowCells };
    });
  }

  function collectAriaGridCandidates() {
    const containers = Array.from(document.querySelectorAll('[role="grid"], [role="table"]')).slice(0, 10);
    return containers.map((container, index) => {
      const rows = Array.from(container.querySelectorAll('[role="row"]'));
      const headerRow = rows[0] || null;
      const headerTexts = headerRow
        ? Array.from(
            headerRow.querySelectorAll('[role="columnheader"], [role="gridcell"], [role="cell"]')
          ).map((c) => (c.textContent || "").trim())
        : [];
      const dataRow = rows[1] || null;
      const sampleFirstRowCells = dataRow
        ? Array.from(
            dataRow.querySelectorAll('[role="gridcell"], [role="cell"]')
          ).map((c) => (c.textContent || "").trim())
        : [];
      return {
        index,
        tagName: container.tagName.toLowerCase(),
        className: container.className ? String(container.className) : "",
        rowCount: Math.max(rows.length - 1, 0),
        headerTexts,
        sampleFirstRowCells,
      };
    });
  }

  // <table>도 ARIA grid도 아닌 순수 div 기반 구조(가상 스크롤 리스트 등)에 대응하기 위해,
  // "발주번호처럼 보이는 8~10자리 숫자 텍스트"를 먼저 찾고, 그 텍스트를 감싼 조상 중
  // "형제 요소들과 태그+class가 같은(=반복되는 행 패턴으로 보이는)" 첫 조상을 "행"으로
  // 추정한 뒤, 그 행 안의 텍스트들을 컬럼 후보로 추출한다. 특정 class 이름을 미리
  // 추측하지 않고, 실제 DOM에서 관찰되는 반복 구조만 근거로 삼는다.
  function collectNumericTextRowPatterns() {
    const allEls = Array.from(document.querySelectorAll("body *"));
    const numericLeaves = [];
    for (const el of allEls) {
      if (el.children.length > 0) continue; // 텍스트만 있는 말단 요소만 대상
      const text = (el.textContent || "").trim();
      if (PO_NUMBER_LIKE_RE.test(text)) numericLeaves.push(el);
      if (numericLeaves.length >= 40) break;
    }

    const patternsBySignature = new Map();
    for (const leaf of numericLeaves) {
      let ancestor = leaf;
      let rowCandidate = null;
      for (let depth = 0; depth < 8 && ancestor && ancestor.parentElement; depth++) {
        const parent = ancestor.parentElement;
        const siblings = Array.from(parent.children).filter(
          (sib) => sib !== ancestor && sib.tagName === ancestor.tagName && sib.className === ancestor.className
        );
        if (siblings.length >= 2) {
          rowCandidate = ancestor;
          break;
        }
        ancestor = parent;
      }
      if (!rowCandidate) continue;

      const signature = `${rowCandidate.tagName.toLowerCase()}.${String(rowCandidate.className || "")}`;
      if (!patternsBySignature.has(signature)) {
        let color = "";
        try {
          color = getComputedStyle(leaf).color || "";
        } catch {
          color = "";
        }
        patternsBySignature.set(signature, {
          signature,
          numericTextColor: color,
          sampleRows: [],
        });
      }
      const pattern = patternsBySignature.get(signature);
      if (pattern.sampleRows.length < 5) {
        const cellTexts = Array.from(rowCandidate.querySelectorAll("*"))
          .filter((n) => n.children.length === 0)
          .map((n) => (n.textContent || "").trim())
          .filter(Boolean)
          .slice(0, 15);
        pattern.sampleRows.push(cellTexts);
      }
    }

    return Array.from(patternsBySignature.values()).slice(0, 6);
  }

  function collectDiagnostics(reason) {
    const diagnostics = {
      collectedAt: new Date().toISOString(),
      url: location.href,
      reason,
      tableCandidates: collectTableCandidates(),
      ariaGridCandidates: collectAriaGridCandidates(),
      numericTextRowPatterns: collectNumericTextRowPatterns(),
    };
    console.log("[NOIDB-POC] order list diagnostics", diagnostics);
    safeStorageSet({ [DIAGNOSTICS_KEY]: diagnostics });
    return diagnostics;
  }

  async function scanAllOrderListPages(includePagination) {
    const pages = [];
    const seenPages = new Set();
    for (let attempt = 0; attempt < 20; attempt++) {
      const page = document.querySelector(".ant-pagination-item-active");
      const pageKey = page?.textContent?.trim() || `unknown-${attempt}`;
      if (seenPages.has(pageKey)) break;
      seenPages.add(pageKey);
      const result = await scanForOrderListTable();
      if (!result.found) return result;
      pages.push(result);
      if (!includePagination) break;
      const next = document.querySelector("li.ant-pagination-next");
      const nextButton = next?.querySelector("button");
      if (!next || next.getAttribute("aria-disabled") === "true" || nextButton?.disabled) break;
      const before = pageKey;
      try {
        nextButton.click();
      } catch (error) {
        console.warn("[NOIDB-POC] pagination stopped after first page:", error);
        break;
      }
      for (let wait = 0; wait < 20; wait++) {
        await sleep(180);
        const active = document.querySelector(".ant-pagination-item-active")?.textContent?.trim() || "";
        if (active && active !== before) break;
      }
      const after = document.querySelector(".ant-pagination-item-active")?.textContent?.trim() || "";
      if (!after || after === before) break;
    }
    const first = pages[0];
    return {
      ...first,
      totalRowCount: pages.reduce((n, page) => n + page.totalRowCount, 0),
      excludedPurchaseTypeCount: pages.reduce((n, page) => n + page.excludedPurchaseTypeCount, 0),
      rowCount: pages.reduce((n, page) => n + page.rowCount, 0),
      rows: pages.flatMap((page) => page.rows),
      excludedRows: pages.flatMap((page) => page.excludedRows || []),
      pageCount: pages.length,
    };
  }

  async function runOrderListScan(reason) {
    // 초기/재시도 스캔은 자동조회와 겹치지 않도록 현재 1페이지만 읽는다.
    // 검색이 끝난 뒤의 자동/수동 스캔에서만 다음 페이지를 순차 수집한다.
    const result = await scanAllOrderListPages(reason === "after-auto-filter" || reason === "manual-rescan");
    if (!result.found) {
      console.log(
        `[NOIDB-POC] order list rows: 조건에 맞는 표를 찾지 못함 (${reason}, ` +
          `최고 매칭 컬럼 수=${result.bestScore}, 후보 헤더(다단 반영)=${JSON.stringify(
            result.bestFlattenedHeaders
          )})`
      );
      collectDiagnostics(reason);
      return result;
    }

    console.log(
      `[NOIDB-POC] order list rows (${reason}): 화면추정 ${result.estimatedTotalRows ?? "-"}행, ` +
        `실제수집 ${result.totalRowCount}행(고유), 매입용 제외 ${result.excludedPurchaseTypeCount}건, ` +
        `일반 수집 ${result.rowCount}건, 페이지 ${result.pageCount || 1}개, 스크롤여부=${result.scrolled}`,
      result
    );

    safeStorageSet({
      [ORDER_LIST_STORAGE_KEY]: {
        ...result,
        capturedAt: new Date().toISOString(),
        url: location.href,
      },
    });

    mergeIntoAccumulated(result.rows, result.excludedRows || []);

    return result;
  }

  // 스크롤 수집은 시간이 걸릴 수 있어(가상스크롤 대응), 초기 로드+재시도+수동
  // 재스캔+자동필터 적용 후 스캔이 동시에 겹쳐 스크롤 위치가 흔들리지 않도록
  // 한 번에 하나만 실행한다. 이미 실행 중일 때 또 요청이 들어오면(예: 자동필터
  // 클릭 직후) 그 결과를 재사용하지 않고, 현재 실행이 끝난 뒤 한 번 더
  // 실행되도록 예약한다 — 그래야 필터 변경 "이후"의 실제 데이터를 읽는다.
  let scanInFlight = null;
  let scanQueued = false;
  function runOrderListScanGuarded(reason) {
    if (scanInFlight) {
      scanQueued = true;
      return scanInFlight;
    }
    scanInFlight = runOrderListScan(reason).finally(() => {
      scanInFlight = null;
      if (scanQueued) {
        scanQueued = false;
        runOrderListScanGuarded(`${reason}-followup`);
      }
    });
    return scanInFlight;
  }

  // --- 6단계(2026-09-13, 2차 수정: 실제 클릭 실패 후 달력 셀 클릭 방식으로 교체):
  // 발주리스트 진입 시 "기간검색=발주일 / 오늘 기준 과거 30일" 자동 적용 ---
  //
  // 실제 확인된 구조:
  //   1) "기간검색" 라벨 옆에 AntD Select 콤보박스(input[role=combobox],
  //      class에 "ant-select" 포함)가 있다 — id는 동적(_r_7_ 등)이라 쓰지
  //      않고, "기간검색" 라벨과의 컨테이너 관계로만 찾는다.
  //   2) 날짜 빠른선택 버튼은 "어제/오늘/다음 7일/다음 30일"이며, "최근 30일"은
  //      존재하지 않는다. "다음 30일"은 절대 클릭하지 않는다.
  //   3) 검색 버튼은 <button type="button">검색</button>.
  //   4) 같은 화면에 발주서 업로드/발주서 전송 등 업무 버튼이 있으므로,
  //      표(<table>) 안 요소와 위 3개 카테고리 외 텍스트는 절대 클릭 대상으로
  //      삼지 않는다.
  //
  // 1차 시도(실패, 실제 Chrome 검증됨): "오늘" 프리셋 클릭 → 두 입력값이
  // 같아짐을 확인 → 그 표시 형식을 역산 → 시작일 input에 네이티브 value
  // setter + input/change/Enter/blur 이벤트로 다시 쓰기. 이 방식이 실제
  // 화면에서 최종 자동조회로 이어지지 않았다 — 아마도 이 AntD Picker가
  // 텍스트 타이핑을 받아들이지 않는 구성(inputReadOnly 등)이라, 텍스트를
  // 흉내낸 이벤트를 쏴도 React 쪽 onChange가 아예 반응하지 않았을 가능성이
  // 높다. 같은 방식을 반복하지 않는다.
  //
  // 2차 시도(이번 구현): input 값을 직접 바꾸지 않는다. 대신 날짜 input을
  // 클릭해 실제 달력 패널을 연 뒤, 달력의 날짜 셀(.ant-picker-cell)을 직접
  // 찾아 "클릭"한다. AntD는 버전에 관계없이 각 날짜 셀의 title 속성을 항상
  // `YYYY-MM-DD`(ISO) 형식으로 심는다 — 화면에 보이는 표시 형식(점/슬래시 등)이
  // 무엇이든 title은 항상 이 형식이므로, 화면 표시 형식을 추측하거나 역산할
  // 필요가 전혀 없다. 목표 날짜의 셀이 현재 보이는 달에 없으면(예: 오늘이
  // 9월인데 8월 15일이 필요) 표준 AntD 헤더의 "이전 달" 버튼
  // (.ant-picker-header-prev-btn / -super-prev-btn)을 최대 4번까지 눌러가며
  // 다시 찾는다. 셀을 찾아 클릭한 뒤에는 그 셀에 AntD가 실제로 붙이는 선택
  // 표시 class(selected/range-start/range-end 포함)가 붙었는지까지 확인해야
  // "성공"으로 인정한다 — 클릭만 하고 결과를 확인하지 않는 것은 금지.
  //
  // 시작일 셀 선택 실패 / 종료일 셀 선택 실패 / 최종 입력값 반영 확인 실패 중
  // 하나라도 있으면 그 시점에서 즉시 멈추고, 검색 버튼을 누르지 않고 플래그도
  // 세우지 않는다 — 확인되지 않은 상태로 조회를 실행하지 않는다.
  //
  // "최초 진입 시 1회"는 이전과 동일하게 chrome.storage.local의 영구 플래그로
  // 구현한다 — 실제로 검색까지 실행했을 때만 플래그를 세워 이후 절대 다시
  // 건드리지 않는다. 그래야 사용자가 과거 청산 조회를 위해 직접 기간을
  // 바꿔도 자동으로 되돌리지 않는다.
  const FORBIDDEN_PRESET_TEXT = "다음 30일"; // 이 문구와 일치하는 요소는 어떤 경우에도 클릭하지 않는다(방어적 이중 체크)

  function resolveUniqueControlByText(text) {
    const normalized = normalize(text);
    const candidates = Array.from(
      document.querySelectorAll('button, [role="button"], [role="tab"], [role="radio"], [role="option"], label')
    ).filter((el) => !el.closest("table") && normalize(el.textContent || "") === normalized);
    return candidates.length === 1 ? candidates[0] : null;
  }

  function resolveUniqueSearchButton() {
    for (const label of ["검색", "조회", "검색하기", "조회하기"]) {
      const found = resolveUniqueControlByText(label);
      if (found) return found;
    }
    return null;
  }

  // 요소 자신의 "직접" 텍스트(자식 요소 텍스트 제외)만 뽑는다 — 프리셋
  // 버튼처럼 특정 태그를 확정할 수 없는 말단(leaf) 텍스트 요소를 찾을 때,
  // 텍스트를 포함하는 거대한 상위 컨테이너까지 잘못 잡히지 않게 하기 위함이다.
  function ownTextOnly(el) {
    let text = "";
    for (const node of el.childNodes) {
      if (node.nodeType === Node.TEXT_NODE) text += node.textContent;
    }
    return text;
  }

  // 태그 종류를 가정하지 않고(button/li/span/div 등 무엇이든), 표 바깥에서
  // 해당 텍스트를 "자기 자신의 텍스트"로 정확히 갖는 요소가 오직 하나뿐일
  // 때만 그 요소를 반환한다. 여러 개 있거나 없으면 null(추측하지 않음).
  function resolveUniqueLeafByExactText(text) {
    const normalized = normalize(text);
    if (!normalized) return null;
    const all = Array.from(document.querySelectorAll("body *"));
    const matches = all.filter((el) => {
      if (el.closest("table")) return false;
      if (el.children.length > 2) return false; // 텍스트 위주의 말단 요소로 한정
      return normalize(ownTextOnly(el)) === normalized;
    });
    return matches.length === 1 ? matches[0] : null;
  }

  // "기간검색" 라벨과 같은 필터 행/컨테이너 안에 있는 AntD Select 콤보박스를
  // 찾는다. 동적 id(_r_7_ 등)는 절대 사용하지 않고, 라벨에서부터 부모를
  // 최대 6단계까지 올라가며 그 안에 콤보박스가 "정확히 하나"인 지점을 찾는다.
  function resolveDateTypeCombobox() {
    const label = resolveUniqueLeafByExactText("기간검색");
    if (!label) return { combobox: null, reason: "label-not-found" };

    let node = label.parentElement;
    for (let depth = 0; depth < 6 && node; depth++) {
      const combos = Array.from(node.querySelectorAll('input[role="combobox"]')).filter(
        (el) => !el.closest("table")
      );
      if (combos.length === 1) return { combobox: combos[0], reason: "found", depth };
      if (combos.length > 1) return { combobox: null, reason: "ambiguous-multiple-comboboxes" };
      node = node.parentElement;
    }
    return { combobox: null, reason: "combobox-not-found-near-label" };
  }

  // 요소가 실제로 사용자에게 보이는 상태인지 확인한다. rc-virtual-list(AntD
  // Select 드롭다운의 가상 리스트) 등은 높이 측정용 "숨김 템플릿" 요소를
  // DOM에 함께 두는 경우가 있어, aria-hidden/visibility:hidden/display:none과
  // 크기 0인 요소를 모두 걸러내야 그런 템플릿을 실수로 클릭하지 않는다.
  function isElementVisible(el) {
    if (!el) return false;
    if (el.getAttribute && el.getAttribute("aria-hidden") === "true") return false;
    let style = null;
    try {
      style = getComputedStyle(el);
    } catch {
      style = null;
    }
    if (style && (style.visibility === "hidden" || style.display === "none")) return false;
    if (el.offsetParent === null) {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) return false;
    }
    return true;
  }

  // 옵션 라벨 텍스트를 얻는다. AntD는 옵션 요소에 title 속성으로 라벨 전체를
  // 담아두는 경우가 많아(줄바꿈 없이 항상 전체 텍스트) title을 우선 신뢰하고,
  // 없으면 aria-label, 그래도 없으면 화면에 보이는 textContent를 쓴다.
  function labelTextOf(el) {
    const title = el.getAttribute && el.getAttribute("title");
    if (title && title.trim()) return title.trim();
    const ariaLabel = el.getAttribute && el.getAttribute("aria-label");
    if (ariaLabel && ariaLabel.trim()) return ariaLabel.trim();
    return (el.textContent || "").trim();
  }

  // AntD Select의 "현재 선택값" 텍스트를 읽는다. combobox(input) 자체의
  // value는 검색용 임시 텍스트일 뿐이라 신뢰할 수 없어, 가장 가까운
  // .ant-select 안에서 실제 선택값을 보여주는 표시 요소를 직접 읽는다.
  function readComboboxSelectedLabel(combobox) {
    const wrapper = combobox.closest(".ant-select") || combobox.parentElement;
    if (!wrapper) return "";
    const displayEl =
      wrapper.querySelector(".ant-select-selection-item") ||
      wrapper.querySelector(".ant-select-content-item") ||
      wrapper.querySelector(".ant-select-content") ||
      null;
    if (!displayEl) return "";
    const title = displayEl.getAttribute("title");
    return (title || displayEl.textContent || "").trim();
  }

  // 실제 사용자 클릭을 흉내내 pointerdown → mousedown → mouseup → click
  // 순서로 이벤트를 쏜다. combobox.click()만으로는 AntD의 열림 핸들러가
  // 반응하지 않는 경우(포인터 이벤트 기반 핸들러 등)가 있어, 실제 브라우저가
  // 만드는 이벤트 순서를 그대로 재현한다.
  function dispatchPointerSequence(el) {
    const opts = { bubbles: true, cancelable: true, composed: true, view: window };
    try {
      el.dispatchEvent(new PointerEvent("pointerdown", opts));
    } catch {
      // PointerEvent를 지원하지 않는 환경은 무시하고 마우스 이벤트만 진행
    }
    el.dispatchEvent(new MouseEvent("mousedown", opts));
    el.dispatchEvent(new MouseEvent("mouseup", opts));
    el.dispatchEvent(new MouseEvent("click", opts));
  }

  // 드롭다운을 실제로 연다. 1차: .ant-select-selector(없으면 .ant-select,
  // 그래도 없으면 부모)에 실제 클릭과 같은 이벤트 시퀀스를 쏜다. 2차(1차로
  // 안 열리면): combobox에 포커스를 준 뒤 ArrowDown 키 이벤트로 연다(AntD는
  // 포커스된 콤보박스에서 ArrowDown으로 드롭다운을 여는 접근성 동작을
  // 지원한다). 매 시도 후 aria-expanded="true"로 실제로 열렸는지 확인한다.
  async function openAntSelectDropdown(combobox) {
    const clickTarget =
      combobox.closest(".ant-select-selector") || combobox.closest(".ant-select") || combobox.parentElement;

    combobox.focus();
    dispatchPointerSequence(clickTarget || combobox);
    await sleep(220);
    if (combobox.getAttribute("aria-expanded") === "true") {
      return { opened: true, via: "pointer-sequence" };
    }

    combobox.focus();
    combobox.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowDown", code: "ArrowDown", bubbles: true, cancelable: true })
    );
    await sleep(220);
    return { opened: combobox.getAttribute("aria-expanded") === "true", via: "arrow-down-fallback" };
  }

  // combobox의 접근성 연결(aria-controls/aria-owns)로 실제 열린 리스트박스를
  // 우선 찾는다. 연결 정보가 없거나 그 id의 요소를 못 찾으면, document.body
  // 아래 실제로 보이는(visible) .ant-select-dropdown들을 스캔한다 — 동적
  // id를 코드에 하드코딩하지 않고, combobox가 스스로 알려주는 연결 정보나
  // 표준 AntD 드롭다운 class만 사용한다.
  function findOptionCandidatesForCombobox(combobox) {
    const listboxId = combobox.getAttribute("aria-controls") || combobox.getAttribute("aria-owns");
    const optionSelector = '[role="option"], .ant-select-item-option, .ant-select-item';

    if (listboxId) {
      const listbox = document.getElementById(listboxId);
      if (listbox) {
        const candidates = Array.from(listbox.querySelectorAll(optionSelector)).filter(
          (el) => !el.closest("table")
        );
        return { source: "aria-controls", listboxFound: true, candidates };
      }
      return { source: "aria-controls", listboxFound: false, candidates: [] };
    }

    const dropdowns = Array.from(document.querySelectorAll(".ant-select-dropdown")).filter(
      (el) => !el.closest("table") && isElementVisible(el)
    );
    const candidates = dropdowns.flatMap((dd) => Array.from(dd.querySelectorAll(optionSelector)));
    return { source: "body-dropdown-scan", listboxFound: dropdowns.length > 0, candidates };
  }

  // 기존 option/leaf/키보드 추정 대신, 화면 중앙 hit target만 진단하고 클릭한다.
  // 매칭된 option "행" 요소(예: role=option이 달린 wrapper)가 아니라, 그
  // 안에서 목표 텍스트를 실제로 담고 있는 가장 안쪽(leaf) 요소를 찾는다.
  // AntD는 흔히 `.ant-select-item-option-content` 같은 내부 요소에 라벨을
  // 두는데, 클릭 핸들러가 그 안쪽 요소에만 붙어 있고 바깥 wrapper 클릭이
  // 무시되는 구성일 가능성을 대비한다. 자기 자신의 직접 텍스트가 이미
  // 목표와 같으면 그 자리에서 멈추고, 아니면 목표 텍스트를 정확히 담은
  // "자식이 하나뿐인" 경로를 따라 한 단계씩만 더 안쪽으로 내려간다 —
  // 여러 자식이 후보가 되면(애매하면) 더 내려가지 않고 그 지점에서 멈춘다.
  function findClickableLeaf(option, normalizedText) {
    let node = option;
    for (let depth = 0; depth < 5; depth++) {
      if (normalize(ownTextOnly(node)) === normalizedText) return node;
      const childCandidates = Array.from(node.children).filter(
        (c) => normalize(c.textContent || "") === normalizedText
      );
      if (childCandidates.length !== 1) break;
      node = childCandidates[0];
    }
    return node;
  }

  function describeHitTarget(el) {
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    return {
      tag: el.tagName.toLowerCase(),
      className: String(el.className || "").slice(0, 160),
      text: (el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 80),
      pointerEvents: style.pointerEvents,
      visibility: style.visibility,
      display: style.display,
      ariaDisabled: el.getAttribute("aria-disabled"),
      role: el.getAttribute("role"),
      rect: {
        top: Math.round(rect.top),
        left: Math.round(rect.left),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      },
    };
  }

  function dispatchPointerSequenceAt(el, x, y) {
    const opts = {
      bubbles: true,
      cancelable: true,
      composed: true,
      view: window,
      clientX: x,
      clientY: y,
      button: 0,
      buttons: 1,
    };
    try {
      el.dispatchEvent(new PointerEvent("pointerdown", opts));
    } catch {
      // PointerEvent를 지원하지 않는 환경은 마우스 이벤트로 계속한다.
    }
    el.dispatchEvent(new MouseEvent("mousedown", opts));
    el.dispatchEvent(new MouseEvent("mouseup", { ...opts, buttons: 0 }));
    el.dispatchEvent(new MouseEvent("click", { ...opts, buttons: 0 }));
  }

  // option 요소 자체가 "선택됨" 표시를 실제로 확인한다.
  // 변화와는 별개의 근거). aria-selected="true"이거나, AntD가 실제로 붙이는
  // selected class가 있으면 선택된 것으로 본다.
  function isOptionMarkedSelected(option) {
    if (option.getAttribute("aria-selected") === "true") return true;
    return /selected/.test(String(option.className || ""));
  }

  // "발주일" 선택 전체 흐름:
  //   1) 현재 선택값이 이미 "발주일"이면 드롭다운을 열지 않고 바로 성공.
  //   2) 아니면 드롭다운을 실제로 열고,
  //      aria-expanded=true로 실제로 열렸는지 확인 — 못 열었으면
  //      "dropdown-not-opened"로 끝낸다(옵션을 못 찾은 것과 구분).
  //   3) aria-controls로 연결된 리스트박스를 우선 탐색하고, 없으면 body의
  //      열린 드롭다운을 스캔해 정확히 "발주일" 하나만 골라낸다.
  //   4) visible 옵션 중앙에 debugger trusted 입력을 전달 → readComboboxSelectedLabel로
  //      현재 선택값이 실제로 "발주일"로 바뀌었는지 검증. 드롭다운만 열리고 값이
  //      안 바뀐 상태를 성공으로 처리하지 않는다(검증 통과해야만 ok:true).
  // dateType combobox를 찾는 로직(resolveDateTypeCombobox)과 날짜범위/검색
  // 로직은 이 함수에서 전혀 건드리지 않는다.
  async function selectDateTypeOption(combobox, optionText) {
    const normalized = normalize(optionText);

    const currentLabel = readComboboxSelectedLabel(combobox);
    if (normalize(currentLabel) === normalized) {
      return { ok: true, matchedVia: "already-selected", currentLabel };
    }

    if (normalize(currentLabel) !== normalize("입고예정일")) {
      return { ok: false, reason: "unexpected-current-value", currentLabel };
    }

    const openResult = await openAntSelectDropdown(combobox);
    if (!openResult.opened || combobox.getAttribute("aria-expanded") !== "true") {
      return { ok: false, reason: "dropdown-not-opened", currentLabel, openVia: openResult.via };
    }

    const options = Array.from(document.querySelectorAll(".ant-select-item-option")).filter(
      (el) => isElementVisible(el) && normalize(labelTextOf(el)) === normalized
    );
    if (options.length !== 1) return { ok: false, reason: options.length ? "option-ambiguous" : "option-not-found" };
    const option = options[0];
    const rect = option.getBoundingClientRect();
    const x = rect.left + rect.width / 2, y = rect.top + rect.height / 2;
    const hit = document.elementFromPoint(x, y);
    if (!hit || !option.contains(hit)) return { ok: false, reason: "hit-target-mismatch" };
    const trusted = await new Promise((resolve) => {
      noidbSafeRuntimeSendMessage({ type: "NOIDB_TRUSTED_DATE_OPTION_CLICK", x, y }, resolve);
    });
    if (!trusted?.ok) return { ok: false, reason: trusted?.reason || "trusted-input-failed" };
    await sleep(220);

    const selectedLabelAfter = readComboboxSelectedLabel(combobox);
    return normalize(selectedLabelAfter) === normalized
      ? { ok: true, matchedVia: "debugger-trusted-click", selectedLabelAfter }
      : { ok: false, reason: "trusted-click-no-selection-change", currentLabel, selectedLabelAfter };
  }

  // 실제로 "열려 있고 보이는" 달력 패널만 대상으로 삼는다. 숨겨진 다른
  // picker나 미사용 패널(닫힌 드롭다운 잔재 등)은 완전히 제외한다.
  function findOpenCalendarPanel() {
    const dropdowns = Array.from(document.querySelectorAll(".ant-picker-dropdown")).filter(
      (el) => !el.closest("table") && isElementVisible(el)
    );
    for (const dd of dropdowns) {
      const panel = dd.querySelector(".ant-picker-panel-container");
      if (panel && isElementVisible(panel)) return panel;
    }
    return null;
  }

  // AntD가 선택된 셀에 실제로 붙이는 class(selected / range-start / range-end)가
  // 있는지 확인한다 — 클릭만 하고 결과를 확인하지 않는 것을 방지한다.
  function isCellSelected(cell) {
    if (!cell) return false;
    const pattern = /selected|range-start|range-end/;
    if (pattern.test(String(cell.className || ""))) return true;
    const inner = cell.querySelector(".ant-picker-cell-inner");
    return !!(inner && pattern.test(String(inner.className || "")));
  }

  // "2026-08-15" 형태의 title에서 { year, month }를 뽑는다. 형식이 다르면
  // (추측하지 않고) null을 반환한다.
  function parseYearMonthFromTitle(title) {
    if (!title) return null;
    const m = String(title).match(/^(\d{4})-(\d{2})-\d{2}$/);
    if (!m) return null;
    return { year: Number(m[1]), month: Number(m[2]) };
  }

  // 패널이 현재 표시 중인 연/월을, 헤더 텍스트가 아니라 패널 안에 실제로
  // 존재하는 날짜 셀들의 title(YYYY-MM-DD, AntD가 항상 심는 값)을 근거로
  // 판별한다. 헤더 버튼/텍스트 구조를 추측해 파싱하는 방식은 실제 화면에서
  // null만 나와 신뢰할 수 없었다(2026-09-13 실기기 확인).
  //
  // 1순위: title이 있는 td.ant-picker-cell-in-view 요소 — "현재 표시 월"에
  // 속한 날짜만 이 class가 붙으므로(앞/뒤 달 패딩 날짜는 안 붙음), 그 중
  // 아무 셀이나 하나만 봐도 연/월이 정확하다. 첫 번째 보이는 셀만 임의로
  // 집지 않고, in-view 셀들 중 하나를 명시적으로 사용한다.
  // 2순위: in-view class 자체가 없는 구성일 수 있어, title이 있는 모든
  // 보이는 셀의 "연-월"별 개수를 세어 가장 많은 연-월을 채택한다(현재 달은
  // 28~31일, 앞/뒤 패딩은 보통 6일 이하이므로 다수결로 안정적으로 구분됨) —
  // 첫 셀 하나만 보고 앞/뒤 달을 잘못 판단하지 않기 위함이다.
  function detectCalendarMonthFromCells(panel) {
    const inViewCells = Array.from(panel.querySelectorAll("td.ant-picker-cell-in-view[title]")).filter(
      (el) => isElementVisible(el)
    );
    for (const cell of inViewCells) {
      const ym = parseYearMonthFromTitle(cell.getAttribute("title"));
      if (ym) return ym;
    }

    const allCells = Array.from(panel.querySelectorAll("td.ant-picker-cell[title]")).filter((el) =>
      isElementVisible(el)
    );
    if (allCells.length === 0) return null;

    const counts = new Map();
    for (const cell of allCells) {
      const ym = parseYearMonthFromTitle(cell.getAttribute("title"));
      if (!ym) continue;
      const key = `${ym.year}-${ym.month}`;
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    if (counts.size === 0) return null;

    let bestKey = null;
    let bestCount = -1;
    for (const [key, count] of counts) {
      if (count > bestCount) {
        bestCount = count;
        bestKey = key;
      }
    }
    const [y, m] = bestKey.split("-").map(Number);
    return { year: y, month: m };
  }

  // 패널이 현재 표시 중인 연/월을 판별한다. 날짜 셀 title 기반 판별을
  // 우선하고(실제 DOM에 항상 존재), 그것으로도 못 정하면(패널이 비어있는 등)
  // 헤더 텍스트(.ant-picker-year-btn / .ant-picker-month-btn 또는 헤더 뷰
  // 전체 텍스트) 파싱을 마지막 보조 수단으로만 시도한다. 둘 다 실패하면
  // null을 반환해 호출자가 실패 처리하게 한다.
  function readCalendarHeaderMonth(panel) {
    const fromCells = detectCalendarMonthFromCells(panel);
    if (fromCells) return fromCells;

    const headerView = panel.querySelector(".ant-picker-header-view");
    if (!headerView) return null;

    const yearBtn = headerView.querySelector(".ant-picker-year-btn");
    const monthBtn = headerView.querySelector(".ant-picker-month-btn");

    let year = null;
    let month = null;
    if (yearBtn) {
      const m = (yearBtn.textContent || "").match(/\d{4}/);
      if (m) year = Number(m[0]);
    }
    if (monthBtn) {
      const m = (monthBtn.textContent || "").match(/\d{1,2}/);
      if (m) month = Number(m[0]);
    }

    if (year == null || month == null) {
      const text = (headerView.textContent || "").trim();
      const yearMatch = text.match(/\d{4}/);
      if (yearMatch) {
        year = Number(yearMatch[0]);
        const monthMatch = text.replace(yearMatch[0], "").match(/\d{1,2}/);
        if (monthMatch) month = Number(monthMatch[0]);
      }
    }

    if (year == null || month == null || month < 1 || month > 12) return null;
    return { year, month };
  }

  // 패널 안에서 "이전/다음 달" 버튼만 찾는다(super-prev/next는 보통 연 단위
  // 이동이라, 정확히 1개월씩 계산해 이동하는 이 로직과 어긋날 수 있어
  // 제외한다). 표시되고 비활성화되지 않은 것만 후보로 삼는다.
  function findMonthNavButton(panel, direction) {
    const selector =
      direction === "prev" ? ".ant-picker-header-prev-btn" : ".ant-picker-header-next-btn";
    const candidates = Array.from(panel.querySelectorAll(selector)).filter((el) => !el.closest("table"));
    return (
      candidates.find((el) => {
        const rect = el.getBoundingClientRect();
        const style = getComputedStyle(el);
        return (
          rect.width > 0 &&
          rect.height > 0 &&
          style.visibility !== "hidden" &&
          style.display !== "none" &&
          el.getAttribute("aria-hidden") !== "true" &&
          el.getAttribute("aria-disabled") !== "true"
        );
      }) || null
    );
  }

  // 현재월과 목표월의 차이를 실제로 계산해, 그 횟수만큼만 이전/다음 달
  // 버튼을 누른다(무작정 여러 번 누르지 않음). 매 클릭 후 header가 실제로
  // 바뀌었는지 검증하고, 안 바뀌면 그 즉시 실패로 끝낸다.
  async function navigateCalendarToMonth(panel, targetYear, targetMonth) {
    let current = readCalendarHeaderMonth(panel);
    if (!current) return { ok: false, reason: "no-header-month-found", navigationClicks: 0 };

    const idxOf = (c) => c.year * 12 + (c.month - 1);
    const targetIdx = targetYear * 12 + (targetMonth - 1);
    const diff = targetIdx - idxOf(current);
    if (diff === 0) return { ok: true, currentMonth: current, navigationClicks: 0 };

    const direction = diff > 0 ? "next" : "prev";
    const neededClicks = Math.abs(diff);
    let clicks = 0;

    while (idxOf(current) !== targetIdx && clicks < neededClicks) {
      const btn = findMonthNavButton(panel, direction);
      if (!btn) {
        return { ok: false, reason: "nav-button-not-found", currentMonth: current, navigationClicks: clicks };
      }

      const before = current;
      btn.click();
      clicks += 1;
      await sleep(220);

      const after = readCalendarHeaderMonth(panel);
      if (!after) {
        return { ok: false, reason: "no-header-month-found-after-click", navigationClicks: clicks };
      }
      if (after.year === before.year && after.month === before.month) {
        return { ok: false, reason: "header-did-not-change-after-click", currentMonth: after, navigationClicks: clicks };
      }
      current = after;
    }

    if (idxOf(current) !== targetIdx) {
      return { ok: false, reason: "could-not-reach-target-month", currentMonth: current, navigationClicks: clicks };
    }
    return { ok: true, currentMonth: current, navigationClicks: clicks };
  }

  // 목표 날짜(ISO) 하나를 실제 열린 달력 패널 안에서만 찾아 선택한다:
  // (1) 열린 패널을 먼저 확정 → (2) 현재/목표 연월 차이만큼 정확히 이동 →
  // (3) 그 패널 "안에서만" td.ant-picker-cell[title=목표일]을 찾아(다른
  // 패널/문서 전체를 뒤지지 않음) disabled가 아닌 셀만 클릭 → (4) 선택 표시
  // class로 실제 반영을 재확인한다. 실패 시 요청받은 진단 필드를 모두 담아
  // 반환한다.
  async function selectRangeDateByIso(isoDate) {
    const panel = findOpenCalendarPanel();
    if (!panel) {
      return { ok: false, reason: "calendar-panel-not-open", openedCalendarFound: false };
    }

    const [targetYear, targetMonth] = isoDate.split("-").map(Number);
    const nav = await navigateCalendarToMonth(panel, targetYear, targetMonth);
    if (!nav.ok) {
      return {
        ok: false,
        reason: nav.reason,
        openedCalendarFound: true,
        currentCalendarMonth: nav.currentMonth || null,
        targetMonth: { year: targetYear, month: targetMonth },
        navigationClicks: nav.navigationClicks || 0,
      };
    }

    // 이동 중 패널이 다시 렌더링됐을 수 있으니 최신 참조로 다시 찾는다.
    const freshPanel = findOpenCalendarPanel() || panel;
    const visibleCells = Array.from(freshPanel.querySelectorAll("td.ant-picker-cell")).filter(isElementVisible);
    const targetCell = visibleCells.find(
      (el) => el.getAttribute("title") === isoDate && !String(el.className || "").includes("disabled")
    );

    if (!targetCell) {
      return {
        ok: false,
        reason: "target-cell-not-found-in-panel",
        openedCalendarFound: true,
        currentCalendarMonth: nav.currentMonth,
        targetMonth: { year: targetYear, month: targetMonth },
        navigationClicks: nav.navigationClicks,
        visibleCellCount: visibleCells.length,
        targetCellFound: false,
      };
    }

    targetCell.click();
    await sleep(220);

    const afterPanel = findOpenCalendarPanel();
    const afterCell =
      (afterPanel && afterPanel.querySelector(`td.ant-picker-cell[title="${isoDate}"]`)) || targetCell;
    const selected = isCellSelected(afterCell);

    return {
      ok: selected,
      reason: selected ? "selected" : "click-did-not-mark-selected",
      openedCalendarFound: true,
      currentCalendarMonth: nav.currentMonth,
      targetMonth: { year: targetYear, month: targetMonth },
      navigationClicks: nav.navigationClicks,
      visibleCellCount: visibleCells.length,
      targetCellFound: true,
    };
  }

  // 실제 달력 UI를 열어 셀 클릭 이벤트로 "오늘 기준 과거 30일(오늘 포함)"
  // 범위를 설정한다. input value를 직접 바꾸지 않는다 — 날짜 입력칸을
  // 클릭해 달력을 연 뒤, 시작일/종료일 각각의 실제 날짜 셀을 찾아 클릭하고,
  // AntD가 붙이는 선택 표시까지 확인해야 성공으로 인정한다. 어느 단계든
  // 확인되지 않으면 그 단계 이름과 함께 실패를 반환한다(검색 버튼은 호출자가
  // 누르지 않는다).
  async function trySetPast30DayRange() {
    const todayEl = resolveUniqueLeafByExactText("오늘");
    const yesterdayEl = resolveUniqueLeafByExactText("어제");
    const next7El = resolveUniqueLeafByExactText("다음 7일") || resolveUniqueLeafByExactText("다음7일");
    const next30El =
      resolveUniqueLeafByExactText("다음 30일") || resolveUniqueLeafByExactText(FORBIDDEN_PRESET_TEXT);

    if (!todayEl || !yesterdayEl) {
      return { ok: false, step: "시작일 선택", reason: "preset-anchor-not-found" };
    }
    // 프리셋 버튼은 날짜 입력칸의 위치를 찾는 "이정표"로만 쓰고 클릭하지
    // 않는다. 절대 클릭 금지 대상과 혼동하지 않았는지만 이중 확인한다.
    if (todayEl === next30El || normalize(todayEl.textContent || "") === normalize(FORBIDDEN_PRESET_TEXT)) {
      return { ok: false, step: "시작일 선택", reason: "safety-abort-today-matched-forbidden-text" };
    }

    function commonAncestor(a, b) {
      if (!a || !b) return a || b || null;
      const ancestors = new Set();
      for (let n = a; n; n = n.parentElement) ancestors.add(n);
      for (let n = b; n; n = n.parentElement) if (ancestors.has(n)) return n;
      return null;
    }

    let presetContainer = commonAncestor(todayEl, yesterdayEl);
    if (next7El) presetContainer = commonAncestor(presetContainer, next7El) || presetContainer;
    if (!presetContainer) return { ok: false, step: "시작일 선택", reason: "no-common-container" };

    // 실제 날짜 입력칸은 프리셋 버튼들의 최소 공통 컨테이너 "안"이 아니라
    // 같은 필터 행의 "형제" 위치에 있을 수 있어, 못 찾으면 한 단계씩 상위로
    // 넓혀가며(최대 5단계) 입력칸이 나타나는 첫 지점을 찾는다.
    let container = presetContainer;
    let dateInputs = [];
    for (let depth = 0; depth < 5 && container; depth++) {
      dateInputs = Array.from(container.querySelectorAll("input")).filter(
        (el) =>
          el.type !== "checkbox" &&
          el.type !== "radio" &&
          el.getAttribute("role") !== "combobox" && // 기간검색 유형 select는 날짜 입력이 아니므로 제외
          !el.closest("table")
      );
      if (dateInputs.length >= 1) break;
      container = container.parentElement;
    }

    if (dateInputs.length < 1) {
      return { ok: false, step: "시작일 선택", reason: "no-editable-date-inputs-found" };
    }
    if (dateInputs.length > 4) {
      return { ok: false, step: "시작일 선택", reason: "too-many-candidate-inputs", inputCount: dateInputs.length };
    }

    const now = new Date();
    const isoOf = (d) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const endIso = isoOf(now);
    const startDate = new Date(now);
    startDate.setDate(startDate.getDate() - 29); // 오늘 포함 30일 = 오늘부터 29일 전까지
    const startIso = isoOf(startDate);

    dateInputs[0].focus(); // 값 타이핑이 아니라 포커스+클릭으로 달력 패널을 연다
    dateInputs[0].click();
    await sleep(280);

    const startResult = await selectRangeDateByIso(startIso);
    if (!startResult.ok) {
      return { ok: false, step: "시작일 선택", startIso, endIso, ...startResult };
    }

    if (dateInputs.length >= 2) {
      dateInputs[1].focus(); // 독립된 두 개의 DatePicker일 수도 있어 종료일 입력도 명시적으로 포커스+클릭
      dateInputs[1].click();
      await sleep(220);
    }

    const endResult = await selectRangeDateByIso(endIso);
    if (!endResult.ok) {
      return { ok: false, step: "종료일 선택", startIso, endIso, ...endResult };
    }

    await sleep(200);
    const finalStart = dateInputs[0].value || "";
    const finalEnd = dateInputs.length >= 2 ? dateInputs[1].value || "" : "";

    // 셀 클릭 표시(class)뿐 아니라, 실제로 입력칸에 반영된 값까지 읽어
    // 다시 한번 확인한다 — "날짜가 실제 화면에 반영된 것을 읽어 검증".
    if (!finalStart || (dateInputs.length >= 2 && (!finalEnd || finalStart === finalEnd))) {
      return { ok: false, step: "종료일 선택", reason: "final-input-value-check-failed", startIso, endIso, finalStart, finalEnd };
    }

    return { ok: true, startIso, endIso, finalStart, finalEnd, inputCount: dateInputs.length };
  }

  async function tryAutoApplyDefaultFilter() {
    if (!location.pathname.includes(ORDER_LIST_URL_PATH)) return; // 발주리스트 화면 외에는 동작 금지
    if (!noidbGetStorageLocal()) return;

    // 이 함수는 여러 초에 걸친 비동기 흐름(달력 열기/월 이동/검색 대기 등
    // 다수의 await sleep)을 거치므로, 실행 도중 확장이 리로드되어 컨텍스트가
    // 무효화될 가능성이 이 파일의 다른 어떤 흐름보다 높다. get을 Promise로
    // 감쌀 때 try/catch 없이 두면, 컨텍스트 무효화로 동기 예외가 던져질 경우
    // Promise가 처리되지 않은 채 reject되어 별도의 "unhandled promise
    // rejection" 오류로 남는다 — 그래서 여기서도 명시적으로 감싼다.
    const stored = await noidbSafeStorageGetAsync([AUTO_FILTER_APPLIED_KEY]);
    if (stored[AUTO_FILTER_APPLIED_KEY]) {
      const existing = resolveDateTypeCombobox();
      const current = existing.combobox ? readComboboxSelectedLabel(existing.combobox) : "";
      if (normalize(current) === normalize("발주일")) return; // 현재 화면이 이미 목표 상태면 재실행하지 않음
    }

    // 팝업에는 "성공/실패"와, 실패 시 "발주일 선택/시작일 선택/종료일 선택/
    // 검색 실행" 중 어느 단계에서 멈췄는지만 보여준다(원본 DOM/JSON은 팝업
    // 기본 화면에 노출하지 않음 — 상세 값은 이 diagnostics 객체 안에만 남고
    // 팝업의 "상세 진단" 영역에서만 펼쳐볼 수 있다).
    const diagnostics = { collectedAt: new Date().toISOString(), url: location.href };

    function abort(step, extra) {
      diagnostics.failedStep = step;
      Object.assign(diagnostics, extra);
      console.log(`[NOIDB-POC] auto-filter: '${step}' 단계에서 중단(검색 안 누름, 플래그 안 세움)`, diagnostics);
      safeStorageSet({ [AUTO_FILTER_DIAG_KEY]: diagnostics });
    }

    const { combobox: dateTypeCombobox, reason: comboboxReason } = resolveDateTypeCombobox();
    diagnostics.dateTypeComboboxFound = !!dateTypeCombobox;
    diagnostics.dateTypeComboboxReason = comboboxReason;
    if (!dateTypeCombobox) {
      abort("발주일 선택", {});
      return;
    }

    const selectResult = await selectDateTypeOption(dateTypeCombobox, "발주일");
    diagnostics.dateTypeSelect = selectResult;
    if (!selectResult.ok) {
      abort("발주일 선택", {});
      return;
    }

    const rangeResult = await trySetPast30DayRange();
    diagnostics.dateRange = rangeResult;

    // 달력 셀의 selected 표시는 AntD 렌더링 타이밍에 따라 stale할 수 있다.
    // 검색 직전 실제 화면의 세 값이 목표와 일치하는 경우에만 최종 성공으로
    // 인정한다. 이 검증은 날짜 계산·선택 로직을 다시 실행하지 않는다.
    const finalDateInputs = Array.from(document.querySelectorAll("input")).filter(
      (el) => el.type !== "checkbox" && el.type !== "radio" && el.getAttribute("role") !== "combobox" &&
        !el.closest("table") && isElementVisible(el) && /^\d{4}-\d{2}-\d{2}$/.test(el.value || "")
    );
    const finalStart = finalDateInputs[0]?.value || "";
    const finalEnd = finalDateInputs[1]?.value || "";
    const finalDateType = readComboboxSelectedLabel(dateTypeCombobox);
    const finalFilterMatches = normalize(finalDateType) === normalize("발주일") &&
      finalStart === rangeResult.startIso && finalEnd === rangeResult.endIso;
    diagnostics.finalFilter = { dateType: finalDateType, start: finalStart, end: finalEnd, expectedStart: rangeResult.startIso || "", expectedEnd: rangeResult.endIso || "", matches: finalFilterMatches };
    if (!finalFilterMatches) {
      abort(rangeResult.ok ? "검색 실행" : (rangeResult.step || "시작일 선택"), {});
      return;
    }

    const searchBtn = resolveUniqueSearchButton();
    diagnostics.searchButtonFound = !!searchBtn;
    if (!searchBtn) {
      abort("검색 실행", {});
      return;
    }

    searchBtn.click();
    await sleep(900); // 검색 결과 로딩 대기 — 추가 클릭/입력 없음

    diagnostics.failedStep = null;
    safeStorageSet({ [AUTO_FILTER_APPLIED_KEY]: true, [AUTO_FILTER_DIAG_KEY]: { ...diagnostics, clicked: true } });
    console.log(
      "[NOIDB-POC] auto-filter: 발주일 + 오늘 기준 과거 30일 자동 적용 및 검색 완료(최초 1회, 이후 다시 동작 안 함)",
      diagnostics
    );

    runOrderListScanGuarded("after-auto-filter");
  }

  // SPA라 필터바가 비동기로 렌더링될 수 있어 약간의 지연 후 1회만 시도한다.
  // (표 스캔과 달리 이 필터 적용 자체는 재시도 루프를 두지 않는다 — 실패하면
  // 플래그를 세우지 않은 채 다음 페이지 로드 때 자연스럽게 다시 시도된다.
  // 같은 로드 안에서 반복 시도하지 않으므로 무한 재실행 위험이 없다.)
  setTimeout(() => tryAutoApplyDefaultFilter(), 1500);

  runOrderListScanGuarded("initial");
  // Supplier Hub는 SPA라 표가 비동기로 렌더링될 수 있어 짧게 재시도한다.
  // (페이지 넘김이나 다른 조작은 하지 않음 — 초기 렌더링 대기 목적)
  [1500, 4000].forEach((delay) => {
    setTimeout(() => runOrderListScanGuarded(`retry-${delay}ms`), delay);
  });

  noidbSafeAddRuntimeMessageListener((message, _sender, sendResponse) => {
    if (message?.type === "NOIDB_POC_RESCAN_ORDER_LIST") {
      runOrderListScanGuarded("manual-rescan")
        .then((result) => {
          sendResponse({
            ok: true,
            found: result.found,
            rowCount: result.rowCount || 0,
            excludedPurchaseTypeCount: result.excludedPurchaseTypeCount || 0,
          });
        })
        .catch((e) => {
          console.warn("[NOIDB-POC] NOIDB_POC_RESCAN_ORDER_LIST 처리 중 오류:", e);
          try {
            sendResponse({ ok: false, error: String(e) });
          } catch {
            // 메시지 포트가 이미 닫혔을 수 있음 — 무시
          }
        });
      return true;
    }
    if (message?.type === "NOIDB_POC_COLLECT_DIAGNOSTICS") {
      try {
        const diagnostics = collectDiagnostics("manual-diagnostics");
        sendResponse({
          ok: true,
          tableCandidateCount: diagnostics.tableCandidates.length,
          ariaGridCandidateCount: diagnostics.ariaGridCandidates.length,
          numericPatternCount: diagnostics.numericTextRowPatterns.length,
        });
      } catch (e) {
        console.warn("[NOIDB-POC] NOIDB_POC_COLLECT_DIAGNOSTICS 처리 중 오류:", e);
        try {
          sendResponse({ ok: false, error: String(e) });
        } catch {
          // 메시지 포트가 이미 닫혔을 수 있음 — 무시
        }
      }
      return true;
    }
    return undefined;
  });
})();

// 7단계: 발주리스트 필터바 실제 DOM 진단 (읽기 전용, 클릭/입력 없음)
//
// 목적: 6단계 자동필터 로직이 추측한 "발주일"/"최근 30일"/"검색" 문구가
// 실제 화면에 정확히 그 문구로 있는지, 어떤 태그/속성(button/role=tab/
// role=radio/label 등, aria-selected/aria-checked/aria-pressed/checked)으로
// 되어 있는지 확인하기 위한 것이다. 브라우저 자동화 도구가 이 화면에
// 접근하지 못해(2026-09-13 기준) 개발자가 직접 실제 DOM을 본 적이 없으므로,
// 사용자가 화면에서 직접 이 진단을 실행해 결과를 공유해줘야 한다.
//
// 절대 하지 않는 것: 클릭, 입력, 값 변경, 폼 제출. 오직 텍스트/속성만 읽는다.
// <table> 안의 요소(체크박스/발주전송/업로드/상태변경 버튼 등)는 완전히
// 제외한다 — 필터바는 표 바깥에 있다고 보기 때문이다.
(() => {
  const FILTER_BAR_DIAG_KEY = "noidbPocFilterBarDiagnostics";
  const ORDER_LIST_URL_PATH = "/po-web/purchase/order/list";
  const MAX_CANDIDATES = 200;

  // chrome?.storage?.local는 확장이 리로드/비활성화된 뒤에도 여전히 존재하는
  // 객체라 이 존재 체크만으로는 안전하지 않다 — 실제 .set() 호출 시
  // "Extension context invalidated" 예외가 던져질 수 있어 try/catch로 감싼다.
  function safeStorageSet(obj, cb) {
    noidbSafeStorageSet(obj, cb);
  }

  // 필터바일 가능성이 높은 텍스트를 미리 골라내기 위한 "힌트"일 뿐이다 —
  // 이 값으로 클릭 대상을 정하지 않는다(오직 참고 표시용 looksRelevant 필드).
  const RELEVANT_HINT_RE = /(발주|입고|반출|등록|확정|일자|날짜|기간|검색|조회|오늘|어제|최근|개월|일)/;

  function shortClassName(el) {
    const cls = el.className;
    return typeof cls === "string" ? cls.trim().slice(0, 80) : "";
  }

  function ancestorSummary(el) {
    const parts = [];
    let node = el.parentElement;
    for (let depth = 0; depth < 3 && node && node !== document.body; depth++) {
      const cls = shortClassName(node);
      parts.push(
        `${node.tagName.toLowerCase()}${node.id ? "#" + node.id : ""}${
          cls ? "." + cls.replace(/\s+/g, ".") : ""
        }`
      );
      node = node.parentElement;
    }
    return parts.join(" < ");
  }

  function collectFilterBarDiagnostics(reason) {
    const tables = Array.from(document.querySelectorAll("table"));
    const isInsideTable = (el) => tables.some((t) => t.contains(el));

    const selector = [
      "button",
      '[role="button"]',
      '[role="tab"]',
      '[role="radio"]',
      '[role="option"]',
      '[role="combobox"]',
      "select",
      'input[type="radio"]',
      'input[type="checkbox"]',
      'input[type="date"]',
      'input[type="text"]',
      "a",
      "label",
    ].join(", ");

    const candidates = Array.from(document.querySelectorAll(selector))
      .filter((el) => !isInsideTable(el))
      .map((el) => {
        const text = (el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 60);
        let rect = { top: 0, left: 0, width: 0, height: 0 };
        try {
          rect = el.getBoundingClientRect();
        } catch {
          rect = { top: 0, left: 0, width: 0, height: 0 };
        }
        return {
          tag: el.tagName.toLowerCase(),
          role: el.getAttribute("role") || undefined,
          type: el.getAttribute("type") || undefined,
          text: text || undefined,
          placeholder: el.getAttribute("placeholder") || undefined,
          ariaSelected: el.getAttribute("aria-selected") || undefined,
          ariaChecked: el.getAttribute("aria-checked") || undefined,
          ariaPressed: el.getAttribute("aria-pressed") || undefined,
          checked: el.tagName === "INPUT" ? el.checked : undefined,
          id: el.id || undefined,
          className: shortClassName(el) || undefined,
          ancestors: ancestorSummary(el),
          top: Math.round(rect.top),
          left: Math.round(rect.left),
          visible: rect.width > 0 && rect.height > 0,
          looksRelevant: RELEVANT_HINT_RE.test(text),
        };
      })
      // 텍스트도 없고 select/date/checkbox/radio도 아닌 요소(빈 a 태그 등)는 제외
      .filter((c) => c.text || ["select", "input"].includes(c.tag))
      .sort((a, b) => a.top - b.top)
      .slice(0, MAX_CANDIDATES);

    const selectOptions = Array.from(document.querySelectorAll("select"))
      .filter((el) => !isInsideTable(el))
      .map((sel) => ({
        id: sel.id || undefined,
        className: shortClassName(sel) || undefined,
        options: Array.from(sel.options || []).map((o) => o.textContent.trim()),
      }));

    const result = {
      collectedAt: new Date().toISOString(),
      url: location.href,
      reason,
      candidateCount: candidates.length,
      candidates,
      selectOptions,
    };

    console.log("[NOIDB-POC] filter bar diagnostics (읽기 전용, 클릭 없음)", result);
    safeStorageSet({ [FILTER_BAR_DIAG_KEY]: result });
    return result;
  }

  if (location.pathname.includes(ORDER_LIST_URL_PATH)) {
    // 발주리스트 화면에서만, 표가 렌더링될 시간을 준 뒤 1회 자동 수집한다.
    // 읽기 전용이라 반복 실행돼도 안전하지만, 불필요한 콘솔 로그를 줄이기
    // 위해 최초 로드 시 1회만 자동 실행하고 이후에는 팝업의 수동 버튼으로만
    // 다시 수집한다.
    setTimeout(() => collectFilterBarDiagnostics("auto-on-order-list-load"), 1200);
  }

  noidbSafeAddRuntimeMessageListener((message, _sender, sendResponse) => {
    if (message?.type === "NOIDB_POC_COLLECT_FILTER_BAR_DIAGNOSTICS") {
      try {
        const result = collectFilterBarDiagnostics("manual");
        sendResponse({ ok: true, candidateCount: result.candidateCount });
      } catch (e) {
        console.warn("[NOIDB-POC] NOIDB_POC_COLLECT_FILTER_BAR_DIAGNOSTICS 처리 중 오류:", e);
        try {
          sendResponse({ ok: false, error: String(e) });
        } catch {
          // 메시지 포트가 이미 닫혔을 수 있음 — 무시
        }
      }
      return true;
    }
    return undefined;
  });
})();
