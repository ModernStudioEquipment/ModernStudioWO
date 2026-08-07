import { useCallback, useEffect, useRef, useState } from "react";
import { db } from "../lib/db.js";

// The live order board. Fetches the full dataset, subscribes to changes
// (Supabase realtime, or BroadcastChannel in local mode), and refetches on any
// change. At office data volumes a full refetch is simpler and more reliable
// than surgical patching. Mutations refetch immediately so the acting user
// sees their change without waiting for the realtime round-trip.

export function useOrders(enabled) {
  const [orders, setOrders] = useState([]);
  const [arrangement, setArrangementState] = useState([]); // shared manual order of the Orders tab (DB-backed)
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const debounceRef = useRef(null);

  const refetch = useCallback(async () => {
    try {
      const data = await db.getOrders();
      setOrders(data);
      // The shared Orders-tab arrangement rides the same refetch, so any realtime
      // change (including a reorder, via app_settings) refreshes it for everyone.
      setArrangementState((await db.getArrangement?.()) || []);
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

  // Patch one material in the local board copy. Used to make small toggles feel
  // instant: a full refetch is ~2 MB and a second of work, which is far too heavy
  // to sit behind a single click. The write still goes to the server; realtime
  // brings the authoritative state a moment later.
  const patchMaterial = useCallback((materialId, patch) => {
    setOrders((prev) =>
      prev.map((o) => ({
        ...o,
        items: (o.items || []).map((it) => ({
          ...it,
          materials: (it.materials || []).map((m) => (m.id === materialId ? { ...m, ...patch } : m)),
        })),
      }))
    );
  }, []);

  // Optimistic toggle: show it immediately, persist in the background, and only
  // fall back to a refetch if the write actually fails.
  const optimisticMaterial = useCallback(
    (patch, fn) => async (materialId, ...rest) => {
      patchMaterial(materialId, typeof patch === "function" ? patch(...rest) : patch);
      try {
        await fn(materialId, ...rest);
      } catch (e) {
        setError(e.message || String(e));
        await refetch();
      }
    },
    [patchMaterial, refetch]
  );

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
    patchMaterial,
    arrangement,
    setArrangement: act((ids) => db.setArrangement(ids)),
    nextOrderNo: () => db.nextOrderNo(),
    nextPurchaseNo: () => db.nextPurchaseNo(),
    createOrder: act((payload) => db.createOrder(payload)),
    createPurchase: act((payload) => db.createPurchase(payload)),
    triageItem: act((itemId, decision) => db.triageItem(itemId, decision)),
    addMaterials: act((itemId, rows) => db.addMaterials(itemId, rows)),
    finishItem: act((itemId) => db.finishItem(itemId)),
    getItemEvents: (itemId) => db.getItemEvents(itemId),
    updateItem: act((itemId, patch) => db.updateItem(itemId, patch)),
    uploadItemPhoto: act((itemId, file) => db.uploadItemPhoto(itemId, file)),
    markOrdered: act((materialId, details) => db.markOrdered(materialId, details)),
    unmarkOrdered: act((materialId) => db.unmarkOrdered(materialId)),
    setMaterialProgress: optimisticMaterial(
      (progress, by) => ({ progress: progress || null, progressAt: progress ? Date.now() : null, progressBy: progress ? by || null : null }),
      (materialId, progress, by) => db.setMaterialProgress(materialId, progress, by)
    ),
    setForInventory: optimisticMaterial(
      (forInventory) => ({ forInventory: !!forInventory }),
      (materialId, forInventory) => db.setForInventory(materialId, forInventory)
    ),
    receiveMaterial: act((materialId, opts) => db.receiveMaterial(materialId, opts)),
    setPriority: act((orderId, priority) => db.setPriority(orderId, priority)),
    setDueDate: act((orderId, dueDate, dueTime) => db.setDueDate(orderId, dueDate, dueTime)),
    setCompletionDate: act((orderId, date) => db.setCompletionDate(orderId, date)),
    setInvoiced: act((orderId, invoiced, invoiceNumber) => db.setInvoiced(orderId, invoiced, invoiceNumber)),
    setFulfillmentMethod: act((orderId, method) => db.setFulfillmentMethod(orderId, method)),
    setOrderNotes: act((orderId, notes) => db.setOrderNotes(orderId, notes)),
    setLocation: act((orderId, location) => db.setLocation(orderId, location)),
    fulfillOrder: act((orderId, method, location) => db.fulfillOrder(orderId, method, location)),
    reopenOrder: act((orderId, stage) => db.reopenOrder(orderId, stage)),
    markShipped: act((orderId, payload) => db.markShipped(orderId, payload)),
    recordFulfillment: act((orderId, payload) => db.recordFulfillment(orderId, payload)),
    deleteOrder: act((orderId) => db.deleteOrder(orderId)),
    cancelOrder: act((orderId, reason) => db.cancelOrder(orderId, reason)),
    unpickItem: act((itemId) => db.unpickItem(itemId)),
    moveItem: act((itemId, stage) => db.moveItem(itemId, stage)),
    markPickedUp: act((orderId, by) => db.markPickedUp(orderId, by)),
  };
}
