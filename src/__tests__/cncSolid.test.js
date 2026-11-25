// @vitest-environment node
import { describe, it, expect } from "vitest";
import { toolpath } from "../floor/cncPath.js";
import { simulateLathe, outlinePoints, simplifyOutline, parseStock, metalFor, partSizes, sizeText, sizeLabel, zText } from "../floor/cncSolid.js";
import { estimateTime, fmtDuration, playClock } from "../floor/cncTime.js";

// The solid part and the rapid check. Each program here is small enough to
// work out by hand, so the numbers are the test.

const near = (a, b, tol = 1e-3) => expect(Math.abs(a - b)).toBeLessThan(tol);

// A stepped pin: 0.625 dia for the first inch, 1.125 dia for the next two.
const PIN = `O1
G50 S3000
T0101
G96 S400 M03
G00 X1.35 Z0.1 M08
G71 P10 Q20 U0.02 W0.005 D0.08 F0.012
N10 G00 X0.625
G01 Z-1. F0.006
X1.125
Z-3.
N20 X1.3
G70 P10 Q20
G00 X2. Z1.
M30
`;

describe("the stock box", () => {
  it("reads a diameter and a length however they're written", () => {
    expect(parseStock('1.25" round bar, cut 3.1" long')).toMatchObject({ dia: 1.25, len: 3.1 });
    expect(parseStock("1-1/4 bar")).toMatchObject({ dia: 1.25, len: null });
    expect(parseStock("3/4 x 6")).toMatchObject({ dia: 0.75, len: 6 });
    expect(parseStock("1 1/2 round")).toMatchObject({ dia: 1.5 });
    expect(parseStock("32mm rod")).toMatchObject({ dia: 32, mm: true });
    expect(parseStock(".5 dia")).toMatchObject({ dia: 0.5 });
    expect(parseStock("round bar")).toBeNull();
    expect(parseStock("")).toBeNull();
  });
});

describe("cutting the bar", () => {
  const sim = simulateLathe(toolpath(PIN), { dia: 1.25, len: null });

  it("starts as the bar and ends as the part", () => {
    expect(sim.stockR).toBe(0.625);
    expect(sim.face).toBe(0);
    near(sim.radiusAt(sim.outlineAt(0), -0.5), 0.625);       // nothing cut yet: full bar
    near(sim.radiusAt(sim.final, -0.5), 0.3125);              // 0.625 dia
    near(sim.radiusAt(sim.final, -2), 0.5625);                // 1.125 dia
    near(sim.radiusAt(sim.final, -3.4), 0.625);               // past the cut: still bar
  });

  it("keeps a shoulder square", () => {
    near(sim.radiusAt(sim.final, -0.999), 0.3125, 2e-3);
    near(sim.radiusAt(sim.final, -1.001), 0.5625, 2e-3);
  });

  it("knows the shape part way through the program, forwards and backwards", () => {
    const segs = toolpath(PIN).segs;
    const firstCut = segs.findIndex((s) => s.type === "profile") + 1;   // after the first pass along 0.625
    near(sim.radiusAt(sim.outlineAt(firstCut), -0.5), 0.3125);
    near(sim.radiusAt(sim.outlineAt(firstCut), -2), 0.625);              // the big diameter isn't cut yet
    near(sim.radiusAt(sim.outlineAt(segs.length), -2), 0.5625);          // forward to the end
    near(sim.radiusAt(sim.outlineAt(firstCut), -2), 0.625);              // and back again
  });

  it("the outline to spin closes on the centre at both ends and runs chuck to face", () => {
    const pts = outlinePoints(sim);
    expect(pts[0]).toEqual([sim.back, 0]);
    expect(pts.at(-1)).toEqual([0, 0]);
    expect(pts.every((p, i) => i === 0 || p[0] >= pts[i - 1][0] - 1e-9)).toBe(true);
    expect(pts.every((p) => p[1] >= 0 && p[1] <= 0.625 + 1e-9)).toBe(true);
  });

  it("the outline thins down to its corners without changing the shape", () => {
    const full = outlinePoints(sim);
    const thin = simplifyOutline(full);
    expect(thin.length).toBeLessThan(40);
    expect(full.length).toBeGreaterThan(500);
    // every corner of the part survives
    for (const [z, r] of [[-1, 0.3125], [-1, 0.5625], [-3, 0.5625]]) {
      expect(thin.some((p) => Math.abs(p[0] - z) < 1e-3 && Math.abs(p[1] - r) < 1e-6)).toBe(true);
    }
    expect(thin[0]).toEqual(full[0]);
    expect(thin.at(-1)).toEqual(full.at(-1));
    expect(simplifyOutline([[0, 0], [1, 1]])).toEqual([[0, 0], [1, 1]]);
  });

  it("a good program has no rapid through the bar", () => {
    expect(sim.collisions).toEqual([]);
  });

  it("guesses the bar from the program when no stock is given, and says so", () => {
    const g = simulateLathe(toolpath(PIN), null);
    expect(g.guessed).toBe(true);
    near(g.stockR, 0.65);                                      // the profile runs out to X1.3
    expect(g.notes.join(" ")).toMatch(/bar size is a guess/);
  });

  it("gives nothing for a mill program or one with no cuts", () => {
    expect(simulateLathe(toolpath("O1\nT1 M06\nG00 X0 Y0 Z1.\nG01 Z-.1 F5.\nM30\n"))).toBeNull();
    expect(simulateLathe(toolpath("O1\nT0101\nG00 X1. Z1.\nM30\n"))).toBeNull();
  });
});

describe("a rapid through the bar", () => {
  it("is caught, with the line and how deep", () => {
    // After turning the front inch down, the tool rapids to Z-2 at X0.8: that's
    // inside the 1.25 bar, which is still full size there.
    const bad = "O1\nT0101\nG97 S1000 M03\nG00 X0.625 Z0.1\nG01 Z-1. F0.006\nG00 X0.8 Z-2.\nM30\n";
    const sim = simulateLathe(toolpath(bad), { dia: 1.25 });
    expect(sim.collisions).toHaveLength(1);
    expect(sim.collisions[0].line).toBe(6);
    // Deepest just past the shoulder at Z-1: the tool is still near 0.3125
    // radius there and the bar is the full 0.625.
    near(sim.collisions[0].depth, 0.625 - 0.3125, 5e-3);
    near(sim.collisions[0].z, -1, 0.02);
  });

  it("a rapid through where the metal has ALREADY been cut away is fine", () => {
    const ok = "O1\nT0101\nG97 S1000 M03\nG00 X0.625 Z0.1\nG01 Z-1. F0.006\nG00 X0.7 Z0.1\nG00 X0.65 Z-0.9\nM30\n";
    expect(simulateLathe(toolpath(ok), { dia: 1.25 }).collisions).toEqual([]);
  });

  it("order matters: the same move before the cut is a crash, after it is not", () => {
    const before = "O1\nT0101\nG97 S1000 M03\nG00 X1.4 Z0.1\nG00 X0.65 Z-0.9\nG00 X1.4 Z0.1\nG00 X0.625\nG01 Z-1. F0.006\nM30\n";
    expect(simulateLathe(toolpath(before), { dia: 1.25 }).collisions.map((c) => c.line)).toEqual([5, 6]);
  });

  it("a tool standing on the shoulder it just cut is touching it, not crashing into it", () => {
    // cut to Z-1, then rapid straight out in X from exactly Z-1
    const out = "O1\nT0101\nG97 S1000 M03\nG00 X0.625 Z0.1\nG01 Z-1. F0.006\nG00 X1.4\nG00 Z0.1\nM30\n";
    expect(simulateLathe(toolpath(out), { dia: 1.25 }).collisions).toEqual([]);
  });

  it("moving in front of the face, or straight down it, is not a crash", () => {
    const facing = "O1\nT0101\nG97 S1000 M03\nG00 X1.4 Z0.1\nG00 X-0.03\nG00 X1.4\nG00 Z0.\nG01 X-0.03 F0.005\nG00 X1.4\nG00 Z0.1\nG00 X0.625\nG01 Z-1. F0.006\nM30\n";
    expect(simulateLathe(toolpath(facing), { dia: 1.25 }).collisions).toEqual([]);
  });

  it("straight down into the bar away from the face is a crash", () => {
    const plunge = "O1\nT0101\nG97 S1000 M03\nG00 X0.625 Z0.1\nG01 Z-1. F0.006\nG00 X1.4\nG00 Z-1.5\nG00 X0.5\nG01 Z-2. F0.006\nM30\n";
    const sim = simulateLathe(toolpath(plunge), { dia: 1.25 });
    expect(sim.collisions.map((c) => c.line)).toEqual([8]);
    near(sim.collisions[0].depth, 0.625 - 0.25, 5e-3);
  });
});

describe("grooves, threads and holes", () => {
  it("a groove is cut to its depth across a typical insert width", () => {
    const g = "O1\nT0101\nG97 S1000 M03\nG00 X1.125 Z0.1\nG01 Z-2. F0.006\nG00 X1.3\nT0303\nG00 X1.2 Z-1.\nG75 X0.8 I0.05 F0.003\nM30\n";
    const sim = simulateLathe(toolpath(g), { dia: 1.25 });
    near(sim.radiusAt(sim.final, -1), 0.4);
    near(sim.radiusAt(sim.final, -1.05), 0.4);
    near(sim.radiusAt(sim.final, -1.2), 0.5625);
    expect(sim.notes.join(" ")).toMatch(/Groove width is a guess/);
  });

  it("a thread shows as teeth between the surface and its root, only once it's been cut", () => {
    const t = "O1\nT0101\nG97 S1000 M03\nG00 X0.625 Z0.1\nG01 Z-1.2 F0.006\nG00 X1.3\nT0505\nG00 X0.7 Z0.2\nG76 X0.555 Z-0.8 K0.035 D0.012 F0.0625\nM30\n";
    const path = toolpath(t);
    const sim = simulateLathe(path, { dia: 1.25 });
    expect(sim.threads).toHaveLength(1);
    near(sim.threads[0].pitch, 0.0625);
    const band = (pts) => pts.filter((p) => p[0] > -0.75 && p[0] < -0.05);
    const cutAll = band(outlinePoints(sim));
    const roots = cutAll.filter((p) => Math.abs(p[1] - 0.2775) < 1e-6).length;
    const crests = cutAll.filter((p) => Math.abs(p[1] - 0.3125) < 1e-6).length;
    expect(roots).toBeGreaterThan(5);
    expect(crests).toBeGreaterThan(5);
    const threadIndex = path.segs.findIndex((s) => s.type === "thread");
    const before = band(outlinePoints(sim, threadIndex));
    expect(before.every((p) => Math.abs(p[1] - 0.3125) < 1e-6)).toBe(true);     // still plain before the thread
  });

  it("drilling on centre isn't mistaken for turning the part down to nothing", () => {
    const d = "O1\nT0101\nG97 S1000 M03\nG00 X1.125 Z0.1\nG01 Z-1. F0.006\nG00 X1.3 Z0.1\nT0202\nG00 X0. Z0.1\nG01 Z-0.8 F0.004\nG00 Z0.1\nM30\n";
    const sim = simulateLathe(toolpath(d), { dia: 1.25 });
    near(sim.radiusAt(sim.final, -0.5), 0.5625);
    expect(sim.bore).toBe(true);
    expect(sim.notes.join(" ")).toMatch(/Holes and bores aren't shown/);
  });
});

describe("what it's made of", () => {
  it("picks a metal from the material box", () => {
    expect(metalFor("6061-T6 aluminum").name).toBe("aluminium");
    expect(metalFor("1018 steel").name).toBe("steel");
    expect(metalFor("303 stainless").name).toBe("stainless steel");
    expect(metalFor("360 brass").name).toBe("brass");
    expect(metalFor("black delrin").name).toBe("plastic");
    expect(metalFor("").name).toBe("steel");
  });
});

describe("about how long it runs", () => {
  it("times a mill cut as distance over feed, and rapids at a typical rate", () => {
    // 10 inches at 20 in/min = 30 s. One 2 in rapid at 500 in/min = 0.24 s + settle.
    const t = estimateTime(toolpath("O1\nT1 M06\nG00 X0. Y0. Z1.\nG01 X10. F20.\nG00 Z3.\nM30\n"));
    near(t.parts.cutting, 30);
    near(t.parts.rapids, 0.24 + 0.12);
    near(t.parts.toolChanges, 6);
    expect(t.unknown).toBe(0);
  });

  it("a lathe cut uses feed per turn and the spindle speed", () => {
    // G97 S1000, F0.01 per turn = 10 in/min. 2 inches = 12 s.
    const t = estimateTime(toolpath("O1\nT0101\nG97 S1000 M03\nG00 X1. Z0.\nG01 Z-2. F0.01\nM30\n"));
    near(t.parts.cutting, 12);
  });

  it("constant surface speed works the rpm out from the diameter, under the limit", () => {
    // 400 ft/min at 1 inch dia = 1528 rpm. F0.01 -> 15.28 in/min. 2 in = 7.85 s.
    const t = estimateTime(toolpath("O1\nG50 S3000\nT0101\nG96 S400 M03\nG00 X1. Z0.\nG01 Z-2. F0.01\nM30\n"));
    near(t.parts.cutting, (2 / (0.01 * ((400 * 12) / Math.PI))) * 60, 0.01);
    // at a tiny diameter the limit holds it to 3000 rpm: 30 in/min, 2 in = 4 s
    const small = estimateTime(toolpath("O1\nG50 S3000\nT0101\nG96 S400 M03\nG00 X0.1 Z0.\nG01 Z-2. F0.01\nM30\n"));
    near(small.parts.cutting, 4);
  });

  it("estimates a roughing cycle's passes, and counts the finishing pass once", () => {
    const path = toolpath(PIN);
    const t = estimateTime(path);
    expect(path.cycles.filter((c) => c.kind === "rough")).toHaveLength(1);
    expect(path.cycles[0].depth).toBe(0.08);
    expect(t.parts.roughing).toBeGreaterThan(5);     // several passes over up to 3 inches
    expect(t.parts.roughing).toBeLessThan(120);
    expect(t.parts.cutting).toBeGreaterThan(1);      // the G70 pass
    expect(t.seconds).toBeGreaterThan(t.parts.roughing);
  });

  it("times a thread as several passes", () => {
    const t = estimateTime(toolpath("O1\nT0505\nG97 S800 M03\nG00 X0.7 Z0.2\nG76 X0.555 Z-0.8 K0.035 D0.012 F0.0625\nM30\n"));
    // (0.035/0.012)^2 = 8.5 -> 9 + 2 = 11 passes; each 1 inch at 0.0625 x 800 = 50 in/min = 1.2 s plus the return
    near(t.parts.threading, 11 * (1.2 + 0.12 + 0.8), 0.05);
  });

  it("counts dwells and operator stops, and owns up to what it couldn't time", () => {
    const t = estimateTime(toolpath("O1\nT1 M06\nG00 X0. Y0. Z1.\nG04 P2500\nG01 X1.\nM00\nG01 X2. F10.\nM30\n"));
    near(t.parts.dwell, 2.5);
    expect(t.stops).toBe(1);
    expect(t.unknown).toBe(1);        // the first cut has no feed
  });

  it("writes a time the way a person would say it", () => {
    expect(fmtDuration(45)).toBe("45 s");
    expect(fmtDuration(160)).toBe("2 min 40 s");
    expect(fmtDuration(120)).toBe("2 min");
    expect(fmtDuration(3900)).toBe("1 h 5 min");
    expect(estimateTime(toolpath(""))).toBeNull();
  });
});

describe("the sizes of what's been cut", () => {
  const sim = simulateLathe(toolpath(PIN), { dia: 1.25, len: null });

  it("gives each diameter, where it runs and how long, from the face back", () => {
    const s = partSizes(sim);
    near(s.length, 3);
    expect(s.steps.length).toBe(2);
    near(s.steps[0].dia, 0.625); near(s.steps[0].z1, 0); near(s.steps[0].z0, -1); near(s.steps[0].len, 1);
    near(s.steps[1].dia, 1.125); near(s.steps[1].z1, -1); near(s.steps[1].z0, -3); near(s.steps[1].len, 2);
    expect(s.steps.every((x) => !x.uncut && !x.groove && !x.thread)).toBe(true);
  });

  it("follows the program: before anything is cut the only size is the bar's", () => {
    const s = partSizes(sim, 0);
    expect(s.steps.length).toBe(1);
    near(s.steps[0].dia, 1.25);
    expect(s.steps[0].uncut).toBe(true);
  });

  it("doesn't read the bar in the chuck as part of the part", () => {
    for (const x of partSizes(sim).steps) expect(x.z0).toBeGreaterThan(-3.001);
  });

  it("gives no diameter for a taper or a chamfer", () => {
    const TAPER = "O3\nT0101\nG97 S800 M03\nG00 X1.1 Z0.1\nG01 X0.4 Z0. F0.006\nX0.5 Z-0.05\nZ-1.\nX1. Z-2.\nZ-2.5\nG00 X2. Z1.\nM30\n";
    const s = partSizes(simulateLathe(toolpath(TAPER, { kind: "lathe" }), { dia: 1, len: null }));
    expect(s.steps.map((x) => Number(x.dia.toFixed(3)))).toEqual([0.5, 1]);
    near(s.steps[0].len, 0.95);   // from the end of the chamfer to the start of the taper
    near(s.steps[1].len, 0.5);
  });

  it("a groove gives its diameter but no width", () => {
    const g = "O1\nT0101\nG97 S1000 M03\nG00 X1.125 Z0.1\nG01 Z-2. F0.006\nG00 X1.3\nT0303\nG00 X1.2 Z-1.\nG75 X0.8 I0.05 F0.003\nM30\n";
    const s = partSizes(simulateLathe(toolpath(g), { dia: 1.25 }));
    const groove = s.steps.filter((x) => x.groove);
    expect(groove).toHaveLength(1);
    near(groove[0].dia, 0.8);
    expect(groove[0].len).toBeNull();
    // the diameter it's cut into is still ONE diameter, the full two inches, not two short ones
    const turned = s.steps.filter((x) => !x.groove);
    expect(turned).toHaveLength(1);
    near(turned[0].dia, 1.125);
    near(turned[0].len, 2, 1e-9);
    expect(turned[0].approx).toBe(false);
  });

  it("sizes come from the corners themselves, exact to the program", () => {
    const p = "O5\nT0101\nG97 S800 M03\nG00 X1.1 Z0.1\nG01 X0.625 F0.006\nZ-0.775\nX0.9\nZ-2.8\nG00 X2. Z1.\nM30\n";
    const s = partSizes(simulateLathe(toolpath(p, { kind: "lathe" }), { dia: 1, len: null }));
    expect(s.steps.map((x) => sizeText(x.len))).toEqual(["0.775", "2.025"]);
    expect(s.steps.map((x) => zText(x.z0))).toEqual(["Z-0.775", "Z-2.800"]);
    expect(zText(s.from)).toBe("Z-2.800");
  });

  it("doesn't call a cut diameter 'bar' when the bar size is only a guess", () => {
    const p = "O5\nT0101\nG97 S800 M03\nG00 X1.1 Z0.1\nG01 X0.75 F0.006\nZ-1.\nX0.9\nZ-2.8\nG00 X2. Z1.\nM30\n";
    const path = toolpath(p, { kind: "lathe" });
    expect(partSizes(simulateLathe(path, null)).steps.some((x) => x.uncut)).toBe(false);
    const known = partSizes(simulateLathe(path, { dia: 0.9, len: null }));   // told the bar is 0.9: that length is untouched bar
    expect(known.steps.find((x) => Math.abs(x.dia - 0.9) < 1e-6).uncut).toBe(true);
  });

  it("a length that ends at the side of a groove is marked as about", () => {
    const g = "O1\nT0101\nG97 S1000 M03\nG00 X1.3 Z0.1\nG01 X0.75 F0.006\nZ-1.\nX1.125\nZ-2.\nG00 X1.3\nT0303\nG00 X1.2 Z-1.0625\nG75 X0.6 I0.05 F0.003\nM30\n";
    const s = partSizes(simulateLathe(toolpath(g), { dia: 1.25 }));
    const big = s.steps.find((x) => Math.abs(x.dia - 1.125) < 1e-6);
    expect(big.approx).toBe(true);
    expect(sizeLabel(big).sub).toMatch(/^about /);
  });

  it("a threaded length is named as a thread, at its outside diameter", () => {
    const t = "O1\nT0101\nG97 S1000 M03\nG00 X0.625 Z0.1\nG01 Z-1.2 F0.006\nG00 X1.3\nT0505\nG00 X0.7 Z0.2\nG76 X0.555 Z-0.8 K0.035 D0.012 F0.0625\nM30\n";
    const s = partSizes(simulateLathe(toolpath(t), { dia: 1.25 }));
    expect(s.steps).toHaveLength(1);
    near(s.steps[0].dia, 0.625);
    near(s.steps[0].thread.pitch, 0.0625);
  });

  it("writes sizes the way a drawing does", () => {
    expect(sizeText(0.75)).toBe("0.750");
    expect(sizeText(1.2505)).toBe("1.2505");
    expect(sizeText(3)).toBe("3.000");
    expect(sizeText(32, "mm")).toBe("32");
    expect(sizeText(12.5, "mm")).toBe("12.5");
    expect(zText(0)).toBe("Z0");
    expect(zText(-1.25)).toBe("Z-1.250");
  });
});

describe("playing it back smoothly", () => {
  const path = toolpath(PIN);
  const sim = simulateLathe(path, { dia: 1.25, len: null });

  it("part way along a cut, the bar is cut only as far as the tool has got", () => {
    const i = path.segs.findIndex((s) => s.type === "profile" && Math.abs(s.a[2] - 0.3125) < 1e-6 && Math.abs(s.b[0] - s.a[0]) > 0.9);   // the finishing pass along 0.625
    expect(i).toBeGreaterThan(0);
    const half = Float64Array.from(sim.outlineAt(i, 0.5));
    const s = path.segs[i];
    const mid = (s.a[0] + s.b[0]) / 2;
    const before = sim.radiusAt(sim.outlineAt(i), mid - 0.1);
    near(sim.radiusAt(half, mid + 0.1), 0.3125);              // behind the tool: cut
    near(sim.radiusAt(half, mid - 0.1), before);              // ahead of it: as it was
    const tool = sim.toolAt(i, 0.5);
    near(tool.z, mid); near(tool.r, 0.3125);
    // and looking part way along doesn't disturb the whole-move answers
    near(sim.radiusAt(sim.outlineAt(i + 1), mid - 0.1), 0.3125);
    near(sim.radiusAt(sim.outlineAt(i), mid - 0.1), before);
  });

  it("the clock runs the whole program, start to end, without going backwards", () => {
    const c = playClock(path);
    expect(c.seconds).toBeGreaterThanOrEqual(18);
    expect(c.seconds).toBeLessThanOrEqual(40);
    expect(c.posAt(0)).toBe(0);
    expect(c.posAt(c.seconds)).toBe(path.segs.length);
    let last = -1;
    for (let t = 0; t <= c.seconds; t += 0.05) { const p = c.posAt(t); expect(p).toBeGreaterThanOrEqual(last); last = p; }
    for (const p of [0, 0.25, 3.5, path.segs.length - 0.5]) near(c.posAt(c.timeOf(p)), p, 1e-6);   // pause and carry on from the same place
  });

  it("no one move hogs the time, and none flashes by in a single frame", () => {
    const c = playClock(path);
    const each = path.segs.map((_, i) => c.timeOf(i + 1) - c.timeOf(i));
    expect(Math.min(...each)).toBeGreaterThan(0.02);
    const rapids = path.segs.map((s, i) => (s.type === "rapid" ? each[i] : 0));
    expect(Math.max(...rapids)).toBeLessThan(c.seconds * 0.1);
  });

  it("an empty program doesn't break the clock", () => {
    const c = playClock({ segs: [] });
    expect(c.posAt(5)).toBe(0);
    expect(c.timeOf(0)).toBe(0);
  });
});

describe("grooves and part-offs cut with plain moves", () => {
  // Turn 1.125 for two inches, then a groove at Z-1 cut with G01 in and G00 out (no grooving cycle).
  const G = "O1\nT0101\nG97 S1000 M03\nG00 X1.3 Z0.1\nG01 X1.125 F0.006\nZ-2.\nG00 X1.3\nT0303\nG00 X1.3 Z-1.\nG01 X0.8 F0.003\nG00 X1.3\nG00 Z0.1\nM30\n";

  it("a plunge straight in and back out is a groove, and coming back out of it is not a crash", () => {
    const sim = simulateLathe(toolpath(G), { dia: 1.25 });
    near(sim.radiusAt(sim.final, -1), 0.4);
    near(sim.radiusAt(sim.final, -1.2), 0.5625);
    expect(sim.collisions).toEqual([]);
    expect(sim.notes.join(" ")).toMatch(/Groove width is a guess/);
    const s = partSizes(sim);
    expect(s.steps.filter((x) => x.groove).map((x) => Number(x.dia.toFixed(3)))).toEqual([0.8]);
    expect(s.steps.filter((x) => !x.groove)).toHaveLength(1);    // still one diameter, two inches long
    near(s.steps.find((x) => !x.groove).len, 2, 1e-9);
  });

  it("parting off past centre and pulling straight out is not a crash", () => {
    const P = "O1\nT0101\nG97 S1000 M03\nG00 X1.3 Z0.1\nG01 X1. F0.006\nZ-2.2\nG00 X1.3\nT0303\nG00 X1.3 Z-2.125\nG01 X-0.03 F0.003\nG00 X1.3\nG00 Z0.1\nM30\n";
    const sim = simulateLathe(toolpath(P), { dia: 1.25 });
    expect(sim.collisions).toEqual([]);
    near(sim.radiusAt(sim.final, -2.125), 0);     // cut right through
    near(sim.radiusAt(sim.final, -1.5), 0.5);
  });

  it("but moving sideways out of a groove still is one", () => {
    const bad = G.replace("G01 X0.8 F0.003\nG00 X1.3\n", "G01 X0.8 F0.003\nG00 X1.3\nG00 X0.8\nG00 Z-1.5\nG00 X1.3\n");
    const sim = simulateLathe(toolpath(bad), { dia: 1.25 });
    expect(sim.collisions.length).toBeGreaterThan(0);
  });

  it("facing down a shoulder and coming back out isn't mistaken for a groove", () => {
    // 0.625 for an inch, then the tool faces down the shoulder at Z-1 from 1.125 and pulls straight back
    const S = "O1\nT0101\nG97 S1000 M03\nG00 X1.3 Z0.1\nG01 X0.625 F0.006\nZ-1.\nG00 X1.3\nG00 Z-1.\nG01 X0.625\nG00 X1.3\nG00 Z0.1\nM30\n";
    const sim = simulateLathe(toolpath(S), { dia: 1.25 });
    near(sim.radiusAt(sim.final, -1.03), 0.625);                  // the bar behind the shoulder is untouched
    expect(partSizes(sim).steps.some((x) => x.groove)).toBe(false);
  });

  it("facing the end past centre and backing off is not a crash", () => {
    const F = "O1\nG50 S3000\nT0101\nG96 S400 M03\nG00 X1.45 Z0.1\nG00 Z0.\nG01 X-0.032 F0.005\nG00 Z0.1\nG00 X1.45\nG01 X1. F0.006\nG01 Z-1.\nG00 X1.45\nG00 Z0.1\nM30\n";
    const sim = simulateLathe(toolpath(F), { dia: 1.25 });
    expect(sim.collisions).toEqual([]);
    expect(sim.face).toBe(0);
  });

  it("playing part way into a plunge cuts only as deep as the tool has got", () => {
    const path = toolpath(G);
    const sim = simulateLathe(path, { dia: 1.25 });
    const i = path.segs.findIndex((s) => s.type === "feed" && Math.abs(s.a[0] + 1) < 1e-9 && Math.abs(s.b[0] + 1) < 1e-9);
    expect(i).toBeGreaterThan(0);
    const half = sim.radiusAt(Float64Array.from(sim.outlineAt(i, 0.5)), -1);
    expect(half).toBeLessThan(0.5625);
    expect(half).toBeGreaterThan(0.4);
    near(sim.radiusAt(sim.outlineAt(i + 1), -1), 0.4);
  });
});
