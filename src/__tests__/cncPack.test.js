// @vitest-environment node
import { describe, it, expect } from "vitest";
import {
  programInfo, programLine, missingTools, readiness, readyCount, buildPack,
  cleanFacts, shouldWriteFacts, cleanTools, cleanMachineFacts, looksLikeProgram,
  checkProgram, checkCounts, checkForPart, diffPrograms, planImport, importCounts, programKey, rankParts, suggestTools,
  operatorStops, runSheet, machineForKind,
} from "../floor/cncPack.js";

// The program & setup pack: what a programmer (a person or an AI) is handed
// instead of guessing. These pin down what's read out of a program file and
// what counts as "ready".

const MILL = `%
O04120 (JUNIOR RECEIVER OP1)
(T1 - 1/2 FLAT ENDMILL)
G20 G17 G40 G80 G90
T1 M06 (1/2 FLAT ENDMILL)
G54 G00 X0. Y0. S6000 M03
G43 H01 Z1. M08
G01 Z-0.25 F20.
M01
T3 M06 (1/4 DRILL)
G55 G00 X1. Y1.
G81 Z-0.5 R0.1 F8.
G80
M30
%`;

const LATHE = `%
O00017 (3IN BABY PIN)
G28 U0 W0
T0101 (CNMG ROUGH)
G50 S3000
G96 S400 M03
G54 G00 X1.3 Z0.1 M08
G71 P10 Q20 U0.02 W0.005 D0.08 F0.012
N10 G00 X0.5
N20 G01 X1.25 Z-3.
G70 P10 Q20
T0100
M00
T0505 (THREAD)
G76 X0.3 Z-1. K0.04 D0.01 F0.0625
T0500
M30
%`;

describe("reading a program file", () => {
  it("reads a mill program: number, title, tools, offsets, stops", () => {
    const i = programInfo(MILL);
    expect(i.number).toBe("O04120");
    expect(i.title).toBe("JUNIOR RECEIVER OP1");
    expect(i.tools).toEqual([{ t: 1, note: "1/2 FLAT ENDMILL" }, { t: 3, note: "1/4 DRILL" }]);
    expect(i.offsets).toEqual(["G54", "G55"]);
    expect(i.stops).toBe(1);
  });
  it("reads a lathe program: T0101 is tool 1, T0100 cancels and isn't a tool", () => {
    const i = programInfo(LATHE);
    expect(i.number).toBe("O00017");
    expect(i.tools.map((t) => t.t)).toEqual([1, 5]);
    expect(i.tools[0].note).toBe("CNMG ROUGH");
    expect(i.stops).toBe(1);
  });
  it("a tool number in a comment isn't a tool call, and M30 or M10 isn't a stop", () => {
    const i = programInfo("O1\n(USE T9 IF T1 IS DULL)\nT2 M06\nM10\nM30\n");
    expect(i.tools.map((t) => t.t)).toEqual([2]);
    expect(i.stops).toBe(0);
  });
  it("copes with Windows line endings, G154 offsets and an empty file", () => {
    expect(programInfo("O5\r\nT1 M06\r\nG154 P3 X0\r\n").offsets).toEqual(["G154 P3"]);
    const empty = programInfo("");
    expect(empty.lines).toBe(0);
    expect(programLine(empty)).toContain("no tool calls found");
  });
  it("writes the one-line summary", () => {
    expect(programLine(programInfo(MILL))).toBe("O04120 · T1, T3 · G54, G55 · 1 stop · 13 lines");
  });
  it("flags a tool the machine's list doesn't have, and stays quiet with no list", () => {
    const i = programInfo(MILL);
    expect(missingTools(i, { tools: [{ t: "1", what: "endmill" }] })).toEqual([3]);
    expect(missingTools(i, { tools: [{ t: "T01", what: "endmill" }, { t: "3", what: "drill" }] })).toEqual([]);
    expect(missingTools(i, { tools: [] })).toEqual([]);
    expect(missingTools(i, undefined)).toEqual([]);
  });
  it("tells a program from a Mastercam file, a PDF and a note", () => {
    expect(looksLikeProgram(MILL)).toBe(true);
    expect(looksLikeProgram("O1\nT1 M06\nM30\n")).toBe(true);
    expect(looksLikeProgram("MCAM\u0000\u0001\u0002binary")).toBe(false);
    expect(looksLikeProgram("%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\nstream")).toBe(false);
    expect(looksLikeProgram("call bob about the pins\nthanks")).toBe(false);
    expect(looksLikeProgram("")).toBe(false);
  });
  it("reads a program typed with no spaces the same as one with", () => {
    const i = programInfo("O1234(PIN)\nT1M06(DRILL)\nG54G00X0Y0\nG43H01Z1.\nM00\nM30\n");
    expect(i.number).toBe("O01234");
    expect(i.tools).toEqual([{ t: 1, note: "DRILL" }]);
    expect(i.offsets).toEqual(["G54"]);
    expect(i.stops).toBe(1);
    expect(i.kind).toBe("mill");
  });
  it("a macro line never reads as a tool call", () => {
    expect(programInfo("O5\nWHILE[#1LT10]DO1\nIF[#2EQ1]GOTO10\n#100=T5\nT2 M06\nN10 M30\n").tools.map((t) => t.t)).toEqual([2]);
  });
  it("knows a lathe program from a mill program", () => {
    expect(programInfo(MILL).kind).toBe("mill");
    expect(programInfo(LATHE).kind).toBe("lathe");
  });
});

describe("facts", () => {
  it("keeps only the known boxes, trimmed, and drops empties", () => {
    expect(cleanFacts({ stock: " 1.25 bar ", byHand: "", junk: "x" })).toEqual({ stock: "1.25 bar" });
    expect(cleanFacts(null)).toEqual({});
  });
  it("only names the column once it exists or there's something to keep", () => {
    expect(shouldWriteFacts({ facts: {} })).toBe(false);
    expect(shouldWriteFacts({ facts: {}, factsColumn: true })).toBe(true);
    expect(shouldWriteFacts({ facts: { byHand: "deburr" } })).toBe(true);
  });
  it("cleans a tool list: T prefix off, blank rows out", () => {
    expect(cleanTools([{ t: "T3", what: " 1/2 drill " }, { t: "", what: "" }, { t: "5" }])).toEqual([
      { t: "3", what: "1/2 drill" }, { t: "5", what: "" },
    ]);
    expect(cleanMachineFacts(undefined).tools).toEqual([]);
  });
});

describe("ready to hand off", () => {
  const part = {
    name: "3in Baby Pin", sku: "BP-3", material: "1018 steel", machine: "st10", blueprintUrl: "https://x/bp.png",
    steps: ["Saw", "Turn"], photos: [], programNo: "O00017",
    facts: { stock: "1.25 bar", byHand: "deburr", holding: "3-jaw" },
  };
  const programs = [{ name: "O00017.nc", content: LATHE, status: "unproven" }];
  const machines = { st10: { tools: [{ t: "1", what: "CNMG" }, { t: "5", what: "thread" }] } };

  it("is ready when everything's there", () => {
    const r = readiness(part, programs, machines);
    expect(readyCount(r)).toBe(r.length);
  });
  it("names exactly what's missing", () => {
    const r = readiness({ ...part, blueprintUrl: null, facts: { stock: "1.25 bar" } }, [], {});
    expect(r.filter((x) => !x.ok).map((x) => x.key)).toEqual(["program", "drawing", "tools", "byHand", "holding"]);
  });
  it("a part on two machines needs both tool lists", () => {
    const r = readiness({ ...part, machine: "st10,vf4" }, programs, machines);
    expect(r.find((x) => x.key === "tools").ok).toBe(false);
  });

  it("the pack carries the part, the machine's tools and the whole program", () => {
    const text = buildPack(part, programs, machines);
    expect(text).toContain("CNC PART PACK: 3in Baby Pin");
    expect(text).toContain("Finished by hand after the machine: deburr");
    expect(text).toContain("== MACHINE: Haas ST-10 ==");
    expect(text).toContain("T5  thread");
    expect(text).toContain("Status: NOT PROVEN");
    expect(text).toContain("G76 X0.3 Z-1. K0.04 D0.01 F0.0625");
    expect(text).not.toContain("== MISSING");
  });
  it("the pack says so, loudly, when the tool list or a fact is missing", () => {
    const text = buildPack({ ...part, facts: {} }, programs, {});
    expect(text).toContain("Tool list: NOT FILLED IN. Do not assume tools.");
    expect(text).toContain("== MISSING (ask before assuming) ==");
    expect(text).toContain("- What's finished by hand");
  });
});

describe("the automatic checker", () => {
  const texts = (found, level) => found.filter((f) => !level || f.level === level).map((f) => f.text).join(" | ");

  it("a tidy mill program has nothing to fix", () => {
    const good = "O1\nG20 G40 G49 G80 G90\nT1 M06 (DRILL)\nG54 G00 X0 Y0 S1000 M03\nG43 H01 Z1. M08\nG81 Z-.5 R.1 F3.\nG80\nM30\n";
    expect(checkCounts(checkProgram(good, { machineKind: "mill" }))).toEqual({ stop: 0, look: 0, note: 0 });
  });
  it("mill: a tool used with no length offset is a stop", () => {
    const f = checkProgram("O1\nG20 G40 G49 G80\nT1 M06\nG54 G00 X0 Y0 S1000 M03 M08\nG01 Z-.1 F5.\nM30\n", { machineKind: "mill" });
    expect(texts(f, "stop")).toMatch(/T1 is used with no tool length offset/);
  });
  it("mill: flags a mismatched offset and a drilling cycle left on", () => {
    const f = checkProgram("O1\nG20 G40 G49 G80\nT2 M06\nG54 G00 X0 Y0 S1000 M03 M08\nG43 H03 Z1.\nG81 Z-.5 R.1 F3.\nM30\n", { machineKind: "mill" });
    expect(texts(f, "look")).toMatch(/T2 uses length offset H3/);
    expect(texts(f, "look")).toMatch(/drilling cycle is started and never cancelled/);
  });
  it("mill: the preselected next tool is the one the next M06 loads", () => {
    const prog = "O1\nG20 G40 G49 G80\nT1 M06\nT2\nG54 G43 H01 Z1. S1000 M03 M08\nG01 Z0 F5.\nM06\nG43 H02 Z1.\nM30\n";
    expect(checkCounts(checkProgram(prog, { machineKind: "mill" })).stop).toBe(0);
  });
  it("lathe: constant surface speed with no speed limit is a stop", () => {
    const f = checkProgram("O1\nG20\nT0101\nG96 S400 M03\nG54 G00 X1. Z.1 M08\nG01 Z-1. F.01\nM30\n", { machineKind: "lathe" });
    expect(texts(f, "stop")).toMatch(/no top speed set first \(G50 S\)/);
    // and with the limit set first, it's clean
    expect(checkCounts(checkProgram(LATHE.replace("T0707 (PART OFF)", "T0707"), { machineKind: "lathe" })).stop).toBe(0);
  });
  it("lathe: a cycle pointing at a line number that isn't there is a stop", () => {
    const f = checkProgram(LATHE.replace("N20 G01", "N25 G01"), { machineKind: "lathe" });
    expect(texts(f, "stop")).toMatch(/points at lines N10 to N20, but there is no N20/);
  });
  it("lathe: threading under constant surface speed is flagged, under G97 it isn't", () => {
    const base = "O1\nG20\nG50 S3000\nT0505\nG96 S300 M03\nG54 G00 X.5 Z.1 M08\nTHREAD\nM30\n";
    expect(texts(checkProgram(base.replace("THREAD", "G76 X.3 Z-1. K.04 D.01 F.0625"), { machineKind: "lathe" }))).toMatch(/Threading while constant surface speed/);
    expect(texts(checkProgram(base.replace("THREAD", "G97 S800\nG76 X.3 Z-1. K.04 D.01 F.0625"), { machineKind: "lathe" }))).not.toMatch(/Threading while/);
  });
  it("says when a file is on the wrong kind of machine", () => {
    expect(texts(checkProgram(LATHE, { machineKind: "mill", machineLabel: "the VF-4" }))).toMatch(/reads like a lathe program, but the part is set to the VF-4/);
  });
  it("checks against the machine's real tool list: missing tools and wrong names", () => {
    const f = checkProgram(MILL, { machineKind: "mill", machineLabel: "the VF-4", machineTools: [{ t: "1", what: "3/8 spot drill" }] });
    expect(texts(f, "look")).toMatch(/T3 isn't on the VF-4 tool list/);
    expect(texts(f, "look")).toMatch(/calls T1 “1\/2 FLAT ENDMILL”, but the tool list says T1 is “3\/8 spot drill”/);
    // a name that's the same tool in other words isn't flagged
    const ok = checkProgram(MILL, { machineKind: "mill", machineTools: [{ t: "1", what: "1/2 endmill, 4 flute" }, { t: "3", what: "drill 1/4" }] });
    expect(texts(ok)).not.toMatch(/tool list/);
  });
  it("counts the operator stops and missing basics", () => {
    const f = checkProgram("O1\nT1 M06\nG43 H01 Z1.\nG01 Z-.1\nM00\nG01 X1.\n", { machineKind: "mill" });
    expect(texts(f)).toMatch(/No end of program/);
    expect(texts(f)).toMatch(/spindle is never started/);
    expect(texts(f)).toMatch(/first cutting move has no feed rate/);
    expect(texts(f, "note")).toMatch(/Stops and waits for the operator 1 time \(M00\), on line 5/);
  });
  it("puts the stops first", () => {
    const f = checkProgram("O1\nT1 M06\nG01 Z-.1\nM30\n", { machineKind: "mill" });
    expect(f[0].level).toBe("stop");
  });
  it("runs for a part against each machine it's set to", () => {
    const f = checkForPart(MILL, { machine: "vf4" }, { vf4: { tools: [{ t: "1", what: "endmill 1/2" }] } });
    expect(texts(f)).toMatch(/T3 isn't on the VF-4 tool list/);
    expect(checkForPart(MILL, { machine: "" }, {}).some((x) => /tool list/.test(x.text))).toBe(false);
  });
});

describe("what changed between two versions", () => {
  it("lists the lines taken out and put in, with their line numbers", () => {
    const d = diffPrograms("O1\nT1 M06\nG01 Z-.1 F5.\nM30\n", "O1\nT1 M06\nG43 H01 Z1.\nG01 Z-.1 F8.\nM30\n");
    expect(d.same).toBe(false);
    expect(d.added).toBe(2);
    expect(d.removed).toBe(1);
    expect(d.changes).toContainEqual({ op: "-", n: 3, text: "G01 Z-.1 F5." });
    expect(d.changes).toContainEqual({ op: "+", n: 3, text: "G43 H01 Z1." });
  });
  it("identical programs, and ones differing only in line endings or trailing spaces, are the same", () => {
    expect(diffPrograms(MILL, MILL).same).toBe(true);
    expect(diffPrograms("O1\nM30\n", "O1  \r\nM30\r\n").same).toBe(true);
  });
});

describe("importing a USB stick of programs", () => {
  const parts = [
    { id: "a", name: "3in Baby Pin", programNo: "O00017, O00018" },
    { id: "b", name: "Junior Receiver Op1", programNo: "" },
  ];
  it("matches by program number first, then by name, and makes new parts of the rest", () => {
    const rows = planImport([
      { name: "O00017.nc", text: LATHE },
      { name: "RECEIVER.nc", text: "O09001 (JUNIOR RECEIVER OP1)\nT1 M06\nG43 H01 Z1.\nM30\n" },
      { name: "O04120.nc", text: MILL.replace("JUNIOR RECEIVER OP1", "GRIP HEAD") },
      { name: "photo.jpg", text: "\u0000\u0001JFIF" },
    ], parts);
    expect(rows[0]).toMatchObject({ action: "add", partId: "a", matchedBy: "program number" });
    expect(rows[1]).toMatchObject({ action: "add", partId: "b", matchedBy: "name" });
    expect(rows[2]).toMatchObject({ action: "new", newName: "GRIP HEAD", newKey: "no:4120" });
    expect(rows[3]).toMatchObject({ action: "skip" });
    expect(importCounts(rows)).toEqual({ add: 2, new: 1, skip: 1 });
  });
  it("two files with the same program number become one new part, not two", () => {
    const rows = planImport([{ name: "a.nc", text: MILL }, { name: "b.nc", text: MILL.replace("F20.", "F25.") }], []);
    expect(rows[0].newKey).toBe(rows[1].newKey);
    expect(importCounts(rows).new).toBe(1);
  });
  it("reads a program number however it's typed", () => {
    expect(programKey("O00017")).toBe("17");
    expect(programKey("o17")).toBe("17");
    expect(programKey("17")).toBe("17");
    expect(programKey("")).toBe("");
  });
  it("a file with no number or title is named after the file", () => {
    expect(planImport([{ name: "pin-short.nc", text: "T1 M06\nG43 H01 Z1.\nM30\n" }], [])[0]).toMatchObject({ action: "new", newName: "pin-short" });
  });
});

describe("fix first", () => {
  const parts = [
    { id: "a", name: "A", facts: { byHand: "deburr", byHandMin: "2", perRun: "50" } },    // 100 min a run
    { id: "b", name: "B", facts: { byHand: "drill cross hole", byHandMin: "6", perRun: "40" } }, // 240
    { id: "c", name: "C", facts: { byHand: "tap by hand" } },                              // not timed
    { id: "d", name: "D", facts: {} },
    { id: "e", name: "E", facts: { byHand: "nothing", byHandMin: "0" } },
  ];
  const index = [
    { partId: "a", status: "proven", createdAt: 2 },
    { partId: "a", status: "unproven", createdAt: 1 },
    { partId: "b", status: "unproven", createdAt: 1 },
  ];
  it("ranks by hand minutes per run, then untimed hand work, then the rest", () => {
    expect(rankParts(parts, index).map((r) => r.part.id)).toEqual(["b", "a", "c", "d", "e"]);
  });
  it("carries the time and the newest program's status", () => {
    const r = Object.fromEntries(rankParts(parts, index).map((x) => [x.part.id, x]));
    expect(r.b.perRunMin).toBe(240);
    expect(r.a.status).toBe("proven");   // the newest version decides
    expect(r.b.status).toBe("unproven");
    expect(r.c.status).toBe("none");
    expect(r.e.perRunMin).toBeNull();     // "nothing" by hand isn't hand work
  });
});

describe("a machine's tool list, read from its programs", () => {
  const parts = [{ id: "a", machine: "st10" }, { id: "b", machine: "st10" }, { id: "c", machine: "vf4" }];
  const index = [
    { partId: "a", createdAt: 2, info: { tools: [{ t: 1, note: "CNMG ROUGH" }, { t: 5, note: "THREAD" }] } },
    { partId: "a", createdAt: 1, info: { tools: [{ t: 9, note: "OLD VERSION" }] } },
    { partId: "b", createdAt: 1, info: { tools: [{ t: 1, note: "CNMG ROUGH" }, { t: 5, note: "GROOVE" }, { t: 7, note: "" }] } },
    { partId: "c", createdAt: 1, info: { tools: [{ t: 2, note: "ENDMILL" }] } },
  ];
  it("gathers the tools called on that machine, newest version of each part only", () => {
    const s = suggestTools("st10", parts, index, []);
    expect(s.map((x) => x.t)).toEqual([1, 5, 7]);
    expect(s[0]).toMatchObject({ programs: 2, disagree: false });
    expect(s[0].names).toEqual([{ name: "CNMG ROUGH", count: 2 }]);
    expect(s[1].disagree).toBe(true);
    expect(s[2].names).toEqual([]);
  });
  it("drops what's already on the list, unless the programs disagree about it", () => {
    const s = suggestTools("st10", parts, index, [{ t: "1", what: "CNMG rougher" }, { t: "5", what: "threading" }]);
    expect(s.map((x) => x.t)).toEqual([5, 7]);
  });
});

describe("the run sheet", () => {
  const part = {
    name: "3in Baby Pin", sku: "BP-3", material: "1018 steel", machine: "st10", blueprintUrl: "https://x/bp.png", photos: ["https://x/p1.png"],
    steps: ["Saw", " ", "Turn"], notes: "", facts: { stock: "1.25 bar", holding: "3-jaw", byHand: "deburr" },
  };
  const program = { name: "O00017.nc", content: LATHE, status: "proven", provenBy: "Jesse", provenAt: 5 };
  const machines = { st10: { holding: "8in chuck", tools: [{ t: "1", what: "CNMG 432" }] } };

  it("lists where the program stops and why, from the programmer's own comments", () => {
    expect(operatorStops("O1\n(FLIP THE PART)\nM00\nG00 X1.\nM01 (CHECK BORE)\nM00\nM30\n")).toEqual([
      { line: 3, why: "FLIP THE PART", optional: false },
      { line: 5, why: "CHECK BORE", optional: true },
      { line: 6, why: "", optional: false },
    ]);
  });
  it("puts each tool the program calls beside what the tool list says is in that pocket", () => {
    const s = runSheet(part, program, machines);
    expect(s.machines).toHaveLength(1);
    expect(s.machines[0].tools).toEqual([
      { t: 1, called: "CNMG ROUGH", listed: "CNMG 432" },
      { t: 5, called: "THREAD", listed: null },      // not on the tool list
    ]);
    expect(s.machines[0].hasList).toBe(true);
  });
  it("carries the setup, the steps and the proven stamp", () => {
    const s = runSheet(part, program, machines);
    expect(s).toMatchObject({ name: "3in Baby Pin", material: "1018 steel", stock: "1.25 bar", holding: "3-jaw", byHand: "deburr" });
    expect(s.steps).toEqual(["Saw", "Turn"]);
    expect(s.program).toMatchObject({ number: "O00017", proven: true, provenBy: "Jesse" });
    expect(s.program.stops).toHaveLength(1);
  });
  it("still makes a sheet with no program and no machine", () => {
    const s = runSheet({ name: "Bare" }, null, {});
    expect(s.program).toBeNull();
    expect(s.machines).toEqual([]);
    expect(s.tools).toEqual([]);
  });
  it("knows the only machine a kind of program can be for", () => {
    expect(machineForKind("mill")).toBe("vf4"); // one mill
    expect(machineForKind("lathe")).toBe("");   // two lathes: can't tell
    expect(machineForKind("")).toBe("");
  });
});
