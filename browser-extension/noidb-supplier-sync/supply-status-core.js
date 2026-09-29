(function registerSupplyStatusCore(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.NOIDBSupplyStatusCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createSupplyStatusCore() {
  "use strict";

  const MAX_TRANSFER_ROWS = 10000;
  const REQUIRED_HEADERS = ["SKU ID", "상품명", "바코드", "발주가능상태"];

  function normalizeCell(value) {
    return String(value == null ? "" : value).replace(/[\t\r\n]+/g, " ").replace(/\s+/g, " ").trim();
  }

  function normalizeHeader(value) {
    return normalizeCell(value).replace(/\s+/g, "").toUpperCase();
  }

  function headerIndex(headers, candidate) {
    const expected = normalizeHeader(candidate);
    return headers.findIndex(header => normalizeHeader(header) === expected);
  }

  function missingRequiredHeaders(headers) {
    return REQUIRED_HEADERS.filter(header => headerIndex(headers, header) < 0);
  }

  function parseTotalCount(value) {
    const text = normalizeCell(value);
    const patterns = [
      /(?:총|전체)\s*([\d,]+)\s*(?:건|개)/i,
      /([\d,]+)\s*(?:건|개)\s*(?:검색|조회|결과)/i,
      /([\d,]+)\s*개\s*검색됨/i,
    ];
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (!match) continue;
      const count = Number(match[1].replace(/,/g, ""));
      if (Number.isSafeInteger(count) && count >= 0) return count;
    }
    return null;
  }

  function expectedPageCount(totalCount, pageSize) {
    return totalCount > 0 && pageSize > 0 ? Math.ceil(totalCount / pageSize) : 0;
  }

  function expectedRowsForPage(totalCount, pageSize, pageNumber) {
    const pageCount = expectedPageCount(totalCount, pageSize);
    if (pageNumber < 1 || pageNumber > pageCount) return 0;
    return Math.min(pageSize, totalCount - ((pageNumber - 1) * pageSize));
  }

  function fingerprintRows(rows) {
    const value = rows.map(row => row.map(normalizeCell).join("\u001f")).join("\u001e");
    let hash = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16).padStart(8, "0");
  }

  function selectPaginationCandidate(candidates, pageNumber) {
    const expected = String(pageNumber);
    const eligible = (Array.isArray(candidates) ? candidates : []).map((candidate, index) => ({ ...candidate, index }))
      .filter(candidate => candidate.visible !== false && candidate.enabled !== false);
    const numeric = eligible.find(candidate => normalizeCell(candidate.text) === expected);
    if (numeric) return { index: numeric.index, kind: "numeric" };
    const targetJump = eligible.find(candidate => normalizeCell(candidate.dataPage) === expected);
    if (targetJump) return { index: targetJump.index, kind: "target-jump" };
    const numericPages = eligible.map(candidate => /^\d+$/.test(normalizeCell(candidate.text)) ? Number(normalizeCell(candidate.text)) : null)
      .filter(value => Number.isSafeInteger(value));
    const minimum = numericPages.length ? Math.min(...numericPages) : 1;
    const maximum = numericPages.length ? Math.max(...numericPages) : 1;
    const labels = pageNumber > maximum ? [">", "›", "»", "다음", "NEXT"] : pageNumber < minimum ? ["<", "‹", "«", "이전", "PREV"] : [];
    const mover = eligible.find(candidate => labels.includes(normalizeCell(candidate.text).toUpperCase()));
    return mover ? { index: mover.index, kind: pageNumber > maximum ? "forward-block" : "backward-block" } : null;
  }

  function validateCapture({ totalCount, pageSize, headers, pages }) {
    const errors = [];
    if (!Number.isSafeInteger(totalCount) || totalCount <= 0) errors.push("전체 건수가 올바르지 않습니다.");
    if (totalCount > MAX_TRANSFER_ROWS) errors.push(`최대 ${MAX_TRANSFER_ROWS.toLocaleString()}건을 초과했습니다.`);
    if (!Number.isSafeInteger(pageSize) || pageSize <= 0) errors.push("페이지 표시 건수가 올바르지 않습니다.");
    const missing = missingRequiredHeaders(headers || []);
    if (missing.length) errors.push(`필수 열 누락: ${missing.join(", ")}`);
    const pageCount = expectedPageCount(totalCount, pageSize);
    if (pages.length !== pageCount) errors.push(`예상 ${pageCount}페이지 중 ${pages.length}페이지만 수집되었습니다.`);
    const seenPages = new Set();
    const seenSkuIds = new Set();
    const skuIndex = headerIndex(headers || [], "SKU ID");
    let collectedRowCount = 0;
    pages.forEach((page, index) => {
      const pageNumber = index + 1;
      const rows = Array.isArray(page.rows) ? page.rows : [];
      if (page.pageNumber !== pageNumber) errors.push(`${pageNumber}페이지 순서가 올바르지 않습니다.`);
      const expectedRows = expectedRowsForPage(totalCount, pageSize, pageNumber);
      if (rows.length !== expectedRows) errors.push(`${pageNumber}페이지가 예상 ${expectedRows}행 대신 ${rows.length}행입니다.`);
      const fingerprint = fingerprintRows(rows);
      if (seenPages.has(fingerprint)) errors.push(`${pageNumber}페이지가 앞 페이지와 반복되었습니다.`);
      seenPages.add(fingerprint);
      rows.forEach((row, rowIndex) => {
        if (!Array.isArray(row) || row.length !== headers.length) errors.push(`${pageNumber}페이지 ${rowIndex + 1}행 열 개수가 다릅니다.`);
        const skuId = skuIndex >= 0 ? normalizeCell(row[skuIndex]) : "";
        if (skuId && seenSkuIds.has(skuId)) errors.push(`SKU ID ${skuId}가 여러 페이지에 반복되었습니다.`);
        if (skuId) seenSkuIds.add(skuId);
      });
      collectedRowCount += rows.length;
    });
    if (collectedRowCount !== totalCount) errors.push(`전체 ${totalCount}건 중 ${collectedRowCount}건만 수집되었습니다.`);
    return { complete: errors.length === 0, errors, totalCount, collectedRowCount, pageCount, pageSize };
  }

  return { MAX_TRANSFER_ROWS, REQUIRED_HEADERS, normalizeCell, normalizeHeader, headerIndex, missingRequiredHeaders, parseTotalCount, expectedPageCount, expectedRowsForPage, fingerprintRows, selectPaginationCandidate, validateCapture };
});
