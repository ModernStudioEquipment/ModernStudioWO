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
  const inFlightRef = useRef(null);

  const refetch = useCallback(async () => {
    // COALESCE. Every mutation refetched immediately AND realtime scheduled its
    // own refetch ~150ms later, so a single click cost two full board loads —
    // 2.6 MB each. Whoever asks second now rides along with the load already
    // running instead of starting an identical one. Nothing is skipped: a change
    // arriving after this finishes still gets its own fetch.
    if (inFlightRef.current) return inFlightRef.current;

    const run = (async () => {
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
    })();

    inFlightRef.current = run;
    // Clear the slot however it settles. If this were left set after a failure,
    // the board would never refetch again for the life of the session.
    try {
      return await run;
    } finally {
      inFlightRef.current = null;
    }
  }, []);

  // --- Local patchers -------------------------------------------------------
  // Update one row in the board copy we already hold, instead of re-downloading
  // the lot. Used both for optimistic clicks and for applying realtime changes.
  //
  // They MERGE (`...existing, ...patch`) rather than replace, because a patch
  // carries only its own columns — an item's materials and an order's items must
  // survive it. They must also be declared above the effect that lists them as
  // dependencies: naming them in a dependency array before their `const` would
  // be a temporal-dead-zone crash on first render.

  // Patch one material. Makes small toggles feel instant: a full refetch is
  // megabytes and a second of work, far too heavy to sit behind one click. The
  // write still goes to the server; realtime confirms it a moment later.
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

  const patchItem = useCallback((itemId, patch) => {
    setOrders((prev) =>
      prev.map((o) => ({
        ...o,
        items: (o.items || []).map((it) => (it.id === itemId ? { ...it, ...patch } : it)),
      }))
    );
  }, []);

  const patchOrder = useCallback((orderId, patch) => {
    setOrders((prev) => prev.map((o) => (o.id === orderId ? { ...o, ...patch } : o)));
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

    // Realtime used to reload the ENTIRE board on every change anyone made —
    // 3.7 MB per event, on every open screen in the building. With 30 people
    // working that is a lot of traffic to learn that one checkbox moved.
    //
    // An UPDATE to a single row is the overwhelming majority of that traffic
    // (progress toggles, stage moves, priority changes) and carries everything
    // needed to patch in place. Anything structural — a new order, a deleted
    // item, a table we can't map — still triggers the full reload, because that
    // can change which orders exist and where items belong.
    const onChange = (payload) => {
      const row = payload?.new;
      const mapped = payload?.eventType === "UPDATE" && row
        ? db.mapRealtimeRow?.(payload.table, row)
        : null;
      if (!mapped) return scheduleRefetch();

      if (payload.table === "materials") return patchMaterial(mapped.id, mapped);
      if (payload.table === "items") return patchItem(mapped.id, mapped);
      if (payload.table === "orders") return patchOrder(mapped.id, mapped);
      return scheduleRefetch();
    };

    const unsubscribe = db.subscribe(onChange);
    return () => {
      active = false;
      clearTimeout(debounceRef.current);
      unsubscribe?.();
    };
  }, [enabled, refetch, patchMaterial, patchItem, patchOrder]);

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
      (progress, meta = {}) => ({
        progress: progress || null,
        progressAt: progress ? Date.now() : null,
        progressBy: progress ? meta.by || null : null,
        ...(meta.note !== undefined ? { note: meta.note } : {}),
      }),
      (materialId, progress, meta) => db.setMaterialProgress(materialId, progress, meta)
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
