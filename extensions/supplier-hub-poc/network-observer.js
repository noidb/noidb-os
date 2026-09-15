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

  try {
    const script = document.createElement("script");
    script.src = chrome.runtime.getURL("page-network-observer.js");
    script.dataset.noidbPoc = "page-network-observer";
    script.onload = () => script.remove();
    (document.head || document.documentElement).appendChild(script);
  } catch {}
})();
