(() => {
  "use strict";
  if (document.getElementById("noidb-supply-status-sync-button")) return;
  const core = globalThis.NOIDBSupplyStatusCore;
  if (!core) return;

  const BUTTON_ID = "noidb-supply-status-sync-button";
  const STORAGE_KEY = "noidbPendingSupplyStatusTransfer";
  const NOIDB_URL = "https://noidb-os.vercel.app/";
  const PAGE_WAIT_MS = 30000;
  const STABLE_READS = 3;
  // 한 페이지가 늦게 뜨면 같은 페이지 번호를 다시 눌러 이만큼 더 기다린다(651페이지 중 한 번 느려도 전체가 멈추지 않게).
  const PAGE_RETRIES = 3;
  // 실패한 지점부터 이어 받기 위해, 이 탭에서 이미 검증한 페이지를 보관한다(같은 검색 조건일 때만 사용).
  let partialCapture = null;

  const delay = milliseconds => new Promise(resolve => window.setTimeout(resolve, milliseconds));
  const visible = element => Boolean(element && element.getClientRects().length > 0);
  const enabled = element => Boolean(element && !element.disabled && element.getAttribute("aria-disabled") !== "true" && !element.classList.contains("disabled") && !element.parentElement?.classList.contains("disabled"));

  function readTableElement(table) {
    const headerRow = table.querySelector("thead tr:last-child") || table.querySelector("tr");
    const headers = headerRow ? Array.from(headerRow.querySelectorAll("th,td")).map(cell => core.normalizeCell(cell.innerText || cell.textContent)) : [];
    const bodyRows = table.querySelectorAll("tbody tr").length
      ? Array.from(table.querySelectorAll("tbody tr"))
      : Array.from(table.querySelectorAll("tr")).filter(row => row !== headerRow);
    const rows = bodyRows.filter(visible).map(row => Array.from(row.querySelectorAll("td")).map(cell => core.normalizeCell(cell.innerText || cell.textContent)))
      .filter(row => row.length === headers.length && row.some(Boolean));
    return { table, headers, rows, fingerprint: core.fingerprintRows(rows) };
  }

  function findSupplyTable() {
    const candidates = Array.from(document.querySelectorAll("table")).filter(visible).map(readTableElement);
    const matching = candidates.filter(candidate => core.missingRequiredHeaders(candidate.headers).length === 0)
      .sort((left, right) => right.rows.length - left.rows.length);
    if (!matching.length) throw new Error("상품공급상태 표를 찾지 못했습니다. 표에 SKU ID·상품명·바코드·발주가능상태 열이 보이는지 확인해주세요.");
    return matching[0];
  }

  function readTotalCount(tableState) {
    const nearby = tableState.table.closest("section,main,article,.content,.container")?.innerText || "";
    const totalCount = core.parseTotalCount(nearby) ?? core.parseTotalCount(document.body.innerText);
    if (totalCount == null) {
      if (tableState.rows.length > 0 && paginationElements().filter(element => /^\d+$/.test(core.normalizeCell(element.textContent))).length <= 1) return tableState.rows.length;
      throw new Error("상품공급상태 전체 건수를 읽지 못했습니다. 검색 결과의 총 건수가 화면에 보이게 해주세요.");
    }
    if (totalCount <= 0) throw new Error("현재 상품공급상태 검색 결과가 0건입니다.");
    if (totalCount > core.MAX_TRANSFER_ROWS) throw new Error(`검색 결과가 ${totalCount.toLocaleString()}건입니다. 조건을 나눠 ${core.MAX_TRANSFER_ROWS.toLocaleString()}건 이하로 수집해주세요.`);
    return totalCount;
  }

  function pageSizeSelect() {
    const candidates = Array.from(document.querySelectorAll("select")).filter(visible).map(select => ({
      select,
      values: Array.from(select.options).map(option => Number(String(option.value || option.textContent).replace(/\D/g, ""))).filter(value => Number.isSafeInteger(value) && value > 0 && value <= 500),
    })).filter(candidate => candidate.values.length >= 2 && candidate.values.some(value => value >= 50));
    candidates.sort((left, right) => Math.max(...right.values) - Math.max(...left.values));
    return candidates[0] || null;
  }

  function paginationElements() {
    const raw = Array.from(document.querySelectorAll(".pagination a,.pagination button,[class*='pagination'] a,[class*='pagination'] button,a[data-page],button[data-page]"));
    return raw.filter((element, index) => raw.indexOf(element) === index && visible(element));
  }

  function activePageNumber() {
    const active = document.querySelector("[aria-current='page'],.pagination .active,[class*='pagination'] .active,.rc-pagination-item-active");
    const value = Number(core.normalizeCell(active?.textContent));
    return Number.isSafeInteger(value) && value > 0 ? value : null;
  }

  function paginationCandidate(pageNumber) {
    const elements = paginationElements();
    const selected = core.selectPaginationCandidate(elements.map(element => ({
      dataPage: element.getAttribute("data-page") || element.getAttribute("data-page-number") || "",
      text: element.textContent,
      visible: visible(element),
      enabled: enabled(element),
    })), pageNumber);
    return selected ? { element: elements[selected.index], kind: selected.kind } : null;
  }

  function paginationSignature() {
    return paginationElements().map(element => [
      core.normalizeCell(element.textContent),
      element.getAttribute("data-page") || element.getAttribute("data-page-number") || "",
      element.getAttribute("aria-current") || "",
      enabled(element) ? "1" : "0",
    ].join("")).join("");
  }

  async function waitForPaginationChange(previousSignature) {
    const started = Date.now();
    while (Date.now() - started < PAGE_WAIT_MS) {
      if (paginationSignature() !== previousSignature) return;
      await delay(180);
    }
    throw new Error("페이지 번호 목록이 바뀌지 않아 수집을 중단했습니다.");
  }

  async function waitForStablePage(expectedRows, previousFingerprint = "", requireChange = false, pageLabel = "") {
    const started = Date.now();
    let lastFingerprint = "";
    let stable = 0;
    let seenRows = null;
    let unchanged = false;
    while (Date.now() - started < PAGE_WAIT_MS) {
      let state = null;
      try { state = findSupplyTable(); } catch {}
      if (state) { seenRows = state.rows.length; unchanged = requireChange && state.fingerprint === previousFingerprint; }
      if (state && state.rows.length === expectedRows && (!requireChange || state.fingerprint !== previousFingerprint)) {
        if (state.fingerprint === lastFingerprint) stable += 1;
        else { lastFingerprint = state.fingerprint; stable = 1; }
        if (stable >= STABLE_READS) return state;
      } else {
        lastFingerprint = "";
        stable = 0;
      }
      await delay(180);
    }
    const seen = seenRows == null ? "표를 찾지 못함" : unchanged ? "앞 페이지 내용 그대로" : `${seenRows}행만 보임`;
    throw new Error(`${pageLabel}표가 예상 ${expectedRows}행으로 완전히 표시되지 않아 수집을 중단했습니다(${seen}).`);
  }

  async function setLargestPageSize(totalCount) {
    const candidate = pageSizeSelect();
    if (!candidate) {
      // 표시 개수 선택창이 없는 화면(2026-10 상품 공급상태 관리: 10건 고정)은 지금 표시 개수로 모든 페이지를 넘긴다.
      const current = findSupplyTable().rows.length;
      // 이어 받기 중이면 처음 정한 표시 개수를 쓴다(실패한 페이지가 덜 떠 있어도 표시 개수가 바뀌지 않게).
      if (partialCapture && partialCapture.totalCount === totalCount) return partialCapture.pageSize;
      if (current > 0) return current;
      throw new Error("페이지 표시 개수 선택창을 찾지 못했습니다.");
    }
    const target = Math.max(...candidate.values);
    const current = Number(String(candidate.select.value || candidate.select.selectedOptions[0]?.textContent).replace(/\D/g, ""));
    if (current === target) return target;
    const before = findSupplyTable();
    const matchingOption = Array.from(candidate.select.options).find(option => Number(String(option.value || option.textContent).replace(/\D/g, "")) === target);
    if (!matchingOption) throw new Error("최대 페이지 표시 개수를 선택하지 못했습니다.");
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set;
    if (setter) setter.call(candidate.select, matchingOption.value);
    else candidate.select.value = matchingOption.value;
    candidate.select.dispatchEvent(new Event("input", { bubbles: true }));
    candidate.select.dispatchEvent(new Event("change", { bubbles: true }));
    await waitForStablePage(Math.min(target, totalCount), before.fingerprint, before.rows.length !== Math.min(target, totalCount));
    return target;
  }

  async function openPage(pageNumber, expectedRows, previousFingerprint) {
    const label = `${pageNumber}페이지: `;
    if (activePageNumber() === pageNumber) return waitForStablePage(expectedRows, "", false, label);
    let retries = 0;
    for (let guard = 0; guard < 200; guard += 1) {
      const candidate = paginationCandidate(pageNumber);
      if (!candidate) throw new Error(`${pageNumber}페이지 이동 버튼을 찾지 못했습니다.`);
      const beforePagination = paginationSignature();
      candidate.element.click();
      if (candidate.kind === "forward-block" || candidate.kind === "backward-block") {
        await waitForPaginationChange(beforePagination);
        continue;
      }
      try {
        const state = await waitForStablePage(expectedRows, previousFingerprint, true, label);
        if (candidate.kind === "numeric" || activePageNumber() === pageNumber) return state;
      } catch (error) {
        // 이미 그 페이지로 넘어갔는데 늦게 뜬 경우: 내용이 바뀌었는지는 따지지 않고 다시 기다린다.
        if (retries >= PAGE_RETRIES) throw error;
        retries += 1;
        if (activePageNumber() === pageNumber) {
          try { return await waitForStablePage(expectedRows, "", false, label); } catch {}
        }
      }
    }
    throw new Error(`${pageNumber}페이지 탐색 안전 한도를 초과했습니다.`);
  }

  function transferId() {
    return globalThis.crypto?.randomUUID?.() || `supply-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function openNoidbTab(id) {
    const url = new URL(NOIDB_URL);
    url.searchParams.set("source", "supply-status-extension");
    url.searchParams.set("transferId", id);
    url.hash = "supply-status-audit";
    const opened = window.open(url.toString(), "_blank");
    if (!opened) throw new Error("NOID-B 탭을 열지 못했습니다. 이 사이트의 팝업을 허용해주세요.");
    try { opened.opener = null; } catch {}
  }

  async function collectAllPages(progress) {
    const startedAt = new Date().toISOString();
    const initial = findSupplyTable();
    const totalCount = readTotalCount(initial);
    progress(`페이지 표시 개수 준비 중 · 총 ${totalCount.toLocaleString()}건`);
    const pageSize = await setLargestPageSize(totalCount);
    const pageCount = core.expectedPageCount(totalCount, pageSize);
    // 같은 탭·같은 검색(총 건수·표시 개수)에서 실패했던 수집이 있으면 그 다음 페이지부터 이어 받는다.
    const searchKey = location.origin + location.pathname + location.search;
    const resume = partialCapture && partialCapture.totalCount === totalCount && partialCapture.pageSize === pageSize && partialCapture.searchKey === searchKey ? partialCapture : null;
    const pages = resume ? [...resume.pages] : [];
    let headers = resume ? resume.headers : null;
    let previousFingerprint = resume ? resume.lastFingerprint : "";
    const firstStartedAt = resume ? resume.startedAt : startedAt;
    partialCapture = { totalCount, pageSize, searchKey, startedAt: firstStartedAt, pages, headers, lastFingerprint: previousFingerprint };
    if (resume) progress(`${pages.length + 1}페이지부터 이어서 수집합니다 · 이미 받은 ${pages.length}페이지 유지`);
    for (let pageNumber = pages.length + 1; pageNumber <= pageCount; pageNumber += 1) {
      const expectedRows = core.expectedRowsForPage(totalCount, pageSize, pageNumber);
      progress(`상품공급상태 ${pageNumber}/${pageCount} · ${pages.reduce((sum, page) => sum + page.rows.length, 0).toLocaleString()}/${totalCount.toLocaleString()}건`);
      const state = await openPage(pageNumber, expectedRows, previousFingerprint);
      if (!headers) headers = state.headers;
      else if (headers.length !== state.headers.length || headers.some((header, index) => core.normalizeHeader(header) !== core.normalizeHeader(state.headers[index]))) throw new Error(`${pageNumber}페이지의 열 구성이 앞 페이지와 다릅니다.`);
      pages.push({ pageNumber, rows: state.rows });
      previousFingerprint = state.fingerprint;
      partialCapture.headers = headers;
      partialCapture.lastFingerprint = previousFingerprint;
    }
    if (readTotalCount(findSupplyTable()) !== totalCount) throw new Error("수집 중 전체 건수가 변경되어 전송을 중단했습니다.");
    const validation = core.validateCapture({ totalCount, pageSize, headers, pages });
    if (!validation.complete) { partialCapture = null; throw new Error(`전체 수집 검증 실패: ${validation.errors.join(" ")}`); }
    partialCapture = null;
    return {
      schemaVersion: 1,
      source: "supplier-hub-live",
      headers,
      rows: pages.flatMap(page => page.rows),
      capturedAt: new Date().toISOString(),
      startedAt: firstStartedAt,
      sourceUrl: location.href,
      totalRowCount: totalCount,
      pageCount,
      pageSize,
      coverageComplete: true,
    };
  }

  function toast(message, error = false, sticky = false) {
    let element = document.getElementById(`${BUTTON_ID}-message`);
    if (!element) {
      element = document.createElement("div");
      element.id = `${BUTTON_ID}-message`;
      Object.assign(element.style, { position: "fixed", right: "20px", bottom: "86px", zIndex: "2147483647", maxWidth: "340px", padding: "12px 14px", borderRadius: "10px", color: "white", fontSize: "13px", fontWeight: "700", boxShadow: "0 8px 26px rgba(0,0,0,.22)" });
      document.body.appendChild(element);
    }
    element.style.background = error ? "#b42318" : "#28705d";
    element.textContent = message;
    window.clearTimeout(element._noidbTimer);
    // 오류는 닫을 때까지 남긴다. 진행 상황은 다음 메시지로 바뀐다.
    if (!sticky) element._noidbTimer = window.setTimeout(() => element.remove(), 5500);
    else { element.style.cursor = "pointer"; element.title = "누르면 닫힙니다"; element.onclick = () => element.remove(); }
  }

  const button = document.createElement("button");
  button.id = BUTTON_ID;
  button.type = "button";
  button.textContent = "상품공급상태 전체를 NOID-B로 전송";
  button.title = "현재 검색 결과의 모든 페이지를 검증한 뒤 NOID-B AI 상품등록으로 전송합니다.";
  Object.assign(button.style, { position: "fixed", right: "20px", bottom: "24px", zIndex: "2147483647", border: "0", borderRadius: "12px", padding: "14px 18px", background: "#1f4f45", color: "white", fontSize: "14px", fontWeight: "800", cursor: "pointer", boxShadow: "0 8px 28px rgba(0,0,0,.25)" });
  button.addEventListener("click", async () => {
    const original = "상품공급상태 전체를 NOID-B로 전송";
    let failedMessage = "";
    const id = transferId();
    button.disabled = true;
    try {
      const initial = findSupplyTable();
      readTotalCount(initial);
      openNoidbTab(id);
      await chrome.storage.local.remove(STORAGE_KEY);
      const payload = await collectAllPages(message => { button.textContent = message; toast(message); });
      await chrome.storage.local.set({ [STORAGE_KEY]: { ...payload, transferId: id } });
      button.textContent = `${payload.totalRowCount.toLocaleString()}건 검증·전송 완료`;
      toast(`상품공급상태 전체 ${payload.totalRowCount.toLocaleString()}건을 전송했습니다.`);
    } catch (error) {
      await chrome.storage.local.remove(STORAGE_KEY).catch(() => undefined);
      failedMessage = error instanceof Error ? error.message : "상품공급상태 전송에 실패했습니다.";
      button.textContent = "수집 실패 · 다시 시도";
      button.title = failedMessage;
      toast(failedMessage, true, true);
    } finally {
      button.disabled = false;
      // 실패했으면 버튼에 "수집 실패"를 남겨 둔다(자리를 비운 사이 끝나도 결과를 알 수 있게).
      if (!failedMessage) window.setTimeout(() => { button.textContent = original; }, 5500);
    }
  });
  let mountScheduled = false;
  const observer = new MutationObserver(() => {
    if (mountScheduled) return;
    mountScheduled = true;
    window.setTimeout(() => {
      mountScheduled = false;
      mountButtonIfReady();
    }, 250);
  });

  function mountButtonIfReady() {
    if (document.getElementById(BUTTON_ID)) {
      observer.disconnect();
      return;
    }
    try {
      findSupplyTable();
    } catch {
      return;
    }
    document.body.appendChild(button);
    observer.disconnect();
  }

  observer.observe(document.documentElement, { childList: true, subtree: true });
  mountButtonIfReady();
})();
