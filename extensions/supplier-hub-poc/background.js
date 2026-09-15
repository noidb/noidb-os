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
