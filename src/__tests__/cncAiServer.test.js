// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Anthropic from "@anthropic-ai/sdk";
import { GET, POST } from "../../api/cnc-ai.js";
import { buildRequest, checkInput, runJob, explain, shapeProblem, drawingBlock, numbered, usageOf, AiProblem, TASKS, SHOP, MAX_PROGRAM_CHARS } from "../../lib/cncAi.js";

// The server half of the AI. No request here reaches Anthropic: a stand-in
// client plays the SDK's part, so what's tested is what this code sends, what
// it does with each kind of answer, and that nobody unsigned gets in.

const PROGRAM = "%\nO00017 (PIN)\nG50 S3000\nT0101 (ROUGH)\nG96 S400 M03\nG00 X1.35 Z0.1\nG01 X0.625 F0.006\nZ-1.\nG00 X2. Z1.\nM30\n%\n";
const DRAFT_ANSWER = { program: PROGRAM, summary: "s", changes: [{ what: "a", why: "b" }], assumptions: [], questions: [] };
const input = (more = {}) => ({ pack: "CNC PART PACK: Pin", program: PROGRAM, ...more });

// A stand-in for the SDK's stream object.
const streamOf = (message, { text = "" } = {}) => {
  const handlers = [];
  return {
    on(ev, fn) { if (ev === "text") handlers.push(fn); return this; },
    async finalMessage() { handlers.forEach((h) => h(text || "x")); return message; },
    abort: vi.fn(),
  };
};
const reply = (result, more = {}) => ({
  model: "claude-fable-5-2", stop_reason: "end_turn",
  content: [{ type: "thinking", thinking: "" }, { type: "text", text: JSON.stringify(result) }],
  usage: { input_tokens: 1000, output_tokens: 400, cache_read_input_tokens: 600, cache_creation_input_tokens: 0 },
  ...more,
});
const fakeClient = (make) => {
  const calls = [];
  const via = (path) => (body) => { calls.push({ path, body }); return make(calls.length, path, body); };
  return { calls, beta: { messages: { stream: via("beta") } }, messages: { stream: via("plain") } };
};
const bad400 = () => new Anthropic.BadRequestError(400, { type: "error", error: { type: "invalid_request_error", message: "no" } }, "no", new Headers());

describe("what gets sent", () => {
  it("every job sends the shop rules, the pack, and asks for a fixed shape back", () => {
    for (const task of TASKS) {
      const r = buildRequest(task, input({ instruction: "clean it up", draft: PROGRAM, problems: "p", findings: "f", notes: "n", question: "What does line 4 do?" }));
      expect(r.model).toBe("claude-fable-5-2");
      expect(r.system[0].text).toBe(SHOP);
      expect(r.thinking).toEqual({ type: "adaptive" });
      if (task !== "ask") {   // (a question is the one job answered in its own words: see below)
        expect(r.output_config.effort).toBe("high");
        expect(r.output_config.format.type).toBe("json_schema");
        expect(r.output_config.format.schema.additionalProperties).toBe(false);
      }
      const blocks = r.messages[0].content;
      expect(blocks[0].text).toMatch(/^PART PACK/);
      expect(blocks[0].cache_control).toEqual({ type: "ephemeral" });   // the part every job shares
      expect(blocks.at(-1).text).toContain("O00017 (PIN)");
      // never the settings these models reject
      expect(r.temperature).toBeUndefined();
      expect(r.tool_choice).toBeUndefined();
      expect(JSON.stringify(r)).not.toMatch(/budget_tokens/);
    }
  });

  it("the shared part is identical across jobs, so it can be read from the cache", () => {
    const a = buildRequest("write", input({ instruction: "x" }));
    const b = buildRequest("verify", input({ instruction: "x", draft: PROGRAM }));
    expect(JSON.stringify(a.system)).toBe(JSON.stringify(b.system));
    expect(JSON.stringify(a.messages[0].content[0])).toBe(JSON.stringify(b.messages[0].content[0]));
  });

  it("the listing a job reads closely is numbered, lined up from line 1", () => {
    expect(numbered("A\nB")).toBe("   1| A\n   2| B");
    const review = buildRequest("review", input()).messages[0].content.at(-1).text;
    expect(review).toContain("   1| %\n   2| O00017 (PIN)");
    const verify = buildRequest("verify", input({ instruction: "x", draft: "O1\nM30" })).messages[0].content.at(-1).text;
    expect(verify).toContain("DRAFT (numbered listing)");
    expect(verify).toContain("   1| O1\n   2| M30");
    expect(verify).toMatch(/CURRENT PROGRAM\n-+\n%\nO00017/);   // the old one plain, for reference
  });

  it("a rewrite carries the rules a program must keep", () => {
    const t = buildRequest("write", input({ instruction: "do the deburr in the machine" })).messages[0].content.at(-1).text;
    for (const rule of [/same program number/, /finished part must not change/, /closer to the chuck/, /decimal point/, /tool list/, /G50 S/, /do the deburr in the machine/]) expect(t).toMatch(rule);
  });

  it("passes on what the person said is allowed to change, and only then", () => {
    const text = (more) => buildRequest("write", input({ instruction: "x", ...more })).messages[0].content.at(-1).text;
    expect(text({})).not.toMatch(/person asking has said/);
    expect(text({ sizesMayChange: true })).toMatch(/finished sizes are meant to change/);
    expect(text({ speedsMayRise: true })).toMatch(/speeds and feeds may go up/);
  });

  it("attaches a drawing only when it's a link of a kind that can be read", () => {
    expect(drawingBlock("https://x.supabase.co/storage/v1/object/public/item-photos/cnc/a/1.PNG")).toMatchObject({ type: "image", source: { type: "url" } });
    expect(drawingBlock("https://x.co/print.pdf?v=2")).toMatchObject({ type: "document" });
    expect(drawingBlock("https://x.co/print.heic")).toBeNull();
    expect(drawingBlock("data:image/png;base64,AAAA")).toBeNull();
    expect(drawingBlock("http://x.co/a.png")).toBeNull();
    const withIt = buildRequest("review", input({ drawingUrl: "https://x.co/a.jpg" })).messages[0].content;
    expect(withIt[0].type).toBe("image");
    expect(withIt[1].text).toMatch(/drawing is attached/);
  });
});

describe("what's refused before anything is spent", () => {
  it("names what's missing", () => {
    expect(checkInput("nope", input())).toMatch(/Unknown/);
    expect(checkInput("review", { program: PROGRAM })).toMatch(/details/);
    expect(checkInput("review", { pack: "p" })).toMatch(/no program/);
    expect(checkInput("write", input())).toMatch(/what should change/);
    expect(checkInput("fix", input({ instruction: "x", draft: PROGRAM }))).toMatch(/No problems/);
    expect(checkInput("verify", input({ instruction: "x" }))).toMatch(/no draft/);
    expect(checkInput("challenge", input())).toMatch(/No findings/);
    expect(checkInput("review", input())).toBe("");
  });

  it("an instruction or a list of findings far too long to be real is turned away", () => {
    expect(checkInput("write", input({ instruction: "x".repeat(5000) }))).toMatch(/instruction is too long/);
    expect(checkInput("fix", input({ instruction: "x", draft: PROGRAM, problems: "p".repeat(70000) }))).toMatch(/too much to send/);
    expect(checkInput("write", input({ instruction: "x".repeat(3000) }))).toBe("");
  });

  it("a program too long to read whole is turned away, never cut short", () => {
    const long = "G01 X1. Y1.\n".repeat(Math.ceil(MAX_PROGRAM_CHARS / 12) + 10);
    expect(checkInput("review", input({ program: long }))).toMatch(/too long/);
  });
});

describe("asking", () => {
  it("asks with the fallback switched on, and hands back the answer with what it cost", async () => {
    const c = fakeClient(() => streamOf(reply(DRAFT_ANSWER)));
    const out = await runJob(c, "write", input({ instruction: "x" }));
    expect(c.calls).toHaveLength(1);
    expect(c.calls[0].path).toBe("beta");
    expect(c.calls[0].body.fallbacks).toBe("default");
    expect(c.calls[0].body.betas).toEqual(["server-side-fallback-2026-07-01"]);
    expect(out.result.program).toBe(PROGRAM);
    expect(out.usage).toEqual({ input: 1000, output: 400, cacheRead: 600, cacheWrite: 0 });
    expect(out.notes).toEqual([]);
  });

  it("a request turned down as malformed is retried without the fallback, then without the drawing", async () => {
    const c = fakeClient((n) => (n < 4 ? { on() { return this; }, async finalMessage() { throw bad400(); } } : streamOf(reply(DRAFT_ANSWER))));
    const out = await runJob(c, "write", input({ instruction: "x", drawingUrl: "https://x.co/a.png" }));
    expect(c.calls.map((k) => `${k.path}:${k.body.messages[0].content[0].type}`)).toEqual(["beta:image", "plain:image", "beta:text", "plain:text"]);
    expect(out.notes.join(" ")).toMatch(/drawing couldn't be read/);
    expect(out.usedDrawing).toBe(false);
  });

  it("gives up with the API's own error when every form is turned down", async () => {
    const c = fakeClient(() => ({ on() { return this; }, async finalMessage() { throw bad400(); } }));
    await expect(runJob(c, "review", input())).rejects.toBeInstanceOf(Anthropic.BadRequestError);
    expect(c.calls).toHaveLength(2);
  });

  it("checks why it stopped before reading what it said", async () => {
    const refused = fakeClient(() => streamOf(reply(DRAFT_ANSWER, { stop_reason: "refusal", content: [] })));
    await expect(runJob(refused, "write", input({ instruction: "x" }))).rejects.toMatchObject({ kind: "refused" });
    const cut = fakeClient(() => streamOf(reply(DRAFT_ANSWER, { stop_reason: "max_tokens" })));
    await expect(runJob(cut, "write", input({ instruction: "x" }))).rejects.toMatchObject({ kind: "too_long" });
  });

  it("an answer that isn't the shape asked for is an error, not a half-result", async () => {
    const junk = fakeClient(() => streamOf({ ...reply({}), content: [{ type: "text", text: "Sure! Here you go" }] }));
    await expect(runJob(junk, "write", input({ instruction: "x" }))).rejects.toMatchObject({ kind: "garbled" });
    const empty = fakeClient(() => streamOf(reply({ ...DRAFT_ANSWER, program: "  " })));
    await expect(runJob(empty, "write", input({ instruction: "x" }))).rejects.toMatchObject({ kind: "garbled" });
    expect(shapeProblem("verify", { verdict: "fine", findings: [] })).toBeTruthy();
    expect(shapeProblem("verify", { verdict: "do_not_run", findings: [] })).toBe("");
    expect(shapeProblem("review", { summary: "s", findings: [] })).toBe("");
    expect(shapeProblem("challenge", {})).toBeTruthy();
  });

  it("the model and effort can be changed in Vercel without a code change, and a bad value is ignored", () => {
    process.env.CNC_AI_MODEL = "claude-opus-5-5";
    process.env.CNC_AI_EFFORT = "xhigh";
    const r = buildRequest("review", input());
    expect(r.model).toBe("claude-opus-5-5");
    expect(r.output_config.effort).toBe("xhigh");
    process.env.CNC_AI_EFFORT = "ludicrous";
    expect(buildRequest("review", input()).output_config.effort).toBe("high");
    delete process.env.CNC_AI_MODEL; delete process.env.CNC_AI_EFFORT;
  });

  it("anything but a finished answer is refused: paused, cut off, or out of room", async () => {
    for (const [reason, kind] of [["pause_turn", "garbled"], ["tool_use", "garbled"], ["model_context_window_exceeded", "too_long"]]) {
      const c = fakeClient(() => streamOf(reply(DRAFT_ANSWER, { stop_reason: reason })));
      await expect(runJob(c, "write", input({ instruction: "x" })), reason).rejects.toMatchObject({ kind });
    }
  });

  it("adds up the cost across models when a fallback stepped in", () => {
    expect(usageOf({ input_tokens: 10, output_tokens: 5 })).toEqual({ input: 10, output: 5, cacheRead: 0, cacheWrite: 0 });
    expect(usageOf({ input_tokens: 10, output_tokens: 5, iterations: [{ type: "message", input_tokens: 100, output_tokens: 2 }, { type: "fallback_message", input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 7 }] }))
      .toEqual({ input: 200, output: 52, cacheRead: 7, cacheWrite: 0 });
    expect(usageOf(undefined)).toEqual({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
  });

  it("doesn't start another try once nobody is left to read the answer", async () => {
    let gone = false;
    const c = fakeClient(() => ({ on() { return this; }, async finalMessage() { gone = true; throw bad400(); } }));
    await expect(runJob(c, "review", input(), { gone: () => gone })).rejects.toMatchObject({ kind: "stopped" });
    expect(c.calls).toHaveLength(1);
  });

  it("a model name that doesn't exist says so, instead of 'try again later'", () => {
    const e = new Anthropic.NotFoundError(404, { type: "error", error: { type: "not_found_error", message: "model: x" } }, "m", new Headers());
    expect(explain(e).error).toMatch(/CNC_AI_MODEL/);
  });

  it("says when a different model answered", async () => {
    const c = fakeClient(() => streamOf(reply(DRAFT_ANSWER, { model: "claude-opus-5" })));
    expect((await runJob(c, "write", input({ instruction: "x" }))).notes.join(" ")).toMatch(/claude-opus-5/);
  });

  it("puts each kind of failure into words, going by its type", () => {
    const err = (Cls, status) => new Cls(status, { type: "error", error: { type: "x", message: "m" } }, "m", new Headers());
    expect(explain(err(Anthropic.AuthenticationError, 401)).kind).toBe("key");
    expect(explain(err(Anthropic.RateLimitError, 429)).kind).toBe("busy");
    expect(explain(bad400()).kind).toBe("rejected");
    expect(explain(err(Anthropic.InternalServerError, 500)).kind).toBe("down");
    expect(explain(new Anthropic.APIConnectionError({ message: "x" })).kind).toBe("network");
    expect(explain(new AiProblem("refused", "no")).kind).toBe("refused");
    expect(explain(new Error("boom")).error).not.toMatch(/boom/);   // nothing internal leaks to the screen
  });
});

describe("the route", () => {
  const env = { VITE_SUPABASE_URL: "https://db.example.co", VITE_SUPABASE_ANON_KEY: "anon" };
  const signedIn = () => vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ id: "u1" }), { status: 200 })));
  const post = (body, headers = { authorization: "Bearer good" }) =>
    new Request("https://x/api/cnc-ai", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
  const lines = async (res) => (await res.text()).trim().split("\n").map((l) => JSON.parse(l));

  beforeEach(() => Object.assign(process.env, env));
  afterEach(() => { vi.unstubAllGlobals(); ["VITE_SUPABASE_URL", "VITE_SUPABASE_ANON_KEY", "ANTHROPIC_API_KEY"].forEach((k) => delete process.env[k]); });

  it("turns away anyone who isn't signed in, before doing anything", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("must not reach the network"); }));
    expect((await GET(new Request("https://x/api/cnc-ai"))).status).toBe(401);
    expect((await POST(post({ task: "review", input: input() }, {}))).status).toBe(401);
  });

  it("says whether the AI is switched on", async () => {
    signedIn();
    expect(await (await GET(new Request("https://x/api/cnc-ai", { headers: { authorization: "Bearer good" } }))).json()).toMatchObject({ ready: false });
    process.env.ANTHROPIC_API_KEY = "sk-test";
    expect(await (await GET(new Request("https://x/api/cnc-ai", { headers: { authorization: "Bearer good" } }))).json()).toMatchObject({ ready: true, model: "claude-fable-5-2" });
  });

  it("without a key it says what's needed instead of failing strangely", async () => {
    signedIn();
    const r = await POST(post({ task: "review", input: input() }));
    expect(r.status).toBe(503);
    expect((await r.json()).error).toMatch(/ANTHROPIC_API_KEY/);
  });

  it("refuses a bad job before any stream starts", async () => {
    signedIn();
    const c = fakeClient(() => streamOf(reply(DRAFT_ANSWER)));
    expect((await POST(post({ task: "write", input: input() }), { client: c })).status).toBe(400);
    expect((await POST(post({}), { client: c })).status).toBe(400);
    expect(c.calls).toHaveLength(0);
  });

  it("streams a start line and then the answer", async () => {
    signedIn();
    const c = fakeClient(() => streamOf(reply(DRAFT_ANSWER)));
    const r = await POST(post({ task: "write", input: input({ instruction: "x" }) }), { client: c });
    expect(r.status).toBe(200);
    const got = await lines(r);
    expect(got[0]).toEqual({ t: "start" });
    expect(got.at(-1)).toMatchObject({ t: "done", result: { program: PROGRAM }, usage: { input: 1000 } });
  });

  it("a failure arrives as a line saying so, in plain words", async () => {
    signedIn();
    const c = fakeClient(() => ({ on() { return this; }, async finalMessage() { throw new Anthropic.RateLimitError(429, {}, "slow down", new Headers()); } }));
    const got = await lines(await POST(post({ task: "review", input: input() }), { client: c }));
    expect(got.at(-1)).toMatchObject({ t: "error", kind: "busy" });
    expect(got.at(-1).error).not.toMatch(/slow down/);
  });
});

describe("questions to the assistant", () => {
  beforeEach(() => { process.env.VITE_SUPABASE_URL = "https://db.example.co"; });
  afterEach(() => { delete process.env.VITE_SUPABASE_URL; });
  const q = (more = {}) => ({ pack: "SHOP", program: "", question: "How do I set a tool offset?", history: "", ...more });

  it("can be about the shop, with no program", () => {
    expect(checkInput("ask", q())).toBe("");
    const r = buildRequest("ask", q());
    expect(r.messages[0].content[0].text).toMatch(/^SHOP PACK/);
    expect(r.messages[0].content.at(-1).text).not.toMatch(/CURRENT PROGRAM/);
    expect(r.output_config.format).toBeUndefined();          // answered in its own words
    expect(r.messages[0].content.at(-1).text).toMatch(/PHOTO:[\s\S]*REWRITE:[\s\S]*REMEMBER:/);
  });
  it("sends photos from the app's own storage, labelled, and refuses any other link", () => {
    const ok = "https://db.example.co/storage/v1/object/public/item-photos/cnc/p1/1.jpg";
    const r = buildRequest("ask", q({ photos: [{ url: ok, label: "the setup" }] }));
    const blocks = r.messages[0].content;
    expect(blocks[1]).toEqual({ type: "image", source: { type: "url", url: ok } });
    expect(blocks[2].text).toBe("(Above: the setup)");
    expect(checkInput("ask", q({ photos: [{ url: "https://evil.example/x.jpg" }] }))).toMatch(/didn't upload properly/);
    expect(checkInput("ask", q({ photos: [{ url: "data:image/png;base64,AAAA" }] }))).toMatch(/didn't upload properly/);
    expect(checkInput("ask", q({ photos: Array.from({ length: 7 }, () => ({ url: ok })) }))).toMatch(/at most 6/);
  });
  it("tells the AI what each machine really is", () => {
    expect(SHOP).toMatch(/ST-10Y: a turning center with one spindle and a turret that has live tooling and a Y axis/);
    expect(SHOP).toMatch(/DS-30SSY: a turning center with a main spindle and a sub-spindle/);
  });
  it("a plain-text answer comes back as the answer, and streams as it's written", async () => {
    const pieces = [];
    const c = fakeClient(() => streamOf({ ...reply({}), content: [{ type: "text", text: "Press OFFSET, then…\nPHOTO: the screen" }] }, { text: "Press OFFSET" }));
    const out = await runJob(c, "ask", q(), { onText: (t) => pieces.push(t) });
    expect(out.result.answer).toBe("Press OFFSET, then…\nPHOTO: the screen");
    expect(pieces).toEqual(["Press OFFSET"]);
  });
  it("photos that can't be fetched: asked again without them, and the answer says so", async () => {
    const ok = "https://db.example.co/storage/v1/object/public/item-photos/a.jpg";
    const c = fakeClient((n) => (n <= 2 ? { on() { return this; }, async finalMessage() { throw bad400(); } } : streamOf({ ...reply({}), content: [{ type: "text", text: "ok" }] })));
    const out = await runJob(c, "ask", q({ photos: [{ url: ok, label: "x" }] }));
    expect(c.calls.map((k) => k.body.messages[0].content.some((b) => b.type === "image"))).toEqual([true, true, false]);
    expect(out.notes.join(" ")).toMatch(/photos couldn't be read/);
  });
});
