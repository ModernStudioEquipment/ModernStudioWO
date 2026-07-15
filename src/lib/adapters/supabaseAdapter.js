// Supabase adapter — the real backend. Postgres for persistence, RLS for
// access control, realtime for the shared live board. Multi-step writes go
// through SQL functions (see supabase/migrations) so they're atomic and
// concurrency-safe across users.

import { supabase } from "../supabase.js";

const fail = (error) => {
  if (error) throw new Error(error.message || String(error));
};

// An item's SKU: the explicit column if it's set, otherwise parsed from the
// "Item #:" note the QuickBooks sync writes (e.g. "Item #: 013-2410-BZ").
// Reading it from the note means item photos resolve with no per-item write.
function itemSku(it) {
  if (it.sku) return String(it.sku).trim();
  const m = (it.note || "").match(/Item #:\s*(\S+)/);
  return m ? m[1] : null;
}

// item_photos / product_photos can exceed the API's 1000-row page cap, so page
// through all of it. Each is cached after its first non-empty load (the libraries
// change only when photos are added); an empty/missing-table result isn't cached,
// so it retries on the next load.
async function loadPaged(table, keyCol, lower) {
  const map = {};
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from(table).select(`${keyCol},image_url`).range(from, from + 999);
    if (error || !Array.isArray(data) || !data.length) break;
    data.forEach((r) => { const k = r[keyCol]; if (k != null) map[lower ? String(k).toLowerCase() : k] = r.image_url; });
    if (data.length < 1000) break;
  }
  return map;
}
let _photoBySku = null, _productPhotos = null;
async function loadPhotoBySku() {
  if (_photoBySku) return _photoBySku;
  const m = await loadPaged("item_photos", "sku", true);
  if (Object.keys(m).length) _photoBySku = m;
  return m;
}
async function loadProductPhotos() {
  if (_productPhotos) return _productPhotos;
  const m = await loadPaged("product_photos", "name", false);
  if (Object.keys(m).length) _productPhotos = m;
  return m;
}

let channelSeq = 0; // unique realtime channel names — one channel per subscriber

// DB row (snake_case) -> the normalized in-memory shape the UI consumes.
function mapOrder(row, productPhotos = {}, fulfillmentsByOrder = {}, photoBySku = {}) {
  const items = (row.items || [])
    .slice()
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0) || a.created_at.localeCompare(b.created_at))
    .map((it) => ({
      id: it.id,
      name: it.name,
      qty: it.qty,
      dept: it.dept,
      color: it.color,
      stage: it.stage,
      needsMaterial: it.needs_material,
      fulfilledQty: it.fulfilled_qty || 0,
      completedBy: it.completed_by,
      sku: itemSku(it),
      imageUrl: it.image_url || photoBySku[(itemSku(it) || "").toLowerCase()] || productPhotos[it.name] || null,
      note: it.note || null,
      inProgress: it.in_progress || false,
      events: (it.item_events || [])
        .slice()
        .sort((a, b) => a.created_at.localeCompare(b.created_at))
        .map((e) => ({ id: e.id, kind: e.kind, from: e.from_val, to: e.to_val, at: e.created_at })),
      materials: (it.materials || [])
        .slice()
        .sort((a, b) => a.created_at.localeCompare(b.created_at))
        .map((m) => ({
          id: m.id,
          name: m.name,
          amount: m.amount,
          ordered: m.ordered,
          received: m.received,
          orderedBy: m.ordered_by || null,
          vendor: m.vendor || null,
          poNumber: m.po_number || null,
          orderedAt: m.ordered_at || null,
          expectedAt: m.expected_at || null,
          contact: m.contact || null,
          note: m.note || null,
          receivedQty: m.received_qty || null,
          receivedNote: m.received_note || null,
          forInventory: !!m.for_inventory,
        })),
    }));
  return {
    id: row.id,
    orderNo: row.order_no,
    customer: row.customer,
    contact: row.contact,
    receivedAt: new Date(row.received_at).getTime(),
    priority: row.priority,
    source: row.source,
    willCall: row.will_call,
    dueDate: row.due_date || null,
    dueTime: row.due_time || null,
    completionDate: row.completion_date || null, // shop's estimated ready-by date
    notes: row.notes || null,
    shipTo: row.ship_to || null, // drop-ship recipient (who it's really going to)
    shipVia: row.ship_via || null, // shipping method ("Ship Via" from QB / Shopify line)
    invoiced: !!row.invoiced, // QB: came in as / been marked an invoice
    invoiceNumber: row.invoice_number || null,
    fulfillmentMethod: row.fulfillment_method || null, // chosen at intake; sticks to the order
    fulfillment: row.fulfillment, // null | 'willcall' | 'shipping'
    fulfilledAt: row.fulfilled_at || null,
    location: row.fulfillment_location,
    trackingNumber: row.tracking_number,
    carrier: row.carrier || null,
    shipNotes: row.ship_notes || null,
    pickedUpAt: row.picked_up_at || null,
    pickedUpBy: row.picked_up_by || null,
    cancelledAt: row.cancelled_at || null,
    cancelReason: row.cancel_reason || null,
    fulfillments: fulfillmentsByOrder[row.id] || [], // partial pickup/shipment log
    items,
  };
}

export const supabaseAdapter = {
  needsAuth: true,

  async getOrders() {
    // Try with the item history (item_events). If that table isn't there yet
    // (migration 0013 not run), fall back to loading the board without history
    // so nothing breaks — the timeline just stays empty until the table exists.
    let { data, error } = await supabase
      .from("orders")
      .select("*, items(*, materials(*), item_events(*))")
      .order("received_at", { ascending: false });
    if (error) {
      ({ data, error } = await supabase
        .from("orders")
        .select("*, items(*, materials(*))")
        .order("received_at", { ascending: false }));
    }
    fail(error);
    // Product photo library: a photo remembered per product name fills in for any
    // item that doesn't have its own — this is how Shopify items get matched.
    // Paged + cached; tolerates the table not existing yet (0028).
    const productPhotos = await loadProductPhotos();
    // SKU-keyed photo library (0034): how QuickBooks items get their photo, matched
    // by the SKU in their "Item #:" note. Paged + cached; tolerates the table missing.
    const photoBySku = await loadPhotoBySku();
    // Partial pickup/shipment log, grouped by order (tolerate the table missing).
    const fulfillmentsByOrder = {};
    const { data: ff } = await supabase.from("fulfillments").select("*").order("created_at", { ascending: true });
    if (Array.isArray(ff)) ff.forEach((f) => {
      (fulfillmentsByOrder[f.order_id] = fulfillmentsByOrder[f.order_id] || []).push({
        id: f.id, kind: f.kind, person: f.person || null, carrier: f.carrier || null,
        trackingNumber: f.tracking_number || null, note: f.note || null, lines: f.lines || [], at: f.created_at,
      });
    });
    return (data || []).map((row) => mapOrder(row, productPhotos, fulfillmentsByOrder, photoBySku));
  },

  // Record one partial pickup/shipment (atomic SQL fn: log it, add the quantities
  // to each item, and complete the order if everything's now out).
  async recordFulfillment(orderId, { kind, person, carrier, tracking, note, lines }) {
    const { error } = await supabase.rpc("record_fulfillment", {
      p_order_id: orderId, p_kind: kind, p_person: person || null, p_carrier: carrier || null,
      p_tracking: tracking || null, p_note: note || null, p_lines: lines || [],
    });
    fail(error);
  },

  // Shared "manual order" of the Orders tab — a single JSON row in app_settings
  // (key "orders_manual") holding the order-id sequence the whole crew sees.
  // Realtime on app_settings (0035) pushes a reorder to every open board.
  // Tolerates the table not existing yet: reads return [], writes no-op.
  async getArrangement(key = "orders_manual") {
    const { data, error } = await supabase
      .from("app_settings").select("value").eq("key", key).maybeSingle();
    if (error) return [];
    return Array.isArray(data?.value) ? data.value : [];
  },
  async setArrangement(ids, key = "orders_manual") {
    const { error } = await supabase
      .from("app_settings")
      .upsert({ key, value: ids, updated_at: new Date().toISOString() }, { onConflict: "key" });
    if (error && error.code !== "42P01") fail(error); // 42P01 = table missing (migration not run yet)
  },

  subscribe(cb) {
    // Each subscriber needs its OWN channel: reusing a topic name returns the
    // already-subscribed channel, and adding callbacks to it throws.
    const channel = supabase
      .channel(`board-${++channelSeq}-${Date.now()}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "orders" }, cb)
      .on("postgres_changes", { event: "*", schema: "public", table: "items" }, cb)
      .on("postgres_changes", { event: "*", schema: "public", table: "materials" }, cb)
      .on("postgres_changes", { event: "*", schema: "public", table: "item_events" }, cb)
      .on("postgres_changes", { event: "*", schema: "public", table: "work_orders" }, cb)
      .on("postgres_changes", { event: "*", schema: "public", table: "app_settings" }, cb)
      .subscribe();
    return () => supabase.removeChannel(channel);
  },

  // Next order number — shared across orders AND custom work orders.
  // Regular orders: their own sequence from 1001 (work-order numbers >= 100000
  // are excluded so the two sequences never collide).
  async nextOrderNo() {
    const o = await supabase.from("orders").select("order_no");
    fail(o.error);
    const nums = (o.data || [])
      .map((r) => parseInt(r.order_no, 10))
      .filter((n) => !Number.isNaN(n) && n < 100000);
    return String(nums.length ? Math.max(...nums) + 1 : 1001);
  },

  // Work orders: their own sequence starting at WO 100000.
  async nextWorkOrderNo() {
    const w = await supabase.from("work_orders").select("order_no");
    fail(w.error);
    const nums = (w.data || [])
      .map((r) => parseInt(r.order_no, 10))
      .filter((n) => !Number.isNaN(n) && n >= 100000);
    return String(nums.length ? Math.max(...nums) + 1 : 100000);
  },

  async createOrder({ orderNo, customer, contact, priority, source, willCall, fulfillmentMethod, dueDate, dueTime, items }) {
    const { error } = await supabase.rpc("create_order", {
      p_order: {
        order_no: orderNo,
        customer,
        contact,
        priority: priority || "Normal",
        source: source || "phone",
        will_call: Boolean(willCall),
        fulfillment_method: fulfillmentMethod || null,
        due_date: dueDate || null,
        due_time: dueTime || null,
      },
      p_items: items.map((it, i) => ({
        name: it.name,
        qty: String(it.qty ?? "").trim() || "1",
        dept: it.dept || "Shop",
        color: it.color || null,
        position: i,
        image_url: it.imageUrl || null,
      })),
    });
    fail(error);
  },

  async createPurchase({ orderNo, dept, materials }) {
    const { error } = await supabase.rpc("create_purchase", {
      p_order: { order_no: orderNo, dept: dept || "Shop" },
      p_materials: (materials || []).map((m) => ({ name: m.name, amount: m.amount || null, note: m.note || null, for_inventory: !!m.forInventory })),
    });
    fail(error);
  },

  async triageItem(itemId, decision) {
    const { error } = await supabase
      .from("items")
      .update({ stage: decision === "instock" ? "picklist" : "workorder", needs_material: false })
      .eq("id", itemId);
    fail(error);
  },

  async addMaterials(itemId, rows) {
    const { error } = await supabase.rpc("triage_need_material", {
      p_item_id: itemId,
      p_materials: rows.map((r) => ({ name: r.name, amount: r.amount })),
    });
    fail(error);
  },

  async finishItem(itemId) {
    const { error } = await supabase.from("items").update({ stage: "done" }).eq("id", itemId);
    fail(error);
  },

  async updateItem(itemId, patch) {
    const upd = {};
    if (patch.name !== undefined) upd.name = patch.name;
    if (patch.qty !== undefined) upd.qty = String(patch.qty ?? "").trim() || "1";
    if (patch.color !== undefined) upd.color = patch.color || null;
    if (patch.dept !== undefined) upd.dept = patch.dept;
    if (patch.completedBy !== undefined) upd.completed_by = patch.completedBy || null;
    if (patch.imageUrl !== undefined) upd.image_url = patch.imageUrl || null;
    if (patch.note !== undefined) upd.note = patch.note || null;
    if (patch.inProgress !== undefined) upd.in_progress = !!patch.inProgress;
    const { error } = await supabase.from("items").update(upd).eq("id", itemId);
    fail(error);
    // A pasted photo URL is also remembered for the product (same as an upload).
    if (patch.imageUrl) {
      const { data: r } = await supabase.from("items").select("name").eq("id", itemId).single();
      if (r && r.name) await supabase.from("product_photos").upsert({ name: r.name, image_url: patch.imageUrl });
    }
  },

  // Upload a dropped/selected photo file to Storage and save its URL on the item.
  async uploadItemPhoto(itemId, file) {
    const ext = (file.name && file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
    const path = `${itemId}/${Date.now()}.${ext}`;
    const { error: upErr } = await supabase.storage.from("item-photos").upload(path, file, { upsert: true, contentType: file.type || undefined });
    fail(upErr);
    const url = supabase.storage.from("item-photos").getPublicUrl(path).data.publicUrl;
    const { data: itemRow, error } = await supabase.from("items").update({ image_url: url }).eq("id", itemId).select("name").single();
    fail(error);
    // Remember this photo for the product so every order with it shows it too.
    if (itemRow && itemRow.name) await supabase.from("product_photos").upsert({ name: itemRow.name, image_url: url });
    return url;
  },

  // ---- Per-job floor notes (typed on the queue page, shown on the monitor) ----
  async getFloorNotes() {
    const { data, error } = await supabase.from("floor_notes").select("item_id, note");
    if (error) return {};
    const m = {};
    (data || []).forEach((r) => {
      if (r.note) m[r.item_id] = r.note;
    });
    return m;
  },
  async setFloorNote(itemId, note) {
    const t = (note || "").trim();
    if (!t) {
      const { error } = await supabase.from("floor_notes").delete().eq("item_id", itemId);
      if (error && error.code !== "42P01") fail(error);
      return;
    }
    const { error } = await supabase
      .from("floor_notes")
      .upsert({ item_id: itemId, note: t, updated_at: new Date().toISOString() }, { onConflict: "item_id" });
    if (error && error.code !== "42P01") fail(error);
  },

  // ---- CNC machine assignment (VF-4 / ST-10 / DS-30SSY) ----
  async getCncMachines() {
    const { data, error } = await supabase.from("cnc_machine").select("item_id, machine");
    if (error) return {};
    const m = {};
    (data || []).forEach((r) => {
      if (r.machine) m[r.item_id] = r.machine;
    });
    return m;
  },
  async setCncMachine(itemId, machine) {
    if (!machine) {
      const { error } = await supabase.from("cnc_machine").delete().eq("item_id", itemId);
      if (error && error.code !== "42P01") fail(error);
      return;
    }
    const { error } = await supabase
      .from("cnc_machine")
      .upsert({ item_id: itemId, machine, updated_at: new Date().toISOString() }, { onConflict: "item_id" });
    if (error && error.code !== "42P01") fail(error);
  },

  // ---- CNC parts library (how-to-make steps + blueprints) ----
  async getCncParts() {
    const { data, error } = await supabase.from("cnc_parts").select("*").order("name");
    if (error) return [];
    return (data || []).map((r) => ({
      id: r.id, sku: r.sku || "", name: r.name || "", steps: Array.isArray(r.steps) ? r.steps : [],
      blueprintUrl: r.blueprint_url || null, material: r.material || "", notes: r.notes || "",
      productNo: r.product_no || "", programNo: r.program_no || "",
    }));
  },
  async saveCncPart(p) {
    const row = {
      name: (p.name || "").trim(), sku: (p.sku || "").trim() || null,
      steps: (p.steps || []).filter((s) => s && s.trim()),
      blueprint_url: p.blueprintUrl || null, material: (p.material || "").trim() || null,
      notes: (p.notes || "").trim() || null, updated_at: new Date().toISOString(),
      product_no: (p.productNo || "").trim() || null, program_no: (p.programNo || "").trim() || null,
    };
    if (p.id) {
      const { data, error } = await supabase.from("cnc_parts").update(row).eq("id", p.id).select("id").single();
      fail(error); return data?.id;
    }
    const { data, error } = await supabase.from("cnc_parts").insert(row).select("id").single();
    fail(error); return data?.id;
  },
  async deleteCncPart(id) {
    const { error } = await supabase.from("cnc_parts").delete().eq("id", id);
    fail(error);
  },
  async uploadBlueprint(partId, file) {
    const ext = (file.name && file.name.split(".").pop() || "png").toLowerCase().replace(/[^a-z0-9]/g, "") || "png";
    const path = `cnc/${partId || "new"}/${Date.now()}.${ext}`;
    const { error: upErr } = await supabase.storage.from("item-photos").upload(path, file, { upsert: true, contentType: file.type || undefined });
    fail(upErr);
    return supabase.storage.from("item-photos").getPublicUrl(path).data.publicUrl;
  },

  // Undo a pick: send a finished item back to the pick list.
  async unpickItem(itemId) {
    const { error } = await supabase.from("items").update({ stage: "picklist" }).eq("id", itemId);
    fail(error);
  },

  // Move an item to any stage (New Orders / Pick List / Work Order / Done).
  // Clears the material flag so it doesn't linger in Purchasing.
  async moveItem(itemId, stage) {
    const { error } = await supabase.from("items").update({ stage, needs_material: false }).eq("id", itemId);
    fail(error);
  },

  async markOrdered(materialId, details = {}) {
    const base     = { ordered: true, ordered_by: details.orderedBy || null, vendor: details.vendor || null, po_number: details.poNumber || null, amount: details.amount ?? null };
    const withDates = { ...base, ordered_at: details.orderedAt || null, expected_at: details.expectedAt || null };
    const full      = { ...withDates, contact: details.contact || null, note: details.note || null };
    // Try the full row, then degrade for DBs missing the 0022 / 0019 / 0015 columns.
    let { error } = await supabase.from("materials").update(full).eq("id", materialId);
    if (error) ({ error } = await supabase.from("materials").update(withDates).eq("id", materialId));
    if (error) ({ error } = await supabase.from("materials").update(base).eq("id", materialId));
    if (error) ({ error } = await supabase.from("materials").update({ ordered: true }).eq("id", materialId));
    fail(error);
  },

  async setForInventory(materialId, forInventory) {
    const { error } = await supabase.from("materials").update({ for_inventory: !!forInventory }).eq("id", materialId);
    // No-op quietly if the 0027 column isn't there yet (don't show a scary banner).
    if (error && !/for_inventory/.test(error.message || "")) fail(error);
  },

  async unmarkOrdered(materialId) {
    // Flip ordered off but KEEP the vendor / PO / who, so an accidental toggle
    // doesn't lose what was entered — re-marking brings it right back.
    const { error } = await supabase.from("materials").update({ ordered: false }).eq("id", materialId);
    fail(error);
  },

  async receiveMaterial(materialId, opts = {}) {
    // Mark received (+ qty/note); fall back if the 0026 columns aren't there yet.
    let res = await supabase.from("materials")
      .update({ received: true, received_qty: opts.qtyReceived || null, received_note: opts.note || null })
      .eq("id", materialId).select("item_id").single();
    if (res.error) {
      res = await supabase.from("materials").update({ received: true }).eq("id", materialId).select("item_id").single();
    }
    fail(res.error);
    const itemId = res.data && res.data.item_id;
    if (!itemId) return;
    // Item leaves Purchasing only once ALL its materials are received — then it
    // moves to the stage chosen in the receive popup (default Work Order).
    const { data: mats } = await supabase.from("materials").select("received").eq("item_id", itemId);
    if (Array.isArray(mats) && mats.every((m) => m.received)) {
      await supabase.from("items").update({ stage: opts.stage || "workorder", needs_material: false }).eq("id", itemId);
    }
  },

  async setPriority(orderId, priority) {
    const { error } = await supabase.from("orders").update({ priority }).eq("id", orderId);
    fail(error);
  },

  async setDueDate(orderId, dueDate, dueTime) {
    let { error } = await supabase.from("orders").update({ due_date: dueDate || null, due_time: dueTime || null }).eq("id", orderId);
    // Fallback if the 0025 due_time column isn't there yet: still set the date.
    if (error) ({ error } = await supabase.from("orders").update({ due_date: dueDate || null }).eq("id", orderId));
    fail(error);
  },

  // The shop's estimated ready-by date (separate from due_date — informational,
  // no urgency). Needs migration 0030; tolerate it not being run yet.
  async setCompletionDate(orderId, completionDate) {
    const { error } = await supabase.from("orders").update({ completion_date: completionDate || null }).eq("id", orderId);
    if (error && !/completion_date/.test(error.message || "")) fail(error);
  },

  // QuickBooks "Invoiced" status + number. Needs migration 0032; tolerate it not
  // being run yet.
  async setInvoiced(orderId, invoiced, invoiceNumber) {
    const { error } = await supabase.from("orders").update({ invoiced: !!invoiced, invoice_number: invoiceNumber || null }).eq("id", orderId);
    if (error && !/invoiced|invoice_number/.test(error.message || "")) fail(error);
  },

  async setFulfillmentMethod(orderId, method) {
    const { error } = await supabase.from("orders").update({ fulfillment_method: method || null }).eq("id", orderId);
    fail(error);
  },

  async setOrderNotes(orderId, notes) {
    const { error } = await supabase.from("orders").update({ notes: notes || null }).eq("id", orderId);
    fail(error);
  },

  // Edit the staged shipping/will-call location after fulfillment (the spot in
  // the warehouse it's staged at). Doesn't touch the fulfillment state itself.
  async setLocation(orderId, location) {
    const { error } = await supabase.from("orders").update({ fulfillment_location: location || null }).eq("id", orderId);
    fail(error);
  },

  async fulfillOrder(orderId, method, location) {
    const { error } = await supabase
      .from("orders")
      .update({ fulfillment: method, fulfillment_location: location, fulfilled_at: new Date().toISOString() })
      .eq("id", orderId);
    fail(error);
  },

  // Pull a partially-fulfilled order back off Will Call / Shipping. Clears the
  // order-level fulfillment (so it leaves the fulfillment board) but NEVER
  // touches fulfilled_qty or the fulfillments log — what already went out stays
  // recorded. With a stage, the not-fully-out items move there to be finished;
  // without one, items stay done and the order returns to the Orders worklist.
  async reopenOrder(orderId, stage = null) {
    let { error } = await supabase
      .from("orders")
      .update({ fulfillment: null, fulfilled_at: null, fulfillment_location: null })
      .eq("id", orderId);
    fail(error);
    if (!stage) return;
    const { data: items } = await supabase.from("items").select("id,qty,fulfilled_qty").eq("order_id", orderId);
    const numQty = (q) => Math.max(parseInt(q, 10) || 1, 1);
    const ids = (items || []).filter((it) => (it.fulfilled_qty || 0) < numQty(it.qty)).map((it) => it.id);
    if (ids.length) {
      ({ error } = await supabase.from("items").update({ stage }).in("id", ids));
      fail(error);
    }
  },

  async markShipped(orderId, { tracking, carrier, notes } = {}) {
    const shippedAt = new Date().toISOString();
    let { error } = await supabase
      .from("orders")
      .update({ tracking_number: tracking, carrier: carrier || null, ship_notes: notes || null, shipped_at: shippedAt })
      .eq("id", orderId);
    if (error) {
      // Fallback if the 0021 carrier/ship_notes columns aren't there yet.
      ({ error } = await supabase.from("orders").update({ tracking_number: tracking, shipped_at: shippedAt }).eq("id", orderId));
    }
    fail(error);
  },

  // Will Call pickup: record who collected it and when.
  async markPickedUp(orderId, by) {
    const { error } = await supabase
      .from("orders")
      .update({ picked_up_at: new Date().toISOString(), picked_up_by: by || null })
      .eq("id", orderId);
    fail(error);
  },

  // Cancel an order — mark it cancelled (with a reason) but keep the record.
  async cancelOrder(orderId, reason) {
    const { error } = await supabase
      .from("orders")
      .update({ cancelled_at: new Date().toISOString(), cancel_reason: reason || null })
      .eq("id", orderId);
    fail(error);
  },

  // Hard delete (no longer used by the UI; kept for admin/cleanup).
  async deleteOrder(orderId) {
    const { error } = await supabase.from("orders").delete().eq("id", orderId);
    fail(error);
  },

  // ---- custom work orders (Work Order tab) ----
  async getWorkOrders() {
    const { data, error } = await supabase
      .from("work_orders")
      .select("*")
      .order("created_at", { ascending: false });
    fail(error);
    return (data || []).map((r) => ({
      id: r.id,
      orderNo: r.order_no,
      type: r.type,
      title: r.title,
      fields: r.fields || {},
      done: r.done,
      createdAt: new Date(r.created_at).getTime(),
    }));
  },

  async createWorkOrder({ type, title, fields, orderNo }) {
    const order_no = orderNo || (await supabaseAdapter.nextWorkOrderNo());
    const { data, error } = await supabase
      .from("work_orders")
      .insert({ order_no, type, title: title || "", fields: fields || {} })
      .select("id")
      .single();
    fail(error);
    return data?.id;
  },

  async markWorkOrderDone(id) {
    const { error } = await supabase.from("work_orders").update({ done: true }).eq("id", id);
    fail(error);
  },

  async updateWorkOrder(id, { title, fields }) {
    const patch = {};
    if (title !== undefined) patch.title = title || "";
    if (fields !== undefined) patch.fields = fields || {};
    const { error } = await supabase.from("work_orders").update(patch).eq("id", id);
    fail(error);
  },
};
