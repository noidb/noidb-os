"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

interface UndoEntry {
  label: string;
  run: () => Promise<void> | void;
}

interface WmsUndoContextValue {
  canUndo: boolean;
  undoLabel: string | null;
  undoing: boolean;
  pushUndo: (label: string, run: UndoEntry["run"]) => void;
  undoLast: () => Promise<void>;
}

const WmsUndoContext = createContext<WmsUndoContextValue | null>(null);

export function WmsUndoProvider({ children }: { children: ReactNode }) {
  const [stack, setStack] = useState<UndoEntry[]>([]);
  const [undoing, setUndoing] = useState(false);

  const pushUndo = useCallback((label: string, run: UndoEntry["run"]) => {
    setStack(previous => [...previous.slice(-9), { label, run }]);
  }, []);

  const undoLast = useCallback(async () => {
    if (undoing) return;
    const entry = stack[stack.length - 1];
    if (!entry) return;
    setUndoing(true);
    try {
      await entry.run();
      setStack(previous => previous.slice(0, -1));
    } finally {
      setUndoing(false);
    }
  }, [stack, undoing]);

  const value = useMemo(() => ({
    canUndo: stack.length > 0,
    undoLabel: stack[stack.length - 1]?.label || null,
    undoing,
    pushUndo,
    undoLast,
  }), [stack, undoing, pushUndo, undoLast]);

  return <WmsUndoContext.Provider value={value}>{children}</WmsUndoContext.Provider>;
}

export function useWmsUndo(): WmsUndoContextValue {
  const value = useContext(WmsUndoContext);
  if (!value) throw new Error("useWmsUndo must be used within WmsUndoProvider");
  return value;
}
