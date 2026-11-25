// A lathe program written from sizes, for the simple turned parts that make up
// most of the work: a pin, a spacer, a stud. Someone types the bar, the
// diameters and lengths, and which tools are in which pocket; this writes the
// Haas program.
//
// No AI in here, and no guessing. It is a fixed recipe, the same one every
// time: face the end, rough the outside with G71, finish it with G70, then cut
// a thread and part off if asked. Every number in the program comes from the
// form, and every number on the form is checked before anything is written.
//
// Then it proves its own work. The program it wrote is run through the same
// software that follows the tool for every other program (cncSolid.js), and
// what that says the program cuts has to match what was asked for, size for
// size, with no rapid move through the bar. If it doesn't match, the program
// is not offered. That is a check on this file, not on the machine: the result
// is still NOT PROVEN until someone proves it out.
//
// What it does not do: bores and drilled holes, grooves, tapers, radii, a
// second operation on the other end, live tools, the sub-spindle, or metric.
// Anything like that is Mastercam's job, or the AI rewrite's.

import { MACHINES } from "./machines.js";
import { splitMachines, splitPrograms } from "./cncParts.js";
import { checkProgram } from "./cncGcode.js";
import { cleanTools } from "./cncPack.js";
import { toolpath } from "./cncPath.js";
import { simulateLathe, parseStock, partSizes, sizeText } from "./cncSolid.js";
import { stampDraft } from "./cncAi.js";

// ---- starting speeds ----------------------------------------------------------
//
// For a carbide insert, and on the careful side on purpose: a first part that
// cuts slowly is fine, one that chatters or burns an insert is not. They are
// starting points the form shows and lets anyone change.
//   sfm     surface speed, feet a minute (G96)
//   rough   feed per turn when roughing      finish  feed per turn on the last pass
//   depth   how much each roughing pass takes off, per side
// Order matters: the first one whose words match the part's material wins.
export const MATERIALS = [
  { key: "stainless", label: "Stainless steel (303, 304, 316)", match: /stainless|\b30[34]\b|\b316\b|17-4|\b416\b/i, sfm: 250, rough: 0.007, finish: 0.003, depth: 0.04 },
  { key: "alloy", label: "Alloy steel (4140, 4340)", match: /41[34]0|4340|alloy|chromoly|tool steel|\bO1\b|\bA2\b/i, sfm: 280, rough: 0.008, finish: 0.004, depth: 0.05 },
  { key: "aluminum", label: "Aluminum (6061)", match: /alum|6061|7075|2024/i, sfm: 600, rough: 0.01, finish: 0.004, depth: 0.08 },
  { key: "brass", label: "Brass or bronze", match: /brass|bronze|copper/i, sfm: 450, rough: 0.008, finish: 0.004, depth: 0.06 },
  { key: "plastic", label: "Plastic (Delrin, nylon)", match: /delrin|acetal|nylon|plastic|uhmw|pvc|abs/i, sfm: 500, rough: 0.01, finish: 0.005, depth: 0.08 },
  { key: "steel", label: "Mild steel (1018, 12L14)", match: /1018|12l14|\ba36\b|mild|crs|cold.?rolled|steel/i, sfm: 350, rough: 0.01, finish: 0.004, depth: 0.06 },
];
export const materialFor = (text) => MATERIALS.find((m) => m.match.test(String(text || ""))) || null;

// Fixed by the recipe, in one place so the program and its checks agree.
const CLEAR_X = 0.2;      // how far outside the bar the tool waits, on the diameter
const CLEAR_Z = 0.1;      // how far in front of the face it starts
const PAST_CENTRE = 0.032; // facing and parting go this far past centre (twice a 1/64 nose radius)
const FROM_JAWS = 0.25;   // the least distance kept between any cut and the jaws
const FINISH_X = 0.02;    // left for the finishing pass, on the diameter
const FINISH_Z = 0.005;   // and on each face
const PART_PAST = 0.03;   // the outside is turned this far beyond the part-off cut

const num = (v) => { const n = typeof v === "number" ? v : parseFloat(String(v ?? "").trim()); return Number.isFinite(n) ? n : NaN; };
const lathes = () => MACHINES.filter((m) => m.kind === "lathe");

// ---- a blank form, filled in from what the part already says -------------------
export function specFromPart(part, machineFacts = {}) {
  const machine = splitMachines(part?.machine).find((k) => lathes().some((m) => m.key === k)) || "";
  const tools = cleanTools(machineFacts?.[machine]?.tools);
  const pick = (re) => tools.find((t) => re.test(t.what));
  const turn = pick(/rough|turn|cnmg|wnmg|dnmg|vnmg|\bod\b/i);
  const thread = pick(/thread/i);
  const part_ = pick(/part|cut.?off/i);
  const stock = parseStock(part?.facts?.stock);
  const mat = materialFor(part?.material);
  const stick = /(\d*\.?\d+)\s*(?:"|″|in(?:ch(?:es)?)?\.?)?\s*stick/i.exec(String(part?.facts?.holding || ""));
  return {
    number: String((part?.programs || splitPrograms(part?.programNo)).filter(Boolean)[0] || "").replace(/\D/g, ""),
    name: String(part?.name || "").trim(),
    machine,
    material: String(part?.material || "").trim(),
    stockDia: stock && !stock.mm ? String(stock.dia) : "",
    stickOut: stick ? stick[1] : "",
    steps: [{ dia: "", len: "" }],
    chamfer: "0.03",
    edgeBreak: "0.01",
    thread: null,     // { tpi, len }
    partOff: null,    // { width }
    tools: {
      turn: turn ? { t: String(Number(turn.t)), name: turn.what } : { t: "", name: "" },
      thread: thread ? { t: String(Number(thread.t)), name: thread.what } : { t: "", name: "" },
      part: part_ ? { t: String(Number(part_.t)), name: part_.what } : { t: "", name: "" },
    },
    cut: mat ? { sfm: String(mat.sfm), rough: String(mat.rough), finish: String(mat.finish), depth: String(mat.depth), maxRpm: "2500" } : { sfm: "", rough: "", finish: "", depth: "", maxRpm: "2500" },
  };
}

// ---- reading the form ----------------------------------------------------------
//
// Numbers out of the boxes, plus everything worked out from them. Nothing is
// decided here; checkSpec says whether it's usable.
export function readSpec(spec) {
  const steps = (spec?.steps || []).map((s) => ({ dia: num(s.dia), len: num(s.len) }));
  let z = 0;
  const ends = steps.map((s) => (z += s.len));           // distance from the face to the end of each step
  const total = ends.length ? ends[ends.length - 1] : 0;
  const thread = spec?.thread ? { tpi: num(spec.thread.tpi), len: num(spec.thread.len) } : null;
  const partOff = spec?.partOff ? { width: num(spec.partOff.width) } : null;
  const height = thread ? 0.6134 / thread.tpi : 0;       // depth of a 60 degree thread, per side
  // A thread needs a lead-in chamfer at least as deep as the thread itself.
  const chamfer = Math.max(num(spec?.chamfer) || 0, thread ? Math.ceil((height + 0.005) * 1000) / 1000 : 0);
  const cutEnd = partOff ? total + partOff.width + PART_PAST : total;   // how far from the face the turning goes
  const cut = { sfm: num(spec?.cut?.sfm), rough: num(spec?.cut?.rough), finish: num(spec?.cut?.finish), depth: num(spec?.cut?.depth), maxRpm: num(spec?.cut?.maxRpm) };
  const tool = (k) => ({ t: num(spec?.tools?.[k]?.t), name: String(spec?.tools?.[k]?.name || "").trim() });
  return {
    number: String(spec?.number || "").replace(/\D/g, ""),
    name: String(spec?.name || "").trim(),
    machine: spec?.machine || "",
    material: String(spec?.material || "").trim(),
    stockDia: num(spec?.stockDia), stickOut: num(spec?.stickOut),
    steps, ends, total, cutEnd,
    chamfer, chamferAsked: num(spec?.chamfer) || 0, edgeBreak: num(spec?.edgeBreak) || 0,
    thread: thread ? { ...thread, height, minor: steps[0] ? steps[0].dia - 2 * height : NaN, lead: 1 / thread.tpi } : null,
    partOff,
    tools: { turn: tool("turn"), thread: tool("thread"), part: tool("part") },
    cut,
  };
}

// ---- is it something that can be made? ------------------------------------------
//
// errors stop a program being written and say which box to look at; warnings
// don't stop it, they are things to think about first.
export function checkSpec(spec, { machineFacts = {} } = {}) {
  const s = readSpec(spec);
  const errors = [];
  const warnings = [];
  const bad = (field, text) => errors.push({ field, text });
  const warn = (field, text) => warnings.push({ field, text });
  const ok = (v) => Number.isFinite(v) && v > 0;

  if (!s.name) bad("name", "Give it a name.");
  if (!s.number) bad("number", "Give it a program number (digits only).");
  else if (s.number.length > 5) bad("number", "A program number is at most five digits.");
  else if (Number(s.number) === 0) bad("number", "Program number 0 can't be used.");
  else if (Number(s.number) >= 9000) warn("number", "Programs numbered 9000 and up are often locked on a Haas. Pick a lower number unless you know it's free.");
  if (!lathes().some((m) => m.key === s.machine)) bad("machine", "Pick a lathe. This only writes lathe programs.");
  if (!s.material) bad("material", "Say what it's made of.");

  if (!ok(s.stockDia)) bad("stockDia", "Give the bar's diameter.");
  if (!ok(s.stickOut)) bad("stickOut", "Say how far the bar sticks out of the jaws.");

  if (!s.steps.length) bad("steps", "Add at least one diameter.");
  s.steps.forEach((st, i) => {
    if (!ok(st.dia)) bad(`dia${i}`, `Give diameter ${i + 1}.`);
    if (!ok(st.len)) bad(`len${i}`, `Give the length of diameter ${i + 1}.`);
  });
  const sized = s.steps.every((st) => ok(st.dia) && ok(st.len));
  if (sized && s.steps.length) {
    for (let i = 1; i < s.steps.length; i++) {
      if (!(s.steps[i].dia > s.steps[i - 1].dia)) bad(`dia${i}`, `Diameter ${i + 1} has to be bigger than diameter ${i}. This turns parts that step up toward the chuck; a part that steps back down needs a second program for the other end.`);
    }
    const biggest = s.steps[s.steps.length - 1].dia;
    if (ok(s.stockDia) && !(biggest <= s.stockDia - 0.01 + 1e-9)) bad("stockDia", `The bar has to be at least 0.010 bigger than the biggest diameter (${sizeText(biggest)}) so it cleans up.`);
    if (ok(s.stockDia) && s.stockDia - s.steps[0].dia > 2.5) warn("stockDia", "That's a lot of metal to take off the first diameter. A smaller bar would be quicker.");

    if (s.chamferAsked < 0) bad("chamfer", "The chamfer can't be negative.");
    if (!(s.steps[0].dia - 2 * s.chamfer > 0.02)) bad("chamfer", "The front chamfer is too big for the first diameter.");
    if (!(s.chamfer < s.steps[0].len)) bad("chamfer", "The front chamfer is longer than the first diameter.");
    if (s.edgeBreak < 0) bad("edgeBreak", "The edge break can't be negative.");
    for (let i = 1; i < s.steps.length; i++) {
      if (!(s.steps[i].dia - 2 * s.edgeBreak > s.steps[i - 1].dia + 1e-9)) bad("edgeBreak", `The edge break is too big for the step up to diameter ${i + 1}.`);
      if (!(s.edgeBreak < s.steps[i].len)) bad("edgeBreak", `The edge break is longer than diameter ${i + 1}.`);
    }
    s.steps.forEach((st, i) => { if (st.len / st.dia > 4) warn(`len${i}`, `Diameter ${i + 1} is more than four times as long as it is thick. With nothing supporting the end it may chatter or bend.`); });

    if (ok(s.stickOut)) {
      const need = s.cutEnd + FROM_JAWS;
      if (!(s.stickOut >= need - 1e-9)) bad("stickOut", `It cuts ${sizeText(s.cutEnd)} back from the face, so the bar has to stick out at least ${sizeText(need)} to stay ${sizeText(FROM_JAWS)} clear of the jaws.`);
      if (ok(s.stockDia) && s.stickOut > s.stockDia * 4) warn("stickOut", "The bar sticks out more than four times its diameter. Support the end or expect chatter.");
    }
  }

  // tools: each job needs a pocket, a name, and a pocket of its own
  const need = [["turn", "turning"], ...(s.thread ? [["thread", "threading"]] : []), ...(s.partOff ? [["part", "part-off"]] : [])];
  const seen = new Map();
  const listed = new Map(cleanTools(machineFacts?.[s.machine]?.tools).map((r) => [Number(r.t), r.what]));
  for (const [k, word] of need) {
    const t = s.tools[k];
    if (!(Number.isInteger(t.t) && t.t >= 1 && t.t <= 24)) { bad(`tool_${k}`, `Say which pocket the ${word} tool is in (1 to 24).`); continue; }
    if (!t.name) bad(`tool_${k}`, `Say what the ${word} tool is.`);
    if (seen.has(t.t)) bad(`tool_${k}`, `The ${word} tool and the ${seen.get(t.t)} tool can't both be in pocket ${t.t}.`);
    seen.set(t.t, word);
    if (listed.size && !listed.has(t.t)) warn(`tool_${k}`, `Pocket ${t.t} isn't on the ${MACHINES.find((m) => m.key === s.machine)?.short || "machine"}'s tool list. Check that tool is really there.`);
  }
  if (!listed.size && s.machine) warn("tools", "This machine's tool list isn't filled in, so the pockets can't be checked against it.");

  // speeds and feeds: present, and inside what a lathe like this can sensibly do
  const range = (field, v, lo, hi, what) => { if (!ok(v)) bad(field, `Give ${what}.`); else if (v < lo || v > hi) bad(field, `${what[0].toUpperCase()}${what.slice(1)} should be between ${lo} and ${hi}.`); };
  range("sfm", s.cut.sfm, 50, 1500, "the surface speed");
  range("maxRpm", s.cut.maxRpm, 100, 6000, "the top spindle speed");
  range("rough", s.cut.rough, 0.001, 0.03, "the roughing feed");
  range("finish", s.cut.finish, 0.001, 0.02, "the finishing feed");
  range("depth", s.cut.depth, 0.005, 0.2, "the depth of each roughing pass");
  if (ok(s.cut.rough) && ok(s.cut.finish) && s.cut.finish > s.cut.rough) warn("finish", "The finishing feed is higher than the roughing feed. It's usually the other way round.");
  const usual = materialFor(s.material);
  if (usual && ok(s.cut.sfm) && s.cut.sfm > usual.sfm * 1.5) warn("sfm", `That's a lot faster than the usual starting speed for this material (${usual.sfm}).`);
  if (!usual && s.material) warn("material", "This material isn't one the app has starting speeds for. Check the speeds and feeds yourself.");

  if (s.thread) {
    if (!ok(s.thread.tpi) || s.thread.tpi < 4 || s.thread.tpi > 80) bad("tpi", "Threads per inch should be between 4 and 80.");
    else if (sized && s.steps.length) {
      if (!ok(s.thread.len)) bad("threadLen", "Give the length of the thread.");
      else if (!(s.thread.len <= s.steps[0].len - Math.max(0.05, 1.5 * s.thread.lead) + 1e-9)) bad("threadLen", `The thread has to stop at least ${sizeText(Math.max(0.05, 1.5 * s.thread.lead))} short of the end of the first diameter, so the tool can pull out before the shoulder.`);
      if (!(s.thread.minor > 0.05)) bad("tpi", "That thread is too coarse for the first diameter.");
      if (Math.abs(s.thread.lead * 1e4 - Math.round(s.thread.lead * 1e4)) > 1e-6) warn("tpi", `${s.thread.tpi} threads per inch doesn't come out to a round lead (1/${s.thread.tpi} = ${s.thread.lead.toFixed(6)}). The program gives it to four places, as Haas's own examples do; measure the thread on the first part.`);
      if (s.chamfer > s.chamferAsked + 1e-9) warn("chamfer", `The front chamfer was made ${sizeText(s.chamfer)} so the thread has a lead-in as deep as itself.`);
    }
  }
  if (s.partOff) {
    if (!ok(s.partOff.width) || s.partOff.width < 0.04 || s.partOff.width > 0.25) bad("partWidth", "The part-off blade's width should be between 0.040 and 0.250.");
  }
  return { errors, warnings, ok: errors.length === 0 };
}

// ---- writing it ----------------------------------------------------------------
// A size as the control wants it: always a decimal point, no padding.
export const gnum = (v) => {
  const t = (Math.round(v * 1e4) / 1e4).toFixed(4).replace(/0+$/, "");
  return t === "-0." ? "0." : t;
};
const tcode = (t) => `T${String(t).padStart(2, "0")}${String(t).padStart(2, "0")}`;
// A comment the control will take: capitals, plain characters, no brackets.
const note = (text, max = 76) => String(text || "").toUpperCase().replace(/[^A-Z0-9 .,/\-+=:]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
const rpm50 = (v) => Math.max(100, Math.round(v / 50) * 50);

export function writeLathe(spec, { machineFacts = {}, date = new Date() } = {}) {
  const check = checkSpec(spec, { machineFacts });
  if (!check.ok) throw new Error(check.errors[0].text);
  const s = readSpec(spec);
  const X = s.stockDia + CLEAR_X;                      // where the tool waits, clear of the bar
  const L = [];
  const say = (text) => L.push(`(${note(text)})`);
  // Send the turret home before the next tool: X first, so it backs straight
  // away from the part, then Z. (The form Haas's own example programs use.)
  const home = () => { L.push("G00 G53 X0."); L.push("G53 Z0."); };
  const c = s.chamfer;
  const e = s.edgeBreak;
  const first = s.steps[0].dia;
  const last = s.steps[s.steps.length - 1].dia;

  L.push("%");
  L.push(`O${s.number.padStart(5, "0")} (${note(s.name, 40)})`);
  say(`${s.material} - BAR ${sizeText(s.stockDia)} DIA`);
  say(`BAR MUST STICK OUT ${sizeText(s.cutEnd + FROM_JAWS)} OR MORE FROM THE JAWS`);
  say("Z0 IS THE FINISHED FRONT FACE. LEAVE 0.030 OR LESS TO FACE OFF");
  say("START WITH THE TURRET WELL CLEAR OF THE CHUCK AND THE BAR");
  // The safe start-up line Haas's own examples use. G18 (the Z-X plane) is the
  // lathe's default, but G71 needs it active, so it's said out loud.
  L.push("G18 G20 G40 G80 G99");
  L.push("G54");
  L.push(`G50 S${Math.round(s.cut.maxRpm)}`);

  // -- turning
  L.push(`${tcode(s.tools.turn.t)} (${note(s.tools.turn.name, 40)})`);
  L.push(`G96 S${Math.round(s.cut.sfm)} M03`);
  L.push(`G00 X${gnum(X)} Z${gnum(CLEAR_Z)} M08`);
  say("FACE THE END");
  L.push("G00 Z0.");
  L.push(`G01 X${gnum(-PAST_CENTRE)} F${gnum(s.cut.finish)}`);
  L.push(`G00 Z${gnum(CLEAR_Z)}`);
  L.push(`G00 X${gnum(X)}`);
  say("ROUGH THE OUTSIDE");
  L.push(`G71 P10 Q20 U${gnum(FINISH_X)} W${gnum(FINISH_Z)} D${gnum(s.cut.depth)} F${gnum(s.cut.rough)}`);
  L.push(`N10 G00 X${gnum(first - 2 * c)}`);
  L.push(`G01 Z0. F${gnum(s.cut.finish)}`);
  if (c > 0) L.push(`X${gnum(first)} Z${gnum(-c)}`);
  s.steps.forEach((st, i) => {
    if (i > 0) {
      // up the shoulder, then break its corner
      if (e > 0) { L.push(`X${gnum(st.dia - 2 * e)}`); L.push(`X${gnum(st.dia)} Z${gnum(-(s.ends[i - 1] + e))}`); }
      else L.push(`X${gnum(st.dia)}`);
    }
    L.push(`Z${gnum(-(i === s.steps.length - 1 ? s.cutEnd : s.ends[i]))}`);
  });
  L.push(`N20 X${gnum(X)}`);
  say("FINISH THE OUTSIDE");
  L.push("G70 P10 Q20");
  L.push(`G00 X${gnum(X)} Z${gnum(CLEAR_Z)} M09`);
  L.push("M05");
  home();

  // -- thread
  if (s.thread) {
    const t = s.thread;
    const speed = Math.min(s.cut.maxRpm, 1000, rpm50((s.cut.sfm * 3.82 * 0.4) / first));
    const firstCut = Math.min(0.012, Math.max(0.004, Math.round((t.height / 3) * 1e4) / 1e4));
    say(`THREAD ${sizeText(first)} X ${t.tpi} TPI, ${sizeText(t.len)} LONG`);
    L.push(`${tcode(s.tools.thread.t)} (${note(s.tools.thread.name, 40)})`);
    L.push(`G97 S${speed} M03`);
    L.push(`G00 X${gnum(first + 0.2)} Z0.2 M08`);
    L.push("M23");
    L.push(`G76 X${gnum(t.minor)} Z${gnum(-t.len)} K${gnum(t.height)} D${gnum(firstCut)} F${t.lead.toFixed(4).replace(/0+$/, "")}`);
    L.push("M24");
    L.push(`G00 X${gnum(X)} Z0.2 M09`);
    L.push("M05");
    home();
  }

  // -- part off
  if (s.partOff) {
    const w = s.partOff.width;
    const speed = Math.min(s.cut.maxRpm, 1500, rpm50((s.cut.sfm * 3.82 * 0.6) / last));
    say(`PART OFF ${sizeText(s.total)} LONG. BLADE ${sizeText(w)} WIDE`);
    say("BLADE Z IS SET ON ITS EDGE NEAREST THE CHUCK");
    say("THE PART DROPS HERE");
    L.push(`${tcode(s.tools.part.t)} (${note(s.tools.part.name, 40)})`);
    L.push(`G97 S${speed} M03`);
    L.push(`G00 X${gnum(X)} Z${gnum(CLEAR_Z)} M08`);
    L.push(`G00 Z${gnum(-(s.total + w))}`);
    L.push(`G01 X${gnum(-PAST_CENTRE)} F0.003`);
    L.push(`G00 X${gnum(X)}`);
    L.push(`G00 Z${gnum(CLEAR_Z)} M09`);
    L.push("M05");
    home();
  }

  L.push("M30");
  L.push("%");
  return stampDraft(L.join("\n"), { date, label: "WRITTEN BY THE CNC CATALOG" });
}

// ---- proving its own work -------------------------------------------------------
//
// Follow the tool through the program that was just written and compare what
// it cuts with what was asked for. Returns { ok, problems, sizes }. A problem
// here means this file wrote something other than what the form said, so the
// program must not be offered.
export function proveWritten(spec, program, { machineFacts = {} } = {}) {
  const s = readSpec(spec);
  const problems = [];
  const tol = 0.0005;
  const off = (a, b) => Math.abs(a - b) > tol;
  const path = toolpath(program, { kind: "lathe" });
  const sim = path.kind === "lathe" ? simulateLathe(path, { dia: s.stockDia, len: null }) : null;
  if (!sim) return { ok: false, problems: ["The program that was written couldn't be followed."], sizes: null };
  const sizes = partSizes(sim);

  if (path.units !== "in") problems.push("It isn't an inch program.");
  if (off(sim.face, 0)) problems.push(`The front face is at Z${sizeText(sim.face)}, not Z0.`);
  if (off(sim.length, s.cutEnd)) problems.push(`It cuts ${sizeText(sim.length)} back from the face. The form asks for ${sizeText(s.cutEnd)}.`);
  if (sim.length + FROM_JAWS > s.stickOut + tol) problems.push("It cuts too close to the jaws.");
  if (sim.collisions.length) problems.push(`A rapid move goes through the bar (line ${sim.collisions[0].line}).`);
  if (sim.unsure) problems.push(`Not all of it could be followed: ${sim.unsure}.`);

  const turned = sizes.steps.filter((x) => !x.groove);
  if (turned.length !== s.steps.length) problems.push(`It cuts ${turned.length} diameter${turned.length === 1 ? "" : "s"}. The form asks for ${s.steps.length}.`);
  else {
    s.steps.forEach((st, i) => {
      const m = turned[i];
      const lastOne = i === s.steps.length - 1;
      const starts = i === 0 ? -s.chamfer : -(s.ends[i - 1] + s.edgeBreak);
      const ends = -(lastOne ? s.cutEnd : s.ends[i]);
      if (off(m.dia, st.dia)) problems.push(`Diameter ${i + 1} comes out ${sizeText(m.dia)}, not ${sizeText(st.dia)}.`);
      if (off(m.z1, starts)) problems.push(`Diameter ${i + 1} starts at Z${sizeText(m.z1)}, not Z${sizeText(starts)}.`);
      // (with a part-off, the last diameter ends in the slot, whose width the follower can only guess)
      if (!(lastOne && s.partOff) && off(m.z0, ends)) problems.push(`Diameter ${i + 1} ends at Z${sizeText(m.z0)}, not Z${sizeText(ends)}.`);
    });
  }

  if (s.thread) {
    const t = sim.threads[0];
    if (sim.threads.length !== 1 || !t) problems.push("The thread isn't there.");
    else {
      if (off(t.minor * 2, s.thread.minor)) problems.push(`The thread's root comes out ${sizeText(t.minor * 2)}, not ${sizeText(s.thread.minor)}.`);
      if (off(t.z0, -s.thread.len)) problems.push(`The thread ends at Z${sizeText(t.z0)}, not Z${sizeText(-s.thread.len)}.`);
      if (Math.abs(t.pitch - s.thread.lead) > 6e-5) problems.push("The thread's lead is wrong.");   // (written to four places)
    }
  } else if (sim.threads.length) problems.push("It cuts a thread nobody asked for.");

  const slots = sim.grooves.length;
  if (s.partOff) {
    if (slots !== 1) problems.push("The part-off cut isn't there.");
    else if (off(sim.grooves[0].z, -(s.total + s.partOff.width))) problems.push("The part-off cut is in the wrong place.");
  } else if (slots) problems.push("It cuts a groove nobody asked for.");

  // and the same rule checks every other program gets
  for (const f of checkProgram(program, { machineKind: "lathe", machineLabel: "the lathe", machineTools: cleanTools(machineFacts?.[s.machine]?.tools) })) {
    if (f.level === "stop") problems.push(f.text);
  }
  // nothing above the speeds on the form
  const tops = path.segs.reduce((m, g) => ({ clamp: Math.max(m.clamp, g.clamp || 0), css: Math.max(m.css, g.css ? g.s : 0), rpm: Math.max(m.rpm, g.css ? 0 : g.s) }), { clamp: 0, css: 0, rpm: 0 });
  if (tops.clamp > s.cut.maxRpm + 0.5 || tops.rpm > s.cut.maxRpm + 0.5) problems.push("A spindle speed is above the top speed on the form.");
  if (tops.css > s.cut.sfm + 0.5) problems.push("The surface speed is above the one on the form.");

  return { ok: problems.length === 0, problems, sizes };
}

// The whole job: check the form, write, prove. Never throws for a bad form.
export function makeProgram(spec, { machineFacts = {}, date = new Date() } = {}) {
  const check = checkSpec(spec, { machineFacts });
  if (!check.ok) return { ok: false, ...check, program: "", proof: null };
  const program = writeLathe(spec, { machineFacts, date });
  const proof = proveWritten(spec, program, { machineFacts });
  return { ok: proof.ok, ...check, program: proof.ok ? program : "", proof, rejected: proof.ok ? "" : program };
}

// The shape alone, for drawing the part while the form is still being filled
// in. Everything that isn't a size (tools, speeds, name, how far it sticks out)
// is stood in for, so the drawing appears as soon as the sizes make sense.
// Never saved, never offered: only what makeProgram returns is.
export function shapeProgram(spec) {
  const dias = (spec?.steps || []).map((x) => num(x.dia)).filter((v) => Number.isFinite(v) && v > 0);
  const bar = num(spec?.stockDia) > 0 ? spec.stockDia : dias.length ? String(Math.max(...dias) + 0.125) : "";
  const stand = {
    ...spec,
    number: "1", name: "PART", machine: lathes()[0]?.key || "", material: "STEEL", stockDia: bar, stickOut: "1000",
    tools: { turn: { t: "1", name: "TURN" }, thread: { t: "2", name: "THREAD" }, part: { t: "3", name: "PART OFF" } },
    cut: { sfm: "300", rough: "0.01", finish: "0.004", depth: "0.05", maxRpm: "2000" },
  };
  const made = makeProgram(stand);
  return made.ok ? { program: made.program, bar } : null;
}

// What's kept with the saved program: the form it was written from.
export function writtenRecord(spec, now = new Date()) {
  const s = readSpec(spec);
  return {
    kind: "written", at: now.getTime(),
    summary: `Written by the app from sizes: ${s.steps.map((st) => `Ø${sizeText(st.dia)} x ${sizeText(st.len)}`).join(", ")}${s.thread ? `, ${s.thread.tpi} TPI thread` : ""}${s.partOff ? ", parted off" : ""}.`,
    spec,
  };
}
export const writtenName = (spec) => `O${String(spec?.number || "").replace(/\D/g, "").padStart(5, "0")} from sizes.nc`;
