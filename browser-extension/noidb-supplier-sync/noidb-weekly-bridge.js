(() => {
  "use strict";
  const core = globalThis.NOIDBWeeklyCore;
  if (!core) return;
  const activeRequests = new Map();
  const post = message => window.postMessage(message, window.location.origin);
  const runtimeSend = message => chrome.runtime.sendMessage(message);
  window.addEventListener("message", async event => {
    if (event.source !== window || event.origin !== window.location.origin) return;
    const message = event.data;
    if (message?.type === "NOIDB_WEEKLY_COLLECT_REQUEST") {
      if (!core.allowedSite(window.location.href)) return;
      const error = core.validateRequest(message);
      if (error) { post({ type: "NOIDB_WEEKLY_COLLECT_ACK", requestId: message.requestId, accepted: false, error }); return; }
      if (activeRequests.has(message.requestId)) return;
      for (const timer of activeRequests.values()) window.clearInterval(timer);
      activeRequests.clear();
      activeRequests.set(message.requestId, null);
      try {
        const response = await runtimeSend({ type: message.type, requestId: message.requestId, startDate: message.startDate, endDate: message.endDate });
        post({ type: "NOIDB_WEEKLY_COLLECT_ACK", requestId: message.requestId, accepted: response?.accepted === true, error: response?.error });
        if (response?.accepted !== true) { activeRequests.delete(message.requestId); return; }
        const startedAt = Date.now();
        const timer = window.setInterval(() => {
          if (Date.now() - startedAt > core.MAX_AGE_MS) { window.clearInterval(timer); activeRequests.delete(message.requestId); return; }
          runtimeSend({ type: "NOIDB_WEEKLY_POLL", requestId: message.requestId }).catch(() => undefined);
        }, 1500);
        activeRequests.set(message.requestId, timer);
      } catch {
        activeRequests.delete(message.requestId);
        post({ type: "NOIDB_WEEKLY_COLLECT_ACK", requestId: message.requestId, accepted: false, error: "브라우저 연결을 새로고침한 뒤 다시 시작해주세요." });
      }
    } else if (message?.type === "NOIDB_INBOUND_EXTENSION_ACK" && typeof message.transferId === "string" && activeRequests.has(message.transferId)) {
      if (message.accepted !== true) return;
      await runtimeSend({ type: message.type, transferId: message.transferId, accepted: true });
      window.clearInterval(activeRequests.get(message.transferId));
      activeRequests.delete(message.transferId);
    }
  });
  chrome.runtime.onMessage.addListener(message => {
    if (!core.allowedSite(window.location.href)) return;
    if (message?.type === "NOIDB_WEEKLY_COLLECT_STATUS" && activeRequests.has(message.requestId)) {
      if (message.status === "error") { window.clearInterval(activeRequests.get(message.requestId)); activeRequests.delete(message.requestId); }
      post(message);
    } else if (message?.type === "NOIDB_INBOUND_EXTENSION_TRANSFER" && activeRequests.has(message.payload?.transferId) && message.payload?.coverageComplete === true) {
      post({ type: message.type, payload: message.payload });
    }
  });
})();
