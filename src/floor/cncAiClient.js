// Asking the AI from the browser: one job to /api/cnc-ai, read back as it
// streams (see api/cnc-ai.js for the lines it sends).
//
// With no backend (the demo and local mode) there is no AI to ask, so a canned
// answer stands in: enough to click through the screens, and it says on screen
// that that's what it is.

import { apiFetch } from "../lib/apiFetch.js";
import { backendMode } from "../lib/db.js";
import { explainPlainly } from "./cncAi.js";

export class AiError extends Error {
  constructor(message, kind = "error") { super(message); this.kind = kind; }
}

const DEMO = backendMode === "local";
export const aiIsDemo = () => DEMO;

// Is the AI switched on? { ready, demo }. Never throws: "no" is an answer.
export async function aiStatus() {
  if (DEMO) return { ready: true, demo: true };
  try {
    const res = await apiFetch("/api/cnc-ai");
    if (!res.ok) return { ready: false, demo: false };
    const j = await res.json();
    return { ready: !!j.ready, demo: false };
  } catch {
    return { ready: false, demo: false };
  }
}

const BY_STATUS = {
  401: "You're signed out. Sign in again and retry.",
  404: "The AI isn't available on this copy of the app.",
  413: "That's too much to send in one go.",
  504: "The AI took too long to answer. Nothing was changed. Try again, or with a narrower instruction.",
};

export async function askAi(task, input, { signal, onTick, onText } = {}) {
  if (DEMO) return demoAnswer(task, input, signal, onText);
  let res;
  try {
    res = await apiFetch("/api/cnc-ai", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ task, input }), signal });
  } catch (e) {
    if (e?.name === "AbortError") throw new AiError("Stopped.", "stopped");
    throw new AiError("Couldn't reach the server. Check the connection and try again.", "network");
  }
  if (!res.ok) {
    const j = await res.json().catch(() => null);
    throw new AiError(j?.error || BY_STATUS[res.status] || "The AI couldn't be asked. Nothing was changed.", j?.kind || "error");
  }
  let done = null;
  try {
    await readLines(res, (line) => {
      if (line.t === "tick") onTick?.(line);
      else if (line.t === "text") onText?.(line.text || "");
      else if (line.t === "error") throw new AiError(line.error || "The AI couldn't answer. Nothing was changed.", line.kind || "error");
      else if (line.t === "done") done = line;
    });
  } catch (e) {
    if (e instanceof AiError) throw e;
    if (e?.name === "AbortError") throw new AiError("Stopped.", "stopped");
    throw new AiError("The connection dropped before the answer arrived. Nothing was changed.", "network");
  }
  if (!done) throw new AiError("The connection dropped before the answer arrived. Nothing was changed.", "network");
  return { result: done.result, usage: done.usage, notes: done.notes || [], model: done.model, sources: done.sources || [], searches: done.searches || 0 };
}

// One JSON object per line, however the chunks happen to fall.
export async function readLines(res, onLine) {
  const feed = (text) => { const t = text.trim(); if (t) onLine(JSON.parse(t)); };
  if (!res.body?.getReader) { (await res.text()).split("\n").forEach(feed); return; }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf("\n")) >= 0) { feed(buf.slice(0, i)); buf = buf.slice(i + 1); }
  }
  feed(buf + dec.decode());
}

// ---- the stand-in, for the demo -------------------------------------------------
const wait = (ms, signal) => new Promise((res, rej) => {
  if (signal?.aborted) { rej(new AiError("Stopped.", "stopped")); return; }
  const id = setTimeout(res, ms);
  signal?.addEventListener?.("abort", () => { clearTimeout(id); rej(new AiError("Stopped.", "stopped")); }, { once: true });
});
const DEMO_NOTE = "Demo: this answer is canned. No AI was asked and nothing was sent anywhere.";
const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

async function demoAnswer(task, input, signal, onText) {
  if (task === "ask") {
    // a canned answer that shows the conversation is carried: it says how many questions came before
    const before = (String(input.history || "").match(/^Q \(/gm) || []).length;
    const steps = input.program ? explainPlainly(input.program) : [];
    const answer = [
      `Demo answer, not from the AI. You asked: "${String(input.question).trim().slice(0, 120)}".`,
      before ? `That's question ${before + 1} here, and the ${before} before it were sent along with it, so the real assistant would answer with all of them in mind.` : "This is the first question here.",
      steps.length ? `From the app's own measurements, the program does this:\n${steps.map((s, i) => `${i + 1}. ${s.tool}: ${s.what}`).join("\n")}` : "The real assistant answers from every machine's tool list and notes, and what the shop has asked it to remember.",
      "PHOTO: the part as it sits in the chuck",
      "SURE: medium - this is the demo, so nothing was looked up",
      "REMEMBER: This is what a remembered fact looks like. Press the button to keep it.",
    ].join("\n\n");
    for (const word of answer.split(/(?<= )/)) { await wait(18, signal); onText?.(word); }
    return { result: { answer }, usage, notes: [DEMO_NOTE] };
  }
  await wait(task === "write" ? 1400 : 900, signal);
  const lines = String(input.program || "").replace(/\r\n?/g, "\n").split("\n");
  if (task === "write" || task === "fix") {
    // The same program with each tool call explained: changes nothing the machine does.
    const src = String(task === "fix" ? input.draft : input.program).replace(/\r\n?/g, "\n").split("\n");
    const out = [];
    for (const l of src) {
      if (/^\s*(N\d+\s*)?T\d+/i.test(l) && !/\(/.test(out[out.length - 1] || "") && !/^\(TOOL CHANGE/.test(out[out.length - 1] || "")) out.push("(TOOL CHANGE)");
      out.push(l);
    }
    // Ask the demo to make it faster and it does the wrong thing on purpose
    // (doubles the first feed), so the checks can be seen catching it.
    if (/faster/i.test(String(input.instruction || ""))) {
      const at = out.findIndex((l) => /F\d*\.?\d+/.test(l) && !/^\s*\(/.test(l));
      if (at >= 0 && task === "write") out[at] = out[at].replace(/F(\d*\.?\d+)/, (_, f) => `F${Number((Number(f) * 2).toFixed(4))}`);
      return { result: {
        program: out.join("\n"),
        summary: "Raised the roughing feed to save time.",
        changes: [{ what: "Doubled the roughing feed", why: "To shorten the run." }],
        assumptions: ["The insert and the setup can take the higher feed."],
        questions: [],
      }, usage, notes: [DEMO_NOTE] };
    }
    return { result: {
      program: out.join("\n"),
      summary: "Added a comment line before each tool change. Nothing the machine does was changed.",
      changes: [{ what: "A comment before each tool change", why: "So the operator can see where each tool starts." }],
      assumptions: ["This is the demo, so the instruction was not acted on."],
      questions: ["Does the tool list match what is in each pocket?"],
    }, usage, notes: [DEMO_NOTE] };
  }
  if (task === "verify") {
    return { result: { verdict: "ok_to_prove_out", findings: [], checked: ["Every rapid move against the bar", "Every size against the current program"], couldNotCheck: ["The jaws and the fixture: they aren't in the pack"] }, usage, notes: [DEMO_NOTE] };
  }
  if (task === "challenge") {
    const n = (String(input.findings || "").match(/^\d+\. \[/gm) || []).length;
    return { result: { results: Array.from({ length: n }, (_, i) => ({ index: i + 1, verdict: i === 0 ? "confirmed" : "unsure", reason: i === 0 ? "The line is as quoted." : "It depends on how the part is held." })) }, usage, notes: [DEMO_NOTE] };
  }
  // review: point at the first rapid move, which is always worth a look
  const at = lines.findIndex((l) => /\bG0?0\b/i.test(l) && /[XZ]/i.test(l));
  const tools = lines.map((l, i) => ({ l, i })).filter((x) => /^\s*(N\d+\s*)?T\d+/i.test(x.l));
  const steps = explainPlainly(input.program);
  return { result: {
    summary: `Demo: written from the app's own measurements, not by the AI. This program uses ${steps.length} tool${steps.length === 1 ? "" : "s"}; what each one does is below. The real review also says why, and what to watch.`,
    walkthrough: steps,
    findings: at >= 0 ? [{ level: "look", line: at + 1, quote: lines[at].trim(), problem: "This is the first rapid move toward the part. Check it starts in clear air.", fix: "Run it in single block with the rapids turned down." }] : [],
    handWork: [],
    questions: ["How far does the part stick out of the jaws?"],
  }, usage, notes: [DEMO_NOTE] };
}
