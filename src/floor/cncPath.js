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

  // Feed and speed as they stand when a move is made, kept on the move so the
  // time estimate can work from the same walk. f = the F word; perRev = feed is
  // per spindle turn (a lathe's normal mode) rather than per minute; s = the S
  // word; css = S is a surface speed (G96), not rpm; clamp = G50's top speed.
  const modal = { f: 0, perRev: kind === "lathe", s: 0, css: false, clamp: 0 };
  // Things that take time but aren't moves: tool changes, dwells, operator stops.
  const events = { toolChanges: 0, dwell: 0, stops: 0 };
  // Lathe cycles the control expands itself: kept whole for the solid view and
  // the time estimate, which need more than the one line that's drawn.
  const cycles = [];
  // What a comparison of two programs needs and a drawing doesn't:
  //   opaque     lines this can't follow (macros, live tools, sub-programs),
  //              kept as written so two versions can be compared word for word
  //   offsets    which offset numbers each tool is called with (T0103 = tool 1, offset 3)
  //   unhomed    tool changes made without sending the turret or spindle home first
  //   taps       feed divided by speed on each tapping cycle: the thread's lead
  //   shifts     lines that move the coordinate system (G50 with an axis, G52, G92, G10)
  //   arrivals   where the tool lands on the first move after going home. How
  //              it gets there isn't known, so it isn't a move that's drawn;
  //              `index` is how many drawn moves come before it.
  const arrivals = [];
  const opaque = [];
  const offsets = {};
  //   homeVia    going home by way of a named point ("G28 X0. Z0."), as written
  //   homes      where the tool was each time it was sent home (null when not known)
  //   profileRapids  rapid moves written inside a roughing cycle's profile, which the finishing pass repeats as rapids
  const taps = [];
  const shifts = [];
  const homeVia = [];
  const homes = [];
  let profileRapids = 0;
  let unhomed = 0;
  let awayFromHome = false;   // has the tool moved since it was last sent home (or the program began)?
  let ended = false;          // M30 or M02 has been read: nothing after it runs
  // Moves made with a live tool (milling, cross drilling, C and Y axis) or with
  // the part in the sub-spindle. The part isn't turning under a live tool, and
  // in the sub-spindle it's somewhere else, so on a lathe these moves are
  // marked `live`: they neither turn the bar down nor get checked against it.
  let liveTool = false;       // until the next tool change
  let inSub = false;          // between G14 and G15
  const push = (a, b, type, tool, n, extra) => {
    if (segs.length >= MAX_SEGS) { full = true; return; }
    if (a[0] === b[0] && a[1] === b[1] && a[2] === b[2]) return;
    segs.push({ a, b, type, tool, line: n, f: modal.f, perRev: modal.perRev, s: modal.s, css: modal.css, clamp: modal.clamp, ...((liveTool || inSub) ? { live: true } : {}), ...extra });
  };
  // Words every line can carry, whatever the machine.
  const readModal = (line, G, M) => {
    const F = val(line, "F");
    if (F != null) modal.f = F;
    const S = val(line, "S");
    if (S != null && !G.includes(50)) modal.s = S;
    if (G.includes(4)) { // dwell: P is milliseconds on a Haas, X or U seconds
      const P = val(line, "P");
      const X = val(line, "X") ?? val(line, "U");
      events.dwell += P != null ? P / 1000 : X != null ? X : 0;
    }
    if (M.includes(0)) events.stops += 1;
  };
  const useTool = (t) => { if (t && !toolsUsed.includes(t)) toolsUsed.push(t); };

  if (kind === "lathe") walkLathe(); else walkMill();

  if (full) notes.add(`Only the first ${MAX_SEGS.toLocaleString()} moves are drawn.`);
  return { kind, segs, notes: [...notes], tools: toolsUsed, units, events, cycles, arrivals, opaque, offsets, taps, shifts, homeVia, homes, profileRapids, unhomed, bounds: boundsOf(segs), stats: statsOf(kind, segs) };

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
      if (ended) break;
      if (line.macro) { if (line.code) { notes.add("Macro lines (variables, loops) are skipped."); opaque.push(line.code.replace(/\s+/g, "")); } continue; }
      const G = gList(line);
      const M = mList(line);
      const n = line.n;
      let home = false;
      let startedCycle = false;
      readModal(line, G, M);
      if (M.includes(30) || M.includes(2)) ended = true;
      if (M.some((m) => m === 97 || m === 98) || G.some((g) => g === 65 || g === 66)) { opaque.push(line.code.replace(/\s+/g, "")); notes.add("Sub-programs aren't followed."); }
      if (G.some((g) => g === 52 || g === 92 || g === 10 || g === 51 || g === 68)) shifts.push(line.code.replace(/\s+/g, ""));
      if (G.includes(94)) modal.perRev = false;
      if (G.includes(95)) modal.perRev = true;
      if (G.includes(4)) continue; // a dwell's X is seconds, not a place

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
        else if (DRILL_CYCLES.includes(g)) {
          cycle = { z: null, r: null }; initZ = pos[2]; startedCycle = true;
          // tapping: the feed has to be the speed times the thread's lead, so their ratio is what matters
          cycle.tap = g === 84 || g === 74;
        }
        else if (g === 28 || g === 30 || g === 53) home = g === 53 ? "machine" : "via";
      }
      const t = val(line, "T");
      if (t != null) pendingT = t;
      if (M.includes(6) && pendingT) {
        if (tool !== pendingT) events.toolChanges += 1;
        tool = pendingT; useTool(tool);
        // a mill's tool change takes the spindle up by itself, so only Z matters, and the control does that
      }
      const h = val(line, "H");
      if (h != null && (tool || pendingT)) (offsets[tool || pendingT] ||= []).includes(h) || offsets[tool || pendingT].push(h);

      const w = [val(line, "X"), val(line, "Y"), val(line, "Z")];
      if (home) {
        // G28 goes home BY WAY OF the point on the line. In absolute mode
        // "G28 Z0." rapids to Z0 of the part first, which is the classic way to
        // drive a tool into the work; in incremental mode ("G91 G28 Z0.") the
        // point is where it already is. G53 goes straight there.
        homes.push({ at: pos.every((v) => v != null) ? pos.slice() : null, line: n, index: segs.length });
        if (home === "via" && abs && w.some((v) => v != null)) {
          homeVia.push(line.code.replace(/\s+/g, ""));
          if (pos.every((v) => v != null)) push(pos.slice(), [w[0] ?? pos[0], w[1] ?? pos[1], w[2] ?? pos[2]], "rapid", tool || pendingT, n);
        }
        // Then the listed axes are at the machine's home, which isn't a place in
        // the part's coordinates: lift the pen rather than draw a line to nowhere.
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
            // (at every hole, not just the first: a feed or speed changed part way down the list changes the thread)
            if (cycle.tap && modal.s > 0) taps.push({ line: n, tool: tool || pendingT, lead: modal.f / modal.s });
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
      // Coming from home (or the start of the program) the way there isn't
      // known, but where it ARRIVES is, and arriving inside the part is the
      // crash. So the arrival is kept (apart from the moves that are drawn).
      if (!known && to.every((v) => v != null)) arrivals.push({ at: to.slice(), type: motion === 0 ? "rapid" : "feed", tool: tool || pendingT, line: n, index: segs.length });
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
    let roughDepth = null; // pass depth from the first line of a two-line G71
    let thread92 = null;  // { z } while G92 is modal
    const P = (zz, xx) => [zz, 0, xx / 2];

    for (const line of lines) {
      if (ended) break;
      if (line.macro) { if (line.code) { notes.add("Macro lines (variables, loops) are skipped."); opaque.push(line.code.replace(/\s+/g, "")); } continue; }
      const G = gList(line);
      const M = mList(line);
      const n = line.n;
      const N = val(line, "N");
      if (M.includes(30) || M.includes(2)) ended = true;
      if (M.some((m) => m === 97 || m === 98) || G.some((g) => g === 65 || g === 66)) { opaque.push(line.code.replace(/\s+/g, "")); notes.add("Sub-programs aren't followed."); }

      if (G.includes(20)) units = "in";
      if (G.includes(21)) units = "mm";
      readModal(line, G, M);
      if (G.includes(98)) modal.perRev = false; // feed per minute
      if (G.includes(99)) modal.perRev = true;  // feed per turn
      if (G.includes(96)) modal.css = true;
      if (G.includes(97)) modal.css = false;
      if (G.includes(50)) { const S = val(line, "S"); if (S != null) modal.clamp = S; }
      const t = line.words.find((w) => w.l === "T");
      if (t) {
        const digits = t.raw.replace(/\D/g, "");
        const num = digits.length >= 3 ? Math.floor(t.v / 100) : t.v;
        if (num) {
          if (tool !== num) {
            events.toolChanges += 1;
            liveTool = false;
            // The turret swings every tool round when it indexes. Doing that
            // with the last tool still beside the part is how tools get broken.
            if (awayFromHome) unhomed += 1;
          }
          tool = num;
          // (offset 00 cancels the offset, on the way home: it isn't a different offset)
          if (digits.length >= 3 && t.v % 100 !== 0) (offsets[num] ||= []).includes(t.v % 100) || offsets[num].push(t.v % 100);
        }
      }
      if (G.includes(4)) continue; // a dwell's X or U is seconds, not a place
      if (val(line, "Y") != null || val(line, "C") != null || M.some((m) => [19, 133, 134, 143, 144, 154].includes(m)) || G.some((g) => g === 14 || g === 15 || g === 112)) {
        if (G.includes(14)) inSub = true;
        if (G.includes(15)) inSub = false;
        if (val(line, "Y") != null || val(line, "C") != null || M.some((m) => [19, 133, 134, 143, 144, 154].includes(m)) || G.includes(112)) liveTool = true;
        notes.add("Live tooling, C/Y axis and sub-spindle moves aren't drawn.");
        opaque.push(line.code.replace(/\s+/g, ""));
      }
      if (G.some((g) => g === 52 || g === 10)) shifts.push(line.code.replace(/\s+/g, ""));

      if (G.some((g) => g === 28 || g === 30 || g === 53)) {
        // G28 goes home BY WAY OF the point on the line: "G28 U0. W0." goes
        // straight there, but "G28 X0. Z0." rapids to the centre of the face
        // first. (G53 has no such point.)
        homes.push({ at: x != null && z != null ? P(z, x) : null, line: n, index: segs.length });
        if (!G.includes(53) && (val(line, "X") != null || val(line, "Z") != null || (val(line, "U") ?? 0) !== 0 || (val(line, "W") ?? 0) !== 0)) homeVia.push(line.code.replace(/\s+/g, ""));
        if (!G.includes(53) && x != null && z != null) {
          const vx = val(line, "X") ?? (val(line, "U") != null ? x + val(line, "U") : x);
          const vz = val(line, "Z") ?? (val(line, "W") != null ? z + val(line, "W") : z);
          if (vx !== x || vz !== z) push(P(z, x), P(vz, vx), "rapid", tool, n);
        }
        x = null; z = null; awayFromHome = false;
        continue;
      }
      if (G.includes(50)) {
        // With an axis word G50 isn't a speed limit, it moves the coordinate system.
        if (["X", "Z", "U", "W"].some((l) => val(line, l) != null)) shifts.push(line.code.replace(/\s+/g, ""));
        continue;
      }

      const X = val(line, "X");
      const Z = val(line, "Z");
      const U = val(line, "U");
      const W = val(line, "W");

      if (G.some((g) => g === 71 || g === 72 || g === 73)) {
        const p = val(line, "P");
        const q = val(line, "Q");
        if (p != null && q != null) {
          profile = { p, q, on: false };
          notes.add("Roughing passes aren't drawn, only the shape they cut down to.");
          // Depth of each pass: D on the one-line form, U on the first line of
          // the two-line form (remembered from the line before).
          cycles.push({ kind: "rough", line: n, face: G.includes(72), x, z, depth: val(line, "D") ?? roughDepth ?? 0, allowX: val(line, "U") ?? 0, allowZ: val(line, "W") ?? 0, p, q, f: modal.f, perRev: modal.perRev, s: modal.s, css: modal.css, clamp: modal.clamp, tool, from: segs.length });
        } else {
          roughDepth = val(line, "U"); // "G71 U0.08 R0.02": the pass depth for the line that follows
        }
        continue; // the cycle line's U and W are finish allowances, not moves
      }
      if (G.includes(70)) { // finishing re-runs the profile already drawn, at this line's feed
        cycles.push({ kind: "finish", line: n, p: val(line, "P"), q: val(line, "Q"), f: modal.f, perRev: modal.perRev, s: modal.s, css: modal.css, clamp: modal.clamp, tool });
        continue;
      }

      if (G.includes(76)) { // threading cycle: drawn as the thread's final pass
        // The end of the thread as X and Z, or as U and W measured from the
        // start. (The first line of the two-line form has neither: skipped.)
        const endX = X ?? (U != null && x != null ? x + U : null);
        const endZ = Z ?? (W != null && z != null ? z + W : null);
        if (x != null && z != null && endX != null && endZ != null) {
          useTool(tool);
          // pitch = F (the lead); K = thread height, D = first pass depth, both
          // as radius. The two-line form gives those as P and Q with no decimal
          // point, in ten-thousandths.
          const scaled = (l) => (val(line, l) != null ? val(line, l) / 10000 : null);
          push(P(z, endX), P(endZ, endX), "thread", tool, n, { pitch: modal.f, height: val(line, "K") ?? scaled("P") ?? 0, firstCut: val(line, "D") ?? scaled("Q") ?? 0, fromDia: x });
        }
        thread92 = null;
        continue;
      }
      if (G.includes(92)) thread92 = { z: null };
      const moved = G.find((g) => g === 0 || g === 1 || g === 2 || g === 3 || g === 32);
      if (moved != null) { motion = moved; thread92 = null; }

      if (thread92) {
        if (Z != null) thread92.z = Z;
        if (X != null && z != null && thread92.z != null) { useTool(tool); push(P(z, X), P(thread92.z, X), "thread", tool, n, { pitch: modal.f, fromDia: x ?? X }); }
        continue;
      }
      if (G.includes(74) || G.some((g) => g >= 81 && g <= 89)) { // peck drill / drill along Z, back to where it started
        // tapping on a lathe: the feed per turn IS the thread's lead
        if (G.includes(84) && modal.f > 0) taps.push({ line: n, tool, lead: modal.perRev ? modal.f : modal.s > 0 ? modal.f / modal.s : 0 });
        if (x != null && z != null && Z != null) { useTool(tool); push(P(z, x), P(Z, x), "feed", tool, n); }
        continue;
      }
      if (G.includes(75)) { // peck groove in X
        if (x != null && z != null && X != null) { useTool(tool); push(P(z, x), P(z, X), "groove", tool, n); }
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
      // A rapid written inside the profile (after its first line) is cut as a
      // feed while roughing, but the finishing pass runs it as the rapid it is,
      // through the metal left for finishing.
      if (profile?.on && !approach && motion === 0) profileRapids += 1;
      const type = approach ? "rapid" : profile?.on ? "profile" : motion === 0 ? "rapid" : motion === 32 ? "thread" : "feed";
      // a single threading pass (G32): the feed is the lead, as on the cycles
      const more = type === "thread" ? { pitch: modal.f, fromDia: x ?? tx } : undefined;

      // Coming from home (or the start of the program) the way there isn't
      // known, but where it ARRIVES is, and arriving inside the bar is the
      // crash. So the arrival is kept (apart from the moves that are drawn).
      if ((x == null || z == null) && tx != null && tz != null) arrivals.push({ at: P(tz, tx), type, tool, line: n, index: segs.length });
      if (tx != null && tz != null) awayFromHome = true;

      if (x != null && z != null && tx != null && tz != null) {
        if (type !== "rapid") useTool(tool);
        if (motion === 2 || motion === 3) {
          const s = [z, x / 2];
          const e = [tz, tx / 2];
          const i = val(line, "I");
          const k = val(line, "K");
          const r = val(line, "R");
          const c = i != null || k != null ? [z + (k ?? 0), x / 2 + (i ?? 0)] : arcCenterFromR(s, e, r, motion === 2);
          if (!c) push(P(z, x), P(tz, tx), type, tool, n, more);
          else {
            let prev = [z, 0, x / 2];
            for (const p of arcPoints(s, e, c, motion === 2)) {
              const next = [p[0], 0, p[1]];
              push(prev, next, type === "rapid" ? "feed" : type, tool, n);
              prev = next;
            }
          }
        } else {
          push(P(z, x), P(tz, tx), type, tool, n, more);
        }
      }
      x = tx; z = tz;
      if (profile?.on && N === profile.q) {
        const c = cycles.findLast?.((k) => k.kind === "rough" && k.to == null) || [...cycles].reverse().find((k) => k.kind === "rough" && k.to == null);
        if (c) c.to = segs.length;
        profile = null;
      }
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
