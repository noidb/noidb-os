"use strict";
importScripts("weekly-core.js");
const weeklyCore = globalThis.NOIDBWeeklyCore;
const SESSION_PREFIX = "noidbWeeklySession:";
const TRANSFER_PREFIX = "noidbWeeklyTransfer:";
const sessionKey = id => SESSION_PREFIX + id;
const transferKey = id => TRANSFER_PREFIX + id;
const locks = new Map();

async function storedSession(id) {
  const data = await chrome.storage.local.get(sessionKey(id));
  return data[sessionKey(id)];
}
async function sessions() {
  const all = await chrome.storage.local.get(null);
  return Object.entries(all).filter(([key]) => key.startsWith(SESSION_PREFIX)).map(([, value]) => value);
}
async function postStatus(session, status, message) {
  await chrome.tabs.sendMessage(session.requesterTabId, { type: "NOIDB_WEEKLY_COLLECT_STATUS", requestId: session.requestId, status, message }).catch(() => undefined);
}
async function sendTransfer(session) {
  const data = await chrome.storage.local.get(transferKey(session.requestId));
  const payload = data[transferKey(session.requestId)];
  if (payload) await chrome.tabs.sendMessage(session.requesterTabId, { type: "NOIDB_INBOUND_EXTENSION_TRANSFER", payload }).catch(() => undefined);
}
async function fail(session, message) {
  await chrome.storage.local.set({ [sessionKey(session.requestId)]: { ...session, state: "error", errorMessage: message, pages: [] } });
  await chrome.storage.local.remove(transferKey(session.requestId));
  await postStatus(session, "error", message);
}
async function start(request, sender) {
  if (!weeklyCore.allowedSite(sender.url) || !Number.isInteger(sender.tab?.id) || sender.frameId !== 0) throw new Error("주간 업무 화면에서 시작해주세요.");
  const error = weeklyCore.validateRequest(request);
  if (error) throw new Error(error);
  const collision = await storedSession(request.requestId);
  if (collision && collision.requesterTabId !== sender.tab.id) throw new Error("다른 작업에서 사용 중인 요청 번호입니다. 다시 시작해주세요.");
  for (const old of await sessions()) {
    if (old.requesterTabId === sender.tab.id || Date.now() - old.createdAt > weeklyCore.MAX_AGE_MS) {
      await chrome.storage.local.remove([sessionKey(old.requestId), transferKey(old.requestId)]);
    }
  }
  const tab = await chrome.tabs.create({ url: "about:blank", active: true });
  const session = { requestId: request.requestId, startDate: request.startDate, endDate: request.endDate, requesterTabId: sender.tab.id, requesterUrl: sender.url, supplierTabId: tab.id, createdAt: Date.now(), state: "collecting", pages: [] };
  await chrome.storage.local.set({ [sessionKey(session.requestId)]: session });
  try { await chrome.tabs.update(tab.id, { url: weeklyCore.receiptUrl(session) }); }
  catch (error) { await fail(session, "서플라이 허브 탭을 열지 못했습니다."); throw error; }
  return { accepted: true, requestId: session.requestId };
}
async function supplierSession(sender) {
  if (!sender.url?.startsWith("https://supplier.coupang.com/") || sender.frameId !== 0) return null;
  return (await sessions()).find(session => session.supplierTabId === sender.tab?.id && session.state === "collecting" && Date.now() - session.createdAt <= weeklyCore.MAX_AGE_MS) || null;
}
async function receivePage(message, sender) {
  const session = await supplierSession(sender);
  if (!session || message.requestId !== session.requestId) return { accepted: false };
  const sourceUrl = new URL(sender.url);
  if (sourceUrl.pathname !== "/scm/receive/detail" || sourceUrl.searchParams.get("startDate") !== session.startDate || sourceUrl.searchParams.get("endDate") !== session.endDate
    || Number(sourceUrl.searchParams.get("page") || 1) !== message.page?.pageNumber) return { accepted: false };
  if (message.phase !== (session.phase || "collect")) return { accepted: false };
  try {
    if (session.phase === "verify") {
      const payload = weeklyCore.verifyFreshFirstPage(session, message.page);
      await chrome.storage.local.set({ [sessionKey(session.requestId)]: { ...session, state: "complete", pages: [] }, [transferKey(session.requestId)]: payload });
      await sendTransfer(session);
      await chrome.tabs.update(session.requesterTabId, { active: true }).catch(() => undefined);
      return { accepted: true, complete: true, totalCount: payload.totalCount };
    }
    const next = weeklyCore.appendPage(session, message.page);
    if (next.pages.length === next.pageCount) {
      await chrome.storage.local.set({ [sessionKey(next.requestId)]: { ...next, phase: "verify" } });
      await postStatus(next, "collecting", `전체 ${next.totalCount}건 수집 완료 · 새 조회로 누락과 변경 여부 확인 중`);
      return { accepted: true, complete: false, verify: true, nextUrl: weeklyCore.receiptUrl(next) };
    }
    await chrome.storage.local.set({ [sessionKey(next.requestId)]: next });
    await postStatus(next, "collecting", `입고 내역 ${next.pages.length}/${next.pageCount}페이지 확인 · ${next.pages.reduce((sum, page) => sum + page.rows.length, 0)}/${next.totalCount}건`);
    return { accepted: true, complete: false, nextUrl: weeklyCore.receiptUrl(next, next.pages.length + 1) };
  } catch (error) {
    await fail(session, error.message || "입고 내역 전체 수집 검증에 실패했습니다.");
    return { accepted: false, error: error.message };
  }
}
async function handle(message, sender) {
  if (message?.type === "NOIDB_WEEKLY_COLLECT_REQUEST") return start(message, sender);
  if (message?.type === "NOIDB_WEEKLY_SUPPLIER_READY") {
    const session = await supplierSession(sender);
    return session ? { request: { requestId: session.requestId, startDate: session.startDate, endDate: session.endDate, expectedPage: session.phase === "verify" ? 1 : session.pages.length + 1, expectedTotalCount: session.totalCount, phase: session.phase || "collect" } } : {};
  }
  if (message?.type === "NOIDB_WEEKLY_PAGE") return receivePage(message, sender);
  if (message?.type === "NOIDB_WEEKLY_SUPPLIER_STATUS") {
    const session = await supplierSession(sender);
    if (!session || message.requestId !== session.requestId) return {};
    if (message.status === "error") await fail(session, String(message.message).slice(0, 500));
    else if (message.status === "auth-required") await postStatus(session, "auth-required", "서플라이 허브에서 로그인 또는 본인 인증을 완료해주세요. 완료하면 수집을 이어갑니다.");
    else if (message.status === "resume") await chrome.tabs.update(session.supplierTabId, { url: weeklyCore.receiptUrl(session, session.phase === "verify" ? 1 : session.pages.length + 1) });
    return {};
  }
  if (["NOIDB_WEEKLY_POLL", "NOIDB_INBOUND_EXTENSION_ACK"].includes(message?.type)) {
    if (!weeklyCore.allowedSite(sender.url) || sender.frameId !== 0) return {};
    const id = message.requestId || message.transferId;
    if (typeof id !== "string") return {};
    const session = await storedSession(id);
    if (!session || session.requesterTabId !== sender.tab?.id) return {};
    if (Date.now() - session.createdAt > weeklyCore.MAX_AGE_MS) {
      await fail(session, "입고 자료 수집 대기 시간이 지났습니다. 주간 업무 화면에서 다시 시작해주세요.");
      return {};
    }
    if (message.type === "NOIDB_INBOUND_EXTENSION_ACK" && message.transferId === session.requestId && message.accepted === true) {
      await chrome.storage.local.remove([sessionKey(id), transferKey(id)]);
    } else if (message.type === "NOIDB_WEEKLY_POLL" && session.state === "complete") await sendTransfer(session);
    else if (message.type === "NOIDB_WEEKLY_POLL" && session.state === "error") await postStatus(session, "error", session.errorMessage || "입고 자료 수집을 중단했습니다. 다시 시작해주세요.");
    return {};
  }
  return {};
}
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (typeof message?.type !== "string" || (!message.type.startsWith("NOIDB_WEEKLY_") && message.type !== "NOIDB_INBOUND_EXTENSION_ACK")) return false;
  // Serialize messages from one tab so repeated page events cannot append twice.
  const key = sender.tab?.id ?? "unknown";
  const work = (locks.get(key) || Promise.resolve()).catch(() => undefined).then(() => handle(message, sender));
  locks.set(key, work);
  work.then(sendResponse, error => sendResponse({ accepted: false, error: error.message || "브라우저 연결에 실패했습니다." })).finally(() => { if (locks.get(key) === work) locks.delete(key); });
  return true;
});
chrome.tabs.onRemoved.addListener(async tabId => {
  for (const session of await sessions()) {
    if (session.requesterTabId === tabId) await chrome.storage.local.remove([sessionKey(session.requestId), transferKey(session.requestId)]);
    else if (session.supplierTabId === tabId && session.state === "collecting") await fail(session, "서플라이 허브 탭이 닫혀 수집을 중단했습니다. 다시 시작해주세요.");
  }
});
