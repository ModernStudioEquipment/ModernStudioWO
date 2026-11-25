import { useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, X, Plus, Trash2, CheckCircle2, AlertTriangle, ShieldAlert, Save, Ruler } from "lucide-react";
import CncPreview from "./CncPreview.jsx";
import CncDrawing from "./CncDrawing.jsx";
import { MACHINES } from "./machines.js";
import { cleanTools } from "./cncPack.js";
import { specFromPart, checkSpec, makeProgram, shapeProgram, materialFor, readSpec, writtenName, writtenRecord, MATERIALS } from "./cncWrite.js";
import { sizeText } from "./cncSolid.js";

// A program written from sizes, for a simple turned part. Four short screens of
// boxes, then the program, drawn and checked, to save.
//
// The drawing at the top redraws as the sizes are typed, from the real program
// (the same one that would be saved), so what's on screen is what it would cut.
//
// Nothing here is the AI. See cncWrite.js for what it writes and how it proves
// its own work.

const STEPS = [
  { key: "bar", title: "The bar", why: "What it's made from and how far it sticks out of the chuck.", fields: ["machine", "material", "stockDia", "stickOut"] },
  { key: "sizes", title: "The sizes", why: "Each diameter and how long it is, starting at the front face and working back toward the chuck.", fields: ["steps", "chamfer", "edgeBreak", "stockDia", "stickOut"] },
  { key: "extras", title: "A thread, or parting off", why: "Leave both off for a plain turned part.", fields: ["tpi", "threadLen", "partWidth", "chamfer", "stickOut"] },
  { key: "tools", title: "Tools and speeds", why: "Which pocket each tool is in. The speeds are careful starting points for this material; change them if you know better.", fields: ["tool_turn", "tool_thread", "tool_part", "tools", "sfm", "maxRpm", "rough", "finish", "depth"] },
  { key: "check", title: "Check it and save", why: "", fields: ["name", "number"] },
];
const inStep = (i, field) => STEPS[i].fields.includes(field) || (STEPS[i].key === "sizes" && /^(dia|len)\d+$/.test(field));

export default function CncNewProgram({ part, pp, machineFacts, onClose, onCommit }) {
  const [spec, setSpec] = useState(() => specFromPart(part, machineFacts));
  const [i, setI] = useState(0);
  const [pressed, setPressed] = useState(false);   // Next was pressed with something wrong: show what
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  const set = (patch) => { setSpec((s) => ({ ...s, ...patch })); };
  const setCut = (k, v) => setSpec((s) => ({ ...s, cut: { ...s.cut, [k]: v } }));
  const setTool = (k, patch) => setSpec((s) => ({ ...s, tools: { ...s.tools, [k]: { ...s.tools[k], ...patch } } }));
  const setStep = (n, k, v) => setSpec((s) => ({ ...s, steps: s.steps.map((st, j) => (j === n ? { ...st, [k]: v } : st)) }));

  const check = useMemo(() => checkSpec(spec, { machineFacts }), [spec, machineFacts]);
  const made = useMemo(() => makeProgram(spec, { machineFacts }), [spec, machineFacts]);
  // the picture only needs the sizes to make sense, not the whole form
  const shape = useMemo(() => shapeProgram(spec), [spec.steps, spec.chamfer, spec.edgeBreak, spec.thread, spec.partOff, spec.stockDia]);
  const errOf = (field) => check.errors.find((e) => e.field === field)?.text || "";
  const here = check.errors.filter((e) => inStep(i, e.field));
  // warnings sit under the step they belong to
  const warns = check.warnings.filter((w) => inStep(i, w.field));
  const step = STEPS[i];
  const tools = cleanTools(machineFacts?.[spec.machine]?.tools);
  const s = readSpec(spec);
  const usual = materialFor(spec.material);

  function next() {
    if (here.length) { setPressed(true); return; }
    setPressed(false);
    setI((n) => Math.min(STEPS.length - 1, n + 1));
  }
  // Picking a material sets the starting speeds, unless they've been typed over.
  function pickMaterial(text) {
    const m = materialFor(text);
    const was = materialFor(spec.material);
    const untouched = !was || (spec.cut.sfm === String(was.sfm) && spec.cut.rough === String(was.rough) && spec.cut.finish === String(was.finish) && spec.cut.depth === String(was.depth)) || !spec.cut.sfm;
    setSpec((p) => ({ ...p, material: text, cut: m && untouched ? { ...p.cut, sfm: String(m.sfm), rough: String(m.rough), finish: String(m.finish), depth: String(m.depth) } : p.cut }));
  }

  async function save() {
    if (!made.ok || saving) return;
    setSaving(true);
    setErr("");
    try {
      const ok = await pp.addDraft({ name: writtenName(spec), content: made.program, ai: writtenRecord(spec) });
      if (!ok) { setErr(pp.err || "Couldn't save it."); return; }
      // Put on the part what the form now knows and the part didn't.
      const field = {};
      const fact = {};
      // (the part's program numbers are a list on the form it's edited in)
      if (!(part?.programs || [part?.programNo]).some((x) => String(x || "").trim())) field.programs = [`O${s.number.padStart(5, "0")}`];
      if (!String(part?.material || "").trim()) field.material = s.material;
      if (!String(part?.machine || "").trim()) field.machine = s.machine;
      if (!String(part?.facts?.stock || "").trim()) fact.stock = `${sizeText(s.stockDia)}″ round bar`;
      if (Object.keys(field).length || Object.keys(fact).length) { try { await onCommit?.({ field, fact, ...(field.machine ? { machine: field.machine } : null) }); } catch { /* the program is saved; the part's boxes can be filled in by hand */ } }
      onClose({ saved: true });
    } finally {
      setSaving(false);
    }
  }

  const shown = (field) => (pressed ? errOf(field) : "");   // an error only shows once Next has been pressed on it

  return (
    <div className="wz np">
      <div className="wz-top">
        <span className="wz-count"><Ruler size={14} /> Step {i + 1} of {STEPS.length}</span>
        <span className="wz-bar" aria-hidden="true"><i style={{ width: `${Math.round((i / (STEPS.length - 1)) * 100)}%` }} /></span>
        <button className="wz-x" onClick={() => onClose({})} aria-label="Close"><X size={18} /></button>
      </div>

      {/* the part as it stands, from the program that would be saved */}
      {i < 4 && (
        <div className="np-draw" aria-label="The part so far">
          {shape ? <CncDrawing content={shape.program} kind="lathe" stockText={String(shape.bar)} maxHeight={170} />
            : <span>{i === 0 ? "The part draws itself here as you type the sizes." : "Fill in the boxes and the part appears here."}</span>}
        </div>
      )}

      <form className="wz-card np-card" onSubmit={(e) => { e.preventDefault(); if (i < 4) next(); }}>
        <h2 className="wz-ask">{step.title}</h2>
        {step.why && <p className="wz-why">{step.why}</p>}

        {step.key === "bar" && (
          <div className="np-grid">
            <div className={`np-field wide${pressed && errOf("machine") ? " bad" : ""}`}>
              <span className="np-lab">Which lathe?</span>
              <div className="np-machines">
                {MACHINES.filter((m) => m.kind === "lathe").map((m) => (
                  <button type="button" key={m.key} className={spec.machine === m.key ? "on" : ""} style={{ "--m": m.color }} aria-pressed={spec.machine === m.key}
                    onClick={() => setSpec((p) => ({ ...p, machine: m.key, tools: specFromPart({ ...part, machine: m.key }, machineFacts).tools }))}>{m.short}</button>
                ))}
              </div>
              {pressed && errOf("machine") && <span className="np-err">{errOf("machine")}</span>}
            </div>
            <Field err={shown("material")} label="What's it made of?" wide>
              <input className="np-in" value={spec.material} onChange={(e) => pickMaterial(e.target.value)} placeholder="e.g. 1018 steel" aria-label="Material" />
              <span className="wz-picks">{MATERIALS.map((m) => <button type="button" key={m.key} onClick={() => pickMaterial(m.label)}>{m.label.replace(/ \(.*/, "")}</button>)}</span>
            </Field>
            <Field err={shown("stockDia")} label="Bar diameter (inches)" hint="The round bar it's cut from.">
              <Num value={spec.stockDia} onChange={(v) => set({ stockDia: v })} placeholder="1.25" label="Bar diameter" />
            </Field>
            <Field err={shown("stickOut")} label="How far it sticks out of the jaws" hint="Measured from the jaws to the end of the bar.">
              <Num value={spec.stickOut} onChange={(v) => set({ stickOut: v })} placeholder="3.5" label="Stick out" />
            </Field>
          </div>
        )}

        {step.key === "sizes" && (
          <>
            <div className="np-steps">
              <div className="np-stephead"><span /><span>Diameter</span><span>Length</span><span /></div>
              {spec.steps.map((st, n) => (
                <div className="np-step" key={n}>
                  <b>{n === 0 ? "Front" : n + 1}</b>
                  <div className={pressed && errOf(`dia${n}`) ? "bad" : ""}><Num value={st.dia} onChange={(v) => setStep(n, "dia", v)} placeholder="0.625" label={`Diameter ${n + 1}`} /></div>
                  <div className={pressed && errOf(`len${n}`) ? "bad" : ""}><Num value={st.len} onChange={(v) => setStep(n, "len", v)} placeholder="1.000" label={`Length of diameter ${n + 1}`} /></div>
                  {spec.steps.length > 1 ? <button type="button" className="cl-x" onClick={() => set({ steps: spec.steps.filter((_, j) => j !== n) })} aria-label={`Remove diameter ${n + 1}`}><Trash2 size={15} /></button> : <span />}
                </div>
              ))}
              {pressed && here.filter((e) => /^(dia|len)\d+$/.test(e.field) || e.field === "steps").slice(0, 2).map((e) => <span className="np-err" key={e.field}>{e.text}</span>)}
              {spec.steps.length < 8 && <button type="button" className="cl-btn" onClick={() => set({ steps: [...spec.steps, { dia: "", len: "" }] })}><Plus size={14} /> Add the next diameter back</button>}
            </div>
            <div className="np-grid">
              <Field err={shown("chamfer")} label="Chamfer on the front edge" hint="0 for a sharp edge.">
                <Num value={spec.chamfer} onChange={(v) => set({ chamfer: v })} placeholder="0.03" label="Front chamfer" />
              </Field>
              <Field err={shown("edgeBreak")} label="Break the other corners by" hint="A small chamfer on each step, so nobody deburrs by hand. 0 for none.">
                <Num value={spec.edgeBreak} onChange={(v) => set({ edgeBreak: v })} placeholder="0.01" label="Edge break" />
              </Field>
            </div>
            {pressed && ["stockDia", "stickOut"].map((f) => errOf(f) && <span className="np-err" key={f}>{errOf(f)}</span>)}
          </>
        )}

        {step.key === "extras" && (
          <>
            <label className="ai-tick">
              <input type="checkbox" checked={!!spec.thread} onChange={(e) => set({ thread: e.target.checked ? { tpi: "", len: "" } : null })} />
              <span>Cut a thread on the front diameter<i>The front diameter you typed is what the thread is cut on. For a 5/8-11 thread that's usually a few thousandths under 0.625.</i></span>
            </label>
            {spec.thread && (
              <div className="np-grid">
                <Field err={shown("tpi")} label="Threads per inch"><Num value={spec.thread.tpi} onChange={(v) => set({ thread: { ...spec.thread, tpi: v } })} placeholder="16" label="Threads per inch" /></Field>
                <Field err={shown("threadLen")} label="Length of thread" hint="From the front face."><Num value={spec.thread.len} onChange={(v) => set({ thread: { ...spec.thread, len: v } })} placeholder="0.75" label="Thread length" /></Field>
              </div>
            )}
            <label className="ai-tick">
              <input type="checkbox" checked={!!spec.partOff} onChange={(e) => set({ partOff: e.target.checked ? { width: "0.125" } : null })} />
              <span>Part it off the bar at the end<i>Leave off if each piece is a sawn blank that comes out of the chuck whole.</i></span>
            </label>
            {spec.partOff && (
              <div className="np-grid">
                <Field err={shown("partWidth")} label="Part-off blade width" hint="The program takes the blade's Z as set on the edge nearest the chuck."><Num value={spec.partOff.width} onChange={(v) => set({ partOff: { width: v } })} placeholder="0.125" label="Blade width" /></Field>
              </div>
            )}
            {pressed && ["chamfer", "stickOut"].map((f) => errOf(f) && <span className="np-err" key={f}>{errOf(f)}</span>)}
          </>
        )}

        {step.key === "tools" && (
          <>
            <div className="np-tools">
              <ToolRow word="Turning" tools={tools} value={spec.tools.turn} onChange={(patch) => setTool("turn", patch)} err={shown("tool_turn")} />
              {spec.thread && <ToolRow word="Threading" tools={tools} value={spec.tools.thread} onChange={(patch) => setTool("thread", patch)} err={shown("tool_thread")} />}
              {spec.partOff && <ToolRow word="Part-off" tools={tools} value={spec.tools.part} onChange={(patch) => setTool("part", patch)} err={shown("tool_part")} />}
            </div>
            <div className="np-grid three">
              <Field err={shown("sfm")} label="Surface speed" hint="Feet a minute."><Num value={spec.cut.sfm} onChange={(v) => setCut("sfm", v)} placeholder="350" label="Surface speed" /></Field>
              <Field err={shown("maxRpm")} label="Top spindle speed" hint="It never goes above this."><Num value={spec.cut.maxRpm} onChange={(v) => setCut("maxRpm", v)} placeholder="2500" label="Top spindle speed" /></Field>
              <Field err={shown("depth")} label="Roughing depth" hint="Per pass, per side."><Num value={spec.cut.depth} onChange={(v) => setCut("depth", v)} placeholder="0.06" label="Roughing depth" /></Field>
              <Field err={shown("rough")} label="Roughing feed" hint="Per turn."><Num value={spec.cut.rough} onChange={(v) => setCut("rough", v)} placeholder="0.010" label="Roughing feed" /></Field>
              <Field err={shown("finish")} label="Finishing feed" hint="Per turn."><Num value={spec.cut.finish} onChange={(v) => setCut("finish", v)} placeholder="0.004" label="Finishing feed" /></Field>
            </div>
            <p className="ai-quiet">{usual ? `Starting numbers for ${usual.label.toLowerCase()}, kept on the careful side.` : "No starting numbers for this material: fill these in from what you know works."}</p>
          </>
        )}

        {step.key === "check" && (
          <>
            {made.ok ? (
              <>
                <div className="ai-verdict passed">
                  <CheckCircle2 size={26} />
                  <div>
                    <b>Written, and it cuts what you asked for</b>
                    <span>The app followed the tool through its own program: every diameter and length matches the form, no rapid move goes through the bar, and it passes the rule checks. It is still NOT PROVEN: prove it out at the machine.</span>
                  </div>
                </div>
                <CncPreview compact content={made.program} kind="lathe" height={300} stockText={String(s.stockDia)} material={spec.material} />
                <div className="np-grid">
                  <Field err={shown("name")} label="Name"><input className="np-in" value={spec.name} onChange={(e) => set({ name: e.target.value })} aria-label="Program name" /></Field>
                  <Field err={shown("number")} label="Program number" hint="Digits only. The Haas files it as O and this number."><input className="np-in" inputMode="numeric" value={spec.number} onChange={(e) => set({ number: e.target.value })} placeholder="1234" aria-label="Program number" /></Field>
                </div>
                <details className="np-code"><summary>See the program</summary><pre className="cp-code">{made.program}</pre></details>
              </>
            ) : check.ok ? (
              <div className="ai-verdict problems">
                <ShieldAlert size={26} />
                <div>
                  <b>The app couldn't prove its own program, so it isn't offering it</b>
                  <span>{(made.proof?.problems || []).join(" ")} This is a fault in the app, not in what you typed. Report it with the bug button.</span>
                </div>
              </div>
            ) : (
              <>
                <div className="np-grid">
                  <Field err={shown("name")} label="Name"><input className="np-in" value={spec.name} onChange={(e) => set({ name: e.target.value })} aria-label="Program name" /></Field>
                  <Field err={shown("number")} label="Program number" hint="Digits only. The Haas files it as O and this number."><input className="np-in" inputMode="numeric" value={spec.number} onChange={(e) => set({ number: e.target.value })} placeholder="1234" aria-label="Program number" /></Field>
                </div>
                <div className="np-left">
                  <b>Still to fill in</b>
                  {check.errors.map((e) => <button type="button" key={e.field} onClick={() => { setPressed(true); setI(Math.max(0, STEPS.findIndex((_, n) => inStep(n, e.field)))); }}>{e.text}<ArrowRight size={14} /></button>)}
                </div>
              </>
            )}
          </>
        )}

        {warns.length > 0 && (
          <ul className="np-warn">{warns.map((w, n) => <li key={n}><AlertTriangle size={14} /> <span>{w.text}</span></li>)}</ul>
        )}
        {i === 4 && check.warnings.length > 0 && made.ok && (
          <ul className="np-warn">{check.warnings.filter((w) => !inStep(4, w.field)).map((w, n) => <li key={n}><AlertTriangle size={14} /> <span>{w.text}</span></li>)}</ul>
        )}
        {err && <div className="cl-err">{err}</div>}

        <div className="wz-foot">
          <button type="button" className="wz-back" onClick={() => { setPressed(false); setI((n) => Math.max(0, n - 1)); }} disabled={i === 0}><ArrowLeft size={16} /> Back</button>
          <span className="cl-spacer" />
          {i < 4 ? <button type="submit" className="wz-next">Next <ArrowRight size={18} /></button>
            : <button type="button" className="wz-next" onClick={save} disabled={!made.ok || saving}><Save size={18} /> {saving ? "Saving…" : "Save the program"}</button>}
        </div>
        {i === 4 && made.ok && <p className="ai-quiet ai-right">Saved as a new version, marked not proven.</p>}
      </form>
    </div>
  );
}

// These are outside the screen above on purpose: defined inside it they'd be
// new components on every keystroke, and the box being typed in would lose
// its cursor each time.
function Field({ err, label, hint, children, wide }) {
  return (
    <label className={`np-field${wide ? " wide" : ""}${err ? " bad" : ""}`}>
      <span className="np-lab">{label}</span>
      {children}
      {hint && <span className="np-hint">{hint}</span>}
      {err && <span className="np-err">{err}</span>}
    </label>
  );
}
function Num({ value, onChange, placeholder, label }) {
  return <input className="np-in" inputMode="decimal" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-label={label} />;
}
function ToolRow({ word, tools, value, onChange, err }) {
  return (
    <div className={`np-tool${err ? " bad" : ""}`}>
      <b>{word}</b>
      {tools.length ? (
        <select className="np-in" value={value.t} aria-label={`${word} tool`} onChange={(e) => { const t = tools.find((x) => String(Number(x.t)) === e.target.value); onChange({ t: e.target.value, name: t ? t.what : value.name }); }}>
          <option value="">Pick a tool…</option>
          {tools.map((t) => <option key={t.t} value={String(Number(t.t))}>T{Number(t.t)} · {t.what || "no description"}</option>)}
        </select>
      ) : (
        <>
          <input className="np-in pocket" inputMode="numeric" value={value.t} onChange={(e) => onChange({ t: e.target.value })} placeholder="Pocket" aria-label={`${word} tool pocket`} />
          <input className="np-in" value={value.name} onChange={(e) => onChange({ name: e.target.value })} placeholder="What the tool is" aria-label={`${word} tool name`} />
        </>
      )}
      {err && <span className="np-err">{err}</span>}
    </div>
  );
}
