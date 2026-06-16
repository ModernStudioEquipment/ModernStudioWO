// QuickBooks Desktop -> board sync, via Conductor (https://conductor.is).
// Pulls open QuickBooks sales orders and creates matching orders on the board
// (source="QuickBooks"), deduped by order number — same create_order path the
// Shopify webhook uses, so they land in New Orders for triage.
//
// Required environment variables (Vercel project settings):
//   CONDUCTOR_SECRET_KEY    — Conductor secret key (sk_...), server-only
//   CONDUCTOR_END_USER_ID   — the connected QuickBooks end user (end_usr_...)
//   VITE_SUPABASE_URL       — already set (shared with the front end)
//   SUPABASE_SECRET_KEY     — Supabase service key, server-only
//
//   GET  /api/conductor-sync  -> DRY-RUN preview: reads QuickBooks, inserts nothing
//   POST /api/conductor-sync  -> commits: inserts new orders (deduped)

const CONDUCTOR_BASE = "https://api.conductor.is/v1/quickbooks-desktop";

// QuickBooks Desktop reads go through the Web Connector and can take a while;
// give the function room (Vercel caps this per plan).
export const maxDuration = 60;

export async function GET() {
  return run({ commit: false });
}

export async function POST() {
  return run({ commit: true });
}

// One-off maintenance: remove synced QuickBooks orders so the next sync re-pulls
// them fresh (e.g. after a mapping change). Only touches source='QuickBooks'
// orders, which are re-syncable. Guarded by ?reset=quickbooks.
export async function DELETE(request) {
  if (new URL(request.url).searchParams.get("reset") !== "quickbooks") {
    return json(400, { error: "Add ?reset=quickbooks to confirm removing synced QuickBooks orders." });
  }
  const url = process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SECRET_KEY;
  if (!url || !serviceKey) return json(500, { error: "Not configured" });
  const sb = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, Prefer: "return=representation" };
  const res = await fetch(`${url}/rest/v1/orders?source=eq.QuickBooks`, { method: "DELETE", headers: sb });
  const body = await res.json().catch(() => null);
  return json(res.ok ? 200 : 502, { deleted: Array.isArray(body) ? body.length : 0, detail: res.ok ? undefined : body });
}

async function run({ commit }) {
  const conductorKey = process.env.CONDUCTOR_SECRET_KEY;
  const endUserId = process.env.CONDUCTOR_END_USER_ID;
  const url = process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SECRET_KEY;

  const missing = [
    !conductorKey && "CONDUCTOR_SECRET_KEY",
    !endUserId && "CONDUCTOR_END_USER_ID",
    !url && "VITE_SUPABASE_URL",
    !serviceKey && "SUPABASE_SECRET_KEY",
  ].filter(Boolean);
  if (missing.length) return json(500, { error: "Not configured", missing });

  // --- 1. Pull recent invoices from QuickBooks (through Conductor) ---
  // Only recent ones: keeps the QuickBooks query fast (no scanning years of
  // history) and avoids dumping old invoices onto the board.
  const since = new Date(Date.now() - 16 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  let qbRes, qbText;
  try {
    qbRes = await fetch(`${CONDUCTOR_BASE}/invoices?limit=150&transactionDateFrom=${since}`, {
      headers: {
        Authorization: `Bearer ${conductorKey}`,
        "Conductor-End-User-Id": endUserId,
      },
      signal: AbortSignal.timeout(50000),
    });
    qbText = await qbRes.text();
  } catch (e) {
    return json(504, {
      error: "QuickBooks didn't respond",
      hint: "Make sure the office PC running QuickBooks Desktop is on, QuickBooks is open, and the QuickBooks Web Connector is running — Conductor reads QuickBooks live, so that machine has to be reachable.",
      detail: String(e).slice(0, 200),
    });
  }
  if (!qbRes.ok) {
    return json(502, { error: "Conductor request failed", status: qbRes.status, detail: qbText.slice(0, 600) });
  }
  let body;
  try { body = JSON.parse(qbText); } catch { return json(502, { error: "Bad Conductor JSON", detail: qbText.slice(0, 300) }); }
  const list = Array.isArray(body) ? body : (body.data || body.objects || []);

  // --- 2. Map each sales order to our schema (defensive about field names) ---
  const mapped = list.map((so) => {
    const orderNo = String(so.refNumber ?? so.ref_number ?? so.transactionNumber ?? so.id ?? "").trim();
    const customer =
      (so.customer && (so.customer.fullName || so.customer.name)) ||
      so.customerFullName || so.customerName || "QuickBooks customer";
    const lines = so.lines || so.invoiceLines || so.lineItems || [];
    const items = lines
      // Real product lines have an item; skip note/annotation/blank lines, and
      // skip shipping/freight charge lines (not something to pick or make).
      .filter((ln) => {
        if (!ln.item || !(ln.item.fullName || ln.item.name)) return false;
        // Match on the item code only (not the description) so a product whose
        // description happens to mention "discount"/"misc" isn't dropped.
        const code = (ln.item.fullName || ln.item.name || "").toLowerCase();
        // Skip non-product lines: shipping/freight and financial adjustments.
        return !/shipping|freight|discount|\bdeposit\b|\brefund\b|store credit|gift ?card|\bpayment\b/.test(code);
      })
      .map((ln, i) => {
        const code = (ln.item.fullName || ln.item.name || "").trim();
        const desc = (ln.description || ln.memo || "").trim();
        // The description is the real product name — show it on the row. Keep
        // the item number in the note for reference (when it adds anything).
        const name = desc || code || "Item";
        const showCode = code && code !== name && code.toLowerCase() !== "custom item";
        return {
          name,
          note: showCode ? `Item #: ${code}` : null,
          qty: String(ln.quantity ?? ln.quantityOrdered ?? ln.qty ?? 1),
          dept: "Shop",
          color: null,
          position: i,
        };
      });
    // Invoices tagged with an online sales channel/store (e.g. Shopify) already
    // come in through their own webhook — skip them here to avoid duplicates.
    const fromOnlineStore = !!(so.salesStoreName || so.salesChannelName || so.salesStoreType);
    return { orderNo, customer, items, fromOnlineStore };
  }).filter((o) =>
    o.orderNo &&
    o.orderNo.startsWith("4") && // real invoices start with 4; 3xxxx are sales/Shopify orders
    o.items.length &&
    !o.fromOnlineStore
  );

  // --- Dedup: which invoice numbers are already on the board (ANY source)? ---
  // Shopify orders that flow into QuickBooks as invoices share the order number,
  // so matching against any existing order avoids re-adding Shopify (or
  // already-synced) orders. One bulk lookup instead of a query per invoice.
  const sb = {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    "Content-Type": "application/json",
  };
  const nums = [...new Set(mapped.map((m) => m.orderNo))];
  const existingSource = {};
  if (nums.length) {
    const inList = nums.map((n) => `"${String(n).replace(/"/g, "")}"`).join(",");
    const exRes = await fetch(`${url}/rest/v1/orders?select=order_no,source&order_no=in.(${encodeURIComponent(inList)})`, { headers: sb });
    const ex = await exRes.json().catch(() => []);
    if (Array.isArray(ex)) ex.forEach((o) => { existingSource[o.order_no] = o.source; });
  }
  const toAdd = mapped.filter((m) => !existingSource[m.orderNo]);

  // --- Preview (no writes) ---
  if (!commit) {
    return json(200, {
      mode: "preview",
      pulledFromQuickBooks: list.length,
      eligibleInvoices: mapped.length,
      alreadyOnBoard: mapped.length - toAdd.length,
      existingSources: [...new Set(Object.values(existingSource))],
      wouldAdd: toAdd.length,
      allItemNames: [...new Set(toAdd.flatMap((m) => m.items.map((it) => it.name)))].sort(),
      sample: toAdd.slice(0, 6).map((m) => ({
        orderNo: m.orderNo,
        customer: m.customer,
        items: m.items.map((it) => `${it.name} ×${it.qty}`),
      })),
      note: "Preview only — nothing inserted.",
    });
  }

  // --- Commit: insert the genuinely new invoices ---
  let inserted = 0, failed = 0, firstError = null;
  for (const m of toAdd) {
    const ins = await fetch(`${url}/rest/v1/rpc/create_order`, {
      method: "POST",
      headers: sb,
      body: JSON.stringify({
        p_order: {
          order_no: m.orderNo,
          customer: m.customer,
          contact: "—",
          priority: "Normal",
          source: "QuickBooks",
          will_call: false,
        },
        p_items: m.items,
      }),
    });
    if (ins.ok) inserted++;
    else { failed++; if (!firstError) firstError = { status: ins.status, detail: (await ins.text()).slice(0, 400) }; }
  }
  return json(200, { mode: "commit", pulledFromQuickBooks: list.length, eligible: mapped.length, alreadyOnBoard: mapped.length - toAdd.length, inserted, failed, firstError });
}

function json(status, b) {
  return new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });
}
