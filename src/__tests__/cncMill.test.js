// @vitest-environment node
import { describe, it, expect } from "vitest";
import { toolpath } from "../floor/cncPath.js";
import { simulateMill, toolDia, parseBlock } from "../floor/cncMill.js";

// The milled block. Each program here is small enough to work out by hand, so
// the numbers are the test.

const near = (a, b, tol = 1e-3) => expect(Math.abs(a - b)).toBeLessThan(tol);
// A slot along X at Y1, half an inch wide, a quarter deep; then one hole.
const PLATE = `%
O05001 (MOUNT PLATE)
G20 G17 G40 G49 G80 G90
T1 M06 (1/2 FLAT ENDMILL)
G54 G00 X1. Y1. S6000 M03
G43 H01 Z1. M08
G01 Z-0.25 F20.
X3.
G00 Z1.
T2 M06 (1/4 DRILL)
G54 G00 X2. Y2. S3000 M03
G43 H02 Z1. M08
G98 G81 Z-0.6 R0.1 F6.
G80
G00 Z1.
M30
%
`;
const names = { 1: "1/2 FLAT ENDMILL", 2: "1/4 DRILL" };
const sim = simulateMill(toolpath(PLATE), { stockText: "4 x 3 x 0.75 plate", toolNames: names });
const at = (h, x, y) => sim.heightAt(h, x, y);

describe("how big a cutter is", () => {
  it("reads the size out of the tool's comment however it's written", () => {
    expect(toolDia("1/2 FLAT ENDMILL")).toBe(0.5);
    expect(toolDia(".375 EM")).toBe(0.375);
    expect(toolDia("1-1/4 FACE MILL")).toBe(1.25);
    expect(toolDia("3/8-16 TAP")).toBe(0.375);
    near(toolDia("10MM DRILL"), 10 / 25.4);
    expect(toolDia("10MM DRILL", "mm")).toBe(10);
    expect(toolDia("6 ENDMILL", "mm")).toBeNull();          // no unit and no fraction: not sure enough
    expect(toolDia('2" FACE MILL')).toBe(2);
    expect(toolDia("#7 DRILL")).toBeNull();
    expect(toolDia("SPOT DRILL")).toBeNull();
    expect(toolDia("")).toBeNull();
  });

  it("reads a block out of the stock box, thinnest side as the thickness", () => {
    expect(parseBlock("4 x 3 x 0.5 plate")).toEqual({ long: 4, wide: 3, thick: 0.5 });
    expect(parseBlock("1/2 x 4 x 3 6061 bar")).toEqual({ long: 4, wide: 3, thick: 0.5 });
    expect(parseBlock("6061 plate, 3 x 4.25")).toEqual({ long: 4.25, wide: 3, thick: null });
    expect(parseBlock("plate")).toBeNull();
    expect(parseBlock("1.25 round bar")).toBeNull();
  });
});

describe("cutting the block", () => {
  it("starts flat at Z0 and ends cut where the tool went, to the depth it was at", () => {
    expect(sim.top).toBe(0);
    near(at(sim.heightsAt(0), 2, 1), 0);                  // nothing cut yet
    near(at(sim.final, 2, 1), -0.25);                     // the middle of the slot
    near(at(sim.final, 2, 1.2), -0.25);                   // inside the cutter's width
    near(at(sim.final, 2, 1.3), 0);                       // outside it
    near(at(sim.final, 0.8, 1), -0.25);                   // the rounded end of the slot, within a radius of X1
    near(at(sim.final, 0.7, 1), 0);
    near(at(sim.final, 2, 2), -0.6);                      // the drilled hole
    near(at(sim.final, 2, 2.2), 0);                       // a quarter inch drill, not a half
    near(at(sim.final, 0.5, 2.5), 0);                     // untouched
  });

  it("uses the stock size from the part, laid the long way along the longer cut", () => {
    expect(sim.sized).toBe(true);
    near(sim.x1 - sim.x0, 4);
    near(sim.y1 - sim.y0, 3);
    near(sim.top - sim.bottom, 0.75);
    expect(sim.notes.join(" ")).toMatch(/Where the block sits is fitted round the cuts/);
  });

  it("guesses the block when the part doesn't say, and says so", () => {
    const g = simulateMill(toolpath(PLATE), { toolNames: names });
    expect(g.sized).toBe(false);
    expect(g.x1 - g.x0).toBeGreaterThan(2.5);             // the slot plus the cutter, plus a little
    expect(g.top - g.bottom).toBeGreaterThan(0.6);        // deeper than the deepest cut
    expect(g.notes.join(" ")).toMatch(/block's size is a guess/);
    near(g.heightAt(g.final, 2, 1), -0.25);
  });

  it("a stated block that couldn't hold the cuts is not believed", () => {
    const g = simulateMill(toolpath(PLATE), { stockText: "0.5 x 0.5 x 0.25", toolNames: names });
    expect(g.sized).toBe(false);
  });

  it("draws a tool with no size in its comment at a guess, and says which", () => {
    const g = simulateMill(toolpath(PLATE), { toolNames: { 1: "ENDMILL", 2: "1/4 DRILL" } });
    expect(g.tools[1]).toMatchObject({ dia: 0.25, guessed: true });
    expect(g.tools[2]).toMatchObject({ dia: 0.25, guessed: false });
    expect(g.notes.join(" ")).toMatch(/No size in the comment for T1/);
  });

  it("knows the shape part way through, forwards and backwards", () => {
    const segs = toolpath(PLATE).segs;
    const slot = segs.findIndex((s) => s.type === "feed" && Math.abs(s.b[0] - 3) < 1e-9);   // the move along X
    near(at(sim.heightsAt(slot), 2, 1), 0);               // plunged at X1, not yet along
    near(at(sim.heightsAt(slot), 1, 1), -0.25);
    near(at(Float32Array.from(sim.heightsAt(slot, 0.5)), 1.5, 1), -0.25);   // half way along: cut behind the tool
    near(at(Float32Array.from(sim.heightsAt(slot, 0.5)), 2.6, 1), 0);       // and not ahead of it
    near(at(sim.heightsAt(slot + 1), 2.6, 1), -0.25);
    near(at(sim.heightsAt(slot), 2.6, 1), 0);             // stepping back
    near(at(sim.heightsAt(segs.length), 2, 2), -0.6);
  });

  it("follows the tool, with its size, part way along a move", () => {
    const segs = toolpath(PLATE).segs;
    const slot = segs.findIndex((s) => s.type === "feed" && Math.abs(s.b[0] - 3) < 1e-9);
    expect(sim.toolAt(0)).toBeNull();
    const t = sim.toolAt(slot, 0.5);
    near(t.x, 2); near(t.y, 1); near(t.z, -0.25);
    expect(t).toMatchObject({ tool: 1, dia: 0.5, type: "feed" });
    expect(sim.toolAt(segs.length)).toMatchObject({ tool: 2, dia: 0.25 });
  });

  it("a plunge part way down cuts only that deep", () => {
    const segs = toolpath(PLATE).segs;
    const plunge = segs.findIndex((s) => s.type === "feed" && Math.abs(s.b[2] + 0.25) < 1e-9 && Math.abs(s.a[0] - s.b[0]) < 1e-9);
    const half = at(Float32Array.from(sim.heightsAt(plunge, 0.5)), 1, 1);
    expect(half).toBeLessThanOrEqual(0);
    expect(half).toBeGreaterThan(-0.25);
  });

  it("gives nothing for a lathe program or one with no cuts", () => {
    expect(simulateMill(toolpath("O1\nG50 S3000\nT0101\nG96 S400 M03\nG00 X1. Z0.1\nG01 Z-1. F0.01\nM30\n"))).toBeNull();
    expect(simulateMill(toolpath("O1\nT1 M06\nG00 X1. Y1.\nG43 H01 Z1.\nM30\n"))).toBeNull();
  });

  it("coarsens the grid for a very long program rather than grinding", () => {
    const long = ["O2", "T1 M06 (2\" FACE MILL)", "G54 G00 X0. Y0.", "G43 H01 Z1.", "G01 Z-0.1 F50."];
    for (let i = 0; i < 14000; i++) long.push(`X${i % 2 ? 0 : 20}. Y${(i * 0.0014).toFixed(4)}`);
    long.push("G00 Z1.", "M30");
    const t0 = Date.now();
    const big = simulateMill(toolpath(long.join("\n")), { toolNames: { 1: '2" FACE MILL' } });
    expect(Date.now() - t0).toBeLessThan(4000);
    expect(big.nx).toBeLessThan(200);
    expect(big.notes.join(" ")).toMatch(/drawn a little coarser/);
    near(big.heightAt(big.final, 10, 10), -0.1);
  });
});
