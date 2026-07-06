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
    return [];
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

// SKU -> product photo, for items that don't carry their own image_url.
export async function fetchFloorPhotos() {
  if (!floorClient) return {};
  const { data, error } = await floorClient
    .from("floor_item_photos")
    .select("sku, image_url");
  if (error) return {};
  const map = {};
  (data || []).forEach((r) => {
    if (r.sku) map[r.sku] = r.image_url;
  });
  return map;
}
