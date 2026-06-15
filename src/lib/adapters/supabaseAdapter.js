// Supabase adapter — the real backend. Postgres for persistence, RLS for
// access control, realtime for the shared live board. Multi-step writes go
// through SQL functions (see supabase/migrations) so they're atomic and
// concurrency-safe across users.

import { supabase } from "../supabase.js";

const fail = (error) => {
  if (error) throw new Error(error.message || String(error));
};

let channelSeq = 0; // unique realtime channel names — one channel per subscriber

// DB row (snake_case) -> the normalized in-memory shape the UI consumes.
function mapOrder(row) {
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
      completedBy: it.completed_by,
      imageUrl: it.image_url || null,
      note: it.note || null,
      inProgress: it.in_progress || false,
      materials: (it.materials || [])
        .slice()
        .sort((a, b) => a.created_at.localeCompare(b.created_at))
        .map((m) => ({
          id: m.id,
          name: m.name,
          amount: m.amount,
          ordered: m.ordered,
          received: m.received,
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
    fulfillment: row.fulfillment, // null | 'willcall' | 'shipping'
    location: row.fulfillment_location,
    trackingNumber: row.tracking_number,
    pickedUpAt: row.picked_up_at || null,
    pickedUpBy: row.picked_up_by || null,
    cancelledAt: row.cancelled_at || null,
    cancelReason: row.cancel_reason || null,
    items,
  };
}

export const supabaseAdapter = {
  needsAuth: true,

  async getOrders() {
    const { data, error } = await supabase
      .from("orders")
      .select("*, items(*, materials(*))")
      .order("received_at", { ascending: false });
    fail(error);
    return (data || []).map(mapOrder);
  },

  subscribe(cb) {
    // Each subscriber needs its OWN channel: reusing a topic name returns the
    // already-subscribed channel, and adding callbacks to it throws.
    const channel = supabase
      .channel(`board-${++channelSeq}-${Date.now()}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "orders" }, cb)
      .on("postgres_changes", { event: "*", schema: "public", table: "items" }, cb)
      .on("postgres_changes", { event: "*", schema: "public", table: "materials" }, cb)
      .on("postgres_changes", { event: "*", schema: "public", table: "work_orders" }, cb)
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

  async createOrder({ orderNo, customer, contact, priority, source, willCall, dueDate, items }) {
    const { error } = await supabase.rpc("create_order", {
      p_order: {
        order_no: orderNo,
        customer,
        contact,
        priority: priority || "Normal",
        source: source || "phone",
        will_call: Boolean(willCall),
        due_date: dueDate || null,
      },
      p_items: items.map((it, i) => ({
        name: it.name,
        qty: Number(it.qty) || 1,
        dept: it.dept || "Shop",
        color: it.color || null,
        position: i,
        image_url: it.imageUrl || null,
      })),
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
    if (patch.qty !== undefined) upd.qty = Math.max(1, parseInt(patch.qty, 10) || 1);
    if (patch.color !== undefined) upd.color = patch.color || null;
    if (patch.dept !== undefined) upd.dept = patch.dept;
    if (patch.completedBy !== undefined) upd.completed_by = patch.completedBy || null;
    if (patch.imageUrl !== undefined) upd.image_url = patch.imageUrl || null;
    if (patch.note !== undefined) upd.note = patch.note || null;
    if (patch.inProgress !== undefined) upd.in_progress = !!patch.inProgress;
    const { error } = await supabase.from("items").update(upd).eq("id", itemId);
    fail(error);
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

  async markOrdered(materialId) {
    const { error } = await supabase.from("materials").update({ ordered: true }).eq("id", materialId);
    fail(error);
  },

  async receiveMaterial(materialId) {
    const { error } = await supabase.rpc("receive_material", { p_material_id: materialId });
    fail(error);
  },

  async setPriority(orderId, priority) {
    const { error } = await supabase.from("orders").update({ priority }).eq("id", orderId);
    fail(error);
  },

  async fulfillOrder(orderId, method, location) {
    const { error } = await supabase
      .from("orders")
      .update({ fulfillment: method, fulfillment_location: location, fulfilled_at: new Date().toISOString() })
      .eq("id", orderId);
    fail(error);
  },

  async markShipped(orderId, trackingNumber) {
    const { error } = await supabase
      .from("orders")
      .update({ tracking_number: trackingNumber, shipped_at: new Date().toISOString() })
      .eq("id", orderId);
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
