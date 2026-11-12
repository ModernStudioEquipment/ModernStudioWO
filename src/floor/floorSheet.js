// The read-only work order the floor can open.
//
// The floor may see what to make and nothing about who it's for — the rule the
// whole floor_* layer exists for (0038, 0059). The office sheet can't simply be
// shown locked: it carries "Ordered by", "Invoice(s)", a customer name on
// Shopify orders, and a free-text Notes box that on some forms holds exactly
// that kind of thing.
//
// So this is an ALLOW-list. Each field below is one the wall monitor's
// floor_queue view already exposes, or is plainly "how to make it" (line rows,
// CNC steps, the bench). Anything not named here cannot reach the floor, and a
// new field on a form stays off this sheet until someone adds it on purpose.
// Do not add a key without asking what it can contain on every one of the four
// forms — the same warning 0059 carries.

const clean = (v) => {
  const s = String(v ?? "").trim();
  return s || null;
};

// A Shopify (or QuickBooks-sync) order item at the Work stage.
export function sheetFromItem(order, it) {
  return {
    kind: "item",
    orderNo: clean(order.orderNo),
    dept: clean(it.dept),
    product: clean(it.name) || "(no product name)",
    qty: clean(it.qty),
    color: clean(it.color),
    partNo: clean(it.sku),
    image: clean(it.imageUrl),
    rush: order.priority === "RUSH",
    dueDate: clean(order.dueDate),
    station: null,
    lines: [],
    steps: [],
  };
}

const DEPT_NAME = { shop: "Shop", cnc: "CNC", sewing: "Sewing", saw: "Saw" };

// A custom work order from the Work Order tab.
export function sheetFromWorkOrder(w) {
  const f = w.fields || {};
  const lines = (Array.isArray(f.lines) ? f.lines : [])
    .map((l) => ({
      what: clean(l?.product) || clean(l?.item),
      size: clean(l?.size),
      qty: clean(l?.qty),
    }))
    .filter((l) => l.what || l.size || l.qty);
  const steps = [1, 2, 3, 4, 5, 6].map((n) => clean(f[`step${n}`])).filter(Boolean);
  return {
    kind: "workorder",
    orderNo: clean(w.orderNo),
    dept: DEPT_NAME[w.type] || "Shop",
    product: clean(f.product) || clean(w.title) || `Work order ${w.orderNo || ""}`.trim(),
    qty: clean(f.total) || clean(f.order),
    color: clean(f.color),
    partNo: clean(f.partNo),
    image: clean(f.imageUrl),
    rush: false,
    dueDate: clean(f.dueDate),
    station: clean(w.station),
    lines,
    steps,
  };
}
