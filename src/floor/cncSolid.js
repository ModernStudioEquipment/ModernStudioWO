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

const isCut = (s) => !s.live && (s.type === "feed" || s.type === "profile" || s.type === "groove");

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
  // (capped: a long part mustn't be measured more loosely than a short one)
  const tight = Math.min(length * 1e-5, 2e-5);
  const grooveW = groovWidth(path, length);
  const marks = new Set();
  const N = 900;
  for (let i = 0; i <= N; i++) marks.add(back + ((face - back) * i) / N);
  const corners = []; // where the program really turns a corner (the samples sit a hair either side)
  const corner = (z) => { corners.push(z); if (z > back + tight && z < face - tight) { marks.add(z - tight); marks.add(z + tight); } };
  for (const s of cuts) {
    corner(s.a[0]); corner(s.b[0]);
    if (s.type === "groove") { corner(s.a[0] - grooveW / 2); corner(s.a[0] + grooveW / 2); }
    // A straight move in toward the centre may turn out to be a plunge (see
    // plungeAt): give it the samples for square walls now, in case. These
    // aren't real corners of the program, so sizes are never snapped to them.
    else if (Math.abs(s.a[0] - s.b[0]) < EPS && s.b[2] < s.a[2] - EPS) {
      for (const z of [s.a[0] - grooveW / 2, s.a[0] + grooveW / 2]) if (z > back + tight && z < face - tight) { marks.add(z - tight); marks.add(z + tight); }
    }
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
  let onPlunge = null;
  let onKind = null;
  let onBite = null;
  let onDig = null;
  const tol = Math.max(stockR * 0.004, 1e-4);
  // A groove or a part-off is very often cut with plain moves rather than a
  // grooving cycle: straight in, straight back out. That is a plunge too. What
  // tells it from facing a shoulder (also a straight move in X) is that there
  // is still metal beside it on the side toward the face, and that the tool
  // comes back out the way it went in.
  const plungeAt = (env, s, i) => {
    const next = segs[i + 1];
    const za = s.a[0], ra = s.a[2], rb = s.b[2];
    if (Math.abs(za - s.b[0]) > EPS || !(rb < ra - EPS)) return false;                   // not straight in
    if (za >= face - tight * 2) return false;                                           // down the face of the part: a facing cut
    // It comes straight back out, or it never moves on from there at all (the
    // next thing it does is go home, or the program ends): either way a slot.
    const carriesOn = next && Math.abs(next.a[0] - s.b[0]) < EPS && Math.abs(next.a[2] - s.b[2]) < EPS;
    if (carriesOn && !(Math.abs(next.a[0] - next.b[0]) < EPS && next.b[2] > next.a[2] + EPS)) return false;
    return radiusAt(env, za + grooveW / 2 + tight * 4) > Math.max(rb, 0) + tol;           // metal beside it: it's cutting a slot
  };
  // A pass along the part made INSIDE a hole (a boring bar's) is not the
  // outside being turned down, and mustn't be drawn as if it were. What gives
  // it away is where the tool goes next: at the end of a pass an outside tool
  // backs away from the centre, a boring bar backs toward it, and only a tool
  // that's in a hole can do that while it's still inside the part.
  const insidePass = (s, i) => {
    if (!bore || Math.abs(s.a[0] - s.b[0]) < EPS) return false;
    const next = segs[i + 1];
    if (!next || Math.abs(next.a[0] - next.b[0]) > EPS) return false;        // the next move isn't straight in or out
    return next.a[0] < face - tight * 2 && Math.abs(next.b[2]) < Math.abs(next.a[2]) - EPS && next.type === "rapid";
  };
  // Lower the outline wherever this move passes beneath it. `i` is the move's
  // place in the program (for the look ahead above).
  const cut = (env, s, i = -1) => {
    const za = s.a[0], ra = s.a[2], zb = s.b[0], rb = s.b[2];
    if (ra < 1e-6 && rb < 1e-6 && Math.abs(za - zb) > EPS) { bore = true; return; } // drilling on centre: a hole, not the outside
    if (insidePass(s, i)) { if (onKind) onKind(s.tool, "bore"); return; }
    if (s.type === "groove" || plungeAt(env, s, i)) { // a plunge: the insert has width the program doesn't state
      const bottom = Math.max(0, Math.min(ra, rb));
      if (s.type !== "groove" && onPlunge) onPlunge(i, za, bottom);
      if (onKind) onKind(s.tool, "groove");
      // how much metal the plunge goes through: a groove cut before the outside is turned goes through far more
      if (onDig) onDig(s, Math.max(0, radiusAt(env, za) - bottom));
      for (let k = lo(za - grooveW / 2); k < zs.length && zs[k] <= za + grooveW / 2 + EPS; k++) if (bottom < env[k]) env[k] = bottom;
      return;
    }
    const z0 = Math.min(za, zb), z1 = Math.max(za, zb);
    if (z1 - z0 < EPS) { if (onKind) onKind(s.tool, "face"); return; } // straight in or out: a shoulder or a face, which the moves beside it already define
    if (onKind) onKind(s.tool, "turn");
    let bite = 0;
    for (let k = lo(z0 - EPS); k < zs.length && zs[k] <= z1 + EPS; k++) {
      const t = (zs[k] - za) / (zb - za);
      const r = Math.max(0, ra + (rb - ra) * Math.min(1, Math.max(0, t)));
      if (r < env[k]) { if (env[k] - r > bite) bite = env[k] - r; env[k] = r; }
    }
    // How much metal this one pass took off, per side. Only for a plain cut:
    // the passes of a roughing cycle are the control's, sized by the cycle.
    if (onBite && s.type === "feed" && bite > 0) onBite(i, s, bite);
  };

  // Walk the whole program once: cut on cutting moves, and on every rapid ask
  // whether it goes through metal that is still there at that moment.
  const hits = new Map(); // line -> deepest hit on that line
  const env = fresh();
  const plunged = [];     // grooves cut with plain moves, found on this first walk only
  onPlunge = (index, z, r) => plunged.push({ index, z, r });
  const toolKinds = {};   // tool -> the kinds of cut it makes: turn, face, groove, thread, drill
  onKind = (tool, kind) => { (toolKinds[tool] ||= []).includes(kind) || toolKinds[tool].push(kind); };
  let deepestPlunge = null; // the deepest any plunge goes through metal: { line, depth }
  onDig = (s, depth) => { if (!deepestPlunge || depth > deepestPlunge.depth) deepestPlunge = { line: s.line, depth }; };
  let threadInMetal = null; // a thread started where the outside hasn't been turned down to it yet
  let deepestThread = null; // the most any one threading pass takes off
  let lowestZ = Infinity;   // the furthest toward the chuck that anything goes, rapids included
  let deepest = null;     // the heaviest single turning pass: { line, depth }
  onBite = (index, s, depth) => { if (!deepest || depth > deepest.depth) deepest = { line: s.line, depth, z: Math.min(s.a[0], s.b[0]) }; };
  // Threads cut so far: a threading tool pulls back out through its own
  // thread, which isn't a move through uncut metal.
  const threaded = [];
  // Where the tool lands on the first move after going home, taken in turn
  // with the drawn moves (see cncPath.js `arrivals`).
  const arrivals = (path.arrivals || []).slice();
  let nextArrival = 0;
  const landing = (index) => {
    for (; nextArrival < arrivals.length && arrivals[nextArrival].index <= index; nextArrival++) {
      const a = arrivals[nextArrival];
      if (segs[a.index]?.live) continue;                  // a live tool landing beside a flat or a hole
      const z = a.at[0], r = Math.abs(a.at[2]);
      if (z >= face - tight * 2) continue;                 // in front of the part: clear
      const depth = surfaceAt(env, z) - r;
      if (depth > tol && (!hits.has(a.line) || depth > hits.get(a.line).depth)) hits.set(a.line, { line: a.line, index, z, r, depth, from: [z, r], to: [z, r], arriving: true });
    }
  };
  segs.forEach((s, index) => {
    landing(index);
    lowestZ = Math.min(lowestZ, s.a[0], s.b[0]);
    if (s.type === "thread") {
      const t0 = Math.min(s.a[0], s.b[0]), t1 = Math.min(face, Math.max(s.a[0], s.b[0]));
      const root = Math.min(Math.abs(s.a[2]), Math.abs(s.b[2]));
      // The metal above the thread's root right now: the bar as turned so far,
      // or the root of an earlier pass over the same length.
      let above = 0;
      for (let k = lo(t0); k < zs.length && zs[k] <= t1; k++) above = Math.max(above, env[k]);
      const earlier = threaded.filter((t) => t.z0 < t1 && t.z1 > t0).map((t) => t.minor);
      const from = earlier.length ? Math.min(above, ...earlier) : above;
      const take = Math.max(0, from - root);
      // A cycle (G76) shares its depth out over its own passes, so what matters
      // there is whether the outside was ready for it. A single pass (G32, G92)
      // takes everything between where it is and what's above it.
      const cycleHeight = s.height || 0;
      if (cycleHeight > 0) { if (above > root + cycleHeight + Math.max(tol, cycleHeight * 0.5) && !threadInMetal) threadInMetal = { line: s.line, over: above - (root + cycleHeight) }; }
      else if (!deepestThread || take > deepestThread.depth) deepestThread = { line: s.line, depth: take };
      threaded.push({ z0: Math.min(s.a[0], s.b[0]), z1: Math.max(s.a[0], s.b[0]), minor: root });
      onKind(s.tool, "thread");
      return;
    }
    if (isCut(s)) {
      if (s.a[2] < 1e-6 && s.b[2] < 1e-6 && Math.abs(s.a[0] - s.b[0]) > EPS) onKind(s.tool, "drill");
      cut(env, s, index);
      return;
    }
    if (s.type !== "rapid" || s.live) return;
    const za = s.a[0], ra = s.a[2], zb = s.b[0], rb = s.b[2];
    const z0 = Math.min(za, zb), z1 = Math.max(za, zb);
    let worst = null;
    const test = (z, r) => {
      // The face itself isn't metal: a move down or up the front of the part,
      // at Z0, is beside the bar and not in it.
      if (z >= face - tight * 2) return;
      // In a thread that's been cut, down to its root, is where the tool has already been.
      if (threaded.some((t) => z >= t.z0 - tight * 4 && z <= t.z1 + tight * 4 && Math.abs(r) >= t.minor - tol)) return;
      // (X below zero is the far side of centre: how far from the centre line is what counts)
      const depth = surfaceAt(env, z) - Math.abs(r);
      if (depth > tol && (!worst || depth > worst.depth)) worst = { z, r, depth };
    };
    // straight in or out: the nearest it gets to the centre line
    if (z1 - z0 < EPS) test(za, (ra < 0) !== (rb < 0) ? 0 : Math.min(Math.abs(ra), Math.abs(rb)));
    else {
      test(za, ra); test(zb, rb);
      for (let i = lo(z0); i < zs.length && zs[i] <= z1; i++) test(zs[i], ra + ((rb - ra) * (zs[i] - za)) / (zb - za));
    }
    // from/to: the whole move, so the view can draw the line it took through the bar
    if (worst && (!hits.has(s.line) || worst.depth > hits.get(s.line).depth)) hits.set(s.line, { line: s.line, index, ...worst, from: [za, ra], to: [zb, rb] });
  });
  landing(segs.length);
  onPlunge = null; onKind = null; onBite = null; onDig = null; // later walks (stepping through the program) only redraw; the lists are made
  if (bore) notes.push("Holes and bores aren't shown or checked, only the outside.");
  if (plunged.length || segs.some((s) => s.type === "groove")) notes.push("Groove width is a guess. The program doesn't give the insert's width.");

  const threads = segs
    .map((s, index) => ({ s, index }))
    .filter(({ s }) => s.type === "thread")
    .map(({ s, index }) => ({ index, z0: Math.min(s.a[0], s.b[0]), z1: Math.min(face, Math.max(s.a[0], s.b[0])), za: s.a[0], zb: s.b[0], minor: s.a[2], pitch: s.pitch || 0, height: s.height || 0, firstCut: s.firstCut || 0, fromDia: s.fromDia ?? null, line: s.line }));

  // The outline after the first n moves. Stepping forward reuses the last
  // answer, so playing the program through is one pass, not n of them.
  let cacheN = 0;
  let cacheEnv = fresh();
  //
  // part: how far into the NEXT move the tool has got (0 to 1), for playing the
  // program smoothly: that move is cut only as far as the tool has travelled.
  const scratch = new Float64Array(zs.length);
  const outlineAt = (n, part = 0) => {
    const upTo = Math.max(0, Math.min(segs.length, n));
    if (upTo < cacheN) { cacheN = 0; cacheEnv = fresh(); }
    for (let i = cacheN; i < upTo; i++) if (isCut(segs[i])) cut(cacheEnv, segs[i], i);
    cacheN = upTo;
    const next = segs[upTo];
    if (!(part > 0) || !next || !isCut(next)) return cacheEnv;
    scratch.set(cacheEnv);
    cut(scratch, { ...next, b: lerp3(next.a, next.b, Math.min(1, part)) }, upTo);
    return scratch;
  };

  // When the picture of "one bar, one chuck, one zero" doesn't hold, a rapid
  // that looks buried may be nothing of the sort: the part may be in the
  // sub-spindle, or the move may be inside a hole. Say why, so the finding is
  // read as "look at this", not "this is wrong".
  const unsure = bore ? "the program drills or bores, and this may be inside the hole"
    : (path.notes || []).some((n) => /sub-spindle/i.test(n)) ? "the program uses live tools or the sub-spindle, which this can't follow"
    : "";

  // Where a grooving tool plunged. Its width is a guess, so a size worked out
  // across one is marked as a groove and given no length.
  const grooves = segs
    .map((g, index) => ({ g, index }))
    .filter(({ g }) => g.type === "groove")
    .map(({ g, index }) => ({ index, z: g.a[0], r: Math.min(g.a[2], g.b[2]) }))
    .concat(plunged)
    .sort((p, q) => p.index - q.index);

  return {
    zs, face, back, stockR, length, guessed, bore, unsure, notes, threads, grooves, grooveW, corners, tight,
    toolKinds, deepest, deepestPlunge, deepestThread, threadInMetal, lowestZ,
    // Against a guessed bar there's nothing true to check a rapid against (the
    // guess is the biggest diameter any cut starts from, which is often an
    // approach well outside the real bar), so nothing is called a collision.
    collisions: guessed ? [] : [...hits.values()].sort((a, b) => a.line - b.line),
    final: Float64Array.from(env),
    outlineAt,
    radiusAt,
    // Where the tool's point is after n moves (null before the first).
    // part > 0: on its way along the next move.
    toolAt: (n, part = 0) => {
      const next = segs[n];
      if (part > 0 && next) { const p = lerp3(next.a, next.b, Math.min(1, part)); return { z: p[0], r: p[2], tool: next.tool, type: next.type }; }
      const s = segs[Math.min(segs.length, Math.max(1, n)) - 1];
      return n > 0 && s ? { z: s.b[0], r: s.b[2], tool: s.tool, type: s.type } : null;
    },
  };
}

const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

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
//
// part: how far along the next move the tool is (see outlineAt). A thread being
// cut right now shows its teeth only as far as the tool has reached.
export function outlinePoints(sim, n = Infinity, part = 0) {
  const env = sim.outlineAt(n, part);
  const pts = [];
  const live = sim.threads.filter((t) => t.index < n && t.z1 - t.z0 > EPS);
  const now = part > 0 ? sim.threads.find((t) => t.index === n) : null;
  if (now) {
    const at = now.za + (now.zb - now.za) * Math.min(1, part);
    const z0 = Math.max(now.z0, Math.min(now.za, at));
    const z1 = Math.min(now.z1, Math.max(now.za, at));
    if (z1 - z0 > EPS) live.push({ ...now, z0, z1 });
  }
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

// ---- the sizes of what's been cut ---------------------------------------------
//
// Every straight length of the part with one diameter along it, read off the
// outline after the first n moves: the diameter, where it starts and ends, and
// how long it is. These are the numbers someone checks with calipers.
//
// They are what the PROGRAM cuts. Whether that's what the drawing asks for is
// exactly the question the person reading them is there to answer.
//
// Left out on purpose: tapers and radii (no single diameter to give), anything
// too short to measure, and the bar gripped in the chuck. A groove gives its
// diameter but no width, because the program doesn't say how wide the insert is.
export function partSizes(sim, n = Infinity) {
  if (!sim) return null;
  const env = Number.isFinite(n) ? sim.outlineAt(n) : sim.final; // the finished part doesn't disturb the stepping
  const from = sim.face - sim.length;
  const tol = Math.max(sim.stockR * 2e-5, 2e-6);       // "the same diameter"
  const short = Math.max(sim.length * 0.004, tol * 40); // too short to be worth a number

  const pts = [];
  for (let i = 0; i < sim.zs.length; i++) if (sim.zs[i] >= from - EPS) pts.push([sim.zs[i], env[i]]);
  const line = simplifyOutline(pts);

  // The samples sit a hair either side of each corner so shoulders stay square.
  // A size has to come from the corner itself, or 0.775 reads as 0.7749.
  const snap = (z) => {
    let best = z;
    let d = sim.tight * 1.6;
    for (const c of sim.corners) { const e = Math.abs(c - z); if (e < d) { d = e; best = c; } }
    return best;
  };

  const raw = [];
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1];
    const b = line[i];
    // A taper or a wall has no one diameter. (A slot cut right through, as a
    // part-off is, stays in for now: the lengths either side of it are joined
    // across it below, and it's dropped at the end.)
    if (Math.abs(a[1] - b[1]) > tol) continue;
    const last = raw[raw.length - 1];
    if (last && Math.abs(last.r - a[1]) <= tol && Math.abs(last.z1 - a[0]) <= short * 0.5) { last.z1 = b[0]; continue; }
    raw.push({ z0: a[0], z1: b[0], r: a[1] });
  }
  const cutGrooves = sim.grooves.filter((g) => g.index < n);
  for (const s of raw) {
    s.z0 = snap(s.z0); s.z1 = snap(s.z1);
    s.groove = s.z1 - s.z0 <= sim.grooveW * 1.02 && cutGrooves.some((g) => g.z >= s.z0 - EPS && g.z <= s.z1 + EPS && Math.abs(g.r - s.r) <= tol * 4);
  }
  // A groove cut into a diameter doesn't make it two diameters. Join the
  // lengths either side of it back into one, the way a drawing shows it.
  const near = (p, q) => Math.abs(p - q) <= sim.tight * 4;
  const grooved = raw.filter((s) => s.groove);
  const merged = [];
  for (const s of raw) {
    if (s.groove) continue;
    const last = merged[merged.length - 1];
    if (last && Math.abs(last.r - s.r) <= tol && grooved.some((g) => near(g.z0, last.z1) && near(g.z1, s.z0))) { last.z1 = s.z1; continue; }
    merged.push({ ...s });
  }
  const edges = cutGrooves.flatMap((g) => [g.z - sim.grooveW / 2, g.z + sim.grooveW / 2]);
  const atEdge = (z) => edges.some((e) => near(e, z));

  const live = sim.threads.filter((t) => t.index < n && t.z1 - t.z0 > EPS);
  const out = [];
  for (const s of [...merged, ...grooved]) {
    const len = s.z1 - s.z0;
    if (len < short || s.r < tol) continue;   // too short to measure, or nothing left there
    const th = s.groove ? null : live.find((t) => Math.min(t.z1, s.z1) - Math.max(t.z0, s.z0) > len * 0.5);
    out.push({
      z0: s.z0, z1: s.z1, mid: (s.z0 + s.z1) / 2, r: s.r, dia: s.r * 2, len: s.groove ? null : len,
      // an end that's the side of a groove is only as good as the guess at the insert's width
      approx: !s.groove && (atEdge(s.z0) || atEdge(s.z1)),
      // still the bar: nothing has cut here (only knowable when the bar's real size is)
      uncut: !sim.guessed && Math.abs(s.r - sim.stockR) <= tol,
      groove: !!s.groove,
      thread: th ? { pitch: th.pitch } : null,
    });
  }
  out.sort((a, b) => b.mid - a.mid); // from the face back toward the chuck, the way the program is written
  return { face: sim.face, from: snap(from), length: sim.length, steps: out, guessed: sim.guessed };
}

// A size the way it's written on a drawing: inches to three places (four when
// the program really is that fine), millimetres without padding.
export function sizeText(v, units = "in") {
  if (!Number.isFinite(v)) return "";
  if (units === "mm") return Number(v.toFixed(3)).toString();
  const four = v.toFixed(4);
  return four.endsWith("0") ? v.toFixed(3) : four;
}

// What to write beside one size: the diameter, and under it the length or what
// kind of feature it is. No unit marks: the heading says the units once.
export function sizeLabel(step, units = "in") {
  const main = `\u00D8${sizeText(step.dia, units)}`;
  const bits = [];
  if (step.groove) bits.push("groove");
  else if (step.len != null) bits.push(`${step.approx ? "about " : ""}${sizeText(step.len, units)} long`);
  if (step.thread) {
    const p = step.thread.pitch;
    const tpi = p > 0 ? 1 / p : 0;
    bits.push(units === "mm" ? (p > 0 ? `thread, ${Number(p.toFixed(3))} pitch` : "thread")
      : tpi && Math.abs(tpi - Math.round(tpi)) < 0.02 ? `thread, ${Math.round(tpi)} TPI` : "thread");
  }
  if (step.uncut) bits.push("bar, not cut");
  return { main, sub: bits.join(" \u00B7 ") };
}

// A Z position: Z0, Z-1.250.
export function zText(z, units = "in") {
  return Math.abs(z) < 5e-5 ? "Z0" : `Z${sizeText(z, units)}`;
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
