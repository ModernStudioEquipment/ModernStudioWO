// The four floor departments, each with its own signature color so a monitor is
// identifiable across the room. `db` matches items.dept in the database.
export const FLOOR_DEPTS = {
  shop:   { key: "shop",   label: "Shop",   db: "Shop",   accent: "#4EA3FF", draw: "#7FB8FF" },
  cnc:    { key: "cnc",    label: "CNC",    db: "CNC",    accent: "#FFB224", draw: "#74D0E6" },
  sewing: { key: "sewing", label: "Sewing", db: "Sewing", accent: "#F472B6", draw: "#F9A8D4" },
  saw:    { key: "saw",    label: "Saw",    db: "Saw",    accent: "#7DD35B", draw: "#B6E89B" },
};

export const DEPT_ORDER = ["shop", "cnc", "sewing", "saw"];

// Leave a monitor/picker screen: close the tab if it was opened as one, else
// drop the #floor hash and return to the office app in place.
export function exitMonitor() {
  try {
    sessionStorage.removeItem("mse_floor"); // stop remembering this tab as a floor monitor
  } catch {
    /* ignore */
  }
  try {
    window.close();
  } catch {
    /* ignore */
  }
  setTimeout(() => {
    if (!window.closed) window.location.href = window.location.origin + window.location.pathname;
  }, 120);
}
