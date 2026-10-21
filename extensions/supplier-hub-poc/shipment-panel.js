(function () {
  "use strict";
  // 0.9.9(2026-10-11): 쿠팡은 메뉴로 이동할 때 페이지를 새로 열지 않아 칸이 안 뜨던 문제 →
  // 쿠팡 모든 화면에 들어가 있다가, 주소가 쉽먼트 목록일 때만 칸을 붙이고(화면이 다시 그려져 빠지면 다시 붙임) 다른 화면에선 뗀다.
  const PANEL_PATH = "/ibs/asn/active";
  if (document.getElementById("noidb-shipment-reader")) return;
  const panel = document.createElement("section");
  panel.id = "noidb-shipment-reader";
  panel.style.cssText = "padding:16px;margin:16px;border:2px solid #55735c;border-radius:10px;background:#f3f7f1;color:#29352f";
  panel.innerHTML = '<h3>NOID-B 쉽먼트 입고결과</h3><p>입고예정일 9/13 이후 마감된 쉽먼트 중 새로 마감된 것만 읽습니다. 쿠팡 자료는 변경하지 않습니다.</p><div><button type="button" data-action="collect">입고결과 일괄 가져오기</button> <button type="button" data-action="cancel" hidden>중단</button> <button type="button" data-action="retry" disabled>NOID-B 전송 재시도</button> <button type="button" data-action="download" disabled>자료 파일 저장</button></div><p role="status" aria-live="polite"></p><div data-pdf style="margin-top:10px;padding:10px;border-top:1px solid #c9d6cb"><strong>Label·내역서 PDF 자동 저장</strong><p style="margin:4px 0">Label·내역서를 누르면 컴퓨터로 받지 않고 G드라이브 출력세트 폴더에 바로 저장합니다(저장 창 없음).</p><div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin:6px 0"><label>입고예정일 <select data-pdf-date style="height:30px;border-radius:8px"></select></label><button type="button" data-action="pdf-all" style="height:30px;padding:0 12px;border:1px solid #c9d6cb;border-radius:8px;background:#e3ede6;font-weight:700;cursor:pointer">이 날짜 Label·내역서 전부 받기</button></div><p data-pdf-batch style="margin:4px 0"></p><p data-pdf-status style="margin:4px 0">아직 받은 PDF 없음</p><p data-pdf-url style="margin:4px 0;font-size:11px;color:#5d6b62"></p></div>';
  function placePanel() {
    if (location.pathname === PANEL_PATH) {
      if (!panel.isConnected) (document.querySelector("#app") || document.body).prepend(panel);
    } else if (panel.isConnected && !controller) panel.remove();
  }
  const status = panel.querySelector('[role="status"]');
  const collect = panel.querySelector('[data-action="collect"]'), cancel = panel.querySelector('[data-action="cancel"]');
  const retry = panel.querySelector('[data-action="retry"]'), download = panel.querySelector('[data-action="download"]');
  let result = null, controller = null;
  async function save() {
    if (!result) return;
    retry.disabled = collect.disabled = true;
    status.textContent = "NOID-B에 저장 중…";
    try {
      const response = await chrome.runtime.sendMessage({ type: "NOIDB_SAVE_LOGISTICS_RECEIPTS", payload: result });
      if (!response?.ok) throw new Error(response?.error || "저장 여부를 확인하지 못했습니다. 자료 파일을 저장해 주세요.");
      status.textContent = `NOID-B 저장 완료 · 새로 ${result.shipments.length}건 추가, 전체 쉽먼트 ${response.count}건.`;
      download.disabled = retry.disabled = true;
    } catch (error) {
      status.textContent = `${error.message} 자료 파일을 저장하거나 전송을 재시도해 주세요.`;
      retry.disabled = download.disabled = false;
    } finally { collect.disabled = false; }
  }
  collect.addEventListener("click", async () => {
    result = null; collect.disabled = true; retry.disabled = download.disabled = true; cancel.hidden = false;
    controller = new AbortController();
    try {
      status.textContent = "NOID-B의 수집 대상을 확인 중…";
      const targets = await chrome.runtime.sendMessage({ type: "NOIDB_GET_LOGISTICS_RECEIPT_TARGETS" });
      if (!targets?.ok || !Array.isArray(targets.targets)) throw new Error(targets?.error || "NOID-B의 쉽먼트 수집 기능이 아직 준비되지 않았습니다.");
      const report = message => { status.textContent = message; };
      result = targets.collectionMode === "hub-closed"
        ? await NoidbShipmentReceipts.collectClosedSince(targets.since, report, controller.signal, targets.knownShipmentNumbers)
        : await NoidbShipmentReceipts.collectShipments(targets.targets, report, controller.signal);
      if (result?.nothingNew) {
        status.textContent = `새로 마감된 쉽먼트가 없습니다. 쿠팡 마감 ${result.closedCount}건은 모두 이미 NOID-B에 있습니다.`;
        result = null;
        return;
      }
      const closed = result.shipments.filter(item => item.status === "마감").length;
      status.textContent = `조회 완료 · 새로 마감된 쉽먼트 ${closed}건. NOID-B에 자동 전송합니다.`;
      await save();
    } catch (error) {
      status.textContent = error.name === "AbortError" ? "중단했습니다. 일부 자료를 완료로 저장하지 않았습니다." : error.message;
    } finally { controller = null; collect.disabled = false; cancel.hidden = true; }
  });
  cancel.addEventListener("click", () => controller?.abort());
  retry.addEventListener("click", save);
  download.addEventListener("click", () => {
    if (!result) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(result, null, 2)], { type: "application/json" }));
    const link = document.createElement("a"); link.href = url; link.download = `NOIDB_쉽먼트입고_${result.collectedAt.replace(/[:.]/g, "-")}.json`;
    document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 60000);
  });
  // 0.9.10: PDF 자동 저장 결과
  const pdfStatus = panel.querySelector("[data-pdf-status]"), pdfUrl = panel.querySelector("[data-pdf-url]");
  let pdfSaved = 0, pdfFailed = 0;
  // 0.9.11: 크롬 다운로드에서 잡은 PDF 결과도 같은 칸에 보여 준다.
  try {
    chrome.runtime.onMessage.addListener(message => {
      if (message?.type === "NOIDB_PDF_STATUS") document.dispatchEvent(new CustomEvent("noidb-shipment-pdf", { detail: message.detail }));
    });
  } catch {}
  document.addEventListener("noidb-shipment-pdf", event => {
    const detail = event.detail || {};
    const label = detail.kind === "ManiFest" ? "내역서" : "Label";
    if (detail.phase === "sending") pdfStatus.textContent = `${label} PDF를 NOID-B에 저장하는 중…`;
    else if (detail.phase === "saved") { pdfSaved += 1; pdfStatus.textContent = `저장 완료 ${pdfSaved}개${pdfFailed ? ` · 실패 ${pdfFailed}개` : ""} · 최근: ${detail.name}${detail.skipped ? " (이미 저장돼 있음)" : ""}`; }
    else if (detail.phase === "failed") { pdfFailed += 1; pdfStatus.textContent = `저장 실패: ${detail.error} — 이 PDF는 예전처럼 G드라이브 폴더에 직접 저장해 주세요.`; }
    // 다음 버전에서 '한 번에 전부 받기'를 만들 수 있도록 쿠팡이 PDF를 주는 주소를 보여 준다.
    if (detail.url) pdfUrl.textContent = `받은 주소: ${detail.url}`;
    if (detail.phase === "saved") rememberDone(detail.name, detail.kind);
  });

  // 0.9.11(2026-10-21): '이 날짜 Label·내역서 전부 받기' — 화면 목록에서 고른 입고예정일 쉽먼트의 [Label]·[내역서]를 차례로 눌러 받는다.
  // 이미 받아 저장된 쉽먼트·종류는 건너뛰어 같은 파일을 두 번 받지 않는다(30일 기억). 쿠팡 자료는 바꾸지 않고 받기 버튼만 누른다.
  const DONE_KEY = "noidbShipmentPdfDone";
  const dateSelect = panel.querySelector("[data-pdf-date]"), pdfAll = panel.querySelector('[data-action="pdf-all"]'), pdfBatch = panel.querySelector("[data-pdf-batch]");
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  async function readDone() {
    try { const stored = await chrome.storage.local.get(DONE_KEY); return stored[DONE_KEY] || {}; } catch { return {}; }
  }
  async function rememberDone(name, kind) {
    const shipment = String(name || "").match(/\((\d{5,})\)/)?.[1];
    if (!shipment || !kind) return;
    const done = await readDone();
    const cutoff = Date.now() - 30 * 86400000;
    for (const [key, at] of Object.entries(done)) if (Date.parse(at) < cutoff) delete done[key];
    done[`${shipment}:${kind}`] = new Date().toISOString();
    try { await chrome.storage.local.set({ [DONE_KEY]: done }); } catch {}
  }
  const textOf = element => (element?.textContent || "").replace(/\s+/g, " ").trim();
  /** 화면 목록에서 [Label]·[내역서] 버튼이 있는 줄만 읽는다. 입고예정일은 시각 없이 날짜만 있는 칸(발송일은 시각이 붙어 있음). */
  function shipmentRows() {
    return [...document.querySelectorAll("tr")].map(row => {
      const buttons = [...row.querySelectorAll("button, a")];
      const label = buttons.find(button => textOf(button) === "Label");
      const manifest = buttons.find(button => textOf(button) === "내역서");
      if (!label && !manifest) return null;
      const cells = [...row.children].map(textOf);
      const shipment = cells.find(text => /^\d{6,}$/.test(text)) || "";
      const date = cells.find(text => /^\d{4}-\d{2}-\d{2}$/.test(text)) || "";
      return shipment && date ? { shipment, date, label, manifest } : null;
    }).filter(Boolean);
  }
  let dateKey = "", pdfBusy = false;
  function refreshDates() {
    if (!panel.isConnected || pdfBusy) return;
    const counts = {};
    for (const row of shipmentRows()) counts[row.date] = (counts[row.date] || 0) + 1;
    const dates = Object.keys(counts).sort();
    const key = dates.map(date => `${date}:${counts[date]}`).join(",");
    if (key === dateKey) return;
    dateKey = key;
    const previous = dateSelect.value;
    const today = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
    dateSelect.innerHTML = dates.length ? dates.map(date => `<option value="${date}">${date} (${counts[date]}건)</option>`).join("") : '<option value="">목록을 검색해 주세요</option>';
    dateSelect.value = dates.includes(previous) ? previous : (dates.find(date => date >= today) || dates[dates.length - 1] || "");
    pdfAll.disabled = !dates.length;
  }
  pdfAll.addEventListener("click", async () => {
    const date = dateSelect.value;
    const rows = shipmentRows().filter(row => row.date === date);
    if (!date || !rows.length) { pdfBatch.textContent = "이 화면 목록에 그 날짜 쉽먼트가 없습니다. 쿠팡에서 검색한 뒤 다시 눌러 주세요."; return; }
    pdfBusy = true; pdfAll.disabled = dateSelect.disabled = true;
    const done = await readDone();
    let clicked = 0, skipped = 0;
    try {
      for (const row of rows) {
        for (const [kind, button, name] of [["Label", row.label, "Label"], ["ManiFest", row.manifest, "내역서"]]) {
          if (!button) continue;
          if (done[`${row.shipment}:${kind}`]) { skipped += 1; continue; }
          pdfBatch.textContent = `${date} 쉽먼트 ${rows.length}건 받는 중… ${row.shipment} ${name}`;
          button.click();
          clicked += 1;
          await wait(2500);
        }
      }
      pdfBatch.textContent = `${date} 쉽먼트 ${rows.length}건: 새로 받기 ${clicked}개${skipped ? ` · 이미 받은 ${skipped}개 건너뜀` : ""}. 저장 결과는 아래에 표시됩니다.`
       ;
    } finally { pdfBusy = false; pdfAll.disabled = dateSelect.disabled = false; }
  });
  placePanel();
  refreshDates();
  setInterval(() => { placePanel(); refreshDates(); }, 1000);
})();
