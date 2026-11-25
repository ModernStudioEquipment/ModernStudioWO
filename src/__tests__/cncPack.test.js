// @vitest-environment node
import { describe, it, expect } from "vitest";
import {
  programInfo, programLine, missingTools, readiness, readyCount, buildPack,
  cleanFacts, shouldWriteFacts, cleanTools, cleanMachineFacts, looksLikeText,
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
  it("tells a program from a binary file", () => {
    expect(looksLikeText(MILL)).toBe(true);
    expect(looksLikeText("MCAM\u0000\u0001\u0002binary")).toBe(false);
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
