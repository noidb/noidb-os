(() => {
  if (window.__NOIDB_POC_NETWORK_OBSERVER__) return;
  window.__NOIDB_POC_NETWORK_OBSERVER__ = true;

  const poNumber = location.pathname.match(/\/get\/([^/]+)/i)?.[1] || "";
  const sensitiveKey = /token|auth|cookie|secret|password|csrf|session|credential/i;
  const relevantText = (value) => /purchase|order|po|sku|product|item|deal|발주|상품|품목|140948636|140872610/i.test(String(value || ""));

  function sanitizeUrl(value) {
    try {
      const url = new URL(value, location.href);
      const query = {};
      for (const [key, rawValue] of url.searchParams.entries()) {
        if (!sensitiveKey.test(key)) query[key] = String(rawValue).slice(0, 120);
      }
      return { url: `${url.origin}${url.pathname}`, query, sameOrigin: url.origin === location.origin };
    } catch { return { url: String(value || "").slice(0, 300), query: {}, sameOrigin: false }; }
  }

  function sanitizeBody(body) {
    if (body == null || typeof body === "string" && !body.trim()) return null;
    if (typeof body === "string") {
      try { return sanitizeBody(JSON.parse(body)); } catch { return relevantText(body) ? body.slice(0, 300) : "[non-json body omitted]"; }
    }
    if (typeof body !== "object") return String(body).slice(0, 120);
    const result = {};
    for (const [key, value] of Object.entries(body)) {
      if (!sensitiveKey.test(key)) result[key] = typeof value === "object" ? "[object]" : String(value).slice(0, 120);
    }
    return result;
  }

  function objectKeys(value) {
    if (!value || typeof value !== "object") return [];
    return Object.keys(value).slice(0, 80);
  }

  function responseShape(raw, contentType) {
    if (!raw || !/json/i.test(contentType || "")) return { topLevelKeys: [], arrayItemKeys: [], json: false };
    try {
      const parsed = JSON.parse(raw);
      return {
        json: true,
        topLevelKeys: objectKeys(parsed),
        arrayItemKeys: Array.isArray(parsed) ? parsed.slice(0, 3).flatMap(objectKeys).filter((key, index, all) => all.indexOf(key) === index) : [],
        containsPo: relevantText(raw) || (poNumber && raw.includes(poNumber)),
      };
    } catch { return { topLevelKeys: [], arrayItemKeys: [], json: false, parseError: true }; }
  }

  function post(observation) {
    window.postMessage({ source: "NOIDB_POC_PAGE_NETWORK", observation }, "*");
  }

  // 0.9.10(2026-10-21): 쉽먼트 Label·내역서 PDF를 받을 때 그 파일을 그대로 잡아 NOID-B(G드라이브 출력세트 폴더)로 보낸다.
  // 쿠팡에는 아무것도 보내거나 바꾸지 않는다. 쿠팡의 원래 다운로드도 그대로 진행된다.
  const pdfSeen = new Set();
  function pdfKind(text) {
    if (/manifest/i.test(text)) return "ManiFest";
    if (/label/i.test(text)) return "Label";
    return "";
  }
  function nameFromDisposition(value) {
    const raw = String(value || "");
    const encoded = raw.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
    if (encoded) { try { return decodeURIComponent(encoded); } catch {} }
    return raw.match(/filename="?([^";]+)"?/i)?.[1] || "";
  }
  function forwardPdf(buffer, name, url) {
    try {
      if (!location.pathname.startsWith("/ibs/")) return;
      const bytes = new Uint8Array(buffer);
      if (bytes.length < 5 || bytes[0] !== 0x25 || bytes[1] !== 0x50 || bytes[2] !== 0x44 || bytes[3] !== 0x46) return; // %PDF
      const kind = pdfKind(`${name} ${url}`);
      if (!kind) return;
      const key = `${bytes.length}:${Array.from(bytes.slice(-48)).join(",")}`;
      if (pdfSeen.has(key)) return;
      pdfSeen.add(key);
      let binary = "";
      for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode.apply(null, bytes.subarray(index, index + 0x8000));
      window.postMessage({ source: "NOIDB_SHIPMENT_PDF", name: String(name || ""), kind, url: sanitizeUrl(url).url, base64: btoa(binary) }, "*");
    } catch {}
  }
  function capturePdfUrl(href, name) {
    try {
      const url = new URL(href, location.href);
      if (url.protocol !== "blob:" && url.origin !== location.origin) return;
      if (!pdfKind(`${name} ${url.href}`) && url.protocol !== "blob:") return;
      originalFetchForPdf(url.href, { credentials: "include" }).then(response => {
        const disposition = response.headers.get("content-disposition") || "";
        return response.arrayBuffer().then(buffer => forwardPdf(buffer, name || nameFromDisposition(disposition) || url.pathname.split("/").pop(), url.href));
      }).catch(() => {});
    } catch {}
  }
  const originalFetchForPdf = window.fetch ? window.fetch.bind(window) : null;
  // 링크를 눌러 받는 경우(다운로드 링크·blob 주소)
  document.addEventListener("click", event => {
    const anchor = event.target && event.target.closest ? event.target.closest("a[href]") : null;
    if (anchor && originalFetchForPdf) capturePdfUrl(anchor.href, anchor.getAttribute("download") || anchor.textContent || "");
  }, true);
  const originalAnchorClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function observedAnchorClick() {
    if (this.href && originalFetchForPdf) capturePdfUrl(this.href, this.getAttribute("download") || "");
    return originalAnchorClick.apply(this, arguments);
  };
  const originalWindowOpen = window.open;
  window.open = function observedOpen(url) {
    if (url && originalFetchForPdf) capturePdfUrl(url, "");
    return originalWindowOpen.apply(this, arguments);
  };

  function requestMeta(method, url, body) {
    const safeUrl = sanitizeUrl(url);
    return {
      phase: "request",
      method: String(method || "GET").toUpperCase(),
      ...safeUrl,
      body: sanitizeBody(body),
      relatedToPo: relevantText(`${safeUrl.url} ${JSON.stringify(safeUrl.query)} ${JSON.stringify(body)}`) || Boolean(poNumber && String(url).includes(poNumber)),
      observedAt: new Date().toISOString(),
    };
  }

  const originalFetch = window.fetch;
  if (typeof originalFetch === "function") {
    window.fetch = function observedFetch(input, init) {
      const request = input instanceof Request ? input : null;
      const method = init?.method || request?.method || "GET";
      const url = init?.url || request?.url || input;
      const body = init?.body;
      post(requestMeta(method, url, body));
      return originalFetch.apply(this, arguments).then(response => {
        const contentType = response.headers.get("content-type") || "";
        const disposition = response.headers.get("content-disposition") || "";
        if (/pdf|octet-stream/i.test(contentType) || /shipment_/i.test(disposition)) {
          response.clone().arrayBuffer().then(buffer => forwardPdf(buffer, nameFromDisposition(disposition), String(url))).catch(() => {});
        }
        response.clone().text().then(raw => post({
          ...requestMeta(method, url, body),
          phase: "response",
          status: response.status,
          contentType,
          ...responseShape(raw, contentType),
        })).catch(() => {});
        return response;
      });
    };
  }

  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function observedOpen(method, url) {
    this.__NOIDB_POC_REQUEST__ = { method, url };
    return originalOpen.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function observedSend(body) {
    const request = this.__NOIDB_POC_REQUEST__ || { method: "GET", url: location.href };
    post(requestMeta(request.method, request.url, body));
    this.addEventListener("load", () => {
      try {
        const type = this.getResponseHeader("content-type") || "", disposition = this.getResponseHeader("content-disposition") || "";
        if (/pdf|octet-stream/i.test(type) || /shipment_/i.test(disposition)) {
          const name = nameFromDisposition(disposition);
          if (this.response instanceof ArrayBuffer) forwardPdf(this.response, name, String(request.url));
          else if (this.response instanceof Blob) this.response.arrayBuffer().then(buffer => forwardPdf(buffer, name, String(request.url))).catch(() => {});
        }
      } catch {}
      let raw = "";
      try { raw = this.responseType === "" || this.responseType === "text" ? this.responseText : JSON.stringify(this.response); } catch {}
      const contentType = this.getResponseHeader("content-type") || "";
      post({
        ...requestMeta(request.method, request.url, body),
        phase: "response",
        status: this.status,
        contentType,
        ...responseShape(raw, contentType),
      });
    }, { once: true });
    return originalSend.apply(this, arguments);
  };
})();
