// Modern Studio Equipment — visual language.
// Black-and-white industrial; color is reserved for MEANING only:
// red = RUSH, amber = waiting/ordering, green = ready/done, blue = in-progress.

export const C = {
  ink: "#171717",
  inkSoft: "#3D3D3B",
  concrete: "#ECEAE6",
  surface: "#FFFFFF",
  line: "#D6D4CF",
  rush: "#C8102E",
  rushBg: "#FAE6E9",
  high: "#B26A00",
  highBg: "#FAEFD9",
  blue: "#27557F",
  blueBg: "#E8EEF4",
  green: "#1E7A4B",
  greenBg: "#E3F0E9",
  gold: "#9C7A0F",
  goldBg: "#F7EFCB",
  gray: "#6E6C68",
  grayBg: "#EBEAE6",
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
// priority and the due-soon auto-bump. Returns a stored value (RUSH/High/Normal).
export const effectivePriority = (order, now = Date.now()) =>
  dueSoon(order.dueDate, now) ? "RUSH" : (order.priority || "Normal");

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

export const elapsed = (ms) => {
  const m = Math.floor(ms / 60000);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
};

// Format a "YYYY-MM-DD" due date as e.g. "Jun 20". Parsed at local midnight so
// it doesn't shift a day in negative-offset timezones.
export const dueLabel = (d) => {
  if (!d) return "";
  const dt = new Date(`${d}T00:00:00`);
  return isNaN(dt) ? d : dt.toLocaleDateString("en-US", { month: "short", day: "numeric" });
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
