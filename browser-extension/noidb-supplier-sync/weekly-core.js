(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.NOIDBWeeklyCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  const MAX_ROWS = 10000;
  const MAX_AGE_MS = 30 * 60 * 1000;
  const REQUIRED_HEADERS = ["구분", "번호", "SKU번호", "SKU명", "입고/반출시각", "물류센터", "수량"];
  const normalizeCell = value => String(value ?? "").replace(/\s+/g, " ").trim();
  function normalizeHeader(value) {
    const compact = normalizeCell(value).replace(/\s/g, "");
    return compact === "입고/반출일자" ? "입고/반출시각" : compact;
  }
  function validDate(value) {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(`${value}T00:00:00Z`);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }
  function validateRequest(request) {
    if (!request || typeof request.requestId !== "string" || !/^[A-Za-z0-9_-]{1,120}$/.test(request.requestId)) return "업무 요청 번호가 올바르지 않습니다.";
    if (!validDate(request.startDate) || !validDate(request.endDate) || request.startDate > request.endDate) return "조회 시작일과 종료일을 확인해주세요.";
    if (Date.parse(request.endDate) - Date.parse(request.startDate) > 92 * 86400000) return "한 번에 최근 93일 이내의 입고 내역을 조회해주세요.";
    return "";
  }
  function allowedSite(url) {
    try {
      const parsed = new URL(url);
      return ["https://noidb-os.vercel.app", "http://localhost:3000"].includes(parsed.origin) && /^\/wms\/inbound\/?$/.test(parsed.pathname);
    } catch { return false; }
  }
  function receiptUrl(request, pageNumber = 1) {
    const error = validateRequest(request);
    if (error) throw new Error(error);
    if (!Number.isSafeInteger(pageNumber) || pageNumber < 1) throw new Error("조회 페이지가 올바르지 않습니다.");
    const url = new URL("https://supplier.coupang.com/scm/receive/detail");
    url.searchParams.set("startDate", request.startDate);
    url.searchParams.set("endDate", request.endDate);
    // Supplier Hub computes the summary for a fresh search (no page parameter).
    if (pageNumber > 1) url.searchParams.set("page", String(pageNumber));
    return url.toString();
  }
  function sameRows(left, right) { return JSON.stringify(left) === JSON.stringify(right); }
  function validatePage(page, request, expectedPage) {
    const errors = [];
    const headers = Array.isArray(page?.headers) ? page.headers.map(normalizeHeader) : [];
    for (const header of REQUIRED_HEADERS) if (headers.filter(item => item === header).length !== 1) errors.push(`필수 열 확인 실패: ${header}`);
    if (page?.pageNumber !== expectedPage) errors.push(`${expectedPage}페이지가 표시되지 않았습니다.`);
    if (expectedPage === 1 && page?.totalCountObserved !== true) errors.push("새 조회의 전체 검색 건수를 직접 확인하지 못했습니다.");
    if (page?.startDate !== request.startDate || page?.endDate !== request.endDate) errors.push("선택한 기간과 서플라이 허브의 조회 기간이 다릅니다.");
    if (page?.filtersClear !== true) errors.push("발주번호 또는 계산서번호 필터가 남아 있어 전체 결과를 확인할 수 없습니다.");
    if (!Number.isSafeInteger(page?.totalCount) || page.totalCount < 0 || page.totalCount > MAX_ROWS) errors.push(`전체 검색 건수는 0~${MAX_ROWS}건이어야 합니다.`);
    if (!Array.isArray(page?.rows)) errors.push("입고 표의 행을 읽지 못했습니다.");
    if (errors.length) return errors;
    const dateIndex = headers.indexOf("입고/반출시각");
    const skuIndex = headers.indexOf("SKU번호");
    const quantityIndex = headers.indexOf("수량");
    for (let i = 0; i < page.rows.length; i += 1) {
      const row = page.rows[i];
      if (!Array.isArray(row) || row.length !== headers.length || row.some(cell => typeof cell !== "string")) { errors.push(`${i + 1}행의 열 구성이 다릅니다.`); break; }
      const date = row[dateIndex].slice(0, 10);
      if (!validDate(date) || date < request.startDate || date > request.endDate) { errors.push(`${i + 1}행의 실제 입고/반출일이 조회 기간 밖이거나 잘못되었습니다.`); break; }
      if (!/^\d+$/.test(row[skuIndex])) { errors.push(`${i + 1}행의 SKU 번호가 올바르지 않습니다.`); break; }
      const quantity = row[quantityIndex].replace(/,/g, "");
      if (!/^-?\d+$/.test(quantity) || !Number.isSafeInteger(Number(quantity))) { errors.push(`${i + 1}행의 수량이 올바르지 않습니다.`); break; }
    }
    return errors;
  }
  function appendPage(session, page) {
    const expectedPage = session.pages.length + 1;
    const errors = validatePage(page, session, expectedPage);
    if (errors.length) throw new Error(errors.join(" "));
    const totalCount = session.totalCount ?? page.totalCount;
    if (page.totalCount !== totalCount) throw new Error("수집 중 전체 검색 건수가 변경되었습니다. 다시 조회해주세요.");
    const headers = page.headers.map(normalizeHeader);
    if (session.headers && !sameRows(session.headers, headers)) throw new Error("수집 중 표의 열 구성이 변경되었습니다.");
    const pageSize = session.pageSize ?? (totalCount === 0 ? 10 : page.rows.length);
    if (pageSize < 1) throw new Error("검색 결과가 있지만 입고 행을 읽지 못했습니다.");
    const pageCount = Math.max(1, Math.ceil(totalCount / pageSize));
    const expectedRows = Math.min(pageSize, Math.max(0, totalCount - (expectedPage - 1) * pageSize));
    if (page.rows.length !== expectedRows) throw new Error(`${expectedPage}페이지가 예상 ${expectedRows}행과 다릅니다.`);
    if (page.paginationPageCount != null && page.paginationPageCount !== pageCount) throw new Error("전체 건수와 화면의 마지막 페이지 번호가 일치하지 않습니다.");
    if (page.paginationHighestPage > pageCount || (expectedPage === pageCount && page.nextPageNumber != null)) throw new Error("검색 전체 건수보다 더 많은 페이지가 표시됩니다.");
    if (expectedPage < pageCount && page.nextPageNumber !== expectedPage + 1) throw new Error("다음 페이지를 확인하지 못해 부분 수집을 중단했습니다.");
    if (page.rows.length && session.pages.some(previous => sameRows(previous.rows, page.rows))) throw new Error("이전 페이지와 동일한 행이 반복되어 수집을 중단했습니다.");
    const next = { ...session, totalCount, headers, pageSize, pageCount, pages: [...session.pages, { pageNumber: expectedPage, rows: page.rows }] };
    if (next.pages.length > pageCount) throw new Error("예상 페이지 수를 초과했습니다.");
    return next;
  }
  function completePayload(session) {
    if (!session.headers || session.pages.length !== session.pageCount) throw new Error("모든 페이지 수집이 끝나지 않았습니다.");
    const rows = session.pages.flatMap(page => page.rows);
    if (rows.length !== session.totalCount) throw new Error("검색 전체 건수와 수집한 행 수가 일치하지 않습니다.");
    return { transferId: session.requestId, headers: session.headers, rows, totalCount: session.totalCount, startDate: session.startDate, endDate: session.endDate, collectedAt: new Date().toISOString(), coverageComplete: true };
  }
  function verifyFreshFirstPage(session, page) {
    const fresh = appendPage({ requestId: session.requestId, startDate: session.startDate, endDate: session.endDate, pages: [] }, page);
    if (fresh.totalCount !== session.totalCount) throw new Error("수집 후 새 조회의 전체 건수가 변경되었습니다. 다시 시작해주세요.");
    if (!sameRows(fresh.headers, session.headers) || !sameRows(fresh.pages[0].rows, session.pages[0]?.rows)) throw new Error("수집 후 새 조회의 첫 페이지가 변경되었습니다. 다시 시작해주세요.");
    return completePayload(session);
  }
  return { MAX_ROWS, MAX_AGE_MS, REQUIRED_HEADERS, normalizeCell, normalizeHeader, validateRequest, allowedSite, receiptUrl, validatePage, appendPage, completePayload, verifyFreshFirstPage };
});
