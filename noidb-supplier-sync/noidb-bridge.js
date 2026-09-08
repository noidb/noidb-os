(() => {
  const STORAGE_KEY = "noidbPendingWimsTransfer";
  const EVENT_TYPE = "NOIDB_WIMS_EXTENSION_TRANSFER";
  const ACK_TYPE = "NOIDB_WIMS_EXTENSION_ACK";

  async function deliver() {
    const stored = await chrome.storage.local.get(STORAGE_KEY);
    const payload = stored[STORAGE_KEY];
    if (!payload || typeof payload.text !== "string") return;
    let attempts = 0;
    const send = () => {
      attempts += 1;
      window.postMessage({ type: EVENT_TYPE, payload }, window.location.origin);
      if (attempts >= 20) window.clearInterval(timer);
    };
    const timer = window.setInterval(send, 500);
    const receiveAck = async event => {
      if (event.source !== window || event.origin !== window.location.origin || event.data?.type !== ACK_TYPE) return;
      window.clearInterval(timer);
      window.removeEventListener("message", receiveAck);
      await chrome.storage.local.remove(STORAGE_KEY);
    };
    window.addEventListener("message", receiveAck);
    send();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", deliver, { once: true });
  else deliver();
})();
