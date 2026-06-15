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
