// The CNC Catalog's AI: review a program, or rewrite one.
//
//   GET  /api/cnc-ai   -> { ready, model }   is the AI switched on?
//   POST /api/cnc-ai   -> one job (see lib/cncAi.js), answered as a stream
//
// Signed-in staff only: every call here costs money, and the part pack is the
// shop's own work. The body is one job with the text it needs; the prompts and
// the rules live on this side, in lib/cncAi.js, where the browser can't alter
// them.
//
// The answer is a stream of lines, each one JSON:
//
//   {"t":"start"}                      the job was accepted
//   {"t":"tick","chars":1234}          still working (also keeps the line open)
//   {"t":"done","result":…,"usage":…}  the answer
//   {"t":"error","error":"…"}          it failed; nothing was changed
//
// A rewrite takes a minute or more, and a connection that says nothing for
// that long gets cut by something in between, so it never goes quiet.
//
// Env: ANTHROPIC_API_KEY. Optional: CNC_AI_MODEL, CNC_AI_EFFORT.

import { callerStaff, notSignedIn } from "../lib/apiAuth.js";
import { aiReady, aiModel, checkInput, runJob, explain, makeClient } from "../lib/cncAi.js";

const json = (status, body) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

export async function GET(request) {
  if (!(await callerStaff(request))) return notSignedIn();
  return json(200, { ready: aiReady(), model: aiModel() });
}

export async function POST(request, { client = null } = {}) {
  if (!(await callerStaff(request))) return notSignedIn();
  if (!aiReady() && !client) return json(503, { kind: "setup", error: "The AI isn't switched on yet. It needs an Anthropic key added in Vercel (ANTHROPIC_API_KEY)." });

  const body = await request.json().catch(() => null);
  const task = String(body?.task || "");
  const input = body?.input && typeof body.input === "object" ? body.input : null;
  const bad = input ? checkInput(task, input) : "Nothing was sent.";
  if (bad) return json(400, { kind: "input", error: bad });

  const enc = new TextEncoder();
  let live = null;     // the request to Claude, so it can be dropped if the browser goes away
  let beat = null;
  let chars = 0;
  let open = true;
  const stream = new ReadableStream({
    async start(controller) {
      const say = (o) => { if (open) { try { controller.enqueue(enc.encode(`${JSON.stringify(o)}\n`)); } catch { open = false; } } };
      say({ t: "start" });
      beat = setInterval(() => say({ t: "tick", chars }), 5000);
      try {
        const out = await runJob(client || makeClient(), task, input, {
          onStream: (s) => { live = s; },
          onProgress: (p) => { chars = p.chars; },
          gone: () => !open,
        });
        say({ t: "done", ...out });
      } catch (e) {
        const x = explain(e);
        say({ t: "error", kind: x.kind, error: x.error });
      } finally {
        clearInterval(beat);
        if (open) { open = false; try { controller.close(); } catch { /* already gone */ } }
      }
    },
    // The browser closed the tab or pressed Stop: don't keep paying for an
    // answer nobody will read.
    cancel() {
      open = false;
      clearInterval(beat);
      try { live?.abort?.(); } catch { /* nothing to stop */ }
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store, no-transform", "x-accel-buffering": "no" },
  });
}
