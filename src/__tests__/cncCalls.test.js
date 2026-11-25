// @vitest-environment node
import { describe, it, expect } from "vitest";
import { followCalls, parseLines } from "../floor/cncGcode.js";
import { toolpath } from "../floor/cncPath.js";
import { simulateLathe, partSizes } from "../floor/cncSolid.js";

// The ST-10Y's programs (photo, 2026-11-25) run the real program as a local
// sub-program after the M30:
//   (***RUN 21 PARTS THEN STOP***)
//   M97 P1000 L21 (call the real program 21 times)
//   M30
// Before this, everything after the M30 went unread: no 3D, no sizes, no checks.
const PROG = `%
O07113 (PIN)
(***RUN 21 PARTS THEN STOP***)
M97 P1000 L21 (call the real program 21 times)
M30 (stop after 21 parts)
N1000
G20 G99
M97 P2000
T0101 (CNMG 332)
G50 S3000
G96 S400 M03
G54 G00 X1.35 Z0.1 M08
G01 X0.625 F0.006
Z-1.
G00 X1.4
M97 P2000
M99
N2000 (TOOL CHANGE)
G28 U0. W0.
M99
%`;

describe("local sub-programs (M97)", () => {
  it("are followed in the order the machine runs them, keeping each line's own number", () => {
    const { lines, followed } = followCalls(parseLines(PROG));
    expect(followed).toBe(3);   // the part, and the tool change twice
    expect(lines.map((l) => l.n)).toEqual([2, 3, 4, 6, 7, 8, 18, 19, 9, 10, 11, 12, 13, 14, 15, 16, 18, 19, 5]);
  });
  it("so the program after the M30 is drawn, measured and checked", () => {
    const path = toolpath(PROG);
    expect(path.kind).toBe("lathe");
    expect(path.tools).toEqual([1]);
    expect(path.calls).toBe(3);
    expect(path.opaque).toEqual([]);
    expect(path.notes.join(" ")).toMatch(/Sub-program calls \(M97\) are followed/);
    const sim = simulateLathe(path, { dia: 1.25 });
    const sizes = partSizes(sim);
    expect(sizes.steps.some((s) => Math.abs(s.dia - 0.625) < 1e-3)).toBe(true);
  });
  it("a call to an N number that isn't in the file, or another program (M98), is left unfollowed and says so", () => {
    const path = toolpath("%\nO1\nG20\nM97 P5000\nM98 P1234\nT0101\nG00 X1. Z0.1\nG01 X0.5 F0.005\nM30\n%");
    expect(path.opaque).toEqual(["M97P5000", "M98P1234"]);
    expect(path.notes.join(" ")).toMatch(/whose N number isn't in the file/);
    expect(path.notes.join(" ")).toMatch(/M98, G65/);
  });
  it("a sub-program that calls itself doesn't run forever", () => {
    const { lines } = followCalls(parseLines("O1\nM97 P100\nM30\nN100\nG01 X1.\nM97 P100\nM99"));
    expect(lines.length).toBeLessThan(30);
  });
});
