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

export async function GET() {
  return run({ commit: false });
}
export async function POST() {
  return run({ commit: true });
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
const receivedAtOf = (t) => String(t.transactionDate || t.txnDate || t.date || "").slice(0, 10) || null;

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

async function fetchTxns(path, conductorKey, endUserId, since) {
  const res = await fetch(`${CONDUCTOR_BASE}/${path}?limit=150&transactionDateFrom=${since}`, {
    headers: { Authorization: `Bearer ${conductorKey}`, "Conductor-End-User-Id": endUserId },
    signal: AbortSignal.timeout(50000),
  });
  const text = await res.text();
  if (!res.ok) { const e = new Error("Conductor request failed"); e.status = res.status; e.detail = text.slice(0, 500); throw e; }
  const body = JSON.parse(text);
  return Array.isArray(body) ? body : (body.data || body.objects || []);
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

  // --- 1. Pull recent sales orders AND invoices (16-day window keeps QB fast) ---
  const since = new Date(Date.now() - 16 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  let soList, invList;
  try {
    [soList, invList] = await Promise.all([
      fetchTxns("sales-orders", conductorKey, endUserId, since),
      fetchTxns("invoices", conductorKey, endUserId, since),
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
  })).filter((o) => o.orderNo && o.isOpen && o.items.length && !o.fromOnlineStore);

  // --- 3. Map invoices: real invoices (start with 4), not Shopify, + linked SO ---
  const invs = invList.map((inv) => ({
    kind: "invoice",
    orderNo: refNo(inv),
    customer: customerOf(inv),
    items: mapItems(inv),
    fromOnlineStore: fromOnlineStore(inv),
    receivedAt: receivedAtOf(inv),
    linkedSo: linkedSalesOrders(inv),
  })).filter((o) => o.orderNo && o.orderNo.startsWith("4") && o.items.length && !o.fromOnlineStore);

  // --- 4. Which numbers are already on the board (any source)? ---
  const sb = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" };
  const candidateNos = [...new Set([...sos, ...invs].map((m) => m.orderNo))];
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
  // Skip invoices whose own number is on the board, OR whose originating sales
  // order is on the board (the sales-order card already represents that job).
  const invLinkedDup = invs.filter((m) => !existing[m.orderNo] && m.linkedSo.some((n) => soNumbersOnBoard.has(n)));
  const invsToAdd = invs.filter((m) => !existing[m.orderNo] && !m.linkedSo.some((n) => soNumbersOnBoard.has(n)));
  const toAdd = [...sosToAdd, ...invsToAdd];

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
      },
      wouldAddTotal: toAdd.length,
      // DEBUG: confirm invoices actually carry the sales-order link.
      invoiceLinkDebug: invList.slice(0, 4).map((inv) => ({
        no: refNo(inv),
        linkKeys: Object.keys(inv).filter((k) => /link/i.test(k)),
        linkedTransactions: inv.linkedTransactions ?? inv.linked_transactions ?? "(none)",
      })),
      sample: toAdd.slice(0, 8).map((m) => ({ kind: m.kind, orderNo: m.orderNo, date: m.receivedAt, customer: m.customer, linkedSo: m.linkedSo })),
      note: "Preview only — nothing inserted.",
    });
  }

  // --- Commit: insert the genuinely new orders ---
  let inserted = 0, failed = 0, firstError = null;
  for (const m of toAdd) {
    const ins = await fetch(`${url}/rest/v1/rpc/create_order`, {
      method: "POST",
      headers: sb,
      body: JSON.stringify({
        p_order: { order_no: m.orderNo, customer: m.customer, contact: "—", priority: "Normal", source: "QuickBooks", will_call: false, received_at: m.receivedAt },
        p_items: m.items,
      }),
    });
    if (ins.ok) inserted++;
    else { failed++; if (!firstError) firstError = { status: ins.status, detail: (await ins.text()).slice(0, 400) }; }
  }
  return json(200, {
    mode: "commit",
    salesOrdersAdded: sosToAdd.length,
    invoicesAdded: invsToAdd.length,
    invoicesSkippedAsSalesOrderDup: invLinkedDup.length,
    inserted, failed, firstError,
  });
}

function json(status, b) {
  return new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });
}
