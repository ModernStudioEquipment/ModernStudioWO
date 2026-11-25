import CncPasteProgram from "./CncPasteProgram.jsx";
import { useEffect, useRef, useState } from "react";
import { Upload, Trash2, Check, CheckCircle2, Circle, Copy, Download, Eye, EyeOff, ShieldCheck, ShieldAlert, AlertTriangle, GitCompare, FileText, Box, ArrowRight } from "lucide-react";
import { FACT_FIELDS, programLine, buildPack, finishedSizes } from "./cncPack.js";
import CncRunSheet from "./CncRunSheet.jsx";
import CncProveOut, { proofLine } from "./CncProveOut.jsx";
import CncPreview from "./CncPreview.jsx";
import { fmtDuration } from "./cncTime.js";
import { usePartPrograms, readText } from "./usePartPrograms.js";

// "Program & setup" on a catalogue part: the program files the Haas runs, the
// facts that aren't in any file, a checklist of what's still missing, and one
// button that bundles all of it for whoever fixes the program.
//
// The facts are part of the part (saved with Save part). Program files save the
// moment they're uploaded, so they need the part to exist first.

const NO_FACTS = {}; // a stable default

// The default export owns the part's program data. `ProgramsView` is the same
// screen handed that data from outside, for when the editor already has it.
export default function CncPrograms(props) {
  const own = usePartPrograms(props.pp ? null : props.part, props.machineFacts, { onChanged: props.onChanged });
  return <ProgramsView {...props} pp={props.pp || own} />;
}

export function ProgramsView({ part, onFact, machineFacts = NO_FACTS, onStep, onGoTo, pp }) {
  const { programs, derived, busy, err, partId, checks, done, loading, step } = pp;
  const [open, setOpen] = useState(null);       // program id whose text is showing
  const [diffOpen, setDiffOpen] = useState(null);
  const [checksOpen, setChecksOpen] = useState(null);
  const [proving, setProving] = useState(null); // { id, by, done: [bool, bool, bool] }
  const [confirmDel, setConfirmDel] = useState(null);
  const [copied, setCopied] = useState(false);
  const [sheetFor, setSheetFor] = useState(null); // program whose run sheet is open
  const [previewOpen, setPreviewOpen] = useState(null); // program id whose drawing is showing
  const fileRef = useRef(null);
  const rootRef = useRef(null);
  // A checklist item, clicked: go to the box that answers it and put the
  // cursor in it. What lives outside this section (the drawing, the machine,
  // the material, the Machines page) is handed up to the editor.
  const goTo = (key) => {
    const fact = (k) => {
      const el = rootRef.current?.querySelector(`[data-fact="${k}"]`);
      if (!el) return;
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.focus({ preventScroll: true });
      flash(el.closest(".cp-q"));
    };
    if (key === "program") return partId ? fileRef.current?.click() : onGoTo?.("name");
    if (key === "byHand" || key === "holding") return fact(key);
    if (key === "material" && String(part?.material || "").trim()) return fact("stock");
    onGoTo?.(key);
  };

  // A different part: close whatever was open on the last one.
  useEffect(() => {
    setOpen(null); setDiffOpen(null); setChecksOpen(null); setProving(null); setConfirmDel(null); setPreviewOpen(null);
  }, [partId]);
  // The picture shows by itself: opening a part, or uploading a program to one,
  // opens the newest program's 3D preview. Hiding it sticks until the next part
  // or the next upload.
  useEffect(() => {
    if (pp.loadedFor && pp.loadedFor === partId && programs[0]) setPreviewOpen(programs[0].id);
  }, [pp.loadedFor, pp.uploads]);

  async function onFiles(e) {
    const files = [...(e.target.files || [])];
    e.target.value = "";
    await pp.addFiles(files);
  }
  const prove = async (id, proven, by) => { if (await pp.prove(id, proven, by)) setProving(null); };
  const remove = async (id) => { if (await pp.remove(id)) setConfirmDel(null); };
  const machineKind = pp.machineKind;

  // What this part needs next, told to the editor so it can say so at the top.
  const stepKey = loading ? "loading" : `${step.at}|${step.tone}|${step.text}|${Object.values(step.done).join("")}`;
  useEffect(() => { onStep?.(loading ? null : step); }, [stepKey]);
  const pack = () => buildPack(part, programs, machineFacts);

  async function copyPack() {
    const text = pack();
    try { await navigator.clipboard.writeText(text); }
    catch { /* clipboard blocked: fall back to the download */ downloadText(`${fileSafe(part?.name)}-pack.txt`, text); }
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  }

  return (
    <div className="cp" ref={rootRef}>
      <div className="cp-head">
        <h3 className="cp-h">Program &amp; setup</h3>
        <span className="cp-sub">What's needed to run, check and fix this part's program.</span>
      </div>

      {/* ---- the facts that aren't in any file: asked as questions ---- */}
      <div className="cp-h2">About the job <span>Three to answer. The rest help if you know them.</span></div>
      <div className="cp-facts">
        {FACT_FIELDS.map((f) => {
          const filled = !!String(part?.facts?.[f.key] || "").trim();
          return (
            <label key={f.key} className={`cp-q${filled ? " filled" : ""}${f.optional ? " opt" : ""}${f.long ? " cp-long" : ""}`}>
              <span className="cp-qt">
                {f.ask}
                <i>{filled ? <><Check size={12} /> Answered</> : f.optional ? "Optional" : "Needed"}</i>
              </span>
              <span className="cp-qh">{f.why}</span>
              {f.long ? (
                <textarea rows={2} data-fact={f.key} value={part?.facts?.[f.key] || ""} onChange={(e) => onFact(f.key, e.target.value)} placeholder={f.placeholder} />
              ) : (
                <input data-fact={f.key} value={part?.facts?.[f.key] || ""} onChange={(e) => onFact(f.key, e.target.value)} placeholder={f.placeholder} />
              )}
            </label>
          );
        })}
      </div>
      <div className="cp-savehint">These save with the part. Press <b>Save part</b> at the bottom when you're done.</div>

      {/* ---- program files ---- */}
      <div className="cp-h2">The program <span>{programs.length ? `${programs.length} version${programs.length === 1 ? "" : "s"} on file, newest first.` : "The file the Haas runs for this part."}</span></div>
      {!partId && <div className="cp-note">Save the part first, then upload its program files.</div>}
      {partId && programs.length === 0 && !busy && (
        <div className="cp-note">No program yet. Copy it off the Haas to a USB stick and upload the file here.</div>
      )}
      {programs.map((p, idx) => {
        const { info, found, n, older, diff, time } = derived[idx];
        const proven = p.status === "proven";
        return (
          <div className={`cp-prog${proven ? " proven" : ""}`} key={p.id}>
            <div className="cp-progtop">
              <div className="cp-progname">
                <b>{p.name || "Program"}{idx === 0 && programs.length > 1 ? " · newest" : ""}{p.ai ? <span className="cp-ai" title={p.ai.kind === "written" ? "Written by the app from sizes" : `Written by AI: ${p.ai.instruction || ""}`}>{p.ai.kind === "written" ? "From sizes" : "AI draft"}</span> : null}</b>
                <span>{programLine(info)}{time && time.seconds >= 1 ? ` · about ${fmtDuration(time.seconds)}` : ""}{info.title ? ` · ${info.title}` : ""}</span>
              </div>
              <span className={`cp-stamp${proven ? " ok" : ""}`}>
                {proven ? <ShieldCheck size={14} /> : <ShieldAlert size={14} />}
                {proven ? `Proven${p.provenBy ? ` · ${p.provenBy}` : ""}${p.provenAt ? ` · ${new Date(p.provenAt).toLocaleDateString()}` : ""}` : "Not proven"}
              </span>
            </div>
            {proven && proofLine(p.proof) && <div className="cp-tools">{proofLine(p.proof)}</div>}
            {info.tools.some((t) => t.note) && (
              <div className="cp-tools">{info.tools.filter((t) => t.note).map((t) => `T${t.t} ${t.note}`).join(" · ")}</div>
            )}

            {/* the automatic checker */}
            {found.length === 0 ? (
              <div className="cp-clean"><CheckCircle2 size={14} /> No problems found. Still prove it on the machine.</div>
            ) : (
              <button className={`cp-checkbar${n.stop ? " stop" : n.look ? " look" : ""}`} onClick={() => setChecksOpen(checksOpen === p.id ? null : p.id)} aria-expanded={checksOpen === p.id}>
                <AlertTriangle size={14} />
                {[n.stop && `${n.stop} to fix before it runs`, n.look && `${n.look} to check`, n.note && `${n.note} note${n.note === 1 ? "" : "s"}`].filter(Boolean).join(" · ")}
                <span className="cl-spacer" />
                {checksOpen === p.id ? "Hide" : "Show"}
              </button>
            )}
            {checksOpen === p.id && (
              <ul className="cp-found">
                {found.map((f, i) => (
                  <li key={i} className={f.level}>
                    <b>{f.level === "stop" ? "Fix" : f.level === "look" ? "Check" : "Note"}</b>
                    <span>{f.text}{f.line ? ` Line ${f.line}.` : ""}</span>
                  </li>
                ))}
                <li className="hint"><span>These checks catch common mistakes. They can't see the part or the fixture.</span></li>
              </ul>
            )}

            <div className="cp-progbtns">
              <button className="cl-btn" onClick={() => setPreviewOpen(previewOpen === p.id ? null : p.id)} title="A drawing of where this program takes the tool">
                <Box size={14} /> {previewOpen === p.id ? "Hide preview" : "3D preview"}
              </button>
              <button className="cl-btn" onClick={() => setOpen(open === p.id ? null : p.id)}>
                {open === p.id ? <EyeOff size={14} /> : <Eye size={14} />} {open === p.id ? "Hide" : "View"}
              </button>
              {diff && !diff.same && (
                <button className="cl-btn" onClick={() => setDiffOpen(diffOpen === p.id ? null : p.id)} title={`Compared with ${older.name || "the version before it"}`}>
                  <GitCompare size={14} /> {diffOpen === p.id ? "Hide changes" : `What changed (+${diff.added} −${diff.removed})`}
                </button>
              )}
              <button className="cl-btn" onClick={() => downloadText(p.name || "program.nc", p.content)}><Download size={14} /> Download</button>
              <button className="cl-btn" onClick={() => setSheetFor(p)} title="One page for the operator: tools, setup, stops"><FileText size={14} /> Run sheet</button>
              {proven ? (
                <button className="cl-btn ghost" onClick={() => prove(p.id, false)}>Not proven after all</button>
              ) : proving?.id !== p.id && (
                <button className="cl-btn" onClick={() => setProving({ id: p.id })} title="It ran on the machine and the first part measured good"><ShieldCheck size={14} /> Test it at the machine</button>
              )}
              <span className="cl-spacer" />
              {confirmDel === p.id ? (
                <>
                  <button className="cl-btn" onClick={() => remove(p.id)}>Delete it</button>
                  <button className="cl-btn ghost" onClick={() => setConfirmDel(null)}>Keep</button>
                </>
              ) : (
                <button className="cl-x" onClick={() => setConfirmDel(p.id)} title="Delete this program file" aria-label={`Delete ${p.name || "program"}`}><Trash2 size={15} /></button>
              )}
            </div>

            {/* proving out: the three steps, then a name */}
            {proving?.id === p.id && (
              <CncProveOut stops={n.stop} sizes={finishedSizes(p.content, part, machineKind)} onStamp={(by, record) => prove(p.id, true, by, record)} onCancel={() => setProving(null)} />
            )}

            {previewOpen === p.id && (
              <CncPreview
                content={p.content}
                kind={machineKind}
                toolNames={Object.fromEntries(info.tools.filter((t) => t.note).map((t) => [t.t, t.note]))}
                stockText={part?.facts?.stock || ""}
                material={part?.material || ""}
              />
            )}
            {diffOpen === p.id && diff && (
              <pre className="cp-code cp-diff" aria-label="Changes from the previous version">
                {diff.changes.map((c, i) => (
                  <span key={i} className={c.op === "+" ? "add" : "del"}>{`${c.op} ${String(c.n).padStart(4)}  ${c.text}\n`}</span>
                ))}
              </pre>
            )}
            {open === p.id && <pre className="cp-code">{p.content}</pre>}
          </div>
        );
      })}
      <div className="cl-bpbtns">
        <button className="cl-btn" onClick={() => fileRef.current?.click()} disabled={!partId || busy}>
          <Upload size={15} /> {busy ? "Uploading…" : programs.length ? "Upload a new version" : "Upload program file"}
        </button>
        <input ref={fileRef} type="file" multiple hidden onChange={onFiles} aria-label="Program file" />
        {partId && <CncPasteProgram busy={busy} label="Paste the program" onAdd={async (file) => (await pp.addFiles([file])) > 0} />}
      </div>
      {err && <div className="cl-err">{err}</div>}
      {sheetFor && <CncRunSheet part={part} program={sheetFor} machineFacts={machineFacts} onClose={() => setSheetFor(null)} />}

      {/* ---- what's still missing, and the bundle ---- */}
      <div className="cp-ready">
        <div className="cp-readyhead">
          <b>{done === checks.length ? "Everything's here" : `${done} of ${checks.length} filled in`}</b>
          <span className="cl-spacer" />
          <button className="cl-btn" onClick={copyPack} title="Copies the part, the tool list and the program as one block of text, to send to a programmer">
            {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? "Copied" : "Copy everything"}
          </button>
          <button className="cl-btn" onClick={() => downloadText(`${fileSafe(part?.name)}-pack.txt`, pack())} title="The same thing, as a text file"><Download size={14} /> Save as a file</button>
        </div>
        <ul className="cp-checks">
          {checks.map((c) => (
            <li key={c.key} className={c.ok ? "ok" : ""}>
              {c.ok ? (
                <span className="cp-checkrow"><CheckCircle2 size={16} /><span>{c.label}</span></span>
              ) : (
                <button className="cp-checkrow" onClick={() => goTo(c.key)} aria-label={`${c.label}: take me there`}>
                  <Circle size={16} />
                  <span>{c.label}<em>{c.how}</em></span>
                  <ArrowRight size={15} className="cp-go" />
                </button>
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

// A brief highlight on the thing a click just took you to, so the eye lands on it.
export function flash(el) {
  if (!el) return;
  el.classList.remove("cl-flash");
  void el.offsetWidth; // restart the animation if it's already running
  el.classList.add("cl-flash");
  setTimeout(() => el.classList.remove("cl-flash"), 1800);
}

export { readText };

const fileSafe = (s) => String(s || "part").trim().replace(/[^\w.-]+/g, "-").replace(/^-+|-+$/g, "") || "part";

function downloadText(name, text) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
