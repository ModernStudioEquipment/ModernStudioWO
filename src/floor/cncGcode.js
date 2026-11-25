// Reading Haas G-code. Not an interpreter and not a simulator: it splits a
// program into words (G54, T0101, X1.25) and answers the questions a person
// asks before trusting a file. Which program is it, which tools does it call,
// and does it have any of the common mistakes that crash machines.
//
// Everything here is plain rules, no AI: the same file always gets the same
// answer, it costs nothing, and it works offline.

// ---- words ------------------------------------------------------------------
//
// G-code is written with or without spaces (T1M06 and T1 M06 are the same), so
// lines are split on "a letter followed by a number", never on whitespace.
// Macro lines (#100=…, IF[…], WHILE[…]) are kept as lines but give no words:
// "WHILE[#1LT10]" must not read as tool 10.
const WORD = /([A-Z])\s*([-+]?(?:\d+\.?\d*|\.\d+))/g;

export function parseLines(content) {
  const out = [];
  const raw = String(content || "").replace(/\r\n?/g, "\n").split("\n");
  raw.forEach((text, i) => {
    const comment = (/\(([^)]*)\)/.exec(text) || [])[1]?.trim() || "";
    const code = text.replace(/\([^)]*\)/g, " ").replace(/;.*$/, " ").toUpperCase().trim();
    if (!code && !comment) return;
    if (code === "%") return;
    const macro = /[#\[\]=]/.test(code);
    const words = [];
    if (!macro) for (const m of code.matchAll(WORD)) words.push({ l: m[1], v: Number(m[2]), raw: m[2] });
    out.push({ n: i + 1, words, comment, code, macro });
  });
  return out;
}

const has = (line, l, v) => line.words.some((w) => w.l === l && w.v === v);
const word = (line, l) => line.words.find((w) => w.l === l);
const anyG = (line, ...vs) => line.words.some((w) => w.l === "G" && vs.includes(w.v));
const anyM = (line, ...vs) => line.words.some((w) => w.l === "M" && vs.includes(w.v));

// A lathe calls T0101 (tool 1, offset 1); a mill calls T1. Three or more
// digits is the lathe form. Returns { tool, offset } (offset null on a mill).
function toolOf(w) {
  const digits = w.raw.replace(/\D/g, "");
  if (digits.length >= 3) return { tool: Math.floor(w.v / 100), offset: w.v % 100, lathe: true };
  return { tool: w.v, offset: null, lathe: false };
}

// ---- what's in a file -------------------------------------------------------
export function programInfo(content) {
  const lines = parseLines(content);
  const info = { number: "", title: "", tools: [], offsets: [], stops: 0, lines: lines.length, kind: "" };
  const tools = new Map();
  const offsets = new Set();
  let lathe = 0;
  let mill = 0;
  lines.forEach((line, idx) => {
    if (!info.number && idx < 6) {
      const o = word(line, "O");
      if (o && Number.isInteger(o.v)) { info.number = `O${String(o.v).padStart(5, "0")}`; info.title = line.comment; }
    }
    for (const w of line.words) {
      if (w.l === "T") {
        const t = toolOf(w);
        if (t.lathe) lathe += 2;
        if (!t.tool) continue; // T0 / T0100 cancels, it isn't a tool
        if (!tools.has(t.tool) || (!tools.get(t.tool) && line.comment)) tools.set(t.tool, line.comment);
      }
      if (w.l === "G") {
        if (w.v >= 54 && w.v <= 59) offsets.add(`G${w.v}`);
        if (w.v === 154) { const p = word(line, "P"); offsets.add(p ? `G154 P${p.v}` : "G154"); }
        if (w.v === 96 || w.v === 71 || w.v === 72 || w.v === 70) lathe += 1;
        if (w.v === 43) mill += 2;
      }
      if (w.l === "M") {
        if (w.v === 0 || w.v === 1) info.stops += 1;
        if (w.v === 6) mill += 2;
      }
    }
  });
  info.tools = [...tools.entries()].sort((a, b) => a[0] - b[0]).map(([t, note]) => ({ t, note }));
  info.offsets = [...offsets];
  info.kind = lathe > mill ? "lathe" : mill > lathe ? "mill" : "";
  return info;
}

// Where the program stops and waits for the operator, and why. The reason is
// whatever the programmer wrote in brackets on that line or the one above it
// ("M00 (FLIP PART)"); a stop with no comment is still listed, because an
// operator who isn't expecting it thinks the machine has hung. M00 always
// stops; M01 only stops when Optional Stop is switched on.
export function operatorStops(content) {
  const lines = parseLines(content);
  const out = [];
  lines.forEach((l, i) => {
    const m0 = anyM(l, 0);
    const m1 = anyM(l, 1);
    if (!m0 && !m1) return;
    const above = lines[i - 1];
    const why = l.comment || (above && !above.words.length ? above.comment : "") || "";
    out.push({ line: l.n, why, optional: !m0 });
  });
  return out;
}

// One line under a file name: "O04120 · T1, T3, T5 · G54 · 2 stops · 214 lines".
export function programLine(info) {
  return [
    info.number,
    info.tools.length ? info.tools.map((x) => `T${x.t}`).join(", ") : "no tool calls found",
    info.offsets.join(", "),
    info.stops ? `${info.stops} stop${info.stops === 1 ? "" : "s"}` : "",
    `${info.lines} line${info.lines === 1 ? "" : "s"}`,
  ].filter(Boolean).join(" · ");
}

// Is this text a program at all? A binary file (the Mastercam file, a photo)
// has NUL bytes or decodes to junk; a PDF or a note has no lines that start
// like G-code. Lenient on short files: three real lines is a program.
export function looksLikeProgram(text) {
  if (typeof text !== "string" || !text.trim()) return false;
  const head = text.slice(0, 6000);
  if (/\u0000/.test(head)) return false;
  if ((head.match(/�/g) || []).length > 5) return false;
  const lines = head.replace(/\r\n?/g, "\n").split("\n").map((l) => l.trim()).filter((l) => l && l !== "%");
  if (!lines.length) return false;
  const codeLike = lines.filter((l) => /^(N\d+\s*)?([GMTOXYZSF]\s*[-+]?[\d.]|\()/i.test(l)).length;
  return codeLike >= Math.min(3, lines.length) && codeLike / lines.length >= 0.5;
}

// ---- the checker ------------------------------------------------------------
//
// Levels: "stop" = fix this before it runs, "look" = probably wrong, check it,
// "note" = good to know. Every message is written for someone who isn't a
// programmer, with the code in brackets for someone who is.
//
// It catches common, mechanical mistakes. It can't see the part, the fixture
// or the tool in the pocket, so a clean result is not a proven program.
const TOOL_WORDS = (s) => new Set(String(s || "").toLowerCase().match(/\d+\/\d+|\d*\.?\d+|[a-z]{3,}/g) || []);

export function checkProgram(content, { machineKind = "", machineLabel = "", machineTools = null } = {}) {
  const lines = parseLines(content);
  const info = programInfo(content);
  const kind = info.kind || machineKind;
  const out = [];
  const add = (level, text, line) => out.push({ level, text, line: line || null });
  const codeLines = lines.filter((l) => l.words.length);

  if (codeLines.length < 3) {
    add("look", "There's almost nothing in this file. Check it's the whole program.");
    return out;
  }
  if (info.kind && machineKind && info.kind !== machineKind) {
    add("look", `This reads like a ${info.kind} program, but the part is set to ${machineLabel || `a ${machineKind}`}. Check it's filed on the right machine.`);
  }

  // -- things every program needs
  if (!codeLines.some((l) => anyM(l, 30, 99, 2))) add("look", "No end of program (M30). The machine will run off the end of the file.");
  // Plenty of good Haas programs leave these two out and lean on the machine's
  // settings, so they're notes, except the offset on a mill, where running in
  // the wrong one puts the tool in the wrong place.
  if (!codeLines.some((l) => anyG(l, 20, 21))) add("note", "Doesn't say inches or millimetres (G20 or G21). It will run in whatever the machine was last left in.");
  if (!info.offsets.length) add(kind === "mill" ? "look" : "note", "No work offset is called (G54). It will use whichever one happens to be active.");
  if (!codeLines.some((l) => anyM(l, 3, 4, 133, 134, 143, 144))) add("look", "The spindle is never started (M03).");

  let feed = false;
  for (const l of codeLines) {
    if (word(l, "F")) feed = true;
    if (anyG(l, 1, 2, 3) && !feed) { add("look", "The first cutting move has no feed rate set before it (F).", l.n); break; }
  }

  const m0 = codeLines.filter((l) => anyM(l, 0));
  if (m0.length) add("note", `Stops and waits for the operator ${m0.length} time${m0.length === 1 ? "" : "s"} (M00), on line${m0.length === 1 ? "" : "s"} ${m0.map((l) => l.n).join(", ")}.`);
  if (!codeLines.some((l) => anyM(l, 8, 88))) add("note", "Coolant is never turned on (M08).");

  // A whole number with no decimal point. On a Haas, X1 can mean 0.0001 inch
  // rather than 1 inch (Setting 162 decides), so a dropped "." moves the tool
  // almost nowhere, or with the setting flipped, ten thousand times too far.
  const bare = [];
  for (const l of codeLines) {
    for (const w of l.words) {
      if ("XYZUWIJK".includes(w.l) && w.v !== 0 && !w.raw.includes(".")) bare.push({ word: `${w.l}${w.raw}`, n: l.n });
    }
  }
  if (bare.length) {
    const first = bare.slice(0, 3).map((b) => `${b.word} on line ${b.n}`).join(", ");
    add("look", `${bare.length === 1 ? "A position has" : `${bare.length} positions have`} no decimal point (${first}${bare.length > 3 ? ", and more" : ""}). On a Haas, X1 can mean 0.0001 rather than 1. Write X1. with the point.`, bare[0].n);
  }

  // cutter compensation left on
  let comp = null;
  for (const l of codeLines) { if (anyG(l, 41, 42)) comp = l.n; if (anyG(l, 40)) comp = null; }
  if (comp) add("look", "Cutter compensation is turned on (G41 or G42) and never cancelled (G40).", comp);

  if (kind === "mill") {
    // every tool change needs its length offset
    let pendingT = null;
    let cur = null;
    const close = () => {
      if (cur && !cur.h43) add("stop", `T${cur.tool} is used with no tool length offset (G43 H${cur.tool}). The machine won't know how long the tool is.`, cur.line);
      else if (cur && cur.h != null && cur.h !== cur.tool) add("look", `T${cur.tool} uses length offset H${cur.h}. These normally match.`, cur.hLine);
    };
    for (const l of codeLines) {
      const t = word(l, "T");
      if (t) pendingT = toolOf(t).tool;
      if (anyM(l, 6) && pendingT) { close(); cur = { tool: pendingT, line: l.n, h43: false, h: null, hLine: null }; }
      if (cur && anyG(l, 43)) { cur.h43 = true; const h = word(l, "H"); if (h) { cur.h = h.v; cur.hLine = l.n; } }
    }
    close();

    let cycle = null;
    for (const l of codeLines) { if (anyG(l, 73, 74, 81, 82, 83, 84, 85, 86, 89)) cycle = l.n; if (anyG(l, 80)) cycle = null; }
    if (cycle) add("look", "A drilling cycle is started and never cancelled (G80). The next move will drill a hole too.", cycle);

    if (!codeLines.slice(0, 12).some((l) => anyG(l, 40, 49, 80))) add("note", "No safety line near the top (G40 G49 G80). A setting left over from the last program can carry into this one.");
  }

  if (kind === "lathe") {
    // constant surface speed needs a speed limit
    let clamp = false;
    for (const l of codeLines) {
      if (anyG(l, 50) && word(l, "S")) clamp = true;
      if (anyG(l, 96) && !clamp) {
        add("stop", "Constant surface speed is on (G96) with no top speed set first (G50 S). The spindle can run up to full speed as the tool nears the centre of the part.", l.n);
        break;
      }
    }
    // threading wants a fixed speed
    let css = false;
    for (const l of codeLines) {
      if (anyG(l, 96)) css = true;
      if (anyG(l, 97)) css = false;
      if (css && anyG(l, 76, 92, 32)) { add("look", "Threading while constant surface speed is on (G96). Threads should be cut at a fixed speed (G97).", l.n); break; }
    }
    // roughing and finishing cycles point at numbered lines that must exist
    const nums = new Set(lines.map((l) => word(l, "N")?.v).filter((v) => v != null));
    for (const l of codeLines) {
      if (!anyG(l, 70, 71, 72, 73)) continue;
      const p = word(l, "P");
      const q = word(l, "Q");
      if (!p || !q) continue;
      const gone = [p.v, q.v].filter((v) => !nums.has(v));
      if (gone.length) add("stop", `The cycle on line ${l.n} points at lines N${p.v} to N${q.v}, but there is no N${gone.join(" or N")} in the file. The machine will alarm.`);
    }
  }

  // -- against the machine's real tool list
  if (Array.isArray(machineTools) && machineTools.length) {
    const have = new Map(machineTools.map((r) => [String(Number(String(r.t).replace(/\D/g, ""))), String(r.what || "")]));
    for (const t of info.tools) {
      const listed = have.get(String(t.t));
      if (listed === undefined) { add("look", `T${t.t} isn't on ${machineLabel || "the machine's"} tool list.`); continue; }
      if (t.note && listed) {
        const a = TOOL_WORDS(t.note);
        const b = TOOL_WORDS(listed);
        if (a.size && b.size && ![...a].some((x) => b.has(x))) {
          add("look", `The program calls T${t.t} “${t.note}”, but the tool list says T${t.t} is “${listed}”. Check the right tool is in that pocket.`);
        }
      }
    }
  }

  const order = { stop: 0, look: 1, note: 2 };
  return out.sort((a, b) => order[a.level] - order[b.level]);
}

export const checkCounts = (findings) => ({
  stop: findings.filter((f) => f.level === "stop").length,
  look: findings.filter((f) => f.level === "look").length,
  note: findings.filter((f) => f.level === "note").length,
});

// ---- what changed between two versions --------------------------------------
//
// Line by line, ignoring trailing spaces. Returns the changed lines in order,
// each tagged "-" (was in the old one) or "+" (is in the new one), with the
// line number it has in its own file. Big rewrites aren't itemised: past a
// size limit it just reports that everything in between changed.
export function diffPrograms(oldText, newText) {
  const norm = (t) => String(t || "").replace(/\r\n?/g, "\n").split("\n").map((l) => l.trimEnd());
  const a = norm(oldText);
  const b = norm(newText);
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) { endA--; endB--; }
  const A = a.slice(start, endA);
  const B = b.slice(start, endB);
  const changes = [];
  if (A.length * B.length > 4_000_000) {
    A.forEach((text, i) => changes.push({ op: "-", n: start + i + 1, text }));
    B.forEach((text, i) => changes.push({ op: "+", n: start + i + 1, text }));
  } else {
    // longest common subsequence, then walk it
    const w = B.length + 1;
    const dp = new Uint32Array((A.length + 1) * w);
    for (let i = A.length - 1; i >= 0; i--) {
      for (let j = B.length - 1; j >= 0; j--) {
        dp[i * w + j] = A[i] === B[j] ? dp[(i + 1) * w + j + 1] + 1 : Math.max(dp[(i + 1) * w + j], dp[i * w + j + 1]);
      }
    }
    let i = 0;
    let j = 0;
    while (i < A.length || j < B.length) {
      // On a tie the old line goes first, so a changed line reads "was, now".
      if (i < A.length && j < B.length && A[i] === B[j]) { i++; j++; }
      else if (i < A.length && (j === B.length || dp[(i + 1) * w + j] >= dp[i * w + j + 1])) { changes.push({ op: "-", n: start + i + 1, text: A[i] }); i++; }
      else { changes.push({ op: "+", n: start + j + 1, text: B[j] }); j++; }
    }
  }
  return {
    same: changes.length === 0,
    added: changes.filter((c) => c.op === "+").length,
    removed: changes.filter((c) => c.op === "-").length,
    changes,
  };
}
