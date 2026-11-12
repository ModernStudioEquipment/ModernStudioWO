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
    programNo: dup(p.programNo),
    steps: (p.steps && p.steps.length ? p.steps : [""]).slice(),
  };
}

// A save that trips the unique SKU, said in words. Postgres reports it as
// 23505 / "duplicate key value violates unique constraint".
export function isSkuTaken(err) {
  const m = `${err?.code || ""} ${err?.message || ""}`;
  return /23505|duplicate key/i.test(m) && /sku/i.test(m);
}
