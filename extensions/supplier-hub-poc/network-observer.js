(() => {
  const DIAGNOSTIC_KEY = "noidbPocPurchaseOrderLinesDiagnostics";
  const MAX_OBSERVATIONS = 50;

  function safeStorageGet(key, callback) {
    try { chrome.storage.local.get(key, result => callback(result?.[key] || {})); } catch { callback({}); }
  }

  function safeStorageSet(value) {
    try { chrome.storage.local.set(value); } catch {}
  }

  function saveObservation(observation) {
    if (!observation || !observation.url) return;
    safeStorageGet(DIAGNOSTIC_KEY, diagnostic => {
      const observations = Array.isArray(diagnostic.observedRequests) ? diagnostic.observedRequests : [];
      const signature = JSON.stringify([observation.phase, observation.method, observation.url, observation.status || ""]);
      const next = observations.filter(item => JSON.stringify([item.phase, item.method, item.url, item.status || ""]) !== signature);
      next.push(observation);
      safeStorageSet({
        [DIAGNOSTIC_KEY]: {
          ...diagnostic,
          observedRequests: next.slice(-MAX_OBSERVATIONS),
          observedRequestMethods: [...new Set(next.map(item => item.method).filter(Boolean))],
          updatedAt: new Date().toISOString(),
        },
      });
    });
  }

  window.addEventListener("message", event => {
    if (event.source !== window || event.data?.source !== "NOIDB_POC_PAGE_NETWORK") return;
    saveObservation(event.data.observation);
  });

  // 0.9.10: 쉽먼트 Label·내역서 PDF → NOID-B 저장. 결과는 쉽먼트 칸에 보이도록 화면 이벤트로 알린다.
  window.addEventListener("message", event => {
    if (event.source !== window || event.data?.source !== "NOIDB_SHIPMENT_PDF") return;
    const { name, kind, url, base64 } = event.data;
    const notify = detail => document.dispatchEvent(new CustomEvent("noidb-shipment-pdf", { detail }));
    notify({ phase: "sending", name, kind, url });
    try {
      chrome.runtime.sendMessage({ type: "NOIDB_SAVE_SHIPMENT_PDF", name, kind, url, base64 }, response => {
        const error = chrome.runtime.lastError?.message;
        notify(response?.ok ? { phase: "saved", name: response.fileName || name, kind, url, skipped: response.skipped } : { phase: "failed", name, kind, url, error: error || response?.error || "저장하지 못했습니다." });
      });
    } catch (error) { notify({ phase: "failed", name, kind, url, error: String(error?.message || error) }); }
  });

  try {
    const script = document.createElement("script");
    script.src = chrome.runtime.getURL("page-network-observer.js");
    script.dataset.noidbPoc = "page-network-observer";
    script.onload = () => script.remove();
    (document.head || document.documentElement).appendChild(script);
  } catch {}
})();
