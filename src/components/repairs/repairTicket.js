// The repair ticket: the paper "MODERN Repairs & Recovers" form the will call
// counter fills in by hand when a client drops something off, kept on the board
// so the office can see every repair that's in the building.
//
// Everything on the sheet is one `fields` object (saved as jsonb, like work
// orders), so a box added to the paper later never needs a schema change.

export const REPAIR_ROWS = 28; // item lines printed on the paper form

// Where a ticket is. "open" = in the shop, "ready" = done and waiting for the
// client, "done" = picked up (off the open list, kept for the record).
export const REPAIR_STATUSES = [
  { key: "open", label: "In the shop" },
  { key: "ready", label: "Ready for pickup" },
  { key: "done", label: "Picked up" },
];
export const statusLabel = (k) => (REPAIR_STATUSES.find((s) => s.key === k) || REPAIR_STATUSES[0]).label;

export const REPAIR_DEPTS = ["Shop", "Sewing", "CNC", "Saw"];

const LINE_KEYS = ["dept", "qty", "description", "notes"];
export const emptyLine = () => ({ dept: "", qty: "", description: "", notes: "" });
const lineHasText = (l) => LINE_KEYS.some((k) => String(l?.[k] ?? "").trim());

// MM/DD/YYYY, the way the sheet is written.
export function today(d = new Date()) {
  return `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}/${d.getFullYear()}`;
}

export function blankTicket(now = new Date()) {
  return {
    receivedBy: "", dateReceived: today(now), completionDate: "",
    orderNo: "", quote: "", // "yes" | "no" | ""
    company: "", address: "", contact: "", phone: "", email: "",
    repairs: "", recovers: "", refurbish: "", other: "",
    lines: [],
  };
}

// What the sheet shows: every saved field, and the item table padded out to
// the paper's 28 lines (more if a ticket has more) so there's always a blank
// line to click into, wherever it is on the page.
export function sheetFields(fields, now) {
  const f = { ...blankTicket(now), ...(fields || {}) };
  const lines = (Array.isArray(f.lines) ? f.lines : []).map((l) => ({ ...emptyLine(), ...l }));
  while (lines.length < REPAIR_ROWS) lines.push(emptyLine());
  return { ...f, lines };
}

// What gets saved: the blank lines are padding, not data. Lines keep their
// place (a blank line between two filled ones stays), only the trailing run
// of empties is dropped. Text is trimmed at the edges.
export function cleanForSave(fields) {
  const out = {};
  for (const [k, v] of Object.entries(fields || {})) {
    if (k === "lines") continue;
    out[k] = typeof v === "string" ? v.trim() : v;
  }
  const lines = (fields?.lines || []).map((l) => {
    const o = {};
    for (const k of LINE_KEYS) o[k] = String(l?.[k] ?? "").trim();
    return o;
  });
  while (lines.length && !lineHasText(lines[lines.length - 1])) lines.pop();
  out.lines = lines;
  return out;
}

// The lines that say something.
export const filledLines = (fields) => (fields?.lines || []).filter(lineHasText);

// How many items came in: the quantities added up, counting a line with no
// quantity as one.
export function itemCount(fields) {
  return filledLines(fields).reduce((n, l) => {
    const q = parseFloat(String(l.qty).replace(/[^\d.]/g, ""));
    return n + (Number.isFinite(q) && q > 0 ? q : 1);
  }, 0);
}

// Who it belongs to, for the card: the company, else the contact.
export function clientName(fields) {
  return String(fields?.company || "").trim() || String(fields?.contact || "").trim() || "No name yet";
}

// A ticket with nothing typed into it isn't worth saving.
export function isBlank(fields) {
  const f = cleanForSave(fields);
  const skip = new Set(["dateReceived", "lines"]);
  return !f.lines.length && Object.entries(f).every(([k, v]) => skip.has(k) || !v);
}

// Everything a search box should match on.
export function searchText(r) {
  const f = r?.fields || {};
  return [
    f.company, f.contact, f.phone, f.email, f.address, f.orderNo, f.receivedBy,
    ...filledLines(f).map((l) => `${l.description} ${l.notes} ${l.dept}`),
  ].filter(Boolean).join(" ").toLowerCase();
}

// MM/DD/YYYY (or M/D/YYYY) to a timestamp at the start of that day; null for
// anything else ("ASAP", blank).
export function parseSheetDate(v) {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(v ?? "").trim());
  if (!m) return null;
  const d = new Date(Number(m[3]), Number(m[1]) - 1, Number(m[2]));
  return Number.isNaN(d.getTime()) ? null : d.getTime();
}

// Past its estimated completion date and still in the shop.
export function isLate(r, now = Date.now()) {
  if (!r || r.status !== "open") return false;
  const due = parseSheetDate(r.fields?.completionDate);
  if (due == null) return false;
  const startOfToday = new Date(now); startOfToday.setHours(0, 0, 0, 0);
  return due < startOfToday.getTime();
}
