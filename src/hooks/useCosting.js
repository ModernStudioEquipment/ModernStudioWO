import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { db } from "../lib/db.js";

// Costing / margins. Holds the input library (raw materials, labor rates), the
// costed products, and their recipe lines.
//
// The important bit: a recipe line stores only a QUANTITY. Cost is derived from
// the input's current unit price every time it's read — so changing the price of
// a raw material immediately re-prices every product that uses it, with nothing
// cached to go stale.
export function useCosting(enabled) {
  const [data, setData] = useState({ inputs: [], products: [], lines: [] });
  const [catalog, setCatalog] = useState([]); // every product ever ordered
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const debounceRef = useRef(null);

  const refetch = useCallback(async () => {
    try {
      const [costing, cat] = await Promise.all([
        db.getCosting?.(),
        db.getProductCatalog?.(),
      ]);
      setData(costing || { inputs: [], products: [], lines: [] });
      setCatalog(cat || []);
      setError(null);
    } catch (e) {
      setError(e.message || String(e));
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
    const schedule = () => {
      clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => refetch(), 150);
    };
    const unsub = db.subscribe(schedule);
    return () => {
      active = false;
      clearTimeout(debounceRef.current);
      unsub?.();
    };
  }, [enabled, refetch]);

  const inputsById = useMemo(() => {
    const m = new Map();
    data.inputs.forEach((i) => m.set(i.id, i));
    return m;
  }, [data.inputs]);

  // Recipe lines for a product, each priced from its input's CURRENT price.
  const linesFor = useCallback(
    (productId) =>
      data.lines
        .filter((l) => l.productId === productId)
        .map((l) => {
          const input = inputsById.get(l.inputId) || null;
          return { ...l, input, cost: (Number(l.qty) || 0) * (input?.unitPrice || 0) };
        })
        .sort((a, b) => (a.position || 0) - (b.position || 0)),
    [data.lines, inputsById]
  );

  // Total cost, profit and margin for one product.
  const costOf = useCallback(
    (product) => {
      const lines = linesFor(product.id);
      const cost = lines.reduce((n, l) => n + l.cost, 0);
      const sell = product.sellPrice;
      const profit = sell == null ? null : sell - cost;
      // Margin is profit as a share of the SELL price (not markup on cost).
      const margin = sell == null || sell === 0 ? null : (profit / sell) * 100;
      return { lines, cost, sell, profit, margin };
    },
    [linesFor]
  );

  // How many costed products use a given input — shown when editing its price so
  // you can see the blast radius before changing it.
  const usageOf = useCallback(
    (inputId) => new Set(data.lines.filter((l) => l.inputId === inputId).map((l) => l.productId)).size,
    [data.lines]
  );

  const act = (fn) => async (...args) => {
    const out = await fn(...args);
    await refetch();
    return out;
  };

  return {
    ...data,
    catalog,
    loading,
    error,
    refetch,
    inputsById,
    linesFor,
    costOf,
    usageOf,
    saveInput: act((p) => db.saveCostInput(p)),
    deleteInput: act((id) => db.deleteCostInput(id)),
    ensureProduct: act((name) => db.ensureProductCost(name)),
    setSellPrice: act((id, v) => db.setProductSellPrice(id, v)),
    saveLine: act((l) => db.saveCostLine(l)),
    deleteLine: act((id) => db.deleteCostLine(id)),
  };
}
