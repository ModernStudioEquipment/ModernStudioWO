// Upload the Modern product photos to Supabase Storage and register each one in
// the item_photos table, keyed by SKU. The board then shows an item's photo by
// matching its SKU (QuickBooks items carry it in their "Item #:" note).
//
// RUN IT (from the project root):
//
//   1. Make sure migration 0034 (item_photos table) has been run in Supabase.
//   2. Unzip "Modern Product Images.zip" somewhere.
//   3. Grab your service key: Supabase -> Settings -> API -> service_role.
//      Keep it OUT of chat and out of git — pass it via the environment only.
//   4. Run:
//        SUPABASE_SERVICE_KEY='<service_role key>' \
//        node scripts/upload-item-photos.mjs "/path/to/Modern Product Images"
//
// Safe to re-run: it upserts, so re-running replaces photos and adds new SKUs.

import { createClient } from "@supabase/supabase-js";
import { readdirSync, statSync, readFileSync, existsSync } from "node:fs";
import { join, basename, extname } from "node:path";

const URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const FOLDER = process.argv[2];
const BUCKET = "item-photos";

if (!URL || !KEY || !FOLDER) {
  console.error("Missing config. Usage:\n  SUPABASE_SERVICE_KEY='<key>' node scripts/upload-item-photos.mjs <photos-folder>");
  console.error(URL ? "" : "  - set VITE_SUPABASE_URL (or SUPABASE_URL) in your env/.env");
  console.error(KEY ? "" : "  - set SUPABASE_SERVICE_KEY to the service_role key");
  console.error(existsSync(FOLDER || "") ? "" : "  - pass the unzipped photos folder as the first argument");
  process.exit(1);
}

const sb = createClient(URL, KEY, { auth: { persistSession: false } });
const IMG = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp"]);
const stripAlt = (stem) => stem.replace(/_[A-Za-z0-9]+$/, ""); // "MC_1" -> "MC", "013-2410-BZ_A" -> "013-2410-BZ"
const isAlt = (stem) => /_[A-Za-z0-9]+$/.test(stem);
const safePath = (sku, ext) => `${sku.replace(/[^A-Za-z0-9._-]/g, "_")}.${ext}`; // storage keys avoid #, ?, spaces

// --- 1. collect every image, recursively ---
function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (IMG.has(extname(name).toLowerCase())) out.push(p);
  }
  return out;
}
const files = walk(FOLDER);

// --- 2. one file per SKU. The filename (minus extension) IS the SKU, finish and
//        all (e.g. 013-2410-BZ.jpg). "_A"/"_1" mark alternate angles; the base
//        name also covers folders whose main shot is e.g. MC_1.jpg -> SKU "MC".
//        Prefer a non-alternate file when a SKU has several. ---
const skuToFile = new Map();
const consider = (sku, file, preferExact) => {
  const key = sku;
  const cur = skuToFile.get(key);
  if (!cur) return skuToFile.set(key, file);
  if (preferExact && isAlt(basename(cur, extname(cur))) && !isAlt(basename(file, extname(file)))) skuToFile.set(key, file);
};
for (const f of files) {
  const stem = basename(f, extname(f));
  consider(stem, f, true);                       // exact SKU (incl. finish)
  const base = stripAlt(stem);
  if (base && base !== stem) consider(base, f, false); // alternate-stripped base
}
console.log(`Found ${files.length} images across the folder -> ${skuToFile.size} SKUs to register.`);

// --- 3. ensure the bucket exists (public read) ---
const { error: bErr } = await sb.storage.createBucket(BUCKET, { public: true });
if (bErr && !/exist/i.test(bErr.message)) console.warn(`Bucket: ${bErr.message}`);
await sb.storage.updateBucket(BUCKET, { public: true }).catch(() => {});

// --- 4. upload each unique file once, then point every SKU alias at its URL ---
const uploaded = new Map(); // file -> public url
let done = 0, fail = 0, i = 0;
for (const [sku, file] of skuToFile) {
  i++;
  try {
    let url = uploaded.get(file);
    if (!url) {
      const ext = extname(file).toLowerCase() === ".png" ? "png" : "jpg";
      const path = safePath(basename(file, extname(file)), ext);
      const { error: upErr } = await sb.storage.from(BUCKET).upload(path, readFileSync(file), {
        contentType: ext === "png" ? "image/png" : "image/jpeg", upsert: true,
      });
      if (upErr) throw upErr;
      url = sb.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
      uploaded.set(file, url);
    }
    const { error: dbErr } = await sb.from("item_photos").upsert({ sku, image_url: url });
    if (dbErr) throw dbErr;
    done++;
  } catch (e) {
    fail++;
    console.error(`  x ${sku}: ${e.message || e}`);
  }
  if (i % 200 === 0) console.log(`  ...${i}/${skuToFile.size}  (${uploaded.size} files uploaded)`);
}
console.log(`\nDone. ${done} SKUs registered (${uploaded.size} files uploaded), ${fail} failed.`);
