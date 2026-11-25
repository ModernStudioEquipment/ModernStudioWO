// The AI side of the CNC Catalog: what Claude is asked, what it must send back,
// and the call itself. Lives outside /api (everything in there is a route).
//
// The app never trusts an answer from here on its own. A program that comes
// back is run through the rule checker, the rapid check and a size-for-size
// comparison with the program it replaces (src/floor/cncAi.js), then read by a
// second, independent pass before a person is offered it, and it is always
// saved NOT PROVEN. This file's job is only to ask well and to fail clearly.
//
// Six jobs. Each is one request; the only memory is what the app sends with it:
//
//   review     read the current program and say what's wrong with it
//   challenge  a second pass over those findings: is each one really there?
//   write      rewrite the program to an instruction
//   fix        correct a draft that failed the app's checks or the second read
//   verify     the second read of a draft, by a pass that didn't write it
//   ask        answer a question about the part or its program, in plain words,
//              with what's already been asked and answered about it
//
// Env: ANTHROPIC_API_KEY (required). CNC_AI_MODEL and CNC_AI_EFFORT override
// the defaults below without a code change.

import Anthropic from "@anthropic-ai/sdk";

// Claude Fable 5.2: Anthropic's most capable model, chosen by the shop for this
// because a wrong program costs far more than the tokens. A single request can
// run for several minutes on it.
export const DEFAULT_MODEL = "claude-fable-5-2";
export const DEFAULT_EFFORT = "high";
const EFFORTS = ["low", "medium", "high", "xhigh", "max"];
// A declined request is re-run on the model Anthropic recommends for it,
// inside the same call, instead of coming back as a refusal.
const FALLBACK_BETA = "server-side-fallback-2026-07-01";

export const MAX_PACK_CHARS = 300_000;
export const MAX_PROGRAM_CHARS = 200_000;
const MAX_INSTRUCTION_CHARS = 4_000;     // what a person types
const MAX_NOTES_CHARS = 60_000;          // findings and notes passed between the steps
const MAX_QUESTION_CHARS = 2_000;
const MAX_HISTORY_CHARS = 60_000;
export const MAX_PHOTOS = 6;

// A photo is sent to the AI as a link it fetches. Only links to the app's own
// file storage are accepted, so the route can't be used to make it fetch
// anything else.
export function photoBlock(url) {
  const u = String(url || "").trim();
  if (!/^https:\/\//i.test(u)) return null;
  const store = String(process.env.VITE_SUPABASE_URL || "").replace(/\/+$/, "");
  if (store && !u.startsWith(`${store}/storage/`)) return null;
  return { type: "image", source: { type: "url", url: u } };
}
const MAX_TOKENS = 32_000;

export const aiModel = () => String(process.env.CNC_AI_MODEL || "").trim() || DEFAULT_MODEL;
export const aiEffort = () => (EFFORTS.includes(process.env.CNC_AI_EFFORT) ? process.env.CNC_AI_EFFORT : DEFAULT_EFFORT);
export const aiReady = () => !!String(process.env.ANTHROPIC_API_KEY || "").trim();

// ---- what every job is told first ---------------------------------------------
//
// The same text for all five, so the part's pack that follows it is read from
// the cache on the second and later requests for a part.
export const SHOP = `You are helping Modern Studio Equipment, a small shop that makes film and studio grip equipment, with the CNC programs for its three Haas machines:
- a VF-4: a vertical machining center (a 3-axis mill) with a tool changer. Work is held in a vise or a fixture on the table.
- an ST-10Y: a turning center with one spindle and a turret that has live tooling and a Y axis, so as well as turning it can drill, tap and mill off the centre line. From a photo, it appears to run the older Haas control (the blue screen), whose menus and some settings differ from the newer control: say so when that might matter.
- a DS-30SSY: a turning center with a main spindle and a sub-spindle that can take the part over to work its back end, plus live tooling and a Y axis.
Use what you know about these Haas models in general, but anything that depends on options or settings (spindle limits, the number of turret stations, the controls) has to be confirmed from the machine or from the facts the shop has written down.

The person who wrote most of these programs has left, and they were not well written: many leave work to be finished by hand that the machine could do. The people running the machines now are new to CNC and are learning. They will read what you write, and a program you write gets loaded onto a real machine.

A wrong move on these machines breaks tooling, scraps parts, or hurts the person standing at the door. So being right matters far more than being clever, thorough-looking or fast, and saying "I can't tell from what I've been given" is a good answer, never a failure.

How to work:
- The part pack in the next message is everything that is known. Work from it. Where it is silent, do not fill the gap with a guess dressed as a fact: put the question in "questions" and take the cautious option.
- A tool exists only if it is on that machine's tool list, in the pocket the list gives. Never assume a tool, an insert, a jaw, a vise or a fixture that the pack does not mention.
- The control is a Haas. Use Haas forms of the codes (on the lathes: G71, G70, G76 and G75 in the one-line Haas form, feed per revolution unless the program says otherwise, X as a diameter).
- Sizes in the pack headed "what the program cuts" were measured from the program by software that follows the tool. They are what the program does, which is not always what the drawing asks for. If a drawing is attached, the drawing is what the part should be.
- Write for someone who is not a programmer: plain shop words and short sentences, with the code in brackets after the plain words when it helps, like "turns the spindle on (M03)". No jargon without saying what it means.
- Line numbers always mean the numbers printed down the left of a numbered listing ("  12| G01 Z-1."), never N-numbers inside the program.

Levels, wherever a finding has one:
- "stop": it would crash, alarm out, cut the wrong size, or scrap the part. It must be fixed before the program runs.
- "look": probably wrong or risky. A person has to check it at the machine.
- "note": worth knowing, nothing to fix.`;

// ---- the shape of each answer (enforced by the API) ---------------------------
const STR = { type: "string" };
const INT = { type: "integer" };
const LEVEL = () => ({ type: "string", enum: ["stop", "look", "note"] });
const arr = (items) => ({ type: "array", items });
const obj = (properties) => ({ type: "object", properties, required: Object.keys(properties), additionalProperties: false });
const programSchema = () => obj({
  program: STR, summary: STR,
  changes: arr(obj({ what: STR, why: STR })),
  assumptions: arr(STR),
  questions: arr(STR),
});

// ---- what each job is asked ---------------------------------------------------
const RULES_FOR_A_PROGRAM = `Rules for the program you write. Each one is here because breaking it has crashed a machine or scrapped parts somewhere:
- The complete program, ready to load: "%" on the first line, the O-number line with the part's name in brackets, and it ends with M30 and "%". Never a fragment or a list of edits.
- Keep the same program number, the same units (G20 or G21), the same work offset, and the same pocket number for each tool as the current program.
- The finished part must not change. Every diameter, length, shoulder, radius, chamfer, groove and thread stays exactly as listed under "what the program cuts", unless the instruction asks for a size to change, in which case change only that and say so in "changes".
- Do not cut closer to the chuck, deeper, or further out than the current program does unless the instruction needs it, and if it does, say so plainly in "changes": the jaws and the fixture are where the current program stops.
- Do not raise a spindle speed, a surface speed, a speed limit (G50 S) or a feed above what the current program uses unless the instruction asks. Lowering one is fine. Say so in "changes" either way.
- Prefer the codes the current program already uses, since they are known to work on this machine. Name every code you introduce that it did not use, in "changes", with what it does.
- Every X, Y, Z, U, W, I, J, K and R value has a decimal point (X1. not X1): on a Haas a missing point can mean ten-thousandths.
- Every tool call has a comment saying what the tool is, taken from the tool list.
- Start with a safety line. Set the speed limit (G50 S) before any constant surface speed (G96). Cut threads at a fixed speed (G97). Cancel what you turn on: drilling cycles (G80), cutter compensation (G40).
- Every rapid move must be clear of the bar, the chuck and the part as it stands at that moment. Approach and leave the part in clear air.
- Every operator stop (M00 or M01) has a comment on the same line saying what the operator must do. Do not remove a stop the operator needs (turning the part round, checking a size); do remove one that only exists because of work this rewrite now does in the machine, and say so.
- Plain ASCII capitals. Comments in round brackets with no brackets inside them. No line longer than 120 characters.
- Leave macro lines (ones with #, [ ] or =) exactly as they are unless the instruction is about them.
- Do not add a "not proven" or "written by" comment: the app adds its own.`;

const JOBS = {
  review: {
    ask: `Review the CURRENT program (the numbered listing below) for the people who run it.

Follow the tool through the whole program, tool by tool, keeping track of where it is, what is modal (units, feed mode, speed mode, offsets, compensation, cycles) and what metal is left. Then report:
- "summary": two or three plain sentences for someone new to CNC: what the part comes out like, how the program gets there, and the one thing most worth knowing before running it.
- "walkthrough": the program in order, one entry per operation (a tool, or one job a tool does: facing, roughing, finishing, grooving, threading, drilling, parting off). For each give "tool" (like "T1, the CNMG roughing tool"), "lines" (like "12-20") and "what": in plain words what it does to the part, the sizes it leaves, and anything the operator has to do or watch there. Cover every tool and every stop in the program, and leave nothing out that matters; but no filler, and no explaining what a G-code is unless it matters to the job.
- "findings": real problems only, each one tied to a line you can quote exactly as it appears in the listing. Give the level, the line number, the quoted line, what is wrong and what it leads to, and how to fix it. Do not pad the list: a clean program has an empty list. The app has already run the rule checks shown in the pack, so only repeat one if you have something to add.
- "handWork": for each job the pack says is done by hand after the machine, whether this machine with the tools on its list could do it in the program instead, and roughly how. Say when it could not, and why.
- "questions": what you would need to know to be sure, that the pack does not say.`,
    schema: obj({
      summary: STR,
      walkthrough: arr(obj({ tool: STR, lines: STR, what: STR })),
      findings: arr(obj({ level: LEVEL(), line: INT, quote: STR, problem: STR, fix: STR })),
      handWork: arr(obj({ job: STR, canTheMachineDoIt: { type: "string", enum: ["yes", "no", "maybe"] }, how: STR })),
      questions: arr(STR),
    }),
  },

  challenge: {
    ask: `Another reviewer read the CURRENT program (the numbered listing below) and reported the findings listed under FINDINGS TO CHECK. Reviewers misread programs: they lose track of what is modal, miss a line further up that already deals with it, or quote a line that says something else.

For each finding, by its number: go to the line it names in the listing, read the lines before it that set the state it depends on, and decide for yourself.
- "confirmed": the problem is really there, on that line.
- "rejected": the reviewer was wrong. Say what the line actually does and which line shows it.
- "unsure": it depends on something the pack does not say. Say what.
Judge each on the program, not on how sure the reviewer sounded. Return one result for every finding.`,
    schema: obj({
      results: arr(obj({ index: INT, verdict: { type: "string", enum: ["confirmed", "rejected", "unsure"] }, reason: STR })),
    }),
  },

  write: {
    ask: `Rewrite the CURRENT program (the listing below) to the INSTRUCTION.

${RULES_FOR_A_PROGRAM}

Send back:
- "program": the whole new program as plain text.
- "summary": one or two sentences on what you changed and why it is better.
- "changes": every change, each with what it is and why, in plain words. Someone will read this list instead of comparing the two programs line by line, so nothing that changes what the machine does may be left off it.
- "assumptions": everything you took as true that the pack does not state.
- "questions": what a person should confirm before proving this out.
If the instruction cannot be done safely with the tools on the list, or you would have to guess at something that could crash the machine, do not force it: change as much as you safely can, and say what you left alone and why in "questions".`,
    schema: programSchema(),
  },

  fix: {
    ask: `The DRAFT below is a rewrite of the CURRENT program, written to the INSTRUCTION. It was checked and the PROBLEMS FOUND are listed below. Some come from software that follows the tool and measures what the program cuts; those are measurements, not opinions.

Correct the draft so that every problem at level "stop" is dealt with, and each "look" is either fixed or answered in "questions". Change only what a problem needs. If you believe a problem is a false alarm, do not work round it: leave the program as it should be and say in "questions" exactly why the check is wrong, naming the line.

${RULES_FOR_A_PROGRAM}

Send back the whole corrected program and the same lists as before, with "changes" still describing every difference from the CURRENT program (not from the draft).`,
    schema: programSchema(),
  },

  verify: {
    ask: `A different programmer wrote the DRAFT below from the CURRENT program and the INSTRUCTION. You are the second person, who reads it before anyone takes it to the machine. If you pass a draft with a mistake in it, that mistake gets run, so assume there may be one and look for it.

Go through the DRAFT (the numbered listing) line by line, following the tool. Keep track of where the tool is, what is modal, and what metal is still there. Check in particular:
- every rapid move is in clear air at that moment, on the way in and on the way out;
- every size the CURRENT program cuts is still cut the same, unless the instruction asked for it to change;
- it does not go closer to the chuck, deeper, or further out than the CURRENT program without the instruction needing it;
- each tool called is on the tool list in that pocket and is the right kind of tool for the cut it makes;
- speeds, feeds and the speed limit are not above the CURRENT program's without the instruction asking;
- cycles are written in the Haas form and point at lines that exist; what is turned on is cancelled;
- it does what the INSTRUCTION asked, and nothing it was not asked to;
- the writer's list of changes (WRITER'S NOTES) leaves nothing out that changes what the machine does.

Report only problems you can point to on a line of the DRAFT listing and explain, quoting the line exactly. Do not report style. "verdict" is "ok_to_prove_out" only if you found nothing at level "stop"; otherwise "do_not_run". "checked" is a short plain list of what you followed through, so a person can see what this pass covered and what it could not.`,
    schema: obj({
      verdict: { type: "string", enum: ["ok_to_prove_out", "do_not_run"] },
      findings: arr(obj({ level: LEVEL(), line: INT, quote: STR, problem: STR, fix: STR })),
      checked: arr(STR),
      couldNotCheck: arr(STR),
    }),
  },
};
// A question, answered in plain words rather than a fixed shape. It may explain
// and advise, but it does not hand out programs: anything that will be run has
// to come from a rewrite, which is measured before anyone is offered it.
JOBS.ask = {
  text: true,
  effort: "high",
  ask: `You are the assistant for the people in the CNC room. Someone has asked the QUESTION at the bottom. The pack above is everything the shop has written down: about the part and its program if there is one, about the three machines, and the things the shop has asked you to remember.

How to answer:
- Plain and simple first: answer the question in the first sentence or two, then whatever else they need to know. Say everything that matters (a risk, a step that's easy to miss, something to check), and nothing that doesn't. Short sentences, shop words. A short numbered list when it's a set of steps.
- It's shown as plain text: no headings, no tables, no asterisks or other markup.
- Work from the pack, the program, the photos and the conversation first. When they don't have the answer, search the web for it: Haas's own manuals and pages (haascnc.com) first, then the tooling maker's data, then other sources. Don't narrate the searching; just use what you find.
- Never stop at "I don't know". Always give your best answer, worked out as well as you can, and say how sure you are. Some things can't be found by searching (what's really in a pocket, how far a part sticks out, how a machine is set up): for those, give the most likely answer and exactly what to check at the machine to be sure.
- Try your best on hard questions too: complex programs, live tooling, the sub-spindle, setups and fixtures. Give your best reasoning and a clear plan, and be plain about which parts you're sure of and which need checking.
- Always end with a line SURE: high, SURE: medium or SURE: low, then a dash and, in a few words, why (for example "SURE: medium - from Haas's manual, but your control may be the older one"). High means you'd stake a part on it. Anything a wrong guess could crash, scrap or hurt over is never better than medium until someone has checked it at the machine.
- Ask for a photo whenever one would help you answer well (the setup, the part, the tool, the alarm on the screen, a drawing): end with a line PHOTO: followed by what to photograph.
- When you mean a line of the program, give its number from the numbered listing and quote it.
- Don't write out a program or a replacement for one here, and never more than three lines of G-code in one answer. Programs reach the machine only through the app's "Rewrite it" button, which measures a new program against the current one first. If a change to the program would help, explain it, then end with a line REWRITE: followed by the instruction to give it, in one sentence.
- If you learn something about a machine, a part or the shop that will matter again (a tool that's really in a pocket, how a part is held, a setting, a habit of the machine), end with a line REMEMBER: and the fact, in one sentence, so a person can choose to keep it. At most three. Never for something already in the pack.
- CONVERSATION SO FAR is what has already been said here, by whoever was at the screen. Use it. Don't repeat it back, and if an earlier answer was wrong, say so and correct it.
- Safety comes first: if what they describe sounds unsafe (a door interlock bypassed, reaching in while it's running, a crash they're about to repeat), say so plainly before anything else.`,
};
export const TASKS = Object.keys(JOBS);

// ---- building the request -----------------------------------------------------
export const numbered = (text) => String(text || "").replace(/\r\n?/g, "\n").split("\n").map((l, i) => `${String(i + 1).padStart(4, " ")}| ${l}`).join("\n");

// The part's drawing, if it's somewhere Claude can fetch it and a kind it reads.
export function drawingBlock(url) {
  const u = String(url || "").trim();
  if (!/^https:\/\//i.test(u)) return null;
  const ext = (/\.([a-z0-9]{2,5})(?:[?#]|$)/i.exec(u) || [])[1]?.toLowerCase() || "";
  if (ext === "pdf") return { type: "document", source: { type: "url", url: u } };
  if (["png", "jpg", "jpeg", "gif", "webp"].includes(ext)) return { type: "image", source: { type: "url", url: u } };
  return null;
}

// Check what was sent before spending anything on it. Returns an error string
// or "" when it's fine. Nothing is ever cut short to make it fit: a program
// with its end missing is worse than no answer.
export function checkInput(task, input) {
  if (!JOBS[task]) return "Unknown job.";
  const pack = String(input?.pack || "");
  const program = String(input?.program || "");
  if (!pack.trim()) return "The part's details didn't arrive.";
  if (pack.length > MAX_PACK_CHARS) return "This part's pack is too long to send. Remove old program versions and try again.";
  if (!program.trim() && task !== "ask") return "There is no program to work on.";   // (a question can be about the shop, with no program)
  if (program.length > MAX_PROGRAM_CHARS) return `This program is too long for the AI to read in one go (${program.split("\n").length.toLocaleString()} lines). Long 3D surfacing programs are, and are better fixed in Mastercam.`;
  if ((task === "write" || task === "fix" || task === "verify") && !String(input?.instruction || "").trim()) return "Say what should change first.";
  if (task === "fix" || task === "verify") {
    const draft = String(input?.draft || "");
    if (!draft.trim()) return "There is no draft to work on.";
    if (draft.length > MAX_PROGRAM_CHARS) return "The draft is too long to send.";
  }
  if (String(input?.instruction || "").length > MAX_INSTRUCTION_CHARS) return "That instruction is too long. Say it in a few sentences.";
  for (const k of ["notes", "problems", "findings"]) if (String(input?.[k] || "").length > MAX_NOTES_CHARS) return "There's too much to send in one go.";
  if (task === "fix" && !String(input?.problems || "").trim()) return "No problems were given to fix.";
  if (task === "challenge" && !String(input?.findings || "").trim()) return "No findings were given to check.";
  if (task === "ask") {
    if (!String(input?.question || "").trim()) return "Ask something first.";
    if (String(input.question).length > MAX_QUESTION_CHARS) return "That question is too long. Ask it in a few sentences.";
    if (String(input?.history || "").length > MAX_HISTORY_CHARS) return "There's too much to send in one go.";
    const photos = Array.isArray(input?.photos) ? input.photos : [];
    if (photos.length > MAX_PHOTOS) return `Send at most ${MAX_PHOTOS} photos at a time.`;
    if (photos.some((p) => !photoBlock(p?.url))) return "A photo didn't upload properly. Remove it and add it again.";
  }
  return "";
}

export function buildRequest(task, input, { withDrawing = true, withPhotos = true } = {}) {
  const job = JOBS[task];
  const content = [];
  const drawing = withDrawing ? drawingBlock(input.drawingUrl) : null;
  if (drawing) content.push(drawing);
  // The pack ends the part that's the same for every job on this part: mark it.
  const title = String(input.program || "").trim() ? "PART PACK" : "SHOP PACK";
  content.push({ type: "text", text: `${title}\n${"=".repeat(title.length)}\n${String(input.pack).trim()}${drawing ? "\n\nThe part's drawing is attached above." : ""}`, cache_control: { type: "ephemeral" } });
  // photos sent with the question (and the most recent from earlier in the conversation), each labelled
  const photos = task === "ask" && withPhotos ? (input.photos || []).slice(-MAX_PHOTOS).map((p) => ({ p, block: photoBlock(p.url) })).filter((x) => x.block) : [];
  for (const { p, block } of photos) {
    content.push(block);
    content.push({ type: "text", text: `(Above: ${String(p.label || "a photo").slice(0, 200)})` });
  }

  const parts = [job.ask];
  // (only the end is trimmed: a numbered listing's first line starts with spaces that line it up)
  const sect = (title, body) => { if (String(body || "").trim()) parts.push(`${title}\n${"-".repeat(title.length)}\n${String(body).replace(/\s+$/, "")}`); };
  if (task !== "review" && task !== "challenge") sect("INSTRUCTION", input.instruction);
  if (input.sizesMayChange) parts.push("The person asking has said the finished sizes are meant to change with this instruction.");
  if (input.speedsMayRise) parts.push("The person asking has said speeds and feeds may go up with this instruction. Raise only what the instruction needs, by no more than it needs, and list each one in \"changes\" with the old and new value.");
  // Whichever program this job reads closely gets the numbered listing.
  if (task === "review" || task === "challenge" || task === "ask") { if (String(input.program || "").trim()) sect("CURRENT PROGRAM (numbered listing)", numbered(input.program)); }
  else sect("CURRENT PROGRAM", String(input.program).trimEnd());
  if (task === "fix") sect("DRAFT", String(input.draft).trimEnd());
  if (task === "verify") { sect("DRAFT (numbered listing)", numbered(input.draft)); sect("WRITER'S NOTES", input.notes); }
  if (task === "fix") sect("PROBLEMS FOUND", input.problems);
  if (task === "verify") sect("WHAT THE APP'S OWN CHECKS FOUND ON THE DRAFT", input.problems || "Nothing.");
  if (task === "challenge") sect("FINDINGS TO CHECK", input.findings);
  if (task === "ask") {
    if (input.photos?.length && !photos.length) parts.push("(Photos were sent but couldn't be included. Say that you couldn't see them.)");
    sect("CONVERSATION SO FAR", input.history || "(nothing yet: this is the first question here)");
    sect("QUESTION", input.question);
  }
  content.push({ type: "text", text: parts.join("\n\n") });

  return {
    model: aiModel(),
    max_tokens: job.text ? 16_000 : MAX_TOKENS,
    thinking: { type: "adaptive" },
    // (a question is answered in plain text, at a lighter effort so it comes back quickly; every other job fills a fixed shape)
    output_config: job.text ? { effort: job.effort || aiEffort() } : { effort: aiEffort(), format: { type: "json_schema", schema: job.schema } },
    system: [{ type: "text", text: SHOP }],
    messages: [{ role: "user", content }],
  };
}

// ---- asking -------------------------------------------------------------------
//
// One job, start to finish. The request streams (a rewrite can take minutes),
// and `onProgress` hears about it so the route can keep its own connection to
// the browser alive.
//
// A request the API turns down as malformed is retried in simpler forms before
// giving up, because two parts of it are optional: the drawing (a link Claude
// may not be able to fetch) and the automatic fallback model. What was dropped
// is reported in `notes`, never hidden.
export async function runJob(client, task, input, { onProgress, onStream, onText, gone = () => false } = {}) {
  const hasDrawing = !!drawingBlock(input.drawingUrl);
  const hasPhotos = task === "ask" && (input.photos || []).some((p) => photoBlock(p?.url));
  const pictures = hasDrawing || hasPhotos;
  // Questions can search the web. (If the account hasn't web search switched
  // on, the request is turned down, and it's asked again without it.)
  const search = task === "ask";
  const tries = (s) => [
    { fallback: true, drawing: hasDrawing, photos: hasPhotos, search: s },
    { fallback: false, drawing: hasDrawing, photos: hasPhotos, search: s },
    ...(pictures ? [{ fallback: true, drawing: false, photos: false, search: s }, { fallback: false, drawing: false, photos: false, search: s }] : []),
  ];
  const forms = search ? [...tries(true), ...tries(false)] : tries(false);
  let lastBad = null;
  for (const form of forms) {
    // nobody left to read the answer (the tab was closed, or Stop was pressed): don't start another try
    if (gone()) throw new AiProblem("stopped", "Stopped.");
    const body = buildRequest(task, input, { withDrawing: form.drawing, withPhotos: form.photos });
    if (form.search) body.tools = [{ type: "web_search_20260209", name: "web_search", max_uses: 5 }];
    let message;
    const said = [];          // every message of this answer, when a long search pauses and is resumed
    let used = null;
    try {
      let chars = 0;
      let messages = body.messages;
      for (let leg = 0; ; leg++) {
        if (gone()) throw new AiProblem("stopped", "Stopped.");
        const req = { ...body, messages };
        const stream = form.fallback
          ? client.beta.messages.stream({ ...req, betas: [FALLBACK_BETA], fallbacks: "default" })
          : client.messages.stream(req);
        onStream?.(stream);
        stream.on("text", (delta) => { chars += delta.length; onProgress?.({ chars }); if (JOBS[task].text) onText?.(delta); });
        message = await stream.finalMessage();
        said.push(message);
        used = addUsageRaw(used, usageOf(message.usage));
        // A search that runs long pauses: sending it back as it is lets the server carry on.
        if (message.stop_reason !== "pause_turn" || leg >= 4) break;
        messages = [...messages, { role: "assistant", content: message.content }];
      }
    } catch (e) {
      if (e instanceof Anthropic.BadRequestError) { lastBad = e; continue; }
      throw e;
    }

    // Always the reason it stopped first, the content second.
    if (message.stop_reason === "refusal") throw new AiProblem("refused", "The AI declined this request.");
    if (message.stop_reason === "max_tokens") throw new AiProblem("too_long", "The answer was too long to finish. Try a narrower instruction.");
    if (message.stop_reason === "model_context_window_exceeded") throw new AiProblem("too_long", "This part's program and details are too much for the AI to read at once.");
    // anything but a finished answer isn't one: a paused or cut-off turn must not be read as a result
    if (message.stop_reason && message.stop_reason !== "end_turn") throw new AiProblem("garbled", "The AI stopped before it finished its answer. Try again.");
    const blocks = said.flatMap((m) => m.content || []);
    const text = blocks.filter((b) => b.type === "text").map((b) => b.text).join("");
    // where what it found came from: every page it quoted, once each
    const sources = [];
    for (const b of blocks) for (const c of b.type === "text" ? b.citations || [] : []) {
      if (c?.url && !sources.some((x) => x.url === c.url)) sources.push({ url: c.url, title: String(c.title || c.url).slice(0, 140) });
    }
    const searches = blocks.filter((b) => b.type === "server_tool_use" && b.name === "web_search").length;
    let result;
    if (JOBS[task].text) result = { answer: text.trim() };
    else try { result = JSON.parse(text); } catch { throw new AiProblem("garbled", "The AI's answer couldn't be read. Try again."); }
    const wrong = shapeProblem(task, result);
    if (wrong) throw new AiProblem("garbled", `The AI's answer was missing ${wrong}. Try again.`);

    const notes = [];
    if (hasDrawing && !form.drawing) notes.push("The drawing couldn't be read, so this was done without it.");
    if (hasPhotos && !form.photos) notes.push("The photos couldn't be read, so this was answered without them.");
    if (search && !form.search) notes.push("Web search isn't switched on for the AI account, so this was answered without searching.");
    if (message.model && message.model !== body.model) notes.push(`Answered by ${message.model}.`);
    return { result, usage: used, model: message.model || body.model, notes, usedDrawing: form.drawing, sources: sources.slice(0, 8), searches };
  }
  throw lastBad;
}

export class AiProblem extends Error {
  constructor(kind, message) { super(message); this.kind = kind; }
}

// The schema is enforced by the API, but a fallback model or a cut-off answer
// is exactly when it might not be: check the fields the app goes on to use.
export function shapeProblem(task, r) {
  if (!r || typeof r !== "object") return "everything";
  const isArr = (k) => Array.isArray(r[k]);
  if (task === "write" || task === "fix") {
    if (typeof r.program !== "string" || !r.program.trim()) return "the program";
    if (!isArr("changes") || !isArr("assumptions") || !isArr("questions")) return "its notes";
  }
  if (task === "review" && (!isArr("findings") || typeof r.summary !== "string")) return "its findings";
  if (task === "verify" && (!isArr("findings") || !["ok_to_prove_out", "do_not_run"].includes(r.verdict))) return "its verdict";
  if (task === "challenge" && !isArr("results")) return "its results";
  if (task === "ask" && !(typeof r.answer === "string" && r.answer.trim())) return "an answer";
  return "";
}

const addUsageRaw = (a, b) => (a ? { input: a.input + b.input, output: a.output + b.output, cacheRead: a.cacheRead + b.cacheRead, cacheWrite: a.cacheWrite + b.cacheWrite } : b);

// What the request used. When a fallback model stepped in, the work is split
// over `iterations` (one entry per model that ran), and the top-level numbers
// are only the last of them, so those are added up instead.
export const usageOf = (u) => {
  const one = (x) => ({ input: x?.input_tokens || 0, output: x?.output_tokens || 0, cacheRead: x?.cache_read_input_tokens || 0, cacheWrite: x?.cache_creation_input_tokens || 0 });
  const parts = Array.isArray(u?.iterations) && u.iterations.length ? u.iterations.map(one) : [one(u)];
  return parts.reduce((a, b) => ({ input: a.input + b.input, output: a.output + b.output, cacheRead: a.cacheRead + b.cacheRead, cacheWrite: a.cacheWrite + b.cacheWrite }));
};

// What went wrong, in words for the person who pressed the button. Decided on
// the error's type, never on its wording.
export function explain(e) {
  if (e instanceof AiProblem) return { status: 422, kind: e.kind, error: e.message };
  if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) {
    return { status: 503, kind: "key", error: "The AI key in Vercel isn't being accepted. Check ANTHROPIC_API_KEY." };
  }
  if (e instanceof Anthropic.NotFoundError) return { status: 503, kind: "key", error: "The AI model named in Vercel (CNC_AI_MODEL) doesn't exist. Remove it or correct it." };
  if (e instanceof Anthropic.RateLimitError) return { status: 429, kind: "busy", error: "The AI is busy right now. Wait a minute and try again." };
  if (e instanceof Anthropic.BadRequestError) return { status: 502, kind: "rejected", error: "The AI wouldn't take this request. Nothing was changed." };
  if (e instanceof Anthropic.APIConnectionError) return { status: 502, kind: "network", error: "Couldn't reach the AI. Check the connection and try again." };
  if (e instanceof Anthropic.APIError) return { status: 502, kind: "down", error: "The AI service had a problem. Try again in a few minutes." };
  return { status: 500, kind: "error", error: "Something went wrong asking the AI. Nothing was changed." };
}

export const makeClient = () => new Anthropic();
