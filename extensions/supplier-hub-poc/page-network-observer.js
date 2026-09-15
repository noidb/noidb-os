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
