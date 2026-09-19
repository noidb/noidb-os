chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== "NOIDB_SAVE_SHIPMENT_RECEIPTS") return;
  let source;
  try { source = new URL(sender.tab?.url || ""); } catch { return; }
  if (source.origin !== "https://supplier.coupang.com" || source.pathname !== "/ibs/asn/active") return;
  (async () => {
    try {
      const endpoint = "https://noidb-os.vercel.app/api/wms/vendor-orders/shipment-receipts";
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 45000);
      try {
        const ready = await fetch(endpoint, { cache: "no-store", signal: controller.signal });
        const info = await ready.json().catch(() => ({}));
        if (!ready.ok || !info.ok || info.status !== "ready" || info.source !== "supplier-hub-shipments" || info.schemaVersion !== 1) throw new Error("NOID-B의 쉽먼트 수집 기능이 아직 준비되지 않았습니다. 자료 파일을 저장해 주세요.");
        const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(message.payload), signal: controller.signal });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || !result.ok) throw new Error(result.error || "쉽먼트 입고결과를 저장하지 못했습니다.");
        sendResponse({ ok: true, count: result.orders.length });
      } finally { clearTimeout(timer); }
    } catch (error) { sendResponse({ ok: false, error: error.name === "AbortError" ? "저장 응답이 지연됐습니다. 저장 결과를 확인한 뒤 다시 전송해 주세요." : error.message }); }
  })();
  return true;
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!["NOIDB_GET_LOGISTICS_RECEIPT_TARGETS", "NOIDB_SAVE_LOGISTICS_RECEIPTS"].includes(message?.type)) return;
  let source;
  try { source = new URL(sender.tab?.url || ""); } catch { return; }
  if (source.origin !== "https://supplier.coupang.com" || source.pathname !== "/ibs/asn/active") return;
  (async () => {
    const endpoint = "https://noidb-os.vercel.app/api/wms/logistics/receipts";
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 45000);
    try {
      const ready = await fetch(endpoint, { cache: "no-store", signal: controller.signal });
      const info = await ready.json().catch(() => ({}));
      if (!ready.ok || !info.ok || info.status !== "ready" || info.source !== "supplier-hub-shipments" || info.schemaVersion !== 3 || !Array.isArray(info.targets)) {
        throw new Error("NOID-B의 물류 입고결과 기능이 아직 준비되지 않았습니다. 자료 파일을 저장해 주세요.");
      }
      if (message.type === "NOIDB_GET_LOGISTICS_RECEIPT_TARGETS") { sendResponse({ ok: true, targets: info.targets }); return; }
      const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(message.payload), signal: controller.signal });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.ok) throw new Error(result.error || "물류 입고결과를 저장하지 못했습니다.");
      sendResponse({ ok: true, count: result.count ?? message.payload?.shipments?.length ?? 0 });
    } catch (error) {
      sendResponse({ ok: false, error: error.name === "AbortError" ? "저장 응답이 지연됐습니다. 저장 결과를 확인한 뒤 다시 전송해 주세요." : error.message });
    } finally { clearTimeout(timer); }
  })();
  return true;
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== "NOIDB_TRUSTED_DATE_OPTION_CLICK") return;
  const tab = sender.tab;
  if (!tab?.id || !tab.url) { sendResponse({ ok: false, reason: "sender-tab-missing" }); return; }
  let url;
  try { url = new URL(tab.url); } catch { sendResponse({ ok: false, reason: "invalid-tab-url" }); return; }
  if (url.hostname !== "supplier.coupang.com" || url.pathname !== "/po-web/purchase/order/list") {
    sendResponse({ ok: false, reason: "forbidden-tab" }); return;
  }
  const x = Number(message.x), y = Number(message.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) { sendResponse({ ok: false, reason: "invalid-coordinates" }); return; }
  (async () => {
    let attached = false;
    try {
      await chrome.debugger.attach({ tabId: tab.id }, "1.3");
      attached = true;
      await chrome.debugger.sendCommand({ tabId: tab.id }, "Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
      await chrome.debugger.sendCommand({ tabId: tab.id }, "Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
      sendResponse({ ok: true });
    } catch (error) {
      sendResponse({ ok: false, reason: String(error?.message || "debugger-input-failed") });
    } finally {
      if (attached) { try { await chrome.debugger.detach({ tabId: tab.id }); } catch {} }
    }
  })();
  return true;
});
