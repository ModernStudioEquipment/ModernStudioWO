// One-time backfill: pull OPEN / UNFULFILLED Shopify orders onto the work-order
// board, using the EXACT same mapping as the live webhook (api/shopify-webhook.js)
// so imported orders look identical to ones that arrive live. Safe to run more
// than once — it skips orders already on the board.
//
// Usage:
//   node scripts/backfill-shopify.mjs --dry-run   # preview only, writes NOTHING
//   node scripts/backfill-shopify.mjs             # actually import
//
// Reads these from the environment (or the project's .env file):
//   SHOPIFY_STORE        e.g. modern-studio.myshopify.com
//   SHOPIFY_ADMIN_TOKEN  Admin API access token with read_orders scope
//   VITE_SUPABASE_URL    (already in your .env)
//   SUPABASE_SECRET_KEY  Supabase secret key (server-only)
//   SHOPIFY_API_VERSION  optional, defaults to 2025-10

import fs from "node:fs";
import path from "node:path";

// --- tiny .env loader (no dependency needed) ---
function loadEnv() {
  const p = path.resolve(process.cwd(), ".env");
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    const k = m[1];
    const v = m[2].trim().replace(/^["']|["']$/g, "");
    if (!(k in process.env)) process.env[k] = v;
  }
}
loadEnv();

const DRY = process.argv.includes("--dry-run");
const STORE = process.env.SHOPIFY_STORE;
const TOKEN = process.env.SHOPIFY_ADMIN_TOKEN;
const SUPA_URL = process.env.VITE_SUPABASE_URL;
const SECRET = process.env.SUPABASE_SECRET_KEY;
const VERSION = process.env.SHOPIFY_API_VERSION || "2025-10";

const missing = [
  !STORE && "SHOPIFY_STORE",
  !TOKEN && "SHOPIFY_ADMIN_TOKEN",
  !SUPA_URL && "VITE_SUPABASE_URL",
  !SECRET && "SUPABASE_SECRET_KEY",
].filter(Boolean);
if (missing.length) {
  console.error("Missing env vars:", missing.join(", "));
  console.error("Add them to your .env file (or export them), then re-run.");
  process.exit(1);
}

const sbHeaders = {
  apikey: SECRET,
  Authorization: `Bearer ${SECRET}`,
  "Content-Type": "application/json",
};

// --- same mapping as api/shopify-webhook.js ---
function mapOrder(order) {
  const orderNo = String(order.order_number ?? order.number ?? order.id ?? "");
  const cust = order.customer || {};
  const addr = order.shipping_address || order.billing_address || {};
  const personName = [cust.first_name, cust.last_name].filter(Boolean).join(" ").trim();
  const customer = addr.company || personName || "Shopify customer";
  const contact = personName || order.email || "—";
  const items = (order.line_items || []).map((li, i) => ({
    name: li.variant_title ? `${li.title} — ${li.variant_title}` : li.title,
    qty: li.quantity || 1,
    dept: "Shop", // default; the office re-routes per item at triage
    color: null,
    position: i,
  }));
  return { orderNo, customer, contact, items };
}

async function alreadyImported(orderNo) {
  const res = await fetch(
    `${SUPA_URL}/rest/v1/orders?select=id&source=eq.Shopify&order_no=eq.${encodeURIComponent(orderNo)}&limit=1`,
    { headers: sbHeaders }
  );
  const rows = await res.json();
  return Array.isArray(rows) && rows.length > 0;
}

async function insertOrder(m) {
  const res = await fetch(`${SUPA_URL}/rest/v1/rpc/create_order`, {
    method: "POST",
    headers: sbHeaders,
    body: JSON.stringify({
      p_order: {
        order_no: m.orderNo,
        customer: m.customer,
        contact: m.contact,
        priority: "Normal",
        source: "Shopify",
        will_call: false,
      },
      p_items: m.items,
    }),
  });
  if (!res.ok) throw new Error(`create_order ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

// --- follow Shopify's cursor pagination via the Link response header ---
function nextPageInfo(linkHeader) {
  if (!linkHeader) return null;
  for (const part of linkHeader.split(",")) {
    const m = part.match(/<([^>]+)>;\s*rel="next"/);
    if (m) return new URL(m[1]).searchParams.get("page_info");
  }
  return null;
}

async function* fetchOrders() {
  const base = `https://${STORE}/admin/api/${VERSION}/orders.json`;
  // First page carries the filters; subsequent pages use page_info only.
  let url = `${base}?status=open&fulfillment_status=unfulfilled&limit=250`;
  while (url) {
    const res = await fetch(url, { headers: { "X-Shopify-Access-Token": TOKEN } });
    if (!res.ok) throw new Error(`Shopify API ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const body = await res.json();
    for (const o of body.orders || []) yield o;
    const pi = nextPageInfo(res.headers.get("link"));
    url = pi ? `${base}?limit=250&page_info=${pi}` : null;
  }
}

// --- run ---
console.log(
  `\nShopify backfill — store=${STORE} api=${VERSION} ` +
    `${DRY ? "(DRY RUN — nothing will be written)" : "(LIVE — writing to the board)"}\n`
);

let fetched = 0, created = 0, skipped = 0, noItems = 0;
try {
  for await (const order of fetchOrders()) {
    fetched++;
    const m = mapOrder(order);
    if (!m.orderNo) { skipped++; continue; }
    if (!m.items.length) { noItems++; console.log(`  #${m.orderNo} — no line items, skipped`); continue; }
    if (await alreadyImported(m.orderNo)) { skipped++; console.log(`  #${m.orderNo} — already on board, skipped`); continue; }
    if (DRY) { console.log(`  #${m.orderNo} — ${m.customer} — ${m.items.length} item(s)  [would import]`); created++; continue; }
    try {
      await insertOrder(m);
      created++;
      console.log(`  #${m.orderNo} — ${m.customer} — ${m.items.length} item(s)  ✓ imported`);
    } catch (e) {
      skipped++;
      console.error(`  #${m.orderNo} — ERROR: ${e.message}`);
    }
  }
} catch (e) {
  console.error(`\nStopped: ${e.message}\n`);
  process.exit(1);
}

console.log(
  `\nDone. Fetched ${fetched} open/unfulfilled order(s): ` +
    `${created} ${DRY ? "would import" : "imported"}, ${skipped} skipped, ${noItems} had no line items.\n`
);
