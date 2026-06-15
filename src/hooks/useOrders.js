import { useCallback, useEffect, useRef, useState } from "react";
import { db } from "../lib/db.js";

// The live order board. Fetches the full dataset, subscribes to changes
// (Supabase realtime, or BroadcastChannel in local mode), and refetches on any
// change. At office data volumes a full refetch is simpler and more reliable
// than surgical patching. Mutations refetch immediately so the acting user
// sees their change without waiting for the realtime round-trip.

export function useOrders(enabled) {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const debounceRef = useRef(null);

  const refetch = useCallback(async () => {
    try {
      const data = await db.getOrders();
      setOrders(data);
      setError(null);
      return data;
    } catch (e) {
      setError(e.message || String(e));
      return [];
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    (async () => {
      setLoading(true);
      await refetch();
      if (active) setLoading(false);
    })();

    const scheduleRefetch = () => {
      clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => refetch(), 150);
    };
    const unsubscribe = db.subscribe(scheduleRefetch);
    return () => {
      active = false;
      clearTimeout(debounceRef.current);
      unsubscribe?.();
    };
  }, [enabled, refetch]);

  // Wrap a db mutation so it refetches afterward and returns fresh orders.
  const act = useCallback(
    (fn) =>
      async (...args) => {
        try {
          await fn(...args);
          return await refetch();
        } catch (e) {
          setError(e.message || String(e));
          throw e;
        }
      },
    [refetch]
  );

  return {
    orders,
    loading,
    error,
    refetch,
    nextOrderNo: () => db.nextOrderNo(),
    createOrder: act((payload) => db.createOrder(payload)),
    triageItem: act((itemId, decision) => db.triageItem(itemId, decision)),
    addMaterials: act((itemId, rows) => db.addMaterials(itemId, rows)),
    finishItem: act((itemId) => db.finishItem(itemId)),
    updateItem: act((itemId, patch) => db.updateItem(itemId, patch)),
    markOrdered: act((materialId) => db.markOrdered(materialId)),
    receiveMaterial: act((materialId) => db.receiveMaterial(materialId)),
    setPriority: act((orderId, priority) => db.setPriority(orderId, priority)),
    fulfillOrder: act((orderId, method, location) => db.fulfillOrder(orderId, method, location)),
    markShipped: act((orderId, trackingNumber) => db.markShipped(orderId, trackingNumber)),
    deleteOrder: act((orderId) => db.deleteOrder(orderId)),
    cancelOrder: act((orderId, reason) => db.cancelOrder(orderId, reason)),
    unpickItem: act((itemId) => db.unpickItem(itemId)),
    moveItem: act((itemId, stage) => db.moveItem(itemId, stage)),
    markPickedUp: act((orderId, by) => db.markPickedUp(orderId, by)),
  };
}
