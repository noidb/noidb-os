(function registerWimsCore(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.NOIDBWimsCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createWimsCore() {
  "use strict";

  const CAPTURE_MODE = "all-pages";
  const MAX_TRANSFER_ROWS = 1000;

  function normalizeCell(value) {
    return String(value == null ? "" : value).replace(/[\t\r\n]+/g, " ").replace(/\s+/g, " ").trim();
  }

  function parseTotalCount(value) {
    const match = normalizeCell(value).match(/([\d,]+)\s*개\s*검색됨/);
    if (!match) return null;
    const count = Number(match[1].replace(/,/g, ""));
    return Number.isSafeInteger(count) && count >= 0 ? count : null;
  }

  function expectedPageCount(totalCount, pageSize) {
    if (!Number.isSafeInteger(totalCount) || totalCount < 0 || !Number.isSafeInteger(pageSize) || pageSize <= 0) return 0;
    return totalCount === 0 ? 0 : Math.ceil(totalCount / pageSize);
  }

  function expectedRowsForPage(totalCount, pageSize, pageNumber) {
    const pageCount = expectedPageCount(totalCount, pageSize);
    if (!Number.isSafeInteger(pageNumber) || pageNumber < 1 || pageNumber > pageCount) return 0;
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

  function isExactNumericPageLink(dataPage, textContent, pageNumber) {
    const expected = String(pageNumber);
    return normalizeCell(dataPage) === expected && normalizeCell(textContent) === expected;
  }

  function selectPaginationCandidate(candidates, pageNumber) {
    const expected = String(pageNumber);
    const eligible = (Array.isArray(candidates) ? candidates : [])
      .map((candidate, index) => ({ ...candidate, index }))
      .filter(candidate => candidate.visible !== false && candidate.enabled !== false);
    const numeric = eligible.find(candidate => isExactNumericPageLink(candidate.dataPage, candidate.text, pageNumber));
    if (numeric) return { index: numeric.index, kind: "numeric" };

    const sameTargetJump = eligible.find(candidate =>
      normalizeCell(candidate.dataPage) === expected && normalizeCell(candidate.text) !== expected
    );
    if (sameTargetJump) return { index: sameTargetJump.index, kind: "target-jump" };

    const numericPages = eligible.map(candidate => {
      const text = normalizeCell(candidate.text);
      return /^\d+$/.test(text) ? Number(text) : null;
    }).filter(value => Number.isSafeInteger(value));
    const minimum = numericPages.length > 0 ? Math.min(...numericPages) : 1;
    const maximum = numericPages.length > 0 ? Math.max(...numericPages) : 1;
    const labelSets = pageNumber > maximum
      ? [[">", "›", "»", "다음", "NEXT"], [">>", "≫", "마지막"]]
      : pageNumber < minimum
        ? [["<", "‹", "«", "이전", "PREV"], ["<<", "≪", "처음"]]
        : [];
    for (const labels of labelSets) {
      const candidate = eligible.find(item => labels.includes(normalizeCell(item.text).toUpperCase()));
      if (candidate) return { index: candidate.index, kind: pageNumber > maximum ? "forward-block" : "backward-block" };
    }
    return null;
  }

  function validateCapture(input) {
    const totalCount = Number(input && input.totalCount);
    const pageSize = Number(input && input.pageSize);
    const columnCount = Number(input && input.columnCount);
    const pages = Array.isArray(input && input.pages) ? input.pages : [];
    const errors = [];

    if (!Number.isSafeInteger(totalCount) || totalCount <= 0) errors.push("검색 결과 총건수가 올바르지 않습니다.");
    if (totalCount > MAX_TRANSFER_ROWS) errors.push(`한 번에 수집할 수 있는 최대 ${MAX_TRANSFER_ROWS}건을 초과했습니다.`);
    if (![10, 25, 50, 100].includes(pageSize)) errors.push("페이지 표시 개수가 10/25/50/100 중 하나가 아닙니다.");
    if (!Number.isSafeInteger(columnCount) || columnCount <= 0) errors.push("표 컬럼 수가 올바르지 않습니다.");

    const pageCount = expectedPageCount(totalCount, pageSize);
    if (pageCount > 0 && pages.length !== pageCount) errors.push(`예상 ${pageCount}페이지 중 ${pages.length}페이지만 수집되었습니다.`);

    const seenFingerprints = new Set();
    const rowFirstSeenPage = new Map();
    let repeatedBoundaryRowCount = 0;
    let collectedRowCount = 0;
    pages.forEach((page, index) => {
      const expectedPageNumber = index + 1;
      const pageNumber = Number(page && page.pageNumber);
      const rows = Array.isArray(page && page.rows) ? page.rows : [];
      if (pageNumber !== expectedPageNumber) errors.push(`${expectedPageNumber}페이지 순서가 올바르지 않습니다.`);

      const expectedRows = expectedRowsForPage(totalCount, pageSize, expectedPageNumber);
      if (rows.length !== expectedRows) errors.push(`${expectedPageNumber}페이지가 예상 ${expectedRows}행 대신 ${rows.length}행입니다.`);
      rows.forEach((row, rowIndex) => {
        if (!Array.isArray(row) || row.length !== columnCount) {
          errors.push(`${expectedPageNumber}페이지 ${rowIndex + 1}행의 컬럼 수가 ${columnCount}개와 다릅니다.`);
        }
        const rowKey = (Array.isArray(row) ? row : []).map(normalizeCell).join("\u001f");
        const firstSeenPage = rowFirstSeenPage.get(rowKey);
        if (firstSeenPage && firstSeenPage !== expectedPageNumber) repeatedBoundaryRowCount += 1;
        else if (!firstSeenPage) rowFirstSeenPage.set(rowKey, expectedPageNumber);
      });

      const fingerprint = fingerprintRows(rows);
      if (seenFingerprints.has(fingerprint)) errors.push(`${expectedPageNumber}페이지가 앞 페이지와 반복되었습니다.`);
      seenFingerprints.add(fingerprint);
      collectedRowCount += rows.length;
    });

    if (repeatedBoundaryRowCount > 0) errors.push(`페이지 경계에서 동일한 행 ${repeatedBoundaryRowCount}건이 반복되었습니다.`);
    if (collectedRowCount !== totalCount) errors.push(`총 ${totalCount}건 중 ${collectedRowCount}건만 수집되었습니다.`);
    return {
      complete: errors.length === 0,
      errors,
      totalCount,
      collectedRowCount,
      pageSize,
      pageCount,
      columnCount,
      pageFingerprints: pages.map(page => fingerprintRows(Array.isArray(page && page.rows) ? page.rows : [])),
      pageRowCounts: pages.map(page => Array.isArray(page && page.rows) ? page.rows.length : 0),
    };
  }

  function buildTsv(headers, pages) {
    const lines = [headers.map(normalizeCell).join("\t")];
    pages.forEach(page => {
      page.rows.forEach(row => lines.push(row.map(normalizeCell).join("\t")));
    });
    return lines.join("\n");
  }

  return {
    CAPTURE_MODE,
    MAX_TRANSFER_ROWS,
    normalizeCell,
    parseTotalCount,
    expectedPageCount,
    expectedRowsForPage,
    fingerprintRows,
    isExactNumericPageLink,
    selectPaginationCandidate,
    validateCapture,
    buildTsv,
  };
});
