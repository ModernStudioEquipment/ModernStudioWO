// @vitest-environment node
import { describe, it, expect } from "vitest";
import { toolpath } from "../floor/cncPath.js";
import { simulateLathe } from "../floor/cncSolid.js";
import { fileLabel } from "../floor/cncPack.js";

// The first real import (2026-11-25): most of the shop's ST-10Y programs showed
// "rapid moves may go through the bar (bar size guessed)". Two causes: no
// stock size on the imported parts (so the bar was guessed from the biggest
// diameter any cut started at), and live-tool moves treated as turning.

const P = (body) => `%\nO00636 (006-1596)\nG20 G99\nG50 S3000\n${body}\nM30\n%\n`;
const TURN = "T0505 (TURN)\nG96 S400 M03\nG54 G00 X1.6 Z0.1\nG01 X1.4 F0.006\nZ-1.\nG00 X1.6\nZ0.1\nG28 U0. W0.";

describe("a guessed bar", () => {
  it("raises no rapid alarms: there's nothing true to check them against", () => {
    // an approach from X2.4 makes the guessed bar 2.4: the retract to X1.5 would look buried
    const prog = P("T0505 (TURN)\nG96 S400 M03\nG54 G00 X2.6 Z0.1\nG01 X2.4 F0.01\nG00 X1.2 Z0.1\nG01 Z-0.09\nG00 X1.5\nZ0.5 M09\nG28 U0. W0.");
    const guessed = simulateLathe(toolpath(prog), null);
    expect(guessed.guessed).toBe(true);
    expect(guessed.collisions).toEqual([]);
    // with the real bar given, the same moves are checked (and here they're clear)
    const real = simulateLathe(toolpath(prog), { dia: 1.5 });
    expect(real.guessed).toBe(false);
    expect(real.collisions).toEqual([]);
  });
  it("a real collision against a real bar is still found", () => {
    const prog = P(`${TURN}\nT0101 (DRILL)\nG00 X0.5 Z-0.5\nG28 U0. W0.`);
    const sim = simulateLathe(toolpath(prog), { dia: 1.5 });
    expect(sim.collisions.map((c) => c.line)).toEqual([14]);   // "G00 X0.5 Z-0.5", straight into the bar
  });
});

describe("live tools and the sub-spindle", () => {
  it("a live tool's moves don't turn the bar down and aren't checked against it", () => {
    const live = "T1111 (1/4 END MILL LIVE)\nM154\nG00 G54 X1.6 Z-0.875 C90.\nG98 M133 P2000\nG01 X1.0 F5.\nG00 X1.6\nM135\nM155\nG28 U0. W0.";
    const path = toolpath(P(`${TURN}\n${live}`));
    const liveSegs = path.segs.filter((s) => s.tool === 11);
    expect(liveSegs.length).toBeGreaterThan(0);
    expect(liveSegs.every((s) => s.live)).toBe(true);
    expect(path.segs.filter((s) => s.tool === 5).some((s) => s.live)).toBe(false);
    const sim = simulateLathe(path, { dia: 1.5 });
    expect(sim.collisions).toEqual([]);
    // the milled flat isn't turned all the way round: the outside is still Ø1.4
    expect(Math.min(...sim.zs.filter((z) => z < -0.1 && z > -0.9).map((z) => sim.radiusAt(sim.final, z) * 2))).toBeCloseTo(1.4, 3);
  });
  it("the next tool after a live one is followed again", () => {
    const prog = P(`T1111 (LIVE DRILL)\nM154\nG00 X1.6 Z-0.5 C0.\nM155\nG28 U0. W0.\n${TURN}`);
    const path = toolpath(prog);
    expect(path.segs.filter((s) => s.tool === 5).every((s) => !s.live)).toBe(true);
  });
  it("everything between G14 and G15 is in the sub-spindle", () => {
    const prog = P(`${TURN}\nG14\nT0606 (FACE BACK)\nG00 X1.6 Z0.1\nG01 X-0.03 F0.004\nG28 U0. W0.\nG15\nT0707 (TURN 2)\nG00 X1.6 Z0.1\nG01 X1.3 F0.006\nG28 U0. W0.`);
    const path = toolpath(prog);
    expect(path.segs.filter((s) => s.tool === 6).every((s) => s.live)).toBe(true);
    expect(path.segs.filter((s) => s.tool === 7).some((s) => s.live)).toBe(false);
  });
});

describe("the shop's numbers in a program file's name", () => {
  it("reads the CNC number and what the part is", () => {
    expect(fileLabel("CNC-0240 - STACK 6.nc", { number: "O00636" })).toEqual({ cnc: "CNC-0240", title: "STACK 6", program: "O00636" });
    expect(fileLabel("cnc_0286_HOSTESS TRAY.NC")).toEqual({ cnc: "CNC-0286", title: "HOSTESS TRAY", program: "" });
    expect(fileLabel("O00017.nc", { number: "O00017" })).toEqual({ cnc: "", title: "", program: "O00017" });
  });
});
