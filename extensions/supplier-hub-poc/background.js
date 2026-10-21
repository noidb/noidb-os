chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== "NOIDB_SAVE_SHIPMENT_RECEIPTS") return;
  let source;
  try { source = new URL(sender.tab?.url || ""); } catch { return; }
  if (source.origin !== "https://supplier.coupang.com" || source.pathname !== "/ibs/asn/active") return;
  (async () => {
    try {
      const endpoint = "https://noidb-os.vercel.app/api/wms/vendor-orders/shipment-receipts";
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 45000);
      try {
        const ready = await fetch(endpoint, { cache: "no-store", signal: controller.signal });
        const info = await ready.json().catch(() => ({}));
        if (!ready.ok || !info.ok || info.status !== "ready" || info.source !== "supplier-hub-shipments" || info.schemaVersion !== 1) throw new Error("NOID-B의 쉽먼트 수집 기능이 아직 준비되지 않았습니다. 자료 파일을 저장해 주세요.");
        const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(message.payload), signal: controller.signal });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || !result.ok) throw new Error(result.error || "쉽먼트 입고결과를 저장하지 못했습니다.");
        sendResponse({ ok: true, count: result.orders.length });
      } finally { clearTimeout(timer); }
    } catch (error) { sendResponse({ ok: false, error: error.name === "AbortError" ? "저장 응답이 지연됐습니다. 저장 결과를 확인한 뒤 다시 전송해 주세요." : error.message }); }
  })();
  return true;
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!["NOIDB_GET_LOGISTICS_RECEIPT_TARGETS", "NOIDB_SAVE_LOGISTICS_RECEIPTS"].includes(message?.type)) return;
  let source;
  try { source = new URL(sender.tab?.url || ""); } catch { return; }
  if (source.origin !== "https://supplier.coupang.com" || source.pathname !== "/ibs/asn/active") return;
  (async () => {
    const endpoint = "https://noidb-os.vercel.app/api/wms/logistics/receipts";
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 45000);
    try {
      const ready = await fetch(endpoint, { cache: "no-store", signal: controller.signal });
      const info = await ready.json().catch(() => ({}));
      if (!ready.ok || !info.ok || info.status !== "ready" || info.source !== "supplier-hub-shipments" || info.schemaVersion !== 3 || !Array.isArray(info.targets)) {
        throw new Error("NOID-B의 물류 입고결과 기능이 아직 준비되지 않았습니다. 자료 파일을 저장해 주세요.");
      }
      if (message.type === "NOIDB_GET_LOGISTICS_RECEIPT_TARGETS") { sendResponse({ ok: true, targets: info.targets, collectionMode: info.collectionMode, since: info.since, knownShipmentNumbers: Array.isArray(info.knownShipmentNumbers) ? info.knownShipmentNumbers : [] }); return; }
      const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(message.payload), signal: controller.signal });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.ok) throw new Error(result.error || "물류 입고결과를 저장하지 못했습니다.");
      sendResponse({ ok: true, count: result.count ?? message.payload?.shipments?.length ?? 0 });
    } catch (error) {
      sendResponse({ ok: false, error: error.name === "AbortError" ? "저장 응답이 지연됐습니다. 저장 결과를 확인한 뒤 다시 전송해 주세요." : error.message });
    } finally { clearTimeout(timer); }
  })();
  return true;
});

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

// 0.9.10(2026-10-21): 쿠팡에서 받은 쉽먼트 Label·내역서 PDF를 NOID-B에 보내 G드라이브 출력세트 폴더에 저장한다.
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== "NOIDB_SAVE_SHIPMENT_PDF") return;
  let source;
  try { source = new URL(sender.tab?.url || ""); } catch { return; }
  if (source.origin !== "https://supplier.coupang.com") return;
  (async () => {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 60000);
    try {
      const response = await fetch("https://noidb-os.vercel.app/api/wms/shipment-print/pdf-upload", {
        method: "POST", headers: { "Content-Type": "application/json" }, signal: controller.signal,
        body: JSON.stringify({ name: message.name, kind: message.kind, sourceUrl: message.url, base64: message.base64 }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.ok) throw new Error(result.error || "PDF를 저장하지 못했습니다.");
      sendResponse({ ok: true, fileName: result.fileName, skipped: Boolean(result.skipped) });
    } catch (error) {
      sendResponse({ ok: false, error: error.name === "AbortError" ? "PDF 저장 응답이 지연됐습니다." : error.message });
    } finally { clearTimeout(timer); }
  })();
  return true;
});

// 0.9.11(2026-10-21): 쿠팡의 [Label]·[내역서] 버튼은 PDF를 크롬 다운로드로 바로 내려받아 화면 안에서는 잡히지 않았다.
// 크롬 다운로드를 지켜보다가 쿠팡에서 받은 쉽먼트 Label·내역서 PDF면 같은 파일을 한 번 더 읽어 NOID-B에 저장한다.
const noidbPdfHandled = new Set();
function noidbPdfKind(text) { return /manifest/i.test(text) ? "ManiFest" : /label/i.test(text) ? "Label" : ""; }
async function noidbNotifyPdf(detail) {
  try {
    const tabs = await chrome.tabs.query({ url: "https://supplier.coupang.com/*" });
    for (const tab of tabs) chrome.tabs.sendMessage(tab.id, { type: "NOIDB_PDF_STATUS", detail }).catch?.(() => {});
  } catch {}
}
function noidbToBase64(buffer) {
  const bytes = new Uint8Array(buffer); let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode.apply(null, bytes.subarray(index, index + 0x8000));
  return btoa(binary);
}
async function noidbReadDownload(url) {
  // 쿠팡 화면(같은 사이트)에서 읽으면 로그인 상태·blob 주소 그대로 읽힌다. 안 되면 확장이 직접 읽는다.
  try {
    const tabs = await chrome.tabs.query({ url: "https://supplier.coupang.com/*" });
    for (const tab of tabs) {
      const result = await chrome.tabs.sendMessage(tab.id, { type: "NOIDB_FETCH_FOR_PDF", url }).catch(() => null);
      if (result?.ok && result.base64) return result.base64;
    }
  } catch {}
  if (/^https:\/\/supplier\.coupang\.com\//.test(url)) {
    const response = await fetch(url, { credentials: "include", cache: "no-store" });
    if (response.ok) return noidbToBase64(await response.arrayBuffer());
  }
  if (/^data:application\/pdf;base64,/.test(url)) return url.split(",")[1];
  throw new Error("받은 PDF를 다시 읽지 못했습니다.");
}
async function noidbHandleDownload(item, options = {}) {
  let lastBase64 = "";
  if (!item || noidbPdfHandled.has(item.id)) return;
  const url = item.finalUrl || item.url || "";
  const name = String(item.filename || "").split(/[\\/]/).pop();
  const fromCoupang = /^(blob:)?https:\/\/supplier\.coupang\.com\//.test(url) || /^(blob:)?https:\/\/supplier\.coupang\.com\//.test(item.url || "") || String(item.referrer || "").startsWith("https://supplier.coupang.com/");
  if (!fromCoupang || !name) return;
  const kind = noidbPdfKind(`${name} ${url}`);
  if (!kind || !(/\.pdf$/i.test(name) || /pdf/i.test(item.mime || ""))) return;
  noidbPdfHandled.add(item.id);
  const shownUrl = url.startsWith("blob:") ? `${url.split("/").slice(0, 3).join("/")}/… (blob)` : url.split("?")[0];
  noidbNotifyPdf({ phase: "sending", name, kind, url: shownUrl });
  try {
    const base64 = await noidbReadDownload(url);
    lastBase64 = base64;
    const response = await fetch("https://noidb-os.vercel.app/api/wms/shipment-print/pdf-upload", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, kind, sourceUrl: shownUrl, base64 }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.ok) throw new Error(result.error || "PDF를 저장하지 못했습니다.");
    noidbNotifyPdf({ phase: "saved", name: result.fileName || name, kind, url: shownUrl, skipped: Boolean(result.skipped) });
  } catch (error) {
    noidbNotifyPdf({ phase: "failed", name, kind, url: shownUrl, error: error.message + (options.fallbackDownload ? " 이 PDF는 컴퓨터로 받았습니다." : "") });
    if (options.fallbackDownload) chrome.downloads.download({ url: lastBase64 ? `data:application/pdf;base64,${lastBase64}` : (item.finalUrl || item.url), filename: name });
  }
}
// 0.9.11b(2026-10-21): 사용자 크롬은 '다운로드 전 저장 위치 묻기'가 켜져 있어 PDF마다 저장 창이 떴다.
// 쿠팡 쉽먼트 Label·내역서 PDF는 컴퓨터로 받지 않고(저장 창이 뜨기 전에 취소) 같은 파일을 읽어 G드라이브에 바로 저장한다.
// G드라이브 저장에 실패하면 그 PDF만 예전처럼 컴퓨터로 받게 한다(파일을 잃지 않도록).
function noidbIsShipmentPdf(item) {
  const name = String(item.filename || "").split(/[\\/]/).pop();
  const url = item.finalUrl || item.url || "";
  const fromCoupang = /^(blob:)?https:\/\/supplier\.coupang\.com\//.test(url) || String(item.referrer || "").startsWith("https://supplier.coupang.com/");
  return fromCoupang && /^shipment_(Label|ManiFest)_document.*\.pdf$/i.test(name);
}
chrome.downloads.onDeterminingFilename.addListener((item, suggest) => {
  if (item.byExtensionId === chrome.runtime.id || !noidbIsShipmentPdf(item)) { suggest(); return; }
  chrome.downloads.cancel(item.id, () => { chrome.downloads.erase({ id: item.id }); });
  void noidbHandleDownload(item, { fallbackDownload: true });
});
chrome.downloads.onChanged.addListener(delta => {
  if (!delta?.id || !(delta.filename?.current || delta.state?.current === "complete")) return;
  chrome.downloads.search({ id: delta.id }, items => { void noidbHandleDownload(items && items[0]); });
});
