// QuickBooks Desktop -> board sync, via Conductor (https://conductor.is).
// Pulls recent OPEN sales orders AND invoices and creates matching orders on the
// board (source="QuickBooks"), deduped — same create_order path the Shopify
// webhook uses, so they land in New Orders for triage.
//
// Dedup rules:
//   - skip anything whose order number is already on the board (any source);
//   - a job can start as a sales order and later become an invoice (the numbers
//     differ — SO 3xxxx, invoice 4xxxx). QuickBooks keeps a link between them, so
//     we SKIP an invoice whose originating sales order is already on the board
//     (the sales-order card stays — no duplicate).
//   - card payments skip the SO stage and come straight in as invoices (no link).
//
// Required environment variables (Vercel project settings):
//   CONDUCTOR_SECRET_KEY · CONDUCTOR_END_USER_ID · VITE_SUPABASE_URL · SUPABASE_SECRET_KEY
//
//   GET  /api/conductor-sync  -> DRY-RUN preview: reads QuickBooks, inserts nothing
//   POST /api/conductor-sync  -> commits: inserts new orders (deduped)

const CONDUCTOR_BASE = "https://api.conductor.is/v1/quickbooks-desktop";

export const maxDuration = 60;

// ?shiptoBackfillDays=N runs a one-time pass that fills the ship_to (drop-ship
// recipient) on EXISTING orders from the last N days — no inserts.
export async function GET(request) {
  const params = new URL(request.url).searchParams;
  const inspect = params.get("inspect");
  if (inspect) return inspectOrder(inspect, Math.min(Math.max(Number(params.get("days")) || 12, 2), 40)); // ?inspect=<number>&days=N
  const days = Number(params.get("shiptoBackfillDays") || 0);
  return run({ commit: false, shipToBackfillDays: days });
}

// Read-only diagnostic: pull one invoice/sales-order straight from QuickBooks
// (same fetch the sync uses) and report how many line items it has vs how many
// survive the product filter — so we can tell truncation from over-filtering.
async function inspectOrder(wanted, days = 12) {
  const conductorKey = process.env.CONDUCTOR_SECRET_KEY;
  const endUserId = process.env.CONDUCTOR_END_USER_ID;
  if (!conductorKey || !endUserId) return json(500, { error: "Not configured" });
  const want = String(wanted).trim();
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  let invList, soList;
  try {
    [invList, soList] = await Promise.all([
      fetchTxns("invoices", conductorKey, endUserId, since, "&includeLinkedTransactions=true"),
      fetchTxns("sales-orders", conductorKey, endUserId, since),
    ]);
  } catch (e) {
    return json(e.status ? 502 : 504, { error: "Conductor request failed", detail: (e.detail || String(e)).slice(0, 300) });
  }
  const t = invList.find((x) => refNo(x) === want) || soList.find((x) => refNo(x) === want);
  if (!t) return json(200, { found: false, wanted: want, note: `Not in the last 45 days (invoices ${invList.length}, sales orders ${soList.length}).` });
  const rawLines = t.lines || t.salesOrderLines || t.invoiceLines || t.lineItems || [];
  const mapped = mapItems(t);
  return json(200, {
    found: true,
    number: refNo(t),
    customer: customerOf(t),
    rawLineCount: rawLines.length,
    mappedProductCount: mapped.length,
    rawLines: rawLines.map((ln) => ({ code: ln.item?.fullName || ln.item?.name || null, desc: String(ln.description || ln.memo || "").slice(0, 44), qty: ln.quantity ?? ln.quantityOrdered ?? ln.qty ?? null })),
  });
}

export async function POST(request) {
  const params = new URL(request.url).searchParams;
  const days = Number(params.get("shiptoBackfillDays") || 0);
  // ?commitBacklog=<invoiceNo> hand-commits ONE held-back pre-fix backlog order
  // (bypasses the forward-only guard for just that number). Used to recover a
  // specific dropped order without flushing the whole backlog.
  const commitBacklog = params.get("commitBacklog") || null;
  return run({ commit: true, shipToBackfillDays: days, commitBacklog });
}

// One-off maintenance: remove synced QuickBooks orders so the next sync re-pulls
// them fresh. Only touches source='QuickBooks'. Guarded by ?reset=quickbooks.
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

// --- field helpers (defensive about Conductor's exact shape) ---
const refNo = (t) => String(t.refNumber ?? t.ref_number ?? t.transactionNumber ?? t.id ?? "").trim();
const customerOf = (t) =>
  (t.customer && (t.customer.fullName || t.customer.name)) || t.customerFullName || t.customerName || "QuickBooks customer";
const fromOnlineStore = (t) => !!(t.salesStoreName || t.salesChannelName || t.salesStoreType);
// When the order was created in QuickBooks — a full date+time (createdAt is ISO
// 8601). We deliberately AVOID transactionDate here: it's date-only, so it would
// peg "received" to midnight and make a just-entered order read as many hours
// old. Fall back to the sync time (≈ now, with the 10-min auto-sync) before ever
// using a bare date.
const receivedAtOf = (t) => {
  const created = t.createdAt || t.created_at;
  const ms = created ? new Date(created).getTime() : NaN;
  const nowMs = Date.now();
  // Use QuickBooks' creation time, but NEVER a future one: the office PC's clock
  // can run fast, which would otherwise make a brand-new order read "-53m ago".
  // Cap at the sync time so a fresh order reads "just now" instead.
  return new Date(!isNaN(ms) ? Math.min(ms, nowMs) : nowMs).toISOString();
};

// The drop-ship recipient — QuickBooks' "Ship To" block (Conductor's
// shippingAddress). Line 1 is the recipient name, line 2 the company/venue; the
// rest is the street address. We keep the top two lines = "who it's going to"
// (e.g. "Dylan Michael Petraitis · Nashville Convention & Visitors"). Null when
// there's no separate ship-to.
function shipToOf(t) {
  const a = t.shippingAddress || t.shipAddress || t.shipping_address || {};
  const who = [a.line1, a.line2].map((s) => String(s || "").trim()).filter(Boolean);
  return who.join(" · ") || null;
}

// QuickBooks "Ship Via" — the shipping method (ShipMethodRef), e.g. "UPS Ground"
// or "Will Call". Conductor exposes it as `shipmentMethod` (a ref with fullName);
// tolerate a couple of shapes. Null when none is set.
function shipViaOf(t) {
  const sm = t.shipmentMethod || t.shippingMethod || t.shipMethod || null;
  if (!sm) return null;
  const v = (typeof sm === "string" ? sm : (sm.fullName || sm.name || "")).trim();
  return v || null;
}

// Real product lines only: skip note/blank lines, shipping/freight, financial
// adjustments, and fee/labor charges.
function mapItems(t) {
  const lines = t.lines || t.salesOrderLines || t.invoiceLines || t.lineItems || [];
  return lines
    .filter((ln) => {
      if (!ln.item || !(ln.item.fullName || ln.item.name)) return false;
      const txt = `${ln.item.fullName || ln.item.name} ${ln.description || ln.memo || ""}`.toLowerCase();
      return !/shipping|freight|discount|\bdeposit\b|\brefund\b|store credit|gift ?card|\bpayment\b|\bfee\b|\blabor\b/.test(txt);
    })
    .map((ln, i) => {
      const code = (ln.item.fullName || ln.item.name || "").trim();
      const desc = (ln.description || ln.memo || "").trim();
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
}

// The sales-order number(s) an invoice was created from, via QuickBooks' linked
// transactions. This is how we know an invoice is really a sales order that got
// billed (so we don't add it twice).
function linkedSalesOrders(inv) {
  const lts = inv.linkedTransactions || inv.linked_transactions || [];
  return (Array.isArray(lts) ? lts : [])
    .filter((lt) => /sales.?order/i.test(lt.transactionType || lt.txnType || lt.type || ""))
    .map((lt) => String(lt.refNumber || lt.ref_number || lt.transactionNumber || "").trim())
    .filter(Boolean);
}

// Conductor caps each page at limit=150. With 150+ invoices in the window we'd
// silently lose everything past the first page (QuickBooks returns them roughly
// oldest-first, so the *newest* get dropped). Follow nextCursor until hasMore is
// false so we pull the whole window — for sales orders and invoices alike.
async function fetchTxns(path, conductorKey, endUserId, since, extra = "") {
  const headers = { Authorization: `Bearer ${conductorKey}`, "Conductor-End-User-Id": endUserId };
  const deadline = Date.now() + 50000; // one budget shared across all pages, keeps us under maxDuration
  const out = [];
  let cursor = null;
  for (let page = 0; page < 20; page++) { // hard stop at 20 pages (≈3000 records) as a safety valve
    const qs = `limit=150&transactionDateFrom=${since}${extra}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
    const res = await fetch(`${CONDUCTOR_BASE}/${path}?${qs}`, {
      headers,
      signal: AbortSignal.timeout(Math.max(2000, deadline - Date.now())),
    });
    const text = await res.text();
    if (!res.ok) { const e = new Error("Conductor request failed"); e.status = res.status; e.detail = text.slice(0, 500); throw e; }
    const body = JSON.parse(text);
    if (Array.isArray(body)) return body; // no envelope -> no cursor to follow, behave as before
    const rows = body.data || body.objects || [];
    out.push(...rows);
    cursor = body.nextCursor || body.next_cursor || null;
    const hasMore = body.hasMore ?? body.has_more ?? false;
    if (!hasMore || !cursor || !rows.length) break;
  }
  return out;
}

async function run({ commit, shipToBackfillDays, commitBacklog }) {
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

  // One-time backfill: fill ship_to on existing orders, no inserts.
  if (shipToBackfillDays > 0) return backfillShipTo({ days: shipToBackfillDays, conductorKey, endUserId, url, serviceKey });

  // --- 1. Pull recent sales orders AND invoices (16-day window keeps QB fast) ---
  const since = new Date(Date.now() - 16 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  // One-time backlog guard: when full pagination went live there was a batch of
  // older invoices already sitting in the window that we deliberately don't want
  // backfilled onto the board — only invoices from the switch-over date forward
  // should sync. Floor the invoice window here. max(since, floor) means it quietly
  // reverts to the normal rolling 16-day window once `since` passes the floor.
  // Bumped 2026-07-04 after a duplicate-invoice backlog flooded the board (an
  // offline stretch let ~2 weeks of invoices sync at once). Go forward-only.
  const INVOICE_FLOOR = "2026-07-04";
  const invoiceSince = since > INVOICE_FLOOR ? since : INVOICE_FLOOR;
  let soList, invList;
  try {
    [soList, invList] = await Promise.all([
      fetchTxns("sales-orders", conductorKey, endUserId, since),
      // linkedTransactions isn't returned by default — ask for it so we can tell
      // which invoices came from a sales order already on the board.
      fetchTxns("invoices", conductorKey, endUserId, invoiceSince, "&includeLinkedTransactions=true"),
    ]);
  } catch (e) {
    if (e.status) return json(502, { error: "Conductor request failed", status: e.status, detail: e.detail });
    return json(504, {
      error: "QuickBooks didn't respond",
      hint: "Make sure the office machine running QuickBooks Desktop is on, QuickBooks is open, and the Web Connector is running.",
      detail: String(e).slice(0, 200),
    });
  }

  // --- 2. Map sales orders: open only, real product lines, not a Shopify order ---
  const sos = soList.map((so) => ({
    kind: "so",
    orderNo: refNo(so),
    customer: customerOf(so),
    items: mapItems(so),
    fromOnlineStore: fromOnlineStore(so),
    isOpen: !(so.isFullyInvoiced ?? so.is_fully_invoiced ?? false) && !(so.isManuallyClosed ?? so.is_manually_closed ?? false),
    receivedAt: receivedAtOf(so),
    shipTo: shipToOf(so),
    shipVia: shipViaOf(so),
  })).filter((o) => o.orderNo && o.isOpen && o.items.length && !o.fromOnlineStore);

  // --- 3. Map invoices: real invoices (start with 4), not Shopify, + linked SO ---
  const invs = invList.map((inv) => ({
    kind: "invoice",
    orderNo: refNo(inv),
    customer: customerOf(inv),
    items: mapItems(inv),
    fromOnlineStore: fromOnlineStore(inv),
    receivedAt: receivedAtOf(inv),
    shipTo: shipToOf(inv),
    shipVia: shipViaOf(inv),
    linkedSo: linkedSalesOrders(inv),
  })).filter((o) => o.orderNo && o.orderNo.startsWith("4") && o.items.length && !o.fromOnlineStore);

  // --- 4. Which numbers are already on the board (any source)? ---
  const sb = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" };
  const candidateNos = [...new Set([
    ...sos.map((m) => m.orderNo),
    ...invs.map((m) => m.orderNo),
    ...invs.flatMap((m) => m.linkedSo), // so an invoice's linked SO already on the board is found
  ])];
  const existing = {};
  if (candidateNos.length) {
    const inList = candidateNos.map((n) => `"${String(n).replace(/"/g, "")}"`).join(",");
    const exRes = await fetch(`${url}/rest/v1/orders?select=order_no,source&order_no=in.(${encodeURIComponent(inList)})`, { headers: sb });
    const ex = await exRes.json().catch(() => []);
    if (Array.isArray(ex)) ex.forEach((o) => { existing[o.order_no] = o.source; });
  }

  // --- 5. Dedup ---
  const sosToAdd = sos.filter((m) => !existing[m.orderNo]);
  // Every sales-order number that is (or is about to be) on the board:
  const soNumbersOnBoard = new Set([...Object.keys(existing), ...sosToAdd.map((m) => m.orderNo)]);
  // Skip an invoice only when its originating sales order is ACTUALLY on the
  // board — that SO already represents the job, so the invoice is a duplicate.
  // But if the linked SO is NOT on the board (it was invoiced before the
  // open-SO sync ever caught it, so the SO never landed), the invoice is the
  // order's ONLY record — add it, or the order vanishes entirely. The 7/4
  // invoice floor + the orders unique index keep this from re-flooding: an old
  // backlog can't flush, and exact-number duplicates are rejected outright.
  const soIsOnBoard = (m) => m.linkedSo.some((n) => existing[n]);
  const invLinkedDup = invs.filter((m) => !existing[m.orderNo] && soIsOnBoard(m));
  const invsToAdd = invs.filter((m) => !existing[m.orderNo] && !soIsOnBoard(m));
  const toAdd = [...sosToAdd, ...invsToAdd];

  // --- 5b. Forward-only guard ---
  // The linked-SO dedup above newly recovers invoices whose sales order never
  // landed on the board. We do NOT want the auto-sync to retroactively flush the
  // pre-fix backlog of those, so only COMMIT invoices dated on/after this date.
  // Sales orders are exempt (always current open jobs). The preview still reports
  // the whole held-back backlog so it stays visible and can be hand-recovered via
  // POST ?commitBacklog=<invoiceNo>.
  const COMMIT_INVOICES_FROM = "2026-07-13";
  const heldBackBacklog = invsToAdd.filter((m) => m.receivedAt < COMMIT_INVOICES_FROM);
  const commitBacklogNo = commitBacklog ? String(commitBacklog).trim() : null;
  const toCommit = commitBacklogNo
    ? toAdd.filter((m) => m.orderNo === commitBacklogNo) // hand-pick one held-back order
    : toAdd.filter((m) => m.kind === "so" || m.receivedAt >= COMMIT_INVOICES_FROM);

  // --- Preview (no writes) ---
  if (!commit) {
    return json(200, {
      mode: "preview",
      salesOrders: { pulled: soList.length, eligibleOpen: sos.length, wouldAdd: sosToAdd.length },
      invoices: {
        pulled: invList.length,
        eligible: invs.length,
        alreadyOnBoardByNumber: invs.filter((m) => existing[m.orderNo]).length,
        skippedLinkedToSalesOrder: invLinkedDup.length,
        wouldAdd: invsToAdd.length,
        backlogHeldBack: heldBackBacklog.length, // dated before the forward-only date; won't auto-commit
      },
      wouldAddTotal: toAdd.length,
      committingNow: toAdd.filter((m) => m.kind === "so" || m.receivedAt >= COMMIT_INVOICES_FROM).length,
      sample: toAdd.slice(0, 8).map((m) => ({ kind: m.kind, orderNo: m.orderNo, date: m.receivedAt, customer: m.customer, shipVia: m.shipVia, linkedSo: m.linkedSo })),
      // The held-back backlog, in full — every one of these has a linked SO that
      // is NOT on the board (verified against the DB), i.e. genuinely dropped.
      backlog: heldBackBacklog.map((m) => ({ orderNo: m.orderNo, date: m.receivedAt.slice(0, 10), customer: m.customer, linkedSo: m.linkedSo, shipTo: m.shipTo, shipVia: m.shipVia, items: m.items.map((it) => `${it.qty}× ${it.name}`) })),
      note: "Preview only — nothing inserted. Backlog held back by the forward-only guard; recover one via POST ?commitBacklog=<invoiceNo>.",
    });
  }

  // --- Commit: insert the genuinely new orders (forward-only, or one hand-picked
  // backlog order when ?commitBacklog is set) ---
  if (commitBacklogNo && !toCommit.length) {
    return json(200, { mode: "commit", commitBacklog: commitBacklogNo, inserted: 0, note: "That number isn't an eligible, not-yet-on-board order in the current window — nothing to add (it may already be on the board, filtered out, or outside the window)." });
  }
  let inserted = 0, failed = 0, firstError = null;
  for (const m of toCommit) {
    const ins = await fetch(`${url}/rest/v1/rpc/create_order`, {
      method: "POST",
      headers: sb,
      body: JSON.stringify({
        p_order: { order_no: m.orderNo, customer: m.customer, contact: "—", priority: "Normal", source: "QuickBooks", will_call: false, received_at: m.receivedAt },
        p_items: m.items,
      }),
    });
    if (ins.ok) {
      inserted++;
      // Stamp ship-to + invoiced status on the order we just created. An order
      // that came in as an invoice is already invoiced (its number IS the invoice
      // number); a sales order starts un-invoiced. Tolerate the 0031/0032 columns
      // not existing yet.
      const patch = {};
      if (m.shipTo) patch.ship_to = m.shipTo;
      if (m.shipVia) patch.ship_via = m.shipVia;
      if (m.kind === "invoice") { patch.invoiced = true; patch.invoice_number = m.orderNo; }
      if (Object.keys(patch).length) await fetch(`${url}/rest/v1/orders?order_no=eq.${encodeURIComponent(m.orderNo)}&source=eq.QuickBooks`, {
        method: "PATCH", headers: sb, body: JSON.stringify(patch),
      }).catch(() => {});
    }
    else { failed++; if (!firstError) firstError = { status: ins.status, detail: (await ins.text()).slice(0, 400) }; }
  }
  // Auto-mark sales orders as invoiced: an invoice's linkedTransactions point
  // back to its originating SO. If that SO is on the board and not yet invoiced,
  // stamp it invoiced with this invoice's number — so the crew never has to.
  // (Tolerates the 0032 columns not existing yet — a 400 just returns no rows.)
  let salesOrdersInvoiced = 0;
  const links = commitBacklogNo ? [] : invs.flatMap((inv) => inv.linkedSo.map((soNo) => ({ soNo, invNo: inv.orderNo })));
  for (const { soNo, invNo } of links) {
    if (!soNumbersOnBoard.has(soNo)) continue;
    const r = await fetch(`${url}/rest/v1/orders?order_no=eq.${encodeURIComponent(soNo)}&source=eq.QuickBooks&invoiced=is.false`, {
      method: "PATCH", headers: { ...sb, Prefer: "return=representation" },
      body: JSON.stringify({ invoiced: true, invoice_number: invNo }),
    }).then((x) => (x.ok ? x.json().catch(() => []) : [])).catch(() => []);
    if (Array.isArray(r) && r.length) salesOrdersInvoiced += r.length;
  }

  return json(200, {
    mode: "commit",
    committed: commitBacklogNo ? `backlog ${commitBacklogNo}` : "forward-only",
    salesOrdersAdded: toCommit.filter((m) => m.kind === "so").length,
    invoicesAdded: toCommit.filter((m) => m.kind === "invoice").length,
    invoicesSkippedAsSalesOrderDup: invLinkedDup.length,
    backlogHeldBack: commitBacklogNo ? undefined : heldBackBacklog.length,
    salesOrdersInvoiced,
    inserted, failed, firstError,
  });
}

// One-time pass: pull the last N days of sales orders + invoices and fill the
// drop-ship recipient (ship_to) on EXISTING QuickBooks orders that don't have it
// yet. No inserts, no dedup — just backfill. Run once after deploy.
async function backfillShipTo({ days, conductorKey, endUserId, url, serviceKey }) {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  let soList, invList;
  try {
    [soList, invList] = await Promise.all([
      fetchTxns("sales-orders", conductorKey, endUserId, since),
      fetchTxns("invoices", conductorKey, endUserId, since),
    ]);
  } catch (e) {
    return json(e.status ? 502 : 504, { error: "Conductor request failed", status: e.status, detail: (e.detail || String(e)).slice(0, 300) });
  }
  // order_no -> { to, via } (first non-empty wins; an SO + its invoice share the no.)
  const map = new Map();
  for (const t of [...soList, ...invList]) {
    const no = refNo(t);
    if (!no) continue;
    const cur = map.get(no) || { to: null, via: null };
    if (!cur.to) cur.to = shipToOf(t);
    if (!cur.via) cur.via = shipViaOf(t);
    map.set(no, cur);
  }
  const entries = [...map.entries()].filter(([, v]) => v.to || v.via);
  const sb = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json", Prefer: "return=representation" };
  // PATCH one column only where it's still null (don't clobber a manual value).
  const patchNull = (no, col, val) =>
    fetch(`${url}/rest/v1/orders?order_no=eq.${encodeURIComponent(no)}&source=eq.QuickBooks&${col}=is.null`, {
      method: "PATCH", headers: sb, body: JSON.stringify({ [col]: val }),
    }).then((r) => (r.ok ? r.json().catch(() => []) : [])).then((rows) => (Array.isArray(rows) ? rows.length : 0)).catch(() => 0);
  let shipToUpdated = 0, shipViaUpdated = 0;
  for (let i = 0; i < entries.length; i += 20) {
    const res = await Promise.all(entries.slice(i, i + 20).flatMap(([no, v]) => [
      v.to ? patchNull(no, "ship_to", v.to) : Promise.resolve(0),
      v.via ? patchNull(no, "ship_via", v.via) : Promise.resolve(0),
    ]));
    res.forEach((n, idx) => { (idx % 2 === 0 ? shipToUpdated += n : shipViaUpdated += n); });
  }
  return json(200, { mode: "ship-backfill", days,
    withShipTo: entries.filter(([, v]) => v.to).length, shipToUpdated,
    withShipVia: entries.filter(([, v]) => v.via).length, shipViaUpdated });
}

function json(status, b) {
  return new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });
}
