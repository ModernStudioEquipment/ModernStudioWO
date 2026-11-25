// Reading a program as text, line by line, for the questions that following
// the tool can't answer:
//
//   is it the same program?   every line of code compared word for word, so a
//                             rewrite that only changes comments (or slows
//                             something down) can be told from one that
//                             changes what the machine does
//   what wasn't followed?     every word the tool follower doesn't use (a peck
//                             amount, a taper, a compensation number, a code
//                             it doesn't know) is listed, so two programs can
//                             be held to having the same ones
//   will the Haas read it     block-delete lines, a % in the middle, a bracket
//   the way the app did?      that never closes, a line that isn't G-code
//
// The rule it serves: a word either moves the model (and is measured) or has
// to be unchanged. Nothing is allowed to be simply not looked at.

import { parseLines } from "./cncGcode.js";

const num = (raw) => String(Number(raw));
// A coordinate with no decimal point means something else on a Haas (X1 can be
// 0.0001), so whether the point is there is part of what the word says.
const POINTED = "XYZUWIJKRABC";
const word = (w) => `${w.l}${num(w.raw)}${POINTED.includes(w.l) && Number(w.raw) !== 0 && !w.raw.includes(".") ? "(no point)" : ""}`;

// G and M codes the follower acts on. Any other one is carried through as a
// word it didn't use.
const KNOWN_G = {
  lathe: [0, 1, 2, 3, 4, 18, 20, 21, 28, 30, 32, 40, 50, 53, 54, 55, 56, 57, 58, 59, 70, 71, 72, 73, 74, 75, 76, 80, 81, 82, 83, 84, 85, 86, 89, 92, 96, 97, 98, 99, 154],
  mill: [0, 1, 2, 3, 4, 17, 20, 21, 28, 30, 53, 54, 55, 56, 57, 58, 59, 73, 74, 76, 80, 81, 82, 83, 84, 85, 86, 89, 90, 91, 94, 95, 98, 99, 154],
};
const KNOWN_M = [0, 1, 2, 3, 4, 5, 6, 8, 9, 30, 88, 89];
// Letters the follower reads on each kind of line. Everything else on that
// line is a word it didn't use.
function lettersRead(kind, G, motion, plane, inCycle) {
  const has = (...v) => G.some((g) => v.includes(g));
  if (kind === "lathe") {
    if (has(71, 72, 73)) return "GMNOPQUWDFST";
    if (has(70)) return "GMNOPQFST";
    if (has(76)) return "GMNOXZUWKDFST";
    if (has(75)) return "GMNOXFST";
    if (has(74, 81, 82, 83, 84, 85, 86, 89)) return "GMNOZFST";
    if (has(92)) return "GMNOXZFST";
    if (has(4)) return "GMNOPXUFST";
    if (has(50)) return "GMNOSXZUW";
    if (has(2, 3) || ((motion === 2 || motion === 3) && !has(0, 1))) return "GMNOXZUWIKRFST";
    return "GMNOXZUWFSTP";   // (P: an offset number on G154)
  }
  if (has(73, 74, 76, 81, 82, 83, 84, 85, 86, 89) || inCycle) return "GMNOXYZRFSTH";
  if (has(4)) return "GMNOPXFST";
  if (has(2, 3) || ((motion === 2 || motion === 3) && !has(0, 1))) return plane === 17 ? "GMNOXYZIJRFSTH" : "GMNOXYZFSTH";
  return "GMNOXYZFSTHP";
}

export function scan(content, kind = "lathe") {
  const rawLines = String(content || "").replace(/\r\n?/g, "\n").split("\n");
  const lines = parseLines(content);
  const k = kind === "mill" ? "mill" : "lathe";

  // -- things the control reads differently from this app
  const percents = rawLines.map((t, i) => (t.trim() === "%" ? i : -1)).filter((i) => i >= 0);
  const firstText = rawLines.findIndex((t) => t.trim());
  const lastText = rawLines.length - 1 - rawLines.slice().reverse().findIndex((t) => t.trim());
  const midPercent = percents.find((i) => i !== firstText && i !== lastText);
  const unbalanced = rawLines.findIndex((t) => (t.match(/\(/g) || []).length !== (t.match(/\)/g) || []).length);
  const junk = [];
  const slashed = [];
  rawLines.forEach((t, i) => {
    const code = t.replace(/\([^)]*\)/g, " ").replace(/;.*$/, " ").trim();
    if (!code || code === "%") return;
    if (/^\//.test(code)) slashed.push(code.replace(/\s+/g, "").toUpperCase());
    if (/[#\[\]=]/.test(code)) return;                                     // a macro line: not for this test
    const left = code.replace(/^\//, "").replace(/[A-Za-z]\s*[-+]?(?:\d+\.?\d*|\.\d+)/g, "").replace(/[\s,]/g, "");
    if (left) junk.push({ line: i + 1, text: t.trim().slice(0, 60) });
  });

  // -- the program, in order, with what's switched on as it goes
  const code = [];          // each line of code as written, tidied: for "is it the same program"
  const tail = [];          // lines after the end of the program (sub-programs live there)
  const unread = [];        // words the follower didn't use, with the tool they came under
  const g53 = [];           // moves in machine coordinates, as written
  const perTool = {};       // tool -> { wcs: [...], spin: [...] } while it cuts
  const stops = [];         // M00 lines, with their reason
  const roughKinds = [];    // G71 / G72 / G73, in order
  const roughRefs = [];     // "P-Q" of each roughing cycle
  const finishRefs = [];    // "P-Q" of each finishing pass
  let stoppedCuts = 0;      // cutting lines run with the spindle not turning
  let ended = false;
  let tool = 0;
  let pendingT = 0;
  let wcs = "";
  let spin = 0;
  let motion = 0;
  let plane = 17;
  let inCycle = false;
  const T = (t) => (perTool[t] ||= { wcs: [], spin: [] });
  const note = (list, v) => { if (v && !list.includes(v)) list.push(v); };

  for (const line of lines) {
    if (ended) { if (line.code) tail.push(line.code.replace(/\s+/g, "")); continue; }
    if (line.macro) { if (line.code) code.push(`macro ${line.code.replace(/\s+/g, "")}`); continue; }
    if (!line.words.length) continue;
    const G = line.words.filter((w) => w.l === "G").map((w) => w.v);
    const M = line.words.filter((w) => w.l === "M").map((w) => w.v);
    const slash = /^\s*\//.test(line.code) ? "/" : "";
    code.push(slash + line.words.map(word).join(" "));

    // what's switched on
    for (const w of line.words) {
      if (w.l !== "T") continue;
      const digits = w.raw.replace(/\D/g, "");
      const n = k === "lathe" ? (digits.length >= 3 ? Math.floor(w.v / 100) : w.v) : w.v;
      if (k === "lathe") { if (n) tool = n; } else pendingT = n;
    }
    if (k === "mill" && M.includes(6) && pendingT) tool = pendingT;
    for (const g of G) {
      if (g >= 54 && g <= 59) wcs = `G${g}`;
      if (g === 154) wcs = `G154 P${line.words.find((w) => w.l === "P")?.v ?? "?"}`;
      if (g === 17 || g === 18 || g === 19) plane = g;
      if (g === 0 || g === 1 || g === 2 || g === 3 || g === 32) { motion = g; inCycle = false; }
      if (g === 80) inCycle = false;
      if (k === "mill" && [73, 74, 76, 81, 82, 83, 84, 85, 86, 89].includes(g)) inCycle = true;
      if (g === 71 || g === 72 || g === 73) {
        const p = line.words.find((w) => w.l === "P"), q = line.words.find((w) => w.l === "Q");
        if (k === "lathe" && p && q) { roughKinds.push(`G${g}`); roughRefs.push(`${p.v}-${q.v}`); }
      }
      if (g === 70 && k === "lathe") { const p = line.words.find((w) => w.l === "P"), q = line.words.find((w) => w.l === "Q"); finishRefs.push(`${p?.v ?? "?"}-${q?.v ?? "?"}`); }
      if (g === 53) g53.push(line.words.filter((w) => "XYZUW".includes(w.l)).map(word).join(" ") || "(no axis)");
    }
    if (M.includes(3)) spin = 3;
    if (M.includes(4)) spin = 4;
    if (M.includes(5)) spin = 0;
    if (M.includes(0)) stops.push(line.comment || "(no reason written)");

    // a line that cuts: a feed move with somewhere to go, or a cycle
    const moves = line.words.some((w) => "XYZUW".includes(w.l));
    const cycleLine = G.some((g) => (g >= 70 && g <= 76) || (g >= 81 && g <= 89) || g === 92);
    const cuts = cycleLine || (moves && (motion === 1 || motion === 2 || motion === 3 || motion === 32 || inCycle) && !G.some((g) => g === 0 || g === 28 || g === 30 || g === 53 || g === 4 || g === 50));
    if (cuts) {
      const t = tool || pendingT;
      note(T(t).wcs, wcs || "(none called)");
      note(T(t).spin, spin === 3 ? "M03" : spin === 4 ? "M04" : "stopped");
      if (!spin) stoppedCuts += 1;
    }

    // words the follower doesn't use
    const read = lettersRead(k, G, motion, plane, inCycle);
    const at = `T${tool || pendingT}`;
    for (const w of line.words) {
      if (w.l === "G") { if (!KNOWN_G[k].includes(w.v)) unread.push(`${at} G${w.v}`); continue; }
      if (w.l === "M") { if (!KNOWN_M.includes(w.v)) unread.push(`${at} M${w.v}`); continue; }
      if (!read.includes(w.l)) unread.push(`${at} ${G.length ? `G${G[0]} ` : ""}${word(w)}`);
    }
    if (M.includes(30) || M.includes(2)) ended = true;
  }

  return {
    code, tail, unread, g53, perTool, stops, roughKinds, roughRefs, finishRefs, stoppedCuts,
    slashed, junk,
    midPercent: midPercent != null ? midPercent + 1 : null,
    unbalanced: unbalanced >= 0 ? unbalanced + 1 : null,
    // comments with a number in them are instructions to whoever runs it
    numbered: lines.filter((l) => l.comment && /\d/.test(l.comment) && !/NOT PROVEN/i.test(l.comment)).map((l) => l.comment.replace(/\s+/g, " ").toUpperCase()),
  };
}

// Is the new program the same as the old one, as far as the machine is
// concerned? Line for line and word for word, except that a feed or a speed
// may be LOWER. Comments, spacing, capitals and how a number is written
// (G0 or G00, X1. or X1.0) don't count.
//   -> { same, changed (how many lines of code differ), first: { was, now } }
export function sameMachine(a, b) {
  const lineSame = (x, y) => {
    if (x === y) return true;
    if (x.startsWith("macro ") || y.startsWith("macro ")) return false;
    const p = x.split(" "), q = y.split(" ");
    if (p.length !== q.length) return false;
    return p.every((w, i) => w === q[i] || (/^[FS]/.test(w) && w[0] === q[i][0] && Number(q[i].slice(1)) > 0 && Number(q[i].slice(1)) <= Number(w.slice(1))));
  };
  let changed = 0;
  let first = null;
  const n = Math.max(a.code.length, b.code.length);
  if (a.code.length === b.code.length) {
    for (let i = 0; i < n; i++) if (!lineSame(a.code[i], b.code[i])) { changed += 1; first ||= { was: a.code[i], now: b.code[i] }; }
  } else {
    // different numbers of lines: count the ones with no partner
    const left = b.code.slice();
    for (const x of a.code) { const i = left.findIndex((y) => lineSame(x, y)); if (i >= 0) left.splice(i, 1); else { changed += 1; first ||= { was: x, now: "(gone)" }; } }
    changed += left.length;
    if (left.length) first ||= { was: "(not there)", now: left[0] };
    changed = Math.max(changed, 1);
  }
  const tailSame = a.tail.length === b.tail.length && a.tail.every((x, i) => x === b.tail[i]);
  return { same: changed === 0 && tailSame, changed, first, tailSame };
}
