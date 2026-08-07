// Modern Studio Equipment — visual language.
// Black-and-white industrial; color is reserved for MEANING only:
// red = RUSH, amber = waiting/ordering, green = ready/done, blue = in-progress.

// Colors are CSS variables (defined in index.css) so a single `.dark` class on
// <html> repaints the whole app — light is the default; dark is a per-device
// opt-in (localStorage), never shared. `ink` is the primary text + decorative
// marks (flips dark↔light); `fill`/`onFill` are the dark button/header surfaces
// that must STAY dark in dark mode so their light text keeps its contrast.
export const C = {
  ink: "var(--c-ink)",
  inkSoft: "var(--c-ink-soft)",
  concrete: "var(--c-concrete)",
  surface: "var(--c-surface)",
  fill: "var(--c-fill)",
  onFill: "var(--c-on-fill)",
  line: "var(--c-line)",
  shadow: "var(--c-shadow)",
  rush: "var(--c-rush)",
  rushBg: "var(--c-rush-bg)",
  high: "var(--c-high)",
  highBg: "var(--c-high-bg)",
  blue: "var(--c-blue)",
  blueBg: "var(--c-blue-bg)",
  green: "var(--c-green)",
  greenBg: "var(--c-green-bg)",
  gold: "var(--c-gold)",
  goldBg: "var(--c-gold-bg)",
  gray: "var(--c-gray)",
  grayBg: "var(--c-gray-bg)",
  note: "var(--c-note)",         // bright yellow — order-note bell + outline
  noteRail: "var(--c-note-rail)", // charcoal grey — the New Orders note box
};

// Priority is stored as RUSH/High/Normal (DB constraint) but DISPLAYED as
// Urgent/High/Standard. The `label` is what the shop sees.
export const PRI = {
  RUSH: { c: C.rush, bg: C.rushBg, label: "Urgent" },
  High: { c: C.high, bg: C.highBg, label: "High" },
  Normal: { c: C.gray, bg: C.grayBg, label: "Standard" },
};
export const priLabel = (p) => PRI[p]?.label || "Standard";

// Click-to-cycle order: Standard -> High -> Urgent -> Standard
export const PRI_CYCLE = { Normal: "High", High: "RUSH", RUSH: "Normal" };

// Sort rank: most urgent first.
export const PRI_RANK = { RUSH: 0, High: 1, Normal: 2 };

// An order auto-counts as Urgent when its due date is within 2 days (or past),
// no matter its manual priority.
export const dueSoon = (dueDate, now = Date.now()) => {
  if (!dueDate) return false;
  const due = new Date(`${dueDate}T23:59:59`).getTime();
  return !isNaN(due) && due - now <= 2 * 24 * 60 * 60 * 1000;
};

// Effective priority used for display + sorting: the more urgent of the manual
// priority and the due-soon auto-bump. Shopify orders are NOT auto-bumped to
// urgent by their due date — the urgent lane is for QuickBooks / manually-flagged
// orders; Shopify orders still show past-due on their pill, just outside Urgent.
export const effectivePriority = (order, now = Date.now()) =>
  (order.source !== "Shopify" && dueSoon(order.dueDate, now)) ? "RUSH" : (order.priority || "Normal");

// Urgency now comes from the DUE DATE (the Standard/High/Urgent labels are
// retired). overdue = past due (red), soon = due within 2 days (amber), else null.
export const DUE = {
  overdue: { c: C.rush, bg: C.rushBg, label: "Overdue" },
  soon:    { c: C.high, bg: C.highBg, label: "Due soon" },
};
// The deadline moment: the due time if one's set, else end of the due day.
// Plain local strings — no timezone conversion.
export const dueDeadline = (order) => {
  const d = order && order.dueDate;
  if (!d) return null;
  const t = new Date(`${d}T${order.dueTime ? `${order.dueTime}:00` : "23:59:59"}`).getTime();
  return isNaN(t) ? null : t;
};
export const dueLevel = (order, now = Date.now()) => {
  const end = dueDeadline(order);
  if (end == null) return null;
  if (end < now) return "overdue";
  if (end - now <= 2 * 24 * 60 * 60 * 1000) return "soon";
  return null;
};
// Sort by deadline: soonest first, orders with no due date last.
export const byDue = (a, b) => (dueDeadline(a) ?? Infinity) - (dueDeadline(b) ?? Infinity);

export const STAGES = ["new", "picklist", "workorder", "awaiting", "done"];
// Friendly names for each stage — used by the item history timeline.
export const STAGE_LABELS = {
  new: "New Orders",
  picklist: "Pick List",
  workorder: "Work Order",
  awaiting: "Purchasing",
  done: "Done",
};
// "Sitting too long" thresholds — how long an item can sit in one stage with no
// movement before the board flags it. Warn (amber) at 3 days, stale (red) at 6.
export const SITTING_WARN_MS = 3 * 24 * 60 * 60 * 1000;
export const SITTING_STALE_MS = 6 * 24 * 60 * 60 * 1000;

// When the item entered its CURRENT stage — the timestamp of the last logged
// move into it.stage. Returns null when that move happened before history
// tracking started (so we genuinely can't prove how long it's been here).
export function stageEnteredAt(item) {
  const evs = ((item && item.events) || []).filter((e) => e.kind === "created" || e.kind === "moved");
  for (let i = evs.length - 1; i >= 0; i--) {
    if (evs[i].to === item.stage) return new Date(evs[i].at).getTime();
  }
  return null;
}

// How long the item has been sitting in its current stage, or null if unknown.
export function stageDwellMs(item, now = Date.now()) {
  const t = stageEnteredAt(item);
  return t == null ? null : Math.max(0, now - t);
}

// null | "warn" | "stale" — only flags active items we can PROVE have been in
// their current stage too long (3 days warn, 6 days stale). Items whose move
// into the current stage predates tracking aren't flagged (we can't be sure).
export function sittingLevel(item, now = Date.now()) {
  if (!item || item.stage === "done") return null;
  const dwell = stageDwellMs(item, now);
  if (dwell == null) return null;
  if (dwell >= SITTING_STALE_MS) return "stale";
  if (dwell >= SITTING_WARN_MS) return "warn";
  return null;
}

// An order staged to ship (in the Shipping tab, no tracking number yet) gets
// flagged once it's been sitting staged for a full day — someone needs to hand
// it to the carrier.
export const STAGED_FLAG_MS = 24 * 60 * 60 * 1000;
export function stagedDwellMs(order, now = Date.now()) {
  if (!order || order.fulfillment !== "shipping" || order.trackingNumber || !order.fulfilledAt) return null;
  return Math.max(0, now - new Date(order.fulfilledAt).getTime());
}
export function stagedTooLong(order, now = Date.now()) {
  const d = stagedDwellMs(order, now);
  return d != null && d >= STAGED_FLAG_MS;
}

// Build a carrier tracking URL from a tracking number. Detects UPS / USPS /
// FedEx / DHL by the number's format (the shop ships with several carriers);
// falls back to a Google tracking search when the carrier isn't clear — Google
// recognizes tracking numbers and surfaces the status + carrier link.
export function trackingUrl(raw) {
  const num = String(raw || "").replace(/\s+/g, "");
  if (!num) return null;
  const enc = encodeURIComponent(num);
  if (/^1Z[0-9A-Z]{16}$/i.test(num)) return `https://www.ups.com/track?loc=en_US&tracknum=${enc}`;
  if (/^[A-Z]{2}\d{9}US$/i.test(num)) return `https://tools.usps.com/go/TrackConfirmAction?tLabels=${enc}`;
  if (/^9[0-9]{15,21}$/.test(num)) return `https://tools.usps.com/go/TrackConfirmAction?tLabels=${enc}`;
  if (/^(\d{12}|\d{15}|\d{20})$/.test(num)) return `https://www.fedex.com/fedextrack/?trknbr=${enc}`;
  if (/^\d{10}$/.test(num)) return `https://www.dhl.com/us-en/home/tracking/tracking-express.html?submit=1&tracking-id=${enc}`;
  return `https://www.google.com/search?q=${enc}`;
}

// The four shop departments (match the custom work-order types).
export const DEPTS = ["Shop", "CNC", "Sewing", "Saw"];
export const PRIORITIES = ["Normal", "High", "RUSH"]; // stored values; UI shows PRI[x].label

export const elapsed = (msRaw) => {
  // The `now` tick only refreshes every 30s, so a just-happened event can compute
  // a negative age. Clamp — "-1m ago" is nonsense on screen.
  const ms = Math.max(0, msRaw);
  const m = Math.floor(ms / 60000);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
};

// EVERY date the app displays goes through here, so they all read the same:
// 08/05/2026. Accepts a timestamp, a Date, or a "YYYY-MM-DD" string (due dates —
// parsed at local midnight so the day doesn't shift).
export const fmtDate = (value) => {
  if (value == null || value === "") return "";
  const dt = typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? new Date(`${value}T00:00:00`)
    : new Date(value);
  if (isNaN(dt)) return typeof value === "string" ? value : "";
  const p = (n) => String(n).padStart(2, "0");
  return `${p(dt.getMonth() + 1)}/${p(dt.getDate())}/${dt.getFullYear()}`;
};

// Full event stamp shown everywhere a timestamp appears: the exact local date +
// time AND how long ago — e.g. "08/05/2026, 2:34 PM · 2d 11h ago". These reflect
// when something actually happened; they are never editable.
export const stampAt = (ms) => {
  if (ms == null) return "";
  const dt = new Date(ms);
  if (isNaN(dt)) return "";
  const time = dt.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  return `${fmtDate(ms)}, ${time}`;
};
export const stamp = (ms, now = Date.now()) => {
  const at = stampAt(ms);
  if (!at) return "";
  const age = Math.max(0, now - ms);
  return `${at} · ${age < 60000 ? "just now" : `${elapsed(age)} ago`}`;
};

// Format a "YYYY-MM-DD" due date as e.g. "Jun 20" (parsed at local midnight so
// it doesn't shift a day). With an optional "HH:MM" time -> "Jun 20, 3:00 PM".
export const fmtTime = (t) => {
  if (!t) return "";
  const [h, m] = String(t).split(":").map(Number);
  if (isNaN(h)) return "";
  const ap = h < 12 ? "AM" : "PM";
  return `${h % 12 || 12}:${String(m || 0).padStart(2, "0")} ${ap}`;
};
export const dueLabel = (d, time) => {
  if (!d) return "";
  const datePart = fmtDate(d);
  return time ? `${datePart}, ${fmtTime(time)}` : datePart;
};

// Two buyers type the same material differently — `1" aluminum bar` vs
// `1in aluminum bar` — so demand has to group on a normalized key, not the raw
// text. Unifies inch/foot marks and drops spacing/punctuation noise. `/` is
// deliberately KEPT: without it `1/2" bar` and `12" bar` would collide, which
// would be a genuinely dangerous mis-group.
export const materialKey = (raw) =>
  String(raw ?? "")
    .toLowerCase()
    .replace(/["”]/g, "in")
    .replace(/['’]/g, "ft")
    .replace(/(\d)\s*(?:inches|inch)\b/g, "$1in") // 1inch / 1 inch -> 1in
    .replace(/(\d)\s*(?:feet|foot)\b/g, "$1ft")
    .replace(/\b(?:inches|inch)\b/g, "in")
    .replace(/\b(?:feet|foot)\b/g, "ft")
    .replace(/[^a-z0-9/]+/g, "");

// Material amounts are free text ("20 ft", "2 sheets", "12"). Pull off a leading
// number + its unit so demand for the same product can be added up across orders.
export const parseAmount = (raw) => {
  const s = String(raw ?? "").trim();
  const m = /^([\d.,]+)\s*(.*)$/.exec(s);
  if (!m) return null;
  const n = parseFloat(m[1].replace(/,/g, ""));
  return isNaN(n) ? null : { n, unit: m[2].trim().toLowerCase() };
};

// Total a set of free-text amounts, grouped by unit: ["20 ft","12 ft"] -> "32 ft".
// Anything that doesn't parse is listed verbatim rather than dropped — a buyer
// silently missing a line would be worse than a slightly untidy total.
export const totalAmounts = (list) => {
  const byUnit = new Map();
  const asIs = [];
  for (const raw of list) {
    const p = parseAmount(raw);
    if (p) byUnit.set(p.unit, (byUnit.get(p.unit) || 0) + p.n);
    else if (String(raw ?? "").trim()) asIs.push(String(raw).trim());
  }
  const parts = [...byUnit.entries()].map(([unit, n]) => `${+n.toFixed(2)}${unit ? ` ${unit}` : ""}`);
  return [...parts, ...asIs].join(" + ");
};

// An item is blocked while any of its materials hasn't been received.
export const blocked = (it) =>
  it.needsMaterial && it.materials.some((m) => !m.received);

export const pct = (o) =>
  o.items.length
    ? o.items.filter((i) => i.stage === "done").length / o.items.length
    : 0;

export function itemStatusText(it) {
  if (it.stage === "new") return "Needs triage";
  if (it.stage === "picklist") return "On the pick list";
  if (it.stage === "awaiting") return "Waiting on material";
  if (it.stage === "workorder") return "Being made";
  return "Done";
}
