import { useCallback, useEffect, useRef, useState } from "react";
import { db } from "../lib/db.js";

// Low-stock notices for the Inventory tab. Same fetch + subscribe + refetch
// pattern as useWorkOrders, on its own little stream — a notice posted by
// whoever is picking shows up live on the board of whoever makes that product.
export function useStockNotices(enabled) {
  const [notices, setNotices] = useState([]);
  const [error, setError] = useState(null);
  const debounceRef = useRef(null);

  const refetch = useCallback(async () => {
    try {
      setNotices((await db.getStockNotices?.()) || []);
      setError(null);
    } catch (e) {
      setError(e.message || String(e));
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    refetch();
    const schedule = () => {
      clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => refetch(), 150);
    };
    const unsub = db.subscribe(schedule);
    return () => {
      clearTimeout(debounceRef.current);
      unsub?.();
    };
  }, [enabled, refetch]);

  return {
    notices,
    error,
    refetch,
    createNotice: async (payload) => { await db.createStockNotice(payload); await refetch(); },
    setHandled: async (id, handled = true, opts) => { await db.setStockNoticeHandled(id, handled, opts); await refetch(); },
    deleteNotice: async (id) => { await db.deleteStockNotice(id); await refetch(); },
  };
}
