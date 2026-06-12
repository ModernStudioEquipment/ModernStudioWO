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

export const PRI = {
  RUSH: { c: C.rush, bg: C.rushBg },
  High: { c: C.high, bg: C.highBg },
  Normal: { c: C.gray, bg: C.grayBg },
};

// Click-to-cycle order: Normal -> High -> RUSH -> Normal
export const PRI_CYCLE = { Normal: "High", High: "RUSH", RUSH: "Normal" };

export const STAGES = ["new", "picklist", "workorder", "awaiting", "done"];
export const DEPTS = ["Machine", "Sewing"];
export const PRIORITIES = ["Normal", "High", "RUSH"];

export const elapsed = (ms) => {
  const m = Math.floor(ms / 60000);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
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
