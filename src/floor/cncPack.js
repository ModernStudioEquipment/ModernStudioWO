// Everything a programmer (a person or an AI) needs to fix or rewrite a part's
// CNC program, gathered on the part: the program files themselves, the facts
// that aren't in any file (what's finished by hand, how it's held, stock), and
// the machine's real tool list. This file is the logic; CncPrograms.jsx and
// CncMachines.jsx are the screens.
//
// Why it exists: programs were being edited by pasting them into a chatbot that
// knew nothing about the machine, so it guessed the tools and the stock. The
// pack below is the opposite of guessing.

import { MACHINES, controlOf } from "./machines.js";
import { cleanGuides } from "./cncKeypad.js";
import { splitMachines, splitPrograms } from "./cncParts.js";
import { programInfo, programLine, looksLikeProgram, checkProgram, checkCounts, diffPrograms, operatorStops, cleanProgramText } from "./cncGcode.js";
import { toolpath } from "./cncPath.js";
import { simulateLathe, parseStock, partSizes } from "./cncSolid.js";

// ---- facts on a part (cnc_parts.facts, one jsonb so a new box never needs a migration)
// Each box is asked as a question (`ask`), with one line on what it's for
// (`why`). `label` is the short name used in the hand-off text and checklist.
// The three without `optional` are what a program can't be checked or fixed
// without.
export const FACT_FIELDS = [
  { key: "stock", label: "Stock size", ask: "What does it start from?", why: "The raw bar or block and its size. The 3D view and the crash check need this.", placeholder: "e.g. 1.25″ round bar, cut 3.1″ long" },
  { key: "holding", label: "How it's held", ask: "How is it held in the machine?", why: "Chuck, collet or vise, and how far it sticks out.", placeholder: "e.g. 3-jaw chuck, soft jaws, 1″ stick-out", long: true },
  { key: "byHand", label: "Finished by hand after the machine", ask: "What gets finished by hand afterwards?", why: "Everything done to the part once it's out of the machine. Write “nothing” if there isn't any.", placeholder: "e.g. deburr both ends, drill the cross hole on the drill press, tap 3/8-16", long: true },
  { key: "byHandMin", label: "Hand time per part (minutes)", ask: "How many minutes does that hand work take, per part?", why: "This is what ranks the part on the Fix first list.", placeholder: "e.g. 4", optional: true },
  { key: "perRun", label: "How many per run", ask: "How many do you make at a time?", why: "Used to work out the time for a whole run.", placeholder: "e.g. 50", optional: true },
  { key: "problems", label: "Known problems", ask: "Any problems with this part?", why: "Bad finish, chatter, a size that comes out wrong.", placeholder: "e.g. chatter on the long turn, thread comes out tight", long: true, optional: true },
];
const FACT_KEYS = FACT_FIELDS.map((f) => f.key);

export function cleanFacts(facts) {
  const out = {};
  for (const k of FACT_KEYS) {
    const v = String(facts?.[k] ?? "").trim();
    if (v) out[k] = v;
  }
  return out;
}
// Only name the facts column once it exists (seen on load) or there's something
// to keep. Naming it before 0068 runs would fail every part save.
export const shouldWriteFacts = (p) => !!p.factsColumn || Object.keys(cleanFacts(p.facts)).length > 0;

// ---- facts on a machine
export function cleanTools(list) {
  return (Array.isArray(list) ? list : [])
    .map((r) => ({ t: String(r?.t ?? "").trim().replace(/^t/i, ""), what: String(r?.what ?? "").trim() }))
    .filter((r) => r.t || r.what);
}
export function cleanMachineFacts(f) {
  const text = (k) => String(f?.[k] ?? "").trim();
  return {
    model: text("model"), control: ["classic", "ngc"].includes(text("control")) ? text("control") : "", holding: text("holding"), maxBar: text("maxBar"), liveTools: text("liveTools"), notes: text("notes"),
    tools: cleanTools(f?.tools),
    photos: (Array.isArray(f?.photos) ? f.photos : []).filter((u) => typeof u === "string" && u),
    guides: cleanGuides(f?.guides),   // the control panel guides as the shop changed them (cncKeypad.js)
  };
}

// ---- reading a program file: see cncGcode.js -------------------------------
export { programInfo, programLine, looksLikeProgram, checkProgram, checkCounts, diffPrograms, operatorStops };

// Tools the program calls that the machine's tool list doesn't have.
export function missingTools(info, machineFacts) {
  const have = new Set(cleanTools(machineFacts?.tools).map((r) => String(Number(r.t))));
  if (!have.size) return [];
  return info.tools.map((x) => x.t).filter((t) => !have.has(String(t)));
}

// The checker, run for a part: against each machine the part is set to.
export function checkForPart(content, part, machineFactsByKey = {}) {
  const machines = splitMachines(part?.machine).map((k) => MACHINES.find((m) => m.key === k)).filter(Boolean);
  if (!machines.length) return [...checkProgram(content), ...rapidCheck(content, part)];
  const seen = new Set();
  const out = [];
  for (const m of machines) {
    const found = checkProgram(content, {
      machineKind: m.kind, machineLabel: `the ${m.short}`,
      machineTools: cleanTools(machineFactsByKey?.[m.key]?.tools),
    });
    for (const f of found) { const k = `${f.level}|${f.text}`; if (!seen.has(k)) { seen.add(k); out.push(f); } }
  }
  for (const f of rapidCheck(content, part, machines[0]?.kind)) out.push(f);
  const order = { stop: 0, look: 1, note: 2 };
  return out.sort((x, y) => order[x.level] - order[y.level]);
}

// A lathe rapid that goes through the bar. This one isn't a rule about how the
// program is written: it cuts the bar down move by move (cncSolid.js) and asks,
// at each rapid, whether metal is still in the way. It needs the stock size
// from the part; without it there's nothing true to check against, and it says
// so rather than guessing.
export function rapidCheck(content, part, machineKind = "") {
  const path = toolpath(content, { kind: machineKind });
  if (path.kind !== "lathe" || !path.segs.length) return [];
  const stock = parseStock(part?.facts?.stock);
  if (!stock) return [{ level: "note", text: "Put the stock size on the part and rapid moves get checked against the bar.", line: null }];
  const sim = simulateLathe(path, stock);
  if (!sim) return [];
  const unit = path.units === "mm" ? " mm" : "″";
  const n = (v) => Number(v.toFixed(3)).toString();
  // Two work offsets means two zeros, and the bar is only drawn at one of them.
  const unsure = sim.unsure || (programInfo(content).offsets.length > 1 ? "the program uses more than one work offset" : "");
  return sim.collisions.slice(0, 8).map((c) => ({
    level: unsure ? "look" : "stop",
    text: unsure
      ? `A rapid move may go through the bar (${n(c.depth)}${unit} at Z${n(c.z)}). Check it: ${unsure}.`
      : `A rapid move goes through the bar: ${n(c.depth)}${unit} into the metal at Z${n(c.z)}. Open the 3D preview to see it.`,
    line: c.line,
  }));
}

// The sizes a lathe program leaves the part at (see partSizes), or null for a
// mill program or one that can't be followed. For the places that want the
// numbers without the picture: proving out, the floor.
export function finishedSizes(content, part, machineKind = "") {
  const path = toolpath(content, { kind: machineKind });
  if (path.kind !== "lathe" || !path.segs.length) return null;
  const sim = simulateLathe(path, parseStock(part?.facts?.stock));
  return sim ? { ...partSizes(sim), units: path.units === "mm" ? "mm" : "in" } : null;
}

// A problem with a program, reported from the machine. It's added to the
// part's "known problems" with the date and who said it, so the next person
// to open the part, and the AI when it's asked to fix it, both see it.
export function addProblem(part, text, by, now = new Date()) {
  const said = String(text || "").trim().replace(/\s+/g, " ");
  if (!said) return part;
  const who = String(by || "").trim();
  const line = `${now.getMonth() + 1}/${now.getDate()}${who ? ` ${who}` : ""}: ${said}`;
  const old = String(part?.facts?.problems || "").trim();
  return { ...part, facts: { ...(part?.facts || {}), problems: old ? `${old}\n${line}` : line } };
}

// ---- is this part ready to hand to a programmer? ----------------------------
export function readiness(part, programs = [], machineFactsByKey = {}) {
  const facts = cleanFacts(part?.facts);
  const machines = splitMachines(part?.machine);
  const toolLists = machines.filter((k) => cleanTools(machineFactsByKey?.[k]?.tools).length > 0);
  return [
    { key: "program", label: "Program file", ok: programs.length > 0, how: "Upload the file the Haas runs." },
    // Worth having, and a programmer will want it, but an operator can run a
    // proven program without one: it never holds a part's setup up.
    { key: "drawing", label: "Drawing with dimensions", ok: !!part?.blueprintUrl, how: "Upload the blueprint if there is one.", optional: true },
    { key: "machine", label: "Which machine", ok: machines.length > 0, how: "Pick the machine it runs on." },
    { key: "tools", label: "That machine's tool list", ok: machines.length > 0 && toolLists.length === machines.length, how: machines.length ? "On the Machines page." : "Pick the machine first." },
    { key: "material", label: "Material and stock size", ok: !!String(part?.material || "").trim() && !!facts.stock, how: !String(part?.material || "").trim() ? "Say what it's made of." : "Say what it starts from." },
    { key: "byHand", label: "What's finished by hand", ok: !!facts.byHand, how: "Or write “nothing”." },
    { key: "holding", label: "How it's held", ok: !!facts.holding, how: "Chuck, collet or vise." },
  ];
}
export const readyCount = (list) => list.filter((x) => x.ok).length;

// ---- the guided setup: one question at a time ---------------------------------
//
// The same things the full form asks, in the order they make sense, each as its
// own question. `needed` ones are what a program can't be checked or run
// without; the rest can be skipped and never hold a part up.
const fact = (key) => FACT_FIELDS.find((f) => f.key === key);
export const WIZARD_STEPS = [
  { key: "name", kind: "text", needed: true, ask: "What's this part called?", why: "The name people on the floor know it by.", placeholder: "e.g. 3″ Steel Baby Pin" },
  { key: "machine", kind: "machine", needed: true, ask: "Which machine makes it?", why: "Pick two if it runs on both." },
  { key: "program", kind: "program", needed: true, ask: "Add the program for this part", why: "The file the Haas runs. Copy it off the machine onto a USB stick, then pick it here." },
  { key: "material", kind: "text", needed: true, ask: "What's it made of?", why: "The 3D view shows it in this metal.", placeholder: "e.g. 1018 steel", picks: ["6061 aluminum", "1018 steel", "303 stainless", "360 brass", "Delrin"] },
  { key: "stock", kind: "fact", needed: true, ...pickAsk(fact("stock")) },
  { key: "holding", kind: "fact", needed: true, ...pickAsk(fact("holding")) },
  { key: "byHand", kind: "fact", needed: true, ...pickAsk(fact("byHand")), picks: ["Nothing"] },
  { key: "byHandMin", kind: "fact", ...pickAsk(fact("byHandMin")) },
  { key: "perRun", kind: "fact", ...pickAsk(fact("perRun")) },
  { key: "sku", kind: "text", ask: "Does it have a SKU or part number?", why: "Work orders use this to find the part.", placeholder: "e.g. BP-3" },
  { key: "drawing", kind: "drawing", ask: "Got a drawing or blueprint?", why: "A photo of the print is fine." },
  { key: "problems", kind: "fact", ...pickAsk(fact("problems")) },
];
function pickAsk(f) { return { ask: f.ask, why: f.why, placeholder: f.placeholder, long: !!f.long }; }

export function wizardAnswer(key, part, programs = []) {
  if (key === "name") return String(part?.name || "").trim();
  if (key === "sku") return String(part?.sku || "").trim();
  if (key === "machine") return splitMachines(part?.machine).join(",");
  if (key === "material") return String(part?.material || "").trim();
  if (key === "program") return programs.length ? "yes" : "";
  if (key === "drawing") return part?.blueprintUrl ? "yes" : "";
  return String(part?.facts?.[key] || "").trim();
}
// Which questions to ask: only the ones not answered yet, unless reviewing.
// How long the hand work takes is only asked when there is some.
//   default    the needed ones still open (so "Answer 3 questions" asks 3);
//              when none of those are left, the optional ones still open
//   all        every question, to review or change answers
export function wizardSteps(part, programs = [], { all = false } = {}) {
  const none = /^(none|nothing|no|n\/a|na)\.?$/i.test(String(part?.facts?.byHand || "").trim());
  const open = WIZARD_STEPS.filter((s) => !wizardAnswer(s.key, part, programs));
  const pick = all ? WIZARD_STEPS : open.some((s) => s.needed) ? open.filter((s) => s.needed) : open;
  return pick.filter((s) => !(s.key === "byHandMin" && none)).map((s) => s.key);
}
export const neededLeft = (part, programs = []) => WIZARD_STEPS.filter((s) => s.needed && !wizardAnswer(s.key, part, programs)).length;

// ---- what to do next ----------------------------------------------------------
//
// One plain instruction for a part, so nobody has to work out where they are.
// The order is the order the work really goes in: get the program in, fix what
// the checker found, fill in what the program can't know, prove it out.
//
// `stops` is how many "fix before it runs" findings the newest program has.
export const PART_STEPS = ["Program", "Checks", "Setup", "Proven"];

export function nextStep(part, programs = [], machineFactsByKey = {}, stops = 0) {
  const newest = programs[0] || null;
  const ready = readiness(part, programs, machineFactsByKey);
  const missing = ready.filter((r) => !r.ok && r.key !== "program" && !r.optional);
  const proven = programs.find((p) => p.status === "proven") || null;
  const done = {
    Program: !!newest,
    Checks: !!newest && stops === 0,
    Setup: missing.length === 0,
    Proven: !!newest && newest.status === "proven",
  };
  if (!part?.id) return { at: "Program", done, tone: "todo", text: "Give the part a name and save it. Then upload its program." };
  if (!newest) return { at: "Program", done, tone: "todo", text: "Upload this part's program file (the one off the Haas)." };
  if (stops > 0) return { at: "Checks", done, tone: "stop", text: `Fix the ${stops === 1 ? "problem" : `${stops} problems`} the checker found, then upload the fixed program.` };
  if (missing.length) {
    // One thing: name it. Several: just say how many, the questions do the rest.
    const text = missing.length === 1 ? `One thing left to fill in: ${missing[0].label.toLowerCase()}.` : `${missing.length} things about the setup still need filling in.`;
    return { at: "Setup", done, tone: "todo", text };
  }
  if (newest.status !== "proven") {
    return { at: "Proven", done, tone: "todo", text: proven ? "This newer version hasn't been tested at the machine yet. Test it, and if the first part comes out right, mark it as good." : "Last step: test it at the machine. If the first part comes out right, mark it as good." };
  }
  return { at: "", done, tone: "done", text: `Ready to run. Proven${newest.provenBy ? ` by ${newest.provenBy}` : ""}.` };
}

// The whole catalogue, as four counts: where the shop is in getting set up.
export function catalogProgress(parts = [], programIndex = [], machineFactsByKey = {}) {
  const withProgram = new Set(programIndex.map((p) => p.partId));
  const newest = new Map();
  for (const p of programIndex) { const c = newest.get(p.partId); if (!c || p.createdAt > c.createdAt) newest.set(p.partId, p); }
  const used = new Set(parts.flatMap((p) => splitMachines(p.machine)));
  const machinesNeeded = MACHINES.filter((m) => used.has(m.key));
  const machinesDone = machinesNeeded.filter((m) => cleanTools(machineFactsByKey?.[m.key]?.tools).length > 0);
  const setUp = parts.filter((p) => {
    const f = cleanFacts(p.facts);
    return splitMachines(p.machine).length > 0 && !!f.stock && !!f.holding && !!f.byHand;
  });
  const proven = parts.filter((p) => newest.get(p.id)?.status === "proven");
  const steps = [
    { key: "import", title: "Bring in the programs", done: parts.filter((p) => withProgram.has(p.id)).length, of: parts.length,
      what: "Copy them off each Haas to a USB stick and import them here, one machine at a time." },
    { key: "machines", title: "List each machine's tools", done: machinesDone.length, of: Math.max(machinesNeeded.length, 1),
      what: "Take the tools the programs call, then correct them against what's really in each pocket." },
    { key: "setup", title: "Add the setup for each part", done: setUp.length, of: parts.length,
      what: "Machine, stock size, how it's held, and what's finished by hand." },
    { key: "prove", title: "Prove each program out", done: proven.length, of: parts.length,
      what: "Test each one at the machine: run it in Graphics, then single block, measure the first part, and mark it as good." },
  ];
  const total = steps.reduce((n, s) => n + s.of, 0);
  const got = steps.reduce((n, s) => n + Math.min(s.done, s.of), 0);
  return {
    steps,
    percent: parts.length ? Math.round((got / Math.max(total, 1)) * 100) : 0,
    // the first step that isn't finished: where to point people
    current: (steps.find((s) => s.done < s.of) || {}).key || "",
    empty: parts.length === 0,
  };
}

// ---- the pack: one block of text with everything -----------------------------
//
// Plain text on purpose: it can be pasted to an AI, emailed to a contract
// programmer, or printed. Nothing customer-related goes in (a part has none).
export function buildPack(part, programs = [], machineFactsByKey = {}) {
  const facts = cleanFacts(part?.facts);
  const L = [];
  const add = (label, v) => { if (String(v ?? "").trim()) L.push(`${label}: ${String(v).trim()}`); };
  L.push(`CNC PART PACK: ${part?.name || "Untitled part"}`);
  L.push("");
  L.push("== PART ==");
  add("Name", part?.name);
  add("SKU", part?.sku);
  add("Product number", part?.productNo);
  add("Program numbers", splitPrograms(part?.programNo).filter(Boolean).join(", "));
  add("Material", part?.material);
  add("Stock size", facts.stock);
  add("Made per run", facts.perRun);
  add("Drawing", part?.blueprintUrl);
  (part?.photos || []).forEach((u, i) => add(`Photo ${i + 1}`, u));
  L.push("");
  L.push("== OPERATOR STEPS (what the operator does at the machine, in order) ==");
  const steps = (part?.steps || []).map((s) => String(s || "").trim()).filter(Boolean);
  if (steps.length) steps.forEach((s, i) => L.push(`${i + 1}. ${s}`));
  else L.push("(no steps written)");
  add("Finished by hand after the machine", facts.byHand);
  add("Hand time per part (min)", facts.byHandMin);
  add("How it's held", facts.holding);
  add("Known problems", facts.problems);
  add("Notes", part?.notes);

  const machines = splitMachines(part?.machine);
  for (const k of machines) {
    const m = MACHINES.find((x) => x.key === k);
    const f = cleanMachineFacts(machineFactsByKey?.[k]);
    L.push("");
    L.push(`== MACHINE: ${m?.label || k} ==`);
    add("What it is", m?.about);
    add("Model / year", f.model);
    { const c = controlOf(m, f); if (c) add("Control", `${c.label}. ${c.looks} For which key does what, use Haas's own manual for this control: ${c.manual.name} (${c.manual.url}).`); }
    add("Workholding", f.holding);
    add("Largest bar", f.maxBar);
    add("Live tools", f.liveTools);
    add("Notes", f.notes);
    if (f.tools.length) {
      L.push("Tool list:");
      f.tools.forEach((r) => L.push(`  T${r.t}  ${r.what}`));
    } else {
      L.push("Tool list: NOT FILLED IN. Do not assume tools.");
    }
  }
  if (!machines.length) { L.push(""); L.push("== MACHINE: not chosen =="); }

  programs.forEach((p, i) => {
    const info = programInfo(p.content);
    L.push("");
    L.push(`== PROGRAM ${i + 1} of ${programs.length}: ${p.name || "unnamed"} ==`);
    L.push(`Status: ${p.status === "proven" ? `PROVEN${p.provenBy ? ` by ${p.provenBy}` : ""}` : "NOT PROVEN"}`);
    L.push(`Summary: ${programLine(info)}`);
    add("Note", p.note);
    const found = checkForPart(p.content, part, machineFactsByKey);
    if (found.length) {
      L.push("Automatic checks (rules, not a simulation):");
      found.forEach((f) => L.push(`  [${f.level === "stop" ? "FIX" : f.level === "look" ? "CHECK" : "note"}] ${f.text}${f.line ? ` (line ${f.line})` : ""}`));
    }
    L.push("---- start of program ----");
    L.push(String(p.content || "").replace(/\r\n?/g, "\n").trimEnd());
    L.push("---- end of program ----");
  });
  if (!programs.length) { L.push(""); L.push("== PROGRAM: none uploaded =="); }

  const missing = readiness(part, programs, machineFactsByKey).filter((x) => !x.ok);
  if (missing.length) {
    L.push("");
    L.push("== MISSING (ask before assuming) ==");
    missing.forEach((x) => L.push(`- ${x.label}`));
  }
  return L.join("\n");
}

export const MAX_PROGRAM_BYTES = 2 * 1024 * 1024;

// What "proven" means here. A program is only stamped once someone has done
// all three, in this order, at the machine.
export const PROVE_STEPS = [
  "Ran it in Graphics first, with no alarms",
  "Ran the first part in Single Block with the rapids turned down",
  "Measured the first part against the drawing",
];

// ---- the run sheet ----------------------------------------------------------
//
// One page for whoever is standing at the machine: what to load, how to hold
// it, where the program will stop, and whether the program has been proven.
// Built from what's already on the part and the machine, so nobody writes it.
// `program` is the version to run (the newest, unless a specific one is asked
// for); with none, the sheet still lists the part and says there's no program.
export const machineForKind = (kind) => {
  const of = MACHINES.filter((m) => m.kind === kind);
  return of.length === 1 ? of[0].key : "";
};

export function runSheet(part, program, machineFactsByKey = {}) {
  const facts = cleanFacts(part?.facts);
  const info = program ? programInfo(program.content) : null;
  const machines = splitMachines(part?.machine).map((k) => MACHINES.find((m) => m.key === k)).filter(Boolean);
  const steps = (part?.steps || []).map((s) => String(s || "").trim()).filter(Boolean);
  return {
    name: part?.name || "Untitled part",
    sku: part?.sku || "",
    material: String(part?.material || "").trim(),
    stock: facts.stock || "",
    holding: facts.holding || "",
    byHand: facts.byHand || "",
    problems: facts.problems || "",
    notes: String(part?.notes || "").trim(),
    steps,
    drawing: part?.blueprintUrl || null,
    photo: (part?.photos || [])[0] || null,
    program: program ? {
      name: program.name || "", number: info.number, title: info.title, lines: info.lines,
      proven: program.status === "proven", provenBy: program.provenBy || "", provenAt: program.provenAt || null,
      offsets: info.offsets, stops: operatorStops(program.content),
    } : null,
    // Per machine: every tool the program calls, with what the tool list says is
    // in that pocket beside what the program expects to find there.
    machines: machines.map((m) => {
      const mf = cleanMachineFacts(machineFactsByKey?.[m.key]);
      const listed = new Map(mf.tools.map((r) => [Number(r.t), r.what]));
      return {
        key: m.key, label: m.label, holding: mf.holding,
        hasList: mf.tools.length > 0,
        tools: (info?.tools || []).map((t) => ({ t: t.t, called: t.note || "", listed: listed.get(t.t) ?? null })),
      };
    }),
    // No machine picked: still list what the program calls.
    tools: machines.length ? null : (info?.tools || []).map((t) => ({ t: t.t, called: t.note || "", listed: null })),
  };
}

// ---- a machine's tool list, read out of its programs ------------------------
//
// Most programs say what each tool is in a comment ("T3 M06 (1/4 DRILL)").
// Across every part on a machine that's most of its tool list already written
// down. This gathers them, newest version of each part only, so the Machines
// page can offer them instead of someone typing the list from scratch. Where
// programs disagree about a pocket, all the names are kept: that disagreement
// is worth seeing.
export function suggestTools(machineKey, parts = [], programIndex = [], currentTools = []) {
  const onMachine = new Set(parts.filter((p) => splitMachines(p.machine).includes(machineKey)).map((p) => p.id));
  const newest = new Map();
  for (const p of programIndex) {
    if (!onMachine.has(p.partId)) continue;
    const cur = newest.get(p.partId);
    if (!cur || p.createdAt > cur.createdAt) newest.set(p.partId, p);
  }
  const seen = new Map(); // tool number -> Map(name -> how many programs)
  for (const p of newest.values()) {
    for (const t of p.info?.tools || []) {
      if (!seen.has(t.t)) seen.set(t.t, new Map());
      const name = String(t.note || "").trim();
      const names = seen.get(t.t);
      names.set(name, (names.get(name) || 0) + 1);
    }
  }
  const listed = new Map(cleanTools(currentTools).map((r) => [Number(r.t), r.what]));
  return [...seen.entries()].sort((a, b) => a[0] - b[0]).map(([t, names]) => {
    const named = [...names.entries()].filter(([name]) => name).sort((a, b) => b[1] - a[1]);
    return {
      t,
      programs: [...names.values()].reduce((n, c) => n + c, 0),
      names: named.map(([name, count]) => ({ name, count })),
      listed: listed.has(t),
      listedAs: listed.get(t) || "",
      disagree: named.length > 1,
    };
  }).filter((s) => !s.listed || (!s.listedAs && s.names.length) || s.disagree);
}

// ---- importing a whole USB stick of programs --------------------------------
//
// The Haas backup is one file per program. Each is matched to a catalogue part
// by its program number (the part's "CNC program number" box), then by its
// title comment against the part name; anything left becomes a new part named
// from the title. Nothing is written here: this only builds the plan the
// import screen shows for approval.
export const programKey = (v) => String(v || "").replace(/\D/g, "").replace(/^0+/, "");
const stripExt = (name) => String(name || "").replace(/\.[A-Za-z0-9]{1,6}$/, "");
const same = (a, b) => String(a || "").trim().toLowerCase() === String(b || "").trim().toLowerCase();

export function planImport(files, parts = []) {
  return (files || []).map((f) => {
    const clean = cleanProgramText(f.text);
    const base = { file: f.name, text: clean.text, cleaned: clean.removed };
    if ((f.size ?? f.text?.length ?? 0) > MAX_PROGRAM_BYTES) return { ...base, action: "skip", why: "Too big to be a program (over 2 MB)." };
    // The probe's own software (Renishaw's macros, and the 9000-series
    // programs a Haas keeps for itself) runs the machine, not a part.
    if (/renishaw/i.test(`${f.name} ${clean.text.slice(0, 2000)}`)) return { ...base, action: "skip", why: "Renishaw probe macro: part of the machine's probing software, not a part program." };
    if (!clean.binary && /^O0?9\d{3}$/.test(programInfo(clean.text).number) && (clean.text.match(/[#\[]/g) || []).length > 20) return { ...base, action: "skip", why: "A 9000-series macro: part of the machine's own software, not a part program." };
    if (clean.binary || !looksLikeProgram(clean.text)) return { ...base, action: "skip", why: "Not a program file." };
    const info = programInfo(f.text);
    const key = programKey(info.number);
    const byNo = key ? parts.find((p) => splitPrograms(p.programNo).some((x) => programKey(x) === key)) : null;
    const byName = !byNo && info.title ? parts.find((p) => same(p.name, info.title)) : null;
    const hit = byNo || byName;
    if (hit) return { ...base, info, action: "add", partId: hit.id, partName: hit.name, matchedBy: byNo ? "program number" : "name" };
    const newName = info.title || stripExt(f.name) || info.number || "Imported program";
    return { ...base, info, action: "new", newKey: key ? `no:${key}` : `name:${newName.toLowerCase()}`, newName };
  });
}
export const importCounts = (rows) => ({
  add: rows.filter((r) => r.action === "add").length,
  new: new Set(rows.filter((r) => r.action === "new").map((r) => r.newKey)).size,
  skip: rows.filter((r) => r.action === "skip").length,
});

// ---- which parts to fix first -----------------------------------------------
//
// Hand work is the cost of a bad program. Minutes by hand per part, times how
// many are made per run, is the time a better program would give back every
// run. Parts with hand work written down but no numbers come next; parts with
// nothing recorded come last.
const firstNumber = (v) => { const m = /\d*\.?\d+/.exec(String(v ?? "")); return m ? Number(m[0]) : null; };

export function rankParts(parts = [], programIndex = []) {
  const byPart = new Map();
  for (const p of programIndex) { if (!byPart.has(p.partId)) byPart.set(p.partId, []); byPart.get(p.partId).push(p); }
  return parts.map((part) => {
    const facts = cleanFacts(part.facts);
    const min = firstNumber(facts.byHandMin);
    const run = firstNumber(facts.perRun);
    const nothing = /^(none|nothing|no|n\/a|na)\.?$/i.test(facts.byHand || "");
    const progs = (byPart.get(part.id) || []).slice().sort((a, b) => b.createdAt - a.createdAt);
    const latest = progs[0] || null;
    const perRunMin = min != null && !nothing ? min * (run ?? 1) : null;
    return {
      part, byHand: nothing ? "" : facts.byHand || "", min, run, perRunMin,
      status: !latest ? "none" : latest.status === "proven" ? "proven" : "unproven",
      score: perRunMin != null ? 1e6 + perRunMin : facts.byHand && !nothing ? 1e3 : 0,
    };
  }).sort((a, b) => b.score - a.score || String(a.part.name).localeCompare(String(b.part.name)));
}

// What a program file's name says. The shop names its files like
// "CNC-0240 - STACK 6.nc": the CNC number, then what the part is. Read here
// so it can be shown and searched without anyone typing it in again.
//   cnc      "CNC-0240", or "" when the name doesn't carry one
//   title    "STACK 6", what follows the number
//   program  the O-number inside the program ("O00636"), when it's known
export function fileLabel(name, info = {}) {
  const base = String(name || "").replace(/\.[a-z0-9]{1,4}$/i, "").trim();
  const m = /\bCNC[\s_-]*(\d+)/i.exec(base);
  return {
    cnc: m ? `CNC-${m[1]}` : "",
    title: m ? base.slice(m.index + m[0].length).replace(/^[\s_\-\u2013\u2014]+/, "").trim() : "",
    program: info?.number || "",
  };
}
