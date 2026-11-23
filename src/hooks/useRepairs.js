import { useCallback, useEffect, useRef, useState } from "react";
import { db } from "../lib/db.js";

// Repair tickets (Repairs tab). Same fetch + subscribe + refetch pattern as
// useWorkOrders, on its own channel.
//
// `missing` is true when the repairs table isn't there yet (migration 0067 not
// run): the tab says so instead of showing a raw database error.
export const isMissingTable = (e) => {
  const m = `${e?.code || ""} ${e?.message || e || ""}`;
  return /42P01|PGRST205|schema cache|does not exist/i.test(m) && /repairs/i.test(m);
};

export function useRepairs(enabled) {
  const [repairs, setRepairs] = useState([]);
  const [error, setError] = useState(null);
  const [missing, setMissing] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const debounceRef = useRef(null);

  const refetch = useCallback(async () => {
    try {
      setRepairs(await db.getRepairs());
      setError(null);
      setMissing(false);
    } catch (e) {
      if (isMissingTable(e)) setMissing(true);
      else setError(e?.message || String(e));
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    refetch();
    const schedule = () => {
      clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => refetch(), 150);
    };
    const unsub = db.subscribeRepairs ? db.subscribeRepairs(schedule) : null;
    return () => {
      clearTimeout(debounceRef.current);
      unsub?.();
    };
  }, [enabled, refetch]);

  const after = async (p) => { const out = await p; await refetch(); return out; };
  return {
    repairs, error, missing, loaded,
    createRepair: (payload) => after(db.createRepair(payload)),
    updateRepair: (id, payload) => after(db.updateRepair(id, payload)),
    deleteRepair: (id) => after(db.deleteRepair(id)),
  };
}
