// The CNC assistant's side of a conversation: what's sent with each question,
// and what's done with the answer. The screen is CncChat.jsx; the prompt is on
// the server (lib/cncAi.js, the "ask" job).
//
// Memory, in three layers, all sent with every question:
//   the conversation   everything already asked and answered here (about this
//                      part, or about the shop), newest kept when it's long
//   remembered facts   things a person chose to keep from an answer
//                      ("Remember this"), for the whole shop or one part
//   the shop's records the part, its programs and measurements, every
//                      machine's tool list and notes, from the rest of the app

import { MACHINES } from "./machines.js";
import { splitMachines } from "./cncParts.js";
import { cleanMachineFacts } from "./cncPack.js";
import { buildAiPack, baselineOf } from "./cncAi.js";

const MAX_HISTORY = 50_000;       // characters of earlier conversation sent with a question
export const MAX_PHOTOS = 8;      // photos the AI looks at with one question (new ones first)
const MACHINE_PHOTOS = 3;         // of those, at most this many from the Machines page

// ---- what goes with a question ----------------------------------------------------
const when = (t) => { const d = new Date(t); return `${d.getMonth() + 1}/${d.getDate()}`; };

// The conversation so far, oldest first, as plain text. When it's too long the
// oldest questions are left out (and it says how many).
export function historyText(messages = []) {
  const said = messages.filter((m) => m.role === "person" || m.role === "assistant");
  const lines = said.map((m) => (m.role === "person"
    ? `Q (${m.author || "someone"}, ${when(m.at)}${m.photos?.length ? `, with ${m.photos.length} photo${m.photos.length === 1 ? "" : "s"}` : ""}): ${m.body}`
    : `A: ${m.body}`));
  const kept = [];
  let size = 0;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (size + lines[i].length > MAX_HISTORY) break;
    kept.unshift(lines[i]);
    size += lines[i].length + 2;
  }
  const dropped = lines.length - kept.length;
  return (dropped ? `(${dropped} earlier message${dropped === 1 ? "" : "s"} left out to keep this short.)\n\n` : "") + kept.join("\n\n");
}

// The photos the AI looks at: the ones sent now, then the machine's own (from
// the Machines page: its control, nameplate, setup), then the most recent from
// earlier in the conversation, each saying where it came from.
export function photosFor(messages = [], fresh = [], question = "", machinePhotos = []) {
  const out = fresh.map((url, i) => ({ url, label: `photo ${i + 1} sent with this question${question ? `: "${question.slice(0, 80)}"` : ""}` }));
  for (const p of machinePhotos.slice(0, MACHINE_PHOTOS)) if (out.length < MAX_PHOTOS) out.push(p);
  for (let i = messages.length - 1; i >= 0 && out.length < MAX_PHOTOS; i--) {
    const m = messages[i];
    if (m.role !== "person") continue;
    for (const url of m.photos || []) {
      if (out.length >= MAX_PHOTOS) break;
      out.push({ url, label: `a photo ${m.author || "someone"} sent on ${when(m.at)} with "${String(m.body).slice(0, 80)}"` });
    }
  }
  return out;
}

// Corrections first (they outrank everything), then the newest facts, up to a
// size that keeps every question quick and cheap. Each says where it came from.
const MAX_MEMORY = 30_000;
export function memoryText(memory = [], parts = []) {
  if (!memory.length) return "";
  const name = (id) => parts.find((p) => p.id === id)?.name || "this part";
  const line = (m) => {
    const about = m.partId ? `(${name(m.partId)}) ` : m.meta?.from ? `(from ${m.meta.from}) ` : "";
    const who = m.meta?.correction ? `correction from ${m.author || "someone"}` : m.meta?.auto ? "learned, not confirmed" : m.author ? `kept by ${m.author}` : "";
    return `- ${about}${m.body}${who ? ` [${who}]` : ""}`;
  };
  const fixes = memory.filter((m) => m.meta?.correction);
  const facts = memory.filter((m) => !m.meta?.correction).slice().reverse();   // newest first, so the oldest are what's left out
  const out = [];
  let size = 0;
  const take = (m) => { const l = line(m); if (size + l.length > MAX_MEMORY) return false; out.push(l); size += l.length + 1; return true; };
  const keptFixes = fixes.filter(take);
  const keptFacts = facts.filter(take);
  const left = memory.length - keptFixes.length - keptFacts.length;
  const L = [];
  if (keptFixes.length) L.push("CORRECTIONS (an earlier answer was wrong; these outrank everything):", ...out.slice(0, keptFixes.length));
  if (keptFacts.length) L.push(...(keptFixes.length ? ["", "FACTS:"] : []), ...out.slice(keptFixes.length));
  if (left > 0) L.push(`(${left} older fact${left === 1 ? "" : "s"} left out to keep this short.)`);
  return L.join("\n");
}

// Is this fact already kept? (Same words, give or take case and spacing.)
const norm = (t) => String(t || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
export const alreadyKept = (memory = [], fact) => memory.some((m) => norm(m.body) === norm(fact));

// The Machines page photos to send: the part's own machines, or every machine
// for a question about the shop, taken in turn so each machine gets a look in.
export function machinePhotosFor(machineFacts = {}, keys = null) {
  const ms = MACHINES.filter((m) => !keys || keys.includes(m.key));
  const lists = ms.map((m) => cleanMachineFacts(machineFacts?.[m.key]).photos.map((url, i) => ({ url, label: `photo ${i + 1} of the ${m.label}, from the Machines page (its control, nameplate or setup)` })));
  const out = [];
  for (let i = 0; out.length < MACHINE_PHOTOS && lists.some((l) => l[i]); i++) for (const l of lists) if (l[i] && out.length < MACHINE_PHOTOS) out.push(l[i]);
  return out;
}

// Every machine, as the shop has written it down.
export function machinesText(machineFacts = {}) {
  return MACHINES.map((m) => {
    const f = cleanMachineFacts(machineFacts?.[m.key]);
    const L = [`== MACHINE: ${m.label} ==`, `What it is: ${m.about}`];
    if (f.model) L.push(`Model / year: ${f.model}`);
    if (f.holding) L.push(`Workholding: ${f.holding}`);
    if (f.maxBar) L.push(`Largest bar: ${f.maxBar}`);
    if (f.liveTools) L.push(`Live tools: ${f.liveTools}`);
    if (f.notes) L.push(`Notes: ${f.notes}`);
    if (f.photos.length) L.push(`Photos on file: ${f.photos.length} (some may be attached above)`);
    L.push(f.tools.length ? `Tool list:\n${f.tools.map((r) => `  T${r.t}  ${r.what}`).join("\n")}` : "Tool list: NOT FILLED IN. Do not assume tools.");
    return L.join("\n");
  }).join("\n\n");
}

// What a question about the whole shop is sent with.
export function shopPack(machineFacts = {}, parts = [], memory = []) {
  const L = ["CNC ROOM: everything written down about the machines", "", machinesText(machineFacts)];
  if (parts.length) {
    L.push("", "== PARTS IN THE CNC CATALOG ==");
    for (const p of parts.slice(0, 300)) {
      const ms = splitMachines(p.machine).map((k) => MACHINES.find((m) => m.key === k)?.short).filter(Boolean).join(" + ");
      L.push(`- ${p.name || "Untitled"}${p.sku ? ` (SKU ${p.sku})` : ""}${ms ? `, on the ${ms}` : ""}${p.material ? `, ${p.material}` : ""}`);
    }
  }
  const mem = memoryText(memory, parts);
  if (mem) L.push("", "== THINGS THE SHOP HAS ASKED YOU TO REMEMBER ==", mem);
  return L.join("\n");
}

// What a question about one part is sent with: its pack (the part, its
// programs and what they were measured to cut, its machine), the other
// machines, and what's been remembered.
export function partPack(part, programs = [], machineFacts = {}, memory = [], parts = []) {
  const mine = new Set(splitMachines(part?.machine));
  const others = MACHINES.filter((m) => !mine.has(m.key)).map((m) => `${m.label}: ${m.about}`);
  const L = [buildAiPack(part, programs, machineFacts)];
  if (others.length) L.push("", "== THE SHOP'S OTHER MACHINES ==", ...others);
  const mem = memoryText(memory, parts.length ? parts : [part]);
  if (mem) L.push("", "== THINGS THE SHOP HAS ASKED YOU TO REMEMBER ==", mem);
  return L.join("\n");
}

// The program a question about a part is answered from: the one a rewrite
// would start from, so the two never disagree about what "the program" is.
export const programFor = (programs = []) => baselineOf(programs);

// ---- what comes back ----------------------------------------------------------------
//
// The answer is plain text, with up to three kinds of line at the end that the
// screen turns into buttons:
//   REMEMBER: <fact>          "Remember this"
//   REWRITE: <instruction>    "Rewrite with this"
//   PHOTO: <what to take>     "Add a photo"
//   SURE: high|medium|low - why   how sure it is, shown at the top of the answer
const TRAILER = /^\s*(REMEMBER|REWRITE|PHOTO|SURE)\s*:\s*(.*)$/i;

export function parseAnswer(text) {
  const remember = [];
  let rewrite = "";
  let photo = "";
  let sure = null;
  const body = [];
  for (const line of String(text || "").replace(/\r\n?/g, "\n").split("\n")) {
    const m = TRAILER.exec(line);
    if (!m) { body.push(line); continue; }
    const what = m[2].trim();
    if (!what) continue;
    const kind = m[1].toUpperCase();
    if (kind === "REMEMBER" && remember.length < 3 && !remember.includes(what)) remember.push(what);
    else if (kind === "REWRITE" && !rewrite) rewrite = what;
    else if (kind === "PHOTO" && !photo) photo = what;
    else if (kind === "SURE" && !sure) {
      const m2 = /^(high|medium|low)\b[\s\-–—:,.]*(.*)$/i.exec(what);
      sure = m2 ? { level: m2[1].toLowerCase(), why: m2[2].trim() } : { level: "medium", why: what };
    }
  }
  return { body: tidy(body.join("\n")), remember, rewrite, photo, sure };
}

// While an answer is still arriving: the text so far, without a trailer line
// that's half written (so "REMEM" never flashes up).
export function liveText(text) {
  const lines = String(text || "").replace(/\r\n?/g, "\n").split("\n");
  const last = lines[lines.length - 1];
  if (/^\s*[A-Z]{1,9}$/.test(last) && "REMEMBER REWRITE PHOTO SURE".split(" ").some((w) => w.startsWith(last.trim()))) lines.pop();
  return tidy(lines.filter((l) => !TRAILER.test(l)).join("\n"));
}

// The model is asked for plain text; any markdown that slips through is taken
// out rather than shown as stars and hashes.
function tidy(text) {
  return String(text)
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/(^|[^*])\*(?!\s)([^*\n]+?)\*(?!\*)/g, "$1$2")
    .replace(/^[ \t]*[-*][ \t]+/gm, "• ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ---- photos ---------------------------------------------------------------------------
//
// Phone photos are big (several megabytes). They're shrunk before they're kept:
// cheaper to store, quicker to send, and the AI sees no more detail than this
// anyway. Anything that can't be read as an image is kept as it was.
export async function shrinkPhoto(file, longest = 1600) {
  try {
    if (typeof createImageBitmap !== "function" || !/^image\//.test(file.type || "image/")) return file;
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, longest / Math.max(bmp.width, bmp.height));
    if (scale === 1 && file.size < 900_000) { bmp.close?.(); return file; }
    const c = document.createElement("canvas");
    c.width = Math.round(bmp.width * scale);
    c.height = Math.round(bmp.height * scale);
    c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
    bmp.close?.();
    const blob = await new Promise((res) => c.toBlob(res, "image/jpeg", 0.85));
    if (!blob) return file;
    return new File([blob], (file.name || "photo").replace(/\.[a-z0-9]+$/i, "") + ".jpg", { type: "image/jpeg" });
  } catch {
    return file;
  }
}

// Starting questions for an empty conversation.
export function starters(part) {
  if (!part) {
    return [
      "What's on each machine's tool list?",
      "How do I set a tool offset on the ST-10Y?",
      "What should I check before running a new program?",
    ];
  }
  return [
    "Explain what this program does, step by step",
    "What should I check before I run it?",
    "How should this part be set up and held?",
  ];
}
