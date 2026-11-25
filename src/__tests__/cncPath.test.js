// @vitest-environment node
import { describe, it, expect } from "vitest";
import { toolpath, arcCenterFromR, arcPoints, project, boundsOf, VIEWS } from "../floor/cncPath.js";
import { checkProgram } from "../floor/cncGcode.js";

// The tool path drawing. Every shape here has an answer that can be worked out
// by hand, so a wrong arc direction or a move to the wrong place fails a test
// rather than showing up as a picture nobody questions.

const near = (a, b, tol = 1e-6) => expect(Math.abs(a - b)).toBeLessThan(tol);
const nearPt = (p, q, tol = 1e-6) => q.forEach((v, i) => near(p[i], v, tol));
const cuts = (path) => path.segs.filter((s) => s.type !== "rapid");

describe("mill moves", () => {
  it("draws nothing until X, Y and Z are all known, then rapids and cuts in order", () => {
    const p = toolpath("O1\nT1 M06\nG54 G00 X1. Y2.\nG43 H01 Z1.\nG01 Z-0.25 F10.\nX3.\nG00 Z1.\nM30\n");
    expect(p.kind).toBe("mill");
    expect(p.segs.map((s) => s.type)).toEqual(["feed", "feed", "rapid"]);
    nearPt(p.segs[0].a, [1, 2, 1]);
    nearPt(p.segs[0].b, [1, 2, -0.25]);
    nearPt(p.segs[1].b, [3, 2, -0.25]);
    nearPt(p.segs[2].b, [3, 2, 1]);
    expect(p.segs[1].line).toBe(6);
    expect(p.segs.every((s) => s.tool === 1)).toBe(true);
  });

  it("follows incremental moves (G91) from where the tool is", () => {
    const p = toolpath("O1\nT1 M06\nG90 G00 X1. Y1. Z0.5\nG91 G01 X2. F5.\nY-1.\nG90 X0.\nM30\n");
    nearPt(p.segs[0].b, [3, 1, 0.5]);
    nearPt(p.segs[1].b, [3, 0, 0.5]);
    nearPt(p.segs[2].b, [0, 0, 0.5]);
  });

  it("lifts the pen for a move to machine home instead of drawing a line to nowhere", () => {
    const p = toolpath("O1\nT1 M06\nG00 X1. Y1. Z1.\nG01 Z0. F5.\nG28 G91 Z0.\nG90 G00 X5. Y5.\nG43 H01 Z1.\nG01 Z0. F5.\nM30\n");
    // one plunge, then after home: nothing until Z is known again, then one more plunge
    expect(cuts(p)).toHaveLength(2);
    nearPt(cuts(p)[1].a, [5, 5, 1]);
    expect(p.segs.some((s) => s.b[2] > 1.0001 || s.a[2] > 1.0001)).toBe(false);
  });

  it("G02 is clockwise and G03 counter-clockwise in the XY plane (I/J centre)", () => {
    // from (1,0) to (0,1) round the origin: counter-clockwise is the short way
    const ccw = toolpath("O1\nT1 M06\nG00 X1. Y0. Z0.\nG03 X0. Y1. I-1. J0. F5.\nM30\n");
    const cw = toolpath("O1\nT1 M06\nG00 X1. Y0. Z0.\nG02 X0. Y1. I-1. J0. F5.\nM30\n");
    // every point of both stays on the unit circle
    for (const s of [...ccw.segs, ...cw.segs]) near(Math.hypot(s.b[0], s.b[1]), 1, 1e-9);
    // the short way stays in the first quadrant; the long way goes through (0,-1)
    expect(ccw.segs.every((s) => s.b[0] >= -1e-9 && s.b[1] >= -1e-9)).toBe(true);
    expect(cw.segs.some((s) => s.b[1] < -0.99)).toBe(true);
    expect(cw.segs.length).toBeGreaterThan(ccw.segs.length * 2);
    nearPt(ccw.segs.at(-1).b, [0, 1, 0]);
    nearPt(cw.segs.at(-1).b, [0, 1, 0]);
  });

  it("an R arc puts its centre on the correct side, and a negative R goes the long way", () => {
    // The textbook case: clockwise from 12 o'clock (0,1) to 3 o'clock (1,0) is
    // a quarter circle round the origin.
    nearPt(arcCenterFromR([0, 1], [1, 0], 1, true), [0, 0]);
    // (0,0) to (1,1), R1. Heading north-east, a clockwise arc's centre is on the
    // right: (1,0). Counter-clockwise it's on the left: (0,1).
    nearPt(arcCenterFromR([0, 0], [1, 1], 1, true), [1, 0]);
    nearPt(arcCenterFromR([0, 0], [1, 1], 1, false), [0, 1]);
    nearPt(arcCenterFromR([0, 0], [1, 1], -1, true), [0, 1]);   // negative R: the other centre, the long way
    expect(arcCenterFromR([0, 0], [0, 0], 1, true)).toBeNull();
    const p = toolpath("O1\nT1 M06\nG00 X0. Y1. Z0.\nG02 X1. Y0. R1. F5.\nM30\n");
    for (const s of p.segs) near(Math.hypot(s.b[0], s.b[1]), 1, 1e-9);
    expect(p.segs.every((s) => s.b[0] >= -1e-9 && s.b[1] >= -1e-9)).toBe(true);  // stays in the first quarter
    // and the long way round with a negative R leaves that quarter
    const long = toolpath("O1\nT1 M06\nG00 X0. Y1. Z0.\nG02 X1. Y0. R-1. F5.\nM30\n");
    expect(long.segs.length).toBeGreaterThan(p.segs.length * 2);
  });

  it("a full circle (start = end) is drawn all the way round", () => {
    const pts = arcPoints([1, 0], [1, 0], [0, 0], true);
    expect(pts.length).toBeGreaterThanOrEqual(48);
    nearPt(pts.at(-1), [1, 0]);
    expect(pts.some((q) => q[0] < -0.99)).toBe(true);
  });

  it("a full circle written with only I (no end point) is still drawn", () => {
    const p = toolpath("O1\nT1 M06\nG00 X2.5 Y1.5 Z0.1\nG01 Z-0.1 F5.\nG03 I-0.5 F10.\nG00 Z1.\nM30\n");
    const arc = p.segs.filter((s) => s.line === 5);
    expect(arc.length).toBeGreaterThanOrEqual(48);
    for (const s of arc) near(Math.hypot(s.b[0] - 2, s.b[1] - 1.5), 0.5, 1e-9);
    nearPt(arc.at(-1).b, [2.5, 1.5, -0.1]);
    expect(p.stats.x).toEqual([1.5, 2.5]);
  });

  it("a helix ramps Z evenly along the arc", () => {
    const p = toolpath("O1\nT1 M06\nG00 X1. Y0. Z0.\nG03 X-1. Y0. I-1. J0. Z-0.5 F5.\nM30\n");
    near(p.segs.at(-1).b[2], -0.5);
    const zs = p.segs.map((s) => s.b[2]);
    expect(zs.every((z, i) => i === 0 || z < zs[i - 1])).toBe(true);
  });

  it("drills a hole at every position of a drilling cycle, to depth and back", () => {
    const p = toolpath("O1\nT2 M06\nG00 X1. Y1.\nG43 H02 Z1.\nG99 G81 Z-0.5 R0.1 F5.\nX2.\nX3. Y2.\nG80\nG00 Z1.\nM30\n");
    const holes = cuts(p);
    expect(holes).toHaveLength(3);
    expect(holes.map((s) => [s.a[0], s.a[1]])).toEqual([[1, 1], [2, 1], [3, 2]]);
    for (const h of holes) { near(h.a[2], 0.1); near(h.b[2], -0.5); }
    // G99: between holes the tool sits at the R plane, not back at Z1
    const between = p.segs.find((s) => s.type === "rapid" && s.a[0] === 1 && s.b[0] === 2);
    near(between.a[2], 0.1);
  });

  it("G98 comes back to where the cycle started; G80 ends it", () => {
    const p = toolpath("O1\nT2 M06\nG00 X1. Y1.\nG43 H02 Z1.\nG98 G83 Z-0.5 R0.1 Q0.1 F5.\nX2.\nG80\nG01 X5. F10.\nM30\n");
    const between = p.segs.find((s) => s.type === "rapid" && s.a[0] === 1 && s.b[0] === 2);
    near(between.a[2], 1);
    // after G80 the X5 move is a plain cut at Z1, not another hole
    const last = p.segs.at(-1);
    expect(last.type).toBe("feed");
    nearPt(last.b, [5, 1, 1]);
  });

  it("reads a program typed with no spaces", () => {
    const p = toolpath("O1\nT1M06\nG00X1.Y1.Z1.\nG01Z-.1F5.\nX2.\nM30\n");
    expect(cuts(p)).toHaveLength(2);
    nearPt(p.segs.at(-1).b, [2, 1, -0.1]);
  });

  it("says what it measured: how far the cutting moves reach", () => {
    const p = toolpath("O1\nT1 M06\nG00 X0. Y0. Z5.\nG01 Z-0.25 F5.\nX3.\nY2.\nG00 Z5.\nM30\n");
    expect(p.stats).toMatchObject({ kind: "mill", x: [0, 3], y: [0, 2], zMin: -0.25, cuts: 3, rapids: 1 });
    expect(p.tools).toEqual([1]);
  });
});

describe("lathe moves", () => {
  it("X is a diameter: the drawing uses the radius, with Z along the part", () => {
    const p = toolpath("O1\nT0101\nG00 X1. Z0.1\nG01 Z-2. F0.01\nX1.5\nM30\n");
    expect(p.kind).toBe("lathe");
    nearPt(p.segs[0].a, [0.1, 0, 0.5]);
    nearPt(p.segs[0].b, [-2, 0, 0.5]);
    nearPt(p.segs[1].b, [-2, 0, 0.75]);
    expect(p.stats).toMatchObject({ kind: "lathe", maxDia: 1.5, minDia: 1, zMin: -2 });
  });

  it("U and W move from where the tool is (U is a diameter too)", () => {
    const p = toolpath("O1\nT0101\nG00 X1. Z0.\nG01 W-1. F0.01\nU0.5\nM30\n");
    nearPt(p.segs[0].b, [-1, 0, 0.5]);
    nearPt(p.segs[1].b, [-1, 0, 0.75]);
  });

  it("a front corner radius (G03) bulges outward and a shoulder fillet (G02) hollows inward", () => {
    // Convex: face at X0.75 Z0 round to X1.0 Z-0.125. Centre is inside the part.
    const convex = toolpath("O1\nT0101\nG00 X0.75 Z0.\nG03 X1. Z-0.125 R0.125 F0.01\nM30\n");
    for (const s of convex.segs) near(Math.hypot(s.b[0] - -0.125, s.b[2] - 0.375), 0.125, 1e-9);
    // halfway round, the arc is further OUT than the straight chord between its ends
    const midC = convex.segs[Math.floor(convex.segs.length / 2) - 1].b;
    expect(Math.hypot(midC[0] - -0.0625, midC[2] - 0.4375)).toBeGreaterThan(0.01);
    expect(midC[2] - 0.375).toBeGreaterThan(0);

    // Concave: along X1.0 to Z-1.0, fillet up to X1.25 Z-1.125. Centre is in the air.
    const concave = toolpath("O1\nT0101\nG00 X1. Z-1.\nG02 X1.25 Z-1.125 R0.125 F0.01\nM30\n");
    for (const s of concave.segs) near(Math.hypot(s.b[0] - -1, s.b[2] - 0.625), 0.125, 1e-9);
  });

  it("an arc given by I and K uses I as a radius amount", () => {
    const p = toolpath("O1\nT0101\nG00 X0.75 Z0.\nG03 X1. Z-0.125 I0. K-0.125 F0.01\nM30\n");
    for (const s of p.segs) near(Math.hypot(s.b[0] - -0.125, s.b[2] - 0.375), 0.125, 1e-9);
  });

  it("a roughing cycle is drawn as its profile, and says so", () => {
    const p = toolpath("O1\nG50 S3000\nT0101\nG96 S400 M03\nG00 X1.3 Z0.1\nG71 P10 Q20 U0.02 W0.005 D0.08 F0.012\nN10 G00 X0.5\nG01 Z-1.\nN20 X1.25 Z-1.5\nG70 P10 Q20\nG00 X2. Z1.\nM30\n");
    expect(p.segs.filter((s) => s.type === "profile")).toHaveLength(2);   // the two lines of the shape
    expect(p.segs[0].type).toBe("rapid");                                 // N10 is the approach, not the shape
    expect(p.stats).toMatchObject({ maxDia: 1.25, minDia: 0.5 });         // so the start point (X1.3) isn't "cut"
    expect(p.segs.at(-1).type).toBe("rapid");            // after N20 the profile is over
    expect(p.notes.join(" ")).toMatch(/drawn as the profile it cuts down to/);
    // the G71 line's own U and W are allowances, not moves
    expect(p.segs.some((s) => Math.abs(s.b[2] - (1.3 + 0.02) / 2) < 1e-9)).toBe(false);
  });

  it("draws a thread where the threading cycle cuts it, and leaves the tool where it was", () => {
    const p = toolpath("O1\nT0505\nG97 S800 M03\nG00 X0.6 Z0.2\nG76 X0.43 Z-1. K0.04 D0.01 F0.0625\nG00 X2.\nM30\n");
    const th = p.segs.filter((s) => s.type === "thread");
    expect(th).toHaveLength(1);
    nearPt(th[0].a, [0.2, 0, 0.215]);
    nearPt(th[0].b, [-1, 0, 0.215]);
    nearPt(p.segs.at(-1).a, [0.2, 0, 0.3]);               // the rapid starts from the pre-thread position
  });

  it("lifts the pen for G28 and warns about what it can't draw", () => {
    const p = toolpath("O1\nT0101\nG00 X1. Z0.\nG01 Z-1. F0.01\nG28 U0 W0\nT0202\nG00 X0.5 Z0.1\nG01 Z-0.5 F0.01\nM133 P500\nG01 C90.\nM30\n");
    expect(cuts(p)).toHaveLength(2);
    expect(p.segs.some((s) => s.type === "rapid")).toBe(false);  // no line drawn from home
    expect(p.tools).toEqual([1, 2]);
    expect(p.notes.join(" ")).toMatch(/Live tooling/);
  });
});

describe("looking at it", () => {
  it("the views look the way their names say", () => {
    const v = Object.fromEntries(VIEWS.mill.map((x) => [x.key, x]));
    const at = (key, p) => project(p, v[key].yaw, v[key].pitch);
    // Top: X across, Y up the screen, Z invisible
    nearPt(at("top", [1, 2, 9]), [1, 2]);
    // Front: X across, Z up, Y invisible
    nearPt(at("front", [1, 9, 3]), [1, 3]);
    // Side: Y across, Z up, X invisible
    nearPt(at("side", [9, 2, 3]), [2, 3]);
    // Lathe side: Z across, radius up
    const lv = VIEWS.lathe.find((x) => x.key === "side");
    nearPt(project([-2, 0, 0.5], lv.yaw, lv.pitch), [-2, 0.5]);
  });

  it("handles an empty or move-less program without falling over", () => {
    for (const text of ["", "%\n%\n", "O1\n(JUST A COMMENT)\nM30\n", "#100=5\nIF[#100EQ5]GOTO10\n"]) {
      const p = toolpath(text);
      expect(p.segs).toEqual([]);
      expect(p.bounds).toBeNull();
      expect(p.stats).toBeNull();
    }
    expect(boundsOf([])).toBeNull();
  });
});

describe("the missing decimal point", () => {
  const texts = (f) => f.map((x) => x.text).join(" | ");
  it("flags a whole-number position, names it, and ignores zero", () => {
    const f = checkProgram("O1\nG20 G40 G49 G80\nT1 M06\nG54 G00 X0 Y0 S1000 M03 M08\nG43 H01 Z1.\nG01 Z-1 F5.\nX2\nM30\n", { machineKind: "mill" });
    expect(texts(f)).toMatch(/2 positions have no decimal point \(Z-1 on line 6, X2 on line 7\)/);
  });
  it("says nothing when every position has its point", () => {
    const f = checkProgram("O1\nG20 G40 G49 G80\nT1 M06\nG54 G00 X0. Y0. S1000 M03 M08\nG43 H01 Z1.\nG01 Z-1. F5.\nM30\n", { machineKind: "mill" });
    expect(texts(f)).not.toMatch(/decimal point/);
  });
});
