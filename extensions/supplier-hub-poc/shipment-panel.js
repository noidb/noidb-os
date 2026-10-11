(function () {
  "use strict";
  // 0.9.9(2026-10-11): 쿠팡은 메뉴로 이동할 때 페이지를 새로 열지 않아 칸이 안 뜨던 문제 →
  // 쿠팡 모든 화면에 들어가 있다가, 주소가 쉽먼트 목록일 때만 칸을 붙이고(화면이 다시 그려져 빠지면 다시 붙임) 다른 화면에선 뗀다.
  const PANEL_PATH = "/ibs/asn/active";
  if (document.getElementById("noidb-shipment-reader")) return;
  const panel = document.createElement("section");
  panel.id = "noidb-shipment-reader";
  panel.style.cssText = "padding:16px;margin:16px;border:2px solid #55735c;border-radius:10px;background:#f3f7f1;color:#29352f";
  panel.innerHTML = '<h3>NOID-B 쉽먼트 입고결과</h3><p>입고예정일 9/13 이후 마감된 쉽먼트 중 새로 마감된 것만 읽습니다. 쿠팡 자료는 변경하지 않습니다.</p><div><button type="button" data-action="collect">입고결과 일괄 가져오기</button> <button type="button" data-action="cancel" hidden>중단</button> <button type="button" data-action="retry" disabled>NOID-B 전송 재시도</button> <button type="button" data-action="download" disabled>자료 파일 저장</button></div><p role="status" aria-live="polite"></p>';
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
  placePanel();
  setInterval(placePanel, 1000);
})();
