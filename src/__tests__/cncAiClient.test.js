import { describe, it, expect, vi, beforeEach } from "vitest";

// The browser's half of asking: what it sends, how it reads the stream, and
// what the person sees for each way it can go wrong. The server is a stand-in.

vi.mock("../lib/db.js", () => ({ backendMode: "supabase", db: {} }));
// A plain stand-in rather than vi.fn(): the answer for the next call, and the calls made.
const server = { next: null, calls: [] };
const answer = (v) => { server.next = async () => v; };
const fail = (e) => { server.next = async () => { throw e; }; };
vi.mock("../lib/apiFetch.js", () => ({ apiFetch: (...a) => { server.calls.push(a); return server.next(...a); } }));
const { askAi, aiStatus, readLines, AiError } = await import("../floor/cncAiClient.js");

const streamRes = (chunks, status = 200) => {
  const enc = new TextEncoder();
  let i = 0;
  return { ok: status >= 200 && status < 300, status, body: { getReader: () => ({ read: async () => (i < chunks.length ? { value: enc.encode(chunks[i++]), done: false } : { value: undefined, done: true }) }) }, json: async () => ({}) };
};
const jsonRes = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

beforeEach(() => { server.next = null; server.calls = []; });

describe("asking the AI", () => {
  it("sends one job and returns the answer when the stream says done", async () => {
    answer(streamRes(['{"t":"start"}\n', '{"t":"tick","chars":10}\n{"t":"done","result":{"program":"O1"},"usage":{"input":5},"notes":["n"],"model":"m"}\n']));
    const ticks = [];
    const out = await askAi("write", { pack: "p" }, { onTick: (t) => ticks.push(t.chars) });
    expect(out).toEqual({ result: { program: "O1" }, usage: { input: 5 }, notes: ["n"], model: "m", sources: [], searches: 0 });
    expect(ticks).toEqual([10]);
    const [url, opts] = server.calls[0];
    expect(url).toBe("/api/cnc-ai");
    expect(JSON.parse(opts.body)).toEqual({ task: "write", input: { pack: "p" } });
  });

  it("reads lines that arrive split across chunks, or with no final newline", async () => {
    const got = [];
    await readLines(streamRes(['{"t":"st', 'art"}\n{"t":"ti', 'ck","chars":3}\n{"t":"done"}']), (l) => got.push(l.t));
    expect(got).toEqual(["start", "tick", "done"]);
  });

  it("an error line becomes the message the person sees", async () => {
    answer(streamRes(['{"t":"start"}\n{"t":"error","kind":"busy","error":"The AI is busy right now."}\n']));
    await expect(askAi("review", {})).rejects.toMatchObject({ message: "The AI is busy right now.", kind: "busy" });
  });

  it("a stream that ends with no answer says the connection dropped, and that nothing changed", async () => {
    answer(streamRes(['{"t":"start"}\n{"t":"tick","chars":900}\n']));
    await expect(askAi("write", {})).rejects.toThrow(/dropped before the answer arrived. Nothing was changed/);
  });

  it("uses the server's words for a refusal, and plain ones when it has none", async () => {
    answer(jsonRes(503, { kind: "setup", error: "The AI isn't switched on yet." }));
    await expect(askAi("review", {})).rejects.toMatchObject({ message: "The AI isn't switched on yet.", kind: "setup" });
    answer({ ok: false, status: 504, json: async () => { throw new Error("not json"); } });
    await expect(askAi("write", {})).rejects.toThrow(/took too long/);
    fail(new TypeError("Failed to fetch"));
    await expect(askAi("write", {})).rejects.toBeInstanceOf(AiError);
  });

  it("says whether the AI is on, and never throws finding out", async () => {
    answer(jsonRes(200, { ready: true }));
    expect(await aiStatus()).toEqual({ ready: true, demo: false });
    answer(jsonRes(401, {}));
    expect(await aiStatus()).toEqual({ ready: false, demo: false });
    fail(new Error("offline"));
    expect(await aiStatus()).toEqual({ ready: false, demo: false });
  });
});
