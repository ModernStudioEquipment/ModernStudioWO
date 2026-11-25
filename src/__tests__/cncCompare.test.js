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

describe("mill programs", () => {
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
    mcaught("G98 G81 Z-0.4 R0.1 F5.", "G98 G81 Z-0.4 R0.1 F20.", /T2's cutting feed went up from 5 to 20/);
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
