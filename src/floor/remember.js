// Where someone was, kept for this browser tab so a refresh puts them back
// there. sessionStorage on purpose: it's per tab and gone when the tab closes,
// so a new tab still opens in the office and nothing follows anyone around.
//
// A stored value is only ever a hint. Callers check it against what's allowed
// now (`oneOf`), because a tab name saved last week may not exist any more.
export function recall(key, oneOf = null, fallback = "") {
  try {
    const v = sessionStorage.getItem(key);
    if (v == null) return fallback;
    return !oneOf || oneOf.includes(v) ? v : fallback;
  } catch {
    return fallback; // private mode, storage off: just don't remember
  }
}
export function remember(key, value) {
  try {
    if (value == null || value === "") sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, String(value));
  } catch { /* fine */ }
}
