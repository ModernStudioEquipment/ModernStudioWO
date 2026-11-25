// The turned part as a solid, worked out by cutting a bar the way the program
// does. No WebGL in here: this is the model the 3D view draws, kept separate so
// it can be tested with numbers.
//
// How it works. A lathe part is round, so its whole shape is one outline: the
// radius of the bar at each point along its length. It starts as the stock
// bar. Every cutting move, in program order, lowers that outline wherever the
// tool passes beneath it. What's left at the end is the part. Because it's
// done in order, the outline is known at every moment of the program, which
// gives two things a drawing can't:
//
//   the bar being cut down as you step through the program, and
//   a real check that no RAPID move passes through metal that's still there.
//
// What it does not model: the size and shape of the insert (the tool is a
// point), bores and drilled holes (outside shape only), live-tool features,
// and anything about the chuck or jaws.

const EPS = 1e-9;

// ---- the stock box on the part ----------------------------------------------
//
// People write it how they say it: 1.25" round bar, cut 3.1" long / 1-1/4 bar
// / 3/4 x 6 / 32mm rod. The first number is the diameter, a second one the
// length. Returns null when there's no number to go on.
export function parseStock(text) {
  const t = String(text || "");
  const nums = [];
  const re = /(\d+)[\s-]+(\d+)\s*\/\s*(\d+)|(\d+)\s*\/\s*(\d+)|(\d*\.\d+|\d+)/g;
  let m;
  while ((m = re.exec(t)) && nums.length < 2) {
    const v = m[1] != null ? Number(m[1]) + Number(m[2]) / Number(m[3]) : m[4] != null ? Number(m[4]) / Number(m[5]) : Number(m[6]);
    if (Number.isFinite(v) && v > 0) nums.push(v);
  }
  if (!nums.length) return null;
  return { dia: nums[0], len: nums[1] ?? null, mm: /mm\b|millim/i.test(t) };
}

const isCut = (s) => s.type === "feed" || s.type === "profile" || s.type === "groove";

// ---- cutting the bar --------------------------------------------------------
//
// path = toolpath(...) for a lathe program. stock = { dia, len } in the
// program's units, or null to guess the bar from the largest diameter the
// program works at.
export function simulateLathe(path, stock = null) {
  const segs = path?.segs || [];
  const cuts = segs.filter(isCut);
  const notes = [];
  if (path?.kind !== "lathe" || !cuts.length) return null;

  let zCutMin = Infinity;
  let zCutMax = -Infinity;
  let rMax = 0;
  for (const s of cuts) for (const p of [s.a, s.b]) { zCutMin = Math.min(zCutMin, p[0]); zCutMax = Math.max(zCutMax, p[0]); rMax = Math.max(rMax, p[2]); }

  // Where the part's front face is. Nearly every lathe program puts Z0 on the
  // finished face and cuts toward the chuck (Z going negative), with the tool
  // starting a little in front in fresh air. If the cutting straddles Z0, that
  // is the face. Otherwise take the furthest forward the tool cuts.
  const face = zCutMin < -EPS && zCutMax >= -EPS ? 0 : zCutMax;
  const length = Math.max(face - zCutMin, 1e-6);

  const guessed = !(stock && stock.dia > 0);
  const stockR = guessed ? rMax : stock.dia / 2;
  if (guessed) notes.push("The bar size is a guess. Add the stock size to the part for a true check.");
  // The bar carries on toward the chuck past where cutting stops. Use the
  // stock's real length when it's given, but always leave enough bar past the
  // cut for the jaws to hold: a blank barely longer than the part still has to
  // be gripped by something.
  const grip = Math.max(length * 0.22, stockR * 0.5);
  const back = Math.min(stock?.len > length ? face - stock.len : Infinity, zCutMin - grip);

  // Sample points along the bar: an even spread for curves, plus a tight pair
  // either side of every corner so a shoulder stays square instead of sloping.
  const tight = length * 1e-5;
  const grooveW = groovWidth(path, length);
  const marks = new Set();
  const N = 900;
  for (let i = 0; i <= N; i++) marks.add(back + ((face - back) * i) / N);
  const corner = (z) => { if (z > back + tight && z < face - tight) { marks.add(z - tight); marks.add(z + tight); } };
  for (const s of cuts) {
    corner(s.a[0]); corner(s.b[0]);
    if (s.type === "groove") { corner(s.a[0] - grooveW / 2); corner(s.a[0] + grooveW / 2); }
  }
  const zs = Float64Array.from([...marks].filter((z) => z >= back - EPS && z <= face + EPS).sort((a, b) => a - b));

  const fresh = () => new Float64Array(zs.length).fill(stockR);
  const lo = (z) => { let a = 0, b = zs.length; while (a < b) { const m = (a + b) >> 1; if (zs[m] < z) a = m + 1; else b = m; } return a; };
  const radiusAt = (env, z) => {
    if (z > face + EPS || z < back - EPS) return 0; // in front of the face or past the bar: air
    const i = Math.min(zs.length - 1, lo(z));
    if (i === 0) return env[0];
    const t = (z - zs[i - 1]) / Math.max(zs[i] - zs[i - 1], EPS);
    return env[i - 1] + (env[i] - env[i - 1]) * Math.min(1, Math.max(0, t));
  };

  // The bar's surface for the crash check. At a square shoulder the outline
  // jumps, and a tool standing exactly on that wall is touching the metal it
  // just cut, not buried in it: there, the lower side of the jump counts.
  const surfaceAt = (env, z) => {
    let r = radiusAt(env, z);
    for (let i = lo(z - tight * 3); i < zs.length && zs[i] <= z + tight * 3; i++) if (env[i] < r) r = env[i];
    return r;
  };

  let bore = false;
  // Lower the outline wherever this move passes beneath it.
  const cut = (env, s) => {
    const za = s.a[0], ra = s.a[2], zb = s.b[0], rb = s.b[2];
    if (ra < 1e-6 && rb < 1e-6 && Math.abs(za - zb) > EPS) { bore = true; return; } // drilling on centre: a hole, not the outside
    if (s.type === "groove") { // a plunge: the insert has width the program doesn't state
      const bottom = Math.min(ra, rb);
      for (let i = lo(za - grooveW / 2); i < zs.length && zs[i] <= za + grooveW / 2 + EPS; i++) if (bottom < env[i]) env[i] = bottom;
      return;
    }
    const z0 = Math.min(za, zb), z1 = Math.max(za, zb);
    if (z1 - z0 < EPS) return; // straight in or out: a shoulder or a face, which the moves beside it already define
    for (let i = lo(z0 - EPS); i < zs.length && zs[i] <= z1 + EPS; i++) {
      const t = (zs[i] - za) / (zb - za);
      const r = Math.max(0, ra + (rb - ra) * Math.min(1, Math.max(0, t)));
      if (r < env[i]) env[i] = r;
    }
  };

  // Walk the whole program once: cut on cutting moves, and on every rapid ask
  // whether it goes through metal that is still there at that moment.
  const tol = Math.max(stockR * 0.004, 1e-4);
  const hits = new Map(); // line -> deepest hit on that line
  const env = fresh();
  segs.forEach((s, index) => {
    if (isCut(s)) { cut(env, s); return; }
    if (s.type !== "rapid") return;
    const za = s.a[0], ra = s.a[2], zb = s.b[0], rb = s.b[2];
    const z0 = Math.min(za, zb), z1 = Math.max(za, zb);
    let worst = null;
    const test = (z, r) => {
      // The face itself isn't metal: a move down or up the front of the part,
      // at Z0, is beside the bar and not in it.
      if (z >= face - tight * 2) return;
      const depth = surfaceAt(env, z) - r;
      if (depth > tol && (!worst || depth > worst.depth)) worst = { z, r, depth };
    };
    if (z1 - z0 < EPS) test(za, Math.min(ra, rb));
    else {
      test(za, ra); test(zb, rb);
      for (let i = lo(z0); i < zs.length && zs[i] <= z1; i++) test(zs[i], ra + ((rb - ra) * (zs[i] - za)) / (zb - za));
    }
    // from/to: the whole move, so the view can draw the line it took through the bar
    if (worst && (!hits.has(s.line) || worst.depth > hits.get(s.line).depth)) hits.set(s.line, { line: s.line, index, ...worst, from: [za, ra], to: [zb, rb] });
  });
  if (bore) notes.push("Holes and bores aren't shown or checked, only the outside.");
  if (segs.some((s) => s.type === "groove")) notes.push("Groove width is a guess. The program doesn't give the insert's width.");

  const threads = segs
    .map((s, index) => ({ s, index }))
    .filter(({ s }) => s.type === "thread")
    .map(({ s, index }) => ({ index, z0: Math.min(s.a[0], s.b[0]), z1: Math.min(face, Math.max(s.a[0], s.b[0])), minor: s.a[2], pitch: s.pitch || 0 }));

  // The outline after the first n moves. Stepping forward reuses the last
  // answer, so playing the program through is one pass, not n of them.
  let cacheN = 0;
  let cacheEnv = fresh();
  const outlineAt = (n) => {
    const upTo = Math.max(0, Math.min(segs.length, n));
    if (upTo < cacheN) { cacheN = 0; cacheEnv = fresh(); }
    for (let i = cacheN; i < upTo; i++) if (isCut(segs[i])) cut(cacheEnv, segs[i]);
    cacheN = upTo;
    return cacheEnv;
  };

  // When the picture of "one bar, one chuck, one zero" doesn't hold, a rapid
  // that looks buried may be nothing of the sort: the part may be in the
  // sub-spindle, or the move may be inside a hole. Say why, so the finding is
  // read as "look at this", not "this is wrong".
  const unsure = bore ? "the program drills or bores, and this may be inside the hole"
    : (path.notes || []).some((n) => /sub-spindle/i.test(n)) ? "the program uses live tools or the sub-spindle, which this can't follow"
    : "";

  return {
    zs, face, back, stockR, length, guessed, bore, unsure, notes, threads,
    collisions: [...hits.values()].sort((a, b) => a.line - b.line),
    final: Float64Array.from(env),
    outlineAt,
    radiusAt,
    // Where the tool's point is after n moves (null before the first).
    toolAt: (n) => { const s = segs[Math.min(segs.length, Math.max(1, n)) - 1]; return n > 0 && s ? { z: s.b[0], r: s.b[2], tool: s.tool, type: s.type } : null; },
  };
}

// A groove insert's width isn't in the program. 1/8 inch is typical; on a
// metric program that's about 3 mm. Never wider than a tenth of the part.
function groovWidth(path, length) {
  const typical = path.units === "mm" ? 3 : 0.125;
  return Math.min(typical, length * 0.1);
}

// ---- the outline as points to spin into a solid ------------------------------
//
// [[z, radius], ...] from the chuck end to the face, closed down to the centre
// at both ends. Threads cut so far are drawn as teeth between the surface and
// the thread's root, one per turn of the thread.
export function outlinePoints(sim, n = Infinity) {
  const env = sim.outlineAt(n);
  const pts = [];
  const live = sim.threads.filter((t) => t.index < n && t.z1 - t.z0 > EPS);
  const inThread = (z) => live.find((t) => z >= t.z0 - EPS && z <= t.z1 + EPS);
  let lastThread = null;
  for (let i = 0; i < sim.zs.length; i++) {
    const z = sim.zs[i];
    const th = inThread(z);
    if (!th) { pts.push([z, env[i]]); lastThread = null; continue; }
    if (th === lastThread) continue; // this thread's teeth are already laid down
    lastThread = th;
    const span = th.z1 - th.z0;
    const pitch = th.pitch > EPS ? th.pitch : span / 24;
    const turns = Math.max(4, Math.min(160, Math.round(span / pitch)));
    for (let k = 0; k <= turns * 2; k++) {
      const zz = th.z0 + (span * k) / (turns * 2);
      const top = sim.radiusAt(env, zz);
      pts.push([zz, k % 2 === 0 ? top : Math.min(top, Math.max(th.minor, 0))]);
    }
  }
  return [[sim.back, 0], ...pts, [sim.face, 0]];
}

// ---- what the picture is made of --------------------------------------------
//
// A colour for the metal, read off the part's material box. Only for looks.
export function metalFor(material) {
  const m = String(material || "").toLowerCase();
  if (/brass|bronze/.test(m)) return { name: "brass", color: "#C9A24B", rough: 0.3 };
  if (/copper/.test(m)) return { name: "copper", color: "#C7754A", rough: 0.3 };
  if (/alum|6061|7075|2024/.test(m)) return { name: "aluminium", color: "#D5DAE0", rough: 0.36 };
  if (/delrin|acetal|nylon|plastic|uhmw|pvc|abs/.test(m)) return { name: "plastic", color: /black/.test(m) ? "#22252A" : "#E9E6DC", rough: 0.7, plastic: true };
  if (/stainless|304|316|303|17-4/.test(m)) return { name: "stainless steel", color: "#BFC5CC", rough: 0.28 };
  return { name: "steel", color: "#A9B0B8", rough: 0.34 };
}

// Drop the points that add nothing: three in a row on one straight line only
// need the two ends. A plain pin's outline goes from about a thousand samples
// to a couple of dozen points, which is what makes it cheap enough to rebuild
// the solid on every step of the program.
export function simplifyOutline(points, tol = 1e-7) {
  if (points.length < 3) return points.slice();
  const out = [points[0]];
  for (let i = 1; i < points.length - 1; i++) {
    const a = out[out.length - 1];
    const b = points[i];
    const c = points[i + 1];
    const cross = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    const span = Math.hypot(c[0] - a[0], c[1] - a[1]) || 1;
    if (Math.abs(cross) / span > tol) out.push(b);
  }
  out.push(points[points.length - 1]);
  return out;
}
