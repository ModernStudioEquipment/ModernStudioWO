// Wire Shopify items to the product photo library. Shopify items resolve their
// photo by PRODUCT NAME (the board's name-keyed fallback), so this maps each
// Shopify product name -> its SKU's already-uploaded photo, into product_photos.
//
// Run it (after the photos are uploaded) from the project root:
//   SUPABASE_SERVICE_KEY='<service_role key>' \
//   node scripts/wire-shopify-photos.mjs "/Users/maddoxleach/Downloads/CSV for Maddox.csv"
//
// Safe + re-runnable: it reads existing product_photos names first and skips them,
// so any photo you uploaded by hand is left untouched.

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

function fromEnvFile(key) {
  try { for (const line of readFileSync(".env", "utf8").split("\n")) { const m = line.match(new RegExp(`^\\s*${key}\\s*=\\s*(.+?)\\s*$`)); if (m) return m[1].replace(/^["']|["']$/g, ""); } } catch { /* no .env */ }
  return null;
}
const URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || fromEnvFile("VITE_SUPABASE_URL");
const KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const CSV = process.argv[2];
const DRY = process.env.DRY_RUN === "1";
if (!CSV || (!DRY && (!URL || !KEY))) {
  console.error("Usage: SUPABASE_SERVICE_KEY='<key>' node scripts/wire-shopify-photos.mjs <CSV path>");
  process.exit(1);
}

// minimal CSV parser: quoted fields, commas + newlines inside quotes, "" escapes
function parseCSV(text) {
  const rows = []; let row = [], field = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; } else field += c; }
    else if (c === '"') q = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (c === "\r") { /* skip */ }
    else field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

// --- 1. CSV -> board-style product name -> SKU. Variant rows have an empty Title;
//        the product Title carries forward per Handle. The board names a variant
//        "Title — Variant" (em dash), matching the Shopify webhook. ---
const rows = parseCSV(readFileSync(CSV, "utf8"));
const head = rows[0];
const cH = head.indexOf("Handle"), cT = head.indexOf("Title"), cS = head.indexOf("Variant SKU");
const cOpt = [head.indexOf("Option1 Value"), head.indexOf("Option2 Value"), head.indexOf("Option3 Value")].filter((i) => i >= 0);
const nameToSku = new Map();
const add = (n, sku) => { if (n && !nameToSku.has(n)) nameToSku.set(n, sku); };
let curHandle = null, curTitle = null;
for (let i = 1; i < rows.length; i++) {
  const r = rows[i]; if (!r || r.length <= cS) continue;
  const h = (r[cH] || "").trim(), t = (r[cT] || "").trim();
  if (h !== curHandle) { curHandle = h; curTitle = null; }
  if (t) curTitle = t;
  const sku = (r[cS] || "").trim();
  if (!sku || !curTitle) continue;
  // Join ALL options the way the board names a variant ("V1 / V2"), and register
  // both the em-dash and hyphen separators since board names use either one.
  const variant = cOpt.map((i) => (r[i] || "").trim()).filter((v) => v && v.toLowerCase() !== "default title").join(" / ");
  if (variant) { add(`${curTitle} — ${variant}`, sku); add(`${curTitle} - ${variant}`, sku); }
  else add(curTitle, sku);
}
console.log(`Parsed ${nameToSku.size} Shopify product names from the CSV.`);
if (DRY) { console.log("DRY RUN sample:", [...nameToSku].slice(0, 8)); process.exit(0); }

const sb = createClient(URL, KEY, { auth: { persistSession: false } });

async function pageAll(table, cols, onRow) {
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from(table).select(cols).range(from, from + 999);
    if (error) { console.error(`${table} read failed: ${error.message}`); process.exit(1); }
    if (!data || !data.length) break;
    data.forEach(onRow);
    if (data.length < 1000) break;
  }
}

// --- 2. item_photos: sku -> url ---
const skuUrl = new Map();
await pageAll("item_photos", "sku,image_url", (r) => skuUrl.set(String(r.sku).toLowerCase(), r.image_url));
console.log(`Loaded ${skuUrl.size} item photos.`);

// --- 3. existing product_photos names — never overwrite a hand-uploaded one ---
const existing = new Set();
await pageAll("product_photos", "name", (r) => existing.add(r.name));

// --- 4. build + upsert the rows that have a photo and aren't already set ---
const toAdd = [];
for (const [name, sku] of nameToSku) {
  if (existing.has(name)) continue;
  const url = skuUrl.get(sku.toLowerCase());
  if (url) toAdd.push({ name, image_url: url });
}
console.log(`Adding ${toAdd.length} Shopify product photos (of ${nameToSku.size} names; rest have no catalog photo or already exist)…`);
for (let i = 0; i < toAdd.length; i += 500) {
  const { error } = await sb.from("product_photos").upsert(toAdd.slice(i, i + 500), { onConflict: "name" });
  if (error) { console.error(`upsert failed: ${error.message}`); process.exit(1); }
  console.log(`  …${Math.min(i + 500, toAdd.length)}/${toAdd.length}`);
}
console.log(`Done. ${toAdd.length} Shopify products now resolve a photo.`);
