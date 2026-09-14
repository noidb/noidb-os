import { readWeeklyWorkspace, mutateWeeklyWorkspace } from "./weekly-work-store";
import { listStatusRequests, listStatusFileGenerations } from "./vendor-order-actions";
let inFlight: Promise<NonNullable<Awaited<ReturnType<typeof readWeeklyWorkspace>>["statusListSnapshot"]>> | null = null;
/** No time-based refresh: only an explicit weekly analysis replaces this list. */
export async function readSavedStatusList(refresh = false) {
  const workspace = await readWeeklyWorkspace();
  if (!refresh && workspace.statusListSnapshot) return workspace.statusListSnapshot;
  if (!inFlight) inFlight = (async () => {
    const [requests, generations] = await Promise.all([listStatusRequests(), listStatusFileGenerations()]);
    return mutateWeeklyWorkspace(current => {
      if (!refresh && current.statusListSnapshot) return current.statusListSnapshot;
      const merged = new Map(requests.map(row=>[row.id,row]));
      for (const row of current.statusListSnapshot?.requests || []) {
        const before = workspace.statusListSnapshot?.requests.find(value=>value.id===row.id);
        if (JSON.stringify(before)!==JSON.stringify(row)) merged.set(row.id,row);
      }
      const files = new Map([...generations,...(current.statusListSnapshot?.generations || [])].map(row=>[row.id,row]));
      current.statusListSnapshot = { requests: [...merged.values()], generations: [...files.values()], at: new Date().toISOString() };
      return current.statusListSnapshot;
    });
  })().finally(() => { inFlight = null; });
  return inFlight;
}
