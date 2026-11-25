// A milled part as a solid: a block of stock, cut down by the tool the way the
// program moves it. No WebGL in here; this is the model the 3D view draws, kept
// separate so it can be tested with numbers. (The lathe's is cncSolid.js.)
//
// How it works. Seen from above, the block is a grid of little squares, each
// with a height: the top of the metal there. It starts flat at the top of the
// stock. Every cutting move, in program order, lowers the squares the cutter
// passes over to the depth it's at. What's left is the part. Done in order, the
// shape is known at every moment of the program, which is what lets the view
// play it back.
//
// What it is honest about not knowing:
//   the block     a program doesn't say how big the stock is or where on it the
//                 zero is. The size comes from the part's stock box when that
//                 gives one; where the block sits is always fitted round the
//                 cuts. Both are said on screen.
//   the cutters   a diameter is read from each tool's comment ("1/2 ENDMILL").
//                 A tool with no size in its comment is drawn at a guess.
//   the shape     every cutter is treated as flat-ended and can only cut
//                 straight down: no drill points, ball ends, chamfer mills,
//                 undercuts or anything from the side.
// So it's a picture of what the program does, not a crash check. Nothing here
// says a rapid move is safe.

const EPS = 1e-9;

// ---- how big is the cutter? ----------------------------------------------------
//
// From the comment on the tool change: "1/2 FLAT ENDMILL", ".375 EM", "1-1/4
// FACE MILL", "10MM DRILL", "3/8-16 TAP". The first size in it is taken as the
// diameter. Returns null when there isn't one (a "#7 DRILL", a "SPOT DRILL").
export function toolDia(note, units = "in") {
  const t = String(note || "");
  const mm = /(\d*\.?\d+)\s*mm\b/i.exec(t);
  if (mm) { const v = Number(mm[1]); return units === "mm" ? v : v / 25.4; }
  const m = /(\d+)[\s-]+(\d+)\s*\/\s*(\d+)|(\d+)\s*\/\s*(\d+)|(\d*\.\d+|\d+(?=\s*(?:"|″|in\b|inch|dia)))/i.exec(t);
  if (!m) return null;
  const v = m[1] != null ? Number(m[1]) + Number(m[2]) / Number(m[3]) : m[4] != null ? Number(m[4]) / Number(m[5]) : Number(m[6]);
  if (!(v > 0)) return null;
  // a bare number in an inch program this big is millimetres written without saying so
  return units === "mm" ? v : v > 6 ? v / 25.4 : v;
}

// The block, from the stock box: "4 x 3 x 0.5 plate", "1/2 x 4 x 3 6061 bar".
// The thinnest number is how thick it is. Returns null without at least two.
export function parseBlock(text) {
  const t = String(text || "").replace(/\b\d{4}\b(?!\s*(?:"|″|x))/g, " "); // not the alloy number (6061, 1018)
  const nums = [];
  const re = /(\d+)[\s-]+(\d+)\s*\/\s*(\d+)|(\d+)\s*\/\s*(\d+)|(\d*\.\d+|\d+)/g;
  let m;
  while ((m = re.exec(t)) && nums.length < 3) {
    const v = m[1] != null ? Number(m[1]) + Number(m[2]) / Number(m[3]) : m[4] != null ? Number(m[4]) / Number(m[5]) : Number(m[6]);
    if (Number.isFinite(v) && v > 0) nums.push(v);
  }
  if (nums.length < 2) return null;
  const s = nums.slice().sort((a, b) => b - a);
  return { long: s[0], wide: s[1], thick: s[2] ?? null };
}

const isCut = (s) => s.type !== "rapid";

// ---- cutting the block ---------------------------------------------------------
//
// path = toolpath(...) for a mill program. toolNames = { toolNumber: comment }.
// cells = how many squares along the block's longer side.
//
// box = { x0, x1, y0, y1, top, bottom } puts the block there instead of working
// it out, so two programs can be cut on the very same grid and compared square
// for square.
export function simulateMill(path, { stockText = "", toolNames = {}, cells = 200, box = null } = {}) {
  const segs = path?.segs || [];
  const cuts = segs.filter(isCut);
  if (path?.kind !== "mill" || !cuts.length) return null;
  const units = path.units === "mm" ? "mm" : "in";
  const notes = [];

  // -- the cutters
  const fallback = units === "mm" ? 6 : 0.25;
  const tools = {};
  const unsized = [];
  for (const t of new Set(cuts.map((s) => s.tool))) {
    const d = toolDia(toolNames?.[t], units);
    tools[t] = { dia: d || fallback, guessed: !d, name: String(toolNames?.[t] || "") };
    if (!d) unsized.push(t);
  }
  if (unsized.length) notes.push(`No size in the comment for T${unsized.join(", T")}, so ${unsized.length === 1 ? "it's" : "they're"} drawn ${fallback}${units === "mm" ? " mm" : "″"} across.`);
  const rad = (s) => (tools[s.tool]?.dia || fallback) / 2;

  // -- how far the cutting reaches, cutter included
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, zLow = Infinity, zHigh = -Infinity;
  for (const s of cuts) {
    const r = rad(s);
    for (const p of [s.a, s.b]) {
      x0 = Math.min(x0, p[0] - r); x1 = Math.max(x1, p[0] + r);
      y0 = Math.min(y0, p[1] - r); y1 = Math.max(y1, p[1] + r);
      zLow = Math.min(zLow, p[2]); zHigh = Math.max(zHigh, p[2]);
    }
  }
  // The top of the stock: Z0, the way nearly every program is set, unless the
  // whole program cuts above that.
  const top = box ? box.top : zLow < -EPS ? 0 : zHigh;
  const depth = Math.max(top - zLow, 0);

  // -- the block
  const block = parseBlock(stockText);
  const spanX = x1 - x0;
  const spanY = y1 - y0;
  let sizeX = spanX, sizeY = spanY;
  let sized = false;
  if (block) {
    // the longer side of the block goes along the longer reach of the cutting
    const [bx, by] = spanX >= spanY ? [block.long, block.wide] : [block.wide, block.long];
    // A block smaller than the cutting can't be this program's stock as written
    // (the cutter running round the outside is the usual reason it's a little
    // bigger): keep the stated size when it's at least the part between cutters.
    if (bx >= spanX * 0.5 && by >= spanY * 0.5) { sizeX = Math.max(bx, 0); sizeY = Math.max(by, 0); sized = true; }
  }
  const pad = sized ? 0 : Math.max(spanX, spanY) * 0.04;
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const bx0 = box ? box.x0 : cx - sizeX / 2 - pad, bx1 = box ? box.x1 : cx + sizeX / 2 + pad;
  const by0 = box ? box.y0 : cy - sizeY / 2 - pad, by1 = box ? box.y1 : cy + sizeY / 2 + pad;
  // As thick as the part says, when it says and the cuts fit in it; otherwise a
  // bit deeper than the deepest cut.
  const thick = sized && block.thick && block.thick > depth - EPS ? block.thick : Math.max(depth * 1.35, Math.max(spanX, spanY) * 0.06);
  const bottom = box ? box.bottom : top - thick;
  if (!sized) notes.push("The block's size is a guess, fitted round the cuts. Put the stock size on the part (like 4 x 3 x 0.5) for the real one.");
  else notes.push("Where the block sits is fitted round the cuts: the program doesn't say where its zero is on the stock.");

  // -- the grid. A long program on a fine grid is a lot of arithmetic, so the
  //    grid coarsens until the whole job is a reasonable amount of work.
  const longSide = Math.max(bx1 - bx0, by1 - by0);
  let n = Math.max(40, Math.min(260, Math.round(cells)));
  const workAt = (count) => {
    const c = longSide / count;
    let w = 0;
    for (const s of cuts) { const r = rad(s); w += ((Math.abs(s.b[0] - s.a[0]) + 2 * r) / c + 1) * ((Math.abs(s.b[1] - s.a[1]) + 2 * r) / c + 1); }
    return w;
  };
  // (not when the block is given: two programs being compared must land on the same grid)
  while (!box && n > 60 && workAt(n) > 4e7) n = Math.round(n * 0.75);
  const cell = longSide / n;
  const nx = Math.max(2, Math.round((bx1 - bx0) / cell));
  const ny = Math.max(2, Math.round((by1 - by0) / cell));
  if (n < Math.min(260, Math.round(cells)) * 0.9) notes.push("This is a long program, so the picture is drawn a little coarser.");

  const fresh = () => new Float32Array(nx * ny).fill(top);
  // Lower every square the cutter passes over on this move (or the first
  // `part` of it) to the depth it's at there.
  const stamp = (h, s, part = 1) => {
    const r = rad(s);
    const ax = s.a[0], ay = s.a[1], az = s.a[2];
    const bx = ax + (s.b[0] - ax) * part, by = ay + (s.b[1] - ay) * part, bz = az + (s.b[2] - az) * part;
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const i0 = Math.max(0, Math.floor((Math.min(ax, bx) - r - bx0) / cell));
    const i1 = Math.min(nx - 1, Math.ceil((Math.max(ax, bx) + r - bx0) / cell));
    const j0 = Math.max(0, Math.floor((Math.min(ay, by) - r - by0) / cell));
    const j1 = Math.min(ny - 1, Math.ceil((Math.max(ay, by) + r - by0) / cell));
    const r2 = r * r;
    const low = Math.min(az, bz);
    let bite = 0;   // the most this move took off any one square
    for (let j = j0; j <= j1; j++) {
      const py = by0 + (j + 0.5) * cell;
      for (let i = i0; i <= i1; i++) {
        const px = bx0 + (i + 0.5) * cell;
        // nearest point on the move's centre line, seen from above
        const t = len2 < EPS ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
        const qx = ax + dx * t, qy = ay + dy * t;
        if ((px - qx) * (px - qx) + (py - qy) * (py - qy) > r2) continue;
        // a straight plunge cuts to its bottom; a move that travels cuts to the depth it has there
        const z = len2 < EPS ? low : az + (bz - az) * t;
        const k = j * nx + i;
        if (z < h[k]) { if (h[k] - z > bite) bite = h[k] - z; h[k] = z; }
      }
    }
    return bite;
  };

  // The whole program once, for the finished part. On the way, the deepest
  // any single travelling pass cuts into what's there at that moment: one pass
  // at full depth breaks cutters that three shallower ones wouldn't.
  const final = fresh();
  let deepest = null;
  for (const s of cuts) {
    const bite = stamp(final, s);
    // (a straight plunge is a drill or an entry, judged by its depth elsewhere; this is about passes that travel)
    const travels = Math.abs(s.b[0] - s.a[0]) > EPS || Math.abs(s.b[1] - s.a[1]) > EPS;
    if (travels && bite > 0 && (!deepest || bite > deepest.depth)) deepest = { line: s.line, depth: bite, tool: s.tool };
  }

  // The block after the first n moves, plus `part` of the next. Stepping
  // forward reuses the last answer, so playing it through is one pass.
  let cacheN = 0;
  let cache = fresh();
  const scratch = new Float32Array(nx * ny);
  const heightsAt = (count, part = 0) => {
    const upTo = Math.max(0, Math.min(segs.length, count));
    if (upTo >= segs.length) return final;
    if (upTo < cacheN) { cacheN = 0; cache = fresh(); }
    for (let i = cacheN; i < upTo; i++) if (isCut(segs[i])) stamp(cache, segs[i]);
    cacheN = upTo;
    const next = segs[upTo];
    if (!(part > 0) || !next || !isCut(next)) return cache;
    scratch.set(cache);
    stamp(scratch, next, Math.min(1, part));
    return scratch;
  };

  // How much of the block the program takes away, as a share of the top.
  let cutCells = 0;
  for (let k = 0; k < final.length; k++) if (final[k] < top - EPS) cutCells += 1;

  return {
    units, tools, notes, sized,
    x0: bx0, y0: by0, x1: bx1, y1: by1, cell, nx, ny, top, bottom, depth,
    final, heightsAt,
    heightAt: (h, x, y) => {
      const i = Math.floor((x - bx0) / cell), j = Math.floor((y - by0) / cell);
      return i < 0 || j < 0 || i >= nx || j >= ny ? null : h[j * nx + i];
    },
    cutShare: cutCells / final.length,
    deepest,
    box: { x0: bx0, x1: bx1, y0: by0, y1: by1, top, bottom }, cut: { x0, x1, y0, y1, zLow },
    // Where the cutter is after n moves (null before the first), and how big.
    toolAt: (count, part = 0) => {
      const next = segs[count];
      if (part > 0 && next) {
        const t = Math.min(1, part);
        return { x: next.a[0] + (next.b[0] - next.a[0]) * t, y: next.a[1] + (next.b[1] - next.a[1]) * t, z: next.a[2] + (next.b[2] - next.a[2]) * t, tool: next.tool, type: next.type, dia: tools[next.tool]?.dia || fallback };
      }
      const s = segs[Math.min(segs.length, Math.max(1, count)) - 1];
      return count > 0 && s ? { x: s.b[0], y: s.b[1], z: s.b[2], tool: s.tool, type: s.type, dia: tools[s.tool]?.dia || fallback } : null;
    },
  };
}
