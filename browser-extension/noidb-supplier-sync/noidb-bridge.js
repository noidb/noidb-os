(() => {
  const TRANSFERS = {
    "wims-extension": {
      storageKey: "noidbPendingWimsTransfer",
      eventType: "NOIDB_WIMS_EXTENSION_TRANSFER",
      ackType: "NOIDB_WIMS_EXTENSION_ACK",
    },
    "supply-status-extension": {
      storageKey: "noidbPendingSupplyStatusTransfer",
      eventType: "NOIDB_SUPPLY_STATUS_EXTENSION_TRANSFER",
      ackType: "NOIDB_SUPPLY_STATUS_EXTENSION_ACK",
    },
  };
  const POLL_INTERVAL_MS = 500;
  const MAX_POLL_MS = 6 * 60 * 1000;
  const MAX_DELIVERY_MS = 60 * 1000;

  async function deliver() {
    const params = new URLSearchParams(window.location.search);
    const config = TRANSFERS[params.get("source")];
    if (!config) return;
    const expectedTransferId = params.get("transferId") || "";
    const pollStartedAt = Date.now();
    let payload = null;
    while (Date.now() - pollStartedAt < MAX_POLL_MS) {
      const stored = await chrome.storage.local.get(config.storageKey);
      const candidate = stored[config.storageKey];
      const idMatches = !expectedTransferId || candidate?.transferId === expectedTransferId;
      const hasTransferBody = typeof candidate?.text === "string" || (Array.isArray(candidate?.headers) && Array.isArray(candidate?.rows));
      if (candidate && hasTransferBody && candidate.coverageComplete !== false && idMatches) {
        payload = candidate;
        break;
      }
      await new Promise(resolve => window.setTimeout(resolve, POLL_INTERVAL_MS));
    }
    if (!payload) return;

    const deliveryStartedAt = Date.now();
    const send = () => window.postMessage({ type: config.eventType, payload }, window.location.origin);
    const timer = window.setInterval(() => {
      if (Date.now() - deliveryStartedAt >= MAX_DELIVERY_MS) window.clearInterval(timer);
      else send();
    }, POLL_INTERVAL_MS);
    const receiveAck = async event => {
      if (event.source !== window || event.origin !== window.location.origin || event.data?.type !== config.ackType) return;
      window.clearInterval(timer);
      window.removeEventListener("message", receiveAck);
      if (event.data.accepted === false) return;
      const stored = await chrome.storage.local.get(config.storageKey);
      const current = stored[config.storageKey];
      if (current && (!payload.transferId || current.transferId === payload.transferId)) {
        await chrome.storage.local.remove(config.storageKey);
      }
    };
    window.addEventListener("message", receiveAck);
    send();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", deliver, { once: true });
  else deliver();
})();
