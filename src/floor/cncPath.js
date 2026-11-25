// The path a program's tool takes, worked out from the G-code so it can be
// drawn. This follows the moves the way the control would (rapids, straight
// cuts, arcs, drilling cycles, lathe profiles and threads) and returns them as
// line segments in 3D.
//
// It is a drawing of where the tool goes, not a simulation: it knows nothing
// about the stock, the fixture, tool diameters or work offsets, and it draws
// the profile a lathe roughing cycle works to rather than every pass. What it
// can't draw it says so in `notes`, never silently.
//
// Coordinates:
//   mill   [X, Y, Z] as programmed.
//   lathe  [Z, 0, radius]: Z along the part, radius up. X is programmed as a
//          diameter on a lathe, so radius = X / 2. The viewer spins this
//          profile round the Z axis to show the turned shape.

import { parseLines, programInfo } from "./cncGcode.js";

const TAU = Math.PI * 2;
const MAX_SEGS = 150000;
const DRILL_CYCLES = [73, 74, 76, 81, 82, 83, 84, 85, 86, 89];

const val = (line, l) => { const w = line.words.find((x) => x.l === l); return w ? w.v : null; };
const gList = (line) => line.words.filter((w) => w.l === "G").map((w) => w.v);
const mList = (line) => line.words.filter((w) => w.l === "M").map((w) => w.v);

// ---- arcs (2D, in the plane being cut) --------------------------------------
//
// cw = clockwise as drawn with the first axis to the right and the second up.
// That's G02 in the XY plane on a mill, and G02 on a rear-turret lathe drawn
// with Z to the right and X up.
export function arcCenterFromR(s, e, r, cw) {
  const dx = e[0] - s[0];
  const dy = e[1] - s[1];
  const L = Math.hypot(dx, dy);
  if (L < 1e-9 || !r) return null;
  const h = Math.sqrt(Math.max(0, r * r - (L / 2) * (L / 2)));
  // Travelling s -> e, a clockwise arc has its centre on the right, a
  // counter-clockwise one on the left. A negative R is the long way round.
  let side = cw ? 1 : -1;
  if (r < 0) side = -side;
  return [(s[0] + e[0]) / 2 + side * (dy / L) * h, (s[1] + e[1]) / 2 - side * (dx / L) * h];
}

// Points along the arc from s to e round c, excluding s, ending exactly on e.
export function arcPoints(s, e, c, cw) {
  const a0 = Math.atan2(s[1] - c[1], s[0] - c[0]);
  const a1 = Math.atan2(e[1] - c[1], e[0] - c[0]);
  let sweep = a1 - a0;
  if (cw) { if (sweep >= -1e-9) sweep -= TAU; } else if (sweep <= 1e-9) sweep += TAU;
  const r = Math.hypot(s[0] - c[0], s[1] - c[1]);
  const n = Math.max(2, Math.ceil(Math.abs(sweep) / (Math.PI / 24)));
  const pts = [];
  for (let i = 1; i < n; i++) {
    const a = a0 + (sweep * i) / n;
    pts.push([c[0] + r * Math.cos(a), c[1] + r * Math.sin(a)]);
  }
  pts.push([e[0], e[1]]);
  return pts;
}

// ---- the walk ---------------------------------------------------------------
export function toolpath(content, { kind: machineKind = "" } = {}) {
  const lines = parseLines(content);
  const info = programInfo(content);
  const kind = info.kind || machineKind || "mill";
  const segs = [];
  const notes = new Set();
  const toolsUsed = [];
  let units = "";
  let full = false;

  const push = (a, b, type, tool, n) => {
    if (segs.length >= MAX_SEGS) { full = true; return; }
    if (a[0] === b[0] && a[1] === b[1] && a[2] === b[2]) return;
    segs.push({ a, b, type, tool, line: n });
  };
  const useTool = (t) => { if (t && !toolsUsed.includes(t)) toolsUsed.push(t); };

  if (kind === "lathe") walkLathe(); else walkMill();

  if (full) notes.add(`Only the first ${MAX_SEGS.toLocaleString()} moves are drawn.`);
  return { kind, segs, notes: [...notes], tools: toolsUsed, units, bounds: boundsOf(segs), stats: statsOf(kind, segs) };

  // -- mill -------------------------------------------------------------------
  function walkMill() {
    const pos = [null, null, null];
    let abs = true;
    let motion = 0;
    let plane = 17;
    let cycle = null;       // { z, r } while a drilling cycle is on
    let retractToR = false; // G99; G98 (back to where it started) is the default
    let initZ = null;
    let tool = 0;
    let pendingT = 0;

    for (const line of lines) {
      if (line.macro) { if (line.code) notes.add("Macro lines (variables, loops) are skipped."); continue; }
      const G = gList(line);
      const M = mList(line);
      const n = line.n;
      let home = false;
      let startedCycle = false;

      for (const g of G) {
        if (g === 20) units = "in";
        else if (g === 21) units = "mm";
        else if (g === 90) abs = true;
        else if (g === 91) abs = false;
        else if (g === 17 || g === 18 || g === 19) plane = g;
        else if (g === 98) retractToR = false;
        else if (g === 99) retractToR = true;
        else if (g === 80) cycle = null;
        else if (g === 0 || g === 1 || g === 2 || g === 3) { motion = g; cycle = null; }
        else if (DRILL_CYCLES.includes(g)) { cycle = { z: null, r: null }; initZ = pos[2]; startedCycle = true; }
        else if (g === 28 || g === 30 || g === 53) home = true;
      }
      const t = val(line, "T");
      if (t != null) pendingT = t;
      if (M.includes(6) && pendingT) { tool = pendingT; useTool(tool); }

      const w = [val(line, "X"), val(line, "Y"), val(line, "Z")];
      if (home) {
        // The listed axes go to the machine's home, which isn't a place in the
        // part's coordinates: lift the pen rather than draw a line to nowhere.
        w.forEach((v, i) => { if (v != null) pos[i] = null; });
        if (w.every((v) => v == null)) pos.fill(null);
        continue;
      }
      const at = (i) => (w[i] == null ? pos[i] : abs ? w[i] : (pos[i] ?? 0) + w[i]);

      if (cycle) {
        if (w[2] != null) cycle.z = abs ? w[2] : (pos[2] ?? 0) + w[2];
        const r = val(line, "R");
        if (r != null) cycle.r = r;
        if (startedCycle || w[0] != null || w[1] != null) {
          const hx = at(0);
          const hy = at(1);
          if (hx != null && hy != null && cycle.z != null) {
            const startZ = pos[2] ?? initZ ?? cycle.r ?? cycle.z;
            const top = retractToR && cycle.r != null ? cycle.r : (initZ ?? cycle.r ?? startZ);
            const who = tool || pendingT;
            useTool(who);
            if (pos[0] != null && pos[1] != null) push([pos[0], pos[1], startZ], [hx, hy, startZ], "rapid", who, n);
            const rz = cycle.r ?? startZ;
            push([hx, hy, startZ], [hx, hy, rz], "rapid", who, n);
            push([hx, hy, rz], [hx, hy, cycle.z], "feed", who, n);
            push([hx, hy, cycle.z], [hx, hy, top], "rapid", who, n);
            pos[0] = hx; pos[1] = hy; pos[2] = top;
          }
        }
        continue;
      }

      // A full circle is often written with no end point at all ("G03 I-0.5"):
      // it ends where it starts, so a line with only I/J is still a move.
      const circle = (motion === 2 || motion === 3) && (val(line, "I") != null || val(line, "J") != null);
      if (w.every((v) => v == null) && !circle) continue;
      const to = [at(0), at(1), at(2)];
      const known = pos.every((v) => v != null) && to.every((v) => v != null);
      if (known) {
        const who = tool || pendingT;
        if (motion !== 0) useTool(who);
        if (motion === 2 || motion === 3) {
          if (plane !== 17) {
            notes.add("Arcs outside the XY plane (G18, G19) are drawn as straight lines.");
            push(pos.slice(), to, "feed", who, n);
          } else {
            const s = [pos[0], pos[1]];
            const e = [to[0], to[1]];
            const i = val(line, "I");
            const j = val(line, "J");
            const r = val(line, "R");
            const c = i != null || j != null ? [pos[0] + (i ?? 0), pos[1] + (j ?? 0)] : arcCenterFromR(s, e, r, motion === 2);
            if (!c) push(pos.slice(), to, "feed", who, n);
            else {
              const pts = arcPoints(s, e, c, motion === 2);
              let prev = pos.slice();
              pts.forEach((p, k) => {
                const z = pos[2] + ((to[2] - pos[2]) * (k + 1)) / pts.length; // a helix when Z moves too
                const next = [p[0], p[1], z];
                push(prev, next, "feed", who, n);
                prev = next;
              });
            }
          }
        } else {
          push(pos.slice(), to, motion === 0 ? "rapid" : "feed", who, n);
        }
      }
      pos[0] = to[0]; pos[1] = to[1]; pos[2] = to[2];
    }
  }

  // -- lathe ------------------------------------------------------------------
  function walkLathe() {
    let x = null; // diameter, as programmed
    let z = null;
    let motion = 0;
    let tool = 0;
    let profile = null;   // { p, q, on } while inside a roughing cycle's profile
    let thread92 = null;  // { z } while G92 is modal
    const P = (zz, xx) => [zz, 0, xx / 2];

    for (const line of lines) {
      if (line.macro) { if (line.code) notes.add("Macro lines (variables, loops) are skipped."); continue; }
      const G = gList(line);
      const M = mList(line);
      const n = line.n;
      const N = val(line, "N");

      if (G.includes(20)) units = "in";
      if (G.includes(21)) units = "mm";
      const t = line.words.find((w) => w.l === "T");
      if (t) {
        const digits = t.raw.replace(/\D/g, "");
        const num = digits.length >= 3 ? Math.floor(t.v / 100) : t.v;
        if (num) { tool = num; }
      }
      if (val(line, "Y") != null || val(line, "C") != null || M.some((m) => [19, 133, 134, 143, 144, 154].includes(m)) || G.some((g) => g === 14 || g === 15 || g === 112)) {
        notes.add("Live tooling, C/Y axis and sub-spindle moves aren't drawn.");
      }

      if (G.some((g) => g === 28 || g === 30 || g === 53)) { x = null; z = null; continue; }
      if (G.includes(50)) continue; // speed limit (or an old-style shift): not a move

      const X = val(line, "X");
      const Z = val(line, "Z");
      const U = val(line, "U");
      const W = val(line, "W");

      if (G.some((g) => g === 71 || g === 72 || g === 73)) {
        const p = val(line, "P");
        const q = val(line, "Q");
        if (p != null && q != null) {
          profile = { p, q, on: false };
          notes.add("A roughing cycle is drawn as the profile it cuts down to, not each pass.");
        }
        continue; // the cycle line's U and W are finish allowances, not moves
      }
      if (G.includes(70)) continue; // finishing re-runs the profile already drawn

      if (G.includes(76)) { // threading cycle: drawn as the thread's final pass
        if (x != null && z != null && X != null && Z != null) { useTool(tool); push(P(z, X), P(Z, X), "thread", tool, n); }
        thread92 = null;
        continue;
      }
      if (G.includes(92)) thread92 = { z: null };
      const moved = G.find((g) => g === 0 || g === 1 || g === 2 || g === 3 || g === 32);
      if (moved != null) { motion = moved; thread92 = null; }

      if (thread92) {
        if (Z != null) thread92.z = Z;
        if (X != null && z != null && thread92.z != null) { useTool(tool); push(P(z, X), P(thread92.z, X), "thread", tool, n); }
        continue;
      }
      if (G.includes(74) || G.some((g) => g >= 81 && g <= 89)) { // peck drill / drill along Z, back to where it started
        if (x != null && z != null && Z != null) { useTool(tool); push(P(z, x), P(Z, x), "feed", tool, n); }
        continue;
      }
      if (G.includes(75)) { // peck groove in X
        if (x != null && z != null && X != null) { useTool(tool); push(P(z, x), P(z, X), "feed", tool, n); }
        continue;
      }

      if (X == null && Z == null && U == null && W == null) continue;
      const tx = X != null ? X : U != null && x != null ? x + U : x;
      const tz = Z != null ? Z : W != null && z != null ? z + W : z;

      // The profile's first line (N-P) is the move from where the cycle started
      // to where the shape begins. It's an approach, not part of the shape, so it
      // doesn't count toward the part's diameters.
      const approach = !!profile && !profile.on && N === profile.p;
      if (approach) profile.on = true;
      const type = approach ? "rapid" : profile?.on ? "profile" : motion === 0 ? "rapid" : motion === 32 ? "thread" : "feed";

      if (x != null && z != null && tx != null && tz != null) {
        if (type !== "rapid") useTool(tool);
        if (motion === 2 || motion === 3) {
          const s = [z, x / 2];
          const e = [tz, tx / 2];
          const i = val(line, "I");
          const k = val(line, "K");
          const r = val(line, "R");
          const c = i != null || k != null ? [z + (k ?? 0), x / 2 + (i ?? 0)] : arcCenterFromR(s, e, r, motion === 2);
          if (!c) push(P(z, x), P(tz, tx), type, tool, n);
          else {
            let prev = [z, 0, x / 2];
            for (const p of arcPoints(s, e, c, motion === 2)) {
              const next = [p[0], 0, p[1]];
              push(prev, next, type === "rapid" ? "feed" : type, tool, n);
              prev = next;
            }
          }
        } else {
          push(P(z, x), P(tz, tx), type, tool, n);
        }
      }
      x = tx; z = tz;
      if (profile?.on && N === profile.q) profile = null;
    }
  }
}

// ---- measuring what was drawn -----------------------------------------------
export function boundsOf(segs) {
  if (!segs.length) return null;
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const s of segs) for (const p of [s.a, s.b]) for (let i = 0; i < 3; i++) { if (p[i] < min[i]) min[i] = p[i]; if (p[i] > max[i]) max[i] = p[i]; }
  return { min, max };
}

// The numbers worth checking against the stock before running: how far the
// CUTTING moves reach (rapids to a clearance height aren't the part).
export function statsOf(kind, segs) {
  const cut = segs.filter((s) => s.type !== "rapid");
  const b = boundsOf(cut);
  if (!b) return null;
  if (kind === "lathe") {
    return { kind, maxDia: b.max[2] * 2, minDia: b.min[2] * 2, zMin: b.min[0], zMax: b.max[0], cuts: cut.length, rapids: segs.length - cut.length };
  }
  return { kind, x: [b.min[0], b.max[0]], y: [b.min[1], b.max[1]], zMin: b.min[2], zMax: b.max[2], cuts: cut.length, rapids: segs.length - cut.length };
}

// ---- looking at it ----------------------------------------------------------
//
// The view is a turn round the vertical axis (yaw) and a tilt (pitch), both in
// degrees. Pitch 0 looks straight down the Z axis (a top view on a mill), pitch
// 90 looks from the front. No perspective: parallel lines stay parallel, like a
// drawing, so sizes can be compared by eye.
export function project(p, yaw, pitch) {
  const a = (yaw * Math.PI) / 180;
  const t = (pitch * Math.PI) / 180;
  const x = p[0] * Math.cos(a) - p[1] * Math.sin(a);
  const y = p[0] * Math.sin(a) + p[1] * Math.cos(a);
  return [x, y * Math.cos(t) + p[2] * Math.sin(t)];
}

export const VIEWS = {
  mill: [
    { key: "3d", label: "3D", yaw: -30, pitch: 60 },
    { key: "top", label: "Top", yaw: 0, pitch: 0 },
    { key: "front", label: "Front", yaw: 0, pitch: 90 },
    { key: "side", label: "Side", yaw: -90, pitch: 90 },
  ],
  lathe: [
    { key: "side", label: "Side", yaw: 0, pitch: 90 },
    { key: "3d", label: "3D", yaw: -35, pitch: 68 },
    { key: "end", label: "End", yaw: -90, pitch: 90 },
  ],
};
