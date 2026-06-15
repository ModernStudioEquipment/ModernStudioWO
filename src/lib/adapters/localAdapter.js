// Local/offline adapter — single machine, backed by localStorage, seeded with
// sample data. Lets the app run and demo with no backend. Cross-tab updates go
// over BroadcastChannel so two tabs on one machine stay in sync (a stand-in for
// the realtime that Supabase provides for real multi-user use).

import { buildSeed } from "../seed.js";

const KEY = "mse_orders_v1";
const WO_KEY = "mse_workorders_v1";
const channel =
  typeof BroadcastChannel !== "undefined"
    ? new BroadcastChannel("mse_orders")
    : null;

const uid = () =>
  typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `id-${Date.now()}-${Math.random().toString(36).slice(2)}`;

function read() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    /* ignore corrupt storage */
  }
  const seeded = buildSeed();
  localStorage.setItem(KEY, JSON.stringify(seeded));
  return seeded;
}

function write(orders) {
  localStorage.setItem(KEY, JSON.stringify(orders));
  channel?.postMessage("changed");
}

function readWO() {
  try {
    const raw = localStorage.getItem(WO_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    /* ignore */
  }
  return [];
}

function writeWO(list) {
  localStorage.setItem(WO_KEY, JSON.stringify(list));
  channel?.postMessage("changed");
}

// Highest numeric orderNo across the given records, + 1 (regular orders start
// at 1001). Work-order numbers (>= 100000) are excluded so the two sequences
// stay independent.
function nextNoFrom(records) {
  const nums = records
    .map((o) => parseInt(o.orderNo, 10))
    .filter((n) => !Number.isNaN(n) && n < WO_BASE);
  return nums.length ? Math.max(...nums) + 1 : 1001;
}

// Work orders get their own sequence starting at WO 100000, so the number alone
// tells you it's a work order (not a Shopify/phone order).
const WO_BASE = 100000;
function nextWoNoFrom(records) {
  const nums = records
    .map((o) => parseInt(o.orderNo, 10))
    .filter((n) => !Number.isNaN(n) && n >= WO_BASE);
  return nums.length ? Math.max(...nums) + 1 : WO_BASE;
}

// Apply fn to a single item (found by id) inside the stored orders, persist.
function mutateItem(itemId, fn) {
  const orders = read();
  for (const o of orders) {
    const it = o.items.find((i) => i.id === itemId);
    if (it) {
      fn(it, o);
      break;
    }
  }
  write(orders);
}

function mutateMaterial(materialId, fn) {
  const orders = read();
  outer: for (const o of orders) {
    for (const it of o.items) {
      const m = it.materials.find((mm) => mm.id === materialId);
      if (m) {
        fn(m, it, o);
        break outer;
      }
    }
  }
  write(orders);
}

export const localAdapter = {
  needsAuth: false,

  async getOrders() {
    return read();
  },

  subscribe(cb) {
    const onMsg = () => cb();
    channel?.addEventListener("message", onMsg);
    return () => channel?.removeEventListener("message", onMsg);
  },

  // Next order number — shared across orders AND custom work orders, so every
  // ticket in the shop has a unique sequential number.
  async nextOrderNo() {
    return String(nextNoFrom(read()));
  },

  async nextWorkOrderNo() {
    return String(nextWoNoFrom(readWO()));
  },

  async createOrder({ orderNo, customer, contact, priority, source, willCall, dueDate, items }) {
    const orders = read();
    orders.push({
      id: uid(),
      orderNo,
      customer,
      contact,
      receivedAt: Date.now(),
      priority: priority || "Normal",
      source: source || "phone",
      willCall: Boolean(willCall),
      dueDate: dueDate || null,
      fulfillment: null,
      location: null,
      trackingNumber: null,
      pickedUpAt: null,
      pickedUpBy: null,
      cancelledAt: null,
      cancelReason: null,
      items: items.map((it) => ({
        id: uid(),
        name: it.name,
        qty: Number(it.qty) || 1,
        dept: it.dept || "Shop",
        color: it.color || null,
        imageUrl: it.imageUrl || null,
        stage: "new",
        needsMaterial: false,
        materials: [],
      })),
    });
    write(orders);
  },

  async triageItem(itemId, decision) {
    mutateItem(itemId, (it) => {
      it.stage = decision === "instock" ? "picklist" : "workorder";
      it.needsMaterial = false;
      it.materials = [];
    });
  },

  async addMaterials(itemId, rows) {
    mutateItem(itemId, (it) => {
      it.stage = "awaiting";
      it.needsMaterial = true;
      it.materials = rows.map((r) => ({
        id: uid(),
        name: r.name,
        amount: r.amount,
        ordered: false,
        received: false,
      }));
    });
  },

  async finishItem(itemId) {
    mutateItem(itemId, (it) => {
      it.stage = "done";
    });
  },

  async updateItem(itemId, patch) {
    mutateItem(itemId, (it) => {
      if (patch.name !== undefined) it.name = patch.name;
      if (patch.qty !== undefined) it.qty = parseInt(patch.qty, 10) || it.qty;
      if (patch.color !== undefined) it.color = patch.color || null;
      if (patch.dept !== undefined) it.dept = patch.dept;
      if (patch.completedBy !== undefined) it.completedBy = patch.completedBy || null;
      if (patch.imageUrl !== undefined) it.imageUrl = patch.imageUrl || null;
    });
  },

  // Undo a pick: send a finished item back to the pick list.
  async unpickItem(itemId) {
    mutateItem(itemId, (it) => { it.stage = "picklist"; });
  },

  async markOrdered(materialId) {
    mutateMaterial(materialId, (m) => {
      m.ordered = true;
    });
  },

  // "Receive" / "have it": mark received; if the item was waiting and all of
  // its materials are now in, advance it into Work Order.
  async receiveMaterial(materialId) {
    mutateMaterial(materialId, (m, it) => {
      m.received = true;
      if (it.stage === "awaiting" && it.materials.every((x) => x.received)) {
        it.stage = "workorder";
      }
    });
  },

  async setPriority(orderId, priority) {
    const orders = read();
    const o = orders.find((x) => x.id === orderId);
    if (o) o.priority = priority;
    write(orders);
  },

  // Close out a completed order: method is 'willcall' or 'shipping', plus a
  // free-text location. Moves it into the matching top tab.
  async fulfillOrder(orderId, method, location) {
    const orders = read();
    const o = orders.find((x) => x.id === orderId);
    if (o) {
      o.fulfillment = method;
      o.location = location;
    }
    write(orders);
  },

  // Shipping stage 2: record the carrier tracking number (it's out the door).
  async markShipped(orderId, trackingNumber) {
    const orders = read();
    const o = orders.find((x) => x.id === orderId);
    if (o) o.trackingNumber = trackingNumber;
    write(orders);
  },

  // Will Call pickup: record who collected it and when.
  async markPickedUp(orderId, by) {
    const orders = read();
    const o = orders.find((x) => x.id === orderId);
    if (o) { o.pickedUpAt = new Date().toISOString(); o.pickedUpBy = by || null; }
    write(orders);
  },

  // Cancel an order — mark it cancelled (with a reason) but keep the record.
  async cancelOrder(orderId, reason) {
    const orders = read();
    const o = orders.find((x) => x.id === orderId);
    if (o) { o.cancelledAt = new Date().toISOString(); o.cancelReason = reason || null; }
    write(orders);
  },

  // Hard delete (no longer used by the UI; kept for admin/cleanup).
  async deleteOrder(orderId) {
    write(read().filter((o) => o.id !== orderId));
  },

  // ---- custom work orders (Work Order tab) ----
  async getWorkOrders() {
    const list = readWO();
    // Backfill order numbers for any legacy records that predate numbering.
    const missing = list.filter((w) => !w.orderNo);
    if (missing.length) {
      let n = nextWoNoFrom(list);
      missing.sort((a, b) => a.createdAt - b.createdAt).forEach((w) => { w.orderNo = String(n++); });
      writeWO(list);
    }
    return list;
  },

  async createWorkOrder({ type, title, fields, orderNo }) {
    const list = readWO();
    const id = uid();
    const no = orderNo || String(nextWoNoFrom(list));
    list.unshift({ id, orderNo: no, type, title: title || "", fields: fields || {}, done: false, createdAt: Date.now() });
    writeWO(list);
    return id;
  },

  async markWorkOrderDone(id) {
    const list = readWO();
    const w = list.find((x) => x.id === id);
    if (w) w.done = true;
    writeWO(list);
  },

  async updateWorkOrder(id, { title, fields }) {
    const list = readWO();
    const w = list.find((x) => x.id === id);
    if (w) {
      if (title !== undefined) w.title = title;
      if (fields !== undefined) w.fields = fields;
    }
    writeWO(list);
  },
};
