import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Sparkles, Check, X, Loader2, ShieldCheck, ShieldAlert, AlertTriangle, CheckCircle2, HelpCircle, Save, RotateCcw, Square } from "lucide-react";
import CncPreview from "./CncPreview.jsx";
import { runRewrite, runReview, reportToKeep, fmtCost, rewriteNeeds, baselineOf } from "./cncAi.js";
import { askAi, aiStatus } from "./cncAiClient.js";

// The AI, for one part. Two jobs:
//
//   Check    it reads the program and says what's wrong, then a second pass
//            checks each thing it said
//   Rewrite  it writes a new version to an instruction; the app measures that
//            against the current program, sends it back if it fails, and has a
//            second pass read it before a person is offered it
//
// One thing on screen at a time: the question, then the work as it happens,
// then the answer. Nothing is saved until someone presses Save, and what's
// saved is a new version marked NOT PROVEN.
//
// `open` is "review", "rewrite", or a kept record to show again:
// { report } for a saved draft, { review } for a saved review.

const LEVEL = { stop: "Fix", look: "Check", note: "Note" };
const VERDICT = {
  passed: { head: "The machine does exactly what it did before" },
  changed: { head: "It changes what the machine does. Nothing was found wrong." },
  unmeasured: { head: "The app could not measure this one" },
  problems: { head: "It did not pass" },
};

export default function CncAi({ part, pp, machineFacts, open, onClose, onFill }) {
  const mode = typeof open === "string" ? open : open?.report ? "report" : "reviewed";
  const [status, setStatus] = useState(null);          // { ready, demo }
  const [phase, setPhase] = useState(mode === "rewrite" ? "ask" : mode === "review" ? "start" : "result");
  const [instruction, setInstruction] = useState("");
  const [sizesMayChange, setSizesMayChange] = useState(false);
  const [speedsMayRise, setSpeedsMayRise] = useState(false);
  const [steps, setSteps] = useState([]);
  const [chars, setChars] = useState(0);
  const [run, setRun] = useState(null);                // what came back
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);
  const [sure, setSure] = useState(false);             // pressed "save anyway" once
  const [show, setShow] = useState("");                // "" | "program" | "changes"
  const stopper = useRef(null);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; stopper.current?.abort(); }; }, []);
  useEffect(() => { let on = true; aiStatus().then((s) => { if (on) setStatus(s); }); return () => { on = false; }; }, []);

  const current = pp.newest;
  // A rewrite works from the proven program (or the newest a person put
  // there), not from an unproven AI draft sitting on top of it.
  const from = baselineOf(pp.programs);
  const facts = part?.facts || {};
  const needs = mode === "rewrite" ? rewriteNeeds(part, pp.programs, machineFacts) : [];
  const ask = (task, input) => askAi(task, input, { signal: stopper.current?.signal, onTick: (t) => { if (alive.current) setChars(t.chars || 0); } });

  async function go(kind) {
    setErr(""); setRun(null); setSteps([]); setChars(0); setSure(false); setShow("");
    setPhase("working");
    stopper.current = new AbortController();
    const onStep = (s) => { if (alive.current) { setChars(0); setSteps((list) => [...list, { kind: s.kind, text: s.text }]); } };
    try {
      const out = kind === "review"
        ? await runReview({ ask, part, programs: pp.programs, machineFacts, onStep })
        : await runRewrite({ ask, part, programs: pp.programs, machineFacts, instruction, sizesMayChange, speedsMayRise, onStep });
      if (!alive.current) return;
      setRun({ ...out, partId: part?.id || null });
      setPhase("result");
      // a review is kept with the version it read, so opening it again is free
      if (kind === "review" && current?.id) pp.keepReview(current.id, { ...out, usage: undefined });
    } catch (e) {
      if (!alive.current) return;
      setErr(e?.kind === "stopped" ? "" : e?.message || "Something went wrong. Nothing was changed.");
      setPhase(kind === "review" ? "start" : "ask");
    }
  }
  // The review opens straight into the work: there's nothing to ask first.
  const started = useRef(false);
  useEffect(() => {
    if (mode !== "review" || started.current || !status?.ready || !current || pp.loading) return;
    started.current = true;
    if (current.review && !err) { setRun(current.review); setPhase("result"); } else go("review");
  }, [status, current, pp.loading]);

  async function save() {
    if (!run || run.kind !== "rewrite" || saving) return;
    // Only onto the part it was written for: the answer is about that part's program and no other.
    if (run.partId !== (part?.id || null) || !pp.programs.some((p) => p.id === run.basedOn.id)) { setErr("This draft was written for a different part or program. Ask again from this one."); return; }
    setSaving(true);
    const ok = await pp.addDraft({ name: draftName(run.basedOn.name), content: run.program, ai: reportToKeep(run) });
    if (!alive.current) return;
    setSaving(false);
    if (ok) onClose({ saved: true });
    else setErr("Couldn't save it. Check the connection and try again.");
  }

  const shown = mode === "report" ? open.report : mode === "reviewed" ? open.review : run;
  const title = mode === "rewrite" ? "Rewrite the program" : mode === "report" ? "How this draft was written" : "Check the program";

  return (
    <div className="wz ai">
      <div className="wz-top">
        <button className="cl-btn ghost" onClick={() => onClose({})}><ArrowLeft size={15} /> Back to the part</button>
        <span className="cl-spacer" />
        <span className="ai-title"><Sparkles size={15} /> {title}</span>
        <button className="wz-x" onClick={() => onClose({})} aria-label="Close"><X size={18} /></button>
      </div>

      {status && !status.ready && phase !== "result" && (
        <div className="wz-card">
          <h2 className="wz-ask">The AI isn't switched on yet</h2>
          <p className="wz-why">It needs an Anthropic account key added to the app's settings in Vercel, under the name ANTHROPIC_API_KEY. Whoever looks after the app does this once. Nothing else needs to change.</p>
        </div>
      )}

      {status?.ready && !current && !pp.loading && (
        <div className="wz-card"><h2 className="wz-ask">There's no program yet</h2><p className="wz-why">Add this part's program first.</p></div>
      )}

      {/* ---- what has to be on the part before a rewrite ---- */}
      {status?.ready && current && phase === "ask" && needs.length > 0 && (
        <div className="wz-card">
          <h2 className="wz-ask">A few things first</h2>
          <p className="wz-why">A rewrite written without these would be guessing at the things that crash machines. Fill them in and come back.</p>
          <ul className="ai-list ai-needs">
            {needs.map((n) => <li key={n.key}><b>{n.label}</b><span>{n.how}</span></li>)}
          </ul>
          <div className="wz-foot">
            <span className="cl-spacer" />
            <button className="wz-next" onClick={() => onFill?.(needs)}>Fill them in <ArrowRight size={18} /></button>
          </div>
        </div>
      )}

      {/* ---- the one question a rewrite asks ---- */}
      {status?.ready && current && phase === "ask" && needs.length === 0 && (
        <form className="wz-card" onSubmit={(e) => { e.preventDefault(); if (instruction.trim()) go("rewrite"); }}>
          <h2 className="wz-ask">What should change?</h2>
          <p className="wz-why">Say it the way you'd tell a programmer. It rewrites <b>{from.name}</b>{from !== current ? (from.status === "proven" ? " (the proven version, not the unproven draft on top of it)" : " (the last version a person put here, not the AI draft on top of it)") : ""} and keeps every finished size the same unless you say otherwise.</p>
          <textarea className="wz-input" rows={3} value={instruction} onChange={(e) => setInstruction(e.target.value)} placeholder="e.g. Break the sharp edges in the machine so nobody has to deburr by hand" aria-label="What should change" autoFocus />
          <div className="wz-picks">
            {picks(facts).map((p) => <button type="button" key={p.label} onClick={() => setInstruction(p.text)}>{p.label}</button>)}
          </div>
          <label className="ai-tick">
            <input type="checkbox" checked={sizesMayChange} onChange={(e) => setSizesMayChange(e.target.checked)} />
            <span>A finished size is meant to change<i>Leave this off unless the part itself should come out different.</i></span>
          </label>
          <label className="ai-tick">
            <input type="checkbox" checked={speedsMayRise} onChange={(e) => setSpeedsMayRise(e.target.checked)} />
            <span>It's allowed to run faster<i>Leave this off unless you want higher speeds or feeds. Off, anything made faster is rejected.</i></span>
          </label>
          {err && <div className="cl-err">{err}</div>}
          <p className="ai-quiet">{status.demo ? "Demo: no AI is asked and nothing is sent anywhere." : "This sends the part's details and its program to Anthropic's AI. A rewrite usually costs one to five dollars. What it cost is shown afterwards."}</p>
          <div className="wz-foot">
            <span className="cl-spacer" />
            <button type="submit" className="wz-next" disabled={!instruction.trim()}>Write it <ArrowRight size={18} /></button>
          </div>
        </form>
      )}

      {status?.ready && current && phase === "start" && err && (
        <div className="wz-card">
          <h2 className="wz-ask">That didn't work</h2>
          <div className="cl-err">{err}</div>
          <div className="wz-foot"><span className="cl-spacer" /><button className="wz-next" onClick={() => go("review")}>Try again <RotateCcw size={18} /></button></div>
        </div>
      )}

      {/* ---- the work, as it happens ---- */}
      {phase === "working" && (
        <div className="wz-card">
          <h2 className="wz-ask">{mode === "review" ? "Checking it" : "Working on it"}</h2>
          <p className="wz-why">{mode === "review" ? "Usually about a minute." : "Usually one to five minutes. You can leave this open and come back."}</p>
          <ol className="ai-steps" aria-live="polite">
            {steps.map((s, i) => {
              const last = i === steps.length - 1;
              return (
                <li key={i} className={last ? "now" : "done"}>
                  {last ? <Loader2 size={16} className="ai-spin" /> : <Check size={16} />}
                  <span>{s.text}{last && chars > 0 ? <i> · {chars.toLocaleString()} characters so far</i> : null}</span>
                </li>
              );
            })}
          </ol>
          <div className="wz-foot"><span className="cl-spacer" /><button className="cl-btn" onClick={() => stopper.current?.abort()}><Square size={13} /> Stop</button></div>
        </div>
      )}

      {/* ---- a rewrite, or the record of one ---- */}
      {phase === "result" && shown?.kind === "rewrite" && (
        <div className="ai-out">
          {/* Four outcomes, and only one is green: the machine doing exactly what it did before. */}
          <div className={`ai-verdict ${shown.verdict === "passed" ? "passed" : shown.verdict === "problems" ? "problems" : "look"}`}>
            {shown.verdict === "passed" ? <ShieldCheck size={26} /> : shown.verdict === "problems" ? <ShieldAlert size={26} /> : <AlertTriangle size={26} />}
            <div>
              <b>{shown.demo ? "Demo: " : ""}{VERDICT[shown.verdict]?.head || "It did not pass"}</b>
              <span>
                {shown.verdict === "passed" ? `Every line of code is the same as in ${shown.basedOn?.name || "the current program"}: only comments changed, or a speed or feed came down. It is still marked not proven.`
                  : shown.verdict === "changed" ? `${shown.changedLines || "Some"} line${shown.changedLines === 1 ? "" : "s"} of code changed. The measurements and the second read found nothing wrong, but no set of checks covers everything. Have a lead read the changed lines, then prove it out: Graphics, single block, measure the first part.`
                  : shown.verdict === "unmeasured" ? `${shown.unmeasured} Only the second read has looked at it. A lead must go through every changed line before anyone runs it.`
                  : shown.reasons.join(" ")}
              </span>
            </div>
          </div>

          {shown.summary && <p className="ai-sum">{shown.summary}</p>}
          <p className="ai-asked"><i>Asked:</i> {shown.instruction}</p>

          {run?.kind === "rewrite" && (
            <CncPreview compact content={run.program} kind={pp.machineKind} height={300} stockText={facts.stock || ""} material={part?.material || ""} />
          )}

          <Block title="What changed" empty="It listed no changes." items={shown.changes} render={(c) => <><b>{c.what}</b>{c.why ? <span>{c.why}</span> : null}</>} />
          <Block title="Questions for you before proving it out" tone="ask" icon={HelpCircle} items={shown.questions} render={(q) => <span>{q}</span>} />
          <Block title="What it took for granted" items={shown.assumptions} render={(q) => <span>{q}</span>} />

          <Findings title="Measured against the current program" list={(shown.measured || []).filter((f) => f.level !== "note" && !f.was)} clean="Nothing to fix and nothing to check." />
          {shown.coverage?.measured?.length > 0 && <Plain title="What was measured" items={shown.coverage.measured} />}
          {shown.coverage?.notMeasured?.length > 0 && <Plain title="What was not, and can't be" items={shown.coverage.notMeasured} tone="warn" />}
          {(shown.measured || []).some((f) => f.was && f.level !== "note") && (
            <Findings title="Already true of the current program" list={shown.measured.filter((f) => f.was && f.level !== "note")} />
          )}
          {shown.second ? (
            <>
              <Findings title="The second read" list={shown.second.findings} clean="Found nothing wrong." />
              {shown.second.checked?.length > 0 && <Plain title="What the second read followed through" items={shown.second.checked} />}
              {shown.second.couldNotCheck?.length > 0 && <Plain title="What it could not check" items={shown.second.couldNotCheck} tone="warn" />}
            </>
          ) : <div className="ai-block"><h3>The second read</h3><p className="ai-quiet">Not done on this version.</p></div>}
          {(shown.measured || []).filter((f) => f.level === "note").map((f, i) => <p className="ai-quiet" key={i}>{f.text}</p>)}

          {run?.kind === "rewrite" && (
            <>
              <div className="ov-btns">
                <button className="cl-btn" onClick={() => setShow(show === "changes" ? "" : "changes")}>{show === "changes" ? "Hide" : "Show"} the changed lines (+{run.diff.added} −{run.diff.removed})</button>
                <button className="cl-btn" onClick={() => setShow(show === "program" ? "" : "program")}>{show === "program" ? "Hide" : "Show"} the whole program</button>
              </div>
              {show === "changes" && (
                <pre className="cp-code cp-diff" aria-label="Changed lines">
                  {run.diff.changes.map((c, i) => <span key={i} className={c.op === "+" ? "add" : "del"}>{`${c.op} ${String(c.n).padStart(4)}  ${c.text}\n`}</span>)}
                </pre>
              )}
              {show === "program" && <pre className="cp-code">{run.program}</pre>}
            </>
          )}

          <p className="ai-quiet">
            {shown.fixes ? `It was sent back ${shown.fixes} time${shown.fixes === 1 ? "" : "s"} to be corrected. ` : ""}
            {shown.cost > 0 ? `Cost ${fmtCost(shown.cost)} (estimate). ` : ""}
            {(run?.notes || []).join(" ")}
          </p>
          {err && <div className="cl-err">{err}</div>}

          {run?.kind === "rewrite" && (
            <div className="wz-foot">
              <button className="wz-back" onClick={() => { setRun(null); setPhase("ask"); }}><RotateCcw size={16} /> Ask again</button>
              <span className="cl-spacer" />
              <button className="wz-skip" onClick={() => onClose({})}>Throw it away</button>
              {run.verdict === "passed" || run.verdict === "changed" || sure ? (
                <button className="wz-next" onClick={save} disabled={saving}><Save size={18} /> {saving ? "Saving…" : run.verdict === "problems" ? "Yes, save it with its problems" : run.verdict === "unmeasured" ? "Yes, save it unmeasured" : "Save as a new version"}</button>
              ) : (
                <button className="wz-skip ai-anyway" onClick={() => setSure(true)}>Save it anyway</button>
              )}
            </div>
          )}
          {run?.kind === "rewrite" && <p className="ai-quiet ai-right">Saving adds it as the newest version, marked not proven. The current program stays on file.</p>}
        </div>
      )}

      {/* ---- a review ---- */}
      {phase === "result" && shown?.kind === "review" && (
        <div className="ai-out">
          <div className={`ai-verdict ${shown.findings.some((f) => f.level === "stop") ? "problems" : shown.findings.length ? "look" : "passed"}`}>
            {shown.findings.some((f) => f.level === "stop") ? <AlertTriangle size={26} /> : <CheckCircle2 size={26} />}
            <div>
              <b>{headline(shown.findings)}</b>
              <span>{shown.summary}</span>
            </div>
          </div>

          <Findings title="What it found" list={shown.findings} clean="Nothing. That is one reader's opinion, not a proven program." />
          {shown.rejected?.length > 0 && (
            <div className="ai-block">
              <h3>Raised, then thrown out by the second pass</h3>
              <ul className="ai-list quiet">{shown.rejected.map((f, i) => <li key={i}><span>{f.text}</span><span className="ai-why">Thrown out: {f.why}</span></li>)}</ul>
            </div>
          )}
          <Block title="Hand work the machine could do" items={shown.handWork} render={(h) => <><b>{h.job}: {h.canTheMachineDoIt === "yes" ? "yes" : h.canTheMachineDoIt === "no" ? "no" : "maybe"}</b><span>{h.how}</span></>} />
          <Block title="What it would need to know to be sure" tone="ask" icon={HelpCircle} items={shown.questions} render={(q) => <span>{q}</span>} />
          <Block title="What the program does, step by step" items={shown.walkthrough} render={(w) => <><b>Lines {w.lines}</b><span>{w.what}</span></>} />

          <p className="ai-quiet">
            {shown.checked ? "Each finding was checked by a second pass. " : ""}
            {shown.at ? `Checked ${new Date(shown.at).toLocaleDateString()}. ` : ""}
            {shown.cost > 0 ? `Cost ${fmtCost(shown.cost)} (estimate). ` : ""}
            {(shown.notes || []).join(" ")}
          </p>
          {err && <div className="cl-err">{err}</div>}
          <div className="wz-foot">
            {status?.ready && <button className="wz-back" onClick={() => go("review")}><RotateCcw size={16} /> Check it again</button>}
            <span className="cl-spacer" />
            <button className="wz-next" onClick={() => onClose({})}>Done <ArrowRight size={18} /></button>
          </div>
        </div>
      )}
    </div>
  );
}

// Starting points for the instruction, from what's already written on the part.
function picks(facts) {
  const none = /^(none|nothing|no|n\/a|na)\.?$/i.test(String(facts.byHand || "").trim());
  return [
    { label: "Tidy it up and make it safer", text: "Tidy the program up and make it safer to run. Add a comment to every tool and every stop. Do not change what the part comes out like." },
    facts.byHand && !none ? { label: "Do the hand work in the machine", text: `Do this in the machine instead of by hand afterwards, where the tools on the list allow it: ${facts.byHand}` } : null,
    facts.problems ? { label: "Fix the known problem", text: `Fix this problem: ${facts.problems}` } : null,
  ].filter(Boolean);
}

const headline = (findings) => {
  const stop = findings.filter((f) => f.level === "stop").length;
  const look = findings.filter((f) => f.level === "look").length;
  if (stop) return `${stop} thing${stop === 1 ? "" : "s"} to fix before it runs${look ? `, ${look} to check` : ""}`;
  if (look) return `${look} thing${look === 1 ? "" : "s"} to check`;
  return "It found nothing wrong";
};

// "O00017.nc" -> "O00017 AI draft.nc"
export const draftName = (name) => {
  const m = /^(.*?)(?: AI draft)?(\.[A-Za-z0-9]{1,6})?$/.exec(String(name || "").trim()) || [];
  return `${m[1] || "program"} AI draft${m[2] || ".nc"}`;
};

function Block({ title, items, render, empty = "", tone = "", icon: Icon = null }) {
  if (!items?.length && !empty) return null;
  return (
    <div className={`ai-block ${tone}`}>
      <h3>{Icon ? <Icon size={14} /> : null}{title}</h3>
      {items?.length ? <ul className="ai-list">{items.map((x, i) => <li key={i}>{render(x)}</li>)}</ul> : <p className="ai-quiet">{empty}</p>}
    </div>
  );
}
function Plain({ title, items, tone = "" }) {
  return (
    <div className={`ai-block ${tone}`}>
      <h3>{title}</h3>
      <ul className="ai-list quiet">{items.map((x, i) => <li key={i}><span>{x}</span></li>)}</ul>
    </div>
  );
}
function Findings({ title, list, clean = "" }) {
  return (
    <div className="ai-block">
      <h3>{title}</h3>
      {list.length === 0 ? (clean ? <div className="cp-clean"><CheckCircle2 size={14} /> {clean}</div> : null) : (
        <ul className="cp-found">
          {list.map((f, i) => (
            <li key={i} className={f.level}>
              <b>{LEVEL[f.level] || "Check"}</b>
              <span>
                {f.text}{f.line ? ` Line ${f.line}.` : ""}
                {f.quote ? <code className="ai-quote">{f.quote}</code> : null}
                {f.fix ? <span className="ai-why">How to fix it: {f.fix}</span> : null}
                {f.unsure ? <span className="ai-why">The second pass wasn't sure: {f.unsure}</span> : null}
                {f.unplaced ? <span className="ai-why">It pointed at a line that isn't in the program, so treat this one with care.</span> : null}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
