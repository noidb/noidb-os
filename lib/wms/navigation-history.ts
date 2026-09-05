const ENTRY_KEY = "__noidbWmsEntry";
const STORAGE_KEY = "noidb_wms_navigation_entries_v2";
const LINK_KEY = "noidb_wms_navigation_link_v2";

interface NavigationEntry {
  id: string;
  url: string;
  scrollY: number;
  previousId?: string;
}

function readEntries(): NavigationEntry[] {
  try {
    const entries: unknown = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || "[]");
    return Array.isArray(entries) ? entries.filter(entry => typeof entry?.id === "string" && typeof entry?.url === "string" && Number.isFinite(entry?.scrollY)) : [];
  } catch { return []; }
}

function saveEntry(entry: NavigationEntry) {
  try {
    const entries = readEntries().filter(item => item.id !== entry.id);
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify([...entries, entry].slice(-80)));
  } catch { /* Private browsing can disable session storage. Browser history still works. */ }
}

function currentUrl() {
  return `${location.pathname}${location.search}${location.hash}`;
}

function stateId(): string | undefined {
  return window.history.state?.[ENTRY_KEY];
}

/** Follow the browser's actual entry, including repeated visits to the same URL. */
export function goBackInWms(fallback: () => void) {
  const entry = readEntries().find(item => item.id === stateId());
  if (entry?.previousId && window.history.length > 1) window.history.back();
  else fallback();
}

/** Observe route changes without adding a second URL stack beside browser history. */
export function installWmsNavigationHistory() {
  const browserHistory = window.history;
  const originalPush = browserHistory.pushState;
  const originalReplace = browserHistory.replaceState;
  const originalRestoration = browserHistory.scrollRestoration;
  let disposed = false;
  let active: NavigationEntry;
  let cancelRestore: (persistPosition?: boolean) => void = () => {};
  let restoring = false;

  const makeEntry = (previousId?: string): NavigationEntry => ({
    id: crypto.randomUUID(), url: currentUrl(), scrollY: 0, previousId,
  });
  const writeState = (entry: NavigationEntry) => {
    originalReplace.call(browserHistory, { ...browserHistory.state, [ENTRY_KEY]: entry.id }, "");
  };
  const savePosition = () => {
    if (!active || restoring) return;
    active = { ...active, scrollY: Math.max(0, window.scrollY) };
    saveEntry(active);
  };

  function restorePosition(entry: NavigationEntry) {
    cancelRestore();
    restoring = true;
    let frame = 0;
    let observer: ResizeObserver | undefined;
    const stop = (persistPosition = true) => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
      clearTimeout(timeout);
      window.removeEventListener("wheel", onInteraction);
      window.removeEventListener("touchstart", onInteraction);
      window.removeEventListener("pointerdown", onInteraction);
      window.removeEventListener("keydown", onInteraction);
      restoring = false;
      cancelRestore = () => {};
      if (persistPosition) savePosition();
    };
    const onInteraction = () => stop();
    const attempt = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (active.id !== entry.id) return;
        // A loading placeholder may be too short. ResizeObserver retries as data arrives.
        const available = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
        window.scrollTo({ top: Math.min(entry.scrollY, available), behavior: "auto" });
      });
    };
    const timeout = window.setTimeout(stop, 6000);
    if (typeof ResizeObserver !== "undefined") {
      observer = new ResizeObserver(attempt);
      observer.observe(document.documentElement);
      observer.observe(document.body);
    }
    window.addEventListener("wheel", onInteraction, { passive: true });
    window.addEventListener("touchstart", onInteraction, { passive: true });
    window.addEventListener("pointerdown", onInteraction, { passive: true });
    window.addEventListener("keydown", onInteraction);
    cancelRestore = stop;
    attempt();
  }

  const stored = readEntries().find(entry => entry.id === stateId() && entry.url === currentUrl());
  let previousId: string | undefined;
  try {
    const pending = JSON.parse(sessionStorage.getItem(LINK_KEY) || "null");
    sessionStorage.removeItem(LINK_KEY);
    if (pending?.url === currentUrl() && Date.now() - pending.at < 30_000) previousId = pending.fromId;
  } catch { /* A directly opened tab has no recorded previous entry. */ }
  active = stored || makeEntry(previousId);
  writeState(active);
  saveEntry(active);
  browserHistory.scrollRestoration = "manual";

  const pushState: History["pushState"] = function (data, unused, url) {
    if (disposed) return originalPush.call(browserHistory, data, unused, url);
    savePosition();
    cancelRestore();
    const previous = active.id;
    const nextId = crypto.randomUUID();
    originalPush.call(browserHistory, { ...data, [ENTRY_KEY]: nextId }, unused, url);
    active = { id: nextId, url: currentUrl(), scrollY: 0, previousId: previous };
    saveEntry(active);
  };
  const replaceState: History["replaceState"] = function (data, unused, url) {
    if (disposed) return originalReplace.call(browserHistory, data, unused, url);
    originalReplace.call(browserHistory, { ...data, [ENTRY_KEY]: active.id }, unused, url);
    active = { ...active, url: currentUrl() };
    saveEntry(active);
  };
  browserHistory.pushState = pushState;
  browserHistory.replaceState = replaceState;

  const onPopState = () => {
    cancelRestore();
    active = readEntries().find(entry => entry.id === stateId() && entry.url === currentUrl()) || makeEntry();
    writeState(active);
    saveEntry(active);
    restorePosition(active);
  };
  const onHashChange = () => {
    if (active.url === currentUrl()) return;
    cancelRestore();
    active = makeEntry(active.id);
    writeState(active);
    savePosition();
  };
  // Native <a> links reload the page. Carry only the exact same-tab destination.
  const onLinkClick = (event: MouseEvent) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a[href]") : null;
    if (!link || link.hasAttribute("download") || (link.target && link.target !== "_self")) return;
    const destination = new URL(link.href, location.href);
    if (destination.origin !== location.origin || !destination.pathname.startsWith("/wms")) return;
    savePosition();
    try {
      sessionStorage.setItem(LINK_KEY, JSON.stringify({ url: `${destination.pathname}${destination.search}${destination.hash}`, fromId: active.id, at: Date.now() }));
    } catch { /* The regular browser navigation remains available. */ }
  };
  const onPageShow = (event: PageTransitionEvent) => {
    if (event.persisted) restorePosition(active);
  };
  window.addEventListener("scroll", savePosition, { passive: true });
  window.addEventListener("pagehide", savePosition);
  window.addEventListener("pageshow", onPageShow);
  window.addEventListener("popstate", onPopState);
  window.addEventListener("hashchange", onHashChange);
  document.addEventListener("click", onLinkClick);
  // complete 해시 딥링크의 첫 진입/StrictMode 재설치에서 방금 만든 scrollY=0 항목을 6초 동안
  // 복원하면, 대상 화면의 scrollIntoView를 ResizeObserver가 다시 맨 위로 덮는다. 이 최초 0 복원만
  // complete 화면에 맡긴다. 실제 뒤로가기 위치와 popstate/pageshow 복원 경로는 그대로 유지한다.
  const completeHashOwnsInitialPosition = Boolean(
    stored?.scrollY === 0
    && location.hash
    && /^\/wms\/picking\/waves\/[^/]+\/complete\/?$/.test(location.pathname)
  );
  if (stored && !completeHashOwnsInitialPosition) restorePosition(stored);

  return () => {
    const pendingRestore = restoring;
    cancelRestore(false);
    // Effect remounts can occur before the loading page reaches its saved height.
    // Keep that target for the next mount instead of replacing it with zero.
    if (!pendingRestore) savePosition();
    disposed = true;
    window.removeEventListener("scroll", savePosition);
    window.removeEventListener("pagehide", savePosition);
    window.removeEventListener("pageshow", onPageShow);
    window.removeEventListener("popstate", onPopState);
    window.removeEventListener("hashchange", onHashChange);
    document.removeEventListener("click", onLinkClick);
    if (browserHistory.pushState === pushState) browserHistory.pushState = originalPush;
    if (browserHistory.replaceState === replaceState) browserHistory.replaceState = originalReplace;
    browserHistory.scrollRestoration = originalRestoration;
  };
}
