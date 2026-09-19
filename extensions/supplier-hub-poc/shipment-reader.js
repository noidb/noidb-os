/* Manual, read-only Supplier Hub shipment collector. No background polling. */
(function (root) {
  "use strict";
  const clean = value => String(value || "").replace(/\s+/g, " ").trim();
  const number = value => {
    const raw = clean(value).replace(/,/g, "");
    if (!/^\d+$/.test(raw) || !Number.isSafeInteger(Number(raw))) throw new Error("수량을 정확히 읽지 못했습니다.");
    return Number(raw);
  };

  // Expand rowspan/colspan before assigning columns (one box spans multiple SKU rows).
  function expandRows(rows) {
    const grid = [];
    rows.forEach((cells, r) => {
      grid[r] ||= [];
      let column = 0;
      for (const cell of cells) {
        while (grid[r][column] !== undefined) column++;
        const height = cell.rowSpan || 1, width = cell.colSpan || 1;
        if (height < 1 || height > 10000 || width < 1 || width > 20) throw new Error("표의 병합 형식을 확인해 주세요.");
        for (let y = r; y < r + height; y++) {
          grid[y] ||= [];
          for (let x = column; x < column + width; x++) {
            if (grid[y][x] !== undefined) throw new Error("표의 셀이 겹칩니다.");
            grid[y][x] = clean(cell.text);
          }
        }
        column += width;
      }
    });
    if (grid.length !== rows.length) throw new Error("쉽먼트 표의 일부 행이 없습니다.");
    return grid;
  }
  const tableRows = table => expandRows([...table.rows].map(row => [...row.cells].map(cell => ({
    text: cell.textContent, rowSpan: cell.rowSpan, colSpan: cell.colSpan,
  }))));

  function parseDetail(doc, shipmentNumber) {
    const heading = [...doc.querySelectorAll("h4")].map(node => clean(node.textContent)).find(value => value.includes("쉽먼트 상태"));
    if (!heading || !heading.includes(`# ${shipmentNumber} `)) throw new Error(`쉽먼트 ${shipmentNumber} 상세를 확인하지 못했습니다. 로그인을 확인해 주세요.`);
    const status = heading.match(/쉽먼트\s*상태\s*:\s*(.+)$/)?.[1]?.trim();
    if (status !== "마감") return { shipmentNumber, status: status || "확인 필요", totalDelivered: null, totalReceived: null, lines: [] };
    const table = doc.querySelector("#shipmentDetailTable");
    if (!table) throw new Error(`쉽먼트 ${shipmentNumber}의 SKU 표가 없습니다.`);
    const rows = tableRows(table), expected = ["박스", "발주번호", "SKU", "SKU 이름", "SKU 바코드", "납품수량", "입고수량"];
    if (JSON.stringify(rows[0]) !== JSON.stringify(expected)) throw new Error("쿠팡 쉽먼트 표의 열이 변경되었습니다. 수집을 중단했습니다.");
    const lines = rows.slice(1).map(row => {
      if (row.length !== 7 || !/^\d+$/.test(row[1]) || !/^\d+$/.test(row[2])) throw new Error("발주번호 또는 SKU를 정확히 읽지 못했습니다.");
      return { boxId: row[0], purchaseOrderNumber: row[1], skuId: row[2], productName: row[3], barcode: row[4],
        deliveredQuantity: number(row[5]), receivedQuantity: number(row[6]) };
    });
    const total = [...doc.querySelectorAll("table")].map(tableRows).find(rows => rows[0]?.includes("총 입고 수량"));
    if (!total || total.length !== 2 || !lines.length) throw new Error("쉽먼트 총수량을 확인하지 못했습니다.");
    const totalDelivered = number(total[1][total[0].indexOf("총 납품 수량")]);
    const totalReceived = number(total[1][total[0].indexOf("총 입고 수량")]);
    if (lines.reduce((n, line) => n + line.deliveredQuantity, 0) !== totalDelivered
      || lines.reduce((n, line) => n + line.receivedQuantity, 0) !== totalReceived) throw new Error("SKU 수량과 쉽먼트 총수량이 다릅니다. 수집을 중단했습니다.");
    const keys = lines.map(line => JSON.stringify([line.boxId, line.purchaseOrderNumber, line.skuId]));
    if (new Set(keys).size !== keys.length) throw new Error("동일 박스의 SKU가 중복되었습니다.");
    return { shipmentNumber, status, totalDelivered, totalReceived, lines };
  }

  function parseList(doc, page) {
    const table = doc.querySelector("#parcel-tab");
    const script = [...doc.querySelectorAll("script")].map(node => node.textContent).find(value => value.includes("bootpag(") && value.includes("parcel-pagination"));
    const total = script?.match(/\btotal\s*:\s*(\d+)/)?.[1];
    const current = script?.match(/\bpage\s*:\s*(\d+)/)?.[1];
    if (!table || total === undefined || Number(current) !== page || Number(total) > 1000) throw new Error("쉽먼트 목록 전체 범위를 확인하지 못했습니다. 로그인을 확인해 주세요.");
    const rows = [...table.querySelectorAll("tr[data-id]")].map(row => {
      const shipmentNumber = row.getAttribute("data-id"), status = clean(row.cells[1]?.textContent);
      if (!/^\d+$/.test(shipmentNumber || "") || !status || row.getAttribute("data-type") !== "PARCEL") throw new Error("쉽먼트 목록 형식이 변경되었습니다.");
      return { shipmentNumber, status };
    });
    if (Number(total) > 1 && !rows.length) throw new Error("쉽먼트 목록의 일부 페이지가 비어 있습니다.");
    return { totalPages: Number(total), rows };
  }

  async function collect(purchaseOrderNumbers, progress = () => {}, signal) {
    if (location.origin !== "https://supplier.coupang.com") throw new Error("Supplier Hub에서 실행해 주세요.");
    const pos = [...new Set(purchaseOrderNumbers)];
    if (!pos.length || pos.length > 200 || !pos.every(po => /^\d{1,20}$/.test(po))) throw new Error("발주번호를 1~200개 입력해 주세요.");
    async function getDocument(url) {
      const request = new AbortController(), abort = () => request.abort();
      if (signal?.aborted) abort();
      signal?.addEventListener("abort", abort, { once: true });
      const timer = setTimeout(abort, 30000);
      try {
        const response = await fetch(url, { credentials: "same-origin", cache: "no-store", signal: request.signal,
          ...(url.includes("/list?") ? { headers: { "X-Requested-With": "XMLHttpRequest" } } : {}) });
        if (!response.ok || response.redirected || new URL(response.url).origin !== location.origin) throw new Error("쿠팡 조회가 실패했습니다. 다시 로그인한 뒤 가져와 주세요.");
        return new DOMParser().parseFromString(await response.text(), "text/html");
      } catch (error) {
        if (request.signal.aborted && !signal?.aborted) throw new Error("쿠팡 조회 응답이 30초 이상 지연됐습니다. 잠시 후 다시 가져와 주세요.");
        throw error;
      } finally { clearTimeout(timer); signal?.removeEventListener("abort", abort); }
    }
    async function list(po) {
      const found = [], seen = new Set();
      let pages = 1;
      for (let page = 1; page <= pages; page++) {
        const query = new URLSearchParams({ pageNumber: String(page), centerCode: "", carrierCode: "", estimatedDeliveryDate: "", shipmentSeq: "", purchaseOrderSeq: po });
        const result = parseList(await getDocument(`/ibs/shipment/parcel/list?${query}`), page);
        if (page > 1 && result.totalPages !== pages) throw new Error("조회 중 쉽먼트 목록이 바뀌었습니다. 다시 가져와 주세요.");
        pages = result.totalPages;
        for (const row of result.rows) {
          if (seen.has(row.shipmentNumber)) throw new Error("페이지 간 쉽먼트가 중복되었습니다. 다시 가져와 주세요.");
          seen.add(row.shipmentNumber); found.push(row);
        }
      }
      return found.sort((a, b) => a.shipmentNumber.localeCompare(b.shipmentNumber));
    }
    const orders = [], shipments = new Map();
    for (const [index, po] of pos.entries()) {
      progress(`발주 ${index + 1}/${pos.length} · ${po} 조회 중`);
      const found = await list(po);
      for (const row of found) {
        const previous = shipments.get(row.shipmentNumber);
        if (previous && previous.status !== row.status) throw new Error("조회 중 쉽먼트 상태가 바뀌었습니다. 다시 가져와 주세요.");
        if (!previous) {
          const receipt = row.status === "마감" ? parseDetail(await getDocument(`/ibs/shipment/parcel/${row.shipmentNumber}`), row.shipmentNumber)
            : { ...row, totalDelivered: null, totalReceived: null, lines: [] };
          if (receipt.status !== row.status) throw new Error("목록과 상세의 쉽먼트 상태가 다릅니다. 다시 가져와 주세요.");
          shipments.set(row.shipmentNumber, receipt);
        }
        const receipt = shipments.get(row.shipmentNumber);
        if (receipt.status === "마감" && !receipt.lines.some(line => line.purchaseOrderNumber === po)) throw new Error("쉽먼트 상세에 검색한 발주번호가 없습니다.");
      }
      // Detect page shifts and status changes rather than declaring partial collection complete.
      if (JSON.stringify(await list(po)) !== JSON.stringify(found)) throw new Error("조회 중 쉽먼트 목록이 바뀌었습니다. 다시 가져와 주세요.");
      orders.push({ purchaseOrderNumber: po, shipmentNumbers: found.map(row => row.shipmentNumber) });
    }
    return { schemaVersion: 1, source: "supplier-hub-shipments", collectedAt: new Date().toISOString(), orders, shipments: [...shipments.values()] };
  }
  const api = { expandRows, parseDetail, parseList, collect };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.NoidbShipmentReceipts = api;
})(globalThis);
