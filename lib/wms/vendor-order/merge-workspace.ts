export interface VendorEditConflict {
  key: string;
  kind: "line" | "draft";
  id: string;
  vendorName: string;
  field: string;
  local: unknown;
  remote: unknown;
}
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
export const vendorRecordChanged = <T extends { updatedAt: string }>(a: T | undefined, b: T | undefined): boolean => {
  if (!a || !b) return a !== b;
  return !equal({ ...a, updatedAt: "" }, { ...b, updatedAt: "" });
};

/** Three-way field merge: remote-only edits apply, local-only edits survive.
 * Conflicts are explicit and block only the affected vendor's save. */
export function mergeVendorRecords<T extends { id: string; vendorName: string; updatedAt: string }>(
  kind: VendorEditConflict["kind"], baseline: readonly T[], local: readonly T[], remote: readonly T[],
  removed = new Set<string>(), priorConflicts: readonly VendorEditConflict[] = [],
): { records: T[]; conflicts: VendorEditConflict[] } {
  const bases = new Map(baseline.map(row => [row.id, row]));
  const locals = new Map(local.map(row => [row.id, row]));
  const remotes = new Map(remote.map(row => [row.id, row]));
  const conflicts = new Map(priorConflicts.filter(c => c.kind === kind).map(c => [c.key, c]));
  const records: T[] = [];
  for (const id of new Set([...locals.keys(), ...remotes.keys(), ...bases.keys()])) {
    const before = bases.get(id), mine = locals.get(id);
    const candidate = remotes.get(id);
    // Ignore a response captured before a successful local save.
    const theirs = before && candidate && candidate.updatedAt < before.updatedAt ? before : candidate;
    if (removed.has(id)) {
      if (theirs && vendorRecordChanged(before, theirs)) {
        const key = `${kind}:${id}:__deleted`;
        conflicts.set(key, { key, kind, id, vendorName: theirs.vendorName, field: "__deleted", local: null, remote: theirs });
      }
      continue;
    }
    if (!before) { if (mine || theirs) records.push((mine || theirs)!); continue; }
    if (!theirs) {
      if (mine && vendorRecordChanged(before, mine)) {
        records.push(mine);
        const key = `${kind}:${id}:__deleted`;
        conflicts.set(key, { key, kind, id, vendorName: mine.vendorName, field: "__deleted", local: mine, remote: null });
      }
      continue;
    }
    if (!mine) { records.push(theirs); continue; }
    const merged = { ...theirs } as T & Record<string, unknown>;
    const base = before as T & Record<string, unknown>;
    const localFields = mine as T & Record<string, unknown>;
    const remoteFields = theirs as T & Record<string, unknown>;
    for (const field of new Set([...Object.keys(base), ...Object.keys(localFields), ...Object.keys(remoteFields)])) {
      if (field === "updatedAt") continue;
      const key = `${kind}:${id}:${field}`;
      if (equal(localFields[field], remoteFields[field])) { conflicts.delete(key); continue; }
      if (!equal(base[field], localFields[field])) {
        (merged as Record<string, unknown>)[field] = localFields[field];
        if (!equal(base[field], remoteFields[field])) conflicts.set(key, { key, kind, id, vendorName: mine.vendorName, field, local: localFields[field], remote: remoteFields[field] });
      }
    }
    records.push(merged);
  }
  return { records, conflicts: [...conflicts.values()] };
}
