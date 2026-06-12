// One-time backfill from a Shopify "orders export" PDF (the CSV printed to PDF).
// Parses the rows, groups line items by order, and inserts each order onto the
// board via the same create_order RPC the live webhook uses. Safe to run twice
// (skips orders already on the board).
//
// Usage:
//   node scripts/backfill-from-pdf.mjs <path-to.pdf> --dry-run   # preview only
//   node scripts/backfill-from-pdf.mjs <path-to.pdf>             # actually import
//
// Reads VITE_SUPABASE_URL and SUPABASE_SECRET_KEY from the project .env.

import fs from "node:fs";
import path from "node:path";
import { PDFParse } from "pdf-parse";

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

const args = process.argv.slice(2);
const DRY = args.includes("--dry-run");
const PDF_PATH = args.find((a) => !a.startsWith("--")) || "/Users/maddoxleach/Desktop/orders_export.pdf";
const SUPA_URL = process.env.VITE_SUPABASE_URL;
const SECRET = process.env.SUPABASE_SECRET_KEY;

const missing = [!SUPA_URL && "VITE_SUPABASE_URL", !SECRET && "SUPABASE_SECRET_KEY"].filter(Boolean);
if (missing.length) {
  console.error("Missing env vars:", missing.join(", "));
  process.exit(1);
}
if (!fs.existsSync(PDF_PATH)) {
  console.error("PDF not found:", PDF_PATH);
  process.exit(1);
}

const sbHeaders = {
  apikey: SECRET,
  Authorization: `Bearer ${SECRET}`,
  "Content-Type": "application/json",
};

// --- parse the PDF into { orderNo, customer, contact, items[] } ---
async function parsePdf() {
  const data = new Uint8Array(fs.readFileSync(PDF_PATH));
  const parser = new PDFParse({ data });
  const { text } = await parser.getText();
  await parser.destroy();

  const orders = new Map(); // orderNo -> { orderNo, email, items: [{name, qty}] }
  for (const rawLine of text.split("\n")) {
    const line = rawLine.replace(/ /g, " ").trim();
    if (!/^#?\d+\s*\t/.test(line) && !/^#\d+/.test(line)) continue;
    const fields = line.split("\t").map((f) => f.trim()).filter((f, i, a) => !(f === "" && i === a.length - 1));
    if (fields.length < 4) continue;
    const orderNo = fields[0].replace(/^#/, "").trim();
    if (!/^\d+$/.test(orderNo)) continue;
    const email = (fields[1] || "").trim();
    // Last three meaningful fields are: Lineitem quantity, Lineitem name, Lineitem price
    const price = fields[fields.length - 1];
    const name = fields[fields.length - 2];
    const qtyRaw = fields[fields.length - 3];
    const qty = /^\d+$/.test(qtyRaw) ? parseInt(qtyRaw, 10) : 1;
    if (!name || !/^[\d.]+$/.test(price)) continue; // guard against malformed rows
    if (!orders.has(orderNo)) orders.set(orderNo, { orderNo, email, items: [] });
    orders.get(orderNo).items.push({ name, qty });
  }

  return [...orders.values()].map((o) => ({
    orderNo: o.orderNo,
    customer: o.email || "Shopify customer",
    contact: o.email || "—",
    items: o.items.map((it, i) => ({ name: it.name, qty: it.qty, dept: "Shop", color: null, position: i })),
  }));
}

async function alreadyImported(orderNo) {
  const res = await fetch(
    `${SUPA_URL}/rest/v1/orders?select=id&source=eq.Shopify&order_no=eq.${encodeURIComponent(orderNo)}&limit=1`,
    { headers: sbHeaders }
  );
  const rows = await res.json();
  return Array.isArray(rows) && rows.length > 0;
}

async function insertOrder(o) {
  const res = await fetch(`${SUPA_URL}/rest/v1/rpc/create_order`, {
    method: "POST",
    headers: sbHeaders,
    body: JSON.stringify({
      p_order: { order_no: o.orderNo, customer: o.customer, contact: o.contact, priority: "Normal", source: "Shopify", will_call: false },
      p_items: o.items,
    }),
  });
  if (!res.ok) throw new Error(`create_order ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

// --- run ---
const orders = await parsePdf();
const totalItems = orders.reduce((n, o) => n + o.items.length, 0);
console.log(
  `\nParsed ${orders.length} order(s), ${totalItems} line item(s) from:\n  ${PDF_PATH}\n` +
    `${DRY ? "(DRY RUN — nothing will be written)" : "(LIVE — writing to the board)"}\n`
);

let created = 0, skipped = 0;
for (const o of orders) {
  if (await alreadyImported(o.orderNo)) {
    skipped++;
    console.log(`  #${o.orderNo} — already on board, skipped`);
    continue;
  }
  if (DRY) {
    console.log(`  #${o.orderNo} — ${o.customer} — ${o.items.length} item(s): ${o.items.map((i) => `${i.qty}× ${i.name}`).join("; ").slice(0, 120)}`);
    created++;
    continue;
  }
  try {
    await insertOrder(o);
    created++;
    console.log(`  #${o.orderNo} — ${o.customer} — ${o.items.length} item(s) ✓ imported`);
  } catch (e) {
    skipped++;
    console.error(`  #${o.orderNo} — ERROR: ${e.message}`);
  }
}

console.log(`\nDone. ${created} ${DRY ? "would import" : "imported"}, ${skipped} skipped.\n`);
