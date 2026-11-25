// The app's side of the AI: everything that happens around an answer so that
// the answer never has to be taken on trust.
//
// The AI is asked through `ask(task, input)` (see cncAiClient.js; the prompts
// are on the server in lib/cncAi.js). This file is what makes the result worth
// having:
//
//   the pack      every fact about the part, the machine and the program,
//                 including what the program has been MEASURED to cut
//   the checks    a draft is measured against the program it replaces: same
//                 number, units, offset and tools, no faster, no closer to the
//                 chuck, and (on a lathe) the same finished shape to half a
//                 thousandth, by following the tool through both
//   the loop      write -> measure -> fix -> measure … then a second read by a
//                 pass that didn't write it, and round again if that finds a
//                 fault. Bounded, so it always ends.
//   the verdict   "passed" only when the final draft cleared the measurements
//                 AND was read clean by the second pass. Anything else says why.
//
// Whatever the verdict, a draft is saved NOT PROVEN and has to be proven out at
// the machine like any other program. None of this replaces that.

import { MACHINES } from "./machines.js";
import { splitMachines } from "./cncParts.js";
import { parseLines, programInfo, looksLikeProgram, diffPrograms, operatorStops } from "./cncGcode.js";
import { buildPack, checkForPart, cleanTools, readiness } from "./cncPack.js";
import { toolpath } from "./cncPath.js";
import { simulateLathe, parseStock, partSizes, sizeLabel, sizeText, zText } from "./cncSolid.js";
import { estimateTime, fmtDuration } from "./cncTime.js";

const ORDER = { stop: 0, look: 1, note: 2 };
const byLevel = (list) => list.slice().sort((a, b) => ORDER[a.level] - ORDER[b.level]);
const kindOf = (part) => MACHINES.find((m) => m.key === splitMachines(part?.machine)[0])?.kind || "";
const n4 = (v) => Number(Number(v).toFixed(4)).toString();

// ---- what a program does, in numbers -----------------------------------------
//
// One walk through the program, then everything two versions are compared on.
export function measure(content, part) {
  const lines = parseLines(content);
  const info = programInfo(content);
  const path = toolpath(content, { kind: kindOf(part) });
  const units = path.units === "mm" ? "mm" : "in";
  const stock = parseStock(part?.facts?.stock);
  const sim = path.kind === "lathe" ? simulateLathe(path, stock) : null;
  const cuts = path.segs.filter((s) => s.type !== "rapid");
  const rapids = path.segs.filter((s) => s.type === "rapid");

  const codes = new Set();
  let unitsCode = "";
  let nonAscii = null;
  let longLine = null;
  String(content || "").replace(/\r\n?/g, "\n").split("\n").forEach((text, i) => {
    if (!nonAscii && /[^\x09\x20-\x7E]/.test(text)) nonAscii = i + 1;
    if (!longLine && text.length > 128) longLine = i + 1;
  });
  for (const l of lines) for (const w of l.words) {
    if (w.l === "G" || w.l === "M") codes.add(`${w.l}${w.v}`);
    if (w.l === "G" && (w.v === 20 || w.v === 21) && !unitsCode) unitsCode = `G${w.v}`;
  }

  // Speeds and feeds as they stand on the moves that cut.
  const max = (list) => (list.length ? Math.max(...list) : 0);
  const speeds = {
    rpm: max(cuts.filter((s) => !s.css).map((s) => s.s)),
    surface: max(cuts.filter((s) => s.css).map((s) => s.s)),
    clamp: max(path.segs.map((s) => s.clamp || 0).concat((path.cycles || []).map((c) => c.clamp || 0))),
    feedPerRev: max(cuts.filter((s) => s.perRev && s.type !== "thread").map((s) => s.f).concat((path.cycles || []).filter((c) => c.perRev).map((c) => c.f || 0))),
    feedPerMin: max(cuts.filter((s) => !s.perRev).map((s) => s.f)),
  };

  return {
    info, path, sim, units, unitsCode, codes, speeds, nonAscii, longLine,
    kind: path.kind,
    sizes: sim ? partSizes(sim) : null,
    stops: operatorStops(content),
    time: estimateTime(path),
    // how far the tool reaches while cutting
    reach: path.stats,
    // the lowest a rapid ever goes on a mill: the height that has to be clear
    // A rapid straight up out of a cut starts low but is only leaving, so what
    // counts is where a rapid ENDS, and the height it travels sideways at.
    rapidLow: path.kind === "mill" && rapids.length
      ? Math.min(...rapids.map((s) => (s.a[0] !== s.b[0] || s.a[1] !== s.b[1] ? Math.min(s.a[2], s.b[2]) : s.b[2])))
      : null,
    hasMacros: lines.some((l) => l.macro && l.code),
    lineCount: lines.length,
    wrapped: /^\s*%/.test(String(content || "")),
    ends: lines.some((l) => l.words.some((w) => w.l === "M" && (w.v === 30 || w.v === 99 || w.v === 2))),
  };
}

// The part of the pack no file contains: what the program actually cuts.
export function measuredText(content, part) {
  const m = measure(content, part);
  const u = m.units;
  const unit = u === "mm" ? "mm" : "inches";
  const L = [];
  if (m.kind === "lathe" && m.sizes) {
    L.push(`Sizes (${unit}), from the face back toward the chuck:`);
    if (!m.sizes.steps.length) L.push("  (no straight diameter found)");
    for (const s of m.sizes.steps) {
      const t = sizeLabel(s, u);
      L.push(`  ${t.main.replace("Ø", "DIA ")}  ${t.sub.replace(/·/g, ",")}  ${s.groove ? `at ${zText(s.mid, u)}` : `${zText(s.z1, u)} to ${zText(s.z0, u)}`}`);
    }
    for (const t of m.sim.threads) L.push(`  THREAD from ${zText(t.z1, u)} to ${zText(t.z0, u)}, root diameter ${sizeText(t.minor * 2, u)}, lead ${n4(t.pitch)}`);
    L.push(`Cut length: ${sizeText(m.sizes.length, u)} (${zText(m.sizes.face, u)} to ${zText(m.sizes.from, u)}). The chuck is past that.`);
    L.push(m.sim.guessed ? "Bar size: NOT GIVEN. Rapid moves could not be checked against the bar." : `Bar: ${sizeText(m.sim.stockR * 2, u)} diameter.`);
    if (m.sim.bore) L.push("The program drills or bores on centre. Inside shapes are not measured.");
    if (m.sim.unsure) L.push(`Not everything could be followed: ${m.sim.unsure}.`);
  } else if (m.reach) {
    const r = m.reach;
    L.push(`Cuts reach (${unit}): X ${n4(r.x[0])} to ${n4(r.x[1])}, Y ${n4(r.y[0])} to ${n4(r.y[1])}, deepest Z ${n4(r.zMin)}.`);
    if (m.rapidLow != null) L.push(`Lowest rapid move: Z ${n4(m.rapidLow)}.`);
    L.push("Only the reach of the cuts is measured on a mill, not the shape.");
  } else {
    L.push("No cutting moves could be followed in this program.");
  }
  const sp = m.speeds;
  const speedBits = [
    sp.surface ? `surface speed up to S${n4(sp.surface)} (G96)` : "",
    sp.clamp ? `speed limit G50 S${n4(sp.clamp)}` : "",
    sp.rpm ? `fixed speed up to S${n4(sp.rpm)} rpm` : "",
    sp.feedPerRev ? `feed up to F${n4(sp.feedPerRev)} per revolution` : "",
    sp.feedPerMin ? `feed up to F${n4(sp.feedPerMin)} per minute` : "",
  ].filter(Boolean);
  if (speedBits.length) L.push(`Speeds and feeds while cutting: ${speedBits.join("; ")}.`);
  if (m.stops.length) L.push(`Operator stops: ${m.stops.map((s) => `line ${s.line} (${s.optional ? "M01" : "M00"}${s.why ? `: ${s.why}` : ", no reason written"})`).join("; ")}.`);
  if (m.time?.seconds > 0) L.push(`Estimated run time: about ${fmtDuration(m.time.seconds)} a part.`);
  if (m.hasMacros) L.push("The program has macro lines (variables or loops), which were skipped when measuring.");
  for (const note of m.path.notes) L.push(`Note: ${note}`);
  return L.join("\n");
}

// Everything known, as one block of text: the pack a person can copy, plus the
// measurements. The newest program is the one worked on; one older version (the
// proven one, if any) is kept for reference and the rest left out to keep it
// readable and cheap.
export function buildAiPack(part, programs = [], machineFacts = {}) {
  const newest = programs[0] || null;
  const proven = programs.find((p) => p.status === "proven" && p !== newest) || null;
  const keep = [newest, proven].filter(Boolean);
  const L = [buildPack(part, keep, machineFacts)];
  if (programs.length > keep.length) L.push(`\n(${programs.length - keep.length} older version${programs.length - keep.length === 1 ? "" : "s"} of the program not shown.)`);
  if (newest) {
    L.push("");
    L.push(`== WHAT THE PROGRAM CUTS: ${newest.name || "program 1"} (measured by software that follows the tool) ==`);
    L.push(measuredText(newest.content, part));
  }
  return L.join("\n");
}

// ---- a draft, made safe to handle ---------------------------------------------
const STAMP = /^\s*\((?:AI DRAFT|WRITTEN BY THE CNC CATALOG)[^)]*\)\s*$/i;

// Tidy what came back: no code fences, plain line ends, no trailing spaces.
export function cleanProgram(text) {
  let t = String(text || "").replace(/\r\n?/g, "\n");
  t = t.replace(/^\s*```[a-z]*\n/i, "").replace(/\n```\s*$/i, "\n");
  return `${t.split("\n").map((l) => l.replace(/\s+$/, "")).join("\n").replace(/\n+$/, "")}\n`;
}

// The line that says what this is, for whoever reads the file at the machine.
// Put straight after the O-number line, replacing any earlier one, so stamping
// twice changes nothing and every line number after it is the final one.
export function stampDraft(program, { date = new Date(), label = "AI DRAFT" } = {}) {
  const day = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  const stamp = `(${label} ${day} - NOT PROVEN - PROVE OUT BEFORE RUNNING)`;
  const lines = cleanProgram(program).split("\n").filter((l) => !STAMP.test(l));
  const at = lines.findIndex((l) => /^\s*(N\d+\s*)?O\d+/i.test(l));
  // No O-number line: after the opening % if there is one, else at the very top.
  const where = at >= 0 ? at + 1 : /^\s*%\s*$/.test(lines[0] || "") ? 1 : 0;
  lines.splice(where, 0, stamp);
  return lines.join("\n");
}

// ---- measuring a draft against the program it replaces ------------------------
//
// Findings in the same form as the rule checker: { level, text, line }.
// "stop" means the draft must not be offered as it stands.
export function draftChecks(oldContent, newContent, { part = null, machineFacts = {}, sizesMayChange = false, speedsMayRise = false } = {}) {
  const out = [];
  const add = (level, text, line = null) => out.push({ level, text, line, from: "measured" });

  if (!looksLikeProgram(newContent)) {
    add("stop", "What came back isn't a program.");
    return out;
  }
  const a = measure(oldContent, part);
  const b = measure(newContent, part);
  const u = b.units;
  const tol = u === "mm" ? 0.0127 : 0.0005;
  const sz = (v) => sizeText(v, u);

  // -- it is the same program for the same setup
  if (a.info.number && b.info.number !== a.info.number) add("stop", `The program number changed from ${a.info.number} to ${b.info.number || "nothing"}. It would be filed as a different program on the machine.`);
  if (a.kind !== b.kind) add("stop", `The current program is a ${a.kind} program and this reads as a ${b.kind} program.`);
  if (a.unitsCode && b.unitsCode && a.unitsCode !== b.unitsCode) add("stop", `The units changed (${a.unitsCode} to ${b.unitsCode}). Every size would be wrong.`);
  if (a.unitsCode && !b.unitsCode) add("look", `The current program sets its units (${a.unitsCode}) and this one doesn't.`);
  const offA = a.info.offsets.slice().sort().join(", ");
  const offB = b.info.offsets.slice().sort().join(", ");
  if (offA !== offB) add("stop", `The work offset changed: the current program uses ${offA || "none"} and this uses ${offB || "none"}. The tool would start from a different zero.`);
  if (a.wrapped && !b.wrapped) add("look", "The current program starts with a % line and this one doesn't. The Haas may not load it.");
  if (!b.ends) add("stop", "There is no end of program (M30).");
  if (b.nonAscii) add("stop", "There is a character the Haas can't read (not plain keyboard text).", b.nonAscii);
  if (b.longLine) add("look", "A line is longer than the control likes (over 128 characters).", b.longLine);

  // -- tools: only ones that are really there
  const listed = new Map(splitMachines(part?.machine).flatMap((k) => cleanTools(machineFacts?.[k]?.tools)).map((r) => [Number(String(r.t).replace(/\D/g, "")), r.what]));
  const hadTool = new Set(a.info.tools.map((t) => t.t));
  for (const t of b.info.tools) {
    if (hadTool.has(t.t)) continue;
    if (listed.size && !listed.has(t.t)) add("stop", `It calls T${t.t}, which the current program doesn't use and which isn't on the machine's tool list.`);
    else if (listed.size) add("look", `It uses T${t.t} (${listed.get(t.t) || "no description"}), which the current program doesn't. Check that tool is in that pocket and set.`);
    else add("stop", `It calls T${t.t}, which the current program doesn't use, and this machine's tool list isn't filled in, so there's no way to know that tool exists.`);
  }
  for (const t of b.info.tools) if (!t.note) add("look", `T${t.t} has no comment saying what the tool is.`);

  // -- codes the current program never used
  const fresh = [...b.codes].filter((c) => !a.codes.has(c)).sort();
  if (fresh.length) add("look", `It uses codes the current program doesn't: ${fresh.join(", ")}. Each one should be explained in the list of changes.`);

  // -- no faster than it was
  // (allowed only when the person asking ticked that it may, and even then it's something to check at the machine)
  const faster = (name, was, now, code) => {
    if (!(was > 0 && now > was * 1.001)) return;
    const what = `${name} went up from ${n4(was)} to ${n4(now)}${code ? ` (${code})` : ""}.`;
    if (speedsMayRise) add("look", `${what} Check the tool and the setup can take it.`);
    else add("stop", `${what} A rewrite doesn't run anything faster unless that was asked for.`);
  };
  faster("The spindle speed limit", a.speeds.clamp, b.speeds.clamp, "G50 S");
  faster("The surface speed", a.speeds.surface, b.speeds.surface, "G96 S");
  faster("The fixed spindle speed", a.speeds.rpm, b.speeds.rpm, "G97 S");
  faster("The feed per revolution", a.speeds.feedPerRev, b.speeds.feedPerRev, "F");
  faster("The feed per minute", a.speeds.feedPerMin, b.speeds.feedPerMin, "F");
  if (a.speeds.clamp > 0 && b.speeds.surface > 0 && !b.speeds.clamp) add("stop", "The spindle speed limit (G50 S) is gone.");

  // -- the part it makes
  if (a.kind === "lathe" && b.kind === "lathe" && a.sim && b.sim) {
    const changed = sizesMayChange ? "look" : "stop";
    const fromA = a.sim.face - a.sim.length;
    const fromB = b.sim.face - b.sim.length;
    if (fromB < fromA - tol) add("stop", `It cuts ${sz(fromA - fromB)} closer to the chuck than the current program (to ${zText(fromB, u)}, where the current one stops at ${zText(fromA, u)}). The jaws are there.`);
    else if (fromB > fromA + tol) add(changed, `It stops cutting ${sz(fromB - fromA)} short of where the current program does (${zText(fromB, u)} against ${zText(fromA, u)}).`);
    if (Math.abs(a.sim.face - b.sim.face) > tol) add(changed, `The front face moved from ${zText(a.sim.face, u)} to ${zText(b.sim.face, u)}.`);

    const steps = sizeChanges(a.sizes, b.sizes, tol, u);
    for (const text of steps) add(changed, text);
    // the whole outline, so a taper, a radius or a chamfer can't change unnoticed
    const shape = profileDifference(a.sim, b.sim);
    if (shape.worst > tol && !steps.length) {
      add(changed, `The finished shape is different: at ${zText(shape.z, u)} the current program leaves Ø${sz(shape.was * 2)} and this leaves Ø${sz(shape.now * 2)}.`);
    }
    const th = (t) => `${n4(t.z0)}|${n4(t.z1)}|${n4(t.minor)}|${n4(t.pitch)}`;
    const thA = a.sim.threads.map(th).sort().join(";");
    const thB = b.sim.threads.map(th).sort().join(";");
    if (thA !== thB) add(changed, a.sim.threads.length && !b.sim.threads.length ? "The thread is gone." : !a.sim.threads.length ? "It cuts a thread the current program doesn't." : "The thread is different (its length, root diameter or lead).");
    if (a.sim.bore || b.sim.bore) add("note", "Drilled and bored holes can't be measured, so the inside of the part wasn't compared.");
    if (a.sim.guessed) add("look", "The stock size isn't on the part, so rapid moves couldn't be checked against the bar. Add it and run this again.");
  } else if (a.kind === "mill" && b.kind === "mill" && a.reach && b.reach) {
    if (b.reach.zMin < a.reach.zMin - tol) add("stop", `It cuts deeper than the current program: Z${n4(b.reach.zMin)} against Z${n4(a.reach.zMin)}.`);
    const wider = [["X", "x"], ["Y", "y"]].filter(([, k]) => b.reach[k][0] < a.reach[k][0] - tol || b.reach[k][1] > a.reach[k][1] + tol).map(([name]) => name);
    if (wider.length) add("look", `Its cuts reach further in ${wider.join(" and ")} than the current program's. Check the vise and clamps are clear.`);
    if (a.rapidLow != null && b.rapidLow != null && b.rapidLow < a.rapidLow - tol) add("stop", `Rapid moves go lower than they ever did: Z${n4(b.rapidLow)} against Z${n4(a.rapidLow)}. That height isn't known to be clear.`);
    add("note", "On a mill only how far the cuts reach is compared, not the shape. Check the part against the drawing.");
  } else if (b.kind === "lathe" && !b.sim) {
    add("stop", "No cutting moves could be followed in it, so nothing about what it makes could be checked.");
  }

  // -- stops the operator relied on
  const whyA = a.stops.filter((s) => !s.optional).map((s) => s.why || "(no reason written)");
  const whyB = b.stops.filter((s) => !s.optional).map((s) => s.why || "(no reason written)");
  if (whyB.length < whyA.length) add("look", `It stops for the operator ${whyB.length} time${whyB.length === 1 ? "" : "s"} where the current program stops ${whyA.length} (${whyA.join("; ")}). Check nothing that needs doing by hand was dropped.`);
  if (whyB.length > whyA.length) add("look", `It stops for the operator ${whyB.length} time${whyB.length === 1 ? "" : "s"} where the current program stops ${whyA.length}.`);
  for (const s of b.stops) if (!s.why) add("look", "An operator stop has no comment saying what to do.", s.line);

  if (a.hasMacros || b.hasMacros) add("look", "The program has macro lines (variables or loops). Those were skipped by every measurement here, so read them by eye.");
  if (a.time?.seconds > 0 && b.time?.seconds > 0) {
    const d = b.time.seconds - a.time.seconds;
    add("note", `Estimated run time: about ${fmtDuration(b.time.seconds)} a part${Math.abs(d) >= 2 ? ` (${d < 0 ? fmtDuration(-d) + " quicker" : fmtDuration(d) + " longer"} than the current program)` : ", the same as now"}.`);
  }

  // -- and everything the ordinary checker says about any program
  const before = new Set(checkForPart(oldContent, part, machineFacts).map((f) => f.text));
  for (const f of checkForPart(newContent, part, machineFacts)) {
    out.push({ ...f, from: "rules", was: before.has(f.text) });
  }
  return byLevel(out);
}

// Each diameter the current program cuts, looked for in the draft.
function sizeChanges(a, b, tol, u) {
  if (!a || !b) return [];
  const out = [];
  const where = (s) => (s.groove ? `at ${zText(s.mid, u)}` : `from ${zText(s.z1, u)} to ${zText(s.z0, u)}`);
  const name = (s) => `${s.groove ? "The groove" : ""}${s.groove ? " " : ""}Ø${sizeText(s.dia, u)} ${where(s)}`.trim();
  const same = (x, y) => x.groove === y.groove && Math.abs(x.dia - y.dia) <= tol * 2
    && (x.groove ? Math.abs(x.mid - y.mid) <= tol * 2 : Math.abs(x.z0 - y.z0) <= tol && Math.abs(x.z1 - y.z1) <= tol);
  const overlap = (x, y) => Math.min(x.z1, y.z1) - Math.max(x.z0, y.z0);
  const used = new Set();
  for (const s of a.steps) {
    const hit = b.steps.find((t) => !used.has(t) && same(s, t));
    if (hit) { used.add(hit); continue; }
    const near = b.steps.filter((t) => !used.has(t) && t.groove === s.groove).sort((p, q) => overlap(s, q) - overlap(s, p))[0];
    if (near && overlap(s, near) > 0) { used.add(near); out.push(`${name(s)} in the current program is ${name(near)} in this one.`); }
    else out.push(`${name(s)} in the current program isn't cut by this one.`);
  }
  for (const t of b.steps) if (!used.has(t)) out.push(`It cuts ${name(t)}, which the current program doesn't.`);
  return out;
}

// The biggest difference between two finished outlines, anywhere along the
// part. At a square shoulder the radius jumps, and two programs can put that
// jump a hair apart without the part being any different, so each point is
// compared with the range the other outline covers just either side of it.
export function profileDifference(simA, simB) {
  const lo = Math.max(simA.face - simA.length, simB.face - simB.length);
  const hi = Math.min(simA.face, simB.face);
  const w = Math.max(simA.tight, simB.tight) * 4;
  let worst = 0;
  let at = { z: hi, was: 0, now: 0 };
  const span = (sim, z) => {
    const r = [sim.radiusAt(sim.final, z - w), sim.radiusAt(sim.final, z), sim.radiusAt(sim.final, z + w)];
    return [Math.min(...r), Math.max(...r)];
  };
  const test = (z) => {
    if (z < lo + w * 2 || z > hi - w * 2) return;
    const ra = simA.radiusAt(simA.final, z);
    const rb = simB.radiusAt(simB.final, z);
    const [bLo, bHi] = span(simB, z);
    const [aLo, aHi] = span(simA, z);
    const d = Math.max(ra < bLo ? bLo - ra : ra > bHi ? ra - bHi : 0, rb < aLo ? aLo - rb : rb > aHi ? rb - aHi : 0);
    if (d > worst) { worst = d; at = { z, was: ra, now: rb }; }
  };
  for (const z of simA.zs) test(z);
  for (const z of simB.zs) test(z);
  return { worst, ...at };
}

// ---- what the AI says about a line, checked against the line -------------------
//
// A finding has to quote the line it's about. If the quote isn't on that line
// it's looked for nearby, then anywhere; if it's nowhere, the finding is kept
// but marked, so nobody chases a line that doesn't exist.
const squash = (s) => String(s || "").replace(/^\s*\d+\|\s?/, "").replace(/\s+/g, "").toUpperCase();

export function placeFindings(findings, content) {
  const lines = String(content || "").replace(/\r\n?/g, "\n").split("\n").map(squash);
  return (findings || []).map((f) => {
    const q = squash(f.quote);
    const hit = (i) => i >= 0 && i < lines.length && q.length >= 2 && lines[i] && (lines[i].includes(q) || q.includes(lines[i]));
    const n = Number(f.line) - 1;
    let at = hit(n) ? n : -1;
    for (let d = 1; at < 0 && d <= 3; d++) at = hit(n - d) ? n - d : hit(n + d) ? n + d : -1;
    if (at < 0 && q.length >= 4) { const all = lines.map((_, i) => i).filter(hit); if (all.length === 1) at = all[0]; }
    const base = { level: ORDER[f.level] != null ? f.level : "look", text: String(f.problem || "").trim(), fix: String(f.fix || "").trim(), quote: String(f.quote || "").trim(), from: "ai" };
    return at >= 0 ? { ...base, line: at + 1 } : { ...base, line: null, unplaced: true };
  }).filter((f) => f.text);
}

// Findings as text, for sending back to be fixed or checked.
export function problemsText(findings) {
  return findings.map((f, i) => `${i + 1}. [${f.level}]${f.line ? ` line ${f.line}:` : ""} ${f.text}${f.quote ? `\n   the line: ${f.quote}` : ""}${f.fix ? `\n   suggested: ${f.fix}` : ""}${f.from === "measured" ? "\n   (measured by following the tool)" : ""}`).join("\n");
}
const notesText = (r) => [
  r.summary ? `Summary: ${r.summary}` : "",
  r.changes?.length ? `Changes:\n${r.changes.map((c) => `- ${c.what}${c.why ? ` (${c.why})` : ""}`).join("\n")}` : "Changes: none listed.",
  r.assumptions?.length ? `Assumptions:\n${r.assumptions.map((x) => `- ${x}`).join("\n")}` : "",
  r.questions?.length ? `Questions:\n${r.questions.map((x) => `- ${x}`).join("\n")}` : "",
].filter(Boolean).join("\n");

// ---- what it cost -------------------------------------------------------------
//
// Dollars per million tokens for the default model (Claude Fable 5.2), for the
// estimate shown on screen. An estimate: the bill is whatever Anthropic's
// console says. Change these if lib/cncAi.js's DEFAULT_MODEL changes.
export const PRICE = { input: 8, output: 40, cacheRead: 0.2, cacheWrite: 10 };
export const addUsage = (a, b) => ({
  input: (a?.input || 0) + (b?.input || 0), output: (a?.output || 0) + (b?.output || 0),
  cacheRead: (a?.cacheRead || 0) + (b?.cacheRead || 0), cacheWrite: (a?.cacheWrite || 0) + (b?.cacheWrite || 0),
});
export const costOf = (u) => ((u?.input || 0) * PRICE.input + (u?.output || 0) * PRICE.output + (u?.cacheRead || 0) * PRICE.cacheRead + (u?.cacheWrite || 0) * PRICE.cacheWrite) / 1e6;
export const fmtCost = (dollars) => (dollars < 0.005 ? "under 1¢" : dollars < 1 ? `about ${Math.round(dollars * 100)}¢` : `about $${dollars.toFixed(2)}`);

// ---- what has to be known before a rewrite is allowed ---------------------------
//
// A rewrite written without these would be guessing at the things that crash
// machines: which tools exist, how big the bar is, where the jaws are. So it
// doesn't start until they're on the part. (A check of the program can run
// without them; it just says what it couldn't tell.)
const NEEDED_FIRST = ["machine", "tools", "material", "holding"];
export function rewriteNeeds(part, programs = [], machineFacts = {}) {
  return readiness(part, programs, machineFacts).filter((r) => NEEDED_FIRST.includes(r.key) && !r.ok).map((r) => ({ key: r.key, label: r.label, how: r.how }));
}

// ---- the rewrite: write, measure, fix, read again ------------------------------
//
// ask(task, input) -> { result, usage, notes }. onStep hears what's happening.
// Never more than 1 write + 3 fixes + 3 second reads.
export const MAX_FIXES = 3;
export const MAX_READS = 3;

export async function runRewrite({ ask, part, programs, machineFacts = {}, instruction, sizesMayChange = false, speedsMayRise = false, onStep = () => {}, now = new Date() }) {
  const current = programs?.[0];
  if (!current) throw new Error("There is no program to rewrite.");
  const needs = rewriteNeeds(part, programs, machineFacts);
  if (needs.length) throw new Error(`Fill these in on the part first: ${needs.map((n) => n.label.toLowerCase()).join(", ")}.`);
  const base = {
    pack: buildAiPack(part, programs, machineFacts),
    program: current.content,
    instruction: String(instruction || "").trim(),
    sizesMayChange: !!sizesMayChange,
    speedsMayRise: !!speedsMayRise,
    drawingUrl: part?.blueprintUrl || "",
  };
  let usage = addUsage(null, null);
  const notes = new Set();
  const steps = [];
  const step = (kind, text) => { steps.push({ kind, text }); onStep({ kind, text, steps: steps.slice() }); };
  const call = async (task, more) => {
    const r = await ask(task, { ...base, ...more });
    usage = addUsage(usage, r.usage);
    (r.notes || []).forEach((n) => notes.add(n));
    return r.result;
  };
  const measureIt = (program) => draftChecks(current.content, program, { part, machineFacts, sizesMayChange, speedsMayRise });
  const stopsIn = (list) => list.filter((f) => f.level === "stop");
  // What goes back to be fixed: every stop, and the "check this" findings the
  // rewrite itself brought in (ones the current program already had are its
  // own business, unless they stop it running).
  const worthFixing = (f) => f.level === "stop" || (f.level === "look" && !f.was);

  step("write", "Writing the new program");
  let answer = await call("write", {});
  let program = stampDraft(answer.program, { date: now });
  let fixes = 0;
  let reads = 0;
  let measured = [];
  let second = null;   // the second read OF THIS EXACT DRAFT, or null

  for (;;) {
    step("measure", "Measuring it against the current program");
    measured = measureIt(program);
    if (stopsIn(measured).length) {
      if (fixes >= MAX_FIXES) break;
      fixes += 1;
      step("fix", `Fixing what the measurements found (${stopsIn(measured).length})`);
      answer = await call("fix", { draft: program, problems: problemsText(measured.filter(worthFixing)) });
      program = stampDraft(answer.program, { date: now });
      second = null;
      continue;
    }
    if (reads >= MAX_READS) break;
    reads += 1;
    step("verify", reads === 1 ? "A second read, by a pass that didn't write it" : "Reading the corrected version again");
    const v = await call("verify", { draft: program, notes: notesText(answer), problems: problemsText(measured.filter((f) => f.level !== "note")) });
    second = { verdict: v.verdict, findings: placeFindings(v.findings, program), checked: v.checked || [], couldNotCheck: v.couldNotCheck || [] };
    if (!stopsIn(second.findings).length) break;
    if (fixes >= MAX_FIXES) break;
    fixes += 1;
    step("fix", `Fixing what the second read found (${stopsIn(second.findings).length})`);
    answer = await call("fix", { draft: program, problems: problemsText([...second.findings, ...measured.filter(worthFixing)]) });
    program = stampDraft(answer.program, { date: now });
    second = null;
  }

  const reasons = [];
  if (stopsIn(measured).length) reasons.push(`${stopsIn(measured).length} problem${stopsIn(measured).length === 1 ? "" : "s"} the measurements found ${stopsIn(measured).length === 1 ? "is" : "are"} still there.`);
  if (!second) reasons.push(stopsIn(measured).length ? "It wasn't given a second read, because it didn't pass the measurements." : "The final version wasn't given a second read.");
  else if (stopsIn(second.findings).length) reasons.push(`The second read found ${stopsIn(second.findings).length} problem${stopsIn(second.findings).length === 1 ? "" : "s"} that ${stopsIn(second.findings).length === 1 ? "wasn't" : "weren't"} fixed.`);
  const verdict = reasons.length ? "problems" : "passed";
  step("done", verdict === "passed" ? "Done. It passed every check." : "Done. It did not pass.");

  return {
    kind: "rewrite", verdict, reasons, program,
    instruction: base.instruction, sizesMayChange: base.sizesMayChange, speedsMayRise: base.speedsMayRise,
    summary: String(answer.summary || "").trim(),
    changes: (answer.changes || []).filter((c) => c?.what),
    assumptions: (answer.assumptions || []).filter(Boolean),
    questions: (answer.questions || []).filter(Boolean),
    measured, second, fixes, reads,
    diff: diffPrograms(current.content, program),
    usage, cost: costOf(usage), notes: [...notes],
    basedOn: { id: current.id || null, name: current.name || "" },
    at: now.getTime(),
  };
}

// ---- the review: read it, then check each finding ------------------------------
export async function runReview({ ask, part, programs, machineFacts = {}, onStep = () => {}, now = new Date() }) {
  const current = programs?.[0];
  if (!current) throw new Error("There is no program to check.");
  const base = { pack: buildAiPack(part, programs, machineFacts), program: current.content, drawingUrl: part?.blueprintUrl || "" };
  let usage = addUsage(null, null);
  const notes = new Set();
  const call = async (task, more) => {
    const r = await ask(task, { ...base, ...more });
    usage = addUsage(usage, r.usage);
    (r.notes || []).forEach((n) => notes.add(n));
    return r.result;
  };

  onStep({ kind: "review", text: "Reading the program" });
  const r = await call("review", {});
  let findings = placeFindings(r.findings, current.content);
  let rejected = [];
  let checked = false;
  if (findings.length) {
    onStep({ kind: "challenge", text: `Checking each of the ${findings.length} thing${findings.length === 1 ? "" : "s"} it found` });
    const c = await call("challenge", { findings: problemsText(findings) });
    const verdicts = new Map((c.results || []).map((x) => [Number(x.index), x]));
    checked = true;
    const kept = [];
    findings.forEach((f, i) => {
      const v = verdicts.get(i + 1);
      if (v?.verdict === "rejected") rejected.push({ ...f, why: String(v.reason || "").trim() });
      // not sure, or never answered: it stays, but it can't be a "stop" on one reader's word
      else if (!v || v.verdict === "unsure") kept.push({ ...f, level: f.level === "stop" ? "look" : f.level, unsure: String(v?.reason || "The second pass didn't answer on this one.").trim() });
      else kept.push({ ...f, confirmed: true });
    });
    findings = kept;
  }
  onStep({ kind: "done", text: "Done" });
  return {
    kind: "review",
    summary: String(r.summary || "").trim(),
    walkthrough: (r.walkthrough || []).filter((w) => w?.what),
    findings: byLevel(findings), rejected, checked,
    handWork: (r.handWork || []).filter((h) => h?.job),
    questions: (r.questions || []).filter(Boolean),
    usage, cost: costOf(usage), notes: [...notes],
    of: { id: current.id || null, name: current.name || "" },
    at: now.getTime(),
  };
}

// What's kept with a saved draft: enough to show how it came about, small
// enough to sit in the program's row.
export function reportToKeep(run) {
  const trim = (list, n = 40) => (list || []).slice(0, n);
  return {
    kind: "rewrite", verdict: run.verdict, reasons: run.reasons, at: run.at,
    instruction: run.instruction, sizesMayChange: run.sizesMayChange, speedsMayRise: run.speedsMayRise,
    summary: run.summary, changes: trim(run.changes), assumptions: trim(run.assumptions), questions: trim(run.questions),
    measured: trim(run.measured.filter((f) => f.level !== "note" && !f.was)).map(({ level, text, line }) => ({ level, text, line })),
    second: run.second ? { verdict: run.second.verdict, findings: trim(run.second.findings).map(({ level, text, line, fix }) => ({ level, text, line, fix })), checked: trim(run.second.checked, 20), couldNotCheck: trim(run.second.couldNotCheck, 20) } : null,
    fixes: run.fixes, reads: run.reads, cost: run.cost, basedOn: run.basedOn,
  };
}
