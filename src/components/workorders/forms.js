// Form definitions for custom work orders, one per department. The modal and the
// printable doc both read these, so building/adjusting a department's form is
// just editing this file.
//
// layout "fields"    -> flat list of `fields`
// layout "lineItems" -> `header` fields + a repeating `line` (columns)

import { fmtDate } from "../../theme.js";

// Both date defaults use the app-wide 00/00/0000 format.
const today = () => fmtDate(new Date());
const todayShort = today;

export const WO_TYPES = [
  { key: "shop", label: "Shop" },
  { key: "cnc", label: "CNC" },
  { key: "sewing", label: "Sewing" },
  { key: "saw", label: "Saw" },
];

export const WO_FORMS = {
  // The single-product MODERN sheet (formerly "Basic").
  shop: {
    label: "Shop work order",
    layout: "fields",
    fields: [
      { key: "product", label: "Product", type: "text", full: true },
      { key: "order", label: "Order", type: "text" },
      { key: "total", label: "Total", type: "text" },
      { key: "orderedOn", label: "Ordered on", type: "text", default: today },
      // The official work-order date — stamped the first time a sheet is printed
      // for this order and identical on every sheet printed from it afterwards.
      { key: "woDate", label: "W/O date", type: "text", default: today },
      { key: "dueDate", label: "Due date", type: "text" },
      { key: "color", label: "Color", type: "text" },
      { key: "notes", label: "Notes", type: "textarea", full: true },
    ],
  },

  // CNC sheet: the MODERN sheet plus a part number and a 6-step column.
  cnc: {
    label: "CNC work order",
    layout: "fields",
    fields: [
      { key: "product", label: "Product", type: "text", full: true },
      { key: "partNo", label: "Part #", type: "text" },
      { key: "order", label: "Order", type: "text" },
      { key: "total", label: "Total", type: "text" },
      { key: "orderedOn", label: "Ordered on", type: "text", default: today },
      // The official work-order date — stamped the first time a sheet is printed
      // for this order and identical on every sheet printed from it afterwards.
      { key: "woDate", label: "W/O date", type: "text", default: today },
      { key: "dueDate", label: "Due date", type: "text" },
      { key: "step1", label: "Step 1", type: "text", full: true },
      { key: "step2", label: "Step 2", type: "text", full: true },
      { key: "step3", label: "Step 3", type: "text", full: true },
      { key: "step4", label: "Step 4", type: "text", full: true },
      { key: "step5", label: "Step 5", type: "text", full: true },
      { key: "step6", label: "Step 6", type: "text", full: true },
    ],
  },

  // Sewing sheet: header + a product/qty line-item list.
  sewing: {
    label: "Sewing work order",
    layout: "lineItems",
    lineLabel: "Products",
    header: [
      { key: "orderDate", label: "Order date", default: todayShort },
      // Locked on first print — see woDate on the shop/CNC sheets.
      { key: "woDate", label: "W/O date", default: todayShort },
      { key: "dueDate", label: "Due date" },
      { key: "time", label: "Time" },
      { key: "invoices", label: "Invoice(s)" },
    ],
    line: [
      { key: "product", label: "Product", grow: true },
      { key: "qty", label: "Qty", width: 70 },
    ],
    minRows: 18,
  },

  // Saw sheet: plain cut list — Order # + material / size / qty rows.
  saw: {
    label: "Saw work order",
    layout: "lineItems",
    lineLabel: "Cut list",
    header: [
      // Locked on first print — see woDate on the shop/CNC sheets.
      { key: "woDate", label: "W/O date", default: todayShort },
    ],
    line: [
      { key: "item", label: "Material / item", grow: true },
      { key: "size", label: "Size", width: 100 },
      { key: "qty", label: "Qty", width: 70 },
    ],
    minRows: 12,
  },
};

export const emptyLine = (form) => {
  const o = {};
  form.line.forEach((c) => (o[c.key] = ""));
  return o;
};

export const initFields = (form) => {
  if (form.layout === "lineItems") {
    const o = { lines: [emptyLine(form)] };
    form.header.forEach((f) => (o[f.key] = f.default ? f.default() : ""));
    return o;
  }
  const o = {};
  form.fields.forEach((f) => (o[f.key] = f.default ? f.default() : ""));
  return o;
};

// ── moving a work order between departments ─────────────────────────────────────────────────
//
// The four sheets are not the same form. Shop and CNC are field sheets that share six keys;
// Sewing and Saw are line-item sheets. So a department change is a real edit, not a relabel, and
// what survives it depends entirely on which pair you are moving between.
//
// These two exist so the sheet can SAY what a switch costs before making it, rather than emptying
// half the form and leaving the user to notice.

const keysOf = (form) => (form?.fields || []).map((f) => f.key);
const labelOf = (form, key) => (form?.fields || []).find((f) => f.key === key)?.label || key;
const filled = (v) => v != null && String(v).trim() !== "";

// The two line-item sheets don't use the same column keys: Sewing is
// product + qty, Saw is item + size + qty. The wide column is the thing being
// made on both, whatever it's called, so that's what carries across.
const lineCols = (form) => form?.line || [];
const growKey = (form) => (lineCols(form).find((c) => c.grow) || {}).key || null;
const lineLabel = (form, key) => (lineCols(form).find((c) => c.key === key) || {}).label || key;

/** The labels of anything currently filled in that the target sheet has nowhere to put. */
export function fieldsLostSwitching(from, to, fields) {
  const a = WO_FORMS[from];
  const b = WO_FORMS[to];
  if (!a || !b) return [];
  // Different layouts share nothing structural: line rows cannot become fields, or the reverse.
  if (a.layout !== b.layout) {
    const lost = keysOf(a).filter((k) => filled(fields?.[k])).map((k) => labelOf(a, k));
    if (a.layout === "lineItems" && (fields?.lines || []).some((l) => Object.values(l || {}).some(filled))) {
      lost.push("the line items");
    }
    return lost;
  }
  const keep = new Set(keysOf(b));
  const lost = keysOf(a).filter((k) => !keep.has(k) && filled(fields?.[k])).map((k) => labelOf(a, k));
  // Same layout, different columns: a Saw cut list carries a Size that a Sewing
  // sheet has no column for. Say so rather than emptying it on the way over.
  if (a.layout === "lineItems") {
    const bKeys = new Set(lineCols(b).map((c) => c.key));
    const carried = growKey(a);          // the wide column maps to the wide one
    lineCols(a).forEach((c) => {
      if (bKeys.has(c.key) || c.key === carried) return;
      if ((fields?.lines || []).some((l) => filled(l?.[c.key]))) lost.push(lineLabel(a, c.key));
    });
  }
  return lost;
}

/** The same sheet's values, reshaped for the target department. Common keys carry; nothing else. */
export function remapFields(from, to, fields) {
  const a = WO_FORMS[from];
  const b = WO_FORMS[to];
  const base = initFields(b);
  if (!a || !b) return base;
  if (a.layout !== b.layout) return base;
  const keep = new Set(keysOf(b));
  const out = { ...base };
  for (const k of keysOf(a)) if (keep.has(k) && filled(fields?.[k])) out[k] = fields[k];
  if (b.layout === "lineItems" && Array.isArray(fields?.lines)) {
    // Carry each row across by column key, and the wide column by its job — the
    // product/material text is the row. Copying the rows verbatim left a Sewing
    // list looking empty on a Saw sheet: the words were still there, under a key
    // that sheet never reads.
    const bKeys = new Set(lineCols(b).map((c) => c.key));
    const from = growKey(a);
    const to = growKey(b);
    out.lines = fields.lines.map((ln) => {
      const next = emptyLine(b);
      Object.keys(ln || {}).forEach((k) => { if (bKeys.has(k)) next[k] = ln[k]; });
      if (from && to && from !== to && filled(ln?.[from])) next[to] = ln[from];
      return next;
    });
  }
  return out;
}
