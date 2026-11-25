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

// ---- reading a program file -------------------------------------------------
//
// Not a G-code interpreter: just the handful of facts worth showing next to a
// file so a person can tell which program it is and whether it matches the
// machine. A lathe calls T0101 (tool 1, offset 1); a mill calls T1 M06.
const stripComments = (line) => line.replace(/\([^)]*\)/g, " ").replace(/;.*$/, " ");

export function programInfo(content) {
  const text = String(content || "").replace(/\r\n?/g, "\n");
  const lines = text.split("\n").filter((l) => l.trim() && l.trim() !== "%");
  const info = { number: "", title: "", tools: [], offsets: [], stops: 0, lines: lines.length };
  const tools = new Map();
  const offsets = new Set();
  for (const raw of lines) {
    const comment = (/\(([^)]*)\)/.exec(raw) || [])[1]?.trim() || "";
    const code = stripComments(raw).toUpperCase();
    if (!info.number) {
      const o = /^\s*[O:](\d{1,5})\b/.exec(code);
      if (o) { info.number = `O${o[1].padStart(5, "0")}`; info.title = comment; continue; }
    }
    for (const m of code.matchAll(/\bT(\d{1,4})\b/g)) {
      const n = Number(m[1]);
      const t = m[1].length >= 3 ? Math.floor(n / 100) : n; // T0101 -> tool 1
      if (!t) continue;                                     // T0 / T0100 cancels, not a tool
      if (!tools.has(t) || (!tools.get(t) && comment)) tools.set(t, comment);
    }
    for (const m of code.matchAll(/\bG(5[4-9])\b/g)) offsets.add(`G${m[1]}`);
    for (const m of code.matchAll(/\bG154\s*P(\d+)/g)) offsets.add(`G154 P${m[1]}`);
    if (/\bM0*[01]\b/.test(code)) info.stops += 1;
  }
  info.tools = [...tools.entries()].sort((a, b) => a[0] - b[0]).map(([t, note]) => ({ t, note }));
  info.offsets = [...offsets];
  return info;
}

// One line under a file name: "O04120 · T1, T3, T5 · G54 · 2 stops · 214 lines".
export function programLine(info) {
  return [
    info.number,
    info.tools.length ? info.tools.map((x) => `T${x.t}`).join(", ") : "no tool calls found",
    info.offsets.join(", "),
    info.stops ? `${info.stops} stop${info.stops === 1 ? "" : "s"}` : "",
    `${info.lines} line${info.lines === 1 ? "" : "s"}`,
  ].filter(Boolean).join(" · ");
}

// Tools the program calls that the machine's tool list doesn't have.
export function missingTools(info, machineFacts) {
  const have = new Set(cleanTools(machineFacts?.tools).map((r) => String(Number(r.t))));
  if (!have.size) return [];
  return info.tools.map((x) => x.t).filter((t) => !have.has(String(t)));
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

// A text file is a program; anything with a NUL byte in the first chunk isn't
// (someone picked the Mastercam file or a photo).
export const looksLikeText = (s) => typeof s === "string" && !/\u0000/.test(s.slice(0, 4000));
export const MAX_PROGRAM_BYTES = 2 * 1024 * 1024;
