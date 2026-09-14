import type { ProductCatalogItem } from "../product-catalog";
import { normalizeSkuId } from "../sku-normalize";
import { resolveDisplayNameAndOption } from "../display-name";
import { UNASSIGNED_VENDOR_NAME, type VendorOrderDraft, type VendorOrderDraftLine } from "./types";

type CatalogFields = Pick<ProductCatalogItem, "skuId" | "vendorName" | "imageUrl" | "productName" | "optionLabel">;
type ResolvedField = "vendorName" | "imageUrl" | "optionLabel";
export interface VendorCatalogChange { lineId: string; skuId: string; fields: ResolvedField[] }

const editable = (draft?: VendorOrderDraft) => !draft || ["draft", "review", "approved", "resend_needed"].includes(draft.status);
const missingVendor = (value: string) => !value.trim() || value.replace(/\s/g, "") === UNASSIGNED_VENDOR_NAME.replace(/\s/g, "");
const optionKey = (value: string) => value.trim().toLocaleLowerCase("ko").replace(/\s+/g, " ");

/** Only expand a saved size when that exact size is a literal option of this exact SKU. */
function completeMissingOption(stored: string, catalog: CatalogFields): string {
  const complete = resolveDisplayNameAndOption(catalog.productName, "", catalog.optionLabel).option;
  if (!stored.trim()) return complete || stored;
  const isSizeOnly = /^(?:\d{1,3}(?:\.\d+)?\s*(?:호|mm|cm)|XS|S|M|L|XL|XXL|FREE)$/i.test(stored.trim());
  if (!isSizeOnly || !complete || optionKey(complete) === optionKey(stored)) return stored;
  return complete.split(",").some(part => optionKey(part) === optionKey(stored)) ? complete : stored;
}

/** Pure preparation: exact SKU only, no I/O and no mutation of source records or catalog. */
export function resolveVendorOrderCatalog(input: {
  lines: readonly VendorOrderDraftLine[];
  drafts: readonly VendorOrderDraft[];
  catalogItems: Iterable<CatalogFields>;
  now: string;
  deletedDraftIds?: Readonly<Record<string, string>>;
}): { lines: VendorOrderDraftLine[]; drafts: VendorOrderDraft[]; changes: VendorCatalogChange[] } {
  const catalog = new Map<string, CatalogFields | null>();
  const signatures = new Map<string, string>();
  for (const item of input.catalogItems) {
    const sku = normalizeSkuId(item.skuId);
    if (!sku) continue;
    const signature = JSON.stringify([item.vendorName.trim(), item.imageUrl.trim(), item.productName, item.optionLabel]);
    if (signatures.has(sku) && signatures.get(sku) !== signature) { catalog.set(sku, null); continue; }
    if (!signatures.has(sku)) { signatures.set(sku, signature); catalog.set(sku, item); }
  }
  const drafts = [...input.drafts];
  const lines = [...input.lines];
  const changes: VendorCatalogChange[] = [];
  const changedDraftIds = new Set<string>();
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const sourceDrafts = drafts.filter(draft => draft.id === line.draftId);
    if (input.deletedDraftIds?.[line.draftId] || sourceDrafts.length > 1 || !editable(sourceDrafts[0]) || line.orderExclusion ||
        (line.receivedQuantity || 0) > 0 || line.receivedCostAppliedAt || line.receivingHistory?.length) continue;
    const current = catalog.get(normalizeSkuId(line.skuId));
    if (!current) continue;
    let next = line;
    const fields: ResolvedField[] = [];
    const vendorName = current.vendorName.trim();
    if (missingVendor(line.vendorName) && !missingVendor(vendorName)) {
      const targets = drafts.filter(draft => draft.waveId === line.waveId && draft.vendorName === vendorName && !input.deletedDraftIds?.[draft.id]);
      const conflictingSku = lines.some(other => other.id !== line.id && other.waveId === line.waveId &&
        other.vendorName === vendorName && normalizeSkuId(other.skuId) === normalizeSkuId(line.skuId));
      const targetId = `${line.waveId}::${vendorName}`;
      const conflictingId = drafts.some(draft => draft.id === targetId && (draft.waveId !== line.waveId || draft.vendorName !== vendorName));
      if (targets.length <= 1 && editable(targets[0]) && !conflictingSku && !conflictingId) {
        let availableTargetId = targetId;
        if (!targets.length && input.deletedDraftIds?.[availableTargetId]) {
          const version = input.now.replace(/[^0-9]/g, "") || "catalog";
          availableTargetId = targetId + "::new-catalog-" + version;
          let suffix = 1;
          while (input.deletedDraftIds?.[availableTargetId] || drafts.some(draft => draft.id === availableTargetId)) availableTargetId = targetId + "::new-catalog-" + version + "-" + suffix++;
        }
        const target = targets[0] || { id: availableTargetId, waveId: line.waveId, vendorName, status: "draft" as const, createdAt: input.now, updatedAt: input.now };
        if (!targets.length) drafts.push(target);
        next = { ...next, vendorName, draftId: target.id };
        fields.push("vendorName");
      }
    }
    if (!line.imageUrl.trim() && current.imageUrl.trim()) { next = { ...next, imageUrl: current.imageUrl.trim() }; fields.push("imageUrl"); }
    const optionLabel = completeMissingOption(line.optionLabel, current);
    if (optionLabel !== line.optionLabel) { next = { ...next, optionLabel }; fields.push("optionLabel"); }
    if (fields.length) {
      // The ID stays stable, including queue IDs and manually added lines. All business edits remain intact.
      lines[index] = { ...next, updatedAt: input.now };
      changes.push({ lineId: line.id, skuId: line.skuId, fields });
      changedDraftIds.add(line.draftId);
      changedDraftIds.add(next.draftId);
    }
  }
  // Approval may have been used to keep manual edits. Fill only missing data and
  // require review only for the approved source/target files whose content changed.
  return { lines, drafts: drafts.map(draft => draft.status === "approved" && changedDraftIds.has(draft.id)
    ? { ...draft, status: "resend_needed" as const, updatedAt: input.now } : draft), changes };
}
