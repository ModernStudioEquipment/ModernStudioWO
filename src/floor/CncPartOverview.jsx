import { useState } from "react";
import { ArrowRight, FileText, ShieldCheck, ShieldAlert, Upload, AlertTriangle, CheckCircle2, Check, ListChecks, Box, ClipboardList, Pencil, Sparkles, Ruler, Download, Code2, Copy } from "lucide-react";
import CncPreview from "./CncPreview.jsx";
import CncProveOut, { proofLine } from "./CncProveOut.jsx";
import CncRunSheet from "./CncRunSheet.jsx";
import CncAi from "./CncAi.jsx";
import CncChat from "./CncChat.jsx";
import CncNewProgram from "./CncNewProgram.jsx";
import { downloadProgram } from "./FloorPartProgram.jsx";
import { PART_STEPS, FACT_FIELDS, neededLeft, programLine, finishedSizes, fileLabel } from "./cncPack.js";
import { fmtDuration } from "./cncTime.js";
import { MACHINES } from "./machines.js";
import { splitMachines } from "./cncParts.js";

// A part at a glance. What it looks like, where it stands, and one button for
// the next thing to do. Everything else is a tap away ("All details"), not on
// the screen competing for attention.
export default function CncPartOverview({ part, pp, machineFacts, onAsk, onDetails, onMakeWorkOrder, onOpenMachines, onCommit, allParts = [] }) {
  const [proving, setProving] = useState(false);
  const [showChecks, setShowChecks] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [ai, setAi] = useState(null);   // "review" | "rewrite" | { report } while the AI screen is up
  const [writing, setWriting] = useState(false);   // the "write one from sizes" screens are up
  const newest = pp.newest;
  const [showCode, setShowCode] = useState(false);
  const d = pp.newestInfo;
  const step = pp.step;
  const machines = splitMachines(part.machine).map((k) => MACHINES.find((m) => m.key === k)).filter(Boolean);
  // Only lathe work can be written from sizes, so it's only offered for a part that's on a lathe (or on nothing yet).
  const canWrite = !machines.some((m) => m.kind === "mill") || machines.some((m) => m.kind === "lathe");
  const left = neededLeft(part, pp.programs);
  const proven = newest?.status === "proven";
  const answers = FACT_FIELDS.filter((f) => String(part.facts?.[f.key] || "").trim());
  const noTools = machines.filter((m) => !(machineFacts[m.key]?.tools || []).length);

  // The one thing to do next, as a button.
  const action = pp.loading ? null
    : !newest ? { label: "Add the program", icon: Upload, go: () => onAsk({ only: ["program"] }) }
    : pp.stops > 0 ? { label: `See what to fix`, icon: AlertTriangle, go: () => setShowChecks(true) }
    : left > 0 ? { label: `Answer ${left} question${left === 1 ? "" : "s"}`, icon: ListChecks, go: () => onAsk({}) }
    : noTools.length ? { label: `List the ${noTools[0].short}'s tools`, icon: ListChecks, go: onOpenMachines }
    : !proven ? { label: "Prove it out", icon: ShieldCheck, go: () => setProving(true) }
    : { label: "Print the run sheet", icon: FileText, go: () => setSheet(true) };

  if (writing) return <CncNewProgram part={part} pp={pp} machineFacts={machineFacts} onCommit={onCommit} onClose={() => setWriting(false)} />;
  // The AI takes the whole screen while it's open: one thing at a time.
  if (ai === "chat") {
    return <CncChat part={part} pp={pp} machineFacts={machineFacts} parts={allParts} onClose={() => setAi(null)} onRewrite={(instruction) => setAi({ rewrite: instruction })} />;
  }
  if (ai) {
    return (
      <CncAi
        part={part} pp={pp} machineFacts={machineFacts} open={ai} onClose={() => setAi(null)}
        // What a rewrite still needs: the tool list lives on the Machines page, the rest are questions on the part.
        onFill={(needs) => { setAi(null); if (needs.every((n) => n.key === "tools")) onOpenMachines(); else onAsk({}); }}
      />
    );
  }

  return (
    <div className="ov">
      {/* ---- the picture ---- */}
      <div className="ov-hero">
        {newest ? (
          <CncPreview
            compact
            content={newest.content} kind={pp.machineKind} height={360}
            toolNames={Object.fromEntries((d?.info.tools || []).filter((t) => t.note).map((t) => [t.t, t.note]))}
            stockText={part.facts?.stock || ""} material={part.material || ""}
          />
        ) : (
          <div className="ov-empty">
            <Box size={40} />
            <b>{pp.loading ? "Loading…" : "No program yet"}</b>
            {!pp.loading && <span>Add this part's program and it shows here in 3D.</span>}
            {!pp.loading && canWrite && <button className="cl-btn" onClick={() => setWriting(true)}><Ruler size={14} /> Or write one from sizes</button>}
          </div>
        )}
      </div>

      {/* ---- what it is ---- */}
      <div className="ov-id">
        <h2>{part.name || "Untitled part"}</h2>
        {newest && (() => {
          const l = fileLabel(newest.name, d?.info);
          const bits = [l.cnc, l.title, l.program || part.programNo].filter(Boolean);
          return bits.length ? <div className="ov-nums">{bits.join(" · ")}</div> : null;
        })()}
        <div className="ov-chips">
          {machines.map((m) => <span key={m.key} className="m" style={{ "--m": m.color }}>{m.label}</span>)}
          {part.sku && <span>SKU {part.sku}</span>}
          {part.material && <span>{part.material}</span>}
          {d?.time && d.time.seconds >= 1 && <span>About {fmtDuration(d.time.seconds)} a part</span>}
        </div>
      </div>

      {/* ---- where it stands, and what's next ---- */}
      {!pp.loading && (
        <div className={`ov-next ${step.tone}`}>
          <div className="ov-steps" aria-label="Progress">
            {PART_STEPS.map((name) => (
              <span key={name} className={step.done[name] ? "done" : step.at === name ? "now" : ""}>{step.done[name] ? <Check size={13} /> : null}{name}</span>
            ))}
          </div>
          <p className="ov-nexttext">{step.text}</p>
          {action && !proving && (
            <button className="ov-go" onClick={action.go}><action.icon size={18} /> {action.label} <ArrowRight size={18} /></button>
          )}
          {proving && newest && (
            <CncProveOut stops={pp.stops} sizes={finishedSizes(newest.content, part, pp.machineKind)} onStamp={async (by, record) => { if (await pp.prove(newest.id, true, by, record)) setProving(false); }} onCancel={() => setProving(false)} />
          )}
        </div>
      )}

      {/* ---- the three things behind that ---- */}
      <div className="ov-cards">
        <section className="ov-card">
          <h3>Program</h3>
          {newest ? (
            <>
              <b className="ov-file">{newest.name}</b>
              <span className="ov-sub">{d ? programLine(d.info) : ""}</span>
              <span className={`cp-stamp${proven ? " ok" : ""}`}>
                {proven ? <ShieldCheck size={14} /> : <ShieldAlert size={14} />}
                {proven ? `Proven${newest.provenBy ? ` · ${newest.provenBy}` : ""}` : "Not proven"}
              </span>
              {proven && proofLine(newest.proof) && <span className="ov-sub">{proofLine(newest.proof)}</span>}
              <div className="ov-btns">
                <button className="cl-btn" onClick={() => setSheet(true)}><FileText size={14} /> Run sheet</button>
                <button className="cl-btn" onClick={() => downloadProgram(newest)} title="Save the program file, to put on a USB stick for the machine"><Download size={14} /> Download</button>
                <button className={`cl-btn${showCode ? " on" : ""}`} onClick={() => setShowCode((v) => !v)} aria-expanded={showCode}><Code2 size={14} /> {showCode ? "Hide the program" : "Show the program"}</button>
                {!proven && <button className="cl-btn" onClick={() => setProving(true)}><ShieldCheck size={14} /> Mark proven</button>}
              </div>
            </>
          ) : (
            <>
              <span className="ov-sub">None on file.</span>
              <div className="ov-btns">
                <button className="cl-btn" onClick={() => onAsk({ only: ["program"] })}><Upload size={14} /> Add the program</button>
                {canWrite && <button className="cl-btn" onClick={() => setWriting(true)}><Ruler size={14} /> Write one from sizes</button>}
              </div>
            </>
          )}
        </section>

        <section className="ov-card">
          <h3>Checks</h3>
          {!newest ? <span className="ov-sub">Runs as soon as there's a program.</span>
            : d.found.filter((f) => f.level !== "note").length === 0 ? <span className="ov-good"><CheckCircle2 size={15} /> No problems found</span>
            : (
              <>
                <span className={`ov-count ${d.n.stop ? "stop" : "look"}`}>
                  {[d.n.stop && `${d.n.stop} to fix`, d.n.look && `${d.n.look} to check`].filter(Boolean).join(" · ")}
                </span>
                <div className="ov-btns"><button className="cl-btn" onClick={() => setShowChecks((v) => !v)}>{showChecks ? "Hide" : "Show me"}</button></div>
              </>
            )}
        </section>

        <section className="ov-card">
          <h3>Setup</h3>
          <span className="ov-sub">{left === 0 ? "The needed questions are answered." : `${left} needed question${left === 1 ? "" : "s"} left.`}</span>
          {answers.slice(0, 3).map((f) => <span key={f.key} className="ov-ans"><i>{f.label}</i>{part.facts[f.key]}</span>)}
          <div className="ov-btns">
            <button className="cl-btn" onClick={() => onAsk(left ? {} : { all: true })}><Pencil size={14} /> {left ? "Answer them" : "Change answers"}</button>
          </div>
        </section>
      </div>

      {showCode && newest && <ProgramText text={newest.content} name={newest.name} />}
      {!newest && !pp.loading && (
        <div className="ov-ai">
          <b><Sparkles size={15} /> AI</b>
          <span>No program yet. You can still ask about this part, its setup or its machine.</span>
          <button className="cl-btn ov-askbtn" onClick={() => setAi("chat")}><Sparkles size={14} /> Ask a question</button>
        </div>
      )}
      {/* ---- the AI: a second pair of eyes, and a rewrite ---- */}
      {newest && (
        <div className="ov-ai">
          <b><Sparkles size={15} /> AI</b>
          <span>
            {newest.ai?.kind === "rewrite"
              ? `This version is an AI draft. ${{ passed: "The machine does exactly what it did before.", changed: "It changes what the machine does; nothing was found wrong, and a lead should read it.", unmeasured: "The app could not measure it." }[newest.ai.verdict] || "It did not pass the checks."}`
              : newest.ai?.kind === "written" ? newest.ai.summary || "This version was written by the app from sizes."
              : "Have it read this program, or write a better version."}
          </span>
          {newest.ai?.kind === "rewrite" && <button className="cl-btn" onClick={() => setAi({ report: newest.ai })}>How it was written</button>}
          <button className="cl-btn ov-askbtn" onClick={() => setAi("chat")}><Sparkles size={14} /> Ask a question</button>
          <button className="cl-btn" onClick={() => setAi("review")}>{newest.review ? "See the AI's check" : "Check this program"}</button>
          <button className="cl-btn" onClick={() => setAi("rewrite")}>Rewrite it</button>
        </div>
      )}

      {showChecks && d && (
        <ul className="cp-found ov-found">
          {d.found.map((f, i) => (
            <li key={i} className={f.level}>
              <b>{f.level === "stop" ? "Fix" : f.level === "look" ? "Check" : "Note"}</b>
              <span>{f.text}{f.line ? ` Line ${f.line}.` : ""}</span>
            </li>
          ))}
        </ul>
      )}
      {pp.err && <div className="cl-err">{pp.err}</div>}

      <div className="ov-foot">
        <button className="cl-btn" onClick={onDetails}><Pencil size={14} /> All details</button>
        {onMakeWorkOrder && <button className="cl-btn" onClick={onMakeWorkOrder}><ClipboardList size={14} /> Make CNC work order</button>}
      </div>

      {sheet && <CncRunSheet part={part} program={newest} machineFacts={machineFacts} onClose={() => setSheet(false)} />}
    </div>
  );
}

// The program as it is, numbered the way the Haas shows it, with a box to find
// a line or a word in it and a button to copy it all.
function ProgramText({ text, name }) {
  const [find, setFind] = useState("");
  const [copied, setCopied] = useState(false);
  const lines = String(text || "").replace(/\r\n?/g, "\n").split("\n");
  const f = find.trim().toLowerCase();
  const width = String(lines.length).length;
  const shown = lines.map((l, i) => ({ l, n: i + 1 })).filter((x) => !f || x.l.toLowerCase().includes(f) || String(x.n) === f);
  return (
    <div className="ov-code">
      <div className="ov-codebar">
        <input value={find} onChange={(e) => setFind(e.target.value)} placeholder="Find a word, code or line number" aria-label={`Find in ${name || "the program"}`} />
        <button className="cl-btn" onClick={async () => { try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* nothing to copy to */ } }}>
          {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? "Copied" : "Copy"}
        </button>
      </div>
      {f && <span className="ov-sub">{shown.length} line{shown.length === 1 ? "" : "s"} with "{find.trim()}"</span>}
      <pre aria-label={`The program ${name || ""}`}>
        {shown.map((x) => <div key={x.n}><i>{String(x.n).padStart(width, " ")}</i>{x.l || " "}</div>)}
      </pre>
    </div>
  );
}
