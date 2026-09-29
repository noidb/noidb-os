(() => {
  "use strict";
  const core = globalThis.NOIDBWeeklyCore;
  if (!core) return;
  const delay = milliseconds => new Promise(resolve => window.setTimeout(resolve, milliseconds));
  const visible = element => Boolean(element?.getClientRects().length);
  const text = element => core.normalizeCell(element?.innerText || element?.textContent);
  const BANNER_ID = "noidb-weekly-receipts-status";
  function banner(message, error = false) {
    let element = document.getElementById(BANNER_ID);
    if (!element) {
      element = document.createElement("div");
      element.id = BANNER_ID;
      element.setAttribute("role", "status");
      Object.assign(element.style, { position: "fixed", bottom: "24px", left: "24px", zIndex: "2147483647", maxWidth: "420px", padding: "16px 20px", borderRadius: "12px", color: "white", fontSize: "14px", boxShadow: "0 8px 30px #0003" });
      document.body.appendChild(element);
    }
    element.style.background = error ? "#b42318" : "#1f4f45";
    element.textContent = message;
  }
  function totalCount() {
    for (const table of Array.from(document.querySelectorAll("table")).filter(visible)) {
      const rows = Array.from(table.querySelectorAll("tr"));
      for (let index = 0; index < rows.length - 1; index += 1) {
        const cells = Array.from(rows[index].querySelectorAll("th,td"));
        const column = cells.findIndex(cell => text(cell).replace(/\s/g, "") === "검색건수");
        if (column < 0) continue;
        const value = text(rows[index + 1].querySelectorAll("td,th")[column]).replace(/,/g, "");
        if (!/^\d+$/.test(value)) throw new Error("전체 검색 건수를 읽지 못했습니다.");
        return Number(value);
      }
    }
    return null;
  }
  function readPage(request) {
    const form = document.querySelector("#searchForm");
    if (!form) throw new Error("입고 조회 화면을 기다리고 있습니다.");
    const observedCount = totalCount();
    const count = observedCount ?? (request.expectedPage > 1 ? request.expectedTotalCount : null);
    if (!Number.isSafeInteger(count)) throw new Error("입고 내역의 검색 건수 표가 아직 표시되지 않았습니다.");
    let found = null;
    for (const table of Array.from(document.querySelectorAll("table")).filter(visible)) {
      const tableRows = Array.from(table.querySelectorAll("tr"));
      const headerRow = tableRows.find(row => {
        const values = Array.from(row.querySelectorAll("th,td")).map(cell => core.normalizeHeader(text(cell)));
        return core.REQUIRED_HEADERS.every(header => values.includes(header));
      });
      if (!headerRow) continue;
      const headers = Array.from(headerRow.querySelectorAll("th,td")).map(cell => core.normalizeHeader(text(cell)));
      const dataRows = tableRows.slice(tableRows.indexOf(headerRow) + 1).filter(visible);
      const rows = dataRows.filter(row => !(count === 0 && row.querySelector("td[colspan]")))
        .map(row => Array.from(row.querySelectorAll("td,th")).map(text));
      if (found) throw new Error("입고 표가 두 개 이상 표시되어 정확한 결과를 구분할 수 없습니다.");
      found = { headers, rows };
    }
    if (!found) throw new Error("입고 표의 필수 열을 찾지 못했습니다.");
    const params = new URLSearchParams(location.search);
    const links = Array.from(document.querySelectorAll(".pagination li[data-lp]")).filter(visible);
    if (count > found.rows.length && !links.length) throw new Error("입고 목록의 페이지 번호가 표시되기를 기다리고 있습니다.");
    const activePage = links.find(element => element.classList.contains("active"));
    const pageNumber = activePage ? Number(activePage.getAttribute("data-lp")) : Number(params.get("page") || 1);
    const next = links.find(element => element.classList.contains("next") && !element.classList.contains("disabled"));
    const pages = links.filter(element => !element.classList.contains("prev") && !element.classList.contains("next"))
      .map(element => Number(element.getAttribute("data-lp"))).filter(Number.isSafeInteger);
    const startDate = form.querySelector("input[name='startDate']")?.value || "";
    const endDate = form.querySelector("input[name='endDate']")?.value || "";
    if (params.get("startDate") !== request.startDate || params.get("endDate") !== request.endDate || Number(params.get("page") || 1) !== pageNumber) throw new Error("요청한 조회 조건과 현재 페이지 주소가 다릅니다.");
    return { ...found, totalCount: count, totalCountObserved: observedCount != null, pageNumber, startDate, endDate,
      filtersClear: ["requestSeq", "vendorPaymentInfoSeq"].every(name => form.querySelector(`input[name='${name}']`)?.value === ""),
      nextPageNumber: next ? Number(next.getAttribute("data-lp")) : null,
      paginationHighestPage: pages.length ? Math.max(...pages) : pageNumber,
      paginationPageCount: next ? null : pageNumber,
    };
  }
  async function waitForPage(request) {
    const started = Date.now();
    let previous = "";
    let stable = 0;
    let lastError = "입고 내역 표시를 기다리고 있습니다.";
    while (Date.now() - started < 20000) {
      try {
        const page = readPage(request);
        const errors = core.validatePage(page, request, request.expectedPage);
        if (errors.length) throw new Error(errors.join(" "));
        const fingerprint = JSON.stringify(page);
        stable = fingerprint === previous ? stable + 1 : 1;
        previous = fingerprint;
        if (stable >= 3) return page;
      } catch (error) { lastError = error.message; stable = 0; }
      await delay(300);
    }
    throw new Error(`${lastError} 일부 자료만 전송하지 않고 중단했습니다.`);
  }
  async function run() {
    const response = await chrome.runtime.sendMessage({ type: "NOIDB_WEEKLY_SUPPLIER_READY" });
    const request = response?.request;
    if (!request) return;
    if (location.pathname !== "/scm/receive/detail") {
      banner("NOID-B 주간 업무 · 로그인 또는 본인 인증을 완료하면 입고 자료 수집을 이어갑니다.");
      await chrome.runtime.sendMessage({ type: "NOIDB_WEEKLY_SUPPLIER_STATUS", requestId: request.requestId, status: "auth-required" });
      const resume = async () => {
        if (!document.querySelector("input[type='password']") && document.querySelector("a[href='/scm/receive/detail'],a[href='https://supplier.coupang.com/scm/receive/detail']")) {
          await chrome.runtime.sendMessage({ type: "NOIDB_WEEKLY_SUPPLIER_STATUS", requestId: request.requestId, status: "resume" });
          return true;
        }
        return false;
      };
      if (await resume()) return;
      const timer = window.setInterval(async () => { if (await resume()) window.clearInterval(timer); }, 2000);
      window.setTimeout(() => window.clearInterval(timer), core.MAX_AGE_MS);
      return;
    }
    banner(request.phase === "verify" ? "NOID-B 주간 업무 · 새 조회로 전체 건수와 자료 변경 여부를 최종 확인 중" : `NOID-B 주간 업무 · ${request.startDate} ~ ${request.endDate} 입고 내역 ${request.expectedPage}페이지 확인 중`);
    try {
      const page = await waitForPage(request);
      const result = await chrome.runtime.sendMessage({ type: "NOIDB_WEEKLY_PAGE", requestId: request.requestId, phase: request.phase, page });
      if (result?.error) throw new Error(result.error);
      if (result?.complete) banner(`입고 상세내역 전체 ${result.totalCount}건 확인 완료 · NOID-B 주간 업무 화면에서 이어서 진행하세요.`);
      else if (result?.accepted === true && result.nextUrl === core.receiptUrl(request, result.verify ? 1 : request.expectedPage + 1)) location.assign(result.nextUrl);
    } catch (error) {
      banner(error.message || "입고 자료 수집을 중단했습니다.", true);
      await chrome.runtime.sendMessage({ type: "NOIDB_WEEKLY_SUPPLIER_STATUS", requestId: request.requestId, status: "error", message: error.message });
    }
  }
  run().catch(error => banner(error.message || "브라우저 연결을 새로고침해주세요.", true));
})();
