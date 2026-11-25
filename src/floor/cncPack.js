// Everything a programmer (a person or an AI) needs to fix or rewrite a part's
// CNC program, gathered on the part: the program files themselves, the facts
// that aren't in any file (what's finished by hand, how it's held, stock), and
// the machine's real tool list. This file is the logic; CncPrograms.jsx and
// CncMachines.jsx are the screens.
//
// Why it exists: programs were being edited by pasting them into a chatbot that
// knew nothing about the machine, so it guessed the tools and the stock. The
// pack below is the opposite of guessing.

import { MACHINES } from "./machines.js";
import { splitMachines, splitPrograms } from "./cncParts.js";
import { programInfo, programLine, looksLikeProgram, checkProgram, checkCounts, diffPrograms, operatorStops } from "./cncGcode.js";

// ---- facts on a part (cnc_parts.facts, one jsonb so a new box never needs a migration)
export const FACT_FIELDS = [
  { key: "stock", label: "Stock size", placeholder: "e.g. 1.25″ round bar, cut 3.1″ long" },
  { key: "perRun", label: "How many per run", placeholder: "e.g. 50" },
  { key: "byHand", label: "Finished by hand after the machine", placeholder: "e.g. deburr both ends, drill the cross hole on the drill press, tap 3/8-16", long: true },
  { key: "byHandMin", label: "Hand time per part (minutes)", placeholder: "e.g. 4" },
  { key: "holding", label: "How it's held", placeholder: "e.g. 3-jaw chuck, soft jaws, 1″ stick-out", long: true },
  { key: "problems", label: "Known problems", placeholder: "e.g. chatter on the long turn, thread comes out tight", long: true },
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
    model: text("model"), holding: text("holding"), maxBar: text("maxBar"), liveTools: text("liveTools"), notes: text("notes"),
    tools: cleanTools(f?.tools),
    photos: (Array.isArray(f?.photos) ? f.photos : []).filter((u) => typeof u === "string" && u),
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
  if (!machines.length) return checkProgram(content);
  const seen = new Set();
  const out = [];
  for (const m of machines) {
    const found = checkProgram(content, {
      machineKind: m.kind, machineLabel: `the ${m.short}`,
      machineTools: cleanTools(machineFactsByKey?.[m.key]?.tools),
    });
    for (const f of found) { const k = `${f.level}|${f.text}`; if (!seen.has(k)) { seen.add(k); out.push(f); } }
  }
  const order = { stop: 0, look: 1, note: 2 };
  return out.sort((x, y) => order[x.level] - order[y.level]);
}

// ---- is this part ready to hand to a programmer? ----------------------------
export function readiness(part, programs = [], machineFactsByKey = {}) {
  const facts = cleanFacts(part?.facts);
  const machines = splitMachines(part?.machine);
  const toolLists = machines.filter((k) => cleanTools(machineFactsByKey?.[k]?.tools).length > 0);
  return [
    { key: "program", label: "Program file", ok: programs.length > 0, how: "Upload the file the Haas runs." },
    { key: "drawing", label: "Drawing with dimensions", ok: !!part?.blueprintUrl, how: "Upload the blueprint above." },
    { key: "machine", label: "Which machine", ok: machines.length > 0, how: "Pick the CNC machine above." },
    { key: "tools", label: "That machine's tool list", ok: machines.length > 0 && toolLists.length === machines.length, how: "Fill in the tool list on the Machines page." },
    { key: "material", label: "Material and stock size", ok: !!String(part?.material || "").trim() && !!facts.stock, how: "Fill in Material above and Stock size here." },
    { key: "byHand", label: "What's finished by hand", ok: !!facts.byHand, how: "Say what gets done after the machine (or type “nothing”)." },
    { key: "holding", label: "How it's held", ok: !!facts.holding, how: "Describe the chuck or vise setup; a photo in More photos helps too." },
  ];
}
export const readyCount = (list) => list.filter((x) => x.ok).length;

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
  L.push("== HOW IT'S MADE NOW ==");
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
    add("Model / year", f.model);
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
    const base = { file: f.name, text: f.text };
    if ((f.size ?? f.text?.length ?? 0) > MAX_PROGRAM_BYTES) return { ...base, action: "skip", why: "Too big to be a program (over 2 MB)." };
    if (!looksLikeProgram(f.text)) return { ...base, action: "skip", why: "Not a program file." };
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
