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

  // --- 1. Pull sales orders from QuickBooks (through Conductor) ---
  let qbRes, qbText;
  try {
    qbRes = await fetch(`${CONDUCTOR_BASE}/sales-orders?limit=50`, {
      headers: {
        Authorization: `Bearer ${conductorKey}`,
        "Conductor-End-User-Id": endUserId,
      },
      signal: AbortSignal.timeout(55000),
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
    const lines = so.lines || so.salesOrderLines || so.lineItems || so.salesOrderLineItems || [];
    const items = lines
      .map((ln, i) => ({
        name: (ln.item && (ln.item.fullName || ln.item.name)) || ln.description || ln.memo || "Item",
        qty: String(ln.quantity ?? ln.quantityOrdered ?? ln.qty ?? 1),
        dept: "Shop",
        color: null,
        position: i,
      }))
      .filter((it) => it.name);
    // Treat as open unless QuickBooks says it's done. Field names vary; default
    // to open when we can't tell, so nothing is silently dropped.
    const open = !(so.isFullyInvoiced || so.isManuallyClosed || so.isClosed);
    return { orderNo, customer, items, open };
  }).filter((o) => o.orderNo && o.items.length && o.open);

  // --- 3a. Preview (no writes) — used to verify the mapping safely ---
  if (!commit) {
    return json(200, {
      mode: "preview",
      pulledFromQuickBooks: list.length,
      eligibleOpenOrders: mapped.length,
      sample: mapped.slice(0, 5).map((m) => ({
        orderNo: m.orderNo,
        customer: m.customer,
        items: m.items.map((it) => `${it.name} ×${it.qty}`),
      })),
      note: "Preview only — nothing inserted. POST to this endpoint to commit.",
    });
  }

  // --- 3b. Commit: dedupe against existing QuickBooks orders, then insert ---
  const sb = {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    "Content-Type": "application/json",
  };
  let inserted = 0, skipped = 0;
  for (const m of mapped) {
    const dupRes = await fetch(
      `${url}/rest/v1/orders?select=id&source=eq.QuickBooks&order_no=eq.${encodeURIComponent(m.orderNo)}&limit=1`,
      { headers: sb }
    );
    const dups = await dupRes.json();
    if (Array.isArray(dups) && dups.length) { skipped++; continue; }

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
    if (ins.ok) inserted++; else skipped++;
  }
  return json(200, { mode: "commit", pulledFromQuickBooks: list.length, eligible: mapped.length, inserted, skipped });
}

function json(status, b) {
  return new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });
}
