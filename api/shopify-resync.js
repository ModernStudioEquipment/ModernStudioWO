// Re-load ONE Shopify order onto the board.
//
// The Shopify webhook only ever fires on order CREATION, and it de-dupes on
// order number — so if a customer or the office edits the order afterwards
// (swaps a variant, changes a quantity, adds or removes a line), the board keeps
// showing what was ordered originally and nothing ever corrects it. This is the
// same gap the QuickBooks re-sync closes, on the other intake path.
//
//   GET  /api/shopify-resync?order=34084   preview — computes the plan, WRITES NOTHING
//   POST /api/shopify-resync?order=34084   apply that plan to that one order
//
// Deliberately manual and deliberately scoped to a single order: the person
// clicking it knows they just edited it in Shopify, which is information this
// code cannot derive on its own.
//
// Env (same names the webhook and the backfill script already use):
//   SHOPIFY_STORE / SHOPIFY_SHOP_DOMAIN, SHOPIFY_ADMIN_TOKEN (needs read_orders),
//   SHOPIFY_API_VERSION (optional), VITE_SUPABASE_URL, SUPABASE_SECRET_KEY

export async function GET(request) {
  return resync(orderParam(request), false);
}

export async function POST(request) {
  return resync(orderParam(request), true);
}

const orderParam = (request) => {
  const p = new URL(request.url).searchParams;
  return String(p.get("order") || p.get("resync") || "").trim();
};

async function resync(orderNo, commit) {
  if (!orderNo) return json(400, { error: "Re-sync needs an order number." });

  const store = process.env.SHOPIFY_STORE || process.env.SHOPIFY_SHOP_DOMAIN;
  const token = process.env.SHOPIFY_ADMIN_TOKEN;
  const version = process.env.SHOPIFY_API_VERSION || "2025-10";
  const url = process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SECRET_KEY;

  const missing = [
    !store && "SHOPIFY_STORE",
    !token && "SHOPIFY_ADMIN_TOKEN",
    !url && "VITE_SUPABASE_URL",
    !serviceKey && "SUPABASE_SECRET_KEY",
  ].filter(Boolean);
  if (missing.length) {
    return json(503, { error: `Shopify re-sync isn't configured yet — missing ${missing.join(", ")} in the Vercel project settings.` });
  }

  const sb = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" };

  // --- 1. The board's copy. Shopify orders only, never a cancelled one. -----
  const boardRows = await fetch(
    `${url}/rest/v1/orders?select=id,order_no,source,customer,received_at,items(id,name,qty,note,stage,in_progress,completed_by,needs_material,position)&order_no=eq.${encodeURIComponent(orderNo)}&cancelled_at=is.null`,
    { headers: sb }
  ).then((r) => r.json()).catch(() => []);
  const bo = Array.isArray(boardRows) ? boardRows[0] : null;
  if (!bo) return json(404, { error: `Order ${orderNo} isn't on the board.` });
  if (bo.source !== "Shopify") {
    return json(400, { error: `Order ${orderNo} didn't come from Shopify (source: ${bo.source}).` });
  }

  // --- 2. The same order in Shopify, right now. ----------------------------
  // status=any so a closed/archived/cancelled order still comes back — the whole
  // point is to read whatever Shopify holds today, not whatever is still open.
  let sh;
  try {
    const res = await fetch(
      `https://${store}/admin/api/${version}/orders.json?name=${encodeURIComponent(orderNo)}&status=any&limit=10`,
      { headers: { "X-Shopify-Access-Token": token }, signal: AbortSignal.timeout(20000) }
    );
    if (!res.ok) {
      const body = (await res.text().catch(() => "")).slice(0, 200);
      if (res.status === 401 || res.status === 403) {
        return json(502, { error: `Shopify rejected the credentials (${res.status}). The Admin API token needs the read_orders scope — and read_all_orders for orders older than 60 days.` });
      }
      return json(502, { error: `Shopify returned ${res.status}. ${body}` });
    }
    const body = await res.json();
    // The name filter is a search, not an exact lookup, so confirm the match
    // ourselves — "#34084" and "34084" both need to resolve to this one order,
    // and a near-miss must never be treated as the real thing.
    const want = normNo(orderNo);
    sh = (body.orders || []).find((o) => normNo(o.order_number) === want || normNo(o.name) === want);
  } catch (e) {
    return json(502, { error: e?.name === "TimeoutError" ? "Shopify didn't respond within 20s." : `Couldn't reach Shopify: ${String(e?.message || e)}` });
  }
  if (!sh) {
    return json(404, { error: `${orderNo} wasn't found in Shopify. It may have been deleted there, or it's older than 60 days and the token lacks read_all_orders.` });
  }

  // --- 3. What Shopify says the order contains now. ------------------------
  // Line items removed by an order edit, or fully refunded, come back with
  // current_quantity 0 — treat those as gone rather than as quantity-0 lines.
  const shopItems = (sh.line_items || [])
    .map((li) => ({ name: lineName(li), qty: effectiveQty(li), imageProduct: li.product_id || null }))
    .filter((li) => li.qty > 0);

  // --- 4. Pair board items to Shopify lines. -------------------------------
  const { add: toAdd, update: toUpdate, remove: toRemove } = planChanges(bo.items || [], shopItems);

  const plan = {
    orderNo, kind: "order", source: "Shopify", customer: bo.customer,
    boardItems: (bo.items || []).length, sourceItems: shopItems.length,
    add: toAdd.map((it) => ({ name: it.name, qty: it.qty })),
    update: toUpdate,
    remove: toRemove,
    cancelledInShopify: !!sh.cancelled_at,
    inSync: !toAdd.length && !toUpdate.length && !toRemove.length,
  };

  if (!commit) return json(200, { mode: "resync-preview", ...plan, note: "Nothing was changed. POST the same URL to apply." });

  // --- 5. Apply — only to this one order. ----------------------------------
  let added = 0, updated = 0, removed = 0;
  let firstError = null;
  if (toAdd.length) {
    // Append after the highest existing position, not after the item COUNT —
    // positions go sparse once items have been removed, and reusing one would
    // make the new line sort on top of an existing one.
    const start = Math.max(-1, ...(bo.items || []).map((it) => Number(it.position) || 0)) + 1;
    const rows = toAdd.map((it, i) => ({
      order_id: bo.id, name: it.name, qty: String(it.qty), dept: "Shop", stage: "new", position: start + i,
    }));
    const res = await fetch(`${url}/rest/v1/items`, { method: "POST", headers: sb, body: JSON.stringify(rows) });
    if (res.ok) added = rows.length; else firstError = { where: "add", detail: (await res.text()).slice(0, 300) };
  }
  for (const u of toUpdate) {
    const res = await fetch(`${url}/rest/v1/items?id=eq.${u.id}`, { method: "PATCH", headers: sb, body: JSON.stringify(u.to) });
    if (res.ok) updated++; else if (!firstError) firstError = { where: "update", detail: (await res.text()).slice(0, 300) };
  }
  for (const r of toRemove) {
    const res = await fetch(`${url}/rest/v1/items?id=eq.${r.id}`, { method: "DELETE", headers: sb });
    if (res.ok) removed++; else if (!firstError) firstError = { where: "remove", detail: (await res.text()).slice(0, 300) };
  }
  return json(200, { mode: "resync", orderNo, added, updated, removed, firstError });
}

// --- The part that can destroy work, kept pure so it can be tested ---------
//
// TWO PASSES, same reasoning as the QuickBooks re-sync: with a single key an
// edited line comes out as a delete + re-add, which throws away everything
// logged against the existing item. So pair the certain matches first, and only
// then try to recognise edited lines among whatever is left over. Anything
// still unpaired at the end is a genuine addition or removal.
//
// boardItems: rows from `items`.  shopItems: {name, qty} from Shopify.
export function planChanges(boardItems, shopItems) {
  const norm = (s) => String(s || "").trim().toLowerCase().replace(/\s+/g, " ");
  // Shopify names are written "Product — Variant", so the part before the dash
  // is the product. A variant swap — the common edit, "Without Frame" to "With
  // Frame" — leaves it identical, which is exactly what pass 2 recognises.
  const base = (s) => norm(s).split("—")[0].trim();
  const worked = (it) => !!(it.in_progress || it.completed_by || it.stage === "done" || it.needs_material);

  const boardLeft = [...boardItems];
  const shopLeft = [...shopItems];
  const pairs = [];
  const take = (matchFn) => {
    for (let i = shopLeft.length - 1; i >= 0; i--) {
      const shIt = shopLeft[i];
      const j = boardLeft.findIndex((b2) => matchFn(b2, shIt));
      if (j >= 0) { pairs.push([boardLeft[j], shIt]); boardLeft.splice(j, 1); shopLeft.splice(i, 1); }
    }
  };
  take((b2, s2) => norm(b2.name) === norm(s2.name));                   // 1: unchanged line
  take((b2, s2) => base(b2.name) && base(b2.name) === base(s2.name));  // 2: same product, new variant

  const update = [];
  for (const [cur, shIt] of pairs) {
    const patch = {};
    if (String(cur.name || "") !== String(shIt.name || "")) patch.name = shIt.name;
    if (String(cur.qty ?? "") !== String(shIt.qty ?? "")) patch.qty = String(shIt.qty);
    if (Object.keys(patch).length) update.push({ id: cur.id, from: { name: cur.name, qty: cur.qty }, to: patch });
  }

  return {
    add: shopLeft,
    update,
    remove: boardLeft.map((it) => ({ id: it.id, name: it.name, qty: it.qty, hasWork: worked(it), stage: it.stage })),
  };
}

// --- shared with the webhook's mapping (see shopifyResync.test.js, which fails
//     if api/shopify-webhook.js ever starts naming or counting lines differently) ---

// "Product — Variant" when there's a variant, otherwise just the title. Must
// match the webhook exactly or every line would look renamed on the first re-sync.
export function lineName(li) {
  return li.variant_title ? `${li.title} — ${li.variant_title}` : li.title;
}

// What's actually still on the order. current_quantity accounts for refunds and
// order edits; Shopify omits it on older/simple orders, so fall back to quantity.
export function effectiveQty(li) {
  const cur = li.current_quantity;
  if (typeof cur === "number") return cur;
  return li.quantity || 1;
}

const normNo = (v) => String(v ?? "").replace(/^#/, "").trim().toLowerCase();

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
