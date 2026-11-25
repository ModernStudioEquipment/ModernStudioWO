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

import { diffPrograms } from "./cncGcode.js";
import { buildPack, readiness } from "./cncPack.js";
import { sizeLabel, sizeText, zText } from "./cncSolid.js";
import { fmtDuration } from "./cncTime.js";
import { measure, draftChecks, profileDifference } from "./cncCompare.js";

// The measuring itself is in cncCompare.js; it's handed on from here so the
// rest of the app has one place to ask.
export { measure, draftChecks, profileDifference };

const ORDER = { stop: 0, look: 1, note: 2 };
const byLevel = (list) => list.slice().sort((a, b) => ORDER[a.level] - ORDER[b.level]);
const n4 = (v) => Number(Number(v).toFixed(4)).toString();

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
    if (m.travelLow != null) L.push(`Rapid moves travel across the part no lower than Z ${n4(m.travelLow)}.`);
    if (m.plungeLow != null) L.push(`The lowest a rapid move straight down ends: Z ${n4(m.plungeLow)}.`);
    for (const [t, T] of Object.entries(m.perTool)) if (T.cuts) L.push(`  T${t} cuts down to Z ${n4(T.zLow)}, over X ${n4(T.box[0])} to ${n4(T.box[1])}, Y ${n4(T.box[2])} to ${n4(T.box[3])}.`);
    if (m.mill?.deepest) L.push(`The deepest any single pass cuts: ${n4(Number(m.mill.deepest.depth.toFixed(4)))} (line ${m.mill.deepest.line}).`);
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
  // tool by tool, because that's how a rewrite is held to them
  for (const [t, T] of Object.entries(m.perTool)) {
    if (!T.cuts) continue;
    const feeds = Object.entries(T.feeds).filter(([, f]) => f > 0).map(([k, f]) => { const [mode, kind] = k.split("|"); return `${({ rough: "roughing", profile: "finishing", feed: "cutting", groove: "grooving" })[kind] || kind} F${n4(f)} ${mode}`; });
    L.push(`  T${t}: spindle up to ${T.rpm >= 99999 ? "full speed (no limit set)" : `${Math.round(T.rpm)} rpm`}${feeds.length ? `; ${feeds.join(", ")}` : ""}.`);
  }
  for (const c of m.rough) L.push(`Roughing cycle on line ${c.line} (T${c.tool}): ${n4(c.depth)} deep per pass, leaving U${n4(c.allowX)} W${n4(c.allowZ)} for finishing${c.finished ? "" : ", and NO finishing pass follows it"}.`);
  if (m.sim?.deepest) L.push(`The heaviest single plain cut takes ${n4(Number(m.sim.deepest.depth.toFixed(4)))} off per side (line ${m.sim.deepest.line}).`);
  if (m.path.unhomed) L.push(`Tool changes made without sending the turret home first: ${m.path.unhomed}.`);
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

// ---- what the AI says about a line, checked against the line -------------------
//
// A finding has to quote the line it's about. If the quote isn't on that line
// it's looked for nearby, then anywhere; if it's nowhere, the finding is kept
// but marked, so nobody chases a line that doesn't exist.
const squash = (s) => String(s || "").replace(/^\s*\d+\|\s?/, "").replace(/\s+/g, "").toUpperCase();

//
// A level the AI makes up, or writes in capitals, is read as cautiously as it
// can be: anything that isn't plainly "look" or "note" counts as a stop. And a
// stop with nothing written beside it is still a stop.
export function placeFindings(findings, content) {
  const lines = String(content || "").replace(/\r\n?/g, "\n").split("\n").map(squash);
  // (a finding that arrives as bare text, not in the form asked for, is kept as a stop: it may be the one that matters)
  const formed = (findings || []).map((f) => (typeof f === "string" && f.trim() ? { level: "stop", line: null, quote: "", problem: f.trim(), fix: "" } : f));
  return formed.filter((f) => f && typeof f === "object").map((f) => {
    const q = squash(f.quote);
    const hit = (i) => i >= 0 && i < lines.length && q.length >= 2 && lines[i] && (lines[i].includes(q) || q.includes(lines[i]));
    const n = Number(f.line) - 1;
    let at = hit(n) ? n : -1;
    for (let d = 1; at < 0 && d <= 3; d++) at = hit(n - d) ? n - d : hit(n + d) ? n + d : -1;
    if (at < 0 && q.length >= 4) { const all = lines.map((_, i) => i).filter(hit); if (all.length === 1) at = all[0]; }
    const said = String(f.level || "").trim().toLowerCase();
    const level = said === "look" || said === "note" ? said : "stop";
    const text = String(f.problem || "").trim() || (level === "stop" ? "It gave no explanation for this one." : "");
    const base = { level, text, fix: String(f.fix || "").trim(), quote: String(f.quote || "").trim(), from: "ai" };
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

// ---- the program in plain words, from the app's own measurements ------------------
//
// One entry per tool, in order: what it does to the part and the sizes it
// leaves. True to the program (it's read off it), but only as deep as the
// measurements go: the AI's review says why and what to watch; this says what.
const KIND = { face: "cuts square faces and shoulders", turn: "turns the outside", groove: "cuts a groove", thread: "cuts a thread", drill: "drills on the centre line", bore: "bores the inside" };
export function explainPlainly(content, part = null) {
  const m = measure(content, part);
  const u = m.units;
  const byTool = new Map();
  for (const s of m.path.segs) {
    if (!s.tool) continue;
    const t = byTool.get(s.tool) || { first: s.line, last: s.line, cuts: false };
    t.first = Math.min(t.first, s.line); t.last = Math.max(t.last, s.line);
    if (s.type !== "rapid") t.cuts = true;
    byTool.set(s.tool, t);
  }
  const names = Object.fromEntries(m.info.tools.map((t) => [t.t, t.note]));
  return [...byTool.entries()].sort((a, b) => a[1].first - b[1].first).map(([t, at]) => {
    const T = m.perTool[t];
    const kinds = (m.sim?.toolKinds?.[t] || []).map((k) => KIND[k]).filter(Boolean);
    const bits = [];
    if (m.kind === "lathe") {
      if (kinds.length) bits.push(`It ${kinds.length > 1 ? `${kinds.slice(0, -1).join(", ")} and ${kinds.at(-1)}` : kinds[0]}.`);
      if (kinds.includes("turns the outside") && m.sizes?.steps.length) bits.push(`The outside ends up ${m.sizes.steps.filter((x) => !x.groove).map((x) => `\u00D8${sizeText(x.dia, u)}${x.len != null ? ` for ${sizeText(x.len, u)}` : ""}`).join(", ")}.`);
      if (kinds.includes("cuts a groove")) { const g = m.sizes?.steps.filter((x) => x.groove) || []; if (g.length) bits.push(`Groove${g.length === 1 ? "" : "s"}: ${g.map((x) => `\u00D8${sizeText(x.dia, u)} at ${zText(x.mid, u)}`).join(", ")}.`); }
      if (kinds.includes("cuts a thread")) for (const th of m.sim.threads) bits.push(`Thread from ${zText(th.z1, u)} to ${zText(th.z0, u)}, root \u00D8${sizeText(th.minor * 2, u)}${th.pitch ? `, ${Math.round(1 / th.pitch)} threads per inch` : ""}.`);
    } else if (T?.cuts) {
      bits.push(`It cuts down to Z${n4(T.zLow)}, over X ${n4(T.box[0])} to ${n4(T.box[1])} and Y ${n4(T.box[2])} to ${n4(T.box[3])}.`);
    }
    if (!at.cuts) bits.push("It doesn't cut anything the app can follow.");
    if (T?.rpm) bits.push(T.rpm >= 99999 ? "No spindle speed limit is set while it cuts." : `The spindle runs up to about ${Math.round(T.rpm)} rpm.`);
    return { tool: `T${t}${names[t] ? ` (${names[t]})` : ""}`, lines: at.first === at.last ? `${at.first}` : `${at.first}-${at.last}`, what: bits.join(" ") };
  });
}

// ---- which program a rewrite starts from, and is measured against ---------------
//
// The proven one if there is one, otherwise the newest that a person put there.
// Never an unproven AI draft: measuring a draft against a draft lets small
// differences pile up run after run, and a draft someone saved "with its
// problems" would become the standard the next one is held to.
export function baselineOf(programs = []) {
  return programs.find((p) => p.status === "proven")
    || programs.find((p) => p.ai?.kind !== "rewrite")
    || programs[0] || null;
}

// ---- the rewrite: write, measure, fix, read again ------------------------------
//
// ask(task, input) -> { result, usage, notes }. onStep hears what's happening.
// Never more than 1 write + 3 fixes + 3 second reads.
export const MAX_FIXES = 3;
export const MAX_READS = 3;

export async function runRewrite({ ask, part, programs, machineFacts = {}, instruction, sizesMayChange = false, speedsMayRise = false, onStep = () => {}, now = new Date() }) {
  const current = baselineOf(programs);
  if (!current) throw new Error("There is no program to rewrite.");
  const needs = rewriteNeeds(part, programs, machineFacts);
  if (needs.length) throw new Error(`Fill these in on the part first: ${needs.map((n) => n.label.toLowerCase()).join(", ")}.`);
  const base = {
    // the pack is built round the program being worked from, with it first
    pack: buildAiPack(part, [current, ...programs.filter((p) => p !== current)], machineFacts),
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
  const secondPassed = (r) => !!r && r.verdict === "ok_to_prove_out" && stopsIn(r.findings).length === 0;
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
    second = { verdict: v.verdict === "ok_to_prove_out" ? "ok_to_prove_out" : "do_not_run", findings: placeFindings(v.findings, program), checked: (v.checked || []).filter(Boolean), couldNotCheck: (v.couldNotCheck || []).filter(Boolean) };
    // The second reader has to say "ok" AND list nothing that stops it. Either
    // one on its own is not a pass: "do not run" with an empty list still means
    // do not run.
    if (secondPassed(second)) break;
    if (fixes >= MAX_FIXES) break;
    fixes += 1;
    step("fix", `Fixing what the second read found (${Math.max(stopsIn(second.findings).length, 1)})`);
    const told = second.findings.length ? second.findings : [{ level: "stop", text: "The second reader said this must not be run, without saying why. Go through it again line by line, following the tool, and correct anything unsafe.", line: null, from: "ai" }];
    answer = await call("fix", { draft: program, problems: problemsText([...told, ...measured.filter(worthFixing)]) });
    program = stampDraft(answer.program, { date: now });
    second = null;
  }

  const reasons = [];
  if (stopsIn(measured).length) reasons.push(`${stopsIn(measured).length} problem${stopsIn(measured).length === 1 ? "" : "s"} the measurements found ${stopsIn(measured).length === 1 ? "is" : "are"} still there.`);
  if (!second) reasons.push(stopsIn(measured).length ? "It wasn't given a second read, because it didn't pass the measurements." : "The final version wasn't given a second read.");
  else if (stopsIn(second.findings).length) reasons.push(`The second read found ${stopsIn(second.findings).length} problem${stopsIn(second.findings).length === 1 ? "" : "s"} that ${stopsIn(second.findings).length === 1 ? "wasn't" : "weren't"} fixed.`);
  else if (!secondPassed(second)) reasons.push("The second read said this should not be run.");
  // Four outcomes, and only one of them is a pass:
  //   passed      the machine does exactly what it did before (comments, or something slower)
  //   changed     it changes what the machine does; nothing was found wrong, but no set of
  //               checks covers everything, so a person has to read the changed lines
  //   unmeasured  as above, on a program the app can't follow at all
  //   problems    something was found
  const verdict = reasons.length ? "problems" : measured.sameMachine ? "passed" : measured.unmeasured ? "unmeasured" : "changed";
  step("done", verdict === "passed" ? "Done. The machine does exactly what it did before." : verdict === "problems" ? "Done. It did not pass." : "Done. Nothing was found wrong, but it needs a lead to read it.");

  return {
    kind: "rewrite", verdict, reasons, program,
    instruction: base.instruction, sizesMayChange: base.sizesMayChange, speedsMayRise: base.speedsMayRise,
    summary: String(answer.summary || "").trim(),
    changes: (answer.changes || []).filter((c) => c?.what),
    assumptions: (answer.assumptions || []).filter(Boolean),
    questions: (answer.questions || []).filter(Boolean),
    measured, second, fixes, reads,
    coverage: measured.coverage || { measured: [], notMeasured: [] },
    unmeasured: measured.unmeasured || "",
    changedLines: diffPrograms(current.content, program).changes.filter((c) => c.op === "+" && c.text.replace(/\([^)]*\)/g, "").trim()).length,
    diff: diffPrograms(current.content, program),
    usage, cost: costOf(usage), notes: [...notes],
    demo: [...notes].some((n) => /^Demo:/.test(n)),
    basedOn: { id: current.id || null, name: current.name || "", proven: current.status === "proven", newest: current === programs[0] },
    at: now.getTime(),
  };
}

// ---- the review: read it, then check each finding ------------------------------
export async function runReview({ ask, part, programs, machineFacts = {}, onStep = () => {}, now = new Date() }) {
  const current = programs?.[0];   // a check reads whatever is newest, drafts included
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
    // The answers are matched to the findings by number. If the numbers don't
    // line up one for one, none of them can be trusted to be about the right
    // finding, so every finding is treated as unanswered.
    const got = (c.results || []).filter((x) => x && Number.isInteger(Number(x.index)));
    const numbers = got.map((x) => Number(x.index));
    const lined = got.length === findings.length && new Set(numbers).size === got.length && numbers.every((n) => n >= 1 && n <= findings.length);
    const verdicts = new Map(lined ? got.map((x) => [Number(x.index), x]) : []);
    checked = true;
    const kept = [];
    findings.forEach((f, i) => {
      const v = verdicts.get(i + 1);
      const why = String(v?.reason || "").trim();
      if (v?.verdict === "confirmed") kept.push({ ...f, confirmed: true });
      // Two readers disagreeing about something that would stop the program is
      // not settled by the second one: a person looks at it.
      else if (v?.verdict === "rejected" && f.level === "stop") kept.push({ ...f, level: "look", unsure: `The second pass disagreed: ${why || "it gave no reason"}` });
      else if (v?.verdict === "rejected") rejected.push({ ...f, why });
      // not sure, or never answered: it stays, but it can't be a "stop" on one reader's word
      else kept.push({ ...f, level: f.level === "stop" ? "look" : f.level, unsure: why || "The second pass didn't answer on this one." });
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
    demo: [...notes].some((n) => /^Demo:/.test(n)),
    of: { id: current.id || null, name: current.name || "" },
    at: now.getTime(),
  };
}

// What's kept with a saved draft: enough to show how it came about, small
// enough to sit in the program's row.
export function reportToKeep(run) {
  const trim = (list, n = 40) => (list || []).slice(0, n);
  return {
    kind: "rewrite", verdict: run.verdict, reasons: run.reasons, at: run.at, unmeasured: run.unmeasured || "", changedLines: run.changedLines || 0,
    instruction: run.instruction, sizesMayChange: run.sizesMayChange, speedsMayRise: run.speedsMayRise,
    summary: run.summary, changes: trim(run.changes), assumptions: trim(run.assumptions), questions: trim(run.questions),
    measured: trim(run.measured.filter((f) => f.level !== "note" && !f.was)).map(({ level, text, line }) => ({ level, text, line })),
    second: run.second ? { verdict: run.second.verdict, findings: trim(run.second.findings).map(({ level, text, line, fix }) => ({ level, text, line, fix })), checked: trim(run.second.checked, 20), couldNotCheck: trim(run.second.couldNotCheck, 20) } : null,
    coverage: { measured: trim(run.coverage?.measured, 20), notMeasured: trim(run.coverage?.notMeasured, 20) },
    fixes: run.fixes, reads: run.reads, cost: run.cost, basedOn: run.basedOn, demo: !!run.demo,
  };
}
