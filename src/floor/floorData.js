import { floorClient } from "../lib/floorClient.js";

// Pull the client-free queue for one department. The database only ever returns
// WO# / dept / product / qty / color / photo — there is no customer column to
// fetch (see migrations 0038/0039). Ordering mirrors the office intent:
// RUSH first, then the office-set manual position, then oldest received.
export async function fetchFloorQueue(dbDept) {
  if (!floorClient) return [];
  const { data, error } = await floorClient
    .from("floor_queue")
    .select(
      "item_id, order_no, dept, product, qty, color, sku, image_url, in_progress, is_rush, priority, due_date, received_at, position"
    )
    .eq("dept", dbDept);
  if (error) {
    console.error("floor_queue read failed:", error.message);
    return null; // null = fetch failed (vs [] = genuinely empty), so the monitor can show "reconnecting"
  }
  return (data || []).slice().sort(
    (a, b) =>
      Number(b.is_rush) - Number(a.is_rush) ||
      (a.position ?? 0) - (b.position ?? 0) ||
      new Date(a.received_at) - new Date(b.received_at)
  );
}

// The office-set order for one department: an array of item ids, top = next.
// Empty until the office has arranged that department's queue.
export async function fetchFloorArrangement(deptKey) {
  if (!floorClient) return [];
  const { data, error } = await floorClient
    .from("floor_arrangements")
    .select("value")
    .eq("key", `floor_${deptKey}`)
    .maybeSingle();
  if (error) return [];
  return Array.isArray(data?.value) ? data.value : [];
}

// Mark the current job done — the floor's one allowed write (RPC 0043).
export async function completeItem(itemId) {
  if (!floorClient) return { ok: true };
  const { error } = await floorClient.rpc("floor_complete_item", { p_item_id: itemId });
  if (error) console.error("floor_complete_item failed:", error.message);
  return { ok: !error };
}

const norm = (s) => (s || "").toLowerCase().replace(/\s+/g, " ").trim();

// CNC make-steps + blueprints, keyed by SKU and by normalized name so the
// monitor can match whatever part is up next.
export async function fetchCncParts() {
  if (!floorClient) return { bySku: {}, byName: {} };
  const { data, error } = await floorClient
    .from("floor_cnc_parts")
    .select("sku, name, steps, blueprint_url, material, notes");
  if (error) return { bySku: {}, byName: {} };
  const bySku = {};
  const byName = {};
  (data || []).forEach((r) => {
    const rec = {
      name: r.name,
      steps: Array.isArray(r.steps) ? r.steps : [],
      blueprint: r.blueprint_url || null,
      material: r.material || "",
      notes: r.notes || "",
    };
    if (r.sku) bySku[r.sku] = rec;
    if (r.name) byName[norm(r.name)] = rec;
  });
  return { bySku, byName };
}

export function matchCncPart(parts, item) {
  if (!parts || !item) return null;
  return (item.sku && parts.bySku[item.sku]) || parts.byName[norm(item.product)] || null;
}

// CNC machine assignment (item_id -> 'vf4' | 'st10' | 'ds30ssy').
export async function fetchCncMachines() {
  if (!floorClient) return {};
  const { data, error } = await floorClient.from("floor_cnc_machine").select("item_id, machine");
  if (error) return {};
  const m = {};
  (data || []).forEach((r) => {
    if (r.machine) m[r.item_id] = r.machine;
  });
  return m;
}

// Per-item floor notes (typed on the queue page), keyed by item_id.
export async function fetchFloorNotes() {
  if (!floorClient) return {};
  const { data, error } = await floorClient.from("floor_item_notes").select("item_id, note");
  if (error) return {};
  const m = {};
  (data || []).forEach((r) => {
    if (r.note) m[r.item_id] = r.note;
  });
  return m;
}

// Fetch matching rows for a set of keys, chunked so a big list doesn't blow the
// URL limit and only pulling the photos we actually need (the libraries have
// thousands of rows — loading them all would hammer the free tier).
async function fetchByKeys(table, col, selectCols, keys) {
  if (!floorClient || !keys.length) return [];
  const uniq = [...new Set(keys.filter(Boolean))];
  const out = [];
  const SIZE = 200;
  for (let i = 0; i < uniq.length; i += SIZE) {
    const { data, error } = await floorClient
      .from(table)
      .select(selectCols)
      .in(col, uniq.slice(i, i + SIZE));
    if (!error && data) out.push(...data);
  }
  return out;
}

// SKU -> photo, only for the SKUs currently on screen.
export async function fetchFloorPhotosFor(skus) {
  const rows = await fetchByKeys("floor_item_photos", "sku", "sku, image_url", skus);
  const map = {};
  rows.forEach((r) => {
    if (r.sku) map[r.sku] = r.image_url;
  });
  return map;
}

// Normalized product-NAME -> photo, only for the names on screen. Matches on the
// `norm` key (migration 0047) so casing/spacing/punctuation differences resolve.
// The fallback when an item has no image and no matching SKU.
export async function fetchFloorProductPhotosFor(names) {
  const rows = await fetchByKeys("floor_product_photos", "norm", "norm, image_url", names.map(norm));
  const map = {};
  rows.forEach((r) => {
    if (r.norm) map[r.norm] = r.image_url;
  });
  return map;
}
