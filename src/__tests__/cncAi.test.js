// @vitest-environment node
import { describe, it, expect } from "vitest";
import {
  measure, measuredText, buildAiPack, cleanProgram, stampDraft, draftChecks, profileDifference,
  placeFindings, problemsText, runRewrite, runReview, reportToKeep, costOf, fmtCost, addUsage, rewriteNeeds, MAX_FIXES, MAX_READS,
} from "../floor/cncAi.js";

// Everything that stands between an AI's answer and a person being offered it.
// No AI here: `ask` is a script that hands back what a test tells it to, so
// what's proven is what the app does with a good answer, a wrong one, and one
// that keeps being wrong.

const part = { id: "p1", name: "3in Steel Baby Pin", machine: "st10", material: "1018 steel", facts: { stock: '1.25" round bar', holding: "3-jaw chuck", byHand: "Deburr both ends" }, steps: [], photos: [] };
const tools = { st10: { tools: [{ t: "1", what: "CNMG rough turn" }, { t: "3", what: "Groove 0.125" }, { t: "5", what: "Thread 60 deg" }] } };

// A stepped pin: 0.625 for an inch, a 0.125 fillet up to 1.125, to three inches.
const PIN = `%
O00017 (3IN STEEL BABY PIN)
G20 G40 G80 G99
G50 S3000
T0101 (CNMG ROUGH)
G96 S400 M03
G54 G00 X1.35 Z0.1 M08
G71 P10 Q20 U0.02 W0.005 D0.08 F0.012
N10 G00 X0.5
G01 Z0. F0.006
X0.625 Z-0.0625
Z-1.
G02 X0.875 Z-1.125 R0.125
G01 X1.125
Z-3.
N20 X1.3
G70 P10 Q20
G00 X2. Z1. M09
M30
%
`;
// The same part, tidied: comments added, lower feed, nothing about the shape changed.
const GOOD = PIN.replace("G71 P10 Q20 U0.02 W0.005 D0.08 F0.012", "(ROUGH THE OUTSIDE)\nG71 P10 Q20 U0.02 W0.005 D0.06 F0.010").replace("G70 P10 Q20", "(FINISH PASS)\nG70 P10 Q20");
const levels = (list, level) => list.filter((f) => f.level === level).map((f) => f.text);
const check = (draft, opts = {}) => draftChecks(PIN, draft, { part, machineFacts: tools, ...opts });

describe("measuring a program", () => {
  it("reads the sizes, the reach, the speeds and the stops off the program itself", () => {
    const m = measure(PIN, part);
    expect(m.kind).toBe("lathe");
    expect(m.unitsCode).toBe("G20");
    expect(m.sizes.steps.map((s) => Number(s.dia.toFixed(3)))).toEqual([0.625, 1.125]);
    expect(m.speeds).toMatchObject({ surface: 400, clamp: 3000, feedPerRev: 0.012 });
    expect(m.codes.has("G71")).toBe(true);
    expect(m.ends).toBe(true);
    expect(m.wrapped).toBe(true);
  });

  it("puts what the program cuts into the pack in plain numbers", () => {
    const t = measuredText(PIN, part);
    expect(t).toMatch(/DIA 0\.625 {2}0\.9375 long {2}Z-0\.0625 to Z-1\.000/);
    expect(t).toMatch(/DIA 1\.125/);
    expect(t).toMatch(/Cut length: 3\.000 \(Z0 to Z-3\.000\)\. The chuck is past that\./);
    expect(t).toMatch(/Bar: 1\.250 diameter/);
    expect(t).toMatch(/surface speed up to S400 \(G96\); speed limit G50 S3000/);
    const pack = buildAiPack(part, [{ id: "a", name: "O00017.nc", content: PIN, status: "unproven" }], tools);
    expect(pack).toMatch(/CNC PART PACK: 3in Steel Baby Pin/);
    expect(pack).toMatch(/T1 {2}CNMG rough turn/);
    expect(pack).toMatch(/WHAT THE PROGRAM CUTS: O00017\.nc/);
    expect(pack).toMatch(/Finished by hand after the machine: Deburr both ends/);
  });

  it("says so when the bar size isn't known", () => {
    expect(measuredText(PIN, { ...part, facts: {} })).toMatch(/Bar size: NOT GIVEN/);
  });

  it("only shows the newest version and the proven one", () => {
    const v = (id, status) => ({ id, name: `${id}.nc`, content: PIN.replace("BABY PIN", `PIN ${id}`), status });
    const pack = buildAiPack(part, [v("new", "unproven"), v("mid", "unproven"), v("good", "proven"), v("old", "unproven")], tools);
    expect(pack).toMatch(/PIN new/);
    expect(pack).toMatch(/PIN good/);
    expect(pack).not.toMatch(/PIN mid/);
    expect(pack).toMatch(/2 older versions of the program not shown/);
  });
});

describe("handling a draft", () => {
  it("tidies what came back", () => {
    expect(cleanProgram("```gcode\nO1\r\nG00 X1.   \r\nM30\n```\n")).toBe("O1\nG00 X1.\nM30\n");
  });

  it("stamps it not proven, once, straight after the program number", () => {
    const once = stampDraft(PIN, { date: new Date(2026, 10, 25) });
    expect(once.split("\n").slice(0, 3)).toEqual(["%", "O00017 (3IN STEEL BABY PIN)", "(AI DRAFT 2026-11-25 - NOT PROVEN - PROVE OUT BEFORE RUNNING)"]);
    expect(stampDraft(once, { date: new Date(2026, 10, 26) }).match(/AI DRAFT/g)).toHaveLength(1);   // again: still one, and the newer date
    expect(stampDraft(once, { date: new Date(2026, 10, 26) })).toMatch(/2026-11-26/);
    expect(stampDraft("G00 X1.\nM30\n").split("\n")[0]).toMatch(/AI DRAFT/);
    // the stamp is a comment: it changes nothing the machine does
    expect(measure(once, part).sizes.steps).toEqual(measure(PIN, part).sizes.steps);
  });
});

describe("a draft measured against the program it replaces", () => {
  it("passes a tidy-up that leaves the part alone", () => {
    const found = check(GOOD);
    expect(levels(found, "stop")).toEqual([]);
    expect(levels(found, "note").join(" ")).toMatch(/Estimated run time/);
  });

  it("the program compared with itself is clean", () => {
    expect(levels(check(PIN), "stop")).toEqual([]);
    expect(levels(check(stampDraft(PIN)), "stop")).toEqual([]);
  });

  it("catches a size that changed, and says which", () => {
    const found = levels(check(GOOD.replace("X0.625 Z-0.0625", "X0.620 Z-0.0625")), "stop").join(" | ");
    expect(found).toMatch(/Ø0\.625 from Z-0\.0625 to Z-1\.000 in the current program is Ø0\.620/);
  });

  it("catches a shoulder that moved", () => {
    const found = levels(check(GOOD.replace("Z-1.\nG02 X0.875 Z-1.125", "Z-1.05\nG02 X0.875 Z-1.175")), "stop").join(" | ");
    expect(found).toMatch(/Ø0\.625/);
    expect(found).toMatch(/Z-1\.050/);
  });

  it("catches a changed fillet even though every straight diameter is the same", () => {
    // the 1/8 radius swapped for a square corner: both diameters and both lengths unchanged
    const square = GOOD.replace("G02 X0.875 Z-1.125 R0.125\nG01 X1.125", "G01 Z-1.125\nX1.125");
    const found = levels(check(square), "stop").join(" | ");
    expect(found.length).toBeGreaterThan(0);
    expect(found).toMatch(/Ø0\.625|finished shape is different/);
  });

  it("the outline comparison isn't fooled by where a square shoulder is sampled", () => {
    const a = measure(PIN, part).sim;
    const b = measure(GOOD, part).sim;
    expect(profileDifference(a, b).worst).toBeLessThan(1e-6);
    const c = measure(GOOD.replace("X1.125\nZ-3.", "X1.115\nZ-3."), part).sim;
    expect(profileDifference(a, c).worst).toBeGreaterThan(0.004);
  });

  it("catches cutting closer to the chuck", () => {
    const found = levels(check(GOOD.replace("Z-3.\nN20", "Z-3.25\nN20")), "stop").join(" | ");
    expect(found).toMatch(/0\.250 closer to the chuck/);
    expect(found).toMatch(/The jaws are there/);
  });

  it("catches anything made faster", () => {
    expect(levels(check(GOOD.replace("G50 S3000", "G50 S4000")), "stop").join(" ")).toMatch(/speed limit went up from 3000 to 4000/);
    expect(levels(check(GOOD.replace("G96 S400", "G96 S550")), "stop").join(" ")).toMatch(/surface speed went up from 400 to 550/);
    expect(levels(check(GOOD.replace("F0.010", "F0.02")), "stop").join(" ")).toMatch(/feed per revolution went up/);
    expect(levels(check(GOOD.replace("F0.010", "F0.008")), "stop")).toEqual([]);   // slower is fine
    // asked for, it's allowed, and becomes something to check at the machine
    const quick = GOOD.replace("G96 S400", "G96 S550");
    expect(levels(check(quick, { speedsMayRise: true }), "stop")).toEqual([]);
    expect(levels(check(quick, { speedsMayRise: true }), "look").join(" ")).toMatch(/surface speed went up from 400 to 550 \(G96 S\)\. Check the tool and the setup can take it/);
  });

  it("catches a changed program number, units or work offset", () => {
    expect(levels(check(GOOD.replace("O00017", "O00018")), "stop").join(" ")).toMatch(/program number changed from O00017 to O00018/);
    expect(levels(check(GOOD.replace("G20 G40", "G21 G40")), "stop").join(" ")).toMatch(/units changed/);
    expect(levels(check(GOOD.replace("G54 G00", "G55 G00")), "stop").join(" ")).toMatch(/work offset changed/);
  });

  it("a tool that isn't on the list stops it; one that is gets checked by a person", () => {
    const withTool = (t, note) => GOOD.replace("G00 X2. Z1. M09", `G00 X2. Z1.\nT0${t}0${t} (${note})\nG97 S800 M03\nG00 X1.2 Z-2.\nG00 X2. Z1. M09`);
    expect(levels(check(withTool(9, "MYSTERY")), "stop").join(" ")).toMatch(/T9, which the current program doesn't use and which isn't on the machine's tool list/);
    expect(levels(check(withTool(3, "GROOVE")), "stop")).toEqual([]);
    expect(levels(check(withTool(3, "GROOVE")), "look").join(" ")).toMatch(/It uses T3 \(Groove 0\.125\)/);
    // no tool list at all: a new tool can't be vouched for
    expect(levels(draftChecks(PIN, withTool(3, "GROOVE"), { part, machineFacts: {} }), "stop").join(" ")).toMatch(/tool list isn't filled in/);
  });

  it("points out codes the current program never used", () => {
    const found = levels(check(GOOD.replace("G00 X2. Z1. M09", "G04 P500\nG00 X2. Z1. M09")), "look").join(" ");
    expect(found).toMatch(/codes the current program doesn't: G4/);
  });

  it("a rapid through the bar in the draft stops it", () => {
    const crash = GOOD.replace("G00 X2. Z1. M09", "G00 X2.\nG00 X0.9 Z-2.5\nG00 X2. Z1. M09");
    expect(levels(check(crash), "stop").join(" ")).toMatch(/rapid move goes through the bar/);
  });

  it("a missing end, an odd character, or something that isn't a program", () => {
    expect(levels(check(GOOD.replace("M30\n", "")), "stop").join(" ")).toMatch(/no end of program/);
    expect(levels(check(GOOD.replace("(ROUGH THE OUTSIDE)", "(ROUGH — OUTSIDE)")), "stop").join(" ")).toMatch(/character the Haas can't read/);
    expect(levels(check("Sure! Here is the improved program you asked for."), "stop")).toEqual(["What came back isn't a program."]);
  });

  it("when sizes are meant to change, a change is something to check, not a stop", () => {
    const smaller = GOOD.replace("X0.625 Z-0.0625", "X0.620 Z-0.0625");
    expect(levels(check(smaller, { sizesMayChange: true }), "stop")).toEqual([]);
    expect(levels(check(smaller, { sizesMayChange: true }), "look").join(" ")).toMatch(/Ø0\.620/);
    // but it still can't go closer to the chuck
    expect(levels(check(GOOD.replace("Z-3.\nN20", "Z-3.25\nN20"), { sizesMayChange: true }), "stop").join(" ")).toMatch(/closer to the chuck/);
  });

  it("notices an operator stop that went missing", () => {
    const old = PIN.replace("G70 P10 Q20", "G70 P10 Q20\nM00 (CHECK 0.625 DIA)");
    const found = draftChecks(old, GOOD, { part, machineFacts: tools });
    expect(levels(found, "look").join(" ")).toMatch(/stops for the operator 0 times where the current program stops 1 \(CHECK 0\.625 DIA\)/);
  });

  it("a mill draft may not cut deeper or rapid lower than before", () => {
    const mill = { id: "m", name: "Plate", machine: "vf4", facts: {} };
    const OLD = "%\nO05001 (PLATE)\nG20 G17 G40 G49 G80 G90\nT1 M06 (1/2 ENDMILL)\nG54 G00 X0. Y0. S6000 M03\nG43 H01 Z1. M08\nG01 Z-0.25 F20.\nX3.\nY2.\nG00 Z1.\nM30\n%\n";
    const mf = { vf4: { tools: [{ t: "1", what: "1/2 endmill" }] } };
    expect(levels(draftChecks(OLD, OLD, { part: mill, machineFacts: mf }), "stop")).toEqual([]);
    expect(measure(OLD, mill).rapidLow).toBe(1);   // lifting out of the cut doesn't count as a low rapid
    expect(levels(draftChecks(OLD, OLD.replace("Z-0.25", "Z-0.5"), { part: mill, machineFacts: mf }), "stop").join(" ")).toMatch(/cuts deeper than the current program: Z-0\.5 against Z-0\.25/);
    expect(levels(draftChecks(OLD, OLD.replace("G00 Z1.\nM30", "G00 Z0.05\nG00 X0.\nG00 Z1.\nM30"), { part: mill, machineFacts: mf }), "stop").join(" ")).toMatch(/Rapid moves go lower than they ever did/);
    expect(levels(draftChecks(OLD, OLD.replace("X3.", "X3.5"), { part: mill, machineFacts: mf }), "look").join(" ")).toMatch(/reach further in X/);
  });
});

describe("what the AI says about a line", () => {
  const listing = "O1\nG50 S3000\nG96 S400 M03\nG00 X1.35 Z0.1\nM30\n";
  it("is tied to the line it quotes, even if the number is a little off", () => {
    const [a, b, c, d] = placeFindings([
      { level: "stop", line: 3, quote: "G96 S400 M03", problem: "p1", fix: "f" },
      { level: "look", line: 5, quote: "   4| G00 X1.35 Z0.1", problem: "p2", fix: "" },   // one out, and quoted with its listing number
      { level: "look", line: 40, quote: "G50 S3000", problem: "p3", fix: "" },            // way out, but the line is unique
      { level: "stop", line: 2, quote: "G71 P10 Q20", problem: "p4", fix: "" },           // not in the program at all
    ], listing);
    expect(a).toMatchObject({ line: 3, level: "stop" });
    expect(b.line).toBe(4);
    expect(c.line).toBe(2);
    expect(d).toMatchObject({ line: null, unplaced: true, level: "stop" });
  });

  it("drops empty findings and never invents a level", () => {
    const out = placeFindings([{ level: "catastrophe", line: 1, quote: "O1", problem: "x" }, { level: "stop", line: 1, quote: "O1", problem: "  " }], listing);
    expect(out).toHaveLength(1);
    expect(out[0].level).toBe("look");
  });

  it("writes findings out for sending back", () => {
    const t = problemsText([{ level: "stop", line: 7, text: "Too close.", from: "measured" }, { level: "look", line: null, text: "Check it.", quote: "G00 X1.", fix: "Move out first." }]);
    expect(t).toMatch(/1\. \[stop\] line 7: Too close\.\n {3}\(measured by following the tool\)/);
    expect(t).toMatch(/2\. \[look\] Check it\.\n {3}the line: G00 X1\.\n {3}suggested: Move out first\./);
  });
});

// ---- the loop ----------------------------------------------------------------
const programs = [{ id: "v1", name: "O00017.nc", content: PIN, status: "unproven" }];
const usage = { input: 1000, output: 500, cacheRead: 0, cacheWrite: 0 };
const wrote = (program, more = {}) => ({ result: { program, summary: "Tidied.", changes: [{ what: "Lower roughing feed", why: "Finish" }], assumptions: [], questions: [], ...more }, usage, notes: [] });
const read = (findings = [], verdict = findings.some((f) => f.level === "stop") ? "do_not_run" : "ok_to_prove_out") => ({ result: { verdict, findings, checked: ["Followed every rapid"], couldNotCheck: [] }, usage, notes: [] });
// A script: each call takes the next answer, and the calls are remembered.
const script = (...answers) => {
  const calls = [];
  const ask = async (task, input) => {
    calls.push({ task, input });
    const next = answers.shift();
    if (!next) throw new Error(`unexpected extra call: ${task}`);
    if (next.expect) expect(task).toBe(next.expect);
    return typeof next.reply === "function" ? next.reply(input) : next.reply;
  };
  return { ask, calls, left: () => answers.length };
};
const run = (s, more = {}) => runRewrite({ ask: s.ask, part, programs, machineFacts: tools, instruction: "Tidy it up", now: new Date(2026, 10, 25), ...more });
const CLOSER = GOOD.replace("Z-3.\nN20", "Z-3.25\nN20");
const AI_STOP = [{ level: "stop", line: 8, quote: "G54 G00 X1.35 Z0.1 M08", problem: "Starts too close.", fix: "Start at Z0.2." }];

describe("the rewrite loop", () => {
  it("a good draft: written, measured, read once, passed", async () => {
    const s = script({ expect: "write", reply: wrote(GOOD) }, { expect: "verify", reply: read() });
    const r = await run(s);
    expect(r.verdict).toBe("passed");
    expect(r.reasons).toEqual([]);
    expect(r.fixes).toBe(0);
    expect(r.reads).toBe(1);
    expect(r.program).toMatch(/\(AI DRAFT 2026-11-25 - NOT PROVEN/);
    expect(r.diff.added).toBeGreaterThan(0);
    expect(r.usage.input).toBe(2000);
    expect(s.calls[0].input.pack).toMatch(/WHAT THE PROGRAM CUTS/);
    expect(s.calls[0].input.instruction).toBe("Tidy it up");
    // the second reader gets the stamped draft, the writer's notes and what was measured
    expect(s.calls[1].input.draft).toBe(r.program);
    expect(s.calls[1].input.notes).toMatch(/Lower roughing feed/);
  });

  it("a draft that fails the measurements goes back with exactly what was measured, before anyone reads it", async () => {
    const s = script({ expect: "write", reply: wrote(CLOSER) }, { expect: "fix", reply: wrote(GOOD) }, { expect: "verify", reply: read() });
    const r = await run(s);
    expect(r.verdict).toBe("passed");
    expect(r.fixes).toBe(1);
    expect(s.calls[1].input.problems).toMatch(/\[stop\] It cuts 0\.250 closer to the chuck/);
    expect(s.calls[1].input.problems).toMatch(/measured by following the tool/);
    expect(s.calls[1].input.draft).toMatch(/Z-3\.25/);
  });

  it("a fault the second read finds is fixed, measured again, and read again", async () => {
    const s = script(
      { expect: "write", reply: wrote(GOOD) }, { expect: "verify", reply: read(AI_STOP) },
      { expect: "fix", reply: wrote(GOOD.replace("(FINISH PASS)", "(FINISH PASS, ONE CUT)")) }, { expect: "verify", reply: read() },
    );
    const r = await run(s);
    expect(r.verdict).toBe("passed");
    expect(r.fixes).toBe(1);
    expect(r.reads).toBe(2);
    expect(s.calls[2].input.problems).toMatch(/Starts too close/);
    expect(r.second.findings).toEqual([]);          // the verdict is about the FINAL draft
    expect(s.calls[3].input.draft).toBe(r.program);
  });

  it("a fix that breaks something else is caught by measuring again, not passed on trust", async () => {
    const s = script(
      { expect: "write", reply: wrote(GOOD) }, { expect: "verify", reply: read(AI_STOP) },
      { expect: "fix", reply: wrote(CLOSER) },       // "fixed", but now it cuts into the jaws
      { expect: "fix", reply: wrote(GOOD) }, { expect: "verify", reply: read() },
    );
    const r = await run(s);
    expect(r.verdict).toBe("passed");
    expect(r.fixes).toBe(2);
    expect(s.calls[3].input.problems).toMatch(/closer to the chuck/);
  });

  it("gives up after its fixes are used, says it did not pass, and never claims a second read it didn't get", async () => {
    const s = script({ reply: wrote(CLOSER) }, { reply: wrote(CLOSER) }, { reply: wrote(CLOSER) }, { reply: wrote(CLOSER) });
    const r = await run(s);
    expect(s.calls.map((c) => c.task)).toEqual(["write", "fix", "fix", "fix"]);
    expect(r.fixes).toBe(MAX_FIXES);
    expect(r.verdict).toBe("problems");
    expect(r.second).toBeNull();
    expect(r.reasons.join(" ")).toMatch(/2 problems the measurements found are still there/);   // closer to the chuck, and the diameter that now runs further
    expect(r.reasons.join(" ")).toMatch(/wasn't given a second read, because it didn't pass the measurements/);
  });

  it("a second reader that never stops finding faults ends in 'did not pass', not in a loop", async () => {
    const s = script(
      { reply: wrote(GOOD) }, { reply: read(AI_STOP) }, { reply: wrote(GOOD) }, { reply: read(AI_STOP) },
      { reply: wrote(GOOD) }, { reply: read(AI_STOP) }, { reply: wrote(GOOD) },
    );
    const r = await run(s);
    expect(s.left()).toBe(0);
    expect(s.calls.length).toBe(1 + MAX_FIXES + MAX_READS);
    expect(r.verdict).toBe("problems");
    expect(r.reasons.join(" ")).toMatch(/final version wasn't given a second read/);
  });

  it("the last fix used up on a second-read fault: the fault is reported, not hidden", async () => {
    const s = script({ reply: wrote(CLOSER) }, { reply: wrote(CLOSER) }, { reply: wrote(CLOSER) }, { reply: wrote(GOOD) }, { reply: read(AI_STOP) });
    const r = await run(s);
    expect(r.verdict).toBe("problems");
    expect(r.second.findings).toHaveLength(1);
    expect(r.reasons.join(" ")).toMatch(/second read found 1 problem that wasn't fixed/);
  });

  it("'ok' from the second reader doesn't pass a draft with a stop in its own findings", async () => {
    const s = script({ reply: wrote(GOOD) }, { reply: read(AI_STOP, "ok_to_prove_out") }, { reply: wrote(GOOD) }, { reply: read() });
    const r = await run(s);
    expect(s.calls[2].task).toBe("fix");
    expect(r.verdict).toBe("passed");
  });

  it("something that isn't a program never reaches the second read", async () => {
    const s = script({ reply: wrote("I can't do that safely.") }, { reply: wrote(GOOD) }, { reply: read() });
    const r = await run(s);
    expect(s.calls[1].task).toBe("fix");
    expect(s.calls[1].input.problems).toMatch(/isn't a program/);
    expect(r.verdict).toBe("passed");
  });

  it("an error from the AI stops the run and nothing is returned", async () => {
    const s = script({ reply: wrote(GOOD) });
    await expect(run({ ...s, ask: async (task, input) => { if (task === "verify") throw new Error("The AI is busy right now."); return s.ask(task, input); } })).rejects.toThrow(/busy/);
  });

  it("keeps a short record with a saved draft", async () => {
    const s = script({ reply: wrote(GOOD, { questions: ["Is the chamfer 1/16?"] }) }, { reply: read() });
    const kept = reportToKeep(await run(s));
    expect(kept).toMatchObject({ kind: "rewrite", verdict: "passed", instruction: "Tidy it up", questions: ["Is the chamfer 1/16?"], fixes: 0, reads: 1, basedOn: { id: "v1" } });
    expect(kept.second.verdict).toBe("ok_to_prove_out");
    expect(JSON.stringify(kept).length).toBeLessThan(4000);
    expect(kept.program).toBeUndefined();
  });

  it("won't start until the things it would otherwise guess at are on the part", async () => {
    expect(rewriteNeeds(part, programs, tools)).toEqual([]);
    expect(rewriteNeeds({ ...part, facts: { holding: "chuck" } }, programs, tools).map((n) => n.key)).toEqual(["material"]);   // no stock size
    expect(rewriteNeeds({ ...part, material: "" }, programs, tools).map((n) => n.key)).toEqual(["material"]);
    expect(rewriteNeeds(part, programs, {}).map((n) => n.key)).toEqual(["tools"]);
    expect(rewriteNeeds({ ...part, machine: "", facts: {} }, programs, tools).map((n) => n.key)).toEqual(["machine", "tools", "material", "holding"]);
    let asked = 0;
    await expect(runRewrite({ ask: async () => { asked += 1; return {}; }, part, programs, machineFacts: {}, instruction: "x" })).rejects.toThrow(/Fill these in on the part first: that machine's tool list/);
    expect(asked).toBe(0);   // nothing was spent finding that out
  });

  it("refuses to start with no program", async () => {
    await expect(runRewrite({ ask: async () => ({}), part, programs: [], instruction: "x" })).rejects.toThrow(/no program/);
  });
});

describe("the review", () => {
  const reviewed = (findings) => ({ result: { summary: "Turns a stepped pin.", walkthrough: [{ lines: "5-8", what: "Loads the turning tool." }], findings, handWork: [{ job: "Deburr both ends", canTheMachineDoIt: "yes", how: "Add a chamfer." }], questions: [] }, usage, notes: [] });
  const F = (line, quote, problem, level = "stop") => ({ level, line, quote, problem, fix: "f" });

  it("every finding gets a second look: confirmed stays, rejected goes, unsure can't stop the program", async () => {
    const s = script(
      { expect: "review", reply: reviewed([F(6, "G96 S400 M03", "A"), F(4, "G50 S3000", "B"), F(7, "G54 G00 X1.35 Z0.1 M08", "C")]) },
      { expect: "challenge", reply: { result: { results: [{ index: 1, verdict: "confirmed", reason: "Yes." }, { index: 2, verdict: "rejected", reason: "The limit is set on line 4." }, { index: 3, verdict: "unsure", reason: "Depends on the jaws." }] }, usage, notes: [] } },
    );
    const r = await runReview({ ask: s.ask, part, programs, machineFacts: tools });
    expect(r.findings.map((f) => [f.text, f.level])).toEqual([["A", "stop"], ["C", "look"]]);
    expect(r.findings[0].confirmed).toBe(true);
    expect(r.findings[1].unsure).toMatch(/jaws/);
    expect(r.rejected.map((f) => [f.text, f.why])).toEqual([["B", "The limit is set on line 4."]]);
    expect(r.checked).toBe(true);
    expect(r.handWork[0].job).toBe("Deburr both ends");
    expect(s.calls[1].input.findings).toMatch(/1\. \[stop\] line 6: A/);
  });

  it("a finding the second pass says nothing about is kept, but not as a stop", async () => {
    const s = script({ reply: reviewed([F(6, "G96 S400 M03", "A")]) }, { reply: { result: { results: [] }, usage, notes: [] } });
    const r = await runReview({ ask: s.ask, part, programs, machineFacts: tools });
    expect(r.findings[0]).toMatchObject({ level: "look" });
    expect(r.findings[0].unsure).toMatch(/didn't answer/);
  });

  it("a clean review costs one request, not two", async () => {
    const s = script({ expect: "review", reply: reviewed([]) });
    const r = await runReview({ ask: s.ask, part, programs, machineFacts: tools });
    expect(r.findings).toEqual([]);
    expect(r.checked).toBe(false);
    expect(s.calls).toHaveLength(1);
  });
});

describe("what it cost", () => {
  it("adds up the tokens and prices them", () => {
    const u = addUsage({ input: 10000, output: 4000, cacheRead: 20000, cacheWrite: 8000 }, { input: 5000, output: 1000 });
    expect(u).toEqual({ input: 15000, output: 5000, cacheRead: 20000, cacheWrite: 8000 });
    expect(costOf(u)).toBeCloseTo(0.12 + 0.2 + 0.004 + 0.08, 6);   // 15k in, 5k out, 20k read from cache, 8k written to it
    expect(fmtCost(0.001)).toBe("under 1¢");
    expect(fmtCost(0.204)).toBe("about 20¢");
    expect(fmtCost(1.5)).toBe("about $1.50");
  });
});
