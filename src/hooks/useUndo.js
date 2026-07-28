import { useCallback, useState } from "react";

// Remembers the last reversible thing YOU did on this device, so a mis-tap can be
// taken back. Deliberately one-deep and session-only: the board is shared and
// live, so replaying a stack of older changes could stomp on someone else's work.
// The label is what makes it useful — "Mark done — Spring Clip #1 (#473354)"
// answers "what did I just click?" without hunting through the board.
export function useUndo() {
  const [last, setLast] = useState(null); // { label, at, undo }
  const [undoing, setUndoing] = useState(false);

  const record = useCallback((label, undoFn) => {
    setLast({ label, at: Date.now(), undo: undoFn });
  }, []);

  const clear = useCallback(() => setLast(null), []);

  const undo = useCallback(async () => {
    if (!last || undoing) return;
    setUndoing(true);
    try {
      await last.undo();
      setLast(null);
    } finally {
      setUndoing(false);
    }
  }, [last, undoing]);

  return { last, undoing, record, undo, clear };
}
