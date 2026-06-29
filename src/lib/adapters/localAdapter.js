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

// Product photo library (name -> url): a photo set for a product is remembered
// for every order with that product.
const PHOTO_KEY = "mse_product_photos_v1";
function readPhotos() {
  try { return JSON.parse(localStorage.getItem(PHOTO_KEY) || "{}"); } catch { return {}; }
}
function writePhotos(map) {
  localStorage.setItem(PHOTO_KEY, JSON.stringify(map));
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
      // Snapshot before/after to log history the same way the DB trigger does.
      const before = { stage: it.stage, dept: it.dept, inProgress: !!it.inProgress };
      fn(it, o);
      it.events = it.events || [];
      const at = new Date().toISOString();
      if (it.stage !== before.stage) it.events.push({ id: uid(), kind: "moved", from: before.stage, to: it.stage, at });
      if (!!it.inProgress !== before.inProgress) it.events.push({ id: uid(), kind: "in_progress", from: null, to: String(!!it.inProgress), at });
      if (it.dept !== before.dept) it.events.push({ id: uid(), kind: "dept", from: before.dept, to: it.dept, at });
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
    const orders = read();
    const photos = readPhotos();
    orders.forEach((o) => o.items.forEach((it) => { if (!it.imageUrl && photos[it.name]) it.imageUrl = photos[it.name]; }));
    return orders;
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

  async createOrder({ orderNo, customer, contact, priority, source, willCall, fulfillmentMethod, dueDate, dueTime, items }) {
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
      fulfillmentMethod: fulfillmentMethod || null,
      dueDate: dueDate || null,
      dueTime: dueTime || null,
      fulfillment: null,
      fulfilledAt: null,
      location: null,
      trackingNumber: null,
      pickedUpAt: null,
      pickedUpBy: null,
      cancelledAt: null,
      cancelReason: null,
      items: items.map((it) => ({
        id: uid(),
        name: it.name,
        qty: String(it.qty ?? "").trim() || "1",
        dept: it.dept || "Shop",
        color: it.color || null,
        imageUrl: it.imageUrl || null,
        note: it.note || null,
        stage: "new",
        needsMaterial: false,
        materials: [],
        events: [{ id: uid(), kind: "created", from: null, to: "new", at: new Date().toISOString() }],
      })),
    });
    write(orders);
  },

  async createPurchase({ orderNo, dept, materials }) {
    const orders = read();
    orders.push({
      id: uid(),
      orderNo,
      customer: "Shop purchase",
      contact: "—",
      receivedAt: Date.now(),
      priority: "Normal",
      source: "purchase",
      willCall: false,
      dueDate: null,
      fulfillment: null,
      fulfilledAt: null,
      location: null,
      trackingNumber: null,
      pickedUpAt: null,
      pickedUpBy: null,
      cancelledAt: null,
      cancelReason: null,
      items: [{
        id: uid(),
        name: "Shop purchase",
        qty: "1",
        dept: dept || "Shop",
        color: null,
        imageUrl: null,
        note: null,
        stage: "awaiting",
        needsMaterial: true,
        materials: (materials || []).map((m) => ({
          id: uid(),
          name: m.name,
          amount: m.amount || null,
          ordered: false,
          received: false,
          orderedBy: null,
          vendor: null,
          contact: null,
          poNumber: null,
          orderedAt: null,
          expectedAt: null,
          note: m.note || null,
          forInventory: !!m.forInventory,
        })),
        events: [{ id: uid(), kind: "created", from: null, to: "awaiting", at: new Date().toISOString() }],
      }],
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
        orderedBy: null,
        vendor: null,
        contact: null,
        poNumber: null,
        orderedAt: null,
        expectedAt: null,
        note: null,
        forInventory: false,
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
      if (patch.qty !== undefined) it.qty = String(patch.qty ?? "").trim() || it.qty;
      if (patch.color !== undefined) it.color = patch.color || null;
      if (patch.dept !== undefined) it.dept = patch.dept;
      if (patch.completedBy !== undefined) it.completedBy = patch.completedBy || null;
      if (patch.imageUrl !== undefined) it.imageUrl = patch.imageUrl || null;
      if (patch.note !== undefined) it.note = patch.note || null;
      if (patch.inProgress !== undefined) it.inProgress = !!patch.inProgress;
    });
  },

  // Demo mode: no Storage — read the dropped file as a data URL and stash it.
  async uploadItemPhoto(itemId, file) {
    const url = await new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(file); });
    let name = null;
    mutateItem(itemId, (it) => { it.imageUrl = url; name = it.name; });
    if (name) { const m = readPhotos(); m[name] = url; writePhotos(m); } // remember for the product
    return url;
  },

  // Undo a pick: send a finished item back to the pick list.
  async unpickItem(itemId) {
    mutateItem(itemId, (it) => { it.stage = "picklist"; });
  },

  // Move an item to any stage; clears the material flag so it leaves Purchasing.
  async moveItem(itemId, stage) {
    mutateItem(itemId, (it) => { it.stage = stage; it.needsMaterial = false; });
  },

  async markOrdered(materialId, details = {}) {
    mutateMaterial(materialId, (m) => {
      m.ordered = true;
      if (details.amount !== undefined) m.amount = details.amount || null;
      m.orderedBy = details.orderedBy || null;
      m.vendor = details.vendor || null;
      m.contact = details.contact || null;
      m.poNumber = details.poNumber || null;
      m.orderedAt = details.orderedAt || null;
      m.expectedAt = details.expectedAt || null;
      m.note = details.note || null;
    });
  },

  async setForInventory(materialId, forInventory) {
    mutateMaterial(materialId, (m) => { m.forInventory = !!forInventory; });
  },

  async unmarkOrdered(materialId) {
    // Keep vendor / PO / who so an accidental toggle doesn't lose the info.
    mutateMaterial(materialId, (m) => {
      m.ordered = false;
    });
  },

  // "Receive" / "have it": mark received; if the item was waiting and all of
  // its materials are now in, advance it into Work Order.
  async receiveMaterial(materialId, opts = {}) {
    mutateMaterial(materialId, (m, it) => {
      m.received = true;
      m.receivedQty = opts.qtyReceived || null;
      m.receivedNote = opts.note || null;
      // Item leaves Purchasing once ALL its materials are in, moving to the
      // stage chosen in the receive popup (default Work Order).
      if (it.materials.every((x) => x.received)) {
        it.stage = opts.stage || "workorder";
        it.needsMaterial = false;
      }
    });
  },

  async setPriority(orderId, priority) {
    const orders = read();
    const o = orders.find((x) => x.id === orderId);
    if (o) o.priority = priority;
    write(orders);
  },

  async setDueDate(orderId, dueDate, dueTime) {
    const orders = read();
    const o = orders.find((x) => x.id === orderId);
    if (o) { o.dueDate = dueDate || null; o.dueTime = dueTime || null; }
    write(orders);
  },

  async setFulfillmentMethod(orderId, method) {
    const orders = read();
    const o = orders.find((x) => x.id === orderId);
    if (o) o.fulfillmentMethod = method || null;
    write(orders);
  },

  async setOrderNotes(orderId, notes) {
    const orders = read();
    const o = orders.find((x) => x.id === orderId);
    if (o) o.notes = notes || null;
    write(orders);
  },

  async setLocation(orderId, location) {
    const orders = read();
    const o = orders.find((x) => x.id === orderId);
    if (o) o.location = location || null;
    write(orders);
  },

  // Pull a partially-fulfilled order back off Will Call / Shipping. Clears the
  // order-level fulfillment; keeps fulfilledQty intact. With a stage, the
  // not-fully-out items move there; without one, the order returns to Orders.
  async reopenOrder(orderId, stage = null) {
    const orders = read();
    const o = orders.find((x) => x.id === orderId);
    if (o) {
      o.fulfillment = null;
      o.fulfilledAt = null;
      o.location = null;
      if (stage) {
        const numQty = (q) => Math.max(parseInt(q, 10) || 1, 1);
        (o.items || []).forEach((it) => { if ((it.fulfilledQty || 0) < numQty(it.qty)) it.stage = stage; });
      }
    }
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
      o.fulfilledAt = new Date().toISOString();
    }
    write(orders);
  },

  // Shipping stage 2: record the carrier tracking number (it's out the door).
  async markShipped(orderId, { tracking, carrier, notes } = {}) {
    const orders = read();
    const o = orders.find((x) => x.id === orderId);
    if (o) { o.trackingNumber = tracking; o.carrier = carrier || null; o.shipNotes = notes || null; }
    write(orders);
  },

  async recordFulfillment(orderId, { kind, person, carrier, tracking, note, lines }) {
    const orders = read();
    const o = orders.find((x) => x.id === orderId);
    if (!o) return;
    o.fulfillments = o.fulfillments || [];
    o.fulfillments.push({ id: uid(), kind, person: person || null, carrier: carrier || null, trackingNumber: tracking || null, note: note || null, lines: lines || [], at: new Date().toISOString() });
    (lines || []).forEach((ln) => { const it = o.items.find((i) => i.id === ln.itemId); if (it) it.fulfilledQty = (it.fulfilledQty || 0) + (parseInt(ln.qty, 10) || 0); });
    const allOut = o.items.every((it) => (it.fulfilledQty || 0) >= Math.max(parseInt(it.qty, 10) || 1, 1));
    if (allOut) {
      if (kind === "pickup") { o.pickedUpAt = new Date().toISOString(); o.pickedUpBy = person || null; }
      else { o.trackingNumber = tracking || o.trackingNumber || "shipped"; o.shippedAt = new Date().toISOString(); }
    }
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
