// Supabase adapter — the real backend. Postgres for persistence, RLS for
// access control, realtime for the shared live board. Multi-step writes go
// through SQL functions (see supabase/migrations) so they're atomic and
// concurrency-safe across users.

import { supabase } from "../supabase.js";
import { noteStamp, noteAuthorName, addAmounts, amountShort } from "../../theme.js";

// Who is writing. Read from the session rather than passed down through the
// hooks — the adapter is the only layer that touches a note write, and every
// path would otherwise have to remember to forward a name.
async function currentAuthor() {
  try {
    const { data } = await supabase.auth.getUser();
    return noteAuthorName(data && data.user);
  } catch {
    return null;   // never block a save on not knowing who
  }
}

// Merge a noteStamp into an update, using the given column names. Returns the
// patch unchanged when nothing about the note actually changed.
function withNoteStamp(patch, stamp, cols) {
  if (!stamp) return patch;
  const out = { ...patch };
  if (stamp.by !== undefined) out[cols.by] = stamp.by;
  if (stamp.at !== undefined) out[cols.at] = stamp.at;
  if (stamp.editedBy !== undefined) out[cols.editedBy] = stamp.editedBy;
  if (stamp.editedAt !== undefined) out[cols.editedAt] = stamp.editedAt;
  return out;
}

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

// How far back the board loads finished history. Anything still live is loaded
// regardless of age, so this only ever drops orders that are already done and
// gone. A year keeps every plausible "what happened with that one?" lookup on
// the board; without a limit the load grows forever.
const BOARD_WINDOW_DAYS = 365;

let channelSeq = 0; // unique realtime channel names — one channel per subscriber

// DB row (snake_case) -> the normalized in-memory shape the UI consumes.
//
// These three are split apart so realtime can reuse them. A change event carries
// the changed row and nothing else, and mapping it with the SAME function the
// full load uses is the only way the two can't drift apart — a second, subtly
// different copy of this mapping would show wrong values on the board until the
// next full reload, which is exactly the kind of bug nobody reports clearly.
//
// Each maps ONLY its own columns. Children (an item's materials, an order's
// items) are merged in by the caller, because a change event never includes them.
export function mapMaterialRow(m) {
  return {
    id: m.id,
    name: m.name,
    amount: m.amount,               // requested — what the order needs
    orderedQty: m.ordered_qty || null, // what was actually bought
    progress: m.progress || null,      // "being worked on" state, e.g. Quote requested
    progressAt: m.progress_at ? new Date(m.progress_at).getTime() : null,
    progressBy: m.progress_by || null,
    ordered: m.ordered,
    received: m.received,
    orderedBy: m.ordered_by || null,
    vendor: m.vendor || null,
    poNumber: m.po_number || null,
    orderedAt: m.ordered_at || null,
    expectedAt: m.expected_at || null,
    contact: m.contact || null,
    note: m.note || null,
    noteBy: m.note_by || null,
    noteAt: m.note_at || null,
    noteEditedBy: m.note_edited_by || null,
    noteEditedAt: m.note_edited_at || null,
    receivedAt: m.received_at || null,
    receivedQty: m.received_qty || null,
    receivedNote: m.received_note || null,
    forInventory: !!m.for_inventory,
  };
}

export function mapItemRow(it, productPhotos = {}, photoBySku = {}) {
  return {
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
    noteBy: it.note_by || null,
    noteAt: it.note_at || null,
    noteEditedBy: it.note_edited_by || null,
    noteEditedAt: it.note_edited_at || null,
    inProgress: it.in_progress || false,
    stageEnteredAt: it.stage_entered_at ? new Date(it.stage_entered_at).getTime() : null,
  };
}

export function mapOrderRow(row) {
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
    notesBy: row.notes_by || null,
    notesAt: row.notes_at || null,
    notesEditedBy: row.notes_edited_by || null,
    notesEditedAt: row.notes_edited_at || null,
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
    // The official work-order date: when a sheet for this order was FIRST
    // printed. Immutable — every later sheet shows this same date (0054).
    woPrintedAt: row.wo_printed_at || null,
  };
}

// The full-load shape: an order row plus its children, assembled from the same
// per-row mappers realtime uses.
function mapOrder(row, productPhotos = {}, fulfillmentsByOrder = {}, photoBySku = {}, notesBySubject = {}) {
  const items = (row.items || [])
    .slice()
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0) || a.created_at.localeCompare(b.created_at))
    .map((it) => ({
      ...mapItemRow(it, productPhotos, photoBySku),
      events: [], // loaded on demand — see getItemEvents()
      noteLog: notesBySubject[`item:${it.id}`] || [],
      materials: (it.materials || [])
        .slice()
        .sort((a, b) => a.created_at.localeCompare(b.created_at))
        .map((m) => ({ ...mapMaterialRow(m), noteLog: notesBySubject[`material:${m.id}`] || [] })),
    }));
  return {
    ...mapOrderRow(row),
    noteLog: notesBySubject[`order:${row.id}`] || [],
    fulfillments: fulfillmentsByOrder[row.id] || [], // partial pickup/shipment log
    items,
  };
}

// Largest numeric order_no in a table, matching `keep`, across ALL rows — a plain
// select stops at 1000, so we page through with .range() until a short page.
async function maxOrderNo(table, keep) {
  let max = 0;
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from(table).select("order_no").range(from, from + 999);
    fail(error);
    for (const r of data || []) { const n = parseInt(r.order_no, 10); if (!Number.isNaN(n) && keep(n) && n > max) max = n; }
    if (!data || data.length < 1000) break;
  }
  return max;
}

export const supabaseAdapter = {
  needsAuth: true,

  async getOrders() {
    // Try with the item history (item_events). If that table isn't there yet
    // (migration 0013 not run), fall back to loading the board without history
    // so nothing breaks — the timeline just stays empty until the table exists.
    // item_events is deliberately NOT joined here. It's ~14,000 rows and made this
    // query take ~28s / 3.8 MB; the board only needs items.stage_entered_at (0053).
    // Full timelines load on demand via getItemEvents().
    // PAGED. A plain select stops at 1000 rows, and the board had 1767 orders —
    // so the oldest 767 simply weren't there. That's why an old order sometimes
    // "wasn't on the board" and had to be dragged forward by hand.
    //
    // Also WINDOWED, so this can't grow without bound as the years pass: an
    // order is loaded if it arrived within the window OR is still live (nothing
    // in progress is ever hidden, however old it gets). Every order today falls
    // inside the window — the whole board is under three months old — so this
    // changes nothing now; it's the ceiling that stops a 20 MB board later.
    const cutoff = new Date(Date.now() - BOARD_WINDOW_DAYS * 86400000).toISOString();
    const rows = [];
    let error = null;
    for (let from = 0; ; from += 1000) {
      const page = await supabase
        .from("orders")
        .select("*, items(*, materials(*))")
        .or(`received_at.gte.${cutoff},fulfillment.is.null`)
        .order("received_at", { ascending: false })
        .range(from, from + 999);
      if (page.error) { error = page.error; break; }
      const got = page.data || [];
      rows.push(...got);
      if (got.length < 1000) break;
    }
    fail(error);
    const data = rows;
    // Product photo library: a photo remembered per product name fills in for any
    // item that doesn't have its own — this is how Shopify items get matched.
    // Paged + cached; tolerates the table not existing yet (0028).
    const productPhotos = await loadProductPhotos();
    // SKU-keyed photo library (0034): how QuickBooks items get their photo, matched
    // by the SKU in their "Item #:" note. Paged + cached; tolerates the table missing.
    const photoBySku = await loadPhotoBySku();
    // Note log (0057), grouped by subject. Paged for the same reason the
    // fulfillments log is: a plain select silently returns only the first 1000
    // and drops the newest, which for notes would mean the most recent thinking
    // on a job quietly going missing.
    const notesBySubject = {};
    let noteLogAvailable = false;
    for (let from = 0; ; from += 1000) {
      const { data: page, error: nErr } = await supabase
        .from("notes").select("*")
        .order("created_at", { ascending: true, nullsFirst: true })
        .range(from, from + 999);
      if (nErr) break;                       // 0057 not run — fall back below
      noteLogAvailable = true;
      if (!Array.isArray(page) || !page.length) break;
      page.forEach((n) => {
        const key = `${n.subject_type}:${n.subject_id}`;
        (notesBySubject[key] = notesBySubject[key] || []).push({
          id: n.id, body: n.body, author: n.author || null, at: n.created_at || null,
        });
      });
      if (page.length < 1000) break;
    }

    // Partial pickup/shipment log, grouped by order (tolerate the table missing).
    // MUST be paged: this passed 1000 rows and, being sorted oldest-first, the
    // API silently returned the oldest 1000 and dropped the NEWEST ones — so
    // every partial pickup and shipment from the previous week vanished off the
    // board, getting worse by the day. Same 1000-row cap that once halved photo
    // coverage; see loadPaged.
    const fulfillmentsByOrder = {};
    const ff = [];
    for (let from = 0; ; from += 1000) {
      const { data: page } = await supabase.from("fulfillments").select("*")
        .order("created_at", { ascending: true }).range(from, from + 999);
      if (!Array.isArray(page) || !page.length) break;
      ff.push(...page);
      if (page.length < 1000) break;
    }
    ff.forEach((f) => {
      (fulfillmentsByOrder[f.order_id] = fulfillmentsByOrder[f.order_id] || []).push({
        id: f.id, kind: f.kind, person: f.person || null, carrier: f.carrier || null,
        trackingNumber: f.tracking_number || null, note: f.note || null, lines: f.lines || [], at: f.created_at,
      });
    });
        // Before 0057 there is no log, so show the single stored note as one entry.
    // Without this the thread would look empty even though a note exists.
    if (!noteLogAvailable) {
      const seed = (type, id, body, by, at) => {
        if (!body || !String(body).trim()) return;
        notesBySubject[`${type}:${id}`] = [{ id: `legacy-${id}`, body, author: by || null, at: at || null }];
      };
      (data || []).forEach((row) => {
        seed("order", row.id, row.notes, row.notes_by, row.notes_at);
        (row.items || []).forEach((it) => {
          seed("item", it.id, it.note, it.note_by, it.note_at);
          (it.materials || []).forEach((m) => seed("material", m.id, m.note, m.note_by, m.note_at));
        });
      });
    }
    return (data || []).map((row) => mapOrder(row, productPhotos, fulfillmentsByOrder, photoBySku, notesBySubject));
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

  // Can the FLOOR see this queue order? Read it back through the client-free
  // view the monitors use, not through app_settings.
  //
  // The office can write an arrangement the monitor is unable to read: for a
  // year the view named four department keys, so every CNC machine sub-queue
  // (floor_cnc_vf4 and friends) was filtered out on the way to the wall. The
  // drag saved, the monitor never moved, and nothing anywhere said so.
  async arrangementVisibleToFloor(key) {
    const { data, error } = await supabase
      .from("floor_arrangements")
      .select("key")
      .eq("key", key)
      .maybeSingle();
    if (error) return true;          // can't tell — never cry wolf over it
    return !!data;
  },

  // Map one realtime change row into board shape, using the very same mappers
  // the full load uses. Returns null for tables the board can't patch in place
  // (item_events, work_orders, app_settings) — the caller reloads for those.
  //
  // Only the row's OWN columns come back: a change event never carries an item's
  // materials or an order's items, so the caller must merge, not replace.
  mapRealtimeRow(table, row) {
    if (!row || !row.id) return null;
    if (table === "materials") return mapMaterialRow(row);
    if (table === "items") return mapItemRow(row, _productPhotos || {}, _photoBySku || {});
    if (table === "orders") return mapOrderRow(row);
    return null;
  },

  subscribe(cb) {
    // Each subscriber needs its OWN channel: reusing a topic name returns the
    // already-subscribed channel, and adding callbacks to it throws.
    const channel = supabase
      .channel(`board-${++channelSeq}-${Date.now()}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "orders" }, cb)
      .on("postgres_changes", { event: "*", schema: "public", table: "items" }, cb)
      .on("postgres_changes", { event: "*", schema: "public", table: "materials" }, cb)
      // Without this a note posted by one person never reached anyone else's
      // board until they happened to reload. An INSERT isn't patchable in
      // place, so it falls through to a reload, which is what refreshes the log.
      .on("postgres_changes", { event: "*", schema: "public", table: "notes" }, cb)
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
    // Paginate — a plain select caps at 1000 rows, but the board has more, so an
    // un-paginated max returns a STALE number that's already taken (the
    // "orders_active_order_no_unique" error people hit when logging a purchase).
    const max = await maxOrderNo("orders", (n) => n < 100000);
    return String(max ? max + 1 : 1001);
  },

  // Work orders: their own sequence starting at WO 100000.
  async nextWorkOrderNo() {
    const max = await maxOrderNo("work_orders", (n) => n >= 100000);
    return String(max ? max + 1 : 100000);
  },

  // Shop purchases: their OWN sequence starting at 800000, so a purchase never
  // borrows a customer order / invoice / sales-order number (those all sit below
  // 500000: Shopify 33xxx, work orders 1xxxxx, QB SOs 33xxxx, QB invoices 47xxxx).
  async nextPurchaseNo() {
    const max = await maxOrderNo("orders", (n) => n >= 800000);
    return String(max ? max + 1 : 800000);
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
    const p_materials = (materials || []).map((m) => ({ name: m.name, amount: m.amount || null, note: m.note || null, for_inventory: !!m.forInventory }));
    // If the number was taken between opening the form and saving (or a stale
    // count handed us a used one), grab the next free number and retry rather
    // than surfacing the raw unique-constraint error.
    let no = orderNo;
    for (let attempt = 0; attempt < 5; attempt++) {
      const { error } = await supabase.rpc("create_purchase", { p_order: { order_no: no, dept: dept || "Shop" }, p_materials });
      if (!error) return;
      const dup = error.code === "23505" || /orders_active_order_no_unique|duplicate key/i.test(error.message || "");
      if (!dup) fail(error);
      no = await supabaseAdapter.nextPurchaseNo();
    }
    fail({ message: "Couldn't assign a free purchase number after several tries — please try again." });
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

  // One item's timeline, fetched only when someone actually opens it.
  async getItemEvents(itemId) {
    const { data, error } = await supabase
      .from("item_events")
      .select("*")
      .eq("item_id", itemId)
      .order("created_at", { ascending: true });
    if (error) return [];
    return (data || []).map((e) => ({ id: e.id, kind: e.kind, from: e.from_val, to: e.to_val, at: e.created_at }));
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
    // Note authorship — same rule as order notes (0056).
    const bare = { ...upd };   // the same update minus the authorship columns
    if (patch.note !== undefined) {
      const { data: prevIt } = await supabase.from("items").select("note").eq("id", itemId).single();
      const stamp = noteStamp(prevIt && prevIt.note, patch.note, await currentAuthor());
      Object.assign(upd, withNoteStamp({}, stamp,
        { by: "note_by", at: "note_at", editedBy: "note_edited_by", editedAt: "note_edited_at" }));
    }

    let { error } = await supabase.from("items").update(upd).eq("id", itemId);
    // Degrade to the plain update if 0056 hasn't been run — a missing byline
    // must never stop someone saving a note.
    if (error) ({ error } = await supabase.from("items").update(bare).eq("id", itemId));
    fail(error);
    // A pasted photo URL is also remembered for the product (same as an upload).
    if (patch.imageUrl) {
      const { data: r } = await supabase.from("items").select("name").eq("id", itemId).single();
      if (r && r.name) await supabase.from("product_photos").upsert({ name: r.name, image_url: patch.imageUrl });
    }
  },

  // Upload a dropped/selected photo file to Storage and save its URL on the item.
  // Upload a photo for a CUSTOM work order. These aren't order items, so they
  // have no items row to hang an image on — the URL is stored by the caller in
  // the work order's own `fields` JSON. Returns the URL; writes no row itself.
  // Every photo ever uploaded for a subject, newest first.
  //
  // Revert used to rely on remembering the replace within the open sheet, so it
  // vanished the moment you used it and never appeared at all if you reopened
  // the work order later. Uploads are never overwritten — each one lands in the
  // subject's own folder under a timestamped name — so the real history is
  // already on disk and can be read back whenever it's needed.
  async listPhotoHistory(folder) {
    try {
      const { data, error } = await supabase.storage.from("item-photos")
        .list(folder, { limit: 20, sortBy: { column: "name", order: "desc" } });
      if (error || !Array.isArray(data)) return [];
      return data
        .filter((f) => f.name && !f.name.startsWith("."))   // skip the placeholder rows storage adds
        .map((f) => supabase.storage.from("item-photos").getPublicUrl(`${folder}/${f.name}`).data.publicUrl);
    } catch {
      return [];   // history is a convenience; never let it break the sheet
    }
  },

  async uploadWorkOrderPhoto(woId, file) {
    const ext = ((file.name && file.name.split(".").pop()) || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
    const path = `wo/${woId || "new"}/${Date.now()}.${ext}`;
    const { error } = await supabase.storage.from("item-photos").upload(path, file, { upsert: true, contentType: file.type || undefined });
    fail(error);
    return supabase.storage.from("item-photos").getPublicUrl(path).data.publicUrl;
  },

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

  // ---- "Something's wrong" / "I have an idea", from inside the app ----
  //
  // Saved first, emailed second. The row is the record; the mail is only how
  // anyone finds out about it today. A mail that fails must never lose what
  // somebody took the trouble to write.
  async sendFeedback({ kind, body, urgent, context }) {
    const text = String(body || "").trim();
    if (!text) return { ok: false, error: "Nothing to send." };
    const author = await currentAuthor();
    const { data, error } = await supabase
      .from("app_feedback")
      .insert({ kind: kind === "idea" ? "idea" : "problem", body: text, urgent: !!urgent, author, context: context || {} })
      .select("id")
      .single();
    if (error) return { ok: false, error: error.message };

    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess?.session?.access_token;
      if (token) {
        await fetch("/api/feedback-email", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ id: data.id }),
        });
      }
    } catch {
      /* filed either way — see above */
    }
    return { ok: true, id: data.id };
  },

  // ---- Per-job floor notes (typed on the queue page, shown on the monitor) ----
  //
  // Append-only, like every other note on the board: each one is locked with who
  // wrote it and when, and adding to a job means adding another note (0060).
  // Returns { itemId: [{ id, body, author, at }] }, oldest first.
  async getFloorNotes() {
    const { data, error } = await supabase
      .from("floor_note_log")
      .select("id, item_id, body, author, created_at")
      .order("created_at", { ascending: true });
    // 0060 not run yet: fall back to the old single-note table so the queue page
    // still shows what's there rather than looking like the notes were lost.
    if (error) {
      const { data: old } = await supabase.from("floor_notes").select("item_id, note, updated_at");
      const m = {};
      (old || []).forEach((r) => {
        if (r.note) m[r.item_id] = [{ id: `legacy-${r.item_id}`, body: r.note, author: null, at: r.updated_at || null }];
      });
      return m;
    }
    const m = {};
    (data || []).forEach((r) => {
      if (!r.body) return;
      (m[r.item_id] = m[r.item_id] || []).push({ id: r.id, body: r.body, author: r.author || null, at: r.created_at || null });
    });
    return m;
  },
  // Tell the CNC desk a note was written. The endpoint takes these two ids and
  // nothing else — it reads the note and the job back itself, so nothing typed
  // in this browser can become the body of an email from modernstudio.com.
  //
  // Never throws: the note is already saved and locked by the time this runs.
  // A mail that doesn't go out is worth saying out loud, not worth undoing a
  // note for.
  async notifyFloorNote(itemId, noteId) {
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuid.test(String(itemId || "")) || !uuid.test(String(noteId || ""))) return { ok: false, skipped: true };
    try {
      const { data } = await supabase.auth.getSession();
      const token = data?.session?.access_token;
      if (!token) return { ok: false, error: "not signed in" };
      const res = await fetch("/api/floor-note-email", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ itemId, noteId }),
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, error: out.error || `HTTP ${res.status}`, detail: out.detail || null };
      return { ok: true, to: out.to || null };
    } catch (e) {
      return { ok: false, error: String((e && e.message) || e) };
    }
  },

  async addFloorNote(itemId, body) {
    const text = String(body || "").trim();
    if (!text) return null;
    const author = await currentAuthor();
    const { data, error } = await supabase
      .from("floor_note_log")
      .insert({ item_id: itemId, body: text, author })
      .select("id, body, author, created_at")
      .single();
    if (error) fail(error);
    return data ? { id: data.id, body: data.body, author: data.author || null, at: data.created_at || null } : null;
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
    // NOTE: never writes `amount` — that's the REQUESTED quantity and must survive.
    // What was actually ordered goes in its own column.
    const base     = { ordered: true, ordered_by: details.orderedBy || null, vendor: details.vendor || null, po_number: details.poNumber || null };
    // Once it's ordered the "working on it" flag is done — drop it silently.
    supabase.from("materials").update({ progress: null, progress_at: null, progress_by: null }).eq("id", materialId).then(() => {}, () => {});
    const withQty  = { ...base, ordered_qty: details.orderedQty ?? null };
    // ordered_at is an immutable stamp: set to the moment of the action on first
    // mark (details.orderedAt is null), preserved as-is on a later edit.
    const withDates = { ...withQty, ordered_at: details.orderedAt || new Date().toISOString(), expected_at: details.expectedAt || null };
    const full      = { ...withDates, contact: details.contact || null, note: details.note || null };
    // Try the full row, then degrade for DBs missing the 0022 / 0019 / 0015 columns.
    let { error } = await supabase.from("materials").update(full).eq("id", materialId);
    if (error) ({ error } = await supabase.from("materials").update(withDates).eq("id", materialId));
    if (error) ({ error } = await supabase.from("materials").update(withQty).eq("id", materialId));
    if (error) ({ error } = await supabase.from("materials").update(base).eq("id", materialId));
    if (error) ({ error } = await supabase.from("materials").update({ ordered: true }).eq("id", materialId));
    fail(error);
  },

  async setForInventory(materialId, forInventory) {
    const { error } = await supabase.from("materials").update({ for_inventory: !!forInventory }).eq("id", materialId);
    // No-op quietly if the 0027 column isn't there yet (don't show a scary banner).
    if (error && !/for_inventory/.test(error.message || "")) fail(error);
  },

  // Flag a material as actively being worked on (quote requested, etc). Passing
  // null clears it. Stamped with when + who, like every other completed action.
  // Stamp the first print of a work order for this order and return the official
  // date. Calling it again never moves the date — the SQL only writes when the
  // column is still null — so a reprint, another department's sheet, or a single
  // product printed on its own all carry the date of that first print.
  // Returns null if 0054 hasn't been run yet; the sheet then just falls back to
  // today rather than failing the print.
  async markWorkOrderPrinted(orderId) {
    const { data, error } = await supabase.rpc("mark_wo_printed", { p_order_id: orderId });
    if (error) return null;
    return data || null;
  },

  async setMaterialProgress(materialId, progress, meta = {}) {
    const { by = null, note, keepStamp = false } = meta || {};
    // keepStamp: re-opening an existing flag to read or edit its note must not
    // restamp when the quote was requested, or "asked 3 days ago" quietly
    // becomes "just now" and the buyer loses track of how long they've waited.
    const patch = progress
      ? (keepStamp ? { progress } : { progress, progress_at: new Date().toISOString(), progress_by: by })
      : { progress: null, progress_at: null, progress_by: null };
    // The note lives on the material itself, so it's still there when the buyer
    // comes back to mark it ordered. Only written when one was actually given.
    if (note !== undefined) patch.note = note;
    // Note authorship (0056), on the same rule as order and item notes.
    if (note !== undefined) {
      const { data: prevM } = await supabase.from("materials").select("note").eq("id", materialId).single();
      const stamp = noteStamp(prevM && prevM.note, note, await currentAuthor());
      Object.assign(patch, withNoteStamp({}, stamp,
        { by: "note_by", at: "note_at", editedBy: "note_edited_by", editedAt: "note_edited_at" }));
    }
    let { error } = await supabase.from("materials").update(patch).eq("id", materialId);
    // Retry without the authorship columns if 0056 hasn't been run.
    if (error) {
      const bare = { ...patch };
      ["note_by", "note_at", "note_edited_by", "note_edited_at"].forEach((k) => delete bare[k]);
      ({ error } = await supabase.from("materials").update(bare).eq("id", materialId));
    }
    // No-op quietly if 0052 hasn't been run yet.
    if (error && !/progress/.test(error.message || "")) fail(error);
  },

  // Change the purchase details on a material WITHOUT marking it ordered.
  // markOrdered() always sets ordered=true, so bulk-editing a vendor or an
  // expected date on things still being quoted needed its own path — otherwise
  // correcting a vendor would silently claim the material had been bought.
  // Only the fields actually supplied are written; the rest are left alone.
  async updateMaterialFields(materialId, fields = {}) {
    // ordered_qty is here too, so the bulk editor can correct what was actually
    // bought without re-marking a line as ordered. `amount` is never touched —
    // that's the REQUESTED quantity and it has to survive (see 0051).
    const map = { vendor: "vendor", contact: "contact", poNumber: "po_number", expectedAt: "expected_at", orderedQty: "ordered_qty" };
    const upd = {};
    for (const [k, col] of Object.entries(map)) {
      if (fields[k] !== undefined && String(fields[k]).trim() !== "") upd[col] = fields[k];
    }
    if (!Object.keys(upd).length) return;
    const { error } = await supabase.from("materials").update(upd).eq("id", materialId);
    fail(error);
  },

  async unmarkOrdered(materialId) {
    // Flip ordered off but KEEP the vendor / PO / who, so an accidental toggle
    // doesn't lose what was entered — re-marking brings it right back.
    const { error } = await supabase.from("materials").update({ ordered: false }).eq("id", materialId);
    fail(error);
  },

  // Receiving is no longer yes/no. What arrived is added to what had already
  // arrived, and the line only counts as received when that total covers what
  // was ordered — a short delivery stays on the Purchasing list instead of
  // vanishing with 8 of the 20 ft still owed.
  async receiveMaterial(materialId, opts = {}) {
    const { data: cur } = await supabase.from("materials")
      .select("amount, ordered_qty, received_qty, received_note")
      .eq("id", materialId).single();
    const soFar = addAmounts(cur && cur.received_qty, opts.qtyReceived);
    // Can't add them cleanly? Record what was just typed and call it complete.
    // Guessing a shortfall out of amounts we couldn't read would strand lines.
    const totalQty = soFar || opts.qtyReceived || null;
    const short = soFar ? amountShort((cur && (cur.ordered_qty || cur.amount)) || null, soFar) : null;
    const complete = !short;
    // A second delivery's note must not erase the first one's.
    const note = [cur && cur.received_note, opts.note].map((t) => String(t || "").trim()).filter(Boolean).join(" · ") || null;

    // Mark received (+ qty/note); fall back if the 0026 columns aren't there yet.
    let res = await supabase.from("materials")
      .update({ received: complete, received_at: new Date().toISOString(), received_qty: totalQty, received_note: note })
      .eq("id", materialId).select("item_id").single();
    if (res.error) {
      res = await supabase.from("materials").update({ received: complete }).eq("id", materialId).select("item_id").single();
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

  // Add a note. There is no edit and no delete — that's what "locked" means,
  // and the table has no update/delete policy to back it up (0057). Adding to a
  // note means adding ANOTHER note.
  //
  // The subject's own legacy note column is also set to this newest text, so the
  // thirty-odd places that show "the note" (the bell on a purchasing row, the
  // note rail, the mark-ordered pre-fill) keep working untouched.
  // `meta` exists for ONE case: folding a note that only ever lived in the
  // subject's own column into the log, with the authorship and date already
  // recorded for it (0056) rather than today's. Normal notes pass nothing.
  async addNote(subjectType, subjectId, body, meta = {}) {
    const text = String(body || "").trim();
    if (!text) return null;
    const author = meta.author !== undefined ? meta.author : await currentAuthor();
    const row = { subject_type: subjectType, subject_id: subjectId, body: text, author };
    if (meta.at !== undefined) row.created_at = meta.at;   // null = date unknown
    const { data, error } = await supabase.from("notes")
      .insert(row)
      .select("id, body, author, created_at").single();

    // The mirrored column is written either way — it's what the ~30 existing
    // "show me the note" places read.
    const mirror = { order: ["orders", "notes"], item: ["items", "note"], material: ["materials", "note"] }[subjectType];
    if (mirror) {
      await supabase.from(mirror[0]).update({ [mirror[1]]: text }).eq("id", subjectId).then(() => {}, () => {});
    }

    // If 0057 hasn't been run the notes table simply isn't there. Do NOT throw:
    // the old single-note editor has been replaced by this, so throwing would
    // leave no way to write a note at all. Degrade to the mirrored field — one
    // note per subject, exactly as before — and start logging properly the
    // moment the migration lands.
    if (error) return { id: `local-${subjectId}`, body: text, author, at: new Date().toISOString() };
    return data ? { id: data.id, body: data.body, author: data.author || null, at: data.created_at || null } : null;
  },

  async setOrderNotes(orderId, notes, who) {
    // Read the note back first so authorship can tell a NEW note from an edit.
    // One extra round trip on a rare action, in exchange for never mislabelling
    // who wrote something.
    const { data: prev } = await supabase.from("orders").select("notes").eq("id", orderId).single();
    const stamp = noteStamp(prev && prev.notes, notes, who ?? (await currentAuthor()));
    const base = { notes: notes || null };
    const full = withNoteStamp(base, stamp,
      { by: "notes_by", at: "notes_at", editedBy: "notes_edited_by", editedAt: "notes_edited_at" });
    // Falls back to writing just the text if 0056 hasn't been run — a missing
    // byline must never stop someone saving a note.
    let { error } = await supabase.from("orders").update(full).eq("id", orderId);
    if (error) ({ error } = await supabase.from("orders").update(base).eq("id", orderId));
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

  // done=false reopens it — that's how Undo takes back a mis-tapped "Mark done".
  async markWorkOrderDone(id, done = true) {
    const { error } = await supabase.from("work_orders").update({ done: !!done }).eq("id", id);
    fail(error);
  },

  // `type` is the department that makes it. It was missing here, so changing the
  // department on a sheet that had already been saved wrote everything EXCEPT
  // the department — the selector moved, the record didn't.
  async updateWorkOrder(id, { title, fields, type }) {
    const patch = {};
    if (title !== undefined) patch.title = title || "";
    if (fields !== undefined) patch.fields = fields || {};
    if (type !== undefined) patch.type = type;
    const { error } = await supabase.from("work_orders").update(patch).eq("id", id);
    fail(error);
  },

  // ---- low-stock notices (Inventory tab) ----
  async getStockNotices() {
    const { data, error } = await supabase
      .from("stock_notices")
      .select("*")
      .order("created_at", { ascending: false });
    // Tolerate the table not existing yet (0049 not run) — the tab just shows empty.
    if (error) return [];
    return (data || []).map((r) => ({
      id: r.id,
      name: r.name,
      qtyOnHand: r.qty_on_hand || "",
      dept: r.dept || "Shop",
      reportedBy: r.reported_by || "",
      note: r.note || "",
      status: r.status || "open",
      workOrderNo: r.work_order_no || null,
      handledBy: r.handled_by || null,
      handledAt: r.handled_at ? new Date(r.handled_at).getTime() : null,
      createdAt: new Date(r.created_at).getTime(),
    }));
  },

  async createStockNotice({ name, qtyOnHand, dept, reportedBy, note }) {
    const { error } = await supabase.from("stock_notices").insert({
      name: String(name || "").trim(),
      qty_on_hand: qtyOnHand || null,
      dept: dept || "Shop",
      reported_by: reportedBy || null,
      note: note || null,
    });
    fail(error);
  },

  // Marking a notice handled records WHEN and by WHOM — same immutable-stamp rule
  // as everything else. Passing handled=false reopens it (that's Undo's path).
  async setStockNoticeHandled(id, handled = true, { by, workOrderNo } = {}) {
    const patch = handled
      ? { status: "handled", handled_at: new Date().toISOString(), handled_by: by || null, ...(workOrderNo ? { work_order_no: String(workOrderNo) } : {}) }
      : { status: "open", handled_at: null, handled_by: null };
    const { error } = await supabase.from("stock_notices").update(patch).eq("id", id);
    fail(error);
  },

  async deleteStockNotice(id) {
    const { error } = await supabase.from("stock_notices").delete().eq("id", id);
    fail(error);
  },

  // ---- costing / margins ----
  // The costing catalog: EVERY distinct product ever ordered, with the department
  // that makes it. Queried straight from items (paged past the 1000-row cap) so
  // it does NOT inherit the board's "1000 newest orders" limit — that cap was
  // hiding ~474 products from the margins screen.
  async getProductCatalog() {
    const tally = new Map();
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase.from("items").select("name,dept").range(from, from + 999);
      if (error) break;
      for (const r of data || []) {
        const n = (r.name || "").trim();
        if (!n) continue;
        if (!tally.has(n)) tally.set(n, {});
        const t = tally.get(n);
        if (r.dept) t[r.dept] = (t[r.dept] || 0) + 1;
      }
      if (!data || data.length < 1000) break;
    }
    return [...tally.entries()].map(([name, t]) => ({
      name,
      dept: Object.entries(t).sort((a, b) => b[1] - a[1])[0]?.[0] || "Shop",
    }));
  },

  // Returns the whole costing dataset in one go: the input library, the costed
  // products, and their recipe lines. Costs are computed in the UI from the
  // input's CURRENT price, so a price change flows through everywhere at once.
  async getCosting() {
    const [inputs, products, lines] = await Promise.all([
      supabase.from("cost_inputs").select("*").order("name"),
      supabase.from("product_costs").select("*").order("name"),
      supabase.from("product_cost_lines").select("*").order("position"),
    ]);
    // Tolerate the tables not existing yet (0050 not run) — the screen shows empty.
    if (inputs.error || products.error || lines.error) return { inputs: [], products: [], lines: [] };
    return {
      inputs: (inputs.data || []).map((r) => ({
        id: r.id, kind: r.kind, name: r.name, unit: r.unit,
        unitPrice: Number(r.unit_price) || 0, vendor: r.vendor || "", sku: r.sku || "",
        note: r.note || "", priceUpdatedAt: r.price_updated_at ? new Date(r.price_updated_at).getTime() : null,
      })),
      products: (products.data || []).map((r) => ({
        id: r.id, name: r.name, sku: r.sku || "",
        sellPrice: r.sell_price == null ? null : Number(r.sell_price), note: r.note || "",
      })),
      lines: (lines.data || []).map((r) => ({
        id: r.id, productId: r.product_id, inputId: r.input_id,
        qty: Number(r.qty) || 0, note: r.note || "", position: r.position || 0,
      })),
    };
  },

  async saveCostInput(p) {
    const row = {
      kind: p.kind || "material", name: (p.name || "").trim(), unit: p.unit || "each",
      unit_price: Number(p.unitPrice) || 0, vendor: p.vendor || null, sku: p.sku || null, note: p.note || null,
    };
    // Stamp the price change so a buyer can see how current a price is.
    if (p.priceChanged) row.price_updated_at = new Date().toISOString();
    if (p.id) {
      const { error } = await supabase.from("cost_inputs").update(row).eq("id", p.id);
      fail(error);
      return p.id;
    }
    row.price_updated_at = new Date().toISOString();
    const { data, error } = await supabase.from("cost_inputs").insert(row).select("id").single();
    fail(error);
    return data?.id;
  },

  async deleteCostInput(id) {
    const { error } = await supabase.from("cost_inputs").delete().eq("id", id);
    fail(error);
  },

  // Costing a product for the first time creates its row on demand.
  async ensureProductCost(name) {
    const clean = (name || "").trim();
    const { data: found } = await supabase.from("product_costs").select("id").eq("name", clean).maybeSingle();
    if (found?.id) return found.id;
    const { data, error } = await supabase.from("product_costs").insert({ name: clean }).select("id").single();
    fail(error);
    return data?.id;
  },

  async setProductSellPrice(id, sellPrice) {
    const { error } = await supabase
      .from("product_costs")
      .update({ sell_price: sellPrice === "" || sellPrice == null ? null : Number(sellPrice) })
      .eq("id", id);
    fail(error);
  },

  async saveCostLine(l) {
    const row = { product_id: l.productId, input_id: l.inputId || null, qty: Number(l.qty) || 0, note: l.note || null, position: l.position || 0 };
    if (l.id) {
      const { error } = await supabase.from("product_cost_lines").update(row).eq("id", l.id);
      fail(error);
      return l.id;
    }
    const { data, error } = await supabase.from("product_cost_lines").insert(row).select("id").single();
    fail(error);
    return data?.id;
  },

  async deleteCostLine(id) {
    const { error } = await supabase.from("product_cost_lines").delete().eq("id", id);
    fail(error);
  },
};
