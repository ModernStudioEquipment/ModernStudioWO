// @vitest-environment node
import { describe, it, expect } from "vitest";
import { draftChecks, measure, profileDifference } from "../floor/cncCompare.js";
import { runRewrite, baselineOf } from "../floor/cncAi.js";

// Every way a rewrite could change what the machine does without the finished
// part looking any different on paper. Each case below is one line changed in a
// program that is otherwise identical, and each has to stop the draft. They
// came from two places: an independent review that set out to break the checks,
// and a sweep that nudged every number in a program up and down.

const part = { id: "p1", name: "Pin", machine: "st10", material: "1018 steel", facts: { stock: '1.25" round bar', holding: "3-jaw chuck" }, steps: [], photos: [] };
const tools = { st10: { tools: [{ t: "1", what: "CNMG rough turn" }, { t: "3", what: "Groove 0.125" }, { t: "5", what: "Thread 60 deg" }, { t: "7", what: "Drill 1/2" }, { t: "9", what: "Boring bar" }] } };
const BASE = `%
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
G00 X1.4 Z0.1
G28 U0. W0.
T0303 (GROOVE 0.125)
G97 S800 M03
G00 X0.7 Z-0.9
G01 X0.5 F0.003
G00 X1.4
G00 Z0.2
G28 U0. W0.
T0505 (THREAD 60 DEG)
G97 S700 M03
G00 X0.7 Z0.2
G76 X0.555 Z-0.8 K0.035 D0.012 F0.0625
G00 X1.4 Z0.5 M09
G28 U0. W0.
M30
%
`;
const stops = (old, draft, opts = {}) => draftChecks(old, draft, { part, machineFacts: tools, ...opts }).filter((f) => f.level === "stop").map((f) => f.text);
// one line swapped for another; the swap has to really happen
const swap = (from, to, src = BASE) => { expect(src.includes(from), `the test program has no "${from}"`).toBe(true); return src.replace(from, to); };
const caught = (from, to, why, src = BASE) => expect(stops(src, swap(from, to, src)).join(" | "), `${from}  ->  ${to}`).toMatch(why);

describe("the program compared with itself", () => {
  it("has nothing to stop it, and says what was and wasn't measured", () => {
    const found = draftChecks(BASE, BASE, { part, machineFacts: tools });
    expect(found.filter((f) => f.level === "stop")).toEqual([]);
    expect(found.coverage.measured.join(" ")).toMatch(/finished outside shape, end to end, to within 0\.0002/);
    expect(found.coverage.measured.join(" ")).toMatch(/Each tool's top spindle speed and feeds/);
    expect(found.coverage.measured.join(" ")).toMatch(/where each tool lands after a tool change/);
    expect(found.coverage.notMeasured.join(" ")).toMatch(/jaws, the vise, the fixture/);
  });
});

describe("speeds and feeds, tool by tool", () => {
  it("a feed raised on one tool can't hide behind another tool's higher one", () => {
    caught("G01 X0.5 F0.003", "G01 X0.5 F0.006", /T3's cutting feed went up from 0\.003 to 0\.006/);
    caught("G01 Z0. F0.006", "G01 Z0. F0.008", /T1's finishing feed went up from 0\.006 to 0\.008/);
  });
  it("nor a speed", () => {
    caught("G97 S800 M03", "G97 S1200 M03", /T3's top spindle speed went up from 800 to 1200/);
    caught("G97 S700 M03", "G97 S750 M03", /T5's top spindle speed went up from 700 to 750/);
  });
  it("a tool switched from a fixed speed to surface speed is held to how fast it could then turn", () => {
    // the groove at half an inch across: 400 feet a minute there is over 3000 rpm, held to the limit
    caught("G97 S800 M03\nG00 X0.7 Z-0.9", "G96 S400 M03\nG00 X0.7 Z-0.9", /T3's top spindle speed went up from 800 to 3000/);
  });
  it("a second, lower speed limit can't be quietly dropped", () => {
    const old = swap("T0303 (GROOVE 0.125)\nG97 S800 M03", "T0303 (GROOVE 0.125)\nG50 S1000\nG96 S200 M03");
    const draft = swap("T0303 (GROOVE 0.125)\nG97 S800 M03", "T0303 (GROOVE 0.125)\nG96 S200 M03");
    expect(stops(old, draft).join(" | ")).toMatch(/T3's top spindle speed went up from 1000 to/);
  });
  it("feed per turn swapped for feed per minute is a stop, whatever the number", () => {
    caught("G01 X0.5 F0.003", "G98 G01 X0.5 F0.003", /T3's feed changed from per turn to per minute/);
  });
  it("a surface speed raised under the same speed limit is still faster", () => {
    caught("G96 S400 M03", "G96 S550 M03", /T1's surface speed went up from 400 to 550/);
  });
  it("slower is always fine", () => {
    for (const [from, to] of [["G97 S800 M03", "G97 S600 M03"], ["G01 X0.5 F0.003", "G01 X0.5 F0.002"], ["G50 S3000", "G50 S2500"], ["G96 S400 M03", "G96 S300 M03"], ["D0.08 F0.012", "D0.06 F0.01"]]) {
      expect(stops(BASE, swap(from, to)), `${from} -> ${to}`).toEqual([]);
    }
  });
  it("with the box ticked, faster becomes something to check rather than a stop", () => {
    const found = draftChecks(BASE, swap("G01 X0.5 F0.003", "G01 X0.5 F0.006"), { part, machineFacts: tools, speedsMayRise: true });
    expect(found.filter((f) => f.level === "stop")).toEqual([]);
    expect(found.filter((f) => f.level === "look").map((f) => f.text).join(" ")).toMatch(/T3's cutting feed went up/);
  });
});

describe("the settings that decide how hard a pass cuts", () => {
  it("roughing depth", () => caught("D0.08 F0.012", "D0.2 F0.012", /roughing depth of cut on line 8 went up from 0\.08 to 0\.2/));
  it("a finish allowance below zero, which roughs under size", () => caught("U0.02 W0.005", "U-0.05 W0.005", /finish allowance below zero \(U-0\.05 W0\.005\)\. Roughing would cut under the finished size/));
  it("the finishing pass taken out", () => caught("G70 P10 Q20\n", "", /never followed by its finishing pass \(G70\)/));
  it("a roughing cycle that starts inside the bar", () => caught("G54 G00 X1.35 Z0.1 M08", "G54 G00 X1.05 Z0.1 M08", /starts at X1\.05, inside the 1\.250 bar/));
  it("the thread's height and first cut", () => {
    caught("K0.035 D0.012", "K0.02 D0.012", /thread's height setting changed \(K0\.02, was K0\.035\)/);
    caught("K0.035 D0.012", "K0.035 D0.05", /thread's first cut on line 30 went up from 0\.012 to 0\.05/);
  });
  it("a threading tool that pulls back to inside the thread", () => caught("G00 X0.7 Z0.2\nG76", "G00 X0.4 Z0.2\nG76", /threading tool starts from a smaller diameter \(X0\.4, was X0\.7\)/));
  it("roughing in passes swapped for one cut at full depth", () => {
    const direct = swap("G71 P10 Q20 U0.02 W0.005 D0.08 F0.012\nN10 G00 X0.5\nG01 Z0. F0.006", "G00 X0.5\nG01 Z0. F0.006").replace("N20 X1.3\nG70 P10 Q20", "X1.3");
    const found = stops(BASE, direct).join(" | ");
    expect(found).toMatch(/One pass takes 0\.3\d* off per side in a single cut/);
    expect(found).toMatch(/That is how inserts and cutters get broken/);
  });
});

describe("tools", () => {
  it("a tool called with a different offset", () => caught("T0303 (GROOVE 0.125)", "T0304 (GROOVE 0.125)", /T3 is called with offset 4, where the current program uses 3/));
  it("a tool put to a kind of cut it doesn't make now", () => {
    caught("G01 X0.5 F0.003\nG00 X1.4", "G01 X0.5 F0.003\nG00 X1.4\nG00 X1.1 Z-2.\nG01 Z-2.5 F0.003\nG00 X1.4", /T3 is used for a kind of cut it doesn't make in the current program \(turning\)/);
  });
  it("a tool change with the last tool still beside the part", () => {
    caught("G00 X1.4 Z0.1\nG28 U0. W0.\nT0303", "G00 X1.4 Z0.1\nT0303", /changes tools 1 time without sending the turret home first, which the current program never does/);
  });
  it("where a tool lands after a tool change, when that is inside the bar", () => {
    caught("G00 X0.7 Z-0.9\nG01 X0.5 F0.003", "G00 X0.4 Z-2.\nG00 X0.7 Z-0.9\nG01 X0.5 F0.003", /rapid move goes through the bar/);
  });
  it("going home by way of the middle of the part", () => {
    caught("G00 X1.4 Z0.1\nG28 U0. W0.", "G00 X1.4 Z0.1\nG28 X0. Z0.", /goes home by way of a point it names \(G28X0\.Z0\.\)/);
  });
});

describe("what the app can't follow has to be word for word the same", () => {
  const withMacro = swap("G54 G00 X1.35 Z0.1 M08", "#101=2.\nG54 G00 X1.35 Z0.1 M08");
  it("a changed macro line", () => {
    expect(stops(withMacro, withMacro)).toEqual([]);
    expect(stops(withMacro, withMacro.replace("#101=2.", "#101=4.")).join(" ")).toMatch(/Lines the app can't follow .* are different.* New or changed: #101=4\./);
  });
  it("an added one", () => caught("G00 X1.4 Z0.5 M09", "G01 Z-[4.] F0.01\nG00 X1.4 Z0.5 M09", /Lines the app can't follow/));
  it("says so when there are some and they match", () => {
    expect(draftChecks(withMacro, withMacro, { part, machineFacts: tools }).coverage.notMeasured.join(" ")).toMatch(/1 line the app can't follow .* same in both programs, word for word, but what they do wasn't checked/);
  });
  it("live tools, sub-programs and coordinate shifts", () => {
    caught("G00 X1.4 Z0.5 M09", "M98 P2000\nG00 X1.4 Z0.5 M09", /M98, which calls a sub-program/);
    caught("G00 X1.4 Z0.5 M09", "M133 P2000\nG00 X1.4 Z0.5 M09", /M133, which starts a live tool/);
    caught("G50 S3000", "G50 S3000\nG50 W-0.5", /lines that move the coordinate system are different \(G50W-0\.5/);
    caught("G50 S3000", "G50 S3000\nG52 Z-0.5", /G52, which shifts the coordinate system/);
  });
  it("a code that opens the chuck or reverses the spindle", () => {
    caught("G00 X1.4 Z0.5 M09", "M11\nG00 X1.4 Z0.5 M09", /M11, which opens the chuck/);
    caught("G97 S700 M03", "G97 S700 M04", /M4, which runs the spindle backwards/);
  });
});

describe("the shape", () => {
  it("a diameter out by three tenths of a thousandth", () => caught("X0.625 Z-0.0625", "X0.6253 Z-0.0625", /Ø0\.625 from Z-0\.0625 to Z-1\.000 in the current program is Ø0\.6253/));
  it("a fillet that ends two thousandths higher, where it meets a shoulder", () => {
    caught("G02 X0.875 Z-1.125 R0.125", "G02 X0.879 Z-1.125 R0.125", /finished shape is different by 0\.000\d near Z-1\.0\d+/);
  });
  it("a shoulder moved by half a thousandth", () => {
    caught("Z-1.\nG02 X0.875 Z-1.125", "Z-1.0005\nG02 X0.875 Z-1.1255", /Ø0\.625|finished shape is different/);
  });
  it("two programs that cut the same shape a different way are not flagged", () => {
    const a = measure(BASE, part).sim;
    const b = measure(swap("D0.08 F0.012", "D0.05 F0.01"), part).sim;
    expect(profileDifference(a, b).worst).toBeLessThan(1e-6);
  });
  it("an early end of program, with tools still to run", () => {
    const found = stops(BASE, swap("G28 U0. W0.\nT0303", "G28 U0. W0.\nM30\nT0303")).join(" | ");
    expect(found).toMatch(/groove Ø0\.500 at Z-0\.900 in the current program isn't cut by this one/);
    expect(found).toMatch(/The thread is gone/);
  });
  it("inches and millimetres mixed", () => caught("G97 S700 M03", "G21\nG97 S700 M03", /switches between inches and millimetres/));
});

describe("a part with a bore", () => {
  // drilled on centre, bored out to 0.56, and turned to an inch outside
  const BORED = `%
O00021 (SPACER)
G20 G40 G80 G99
G50 S2500
T0707 (DRILL 1/2)
G97 S900 M03
G54 G00 X0. Z0.2 M08
G01 Z-1.2 F0.006
G00 Z0.2
G28 U0. W0.
T0909 (BORING BAR)
G97 S1200 M03
G00 X0.56 Z0.1
G01 Z-1.1 F0.004
G00 X0.5
G00 Z0.2
G28 U0. W0.
T0101 (CNMG ROUGH)
G96 S350 M03
G00 X1.3 Z0.1
G01 X1. F0.008
Z-1.
G00 X1.4
G00 Z0.2 M09
G28 U0. W0.
M30
%
`;
  it("compared with itself is clean, and says how it was checked", () => {
    const found = draftChecks(BORED, BORED, { part, machineFacts: tools });
    expect(found.filter((f) => f.level === "stop")).toEqual([]);
    expect(found.coverage.measured.join(" ")).toMatch(/Every cutting move is identical/);
    expect(found.coverage.notMeasured.join(" ")).toMatch(/Rapid moves inside the hole/);
  });
  it("its outside can't be thinned to a sliver unnoticed", () => caught("G01 X1. F0.008", "G01 X0.62 F0.008", /drilled or bored, and the app can't measure inside shapes.* and 4 aren't/, BORED));
  it("nor the hole drilled deeper", () => caught("G01 Z-1.2 F0.006", "G01 Z-1.9 F0.006", /drilled or bored/, BORED));
  it("nor the bore opened up", () => caught("G00 X0.56 Z0.1", "G00 X0.7 Z0.1", /drilled or bored/, BORED));
  it("a new rapid into the bar stops it even though the model is unsure about bored parts", () => {
    caught("G00 X1.4\nG00 Z0.2 M09", "G00 X1.4\nG00 X0.8 Z-0.5\nG00 X1.4\nG00 Z0.2 M09", /rapid move ends up 0\.\d+ inside the bar at Z-0\.500, and the current program has no such move/, BORED);
  });
  it("comments and slower speeds are still allowed", () => {
    expect(stops(BORED, BORED.replace("T0909 (BORING BAR)", "(BORE IT OUT)\nT0909 (BORING BAR)").replace("G97 S1200 M03", "G97 S1000 M03"))).toEqual([]);
  });
});


const millPart = { id: "m", name: "Plate", machine: "vf4", material: "6061", facts: { stock: "5 x 4 x 0.75 plate", holding: "vise" } };
const mf = { vf4: { tools: [{ t: "1", what: "1/2 endmill" }, { t: "2", what: "1/4 drill" }, { t: "3", what: "1/4-20 tap" }] } };
const MILL = `%
O05001 (MOUNT PLATE)
G20 G17 G40 G49 G80 G90
T1 M06 (1/2 FLAT ENDMILL)
G54 G00 X0.5 Y1. S6000 M03
G43 H01 Z1. M08
G01 Z-0.1 F20.
X3.5
G01 Z-0.2
X0.5
G00 Z1.
G91 G28 Z0.
G90
T2 M06 (1/4 DRILL)
G54 G00 X1. Y2.5 S2000 M03
G43 H02 Z1. M08
G98 G81 Z-0.4 R0.1 F5.
X3.
G80
G00 Z1.
G91 G28 Z0.
G90
T3 M06 (1/4-20 TAP)
G54 G00 X1. Y2.5 S500 M03
G43 H03 Z1.
G98 G84 Z-0.35 R0.2 F25.
X3.
G80
G00 Z1. M09
G91 G28 Z0.
G90
M30
%
`;
const mstops = (draft) => draftChecks(MILL, draft, { part: millPart, machineFacts: mf }).filter((f) => f.level === "stop").map((f) => f.text).join(" | ");
const mcaught = (from, to, why) => expect(mstops(swap(from, to, MILL)), `${from} -> ${to}`).toMatch(why);


describe("mill programs", () => {
  it("compared with itself is clean, and owns up to what a mill comparison can't see", () => {
    const found = draftChecks(MILL, MILL, { part: millPart, machineFacts: mf });
    expect(found.filter((f) => f.level === "stop")).toEqual([]);
    expect(found.coverage.measured.join(" ")).toMatch(/cut shape from above, square by square/);
    expect(found.coverage.notMeasured.join(" ")).toMatch(/Whether a rapid move hits the part/);
    expect(found.coverage.notMeasured.join(" ")).toMatch(/every cutter is taken as flat/);
  });
  it("a hole in a different place", () => mcaught("G98 G81 Z-0.4 R0.1 F5.\nX3.", "G98 G81 Z-0.4 R0.1 F5.\nX2.", /part comes out a different shape/));
  it("a slot moved sideways", () => mcaught("G54 G00 X0.5 Y1. S6000 M03", "G54 G00 X0.5 Y1.3 S6000 M03", /part comes out a different shape/));
  it("an end mill cutting deeper, even where a drill goes deeper still", () => mcaught("G01 Z-0.2\nX0.5", "G01 Z-0.3\nX0.5", /T1 cuts deeper than it does in the current program: Z-0\.3 against Z-0\.2/));
  it("two passes swapped for one at full depth", () => {
    const one = swap("G01 Z-0.1 F20.\nX3.5\nG01 Z-0.2\nX0.5", "G01 Z-0.2 F20.\nX3.5\nX0.5", MILL);
    expect(mstops(one)).toMatch(/One pass takes 0\.200 off in depth in a single cut .* never takes more than 0\.100/);
  });
  it("drilling between holes at the low height instead of the high one", () => mcaught("G98 G81", "G99 G81", /Rapid moves travel across the part lower than they ever did: at Z0\.1/));
  it("a lower travel height", () => mcaught("G80\nG00 Z1.\nG91 G28 Z0.\nG90\nT3", "G80\nG00 Z0.05\nG00 X2.\nG00 Z1.\nG91 G28 Z0.\nG90\nT3", /Rapid moves travel across the part lower than they ever did: at Z0\.05/));
  it("a tool brought down too far after a tool change", () => mcaught("G43 H02 Z1. M08", "G43 H02 Z-0.09 M08", /rapid move straight down ends lower than any does now: Z-0\.09/));
  it("the wrong length offset", () => mcaught("G43 H02 Z1. M08", "G43 H03 Z1. M08", /T2 is called with offset 3, where the current program uses 2/));
  it("a drill's feed and speed", () => {
    mcaught("G98 G81 Z-0.4 R0.1 F5.", "G98 G81 Z-0.4 R0.1 F20.", /T2's plunging feed went up from 5 to 20/);
    mcaught("X1. Y2.5 S2000 M03", "X1. Y2.5 S4000 M03", /T2's top spindle speed went up from 2000 to 4000/);
  });
  it("a tap whose speed no longer matches its feed", () => mcaught("X1. Y2.5 S500 M03", "X1. Y2.5 S400 M03", /tapping cycle's feed and speed no longer match/));
  it("going home in absolute mode, which is by way of Z0 on the part", () => {
    mcaught("G00 Z1.\nG91 G28 Z0.\nG90\nT2", "G00 Z1.\nG90 G28 Z0.\nT2", /goes home by way of a point it names \(G90G28Z0\.\)/);
  });
  it("a tidy-up that changes nothing is not stopped", () => {
    expect(mstops(MILL.replace("T2 M06 (1/4 DRILL)", "(DRILL THE FOUR HOLES)\nT2 M06 (1/4 DRILL)").replace("F20.", "F15."))).toBe("");
  });
});

describe("the verdict", () => {
  const usage = { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 };
  const TIDY = BASE.replace("G71 P10", "(ROUGH THE OUTSIDE)\nG71 P10");
  const wrote = (program) => ({ result: { program, summary: "s", changes: [{ what: "a", why: "b" }], assumptions: [], questions: [] }, usage, notes: [] });
  const read = (verdict, findings = []) => ({ result: { verdict, findings, checked: [], couldNotCheck: [] }, usage, notes: [] });
  const go = (answers, programs = [{ id: "v1", name: "O00017.nc", content: BASE, status: "unproven" }]) => {
    const calls = [];
    const ask = async (task, input) => { calls.push({ task, input }); const next = answers.shift(); if (!next) throw new Error(`unexpected ${task}`); return next; };
    return runRewrite({ ask, part, programs, machineFacts: tools, instruction: "Tidy it", now: new Date(2026, 10, 25) }).then((r) => ({ r, calls }));
  };

  it("'do not run' is never a pass, whatever is or isn't on the reader's list", async () => {
    for (const second of [
      read("do_not_run"),                                                                                   // no reasons given
      read("do_not_run", [{ level: "look", line: 7, quote: "G54 G00 X1.35 Z0.1 M08", problem: "This rapid ends inside the jaws.", fix: "" }]),
      read("ok_to_prove_out", [{ level: "stop", line: 7, quote: "G54 G00 X1.35 Z0.1 M08", problem: "", fix: "" }]),  // a stop with nothing written
      read("ok_to_prove_out", [{ level: "STOP", line: 7, quote: "G54 G00 X1.35 Z0.1 M08", problem: "Too close.", fix: "" }]),
      { result: {}, usage, notes: [] },                                                                     // no verdict at all
    ]) {
      // the same answer every time it's asked, so it can never be talked round
      const { r } = await go([wrote(TIDY), second, wrote(TIDY), second, wrote(TIDY), second, wrote(TIDY)]);
      expect(r.verdict, JSON.stringify(second.result)).toBe("problems");
    }
  });

  it("a reader that says 'do not run' with no reasons still sends the draft back", async () => {
    const { r, calls } = await go([wrote(TIDY), read("do_not_run"), wrote(TIDY), read("ok_to_prove_out")]);
    expect(calls.map((c) => c.task)).toEqual(["write", "verify", "fix", "verify"]);
    expect(calls[2].input.problems).toMatch(/must not be run, without saying why/);
    expect(r.verdict).toBe("passed");
  });

  it("a rewrite starts from the proven program, never from an unproven AI draft on top of it", async () => {
    const draft = { id: "d", name: "O00017 AI draft.nc", content: BASE.replace("X0.625 Z-0.0625", "X0.6248 Z-0.0625"), status: "unproven", ai: { kind: "rewrite" } };
    const proven = { id: "p", name: "O00017.nc", content: BASE, status: "proven" };
    expect(baselineOf([draft, proven])).toBe(proven);
    expect(baselineOf([draft, { ...proven, status: "unproven" }]).id).toBe("p");   // nothing proven: the newest a person put there
    expect(baselineOf([{ id: "w", ai: { kind: "written" }, status: "unproven" }]).id).toBe("w");   // written from sizes is not an AI draft
    const { r, calls } = await go([wrote(TIDY), read("ok_to_prove_out")], [draft, proven]);
    expect(calls[0].input.program).toBe(BASE);
    expect(r.basedOn).toMatchObject({ id: "p", proven: true, newest: false });
    expect(r.verdict).toBe("passed");
  });

  it("the record of a run says what was measured and what wasn't", async () => {
    const { r } = await go([wrote(TIDY), read("ok_to_prove_out")]);
    expect(r.coverage.measured.length).toBeGreaterThan(4);
    expect(r.coverage.notMeasured.length).toBeGreaterThan(1);
  });
});

describe("a sweep: every number that matters, nudged", () => {
  const lines = BASE.split("\n");
  const first = lines.findIndex((l) => l.startsWith("N10"));
  const last = lines.findIndex((l) => l.startsWith("N20"));
  const draftWith = (i, text) => lines.map((l, k) => (k === i ? text : l)).join("\n");
  const num = (v) => { const t = Number(v.toFixed(4)).toString(); return t.includes(".") ? t : `${t}.`; };

  it("any size on a cutting line, moved by a hundredth or more either way, stops the draft", () => {
    const missed = [];
    let tried = 0;
    lines.forEach((line, i) => {
      // the lines that shape the part: the profile (not the way out of it), the groove, the thread
      const shaping = (i >= first && i < last) || line === "G01 X0.5 F0.003" || line.startsWith("G76");
      if (!shaping) return;
      for (const m of line.matchAll(/([XZR])(-?\d*\.?\d+)/g)) {
        for (const delta of [0.01, -0.01, 0.06, -0.06]) {
          const value = Number(m[2]) + delta;
          if (m[1] === "R" && value <= 0) continue;
          const text = line.slice(0, m.index) + m[1] + num(value) + line.slice(m.index + m[0].length);
          tried += 1;
          if (!stops(BASE, draftWith(i, text)).length) missed.push(`line ${i + 1}: ${line}  ->  ${text}`);
        }
      }
    });
    expect(tried).toBeGreaterThan(45);
    expect(missed).toEqual([]);
  });

  it("any speed or feed, raised by a tenth, stops the draft", () => {
    const missed = [];
    let tried = 0;
    lines.forEach((line, i) => {
      if (/^\(|^%|^O\d/.test(line) || line.startsWith("G76")) return;   // (a thread's F is its lead: a size, covered above)
      for (const m of line.replace(/\([^)]*\)/g, (c) => " ".repeat(c.length)).matchAll(/([SF])(\d*\.?\d+)/g)) {
        const text = line.slice(0, m.index) + m[1] + Number((Number(m[2]) * 1.1).toFixed(4)) + line.slice(m.index + m[0].length);
        tried += 1;
        if (!stops(BASE, draftWith(i, text)).length) missed.push(`line ${i + 1}: ${line}  ->  ${text}`);
      }
    });
    expect(tried).toBeGreaterThanOrEqual(7);
    expect(missed).toEqual([]);
  });

  it("and lowering any of them never does", () => {
    lines.forEach((line, i) => {
      if (/^\(|^%|^O\d/.test(line) || line.startsWith("G76")) return;
      for (const m of line.replace(/\([^)]*\)/g, (c) => " ".repeat(c.length)).matchAll(/([SF])(\d*\.?\d+)/g)) {
        const text = line.slice(0, m.index) + m[1] + Number((Number(m[2]) * 0.8).toFixed(4)) + line.slice(m.index + m[0].length);
        expect(stops(BASE, draftWith(i, text)), `${line} -> ${text}`).toEqual([]);
      }
    });
  });
});

// ---- a second review, told what the first had found, went looking for more ----
describe("found by the second review", () => {
  const found = (old, draft, opts = {}) => draftChecks(old, draft, { part, machineFacts: tools, ...opts });
  const add = (after, text, src = BASE) => swap(after, `${after}\n${text}`, src);

  it("a rapid down toward the chuck, past everything the program cuts", () => caught("G00 X1.4 Z0.1\nG28", "G00 X1.4 Z0.1\nG00 X1.4 Z-6.\nG00 X1.4 Z0.1\nG28", /closer to the chuck than anything in the current program \(to Z-6\.000\)/));
  it("a plunge that leaves by going home instead of backing out", () => {
    const draft = swap("G00 X1.4 Z0.1\nG28 U0. W0.\nT0303", "G00 X1.4 Z-2.\nG01 X0.2 F0.006\nG28 U0. W0.\nT0303");
    const got = stops(BASE, draft).join(" | ");
    expect(got).toMatch(/sends the tool home from down inside the part/);
    expect(got).toMatch(/It cuts The groove Ø0\.200 at Z-2\.000|plunge goes through/);
  });
  it("homing from down a drilled hole", () => {
    const BORED = "%\nO21 (SPACER)\nG20 G40 G80 G99\nG50 S2500\nT0707 (DRILL 1/2)\nG97 S900 M03\nG54 G00 X0. Z0.2 M08\nG01 Z-1.2 F0.006\nG00 Z0.2\nG28 U0. W0.\nM30\n%\n";
    expect(stops(BORED, BORED.replace("G01 Z-1.2 F0.006\nG00 Z0.2\n", "G01 Z-1.2 F0.006\n")).join(" | ")).toMatch(/home from down inside the part/);
  });
  it("the thread cut before the outside is turned", () => {
    const thread = "T0505 (THREAD 60 DEG)\nG97 S700 M03\nG00 X0.7 Z0.2\nG76 X0.555 Z-0.8 K0.035 D0.012 F0.0625\nG00 X1.4 Z0.5 M09\nG28 U0. W0.\n";
    const draft = swap(thread, "").replace("T0101 (CNMG ROUGH)", `${thread}T0101 (CNMG ROUGH)`);
    expect(stops(BASE, draft).join(" | ")).toMatch(/thread is cut where the outside hasn't been turned down to it yet/);
  });
  it("the groove cut before the outside is turned", () => {
    const groove = "T0303 (GROOVE 0.125)\nG97 S800 M03\nG00 X1.4 Z-0.9\nG01 X0.5 F0.003\nG00 X1.4\nG00 Z0.2\nG28 U0. W0.\n";
    const old = swap("G00 X0.7 Z-0.9", "G00 X1.4 Z-0.9");
    const draft = swap(groove, "", old).replace("T0101 (CNMG ROUGH)", `${groove}T0101 (CNMG ROUGH)`);
    expect(stops(old, draft).join(" | ")).toMatch(/A plunge goes through 0\.375 of metal .* deepest in the current program is 0\.0625/);
  });
  it("a sub-program after the end of the program, changed", () => {
    const old = `${BASE.replace("M30\n%\n", "M97 P1000\nM30\nN1000 G01 X0.5 F0.003\nM99\n%\n")}`;
    const got = found(old, old.replace("N1000 G01 X0.5 F0.003", "N1000 G01 X0.1 F0.02"));
    expect(got.filter((f) => f.level === "stop").map((f) => f.text).join(" ")).toMatch(/lines after the end of the program \(where sub-programs go\) are different/);
  });
  it("the finishing pass given its own, faster speed, or run by the wrong tool", () => {
    caught("G70 P10 Q20", "G96 S900\nG70 P10 Q20", /T1's surface speed went up from 400 to 900/);
    const moved = swap("G70 P10 Q20\n", "").replace("G00 X0.7 Z-0.9\n", "G00 X1.35 Z0.1\nG70 P10 Q20\nG00 X0.7 Z-0.9\n");
    expect(stops(BASE, moved).join(" | ")).toMatch(/finishing pass is run with T3, where the current program finishes with T1/);
  });
  it("a finishing pass pointed at lines no roughing cycle uses", () => caught("G70 P10 Q20", "G70 P10 Q21", /finishing pass \(G70\) points at lines N10 to N21/));
  it("a rapid written inside the roughing profile", () => caught("G01 X1.125\nZ-3.", "G01 X1.125\nG00 Z-3.", /rapid move inside a roughing cycle's profile/));
  it("words the follower doesn't use: a thread taper, a different roughing cycle", () => {
    caught("K0.035 D0.012 F0.0625", "K0.035 D0.012 I-0.05 F0.0625", /Words the app can't follow are different.* New or changed: T5 G76 I-0\.05/);
    caught("G71 P10 Q20", "G72 P10 Q20", /roughing cycle was changed for a different one \(G72, was G71\)/);
  });
  it("a block-delete line, a % part way down, a bracket never closed, a line of prose", () => {
    caught("G70 P10 Q20", "/G70 P10 Q20", /starts with "\/"/);
    caught("T0505 (THREAD 60 DEG)", "%\nT0505 (THREAD 60 DEG)", /% in the middle of the program/);
    caught("G28 U0. W0.\nT0303", "(G28 U0. W0.\nT0303", /isn't G-code|bracket is opened and never closed/);
    caught("G20 G40 G80 G99", "Here is the improved program:\nG20 G40 G80 G99", /A line isn't G-code: "Here is the improved program:"/);
  });
  it("units set where they weren't, dropped where they were, or a size written with no decimal point", () => {
    const bare = BASE.replace("G20 G40 G80 G99", "G40 G80 G99");
    expect(stops(bare, bare.replace("G40 G80 G99", "G21 G40 G80 G99")).join(" | ")).toMatch(/sets the units \(G21\), which the current program never does/);
    caught("G20 G40 G80 G99", "G40 G80 G99", /sets its units \(G20\) and this one doesn't/);
    caught("G01 X1.125\nZ-3.", "G01 X1.125\nZ-3", /no decimal point/);
  });
  it("an operator stop taken out", () => {
    const old = add("G70 P10 Q20", "M00 (FLIP PART)");
    expect(stops(old, BASE).join(" | ")).toMatch(/operator stop is gone \(FLIP PART\)/);
    expect(stops(old, old.replace("M00 (FLIP PART)", "M01 (FLIP PART)")).join(" | ")).toMatch(/operator stop is gone/);
  });
  it("a long part is measured as tightly as a short one", () => {
    const long = BASE.replace("G01 X1.125\nZ-3.", "G01 X1.125\nZ-20.");
    expect(stops(long, long.replace("X0.625 Z-0.0625", "X0.6255 Z-0.0625")).join(" | ")).toMatch(/Ø0\.625 .* is Ø0\.6255/);
  });
  it("the spindle stopped, reversed, or a tool under a different zero", () => {
    caught("G97 S800 M03\nG00 X0.7 Z-0.9", "G97 S800 M03\nM05\nG00 X0.7 Z-0.9", /T3 cuts with the spindle stopped|spindle not turning/);
    const two = BASE.replace("T0303 (GROOVE 0.125)\nG97 S800 M03", "T0303 (GROOVE 0.125)\nG55\nG97 S800 M03");
    const swapped = two.replace("G54 G00 X1.35", "G55 G00 X1.35").replace("T0303 (GROOVE 0.125)\nG55", "T0303 (GROOVE 0.125)\nG54");
    expect(stops(two, swapped).join(" | ")).toMatch(/T1 cuts under work offset G55, where the current program has it under G54/);
  });

  it("mill: offsets and compensation, machine moves, a tap's second hole", () => {
    const m = (draft, old = MILL) => draftChecks(old, draft, { part: millPart, machineFacts: mf }).filter((f) => f.level === "stop").map((f) => f.text).join(" | ");
    expect(m(swap("G43 H01 Z1. M08", "G43 H01 Z1. M08\nG49", MILL))).toMatch(/Words the app can't follow are different.* T1 G49/);
    const comp = swap("G01 Z-0.1 F20.\nX3.5", "G01 Z-0.1 F20.\nG41 D01 X3.5", MILL);
    expect(m(comp.replace("G41 D01", "G41 D11"), comp)).toMatch(/Words the app can't follow.*D11/);
    expect(m(swap("G41 D01 X3.5", "X3.5", comp), comp)).toMatch(/Words the app can't follow.* Gone: T1 G41/);
    const mach = swap("G00 Z1.\nG91 G28 Z0.\nG90\nT2", "G00 Z1.\nG53 Z0.\nT2", MILL);
    expect(m(mach.replace("G53 Z0.", "G53 Z-18."), mach)).toMatch(/moves in machine coordinates \(G53\) are different: Z-18/);
    expect(m(swap("G98 G84 Z-0.35 R0.2 F25.\nX3.", "G98 G84 Z-0.35 R0.2 F25.\nX3. F12.5", MILL))).toMatch(/tapping cycle's feed and speed no longer match/);
    expect(m(swap("G98 G81 Z-0.4 R0.1 F5.", "G98 G83 Z-0.4 R0.1 Q0.5 F5.", MILL))).toMatch(/Words the app can't follow|different/);
  });
  it("mill: a harder cut that leaves the same shape", () => {
    const m = (draft, old = MILL) => draftChecks(old, draft, { part: millPart, machineFacts: mf }).filter((f) => f.level === "stop").map((f) => f.text).join(" | ");
    // the current program plunges slowly and then speeds up to travel; the draft plunges at the travelling feed
    const slow = swap("G01 Z-0.1 F20.\nX3.5\nG01 Z-0.2\nX0.5", "G01 Z-0.1 F4.\nG01 X3.5 F20.\nG01 Z-0.2 F4.\nG01 X0.5 F20.", MILL);
    expect(m(MILL, slow)).toMatch(/T1's plunging feed went up from 4 to 20/);
    // a rapid across the plate at cutting depth, where metal still stands
    expect(m(swap("G43 H01 Z1. M08\nG01 Z-0.1 F20.", "G43 H01 Z1. M08\nG00 Z-0.1\nG00 X0.5 Y2.5\nG00 Y1.\nG01 Z-0.1 F20.", MILL))).toMatch(/rapid move crosses metal that hasn't been cut away yet|Rapid moves travel across the part lower/);
  });

  describe("and what it wrongly refused", () => {
    it("roughing the inside of a bore with a negative allowance, compared with itself", () => {
      const ID = BASE.replace("U0.02 W0.005", "U-0.02 W0.005");
      expect(stops(ID, ID)).toEqual([]);
    });
    it("a thread given as distances from the start, or over two lines", () => {
      const inc = swap("G76 X0.555 Z-0.8 K0.035 D0.012 F0.0625", "G76 U-0.145 W-1. K0.035 D0.012 F0.0625");
      expect(stops(inc, inc)).toEqual([]);
      const two = swap("G76 X0.555 Z-0.8 K0.035 D0.012 F0.0625", "G76 P010060 Q50 R20\nG76 X0.555 Z-0.8 P350 Q120 F0.0625");
      expect(stops(two, two)).toEqual([]);
    });
    it("cancelling a tool's offset on the way home", () => {
      expect(stops(BASE, swap("G28 U0. W0.\nT0303", "G28 U0. W0.\nT0100\nT0303")).filter((t) => /offset/.test(t))).toEqual([]);
    });
    it("a mill tool's comment reworded without its size", () => {
      const got = draftChecks(MILL, MILL.replace("(1/2 FLAT ENDMILL)", "(ROUGHING ENDMILL)"), { part: millPart, machineFacts: mf }).filter((f) => f.level === "stop").map((f) => f.text);
      expect(got).toEqual([]);
    });
    it("a fault the current program already has doesn't fail a draft that only adds comments", () => {
      const old = BASE.replace("G50 S3000\n", "");
      const got = found(old, old.replace("T0101 (CNMG ROUGH)", "(TURN THE OUTSIDE)\nT0101 (CNMG ROUGH)"));
      expect(got.filter((f) => f.level === "stop")).toEqual([]);
      expect(got.find((f) => /no top speed set first/.test(f.text))).toMatchObject({ level: "look" });
      expect(got.sameMachine).toBe(true);
    });
    it("the same program written differently: G0 for G00, no spaces, small letters, a comment moved", () => {
      const other = BASE.replace(/G00/g, "G0").replace(/G01/g, "g1").replace("G54 g0 X1.35 Z0.1 M08", "G54G0X1.35Z0.1M08").replace("G54 G0 X1.35 Z0.1 M08", "G54G0X1.35Z0.1M08").replace("(CNMG ROUGH)", "(ROUGH TURNING TOOL)");
      const got = found(BASE, other);
      expect(got.filter((f) => f.level === "stop")).toEqual([]);
      expect(got.sameMachine).toBe(true);
    });
  });
});

describe("only one outcome is a pass", () => {
  const usage = { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 };
  const wrote = (program) => ({ result: { program, summary: "s", changes: [], assumptions: [], questions: [] }, usage, notes: [] });
  const ok = { result: { verdict: "ok_to_prove_out", findings: [], checked: [], couldNotCheck: [] }, usage, notes: [] };
  const go = (old, draft) => {
    const answers = [wrote(draft), ok];
    return runRewrite({ ask: async () => answers.shift(), part, programs: [{ id: "v", name: "O1.nc", content: old, status: "unproven" }], machineFacts: tools, instruction: "x", now: new Date(2026, 10, 25) });
  };
  it("comments only, or something slower: passed", async () => {
    expect((await go(BASE, BASE.replace("T0101 (CNMG ROUGH)", "(TURN THE OUTSIDE)\nT0101 (CNMG ROUGH)"))).verdict).toBe("passed");
    expect((await go(BASE, BASE.replace("G97 S800 M03", "G97 S700 M03").replace("G01 X0.5 F0.003", "G01 X0.5 F0.002"))).verdict).toBe("passed");
  });
  it("any change to what the machine does, with nothing found wrong: changed, never passed", async () => {
    const r = await go(BASE, BASE.replace("D0.08 F0.012", "D0.06 F0.012"));   // shallower roughing passes
    expect(r.verdict).toBe("changed");
    expect(r.changedLines).toBe(1);
  });
  it("a program the app can't follow, with its code changed: unmeasured, and it says why", async () => {
    const macro = BASE.replace("G54 G00 X1.35 Z0.1 M08", "#101=2.\nG54 G00 X1.35 Z0.1 M08");
    const r = await go(macro, macro.replace("D0.08 F0.012", "D0.06 F0.012"));
    expect(r.verdict).toBe("unmeasured");
    expect(r.unmeasured).toMatch(/macros, live tools, the sub-spindle or sub-programs.* could not measure this rewrite: 1 line of code changed/);
    // but with only comments changed it is the same program, and passes
    expect((await go(macro, macro.replace("T0101 (CNMG ROUGH)", "(NOTE)\nT0101 (CNMG ROUGH)"))).verdict).toBe("passed");
  });
});

describe("breaking the edges", () => {
  // the same pin written twice by the app's own writer: sharp corners, then broken ones
  it("is told apart from a change of size, and is something to check, not a stop", async () => {
    const { writeLathe, specFromPart } = await import("../floor/cncWrite.js");
    const spec = (chamfer, edge) => ({ ...specFromPart({ ...part, programNo: "O00017", facts: { ...part.facts, holding: "3-jaw chuck, 4 inch stick-out" } }, tools), steps: [{ dia: "0.625", len: "1" }, { dia: "1.125", len: "2" }], chamfer, edgeBreak: edge, cut: { sfm: "350", rough: "0.01", finish: "0.004", depth: "0.06", maxRpm: "2500" } });
    const sharp = writeLathe(spec("0", "0"));
    const broken = writeLathe(spec("0.03", "0.01"));
    const found = draftChecks(sharp, broken, { part, machineFacts: tools });
    expect(found.filter((f) => f.level === "stop").map((f) => f.text)).toEqual([]);
    expect(found.find((f) => /Only the corners change/.test(f.text))).toMatchObject({ level: "look" });
    expect(found.find((f) => /Only the corners change/.test(f.text)).text).toMatch(/the most any corner moves is 0\.02/);
    expect(found.sameMachine).toBe(false);                  // it's a change: a lead reads it
    // a chamfer far too big to be an edge break is still a change of shape
    const big = draftChecks(sharp, writeLathe(spec("0.2", "0.01")), { part, machineFacts: tools });
    expect(big.filter((f) => f.level === "stop").map((f) => f.text).join(" ")).toMatch(/Ø0\.625/);
    // and a diameter changed along with the corners is still a stop
    const bigger = writeLathe({ ...spec("0.03", "0.01"), steps: [{ dia: "0.62", len: "1" }, { dia: "1.125", len: "2" }] });
    expect(draftChecks(sharp, bigger, { part, machineFacts: tools }).filter((f) => f.level === "stop").length).toBeGreaterThan(0);
  });
});
