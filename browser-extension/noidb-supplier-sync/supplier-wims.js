(() => {
  const BUTTON_ID = "noidb-wims-transfer-button";
  const STORAGE_KEY = "noidbPendingWimsTransfer";
  const NOIDB_URL = "https://noidb-os.vercel.app/?source=wims-extension#product-registration-status";
  const TABLE_SELECTOR = ".wims-list .table.table-bordered";
  const TOTAL_SELECTOR = ".wims-searchResult .text-primary";
  const PAGE_SIZE_SELECTOR = "#select1";
  const PAGE_WAIT_MS = 30000;
  const PAGINATION_WAIT_MS = 10000;
  const STABLE_REQUIRED_READS = 2;
  const core = globalThis.NOIDBWimsCore;
  if (document.getElementById(BUTTON_ID)) return;

  if (!core) return;

  function findWimsTable() {
    const exact = document.querySelector(TABLE_SELECTOR);
    if (exact) return exact;
    return Array.from(document.querySelectorAll("table.table.table-bordered")).find(table => {
      const headers = Array.from(table.querySelectorAll("th")).map(cell => core.normalizeCell(cell.innerText));
      return headers.some(header => header.includes("상품명")) && headers.some(header => header === "상태" || header.includes("상태"));
    });
  }

  function readTable() {
    const table = findWimsTable();
    if (!table) throw new Error("상품명·상태 머리글이 있는 WIMS 표를 찾지 못했습니다.");
    const headerRow = table.tHead?.rows?.[0] || Array.from(table.rows || []).find(row => Array.from(row.cells).some(cell => cell.tagName === "TH"));
    const headers = headerRow ? Array.from(headerRow.cells).map(cell => core.normalizeCell(cell.innerText)) : [];
    const rowElements = table.tBodies?.length
      ? Array.from(table.tBodies).flatMap(body => Array.from(body.rows))
      : Array.from(table.rows || []).filter(row => row !== headerRow);
    const rows = rowElements.map(row => Array.from(row.cells).map(cell => core.normalizeCell(cell.innerText)))
      .filter(row => row.some(Boolean));
    if (!headers.length) throw new Error("WIMS 표의 컬럼 머리글을 찾지 못했습니다.");
    return { headers, rows, fingerprint: core.fingerprintRows(rows) };
  }

  function readTotalCount() {
    const totalElement = document.querySelector(TOTAL_SELECTOR);
    const totalText = core.normalizeCell(totalElement && totalElement.textContent);
    const totalCount = core.parseTotalCount(totalText);
    if (totalCount == null) throw new Error("WIMS 검색 결과 총건수를 읽지 못했습니다.");
    if (totalCount === 0) throw new Error("현재 WIMS 검색 결과가 0건입니다.");
    if (totalCount > core.MAX_TRANSFER_ROWS) {
      throw new Error(`검색 결과가 ${totalCount}건입니다. 등록일 범위를 줄여 ${core.MAX_TRANSFER_ROWS}건 이하로 검색한 뒤 다시 눌러주세요.`);
    }
    return { totalText, totalCount };
  }

  function readPageSize() {
    const select = document.querySelector(PAGE_SIZE_SELECTOR);
    if (!select) throw new Error("WIMS 페이지 표시 개수 선택창(#select1)을 찾지 못했습니다.");
    const value = Number(select.value);
    if (![10, 25, 50, 100].includes(value)) throw new Error(`지원하지 않는 페이지 표시 개수입니다: ${select.value || "빈값"}`);
    return { select, value };
  }

  function activePageNumber() {
    const active = document.querySelector(".wims-list a[data-page][aria-current='page'], .wims-list a[data-page].active, .wims-list .active > a[data-page], .wims-list .active a[data-page], a[data-page][aria-current='page'], a[data-page].active, .active > a[data-page]");
    const value = Number(active && active.getAttribute("data-page"));
    return Number.isSafeInteger(value) && value > 0 ? value : null;
  }

  function paginationLinks() {
    const scoped = document.querySelectorAll(".wims-list a, .wims-list button, .pagination a, .pagination button");
    const candidates = scoped.length > 0 ? Array.from(scoped) : Array.from(document.querySelectorAll("a[data-page], button[data-page]"));
    return candidates.filter((candidate, index) => candidates.indexOf(candidate) === index);
  }

  function isVisible(element) {
    return element.getClientRects().length > 0;
  }

  function isEnabled(element) {
    return !element.disabled
      && element.getAttribute("aria-disabled") !== "true"
      && !element.classList.contains("disabled")
      && !element.parentElement?.classList.contains("disabled");
  }

  function pageAnchor(pageNumber) {
    const links = paginationLinks();
    const selected = core.selectPaginationCandidate(links.map(anchor => ({
      dataPage: anchor.getAttribute("data-page"),
      text: anchor.textContent,
      visible: isVisible(anchor),
      enabled: isEnabled(anchor),
    })), pageNumber);
    return selected?.kind === "numeric" ? links[selected.index] : null;
  }

  function paginationSignature() {
    return paginationLinks().filter(isVisible).map(anchor => [
      core.normalizeCell(anchor.textContent),
      core.normalizeCell(anchor.getAttribute("data-page")),
      isEnabled(anchor) ? "enabled" : "disabled",
    ].join(":" )).join("|");
  }

  function navigationAnchor(pageNumber) {
    const links = paginationLinks();
    const selected = core.selectPaginationCandidate(links.map(anchor => ({
      dataPage: anchor.getAttribute("data-page"),
      text: anchor.textContent,
      visible: isVisible(anchor),
      enabled: isEnabled(anchor),
    })), pageNumber);
    return selected && selected.kind !== "numeric" ? links[selected.index] : null;
  }

  async function waitForPaginationMove(beforeFingerprint, targetPage) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < PAGINATION_WAIT_MS) {
      let fingerprint = "";
      try { fingerprint = readTable().fingerprint; } catch {}
      if (activePageNumber() === targetPage || pageAnchor(targetPage) || (fingerprint && fingerprint !== beforeFingerprint)) return;
      await delay(150);
    }
    throw new Error(`${targetPage}페이지가 있는 페이지 묶음으로 이동하지 못했습니다.`);
  }

  async function revealPage(pageNumber, beforeFingerprint) {
    const seenSignatures = new Set();
    for (let guard = 0; guard < 100; guard += 1) {
      const exact = pageAnchor(pageNumber);
      if (exact || activePageNumber() === pageNumber) return exact;
      const signature = paginationSignature();
      if (seenSignatures.has(signature)) throw new Error(`${pageNumber}페이지를 찾는 중 같은 페이지 묶음이 반복되었습니다.`);
      seenSignatures.add(signature);
      const mover = navigationAnchor(pageNumber);
      if (!mover) throw new Error(`${pageNumber}페이지 또는 다음 페이지 묶음 이동 버튼을 찾지 못했습니다.`);
      mover.click();
      await waitForPaginationMove(beforeFingerprint, pageNumber);
    }
    throw new Error(`${pageNumber}페이지 탐색 안전 한도를 초과했습니다.`);
  }

  function delay(milliseconds) {
    return new Promise(resolve => window.setTimeout(resolve, milliseconds));
  }

  async function waitForStablePage({ pageNumber, expectedRowCount, previousFingerprint = "", requireFingerprintChange = false }) {
    const startedAt = Date.now();
    let stableFingerprint = "";
    let stableReadCount = 0;
    while (Date.now() - startedAt < PAGE_WAIT_MS) {
      let current = null;
      try {
        current = readTable();
      } catch {
        current = null;
      }
      const active = activePageNumber();
      const activeMatches = active == null || active === pageNumber;
      const fingerprintChanged = !requireFingerprintChange || !previousFingerprint || current?.fingerprint !== previousFingerprint;
      if (current && activeMatches && current.rows.length === expectedRowCount && fingerprintChanged) {
        if (stableFingerprint !== current.fingerprint) {
          stableFingerprint = current.fingerprint;
          stableReadCount = 1;
        } else {
          stableReadCount += 1;
        }
        if (stableReadCount >= STABLE_REQUIRED_READS) {
          return current;
        }
      } else {
        stableFingerprint = "";
        stableReadCount = 0;
      }
      await delay(150);
    }
    throw new Error(`${pageNumber}페이지가 ${expectedRowCount}행으로 완전히 표시되지 않아 전송을 중단했습니다.`);
  }

  async function setPageSizeTo100(totalCount) {
    const { select, value: initialPageSize } = readPageSize();
    if (initialPageSize === 100) return initialPageSize;
    const before = readTable();
    const nativeValueSetter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set;
    if (nativeValueSetter) nativeValueSetter.call(select, "100");
    else select.value = "100";
    select.dispatchEvent(new Event("input", { bubbles: true }));
    select.dispatchEvent(new Event("change", { bubbles: true }));
    await waitForStablePage({
      pageNumber: 1,
      expectedRowCount: Math.min(100, totalCount),
      previousFingerprint: before.fingerprint,
      requireFingerprintChange: before.rows.length !== Math.min(100, totalCount),
    });
    if (readPageSize().value !== 100) throw new Error("WIMS 페이지 표시 개수를 100개로 바꾸지 못했습니다.");
    return initialPageSize;
  }

  async function openPage(pageNumber, expectedRowCount, previousFingerprint = "") {
    const active = activePageNumber();
    if (active === pageNumber) {
      return waitForStablePage({ pageNumber, expectedRowCount });
    }
    const beforeFingerprint = previousFingerprint || readTable().fingerprint;
    const anchor = await revealPage(pageNumber, beforeFingerprint);
    if (activePageNumber() === pageNumber) {
      return waitForStablePage({ pageNumber, expectedRowCount, previousFingerprint: beforeFingerprint, requireFingerprintChange: true });
    }
    if (!anchor) throw new Error(`${pageNumber}페이지 숫자 버튼을 찾지 못했습니다.`);
    anchor.click();
    return waitForStablePage({ pageNumber, expectedRowCount, previousFingerprint: beforeFingerprint, requireFingerprintChange: true });
  }

  function createTransferId() {
    if (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function") return globalThis.crypto.randomUUID();
    return `wims-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function openNoidbTab(transferId) {
    const url = new URL(NOIDB_URL);
    url.searchParams.set("source", "wims-extension");
    url.searchParams.set("transferId", transferId);
    url.hash = "product-registration-status";
    const opened = window.open(url.toString(), "_blank");
    if (!opened) throw new Error("NOID-B 탭을 열지 못했습니다. 이 사이트의 팝업을 허용해주세요.");
    try { opened.opener = null; } catch {}
  }

  async function collectAllPages(updateProgress) {
    const startedAt = new Date().toISOString();
    const sourceUrl = location.href;
    const { totalText, totalCount } = readTotalCount();
    const initialPageSize = readPageSize().value;

    updateProgress(`페이지당 100개로 준비 중 · 총 ${totalCount}건`);
    await setPageSizeTo100(totalCount);
    const pageSize = readPageSize().value;
    const pageCount = core.expectedPageCount(totalCount, pageSize);
    const pages = [];
    let headers = null;
    let previousFingerprint = "";

    for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
      const expectedRowCount = core.expectedRowsForPage(totalCount, pageSize, pageNumber);
      updateProgress(`WIMS 수집 ${pageNumber}/${pageCount} · ${pages.reduce((sum, page) => sum + page.rows.length, 0)}/${totalCount}건`);
      const table = await openPage(pageNumber, expectedRowCount, previousFingerprint);
      if (!headers) headers = table.headers;
      else if (headers.length !== table.headers.length || headers.some((header, index) => header !== table.headers[index])) {
        throw new Error(`${pageNumber}페이지의 WIMS 컬럼 구성이 앞 페이지와 달라 전송을 중단했습니다.`);
      }
      pages.push({ pageNumber, rows: table.rows });
      previousFingerprint = table.fingerprint;
    }

    const finalTotalCount = readTotalCount().totalCount;
    if (finalTotalCount !== totalCount) {
      throw new Error(`수집 중 WIMS 검색 결과가 ${totalCount}건에서 ${finalTotalCount}건으로 바뀌어 전송을 중단했습니다.`);
    }

    const validation = core.validateCapture({ totalCount, pageSize, columnCount: headers.length, pages });
    if (!validation.complete) throw new Error(`WIMS 전체 수집 검증 실패: ${validation.errors.join(" ")}`);
    const completedAt = new Date().toISOString();
    return {
      captureMode: core.CAPTURE_MODE,
      text: core.buildTsv(headers, pages),
      capturedAt: completedAt,
      sourceUrl,
      visibleRowCount: validation.collectedRowCount,
      totalRowCount: validation.totalCount,
      collectedRowCount: validation.collectedRowCount,
      pageSize: validation.pageSize,
      pageCount: validation.pageCount,
      columnCount: validation.columnCount,
      coverageComplete: true,
      capture: {
        schemaVersion: 2,
        captureMode: core.CAPTURE_MODE,
        startedAt,
        completedAt,
        totalText,
        totalRowCount: validation.totalCount,
        collectedRowCount: validation.collectedRowCount,
        initialPageSize,
        pageSize: validation.pageSize,
        pageCount: validation.pageCount,
        columnCount: validation.columnCount,
        pageRowCounts: validation.pageRowCounts,
        pageFingerprints: validation.pageFingerprints,
        coverageComplete: true,
      },
    };
  }

  function showMessage(message, error = false) {
    let toast = document.getElementById(`${BUTTON_ID}-message`);
    if (!toast) {
      toast = document.createElement("div");
      toast.id = `${BUTTON_ID}-message`;
      Object.assign(toast.style, {
        position: "fixed", right: "20px", bottom: "86px", zIndex: "2147483647",
        maxWidth: "320px", padding: "12px 14px", borderRadius: "10px", color: "white",
        fontSize: "13px", fontWeight: "700", boxShadow: "0 8px 26px rgba(0,0,0,.22)"
      });
      document.body.appendChild(toast);
    }
    toast.style.background = error ? "#b42318" : "#28705d";
    toast.textContent = message;
    window.setTimeout(() => toast.remove(), 5000);
  }

  const button = document.createElement("button");
  button.id = BUTTON_ID;
  button.type = "button";
  button.textContent = "WIMS 전체를 NOID-B로 전송";
  button.title = "현재 검색 결과의 모든 페이지를 검증한 뒤 NOID-B AI 상품등록으로 전송합니다.";
  Object.assign(button.style, {
    position: "fixed", right: "20px", bottom: "24px", zIndex: "2147483647",
    border: "0", borderRadius: "12px", padding: "14px 18px", background: "#1f4f45",
    color: "white", fontSize: "14px", fontWeight: "800", cursor: "pointer",
    boxShadow: "0 8px 28px rgba(0,0,0,.25)"
  });

  button.addEventListener("click", async () => {
    const original = button.textContent;
    const transferId = createTransferId();
    button.disabled = true;
    button.textContent = "NOID-B 열기 · 수집 준비 중...";
    try {
      readTotalCount();
      openNoidbTab(transferId);
      await chrome.storage.local.remove(STORAGE_KEY);
      const payload = await collectAllPages(progress => {
        button.textContent = progress;
        showMessage(progress);
      });
      await chrome.storage.local.set({ [STORAGE_KEY]: { ...payload, transferId } });
      button.textContent = `${payload.collectedRowCount}건 검증·전송 완료`;
      showMessage(`WIMS 전체 ${payload.collectedRowCount}건을 검증해 전송했습니다.`);
      if (payload.pageCount > 1) {
        const firstPageAnchor = pageAnchor(1);
        if (firstPageAnchor && activePageNumber() !== 1) firstPageAnchor.click();
      }
    } catch (error) {
      await chrome.storage.local.remove(STORAGE_KEY).catch(() => undefined);
      showMessage(error instanceof Error ? error.message : "WIMS 전송에 실패했습니다.", true);
      button.textContent = "수집 실패 · 다시 시도";
    } finally {
      button.disabled = false;
      window.setTimeout(() => { button.textContent = original; }, 5000);
    }
  });

  document.body.appendChild(button);
})();
