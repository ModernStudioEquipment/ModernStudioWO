import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

// The board's live-update path. Realtime now patches single rows in place
// instead of re-downloading the whole board (3.7 MB) every time anyone in the
// building clicks anything. Two things have to hold:
//   1. a patch MERGES — an item's materials must survive an item update, or the
//      whole purchasing list silently empties until the next full reload;
//   2. anything structural still triggers a real reload, or new orders never
//      appear.

let handler;                 // the realtime callback the hook registers
const getOrders = vi.fn();
const finishItem = vi.fn();
const moveItem = vi.fn();
const setPriority = vi.fn();

vi.mock("../lib/db.js", () => ({
  db: {
    getOrders: (...a) => getOrders(...a),
    getArrangement: async () => [],
    finishItem: (...a) => finishItem(...a),
    moveItem: (...a) => moveItem(...a),
    setPriority: (...a) => setPriority(...a),
    subscribe: (cb) => { handler = cb; return () => {}; },
    // Stand-in for the adapter's mapper: returns the row's OWN columns only,
    // exactly like the real one.
    mapRealtimeRow: (table, row) => {
      if (!row?.id) return null;
      if (table === "materials") return { id: row.id, progress: row.progress ?? null };
      if (table === "items") return { id: row.id, stage: row.stage };
      if (table === "orders") return { id: row.id, priority: row.priority };
      return null;   // item_events, work_orders, app_settings…
    },
  },
}));

const board = () => [{
  id: "o1", orderNo: "1001", priority: "Normal",
  items: [{ id: "i1", stage: "picklist", materials: [{ id: "m1", name: "1in bar", progress: null }] }],
}];

beforeEach(() => {
  handler = undefined;
  getOrders.mockReset().mockResolvedValue(board());
  [finishItem, moveItem, setPriority].forEach((m) => m.mockReset().mockResolvedValue(undefined));
});

const mount = async () => {
  const { useOrders } = await import("../hooks/useOrders.js");
  const h = renderHook(() => useOrders(true));
  await waitFor(() => expect(h.result.current.orders.length).toBe(1));
  getOrders.mockClear();          // ignore the initial load
  return h;
};

describe("realtime patches one row instead of reloading the board", () => {
  it("applies a material update without refetching", async () => {
    const h = await mount();
    await act(async () => { handler({ eventType: "UPDATE", table: "materials", new: { id: "m1", progress: "Quote requested" } }); });

    expect(h.result.current.orders[0].items[0].materials[0].progress).toBe("Quote requested");
    expect(getOrders).not.toHaveBeenCalled();      // the whole point
  });

  it("keeps the item's materials when the ITEM updates", async () => {
    const h = await mount();
    await act(async () => { handler({ eventType: "UPDATE", table: "items", new: { id: "i1", stage: "done" } }); });

    const item = h.result.current.orders[0].items[0];
    expect(item.stage).toBe("done");
    expect(item.materials).toHaveLength(1);        // merged, not replaced
    expect(item.materials[0].name).toBe("1in bar");
  });

  it("keeps the order's items when the ORDER updates", async () => {
    const h = await mount();
    await act(async () => { handler({ eventType: "UPDATE", table: "orders", new: { id: "o1", priority: "RUSH" } }); });

    expect(h.result.current.orders[0].priority).toBe("RUSH");
    expect(h.result.current.orders[0].items).toHaveLength(1);
    expect(h.result.current.orders[0].orderNo).toBe("1001");  // untouched columns survive
  });
});

describe("anything structural still reloads", () => {
  const reloads = async (payload) => {
    const h = await mount();
    await act(async () => { handler(payload); });
    await waitFor(() => expect(getOrders).toHaveBeenCalled());
    return h;
  };

  it("reloads on INSERT — a new order can't be patched in", async () => {
    await reloads({ eventType: "INSERT", table: "orders", new: { id: "o2" } });
  });

  it("reloads on DELETE", async () => {
    await reloads({ eventType: "DELETE", table: "items", old: { id: "i1" } });
  });

  it("reloads for tables the board can't map", async () => {
    await reloads({ eventType: "UPDATE", table: "work_orders", new: { id: "w1" } });
  });

  it("reloads when the adapter gives no payload at all (demo mode)", async () => {
    await reloads(undefined);
  });
});

describe("the most-clicked actions apply instantly", () => {
  it("marks an item done on screen without reloading the board", async () => {
    const h = await mount();
    await act(async () => { await h.result.current.finishItem("i1"); });

    expect(h.result.current.orders[0].items[0].stage).toBe("done");
    expect(finishItem).toHaveBeenCalledWith("i1");
    expect(getOrders).not.toHaveBeenCalled();
  });

  // finishItem's RETURN drives the "will call or shipping?" prompt that fires
  // when the last product on an order is finished. It used to be the refetched
  // board; it must still describe the order as it is AFTER the click.
  it("returns a board showing the item done, so the fulfillment prompt still fires", async () => {
    const h = await mount();
    let returned;
    await act(async () => { returned = await h.result.current.finishItem("i1"); });

    const order = (returned || []).find((o) => o.id === "o1");
    expect(order, "finishItem must return the board").toBeTruthy();
    expect(order.items.every((i) => i.stage === "done")).toBe(true);
  });

  it("moves an item and clears needs-material, mirroring the server write", async () => {
    const h = await mount();
    await act(async () => { await h.result.current.moveItem("i1", "workorder"); });

    const item = h.result.current.orders[0].items[0];
    expect(item.stage).toBe("workorder");
    expect(item.needsMaterial).toBe(false);
    expect(item.materials).toHaveLength(1);      // still merged, not replaced
    expect(getOrders).not.toHaveBeenCalled();
  });

  it("changes priority instantly", async () => {
    const h = await mount();
    await act(async () => { await h.result.current.setPriority("o1", "RUSH"); });

    expect(h.result.current.orders[0].priority).toBe("RUSH");
    expect(h.result.current.orders[0].items).toHaveLength(1);
    expect(getOrders).not.toHaveBeenCalled();
  });

  // The risk of showing something before it's saved: if the save fails, the
  // screen must not keep showing a change that never happened.
  it("reloads the real state when the write fails", async () => {
    const h = await mount();
    finishItem.mockRejectedValue(new Error("network down"));

    await act(async () => { await h.result.current.finishItem("i1"); });

    await waitFor(() => expect(getOrders).toHaveBeenCalled());   // went for the truth
    expect(h.result.current.orders[0].items[0].stage).toBe("picklist"); // reverted
    expect(h.result.current.error).toMatch(/network down/);
  });
});

describe("refetches coalesce", () => {
  it("two reloads at once cause a single board load", async () => {
    const h = await mount();
    let release;
    getOrders.mockImplementation(() => new Promise((r) => { release = () => r(board()); }));

    let a, b;
    await act(async () => {
      a = h.result.current.refetch();
      b = h.result.current.refetch();   // rides along with the first
      release();
      await Promise.all([a, b]);
    });

    expect(getOrders).toHaveBeenCalledTimes(1);
  });

  it("a later reload still gets its own fetch", async () => {
    const h = await mount();
    await act(async () => { await h.result.current.refetch(); });
    await act(async () => { await h.result.current.refetch(); });
    expect(getOrders).toHaveBeenCalledTimes(2);
  });
});
