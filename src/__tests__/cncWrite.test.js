// @vitest-environment node
import { describe, it, expect } from "vitest";
import { specFromPart, readSpec, checkSpec, writeLathe, proveWritten, makeProgram, shapeProgram, materialFor, gnum, writtenName, writtenRecord, MATERIALS } from "../floor/cncWrite.js";
import { checkProgram } from "../floor/cncGcode.js";
import { toolpath } from "../floor/cncPath.js";
import { simulateLathe, partSizes } from "../floor/cncSolid.js";
import { draftChecks } from "../floor/cncAi.js";

// A program written from sizes. The form is checked, the program is written by
// a fixed recipe, and then the program is followed like any other and has to
// cut what the form asked for. These tests are that last step done by hand,
// plus every way the form can be wrong.

const tools = { st10: { tools: [{ t: "1", what: "CNMG rough turn" }, { t: "3", what: "Part off 0.125" }, { t: "5", what: "Thread 60 deg" }] } };
const part = { id: "p", name: "3in Steel Baby Pin", machine: "st10", material: "1018 steel", programNo: "O00017", facts: { stock: '1.25" round bar', holding: "3-jaw chuck, 4 inch stick-out" } };
const base = () => ({
  ...specFromPart(part, tools),
  steps: [{ dia: "0.625", len: "1" }, { dia: "1.125", len: "2" }],
});
const errs = (spec, mf = tools) => checkSpec(spec, { machineFacts: mf }).errors.map((e) => e.field);
const warns = (spec, mf = tools) => checkSpec(spec, { machineFacts: mf }).warnings.map((w) => w.text).join(" | ");
const date = new Date(2026, 10, 25);

describe("starting from the part", () => {
  it("fills the form in from what's already written down", () => {
    const s = specFromPart(part, tools);
    expect(s).toMatchObject({ number: "00017", name: "3in Steel Baby Pin", machine: "st10", material: "1018 steel", stockDia: "1.25", stickOut: "4" });
    expect(s.tools.turn).toEqual({ t: "1", name: "CNMG rough turn" });
    expect(s.tools.thread).toEqual({ t: "5", name: "Thread 60 deg" });
    expect(s.tools.part).toEqual({ t: "3", name: "Part off 0.125" });
    expect(s.cut).toMatchObject({ sfm: "350", rough: "0.01", finish: "0.004", depth: "0.06", maxRpm: "2500" });
  });

  it("leaves blank what it doesn't know, and never picks a mill", () => {
    const s = specFromPart({ name: "X", machine: "vf4", facts: {} }, {});
    expect(s.machine).toBe("");
    expect(s.stockDia).toBe("");
    expect(s.tools.turn.t).toBe("");
    expect(s.cut.sfm).toBe("");
  });

  it("picks starting speeds by material, the more particular steel first", () => {
    expect(materialFor("303 stainless").key).toBe("stainless");
    expect(materialFor("4140 alloy steel").key).toBe("alloy");
    expect(materialFor("1018 steel").key).toBe("steel");
    expect(materialFor("6061 aluminum").key).toBe("aluminum");
    expect(materialFor("360 brass").key).toBe("brass");
    expect(materialFor("black Delrin").key).toBe("plastic");
    expect(materialFor("unobtainium")).toBeNull();
    for (const m of MATERIALS) expect(m.finish).toBeLessThanOrEqual(m.rough);
  });
});

describe("checking the form", () => {
  it("a complete form passes", () => {
    expect(checkSpec(base(), { machineFacts: tools })).toMatchObject({ ok: true, errors: [] });
  });

  it("names each box that's empty", () => {
    const blank = specFromPart({ name: "", machine: "", facts: {} }, {});
    const got = errs(blank, {});
    for (const f of ["name", "number", "machine", "material", "stockDia", "stickOut", "dia0", "len0", "tool_turn", "sfm", "rough", "finish", "depth"]) expect(got).toContain(f);
  });

  it("diameters have to step up toward the chuck", () => {
    const s = base(); s.steps = [{ dia: "1.125", len: "1" }, { dia: "0.625", len: "2" }];
    expect(errs(s)).toContain("dia1");
    expect(checkSpec(s, { machineFacts: tools }).errors.find((e) => e.field === "dia1").text).toMatch(/second program for the other end/);
  });

  it("the bar has to be bigger than the biggest diameter", () => {
    const s = base(); s.stockDia = "1.125";
    expect(errs(s)).toContain("stockDia");
    s.stockDia = "1.135";
    expect(errs(s)).not.toContain("stockDia");
  });

  it("it has to stick out far enough to stay clear of the jaws", () => {
    const s = base(); s.stickOut = "3.1";
    const e = checkSpec(s, { machineFacts: tools }).errors.find((x) => x.field === "stickOut");
    expect(e.text).toMatch(/cuts 3\.000 back from the face, so the bar has to stick out at least 3\.250/);
    s.stickOut = "3.25";
    expect(errs(s)).not.toContain("stickOut");
    // a part-off reaches further: the blade's width and a little beyond
    s.partOff = { width: "0.125" };
    expect(checkSpec(s, { machineFacts: tools }).errors.find((x) => x.field === "stickOut").text).toMatch(/at least 3\.405/);
  });

  it("chamfers and edge breaks have to fit", () => {
    const a = base(); a.chamfer = "0.4";
    expect(errs(a)).toContain("chamfer");
    const b = base(); b.edgeBreak = "0.3";
    expect(errs(b)).toContain("edgeBreak");
  });

  it("every tool needs a pocket of its own and a name", () => {
    const a = base(); a.tools.turn = { t: "", name: "" };
    expect(errs(a)).toContain("tool_turn");
    const b = base(); b.thread = { tpi: "16", len: "0.75" }; b.tools.thread = { t: "1", name: "Thread" };
    expect(checkSpec(b, { machineFacts: tools }).errors.find((x) => x.field === "tool_thread").text).toMatch(/can't both be in pocket 1/);
    const c = base(); c.tools.turn = { t: "9", name: "Turn" };
    expect(warns(c)).toMatch(/Pocket 9 isn't on the ST-10's tool list/);
    expect(warns(base(), {})).toMatch(/tool list isn't filled in/);
  });

  it("speeds and feeds have to be in a sane range", () => {
    const s = base(); s.cut = { sfm: "5000", rough: "0.1", finish: "0", depth: "0.5", maxRpm: "9000" };
    const got = errs(s);
    for (const f of ["sfm", "rough", "finish", "depth", "maxRpm"]) expect(got).toContain(f);
    const fast = base(); fast.cut.sfm = "600";
    expect(warns(fast)).toMatch(/a lot faster than the usual starting speed for this material \(350\)/);
  });

  it("a thread has to fit and leave room to pull out", () => {
    const s = base(); s.thread = { tpi: "16", len: "0.99" };
    expect(checkSpec(s, { machineFacts: tools }).errors.find((x) => x.field === "threadLen").text).toMatch(/stop at least 0\.0938 short/);   // a turn and a half of a 16 pitch thread
    s.thread = { tpi: "16", len: "0.75" };
    expect(errs(s)).toEqual([]);
    expect(warns(s)).toMatch(/front chamfer was made 0\.044 so the thread has a lead-in/);
    s.thread = { tpi: "13", len: "0.75" };
    expect(warns(s)).toMatch(/13 threads per inch doesn't come out to a round lead/);
    s.thread = { tpi: "200", len: "0.5" };
    expect(errs(s)).toContain("tpi");
  });

  it("warns about long thin work, a big overhang and locked program numbers, without refusing", () => {
    const s = base(); s.steps = [{ dia: "0.25", len: "1.5" }, { dia: "1", len: "0.5" }];
    expect(checkSpec(s, { machineFacts: tools }).ok).toBe(true);
    expect(warns(s)).toMatch(/Diameter 1 is more than four times as long as it is thick/);
    const far = base(); far.stickOut = "6";
    expect(warns(far)).toMatch(/sticks out more than four times its diameter/);
    const locked = base(); locked.number = "9001";
    expect(warns(locked)).toMatch(/9000 and up are often locked/);
  });
});

describe("the program it writes", () => {
  const program = writeLathe(base(), { machineFacts: tools, date });

  it("is the recipe, with the form's numbers and nothing else", () => {
    expect(program).toBe(`%
O00017 (3IN STEEL BABY PIN)
(WRITTEN BY THE CNC CATALOG 2026-11-25 - NOT PROVEN - PROVE OUT BEFORE RUNNING)
(1018 STEEL - BAR 1.250 DIA)
(BAR MUST STICK OUT 3.250 OR MORE FROM THE JAWS)
(Z0 IS THE FINISHED FRONT FACE. LEAVE 0.030 OR LESS TO FACE OFF)
(START WITH THE TURRET WELL CLEAR OF THE CHUCK AND THE BAR)
G18 G20 G40 G80 G99
G54
G50 S2500
T0101 (CNMG ROUGH TURN)
G96 S350 M03
G00 X1.45 Z0.1 M08
(FACE THE END)
G00 Z0.
G01 X-0.032 F0.004
G00 Z0.1
G00 X1.45
(ROUGH THE OUTSIDE)
G71 P10 Q20 U0.02 W0.005 D0.06 F0.01
N10 G00 X0.565
G01 Z0. F0.004
X0.625 Z-0.03
Z-1.
X1.105
X1.125 Z-1.01
Z-3.
N20 X1.45
(FINISH THE OUTSIDE)
G70 P10 Q20
G00 X1.45 Z0.1 M09
M05
G00 G53 X0.
G53 Z0.
M30
%
`);
  });

  it("passes the same rule checks as any program, with nothing to fix", () => {
    const found = checkProgram(program, { machineKind: "lathe", machineTools: tools.st10.tools });
    expect(found.filter((f) => f.level === "stop")).toEqual([]);
    expect(found.filter((f) => f.level === "look")).toEqual([]);
  });

  it("followed like any other program, it cuts exactly what the form asked for", () => {
    const sim = simulateLathe(toolpath(program, { kind: "lathe" }), { dia: 1.25, len: null });
    const got = partSizes(sim).steps.map((x) => [Number(x.dia.toFixed(4)), Number(x.z1.toFixed(4)), Number(x.z0.toFixed(4))]);
    expect(got).toEqual([[0.625, -0.03, -1], [1.125, -1.01, -3]]);
    expect(sim.collisions).toEqual([]);
    expect(proveWritten(base(), program, { machineFacts: tools })).toMatchObject({ ok: true, problems: [] });
  });

  it("every dimension word has a decimal point", () => {
    expect(gnum(1)).toBe("1.");
    expect(gnum(0)).toBe("0.");
    expect(gnum(-0.032)).toBe("-0.032");
    expect(gnum(1.10499999)).toBe("1.105");
    expect(gnum(-0.00001)).toBe("0.");
    const code = program.replace(/\([^)]*\)/g, "");   // comments aren't code
    const words = [...code.matchAll(/[XZUW]-?\d[\d.]*/g)].map((m) => m[0]);
    expect(words.length).toBeGreaterThan(15);
    for (const w of words) expect(w).toMatch(/\./);
    for (const line of program.split("\n")) expect(line.length).toBeLessThanOrEqual(80);
  });

  it("a part name with odd characters can't break the comment", () => {
    const s = base(); s.name = 'Pin (3") — ½ "special" #2';
    const p = writeLathe(s, { machineFacts: tools, date });
    const line = p.split("\n")[1];
    expect(line).toMatch(/^O00017 \([A-Z0-9 .,/\-+=:]*\)$/);
    expect(/[^\x20-\x7E\n]/.test(p)).toBe(false);
  });

  it("refuses to write from a form with an error in it", () => {
    const s = base(); s.stickOut = "1";
    expect(() => writeLathe(s, { machineFacts: tools })).toThrow(/stick out at least/);
    expect(makeProgram(s, { machineFacts: tools })).toMatchObject({ ok: false, program: "" });
  });
});

describe("with a thread and a part-off", () => {
  const spec = () => { const s = base(); s.thread = { tpi: "16", len: "0.75" }; s.partOff = { width: "0.125" }; return s; };
  const out = makeProgram(spec(), { machineFacts: tools, date });

  it("writes both, and proves them", () => {
    expect(out.ok).toBe(true);
    expect(out.proof.problems).toEqual([]);
    const p = out.program;
    expect(p).toContain("T0505 (THREAD 60 DEG)\nG97 S850 M03\nG00 X0.825 Z0.2 M08\nM23\nG76 X0.5483 Z-0.75 K0.0383 D0.012 F0.0625\nM24");
    expect(p).toContain("(PART OFF 3.000 LONG. BLADE 0.125 WIDE)");
    expect(p).toContain("T0303 (PART OFF 0.125)\nG97 S700 M03\nG00 X1.45 Z0.1 M08\nG00 Z-3.125\nG01 X-0.032 F0.003\nG00 X1.45\nG00 Z0.1 M09");
    expect(p).toContain("X0.625 Z-0.044");          // the lead-in chamfer, made as deep as the thread
    expect(p).toContain("Z-3.155\nN20 X1.45");      // turned a little past the part-off
    expect(p.trim().endsWith("M30\n%")).toBe(true);
  });

  it("matches the forms in Haas's own documentation", () => {
    // G76 X(root diameter) Z(end) K(height, radius) D(first pass) F(lead), as in Haas's example
    //   G76 X0.913 Z-0.85 K0.042 D0.0115 F0.0714
    expect(out.program).toMatch(/^G76 X\d\.\d+ Z-\d\.\d+ K0\.\d+ D0\.\d+ F0\.\d{1,4}$/m);
    // G71 P Q U(diameter) W D(positive radius) F on one line; the P block holds an X move only (Type 1)
    expect(out.program).toMatch(/^G71 P10 Q20 U0\.02 W0\.005 D0\.06 F0\.01$/m);
    expect(out.program).toMatch(/^N10 G00 X\d\.\d+$/m);
    expect(out.program).toMatch(/^G18 G20 G40 G80 G99$/m);                         // the plane G71 needs, said out loud
    expect(out.program.match(/^G00 G53 X0\.\nG53 Z0\.$/gm)).toHaveLength(3);      // home X first, then Z, after each tool
    // a lead that doesn't divide evenly is given to four places, as Haas's is (1/14 = 0.0714)
    const s14 = spec(); s14.thread = { tpi: "14", len: "0.75" };
    expect(makeProgram(s14, { machineFacts: tools, date }).program).toMatch(/ F0\.0714$/m);
  });

  it("threads at a fixed speed, and never above the top speed on the form", () => {
    const found = checkProgram(out.program, { machineKind: "lathe", machineTools: tools.st10.tools });
    expect(found.filter((f) => f.level !== "note")).toEqual([]);
    const slow = spec(); slow.cut.maxRpm = "500";
    const p = makeProgram(slow, { machineFacts: tools, date });
    expect(p.ok).toBe(true);
    expect(p.program).toContain("G50 S500");
    expect([...p.program.matchAll(/G97 S(\d+)/g)].map((m) => Number(m[1])).every((v) => v <= 500)).toBe(true);
  });
});

describe("proving its own work catches a wrong program", () => {
  const spec = base();
  const good = writeLathe(spec, { machineFacts: tools, date });
  const prove = (p) => proveWritten(spec, p, { machineFacts: tools });

  it("a diameter that came out wrong", () => {
    expect(prove(good.replace("X0.625 Z-0.03", "X0.635 Z-0.03")).problems.join(" ")).toMatch(/Diameter 1 comes out 0\.635, not 0\.625/);
  });
  it("a shoulder in the wrong place", () => {
    expect(prove(good.replace("Z-1.\nX1.105\nX1.125 Z-1.01", "Z-1.1\nX1.105\nX1.125 Z-1.11")).problems.join(" ")).toMatch(/Diameter 1 ends at Z-1\.100, not Z-1\.000/);
  });
  it("cutting further than asked", () => {
    expect(prove(good.replace("Z-3.\nN20", "Z-3.5\nN20")).problems.join(" ")).toMatch(/cuts 3\.500 back from the face\. The form asks for 3\.000/);
  });
  it("a rapid through the bar", () => {
    expect(prove(good.replace("M05\nG00 G53 X0.", "G00 X0.5 Z-2.\nM05\nG00 G53 X0.")).problems.join(" ")).toMatch(/rapid move goes through the bar/);
  });
  it("a speed above the form's", () => {
    expect(prove(good.replace("G96 S350", "G96 S500")).problems.join(" ")).toMatch(/surface speed is above/);
    expect(prove(good.replace("G50 S2500", "G50 S4000")).problems.join(" ")).toMatch(/above the top speed/);
  });
  it("a missing speed limit", () => {
    expect(prove(good.replace("G50 S2500\n", "")).problems.join(" ")).toMatch(/no top speed set first/);
  });
  it("an extra diameter, a thread or a groove nobody asked for", () => {
    expect(prove(good.replace("X1.105\nX1.125 Z-1.01\nZ-3.", "X0.855\nX0.875 Z-1.01\nZ-2.\nX1.125\nZ-3.")).problems.join(" ")).toMatch(/cuts 3 diameters\. The form asks for 2/);
    expect(prove(good.replace("M30", "G97 S500 M03\nG00 X0.8 Z0.2\nG76 X0.55 Z-0.5 K0.03 D0.01 F0.0625\nM30")).problems.join(" ")).toMatch(/thread nobody asked for/);
    expect(prove(good.replace("M30", "G00 X1.45 Z-2.\nG01 X0.9 F0.003\nG00 X1.45\nM30")).problems.join(" ")).toMatch(/groove nobody asked for/);
  });
  it("and then the program isn't offered", () => {
    // can't happen through the form; forced here by proving one form's program against another form
    const other = base(); other.steps[0].dia = "0.5";
    expect(proveWritten(other, good, { machineFacts: tools }).ok).toBe(false);
  });
});

describe("across many shapes", () => {
  // The recipe has to hold for every form that passes the checks, not just the one above.
  const shapes = [];
  for (const stock of [0.5, 1, 2, 3]) {
    for (const n of [1, 2, 3, 4]) {
      for (const [chamfer, edge] of [[0.03, 0.01], [0, 0], [0.06, 0.02]]) {
        const steps = [];
        for (let i = 0; i < n; i++) steps.push({ dia: String(Number((stock * (0.3 + (0.6 * (i + 1)) / n)).toFixed(4))), len: String(Number((0.3 + i * 0.37).toFixed(3))) });
        shapes.push({ stock, steps, chamfer, edge });
      }
    }
  }
  it(`writes and proves all ${shapes.length} of them, alone and with a thread and a part-off`, () => {
    let made = 0;
    for (const sh of shapes) {
      for (const extras of [false, true]) {
        const s = base();
        s.stockDia = String(sh.stock); s.steps = sh.steps; s.chamfer = String(sh.chamfer); s.edgeBreak = String(sh.edge); s.stickOut = "9";
        if (extras) { s.thread = { tpi: "20", len: String(Number((Number(sh.steps[0].len) - 0.12).toFixed(3))) }; s.partOff = { width: "0.118" }; }
        const check = checkSpec(s, { machineFacts: tools });
        if (!check.ok) continue;   // a shape the form itself refuses is not this test's business
        const out = makeProgram(s, { machineFacts: tools, date });
        expect(out.proof.problems, JSON.stringify({ sh, extras })).toEqual([]);
        expect(out.ok).toBe(true);
        made += 1;
      }
    }
    expect(made).toBeGreaterThan(60);
  });
});

describe("the picture while the form is being filled in", () => {
  it("draws as soon as the sizes make sense, whatever else is still blank", () => {
    const blank = specFromPart({ name: "", machine: "", facts: {} }, {});
    expect(shapeProgram(blank)).toBeNull();                                  // no sizes yet
    blank.steps = [{ dia: "0.625", len: "1" }];
    const one = shapeProgram(blank);
    expect(one.program).toContain("X0.625 Z-0.03");
    expect(Number(one.bar)).toBeCloseTo(0.75);                               // no bar typed: a little over the biggest diameter
    expect(makeProgram(blank, {}).ok).toBe(false);                           // and the real thing still isn't offered
    blank.steps = [{ dia: "1", len: "1" }, { dia: "0.5", len: "1" }];
    expect(shapeProgram(blank)).toBeNull();                                  // sizes that can't be made draw nothing
  });
});

describe("a written program and the AI's checks agree", () => {
  it("a program compared with itself through the rewrite measurements is clean", () => {
    const p = writeLathe(base(), { machineFacts: tools, date });
    const full = { ...part, facts: { ...part.facts } };
    expect(draftChecks(p, p, { part: full, machineFacts: tools }).filter((f) => f.level === "stop")).toEqual([]);
  });
  it("is filed under a name that says where it came from", () => {
    expect(writtenName(base())).toBe("O00017 from sizes.nc");
    const rec = writtenRecord(base(), date);
    expect(rec.kind).toBe("written");
    expect(rec.summary).toBe("Written by the app from sizes: Ø0.625 x 1.000, Ø1.125 x 2.000.");
    expect(readSpec(rec.spec).total).toBe(3);
  });
});
