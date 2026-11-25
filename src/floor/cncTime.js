// About how long a program runs, worked out from its feeds and distances.
//
// It's an estimate for quoting and scheduling, not a stopwatch. Cutting moves
// are timed exactly as programmed (distance over feed). What the control
// expands by itself is estimated: the passes of a lathe roughing cycle, the
// passes of a thread, peck cycles. Rapids, tool changes and acceleration use
// typical Haas figures. Operator stops (M00) aren't timed at all, and are
// reported so nobody mistakes the number for door-to-door time.

const RAPID = { in: 500, mm: 12700 };          // per minute, an average that allows for speeding up and slowing down
const RAPID_SETTLE = 0.12;                      // seconds lost at each rapid move
const TOOL_CHANGE = { mill: 6, lathe: 2.2 };   // seconds
const LATHE_TOP_RPM = 3000;                     // used when the program sets no limit (G50 S)

const dist = (s) => Math.hypot(s.b[0] - s.a[0], s.b[1] - s.a[1], s.b[2] - s.a[2]);

// Spindle speed for a move. In constant surface speed (G96) the S word is feet
// per minute (metres per minute in metric) and the rpm depends on the diameter
// being cut, held under the program's limit.
function rpmOf(m, radius, mm) {
  if (!m.css) return m.s || 0;
  const dia = Math.max(radius * 2, 1e-6);
  const rpm = mm ? (m.s * 1000) / (Math.PI * dia) : (m.s * 12) / (Math.PI * dia);
  return Math.min(rpm, m.clamp || LATHE_TOP_RPM);
}
// Feed in units per minute, or 0 when the program doesn't give enough to know.
function feedPerMin(m, radius, mm) {
  if (!m.f) return 0;
  return m.perRev ? m.f * rpmOf(m, radius, mm) : m.f;
}

export function estimateTime(path) {
  if (!path?.segs?.length) return null;
  const mm = path.units === "mm";
  const rapid = RAPID[mm ? "mm" : "in"];
  const lathe = path.kind === "lathe";
  const parts = { cutting: 0, rapids: 0, toolChanges: 0, dwell: 0, roughing: 0, threading: 0 };
  let unknown = 0;

  const inProfile = new Set();
  for (const c of path.cycles || []) if (c.kind === "rough" && c.to != null) for (let i = c.from; i < c.to; i++) inProfile.add(i);

  path.segs.forEach((s, i) => {
    const len = dist(s);
    if (s.type === "rapid") { parts.rapids += (len / rapid) * 60 + RAPID_SETTLE; return; }
    if (inProfile.has(i)) return; // timed with its cycle, below
    const radius = lathe ? (s.a[2] + s.b[2]) / 2 : 0;
    if (s.type === "thread") {
      const rpm = rpmOf(s, radius, mm);
      const pitch = s.pitch || s.f;
      if (!rpm || !pitch) { unknown += 1; return; }
      // A threading cycle takes several passes, each a little shallower than
      // the last: about (height / first cut) squared, plus a couple of spring
      // passes. A single G92 or G32 line is one pass.
      const passes = s.height && s.firstCut ? Math.max(3, Math.min(40, Math.ceil((s.height / s.firstCut) ** 2) + 2)) : 1;
      parts.threading += passes * ((len / (pitch * rpm)) * 60 + (len / rapid) * 60 + 0.8);
      return;
    }
    const f = feedPerMin(s, radius, mm);
    if (!f) { unknown += 1; return; }
    const t = (len / f) * 60;
    if (s.type === "groove") parts.cutting += t * 1.5 + (len / rapid) * 60; // pecks, then out
    else parts.cutting += t;
  });

  // Lathe roughing: passes from where the cycle starts down to the profile,
  // each as long as the part is still above that pass. Then one pass along the
  // profile to clean up, and another for each G70 that finishes it.
  for (const c of path.cycles || []) {
    if (c.kind !== "rough" || c.to == null || c.x == null) continue;
    const prof = path.segs.slice(c.from, c.to).filter((s) => s.type === "profile");
    if (!prof.length) continue;
    const startR = c.x / 2;
    const depth = c.depth > 0 ? c.depth : mm ? 1.5 : 0.06;
    const rMin = Math.min(...prof.flatMap((s) => [s.a[2], s.b[2]]));
    const passes = Math.max(0, Math.min(400, Math.ceil((startR - rMin) / depth)));
    for (let k = 1; k <= passes; k++) {
      const r = Math.max(rMin, startR - k * depth);
      let len = 0; // how much of the part's length is still above this pass
      for (const s of prof) {
        const lo = Math.min(s.a[2], s.b[2]);
        const hi = Math.max(s.a[2], s.b[2]);
        const dz = Math.abs(s.b[0] - s.a[0]);
        if (hi <= r) len += dz;
        else if (lo < r) len += dz * ((r - lo) / Math.max(hi - lo, 1e-9));
      }
      const f = feedPerMin(c, r, mm);
      if (!f) { unknown += 1; break; }
      parts.roughing += (len / f) * 60 + (len / rapid) * 60 + 0.4;
    }
    const along = prof.reduce((n, s) => n + dist(s), 0);
    const rMid = (startR + rMin) / 2;
    const fRough = feedPerMin(c, rMid, mm);
    if (fRough) parts.roughing += (along / fRough) * 60;
    for (const fin of (path.cycles || []).filter((x) => x.kind === "finish" && x.p === c.p && x.q === c.q)) {
      // a feed written inside the profile is the finishing feed; else the G70 line's
      const m = prof.find((s) => s.f && s.f !== c.f) || fin;
      const f = feedPerMin({ ...fin, f: m.f || fin.f }, rMid, mm);
      if (f) parts.cutting += (along / f) * 60; else unknown += 1;
    }
  }

  parts.toolChanges = (path.events?.toolChanges || 0) * TOOL_CHANGE[lathe ? "lathe" : "mill"];
  parts.dwell = path.events?.dwell || 0;
  const seconds = Object.values(parts).reduce((a, b) => a + b, 0);
  return {
    seconds, parts,
    stops: path.events?.stops || 0,
    // Moves that couldn't be timed because the program gives no feed or speed
    // for them. Any of these means the real time is longer.
    unknown,
  };
}

// "45 s", "2 min 40 s", "1 h 5 min".
export function fmtDuration(seconds) {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s} s`;
  if (s < 3600) { const m = Math.floor(s / 60); const r = s % 60; return r ? `${m} min ${r} s` : `${m} min`; }
  const h = Math.floor(s / 3600);
  const m = Math.round((s % 3600) / 60);
  return m ? `${h} h ${m} min` : `${h} h`;
}
