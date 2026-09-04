(() => {
  const STORAGE_KEY = "noidbPendingWimsTransfer";
  const EVENT_TYPE = "NOIDB_WIMS_EXTENSION_TRANSFER";
  const ACK_TYPE = "NOIDB_WIMS_EXTENSION_ACK";
  const POLL_INTERVAL_MS = 500;
  const MAX_POLL_MS = 6 * 60 * 1000;
  const MAX_DELIVERY_MS = 60 * 1000;

  async function deliver() {
    const params = new URLSearchParams(window.location.search);
    if (params.get("source") !== "wims-extension") return;
    const expectedTransferId = params.get("transferId") || "";
    const pollStartedAt = Date.now();
    let payload = null;
    while (Date.now() - pollStartedAt < MAX_POLL_MS) {
      const stored = await chrome.storage.local.get(STORAGE_KEY);
      const candidate = stored[STORAGE_KEY];
      const idMatches = !expectedTransferId || candidate?.transferId === expectedTransferId;
      if (candidate && typeof candidate.text === "string" && candidate.coverageComplete !== false && idMatches) {
        payload = candidate;
        break;
      }
      await new Promise(resolve => window.setTimeout(resolve, POLL_INTERVAL_MS));
    }
    if (!payload) return;

    const deliveryStartedAt = Date.now();
    const send = () => window.postMessage({ type: EVENT_TYPE, payload }, window.location.origin);
    const timer = window.setInterval(() => {
      if (Date.now() - deliveryStartedAt >= MAX_DELIVERY_MS) window.clearInterval(timer);
      else send();
    }, POLL_INTERVAL_MS);
    const receiveAck = async event => {
      if (event.source !== window || event.origin !== window.location.origin || event.data?.type !== ACK_TYPE) return;
      window.clearInterval(timer);
      window.removeEventListener("message", receiveAck);
      if (event.data.accepted === false) return;
      const stored = await chrome.storage.local.get(STORAGE_KEY);
      const current = stored[STORAGE_KEY];
      if (current && (!payload.transferId || current.transferId === payload.transferId)) {
        await chrome.storage.local.remove(STORAGE_KEY);
      }
    };
    window.addEventListener("message", receiveAck);
    send();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", deliver, { once: true });
  else deliver();
})();
