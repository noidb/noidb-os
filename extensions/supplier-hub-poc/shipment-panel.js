(function () {
  "use strict";
  if (location.pathname !== "/ibs/asn/active" || document.getElementById("noidb-shipment-reader")) return;
  const panel = document.createElement("section");
  panel.id = "noidb-shipment-reader";
  panel.style.cssText = "padding:16px;margin:16px;border:2px solid #55735c;border-radius:10px;background:#f3f7f1;color:#29352f";
  panel.innerHTML = '<h3>NOID-B 쉽먼트 입고결과</h3><p>확인할 발주번호만 입력하고 가져오기를 누르세요. 쿠팡 자료는 변경하지 않습니다.</p><textarea aria-label="조회할 발주번호" rows="2" style="width:100%" placeholder="발주번호를 줄바꿈 또는 쉼표로 구분"></textarea><div><button type="button" data-action="collect">쉽먼트 입고결과 가져오기</button> <button type="button" data-action="cancel" hidden>중단</button> <button type="button" data-action="send" disabled>NOID-B로 전송</button> <button type="button" data-action="download" disabled>자료 파일 저장</button></div><p role="status" aria-live="polite"></p>';
  const main = document.querySelector("#app") || document.body;
  main.prepend(panel);
  const input = panel.querySelector("textarea"), status = panel.querySelector('[role="status"]');
  const collect = panel.querySelector('[data-action="collect"]'), cancel = panel.querySelector('[data-action="cancel"]');
  const send = panel.querySelector('[data-action="send"]'), download = panel.querySelector('[data-action="download"]');
  const requested = new URLSearchParams(location.hash.slice(1)).get("noidb-po");
  if (requested && /^[\d,\s]+$/.test(requested)) input.value = requested;
  let result = null, controller = null;
  collect.addEventListener("click", async () => {
    result = null; collect.disabled = input.disabled = true; send.disabled = download.disabled = true; cancel.hidden = false;
    controller = new AbortController();
    try {
      result = await NoidbShipmentReceipts.collect(input.value.trim().split(/[\s,]+/), message => { status.textContent = message; }, controller.signal);
      const closed = result.shipments.filter(item => item.status === "마감").length;
      status.textContent = `조회 완료 · 발주 ${result.orders.length}건 · 쉽먼트 ${result.shipments.length}건 중 마감 ${closed}건. NOID-B로 전송해 주세요.`;
      send.disabled = download.disabled = false;
    } catch (error) {
      status.textContent = error.name === "AbortError" ? "중단했습니다. 일부 자료를 완료로 저장하지 않았습니다." : error.message;
    } finally { controller = null; collect.disabled = input.disabled = false; cancel.hidden = true; }
  });
  cancel.addEventListener("click", () => controller?.abort());
  send.addEventListener("click", async () => {
    if (!result) return;
    send.disabled = collect.disabled = true;
    status.textContent = "NOID-B에 저장 중…";
    try {
      const response = await chrome.runtime.sendMessage({ type: "NOIDB_SAVE_SHIPMENT_RECEIPTS", payload: result });
      if (!response?.ok) throw new Error(response?.error || "저장 여부를 확인하지 못했습니다. 자료 파일을 저장해 주세요.");
      status.textContent = `NOID-B 저장 완료 · 발주 ${response.count}건. 미납 분류나 처리완료 상태는 변경하지 않았습니다.`;
    } catch (error) { status.textContent = error.message; }
    finally { send.disabled = collect.disabled = false; }
  });
  download.addEventListener("click", () => {
    if (!result) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(result, null, 2)], { type: "application/json" }));
    const link = document.createElement("a"); link.href = url; link.download = `NOIDB_쉽먼트입고_${result.collectedAt.replace(/[:.]/g, "-")}.json`;
    document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 60000);
  });
})();
