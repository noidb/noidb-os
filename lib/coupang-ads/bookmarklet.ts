const collector = async () => {
  const notify = (message: string) => window.alert(`[NOID-B 광고수집]\n${message}`);
  try {
    const performanceUrls = performance.getEntriesByType("resource")
      .map(entry => (entry as PerformanceResourceTiming).name)
      .filter(url => url.includes("/marketing/tetris-api/") && url.includes("/ads-with-metrics"));
    const templateUrl = performanceUrls.at(-1);
    const current = new URL(location.href);
    const fromQuery = current.searchParams.get("groupId") || current.searchParams.get("adGroupId");
    const fromTemplate = templateUrl?.match(/\/tetris-api\/(\d+)\/ads-with-metrics/)?.[1];
    const fromPage = [...document.querySelectorAll<HTMLAnchorElement>("a[href]")]
      .map(anchor => anchor.href.match(/[?&](?:groupId|adGroupId)=(\d+)/)?.[1])
      .find(Boolean);
    const groupId = fromTemplate || fromQuery || fromPage;
    if (!groupId) throw new Error("광고그룹 ID를 찾지 못했습니다. 광고 상품 성과 목록을 연 뒤 다시 실행해주세요.");

    const endpoint = templateUrl ? new URL(templateUrl) : new URL(`/marketing/tetris-api/${groupId}/ads-with-metrics`, location.origin);
    const readDate = (names: string[]) => names.map(name => endpoint.searchParams.get(name) || current.searchParams.get(name)).find(Boolean) || "";
    const inputDates = [...document.querySelectorAll<HTMLInputElement>('input[type="date"], input[placeholder*="YYYY"], input[placeholder*="날짜"]')]
      .map(input => input.value.replace(/\D/g, "")).filter(value => value.length === 8);
    const startDate = (readDate(["startDate", "fromDate", "dateFrom"]) || inputDates[0] || "").replace(/\D/g, "");
    const endDate = (readDate(["endDate", "toDate", "dateTo"]) || inputDates.at(-1) || "").replace(/\D/g, "");
    if (startDate) endpoint.searchParams.set("startDate", startDate);
    if (endDate) endpoint.searchParams.set("endDate", endDate);
    const sizeKey = endpoint.searchParams.has("pageSize") ? "pageSize" : "size";
    endpoint.searchParams.set(sizeKey, "100");
    endpoint.searchParams.set("page", "1");

    const pages: unknown[] = [];
    let page = 1;
    let totalCount = 0;
    let collected = 0;
    while (page === 1 || collected < totalCount) {
      endpoint.searchParams.set("page", String(page));
      const response = await fetch(endpoint.toString(), { credentials: "include", headers: { Accept: "application/json" } });
      if (!response.ok) throw new Error(`쿠팡 요청 실패(HTTP ${response.status}) — 로그인 상태와 조회 화면을 확인해주세요.`);
      const data = await response.json();
      const ads = Array.isArray(data?.ads) ? data.ads : Array.isArray(data?.data?.ads) ? data.data.ads : [];
      const pageInfo = data?.pageInfo || data?.data?.pageInfo || {};
      totalCount = Number(pageInfo.totalCount ?? data?.totalCount ?? totalCount ?? 0);
      pages.push({ page, data: data?.data?.ads ? data.data : data });
      collected += ads.length;
      if (ads.length === 0 || page >= 1000) break;
      page += 1;
    }
    if (totalCount && collected < totalCount) throw new Error(`전체 ${totalCount}개 중 ${collected}개만 수집됐습니다. 다운로드하지 않았습니다.`);
    const payload = {
      source: "Coupang Ads ads-with-metrics",
      groupId: String(groupId),
      startDate: startDate || null,
      endDate: endDate || null,
      downloadedAt: new Date().toISOString(),
      pages,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const anchor = document.createElement("a");
    anchor.href = URL.createObjectURL(blob);
    anchor.download = `coupang_ads_${startDate || "start"}_${endDate || "end"}.json`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(anchor.href), 2000);
    notify(`${collected}개 상품 수집 완료`);
  } catch (error) {
    notify(error instanceof Error ? error.message : "수집 중 알 수 없는 오류가 발생했습니다.");
  }
};

export const COUPANG_ADS_BOOKMARKLET = `javascript:(${collector.toString()})()`;
