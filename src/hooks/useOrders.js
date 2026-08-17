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
  // The board as it stands right now, readable synchronously. setOrders alone
  // can't give us that — React may not have applied it yet — and callers need
  // the RESULT of a patch immediately: finishing the last product on an order
  // pops the "will call or shipping?" prompt, and that decision is made from
  // the board as it is after the click, not before it.
  const ordersRef = useRef([]);

  const setBoard = useCallback((next) => {
    ordersRef.current = next;
    setOrders(next);
    return next;
  }, []);

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
        setBoard(data);
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
  // Each returns the board as it now stands, so a caller can act on the result
  // without waiting for a round trip.
  const patchMaterial = useCallback((materialId, patch) =>
    setBoard(ordersRef.current.map((o) => ({
      ...o,
      items: (o.items || []).map((it) => ({
        ...it,
        materials: (it.materials || []).map((m) => (m.id === materialId ? { ...m, ...patch } : m)),
      })),
    }))), [setBoard]);

  const patchItem = useCallback((itemId, patch) =>
    setBoard(ordersRef.current.map((o) => ({
      ...o,
      items: (o.items || []).map((it) => (it.id === itemId ? { ...it, ...patch } : it)),
    }))), [setBoard]);

  const patchOrder = useCallback((orderId, patch) =>
    setBoard(ordersRef.current.map((o) => (o.id === orderId ? { ...o, ...patch } : o))), [setBoard]);

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

  // Optimistic mutation: show it immediately, persist in the background, and
  // only fall back to a full reload if the write actually fails. Returns the
  // board as patched, so callers that used to read the refetched board still can.
  //
  // These skip the after-the-fact reload entirely — realtime now delivers the
  // authoritative row surgically a moment later, so re-downloading the whole
  // board to learn about a change we already applied is pure waste.
  const optimistic = useCallback(
    (applyPatch) => (patch, fn) => async (id, ...rest) => {
      const patched = applyPatch(id, typeof patch === "function" ? patch(...rest) : patch);
      try {
        await fn(id, ...rest);
        return patched;
      } catch (e) {
        // Go and get the truth first, THEN report. refetch clears the error on
        // success, so reporting first would wipe the very message the user needs
        // — they'd watch their click quietly undo itself with no explanation.
        const fresh = await refetch();
        setError(e.message || String(e));
        return fresh;
      }
    },
    [refetch]
  );

  const optimisticMaterial = useCallback(optimistic(patchMaterial), [optimistic, patchMaterial]);
  const optimisticItem = useCallback(optimistic(patchItem), [optimistic, patchItem]);
  const optimisticOrder = useCallback(optimistic(patchOrder), [optimistic, patchOrder]);

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
    // The three most-clicked actions on the board, made instant. Each is a
    // single-column server update, so the local patch can't disagree with it.
    // finishItem still returns the resulting board: finishing the last product
    // is what pops the will-call/shipping prompt.
    finishItem: optimisticItem({ stage: "done" }, (itemId) => db.finishItem(itemId)),
    getItemEvents: (itemId) => db.getItemEvents(itemId),
    // Returns the order's official work-order date — the first print's. Patches
    // the board locally so a second sheet opened straight after shows the same
    // date without waiting for a reload.
    markWorkOrderPrinted: async (orderId) => {
      const at = await db.markWorkOrderPrinted?.(orderId);
      if (at) patchOrder(orderId, { woPrintedAt: at });
      return at || null;
    },
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
    setPriority: optimisticOrder((priority) => ({ priority }), (orderId, priority) => db.setPriority(orderId, priority)),
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
    // Mirrors the server write exactly: stage, and needs_material cleared.
    moveItem: optimisticItem((stage) => ({ stage, needsMaterial: false }), (itemId, stage) => db.moveItem(itemId, stage)),
    markPickedUp: act((orderId, by) => db.markPickedUp(orderId, by)),
  };
}
