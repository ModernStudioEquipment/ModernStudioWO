// One-off: give QuickBooks finish-variants (which have no exact photo) the photo
// of a sibling SKU — same part, different coating, so the photo is identical.
// Color variants are intentionally excluded (a gray sandbag must not borrow a red
// one). Mapping was derived from the photo-folder structure.
//
//   SUPABASE_SERVICE_KEY='<service_role key>' node scripts/recover-qb-photos.mjs
//
// Safe + re-runnable: only adds item_photos for SKUs that don't already have one.

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

function fromEnvFile(key) {
  try { for (const line of readFileSync(".env", "utf8").split("\n")) { const m = line.match(new RegExp(`^\\s*${key}\\s*=\\s*(.+?)\\s*$`)); if (m) return m[1].replace(/^["']|["']$/g, ""); } } catch { /* no .env */ }
  return null;
}
const URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || fromEnvFile("VITE_SUPABASE_URL");
const KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !KEY) { console.error("Usage: SUPABASE_SERVICE_KEY='<key>' node scripts/recover-qb-photos.mjs"); process.exit(1); }
const sb = createClient(URL, KEY, { auth: { persistSession: false } });

// board SKU (missing a photo) -> sibling SKU to borrow the photo from
const MAP = {
  "031-5828B": "031-5828", "012-2212-BZ": "012-2212-BS", "035-6670-S": "035-6670", "035-6660-L": "035-6660",
  "008-1885-BS": "008-1885-BZ", "010-2014-BS": "010-2014T-BT", "030-5670B": "030-5670", "008-1866-BZ": "008-1866",
  "002-1275-BT": "002-1275", "002-1265-BT": "002-1265", "002-1285-B": "002-1285-NB", "004-1429-BZ": "004-1429",
  "008-1886-BS": "008-1886-BZ", "010-2060-BZ": "010-2060", "006-1680-BZ": "006-1680", "008-1830-BZ": "008-1830",
  "010-2030-HGS": "010-2030-BT", "006-1645-BZ": "006-1645", "006-1628-BT": "006-1628-BZ", "004-1426-BZ": "004-1426",
  "002-1260-BT": "002-1260", "010-2014-BT": "010-2014T-BT", "002-1255-BT": "002-1255",
};

const url = new Map();
for (let from = 0; ; from += 1000) {
  const { data, error } = await sb.from("item_photos").select("sku,image_url").range(from, from + 999);
  if (error) { console.error(error.message); process.exit(1); }
  if (!data || !data.length) break;
  data.forEach((r) => url.set(String(r.sku).toLowerCase(), r.image_url));
  if (data.length < 1000) break;
}

const rows = [];
for (const [sku, sib] of Object.entries(MAP)) {
  if (url.has(sku.toLowerCase())) continue;          // already has its own photo
  const u = url.get(sib.toLowerCase());
  if (u) rows.push({ sku, image_url: u });
}
console.log(`Adding ${rows.length} finish-variant photos (of ${Object.keys(MAP).length} candidates)…`);
if (rows.length) {
  const { error } = await sb.from("item_photos").upsert(rows, { onConflict: "sku" });
  if (error) { console.error(error.message); process.exit(1); }
}
console.log("Done.");
