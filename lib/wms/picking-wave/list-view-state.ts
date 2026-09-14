export interface PickingListViewState {
  scrollY: number;
  anchorProductCode: string;
  anchorOffset?: number;
  checkedProductCodes: string[];
}

export function parsePickingListViewState(raw: string | null, availableCodes: readonly string[]): PickingListViewState | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<PickingListViewState> | null;
    if (!value || typeof value !== "object") return null;
    const available = new Set(availableCodes);
    return {
      scrollY: typeof value.scrollY === "number" && Number.isFinite(value.scrollY) ? Math.max(0, value.scrollY) : 0,
      anchorProductCode: typeof value.anchorProductCode === "string" && available.has(value.anchorProductCode) ? value.anchorProductCode : "",
      anchorOffset: typeof value.anchorOffset === "number" && Number.isFinite(value.anchorOffset) ? value.anchorOffset : undefined,
      checkedProductCodes: Array.isArray(value.checkedProductCodes)
        ? Array.from(new Set(value.checkedProductCodes.filter(code => typeof code === "string" && available.has(code))))
        : [],
    };
  } catch { return null; }
}
