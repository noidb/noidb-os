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
  // 0.9.11: 크롬 다운로드로 받은 PDF를 확장이 다시 읽을 때(쿠팡 화면 안에서 읽어야 로그인·blob 주소가 그대로 통함)
  // 0.9.13: PDF 파일명의 쉽먼트번호로 화면 목록에서 그 줄의 입고예정일(시각 없는 날짜 칸)을 찾는다 → G드라이브 입고예정일 폴더에 저장.
  function expectedDateFor(name) {
    const shipment = String(name || "").match(/\((\d{5,})\)/)?.[1];
    if (!shipment) return "";
    for (const row of document.querySelectorAll("tr")) {
      const cells = [...row.children].map(cell => (cell.textContent || "").replace(/\s+/g, " ").trim());
      if (!cells.includes(shipment)) continue;
      const date = cells.find(text => /^\d{4}-\d{2}-\d{2}$/.test(text));
      if (date) return date;
    }
    return "";
  }
  try {
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (message?.type === "NOIDB_EXPECTED_DATE") { sendResponse({ expectedDate: expectedDateFor(message.name) }); return; }
      if (message?.type !== "NOIDB_FETCH_FOR_PDF" || typeof message.url !== "string") return;
      fetch(message.url, { credentials: "include", cache: "no-store" }).then(response => {
        if (!response.ok) throw new Error(String(response.status));
        return response.arrayBuffer();
      }).then(buffer => {
        const bytes = new Uint8Array(buffer); let binary = "";
        for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode.apply(null, bytes.subarray(index, index + 0x8000));
        sendResponse({ ok: true, base64: btoa(binary) });
      }).catch(() => sendResponse({ ok: false }));
      return true;
    });
  } catch {}

  window.addEventListener("message", event => {
    if (event.source !== window || event.data?.source !== "NOIDB_SHIPMENT_PDF") return;
    const { name, kind, url, base64 } = event.data;
    const notify = detail => document.dispatchEvent(new CustomEvent("noidb-shipment-pdf", { detail }));
    notify({ phase: "sending", name, kind, url });
    try {
      chrome.runtime.sendMessage({ type: "NOIDB_SAVE_SHIPMENT_PDF", name, kind, url, base64, expectedDate: expectedDateFor(name) }, response => {
        const error = chrome.runtime.lastError?.message;
        notify(response?.ok ? { phase: "saved", name: response.fileName || name, kind, url, skipped: response.skipped, folder: response.folder || "" } : { phase: "failed", name, kind, url, error: error || response?.error || "저장하지 못했습니다." });
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
