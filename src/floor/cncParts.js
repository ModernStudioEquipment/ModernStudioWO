// Copying a CNC catalogue part.
//
// Asked for by the shop: most new parts are an old part with one thing
// changed, and retyping every step to get there is how steps get lost.
//
// The copy is everything EXCEPT the identifiers, which get "DUP-" in front,
// the way QuickBooks marks a duplicate (012-345 becomes DUP-012-345). That is
// not decoration: SKU is unique in the database, so a copy carrying the same
// SKU could never be saved. Blank identifiers stay blank — there is nothing to
// collide with. It comes back unsaved (no id), so nothing exists until Save.
export const DUP = "DUP-";

const dup = (v) => {
  const s = String(v ?? "").trim();
  return s ? `${DUP}${s}` : "";
};

export function duplicatePart(p) {
  return {
    ...p,
    id: null,
    copiedFrom: p.name || "this part",   // for the "not saved yet" note; never saved
    sku: dup(p.sku),
    productNo: dup(p.productNo),
    programNo: joinPrograms(splitPrograms(p.programNo).map(dup)),
    steps: (p.steps && p.steps.length ? p.steps : [""]).slice(),
  };
}

// A save that trips the unique SKU, said in words. Postgres reports it as
// 23505 / "duplicate key value violates unique constraint".
export function isSkuTaken(err) {
  const m = `${err?.code || ""} ${err?.message || ""}`;
  return /23505|duplicate key/i.test(m) && /sku/i.test(m);
}

// ---- Extra photos -----------------------------------------------------------
//
// A part's pictures beyond the blueprint (finished part, fixture, setup), kept
// as an ordered list of URLs. Anything that isn't a non-empty string is dropped,
// and a URL can only appear once — uploading the same picture twice is a slip,
// not a wish to see it twice.
export const MAX_PHOTOS = 12;

export function cleanPhotos(list) {
  const out = [];
  for (const u of Array.isArray(list) ? list : []) {
    const s = typeof u === "string" ? u.trim() : "";
    if (s && !out.includes(s)) out.push(s);
  }
  return out.slice(0, MAX_PHOTOS);
}

// Whether a save should write the photos column. Before migration 0065 runs
// that column doesn't exist, and naming it in a save makes the WHOLE save fail —
// so a part that has never had photos, on a database that has never had the
// column, must not mention it. Once the column is there (photosColumn, seen on
// load) it is always written, so removing the last photo still sticks.
export function shouldWritePhotos(p) {
  return !!p.photosColumn || cleanPhotos(p.photos).length > 0;
}

// Move one step from index `from` to index `to`, returning a new array.
export function moveStep(steps, from, to) {
  const list = Array.isArray(steps) ? steps.slice() : [];
  if (from === to || from < 0 || from >= list.length || to < 0 || to >= list.length) return list;
  list.splice(to, 0, list.splice(from, 1)[0]);
  return list;
}

// A part can run more than one CNC program. They share the one program_no
// column, comma separated, so no migration and old rows read as one program.
export function splitPrograms(v) {
  const list = String(v || "").split(/[,;\n]+/).map((x) => x.trim()).filter(Boolean);
  return list.length ? list : [""];
}
export function joinPrograms(list) {
  return (list || []).map((x) => String(x || "").trim()).filter(Boolean).join(", ");
}
