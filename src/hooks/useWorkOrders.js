import { useCallback, useEffect, useRef, useState } from "react";
import { db } from "../lib/db.js";

// Custom work orders created from the Work Order tab. Same fetch + subscribe +
// refetch pattern as useOrders, on its own little stream.
export function useWorkOrders(enabled) {
  const [workOrders, setWorkOrders] = useState([]);
  const [error, setError] = useState(null);
  const debounceRef = useRef(null);

  const refetch = useCallback(async () => {
    try {
      setWorkOrders(await db.getWorkOrders());
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
    workOrders,
    error,
    nextWorkOrderNo: () => db.nextWorkOrderNo(),
    createWorkOrder: async (payload) => {
      const id = await db.createWorkOrder(payload);
      await refetch();
      return id;
    },
    markDone: async (id) => {
      await db.markWorkOrderDone(id);
      await refetch();
    },
    updateWorkOrder: async (id, payload) => {
      await db.updateWorkOrder(id, payload);
      await refetch();
    },
  };
}
