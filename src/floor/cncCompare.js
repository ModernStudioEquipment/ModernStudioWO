// A rewritten program, measured against the one it replaces.
//
// The rule this file works to: a draft passes only on what was MEASURED the
// same, never on what merely wasn't noticed to be different. So everything a
// program tells the machine falls into one of three piles:
//
//   measured     followed through both programs and compared: the finished
//                shape, how far and how deep it cuts, where rapids go, each
//                tool's speeds and feeds, the roughing and threading settings
//   word for     anything the follower can't follow (macro lines, live tools,
//   word         the sub-spindle, sub-programs, coordinate shifts, and every
//                cutting move on a part with a bore) must be the same in both,
//                character for character, or the draft stops
//   said out     what nothing here can know (the jaws, the fixture, the real
//   loud         tool in the pocket) is listed on screen every time
//
// Findings are { level, text, line } like the rule checker's. "stop" means the
// draft must not be offered as it stands.

import { MACHINES } from "./machines.js";
import { splitMachines } from "./cncParts.js";
import { parseLines, programInfo, looksLikeProgram, operatorStops } from "./cncGcode.js";
import { checkForPart, cleanTools } from "./cncPack.js";
import { toolpath } from "./cncPath.js";
import { simulateLathe, parseStock, partSizes, sizeText, zText, simplifyOutline } from "./cncSolid.js";
import { simulateMill, toolDia } from "./cncMill.js";
import { scan, sameMachine } from "./cncScan.js";
import { estimateTime, fmtDuration } from "./cncTime.js";

const ORDER = { stop: 0, look: 1, note: 2 };
const byLevel = (list) => list.slice().sort((a, b) => ORDER[a.level] - ORDER[b.level]);
const kindOf = (part) => MACHINES.find((m) => m.key === splitMachines(part?.machine)[0])?.kind || "";
const n4 = (v) => Number(Number(v).toFixed(4)).toString();
const max = (list) => (list.length ? Math.max(...list) : 0);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// Codes that change where the tool is, what holds the part, or which way the
// spindle turns. A rewrite has no business introducing one.
const DANGEROUS = {
  G10: "sets offsets from inside the program", G14: "switches to the sub-spindle", G15: "switches spindles",
  G51: "scales every move", G52: "shifts the coordinate system", G65: "calls a macro", G66: "calls a macro", G68: "rotates the coordinate system",
  G92: "resets the coordinate system", M4: "runs the spindle backwards", M10: "works the chuck", M11: "opens the chuck",
  M97: "calls a sub-program", M98: "calls a sub-program", M143: "starts the sub-spindle", M144: "starts the sub-spindle backwards",
  M133: "starts a live tool", M134: "starts a live tool backwards", M19: "orients the spindle", M21: "works the tailstock", M22: "works the tailstock",
};

// ---- what a program does, in numbers -----------------------------------------
//
// One walk through the program, then everything two versions are compared on.
export function measure(content, part, { millBox = null, toolNames = null } = {}) {
  const lines = parseLines(content);
  const info = programInfo(content);
  const path = toolpath(content, { kind: kindOf(part) });
  const units = path.units === "mm" ? "mm" : "in";
  const stock = parseStock(part?.facts?.stock);
  const sim = path.kind === "lathe" ? simulateLathe(path, stock) : null;
  const names = toolNames || Object.fromEntries(info.tools.filter((t) => t.note).map((t) => [t.t, t.note]));
  const mill = path.kind === "mill" ? simulateMill(path, { stockText: part?.facts?.stock || "", toolNames: names, box: millBox, cells: 240 }) : null;
  const cuts = path.segs.filter((s) => s.type !== "rapid");
  const rapids = path.segs.filter((s) => s.type === "rapid");

  const codes = new Set();
  const unitCodes = new Set();
  let nonAscii = null;
  let longLine = null;
  let coolant = 0;
  String(content || "").replace(/\r\n?/g, "\n").split("\n").forEach((text, i) => {
    if (!nonAscii && /[^\x09\x20-\x7E]/.test(text)) nonAscii = i + 1;
    if (!longLine && text.length > 128) longLine = i + 1;
  });
  for (const l of lines) for (const w of l.words) {
    if (w.l === "G" || w.l === "M") codes.add(`${w.l}${w.v}`);
    if (w.l === "G" && (w.v === 20 || w.v === 21)) unitCodes.add(`G${w.v}`);
    if (w.l === "M" && (w.v === 8 || w.v === 88)) coolant += 1;
  }

  // -- each tool on its own: a feed doubled on the grooving tool mustn't hide
  //    behind the roughing tool's higher one
  const K = units === "mm" ? 1000 / Math.PI : 12 / Math.PI;   // surface speed to rpm, per unit of diameter
  const perTool = {};
  const tool = (t) => (perTool[t] ||= { rpm: 0, surface: 0, clamp: 0, feeds: {}, zLow: Infinity, box: [Infinity, -Infinity, Infinity, -Infinity], cuts: 0 });
  const feedKey = (perRev, kind) => `${perRev ? "per turn" : "per minute"}|${kind}`;
  for (const s of cuts) {
    const T = tool(s.tool);
    T.cuts += 1;
    // The fastest the spindle could be turning on this move. Under constant
    // surface speed that's set by the smallest diameter it reaches, held down
    // by the speed limit; with no limit and a cut to centre, it's flat out.
    if (s.css) {
      const dia = path.kind === "lathe" ? 2 * Math.min(Math.abs(s.a[2]), Math.abs(s.b[2])) : 0;
      const free = dia > 1e-6 ? (s.s * K) / dia : Infinity;
      const top = Math.min(free, s.clamp > 0 ? s.clamp : Infinity);
      T.rpm = Math.max(T.rpm, Number.isFinite(top) ? top : 99999);
      T.surface = Math.max(T.surface, s.s || 0);
    } else {
      T.rpm = Math.max(T.rpm, s.s || 0);
    }
    T.clamp = Math.max(T.clamp, s.clamp || 0);
    if (s.type !== "thread") { const k = feedKey(s.perRev, s.type); T.feeds[k] = Math.max(T.feeds[k] || 0, s.f || 0); }
    if (path.kind === "mill") {
      T.zLow = Math.min(T.zLow, s.a[2], s.b[2]);
      T.box = [Math.min(T.box[0], s.a[0], s.b[0]), Math.max(T.box[1], s.a[0], s.b[0]), Math.min(T.box[2], s.a[1], s.b[1]), Math.max(T.box[3], s.a[1], s.b[1])];
    }
  }
  const rough = (path.cycles || []).filter((c) => c.kind === "rough");
  const finish = (path.cycles || []).filter((c) => c.kind === "finish");
  for (const c of rough) { const T = tool(c.tool); const k = feedKey(c.perRev, "rough"); T.feeds[k] = Math.max(T.feeds[k] || 0, c.f || 0); }

  // -- rapids on a mill: the height it travels sideways at, and the lowest a
  //    straight-down rapid ends. Two different questions, kept apart.
  const sideways = rapids.filter((s) => s.a[0] !== s.b[0] || s.a[1] !== s.b[1]);
  const down = rapids.filter((s) => s.a[0] === s.b[0] && s.a[1] === s.b[1]);
  const landings = (path.arrivals || []).filter((a) => a.type === "rapid");

  // a mill tool plunging straight down is a different cut from the same tool travelling: its feed is kept apart
  if (path.kind === "mill") {
    for (const T of Object.values(perTool)) T.feeds = {};
    for (const s of cuts) {
      const down = s.a[0] === s.b[0] && s.a[1] === s.b[1];
      const key = feedKey(s.perRev, down ? "plunge" : "feed");
      perTool[s.tool].feeds[key] = Math.max(perTool[s.tool].feeds[key] || 0, s.f || 0);
    }
  }
  // the finishing pass has its own speed and its own tool, which may not be the roughing one's
  for (const c of finish) {
    const T = tool(c.tool);
    T.cuts += 1;
    const r = rough.find((x) => x.p === c.p && x.q === c.q);
    const prof = r ? path.segs.slice(r.from, r.to ?? r.from).filter((x) => x.type === "profile") : [];
    const smallest = prof.length ? 2 * Math.min(...prof.map((x) => Math.min(Math.abs(x.a[2]), Math.abs(x.b[2])))) : 0;
    if (c.css) { const free = smallest > 1e-6 ? (c.s * K) / smallest : Infinity; const top = Math.min(free, c.clamp > 0 ? c.clamp : Infinity); T.rpm = Math.max(T.rpm, Number.isFinite(top) ? top : 99999); T.surface = Math.max(T.surface, c.s || 0); }
    else T.rpm = Math.max(T.rpm, c.s || 0);
  }
  const text = scan(content, path.kind);
  // going home from down inside the part drags the tool out sideways
  const inside = (h) => {
    if (!h.at) return false;
    if (path.kind === "lathe") return !!sim && h.at[0] < sim.face - sim.tight * 2 && Math.abs(h.at[2]) < sim.stockR - 1e-4;
    return !!mill && h.at[2] < mill.top - 1e-4;
  };

  return {
    info, path, sim, mill, units, codes, unitCodes: [...unitCodes].sort(), nonAscii, longLine, coolant, perTool, text,
    homesInside: (path.homes || []).filter(inside).length,
    finishTools: finish.map((c) => c.tool),
    kind: path.kind,
    sizes: sim ? partSizes(sim) : null,
    stops: operatorStops(content),
    time: estimateTime(path),
    reach: path.stats,
    rough: rough.map((c) => ({ line: c.line, tool: c.tool, depth: c.depth || 0, allowX: c.allowX || 0, allowZ: c.allowZ || 0, startX: c.x, finished: finish.some((f) => f.p === c.p && f.q === c.q && f.line > c.line) })),
    travelLow: path.kind === "mill" && sideways.length ? Math.min(...sideways.map((s) => Math.min(s.a[2], s.b[2]))) : null,
    plungeLow: path.kind === "mill" && (down.length || landings.length) ? Math.min(...down.map((s) => s.b[2]), ...landings.map((a) => a.at[2])) : null,
    // every cutting move, as written, for parts where the shape can't be measured
    cutMoves: cuts.map((s) => `T${s.tool} ${s.type} ${n4(s.a[0])},${n4(s.a[1])},${n4(s.a[2])} > ${n4(s.b[0])},${n4(s.b[1])},${n4(s.b[2])}`),
    opaque: (path.opaque || []).slice().sort(),
    shifts: (path.shifts || []).slice().sort(),
    homeVia: (path.homeVia || []).slice().sort(),
    hasMacros: lines.some((l) => l.macro && l.code),
    lineCount: lines.length,
    wrapped: /^\s*%/.test(String(content || "")),
    ends: lines.some((l) => l.words.some((w) => w.l === "M" && (w.v === 30 || w.v === 99 || w.v === 2))),
    speeds: {
      rpm: max(cuts.filter((s) => !s.css).map((s) => s.s)),
      surface: max(cuts.filter((s) => s.css).map((s) => s.s)),
      clamp: max(path.segs.map((s) => s.clamp || 0).concat((path.cycles || []).map((c) => c.clamp || 0))),
      feedPerRev: max(cuts.filter((s) => s.perRev && s.type !== "thread").map((s) => s.f).concat((path.cycles || []).filter((c) => c.perRev).map((c) => c.f || 0))),
      feedPerMin: max(cuts.filter((s) => !s.perRev).map((s) => s.f)),
    },
  };
}

// ---- the comparison -------------------------------------------------------------
export function draftChecks(oldContent, newContent, { part = null, machineFacts = {}, sizesMayChange = false, speedsMayRise = false } = {}) {
  const out = [];
  const add = (level, text, line = null) => out.push({ level, text, line, from: "measured" });
  // `same`: the machine does exactly what it did (only comments, or something slower).
  // `unmeasured`: the program has things the follower can't follow AND its code
  // changed, so none of the measuring below can be relied on for it.
  let sameAsBefore = false;
  let unmeasured = "";
  const finish = (coverage) => { const list = byLevel(out); list.coverage = coverage; list.sameMachine = sameAsBefore; list.unmeasured = unmeasured; return list; };

  if (!looksLikeProgram(newContent)) {
    add("stop", "What came back isn't a program.");
    return finish({ measured: [], notMeasured: ["Nothing: it isn't a program."] });
  }
  let a = measure(oldContent, part);
  // A mill cutter's size is read from its comment. If the draft's comment for
  // a tool no longer has a size in it, the tool hasn't changed: keep the size
  // the current program gives. (A comment with a DIFFERENT size is a real change.)
  const namesWas = Object.fromEntries(a.info.tools.map((t) => [t.t, t.note]));
  const namesNow = Object.fromEntries(programInfo(newContent).tools.map((t) => [t.t, toolDia(t.note, a.units) ? t.note : namesWas[t.t] || t.note]));
  let b = measure(newContent, part, { toolNames: namesNow });
  // Two mill programs are cut again on one grid big enough for both, so the
  // blocks can be compared square for square and nothing falls off the edge.
  if (a.mill && b.mill) {
    const p = a.mill.cut, q = b.mill.cut;
    const pad = Math.max(a.mill.cell, b.mill.cell) * 2;
    const millBox = {
      x0: Math.min(p.x0, q.x0) - pad, x1: Math.max(p.x1, q.x1) + pad, y0: Math.min(p.y0, q.y0) - pad, y1: Math.max(p.y1, q.y1) + pad,
      top: Math.max(a.mill.top, b.mill.top), bottom: Math.min(a.mill.bottom, b.mill.bottom),
    };
    a = measure(oldContent, part, { millBox });
    b = measure(newContent, part, { millBox, toolNames: namesNow });
  }
  const kept = sameMachine(a.text, b.text);
  const u = a.units;                                   // sizes are judged in the CURRENT program's units
  const slack = (sim) => (sim ? sim.tight * 3 : 0);
  const tol = Math.max(u === "mm" ? 0.005 : 0.0002, slack(a.sim), slack(b.sim));
  const sz = (v) => sizeText(v, u);
  const changed = sizesMayChange ? "look" : "stop";
  const measured = [];
  const notMeasured = ["The jaws, the vise, the fixture and the clamps: the program doesn't describe them.", "The real tool in each pocket: its shape, its length, and whether it's sharp."];
  sameAsBefore = kept.same;

  // -- will the Haas read it the way this app did?
  if (b.text.junk.length) add("stop", `A line isn't G-code: "${b.text.junk[0].text}". The control would alarm or, worse, read part of it.`, b.text.junk[0].line);
  if (b.text.unbalanced && !b.text.junk.some((j) => j.line === b.text.unbalanced)) add("stop", "A comment bracket is opened and never closed. The control treats the rest of the line differently from this app.", b.text.unbalanced);
  if (b.text.midPercent && b.text.midPercent !== a.text.midPercent) add("stop", "There is a % in the middle of the program. The Haas stops loading the file there.", b.text.midPercent);
  const newSlash = b.text.slashed.filter((l) => !a.text.slashed.includes(l));
  if (newSlash.length) add("stop", `A line starts with "/" (${newSlash[0]}). Whether it runs depends on the Block Delete switch, so it can't be checked.`);
  if (!kept.tailSame) add("stop", "The lines after the end of the program (where sub-programs go) are different, and the app doesn't follow those.");

  // -- words the follower doesn't use have to be the very same words
  const lost = a.text.unread.filter((w) => !b.text.unread.includes(w));
  const gained = b.text.unread.filter((w) => !a.text.unread.includes(w));
  const reordered = !lost.length && !gained.length && a.text.unread.join("|") !== b.text.unread.join("|");
  if (lost.length || gained.length || reordered) {
    add("stop", `Words the app can't follow are different, so what they do wasn't checked.${gained.length ? ` New or changed: ${gained.slice(0, 4).join("; ")}${gained.length > 4 ? ", and more" : ""}.` : ""}${lost.length ? ` Gone: ${lost.slice(0, 4).join("; ")}${lost.length > 4 ? ", and more" : ""}.` : ""}${reordered ? " They are the same words in a different order or under different tools." : ""}`);
  } else if (a.text.unread.length) {
    notMeasured.push(`${a.text.unread.length} word${a.text.unread.length === 1 ? "" : "s"} the app doesn't follow (${a.text.unread.slice(0, 3).join("; ")}${a.text.unread.length > 3 ? ", …" : ""}). They are the same in both programs.`);
  }

  // -- what each tool runs with: its zero and which way the spindle turns
  for (const t of Object.keys(b.text.perTool)) {
    const was = a.text.perTool[t];
    const now = b.text.perTool[t];
    if (!was) continue;
    const eq = (x, y) => x.slice().sort().join(",") === y.slice().sort().join(",");
    if (!eq(was.wcs, now.wcs)) add("stop", `T${t} cuts under work offset ${now.wcs.join(" and ")}, where the current program has it under ${was.wcs.join(" and ")}. It would cut from a different zero.`);
    if (!eq(was.spin, now.spin)) add("stop", `T${t} cuts with the spindle ${now.spin.join(" and ")}, where the current program has it ${was.spin.join(" and ")}.`);
  }
  if (b.text.stoppedCuts > a.text.stoppedCuts) add("stop", "A cutting move is made with the spindle not turning.");
  if (a.text.g53.join("|") !== b.text.g53.join("|")) add("stop", `The moves in machine coordinates (G53) are different: ${b.text.g53.join("; ") || "none now"}, where the current program has ${a.text.g53.join("; ") || "none"}. Those go to a fixed place on the machine whatever is in the way.`);
  if (a.text.roughKinds.join(",") !== b.text.roughKinds.join(",") && a.text.roughKinds.length === b.text.roughKinds.length) add("stop", `A roughing cycle was changed for a different one (${b.text.roughKinds.join(", ")}, was ${a.text.roughKinds.join(", ")}). They cut in different directions.`);
  for (const ref of b.text.finishRefs) if (!b.text.roughRefs.includes(ref)) add("stop", `A finishing pass (G70) points at lines N${ref.replace("-", " to N")}, which no roughing cycle in the program uses.`);
  if (a.finishTools.join(",") !== b.finishTools.join(",") && b.finishTools.some((t) => !a.finishTools.includes(t))) add("stop", `The finishing pass is run with T${b.finishTools.filter((t) => !a.finishTools.includes(t)).join(", T")}, where the current program finishes with T${a.finishTools.join(", T") || "nothing"}. A different tool follows the same path to a different shape.`);
  if (b.path.profileRapids > a.path.profileRapids) add("stop", "There is a rapid move inside a roughing cycle's profile. The finishing pass runs it as a rapid, through the metal left for finishing.");
  if (b.homesInside > a.homesInside) add("stop", "It sends the tool home from down inside the part, which drags it out sideways. The current program always backs out first.");
  const goneStops = a.text.stops.filter((why) => !b.text.stops.includes(why));
  if (b.text.stops.length < a.text.stops.length) add("stop", `An operator stop is gone (${goneStops.join("; ") || "one of them"}). If the operator had something to do there, the machine now carries straight on.`);
  const lostNotes = a.text.numbered.filter((c) => !b.text.numbered.includes(c));
  if (lostNotes.length) add("look", `A comment with a number in it was changed or removed: ${lostNotes.slice(0, 2).map((c) => `(${c})`).join(", ")}. Operators set up from those.`);

  // -- it is the same program for the same setup
  if (a.info.number && b.info.number !== a.info.number) add("stop", `The program number changed from ${a.info.number} to ${b.info.number || "nothing"}. It would be filed as a different program on the machine.`);
  if (a.kind !== b.kind) add("stop", `The current program is a ${a.kind} program and this reads as a ${b.kind} program.`);
  if (b.unitCodes.length > 1) add("stop", "It switches between inches and millimetres (G20 and G21 are both in it). Every size after the switch would be wrong.");
  else if (a.unitCodes.length === 1 && b.unitCodes.length === 1 && a.unitCodes[0] !== b.unitCodes[0]) add("stop", `The units changed (${a.unitCodes[0]} to ${b.unitCodes[0]}). Every size would be wrong.`);
  else if (a.unitCodes.length && !b.unitCodes.length) add("stop", `The current program sets its units (${a.unitCodes.join(", ")}) and this one doesn't, so it would run in whatever the machine was left in.`);
  else if (!a.unitCodes.length && b.unitCodes.length) add("stop", `It sets the units (${b.unitCodes.join(", ")}), which the current program never does. If the machine is normally in the other one, every size changes.`);
  const offA = a.info.offsets.slice().sort().join(", ");
  const offB = b.info.offsets.slice().sort().join(", ");
  if (offA !== offB) add("stop", `The work offset changed: the current program uses ${offA || "none"} and this uses ${offB || "none"}. The tool would start from a different zero.`);
  if (a.wrapped && !b.wrapped) add("look", "The current program starts with a % line and this one doesn't. The Haas may not load it.");
  if (!b.ends) add("stop", "There is no end of program (M30).");
  if (b.nonAscii) add("stop", "There is a character the Haas can't read (not plain keyboard text).", b.nonAscii);
  if (b.longLine) add("look", "A line is longer than the control likes (over 128 characters).", b.longLine);
  if (!same(a.shifts, b.shifts)) add("stop", `The lines that move the coordinate system are different (${b.shifts.join("; ") || "none now"}, where the current program has ${a.shifts.join("; ") || "none"}). Everything after one cuts in a different place.`);

  // "G28 X0. Z0." goes home BY WAY OF X0 Z0, which on a lathe is the middle of the part's face.
  const viaNew = b.homeVia.filter((l) => !a.homeVia.includes(l));
  if (viaNew.length) add("stop", `It goes home by way of a point it names (${viaNew.slice(0, 2).join("; ")}), which the current program doesn't. The tool rapids to that point first, wherever the part is.`);

  // -- tools: only ones that are really there, called the same way, doing the same job
  const listed = new Map(splitMachines(part?.machine).flatMap((k) => cleanTools(machineFacts?.[k]?.tools)).map((r) => [Number(String(r.t).replace(/\D/g, "")), r.what]));
  const hadTool = new Set(a.info.tools.map((t) => t.t));
  for (const t of b.info.tools) {
    if (!hadTool.has(t.t)) {
      if (listed.size && !listed.has(t.t)) add("stop", `It calls T${t.t}, which the current program doesn't use and which isn't on the machine's tool list.`);
      else if (listed.size) add("look", `It uses T${t.t} (${listed.get(t.t) || "no description"}), which the current program doesn't. Check that tool is in that pocket and set. Its speeds and feeds have nothing to be compared with.`);
      else add("stop", `It calls T${t.t}, which the current program doesn't use, and this machine's tool list isn't filled in, so there's no way to know that tool exists.`);
      continue;
    }
    const offWas = (a.path.offsets[t.t] || []).slice().sort();
    const offNow = (b.path.offsets[t.t] || []).slice().sort();
    if (!same(offWas, offNow)) add("stop", `T${t.t} is called with offset ${offNow.join(", ") || "none"}, where the current program uses ${offWas.join(", ") || "none"}. The machine would think the tool is a different length.`);
    const kindsWas = a.sim?.toolKinds?.[t.t] || [];
    const extra = (b.sim?.toolKinds?.[t.t] || []).filter((k) => !kindsWas.includes(k));
    if (a.sim && b.sim && extra.length) add("stop", `T${t.t} is used for a kind of cut it doesn't make in the current program (${extra.map((k) => ({ turn: "turning", face: "facing", groove: "grooving", thread: "threading", drill: "drilling" })[k] || k).join(", ")}). The tool in that pocket may not be able to.`);
  }
  for (const t of b.info.tools) if (!t.note) add("look", `T${t.t} has no comment saying what the tool is.`);
  if (b.path.unhomed > a.path.unhomed) add("stop", `It changes tools ${b.path.unhomed} time${b.path.unhomed === 1 ? "" : "s"} without sending the turret home first${a.path.unhomed ? `, where the current program does that ${a.path.unhomed} time${a.path.unhomed === 1 ? "" : "s"}` : ", which the current program never does"}. The turret swings every tool past the part when it turns.`);

  // -- codes the current program never used
  const fresh = [...b.codes].filter((c) => !a.codes.has(c)).sort();
  const bad = fresh.filter((c) => DANGEROUS[c] && !(c === "G92" && b.kind === "lathe"));   // (G92 is a threading cycle on a lathe)
  for (const c of bad) add("stop", `It uses ${c}, which ${DANGEROUS[c]} and which the current program never does.`);
  const other = fresh.filter((c) => !bad.includes(c));
  if (other.length) add("look", `It uses codes the current program doesn't: ${other.join(", ")}. Each one should be explained in the list of changes.`);
  if (a.coolant > 0 && b.coolant === 0) add("look", "The coolant is never turned on (M08), and the current program turns it on.");

  // -- what the follower can't follow has to be word for word the same
  if (!same(a.opaque, b.opaque)) {
    const gone = a.opaque.filter((l) => !b.opaque.includes(l));
    const came = b.opaque.filter((l) => !a.opaque.includes(l));
    add("stop", `Lines the app can't follow (macros, live tools, the sub-spindle, sub-programs) are different, so what they do couldn't be checked.${came.length ? ` New or changed: ${came.slice(0, 3).join("; ")}${came.length > 3 ? ", and more" : ""}.` : ""}${gone.length ? ` Gone: ${gone.slice(0, 3).join("; ")}${gone.length > 3 ? ", and more" : ""}.` : ""}`);
  } else if (a.opaque.length) {
    notMeasured.push(`${a.opaque.length} line${a.opaque.length === 1 ? "" : "s"} the app can't follow (macros, live tools, the sub-spindle, sub-programs). They are the same in both programs, word for word, but what they do wasn't checked.`);
  }

  // -- no faster than it was, tool by tool
  const faster = (name, was, now, code) => {
    if (!(now > was * 1.001 + 1e-9)) return;
    const what = `${name} went up from ${n4(was)} to ${n4(now)}${code ? ` (${code})` : ""}.`;
    if (speedsMayRise) add("look", `${what} Check the tool and the setup can take it.`);
    else add("stop", `${what} A rewrite doesn't run anything faster unless that was asked for.`);
  };
  for (const t of Object.keys(b.perTool).map(Number)) {
    const was = a.perTool[t];
    const now = b.perTool[t];
    if (!was) continue;                                 // a tool the current program doesn't cut with: dealt with above
    faster(`T${t}'s top spindle speed`, Math.round(was.rpm), Math.round(Math.min(now.rpm, 99999)), "rpm, worked out from its S word, the diameter it cuts and the speed limit");
    // (the speed limit can hide a higher surface speed at the small end of a part; it still cuts faster everywhere else)
    if (was.surface > 0) faster(`T${t}'s surface speed`, was.surface, now.surface, "G96 S");
    const modeWas = new Set(Object.keys(was.feeds).map((k) => k.split("|")[0]));
    for (const [key, f] of Object.entries(now.feeds)) {
      const [mode, kind] = key.split("|");
      if (modeWas.size && !modeWas.has(mode)) { add("stop", `T${t}'s feed changed from ${[...modeWas].join(" and ")} to ${mode} (G98 and G99). The same F number means a completely different speed.`); break; }
      // against the same kind of move, or, for a kind this tool didn't make before, its fastest of any kind
      const base = was.feeds[key] ?? max(Object.entries(was.feeds).filter(([k]) => k.startsWith(mode)).map(([, v]) => v));
      const word = { rough: "roughing feed", profile: "finishing feed", feed: "cutting feed", groove: "grooving feed", plunge: "plunging feed" }[kind] || "feed";
      if (base > 0) faster(`T${t}'s ${word}`, base, f, `F, ${mode}`);
      else if (f > 0) add("look", `T${t} cuts at F${n4(f)} ${mode} on a kind of move it doesn't make in the current program, so there's nothing to compare that feed with.`);
    }
  }
  faster("The spindle speed limit", a.speeds.clamp, b.speeds.clamp, "G50 S");
  if (a.speeds.clamp > 0 && b.speeds.surface > 0 && !b.speeds.clamp) add("stop", "The spindle speed limit (G50 S) is gone.");
  // tapping: the feed is the speed times the thread's lead, so the ratio must not move
  const lead = (m) => m.path.taps.map((t) => `T${t.tool} ${t.lead.toFixed(6)}`).sort();
  if (!same(lead(a), lead(b))) add("stop", "A tapping cycle's feed and speed no longer match the way they do in the current program. The feed has to be the speed times the thread's lead, or the tap breaks.");
  measured.push("Each tool's top spindle speed and feeds, against the same tool in the current program.");

  // -- the roughing and threading cycles: the numbers that decide how hard each pass cuts
  if (b.rough.length !== a.rough.length) add("look", `It has ${b.rough.length} roughing cycle${b.rough.length === 1 ? "" : "s"} where the current program has ${a.rough.length}.`);
  b.rough.forEach((c, i) => {
    const was = a.rough[i];
    // (roughing the inside of a bore uses a negative U, so it's only wrong when it has changed sign)
    const flipped = (now, before) => (now < 0) !== (before < 0);
    if ((c.allowX < 0 || c.allowZ < 0) && (!was || flipped(c.allowX, was.allowX) || flipped(c.allowZ, was.allowZ))) add("stop", `The roughing cycle on line ${c.line} has a finish allowance below zero (U${n4(c.allowX)} W${n4(c.allowZ)}). Roughing would cut under the finished size.`, c.line);
    if (!c.finished && (!was || was.finished)) add("stop", `The roughing cycle on line ${c.line} is never followed by its finishing pass (G70), so the part would be left oversize by the finish allowance.`, c.line);
    if (!was) return;
    faster(`The roughing depth of cut on line ${c.line}`, was.depth, c.depth, "D, per side per pass");
    if (c.allowX > Math.max(was.allowX * 2, was.allowX + 0.02) || c.allowZ > Math.max(was.allowZ * 2, was.allowZ + 0.02)) add("look", `The roughing cycle on line ${c.line} leaves a lot more for the finishing pass (U${n4(c.allowX)} W${n4(c.allowZ)}, was U${n4(was.allowX)} W${n4(was.allowZ)}). That's one heavy finishing cut.`, c.line);
    if (was.startX != null && c.startX != null && c.startX < was.startX - tol) {
      const bar = b.sim && !b.sim.guessed ? b.sim.stockR * 2 : null;
      if (bar != null && c.startX < bar - tol) add("stop", `The roughing cycle on line ${c.line} starts at X${n4(c.startX)}, inside the ${sz(bar)} bar. The cycle takes that as the outside of the metal, so its first pass would bury the tool.`, c.line);
      else add("look", `The roughing cycle on line ${c.line} starts from a smaller diameter than it does now (X${n4(c.startX)}, was X${n4(was.startX)}). It must start outside the bar.`, c.line);
    }
  });
  if (a.sim && b.sim) {
    b.sim.threads.forEach((t, i) => {
      const was = a.sim.threads[i];
      if (!was) return;
      if (Math.abs(t.height - was.height) > 1e-5) add("stop", `The thread's height setting changed (K${n4(t.height)}, was K${n4(was.height)}). That decides where the first pass starts, so a smaller one makes the first cut too deep.`, t.line);
      faster(`The thread's first cut on line ${t.line}`, was.firstCut, t.firstCut, "D");
      if (t.fromDia != null && was.fromDia != null && t.fromDia < was.fromDia - tol) add("stop", `The threading tool starts from a smaller diameter (X${n4(t.fromDia)}, was X${n4(was.fromDia)}). It pulls back to there between passes, so it has to be clear of the thread.`, t.line);
    });
  }

  // -- how hard a single pass bites
  const biteA = a.sim?.deepest || a.mill?.deepest || null;
  const biteB = b.sim?.deepest || b.mill?.deepest || null;
  const cycleDepth = max(a.rough.map((c) => c.depth));
  if (biteB) {
    const allowed = Math.max(biteA?.depth || 0, cycleDepth);
    if (biteB.depth > allowed * 1.05 + tol) {
      const what = `One pass takes ${sz(biteB.depth)} off ${b.kind === "lathe" ? "per side" : "in depth"} in a single cut (line ${biteB.line}), where the current program never takes more than ${sz(allowed)}.`;
      if (speedsMayRise) add("look", `${what} Check the tool can take it.`, biteB.line);
      else add("stop", `${what} That is how inserts and cutters get broken.`, biteB.line);
    }
  }
  if (a.sim && b.sim) {
    const dig = (m) => m.sim.deepestPlunge?.depth || 0;
    if (dig(b) > dig(a) * 1.05 + tol) {
      const what = `A plunge goes through ${sz(dig(b))} of metal (line ${b.sim.deepestPlunge.line}), where the deepest in the current program is ${sz(dig(a))}. The outside may not have been turned down yet when it's cut.`;
      add(speedsMayRise ? "look" : "stop", what, b.sim.deepestPlunge.line);
    }
    const tb = (m) => m.sim.deepestThread?.depth || 0;
    if (tb(b) > tb(a) * 1.05 + tol) add("stop", `A threading pass takes ${sz(tb(b))} in one go (line ${b.sim.deepestThread.line}), where the current program never takes more than ${sz(tb(a))}.`, b.sim.deepestThread.line);
    if (b.sim.threadInMetal && !a.sim.threadInMetal) add("stop", `The thread is cut where the outside hasn't been turned down to it yet (${sz(b.sim.threadInMetal.over)} of metal still over it).`, b.sim.threadInMetal.line);
    // (when it's a CUT that goes further, that is said below with the sizes; this is for a rapid that does)
    const cutsFurther = b.sim.face - b.sim.length < a.sim.face - a.sim.length - tol;
    if (b.sim.lowestZ < a.sim.lowestZ - tol && !cutsFurther) add("stop", `A move goes ${sz(a.sim.lowestZ - b.sim.lowestZ)} closer to the chuck than anything in the current program (to ${zText(b.sim.lowestZ, u)}). Rapid or cut, the jaws are there.`);
  }
  if (a.mill && b.mill) {
    if (b.mill.rapidHits > a.mill.rapidHits) add("stop", `A rapid move crosses metal that hasn't been cut away yet (line ${b.mill.firstHit?.line ?? "?"}), which no rapid in the current program does.`, b.mill.firstHit?.line ?? null);
    for (const t of Object.keys(b.mill.widest)) {
      const was = a.mill.widest[t] || 0;
      const now = b.mill.widest[t];
      if (was > 0 && now > was * 1.3 + a.mill.cell * 2) add(speedsMayRise ? "look" : "stop", `T${t} cuts a path ${sz(now)} wide in one pass, where the current program never has it cutting more than ${sz(was)} wide. That's a much heavier cut for the same feed.`);
    }
  }
  measured.push("How much metal any single pass or plunge takes off.");

  // -- the part it makes
  if (a.kind === "lathe" && b.kind === "lathe" && a.sim && b.sim) {
    const fromA = a.sim.face - a.sim.length;
    const fromB = b.sim.face - b.sim.length;
    if (fromB < fromA - tol) add("stop", `It cuts ${sz(fromA - fromB)} closer to the chuck than the current program (to ${zText(fromB, u)}, where the current one stops at ${zText(fromA, u)}). The jaws are there.`);
    else if (fromB > fromA + tol) add(changed, `It stops cutting ${sz(fromB - fromA)} short of where the current program does (${zText(fromB, u)} against ${zText(fromA, u)}).`);
    if (Math.abs(a.sim.face - b.sim.face) > tol) add(changed, `The front face moved from ${zText(a.sim.face, u)} to ${zText(b.sim.face, u)}.`);

    if (a.sim.bore || b.sim.bore) {
      // Drilled or bored: the follower only sees the outside, and a boring bar's
      // cuts look to it like turning. So nothing about the shape is taken from
      // it; instead every cutting move has to be the same as before.
      const was = a.cutMoves.slice().sort();
      const now = b.cutMoves.slice().sort();
      if (!same(was, now)) {
        const differ = now.filter((m) => !was.includes(m)).length + was.filter((m) => !now.includes(m)).length;
        add(changed, `This part is drilled or bored, and the app can't measure inside shapes. A rewrite of it only passes when every cutting move is exactly the same as in the current program, and ${differ} ${differ === 1 ? "isn't" : "aren't"}.`);
      } else {
        measured.push("Every cutting move is identical to the current program's (the part is drilled or bored, so its shape can't be measured any other way).");
      }
      notMeasured.push("Rapid moves inside the hole: the app doesn't know how big the hole is.");
    } else {
      const steps = sizeChanges(a.sizes, b.sizes, tol, u);
      // the whole outline, so a taper, a radius or a chamfer can't change unnoticed
      const shape = profileDifference(a.sim, b.sim);
      // Breaking the edges (the commonest thing a rewrite is asked for: no more
      // deburring by hand) changes the outline, but only at the corners. That's
      // told apart from a real change of size and said for what it is, as
      // something to check against the drawing rather than a stop.
      const corner = u === "mm" ? 1.5 : 0.06;
      const edges = shape.worst > tol && shape.worst <= corner && cornersOnly(a.sizes, b.sizes, tol, corner) && removesOnly(a.sim, b.sim, tol) && atSharpCorners(a.sim, b.sim, tol, corner);
      if (edges) {
        add("look", `Only the corners change: every diameter and every length is the same, and the most any corner moves is ${sz(shape.worst)} (edge breaks or chamfers). Check the drawing allows them.`);
      } else {
        for (const text of steps) add(changed, text);
        if (shape.worst > tol && !steps.length) {
          add(changed, `The finished shape is different by ${sz(shape.worst)} near ${zText(shape.z, u)}: the current program leaves Ø${sz(shape.was * 2)} there and this leaves Ø${sz(shape.now * 2)}.`);
        }
      }
      measured.push(`The finished outside shape, end to end, to within ${sz(tol)}${edges ? ", apart from the corners" : ""}.`);
    }
    const th = (t) => `${n4(t.z0)}|${n4(t.z1)}|${n4(t.minor)}|${n4(t.pitch)}`;
    const thA = a.sim.threads.map(th).sort().join(";");
    const thB = b.sim.threads.map(th).sort().join(";");
    if (thA !== thB) add(changed, a.sim.threads.length && !b.sim.threads.length ? "The thread is gone." : !a.sim.threads.length ? "It cuts a thread the current program doesn't." : "The thread is different (its length, root diameter or lead).");
    else if (a.sim.threads.length) measured.push("The thread: its length, root diameter, lead, and how deep each pass cuts.");

    // a rapid into the bar that the current program doesn't have is a stop even
    // where the model is unsure of itself (a bore, the sub-spindle)
    const spot = (c) => `${c.z.toFixed(3)}|${c.r.toFixed(3)}`;
    const hadHit = new Set(a.sim.collisions.map(spot));
    const newHits = b.sim.collisions.filter((c) => !hadHit.has(spot(c)));
    if (newHits.length && (b.sim.unsure || b.info.offsets.length > 1)) {
      const c = newHits[0];
      add("stop", `A rapid move ends up ${sz(c.depth)} inside the bar at ${zText(c.z, u)}, and the current program has no such move.`, c.line);
    }
    if (a.sim.guessed) add("look", "The stock size isn't on the part, so rapid moves couldn't be checked against the bar. Add it and run this again.");
    else measured.push("Every rapid move against the bar as it stands at that moment, including where each tool lands after a tool change.");
    measured.push("How close to the chuck it cuts.");
  } else if (a.kind === "mill" && b.kind === "mill" && a.mill && b.mill) {
    // the two blocks, square for square
    const A = a.mill.final;
    const B = b.mill.final;
    let worst = 0;
    let at = -1;
    let differ = 0;
    const zTol = Math.max(tol, 1e-5);
    if (A.length === B.length) {
      for (let k = 0; k < A.length; k++) { const d = Math.abs(A[k] - B[k]); if (d > zTol) { differ += 1; if (d > worst) { worst = d; at = k; } } }
    }
    if (A.length !== B.length) add(changed, "The cuts reach so differently that the two parts couldn't be laid over each other.");
    else if (differ) {
      const x = a.mill.x0 + ((at % a.mill.nx) + 0.5) * a.mill.cell;
      const y = a.mill.y0 + (Math.floor(at / a.mill.nx) + 0.5) * a.mill.cell;
      add(changed, `The part comes out a different shape. The biggest difference is at X${n4(Number(x.toFixed(2)))} Y${n4(Number(y.toFixed(2)))}: the current program leaves Z${n4(A[at])} there and this leaves Z${n4(B[at])}.`);
    }
    measured.push(`The cut shape from above, square by square (each about ${sz(a.mill.cell)} across), and its depth exactly.`);
    notMeasured.push(`Anything smaller than about ${sz(a.mill.cell)} across, and the shape of each cutter's end (every cutter is taken as flat).`);
    for (const t of Object.keys(b.perTool).map(Number)) {
      const was = a.perTool[t];
      const now = b.perTool[t];
      if (!was || !now.cuts || !was.cuts) continue;
      if (now.zLow < was.zLow - tol) add("stop", `T${t} cuts deeper than it does in the current program: Z${n4(now.zLow)} against Z${n4(was.zLow)}.`);
    }
    if (b.reach && a.reach) {
      if (b.reach.zMin < a.reach.zMin - tol) add("stop", `It cuts deeper than the current program: Z${n4(b.reach.zMin)} against Z${n4(a.reach.zMin)}.`);
      const wider = [["X", "x"], ["Y", "y"]].filter(([, k]) => b.reach[k][0] < a.reach[k][0] - tol || b.reach[k][1] > a.reach[k][1] + tol).map(([name]) => name);
      if (wider.length) add("look", `Its cuts reach further in ${wider.join(" and ")} than the current program's. Check the vise and clamps are clear.`);
    }
    if (a.travelLow != null && b.travelLow != null && b.travelLow < a.travelLow - tol) add("stop", `Rapid moves travel across the part lower than they ever did: at Z${n4(b.travelLow)}, where the current program never goes below Z${n4(a.travelLow)}. That height isn't known to clear the part and the clamps.`);
    if (b.travelLow != null && a.travelLow == null) add("look", "It has rapid moves across the part and the current program has none to compare their height with.");
    if (a.plungeLow != null && b.plungeLow != null && b.plungeLow < a.plungeLow - tol) add("stop", `A rapid move straight down ends lower than any does now: Z${n4(b.plungeLow)} against Z${n4(a.plungeLow)}.`);
    measured.push("How deep each tool cuts, and the height rapid moves travel at.");
    notMeasured.push("Whether a rapid move hits the part: on a mill the app doesn't know where the block really sits.");
  } else if (b.kind === "lathe" && !b.sim) {
    add("stop", "No cutting moves could be followed in it, so nothing about what it makes could be checked.");
  } else if (b.kind === "mill" && !b.mill) {
    add("stop", "No cutting moves could be followed in it, so nothing about what it makes could be checked.");
  }

  // -- stops the operator relied on
  const whyA = a.stops.filter((s) => !s.optional).map((s) => s.why || "(no reason written)");
  const whyB = b.stops.filter((s) => !s.optional).map((s) => s.why || "(no reason written)");
  if (whyB.length < whyA.length) add("look", `It stops for the operator ${whyB.length} time${whyB.length === 1 ? "" : "s"} where the current program stops ${whyA.length} (${whyA.join("; ")}). Check nothing that needs doing by hand was dropped.`);
  if (whyB.length > whyA.length) add("look", `It stops for the operator ${whyB.length} time${whyB.length === 1 ? "" : "s"} where the current program stops ${whyA.length}.`);
  for (const s of b.stops) if (!s.why) add("look", "An operator stop has no comment saying what to do.", s.line);

  if (a.time?.seconds > 0 && b.time?.seconds > 0) {
    const d = b.time.seconds - a.time.seconds;
    add("note", `Estimated run time: about ${fmtDuration(b.time.seconds)} a part${Math.abs(d) >= 2 ? ` (${d < 0 ? fmtDuration(-d) + " quicker" : fmtDuration(d) + " longer"} than the current program)` : ", the same as now"}.`);
  }

  // -- and everything the ordinary checker says about any program
  const before = new Set(checkForPart(oldContent, part, machineFacts).map((f) => f.text));
  for (const f of checkForPart(newContent, part, machineFacts)) {
    const was = before.has(f.text);
    // The current program has this too: the draft is no worse for it, so it
    // can't be what fails the draft. It's still shown.
    if (was && f.level === "stop") out.push({ ...f, level: "look", text: `${f.text} (The current program has this too.)`, from: "rules", was });
    // A position with no decimal point can mean ten-thousandths. In a draft that's a stop.
    else if (!was && /no decimal point/.test(f.text)) out.push({ ...f, level: "stop", from: "rules", was });
    else out.push({ ...f, from: "rules", was });
  }

  // -- a program with things the follower can't follow, whose code has changed:
  //    nothing above can be relied on for it
  const beyond = [
    (a.opaque.length || b.opaque.length) && "macros, live tools, the sub-spindle or sub-programs",
    (a.shifts.length || b.shifts.length) && "lines that move the coordinate system",
    (a.text.tail.length || b.text.tail.length) && "sub-programs after the end",
  ].filter(Boolean);
  if (beyond.length && !kept.same) {
    unmeasured = `This program has ${beyond.join(", and ")}. The app can't follow those, so it could not measure this rewrite: ${kept.changed} line${kept.changed === 1 ? "" : "s"} of code changed and nothing here vouches for them.`;
    notMeasured.unshift(unmeasured);
  }
  if (kept.same) measured.unshift("Every line of code is the same as the current program's, word for word. Only comments changed, or a speed or feed came down.");
  measured.unshift("Program number, units, work offset, each tool's offset number, and that every tool is on the machine's list.");
  return finish({ measured, notMeasured });
}

// Are the two parts the same apart from their corners? Every straight
// diameter is still there, the same size, and its straight part is the same or
// shorter by no more than `corner` at each end (a chamfer eats into it from
// the corner). Nothing new appears, and no straight part gets longer.
function cornersOnly(a, b, tol, corner) {
  if (!a || !b) return false;
  const flat = (x) => x.steps.filter((s) => !s.groove);
  const A = flat(a), B = flat(b);
  if (A.length !== B.length) return false;
  if (a.steps.filter((s) => s.groove).length !== b.steps.filter((s) => s.groove).length) return false;
  return A.every((s, i) => {
    const t = B[i];
    // the straight part can only get shorter, from its ends (a chamfer eats into it); never longer, which is a shoulder that moved
    return Math.abs(s.dia - t.dia) <= tol
      && t.z1 <= s.z1 + tol && t.z0 >= s.z0 - tol
      && s.z1 - t.z1 <= corner + tol && t.z0 - s.z0 <= corner + tol;
  });
}
// ...and the draft only takes metal away there, never leaves more.
function removesOnly(simA, simB, tol) {
  const lo = Math.max(simA.face - simA.length, simB.face - simB.length);
  const hi = Math.min(simA.face, simB.face);
  for (const z of simA.zs) if (z > lo && z < hi && simB.radiusAt(simB.final, z) > simA.radiusAt(simA.final, z) + tol) return false;
  return true;
}

// ...and only at corners that were sharp. Breaking a square shoulder or the
// edge of the face is an edge break; making an existing chamfer bigger or a
// fillet smaller is a change to a size on the drawing, and isn't excused here.
function atSharpCorners(simA, simB, tol, corner) {
  // (the outline as cut, not as drawn: a thread is drawn as teeth, and every tooth is a sharp corner)
  const pts = simplifyOutline([[simA.back, 0], ...Array.from(simA.zs, (z, i) => [z, simA.final[i]]), [simA.face, 0]]);
  const sharp = [];
  for (let i = 1; i < pts.length - 1; i++) {
    const v1 = [pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]];
    const v2 = [pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]];
    const l1 = Math.hypot(...v1), l2 = Math.hypot(...v2);
    if (l1 < 1e-9 || l2 < 1e-9) continue;
    const turn = Math.acos(Math.max(-1, Math.min(1, (v1[0] * v2[0] + v1[1] * v2[1]) / (l1 * l2))));
    if (turn >= Math.PI / 3 && pts[i][1] > tol) sharp.push(pts[i]);   // 60 degrees or more, and not on the centre line
  }
  const lo = Math.max(simA.face - simA.length, simB.face - simB.length);
  const hi = Math.min(simA.face, simB.face);
  for (const z of simA.zs) {
    if (z < lo || z > hi) continue;
    const ra = simA.radiusAt(simA.final, z);
    if (Math.abs(ra - simB.radiusAt(simB.final, z)) <= tol) continue;
    if (!sharp.some((c) => Math.hypot(c[0] - z, c[1] - ra) <= corner * 1.5 + tol)) return false;
  }
  return true;
}

// Each diameter the current program cuts, looked for in the draft.
function sizeChanges(a, b, tol, u) {
  if (!a || !b) return [];
  const out = [];
  const where = (s) => (s.groove ? `at ${zText(s.mid, u)}` : `from ${zText(s.z1, u)} to ${zText(s.z0, u)}`);
  const name = (s) => `${s.groove ? "The groove " : ""}Ø${sizeText(s.dia, u)} ${where(s)}`;
  const match = (x, y) => x.groove === y.groove && Math.abs(x.dia - y.dia) <= tol
    && (x.groove ? Math.abs(x.mid - y.mid) <= tol * 2 : Math.abs(x.z0 - y.z0) <= tol && Math.abs(x.z1 - y.z1) <= tol);
  const overlap = (x, y) => Math.min(x.z1, y.z1) - Math.max(x.z0, y.z0);
  const used = new Set();
  for (const s of a.steps) {
    const hit = b.steps.find((t) => !used.has(t) && match(s, t));
    if (hit) { used.add(hit); continue; }
    const near = b.steps.filter((t) => !used.has(t) && t.groove === s.groove).sort((p, q) => overlap(s, q) - overlap(s, p))[0];
    if (near && overlap(s, near) > 0) { used.add(near); out.push(`${name(s)} in the current program is ${name(near)} in this one.`); }
    else out.push(`${name(s)} in the current program isn't cut by this one.`);
  }
  for (const t of b.steps) if (!used.has(t)) out.push(`It cuts ${name(t)}, which the current program doesn't.`);
  return out;
}

// How far apart two finished outlines are, measured the way a gauge would:
// the distance from each point on one to the nearest point on the other,
// whichever direction that is. (Comparing diameters at the same Z isn't
// enough: at a square shoulder the diameter jumps, so a shoulder that moved a
// thousandth, or a fillet that ends a thousandth higher, hides in the jump.)
// Returns the worst of those distances and where it is.
export function profileDifference(simA, simB) {
  const lo = Math.max(simA.face - simA.length, simB.face - simB.length);
  const hi = Math.min(simA.face, simB.face);
  const line = (sim) => {
    const pts = [];
    for (let i = 0; i < sim.zs.length; i++) if (sim.zs[i] >= lo - 1e-9 && sim.zs[i] <= hi + 1e-9) pts.push([sim.zs[i], sim.final[i]]);
    return simplifyOutline(pts);
  };
  const A = line(simA);
  const B = line(simB);
  if (A.length < 2 || B.length < 2) return { worst: 0, z: hi, was: 0, now: 0 };
  const step = Math.max((hi - lo) / 800, 1e-6);
  // points along a line: its corners, and every little way between them
  const along = (L) => {
    const pts = [];
    for (let i = 1; i < L.length; i++) {
      const [z0, r0] = L[i - 1];
      const [z1, r1] = L[i];
      const n = Math.max(1, Math.ceil(Math.hypot(z1 - z0, r1 - r0) / step));
      for (let k = 0; k < n; k++) pts.push([z0 + ((z1 - z0) * k) / n, r0 + ((r1 - r0) * k) / n]);
    }
    pts.push(L[L.length - 1]);
    return pts;
  };
  const toLine = (p, L) => {
    let best = Infinity;
    for (let i = 1; i < L.length; i++) {
      const [z0, r0] = L[i - 1];
      const [z1, r1] = L[i];
      const dz = z1 - z0, dr = r1 - r0;
      const len2 = dz * dz + dr * dr;
      const t = len2 < 1e-18 ? 0 : Math.max(0, Math.min(1, ((p[0] - z0) * dz + (p[1] - r0) * dr) / len2));
      const d = Math.hypot(p[0] - (z0 + dz * t), p[1] - (r0 + dr * t));
      if (d < best) best = d;
    }
    return best;
  };
  let worst = 0;
  let z = hi;
  // (a little in from each end, where one outline may simply stop before the other)
  const inside = (p) => p[0] > lo + step && p[0] < hi - step;
  for (const p of along(A)) if (inside(p)) { const d = toLine(p, B); if (d > worst) { worst = d; z = p[0]; } }
  for (const p of along(B)) if (inside(p)) { const d = toLine(p, A); if (d > worst) { worst = d; z = p[0]; } }
  return { worst, z, was: simA.radiusAt(simA.final, z), now: simB.radiusAt(simB.final, z) };
}
