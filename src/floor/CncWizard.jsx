import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Check, Upload, X, CheckCircle2 } from "lucide-react";
import { WIZARD_STEPS, wizardAnswer, programLine } from "./cncPack.js";
import { MACHINES } from "./machines.js";
import { splitMachines, joinMachines } from "./cncParts.js";

// Setting a part up, one question at a time.
//
// The full form asks all of this on one long page, which is a lot to take in.
// Here each question gets the screen to itself: answer it, press Next, and it's
// saved. Anything can be skipped and come back to. Only the questions that
// aren't answered yet are asked, unless you're reviewing.
//
// `keys` is the list of questions for this sitting, fixed when it opens so the
// count doesn't shift under you as answers go in.
export default function CncWizard({ keys, part, pp, machineFacts = {}, onCommit, onUploadDrawing, onClose, onOpenMachines }) {
  const [list] = useState(keys);
  const [i, setI] = useState(0);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const inputRef = useRef(null);
  const fileRef = useRef(null);
  const step = WIZARD_STEPS.find((s) => s.key === list[i]) || null;
  const finished = i >= list.length;

  // Each question starts from what's already saved for it.
  useEffect(() => {
    if (!step) return;
    setValue(step.kind === "program" || step.kind === "drawing" ? "" : wizardAnswer(step.key, part, pp.programs));
    setErr("");
    const t = setTimeout(() => inputRef.current?.focus(), 60);
    return () => clearTimeout(t);
  }, [i]);

  const patchFor = (v) => {
    if (step.key === "name" || step.key === "sku" || step.key === "material") return { field: { [step.key]: v } };
    if (step.key === "machine") return { machine: v };
    return { fact: { [step.key]: v } };
  };
  const answeredNow = step ? !!wizardAnswer(step.key, part, pp.programs) : false;

  async function next(skip = false) {
    if (busy || !step) return;
    setErr("");
    const v = String(value || "").trim();
    const fileStep = step.kind === "program" || step.kind === "drawing";
    if (!skip && !fileStep) {
      if (!v && step.key === "name") { setErr("It needs a name before anything else can be saved."); return; }
      if (v !== wizardAnswer(step.key, part, pp.programs)) {
        setBusy(true);
        try { await onCommit(patchFor(v)); }
        catch (e) { setErr(e?.message || "Couldn't save that."); setBusy(false); return; }
        setBusy(false);
      }
    }
    if (skip && step.key === "name" && !part?.id && !String(part?.name || "").trim()) { setErr("It needs a name before anything else can be saved."); return; }
    setI((n) => n + 1);
  }

  async function onProgram(e) {
    const files = [...(e.target.files || [])];
    e.target.value = "";
    await pp.addFiles(files);
  }
  async function onDrawing(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setBusy(true);
    setErr("");
    try { const url = await onUploadDrawing(file); if (url) await onCommit({ field: { blueprintUrl: url } }); }
    catch (e2) { setErr(e2?.message ? `Couldn't upload that: ${e2.message}` : "Couldn't upload that."); }
    finally { setBusy(false); }
  }

  if (finished) {
    const missingTools = splitMachines(part?.machine).filter((k) => !(machineFacts[k]?.tools || []).length).map((k) => MACHINES.find((m) => m.key === k)).filter(Boolean);
    const proven = pp.newest?.status === "proven";
    return (
      <div className="wz">
        <div className="wz-card wz-done">
          <CheckCircle2 size={44} />
          <h2>That's it for now</h2>
          <p>Everything you answered is saved on <b>{part?.name || "the part"}</b>.</p>
          {missingTools.length > 0 && (
            <div className="wz-todo">
              <span>One more thing: the {missingTools.map((m) => m.short).join(" and ")} has no tool list yet, so programs can't be checked against it.</span>
              <button className="cl-btn" onClick={onOpenMachines}>Open Machines <ArrowRight size={14} /></button>
            </div>
          )}
          {pp.newest && !proven && <p className="wz-quiet">Next, the program gets proven out at the machine.</p>}
          <button className="wz-next" onClick={onClose} autoFocus>See the part <ArrowRight size={18} /></button>
        </div>
      </div>
    );
  }

  const machines = splitMachines(value);
  const toggle = (k) => setValue(joinMachines(machines.includes(k) ? machines.filter((x) => x !== k) : [...machines, k]));

  return (
    <div className="wz">
      <div className="wz-top">
        <span className="wz-count">Question {i + 1} of {list.length}</span>
        <span className="wz-bar" aria-hidden="true"><i style={{ width: `${Math.round(((i) / list.length) * 100)}%` }} /></span>
        <button className="wz-x" onClick={onClose} aria-label="Close the questions"><X size={18} /></button>
      </div>

      <form className="wz-card" onSubmit={(e) => { e.preventDefault(); next(false); }}>
        <span className={`wz-tag${step.needed ? "" : " opt"}`}>{step.needed ? "Needed" : "Optional"}</span>
        <h2 className="wz-ask">{step.ask}</h2>
        <p className="wz-why">{step.why}</p>

        {step.kind === "machine" && (
          <div className="wz-machines">
            {MACHINES.map((m) => (
              <button type="button" key={m.key} className={`wz-machine${machines.includes(m.key) ? " on" : ""}`} style={{ "--m": m.color }} onClick={() => toggle(m.key)} aria-pressed={machines.includes(m.key)}>
                <b>{m.short}</b>
                <span>{m.kind === "mill" ? "Mill" : "Lathe"}</span>
                {machines.includes(m.key) && <Check size={18} />}
              </button>
            ))}
          </div>
        )}

        {step.kind === "program" && (
          <div className="wz-file">
            {pp.newest ? (
              <div className="wz-got"><CheckCircle2 size={18} /><span><b>{pp.newest.name}</b>{pp.newestInfo ? programLine(pp.newestInfo.info) : ""}</span></div>
            ) : null}
            <button type="button" className="wz-upload" onClick={() => fileRef.current?.click()} disabled={pp.busy || !part?.id}>
              <Upload size={20} /> {pp.busy ? "Reading it…" : pp.newest ? "Add another version" : "Choose the program file"}
            </button>
            <input ref={fileRef} type="file" multiple hidden onChange={onProgram} aria-label="Program file" />
            {pp.err && <div className="cl-err">{pp.err}</div>}
          </div>
        )}

        {step.kind === "drawing" && (
          <div className="wz-file">
            {part?.blueprintUrl ? <img className="wz-thumb" src={part.blueprintUrl} alt="The drawing" /> : null}
            <button type="button" className="wz-upload" onClick={() => fileRef.current?.click()} disabled={busy}>
              <Upload size={20} /> {busy ? "Uploading…" : part?.blueprintUrl ? "Replace it" : "Choose a picture"}
            </button>
            <input ref={fileRef} type="file" accept="image/*" hidden onChange={onDrawing} aria-label="Drawing" />
          </div>
        )}

        {(step.kind === "text" || step.kind === "fact") && (
          <>
            {step.long ? (
              <textarea
                ref={inputRef} className="wz-input" rows={3} value={value} placeholder={step.placeholder} aria-label={step.ask}
                onChange={(e) => setValue(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); next(false); } }}
              />
            ) : (
              <input ref={inputRef} className="wz-input" value={value} placeholder={step.placeholder} aria-label={step.ask} onChange={(e) => setValue(e.target.value)} />
            )}
            {step.picks && (
              <div className="wz-picks">
                {step.picks.map((p) => <button type="button" key={p} onClick={() => { setValue(p); inputRef.current?.focus(); }}>{p}</button>)}
              </div>
            )}
          </>
        )}

        {err && <div className="cl-err">{err}</div>}

        <div className="wz-foot">
          <button type="button" className="wz-back" onClick={() => setI((n) => Math.max(0, n - 1))} disabled={i === 0 || busy}><ArrowLeft size={16} /> Back</button>
          <span className="cl-spacer" />
          {!(step.kind === "program" && pp.newest) && !(step.kind === "drawing" && part?.blueprintUrl) && (
            <button type="button" className="wz-skip" onClick={() => next(true)} disabled={busy}>{answeredNow ? "Leave as it is" : "Skip for now"}</button>
          )}
          <button type="submit" className="wz-next" disabled={busy || (step.kind === "program" && !pp.newest) || (step.kind === "drawing" && !part?.blueprintUrl)}>
            {busy ? "Saving…" : i === list.length - 1 ? "Finish" : "Next"} <ArrowRight size={18} />
          </button>
        </div>
      </form>
    </div>
  );
}
