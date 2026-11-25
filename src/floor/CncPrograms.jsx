import { useEffect, useMemo, useRef, useState } from "react";
import { Upload, Trash2, Check, CheckCircle2, Circle, Copy, Download, Eye, EyeOff, ShieldCheck, ShieldAlert, AlertTriangle, GitCompare, FileText, Box } from "lucide-react";
import { db } from "../lib/db.js";
import {
  FACT_FIELDS, programInfo, programLine, checkForPart, checkCounts, diffPrograms,
  readiness, readyCount, buildPack, looksLikeProgram, MAX_PROGRAM_BYTES, PROVE_STEPS,
} from "./cncPack.js";
import CncRunSheet from "./CncRunSheet.jsx";
import CncPreview from "./CncPreview.jsx";
import { MACHINES } from "./machines.js";
import { splitMachines } from "./cncParts.js";

// "Program & setup" on a catalogue part: the program files the Haas runs, the
// facts that aren't in any file, a checklist of what's still missing, and one
// button that bundles all of it for whoever fixes the program.
//
// The facts are part of the part (saved with Save part). Program files save the
// moment they're uploaded, so they need the part to exist first.

const NO_FACTS = {}; // a stable default, so the memo below isn't thrown away every render

export default function CncPrograms({ part, onFact, machineFacts = NO_FACTS, onChanged }) {
  const [programs, setPrograms] = useState([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [open, setOpen] = useState(null);       // program id whose text is showing
  const [diffOpen, setDiffOpen] = useState(null);
  const [checksOpen, setChecksOpen] = useState(null);
  const [proving, setProving] = useState(null); // { id, by, done: [bool, bool, bool] }
  const [confirmDel, setConfirmDel] = useState(null);
  const [copied, setCopied] = useState(false);
  const [sheetFor, setSheetFor] = useState(null); // program whose run sheet is open
  const [previewOpen, setPreviewOpen] = useState(null); // program id whose drawing is showing
  const fileRef = useRef(null);

  const partId = part?.id || null;
  async function reload() {
    if (!partId) { setPrograms([]); return; }
    try { setPrograms(await db.getCncPrograms(partId)); }
    catch (e) { setErr(e?.message || "Couldn't load the programs."); }
  }
  useEffect(() => {
    setOpen(null); setDiffOpen(null); setChecksOpen(null); setProving(null); setConfirmDel(null); setPreviewOpen(null); setErr("");
    reload();
  }, [partId]);

  const say = (e, what) => setErr(
    /cnc_programs|schema cache|does not exist/i.test(e?.message || "")
      ? "Program files need migration 0068 run first."
      : `${what}${e?.message ? `: ${e.message}` : "."}`
  );
  const changed = async () => { await reload(); onChanged?.(); };

  async function onFiles(e) {
    const files = [...(e.target.files || [])];
    e.target.value = "";
    if (!files.length || !partId) return;
    setBusy(true);
    setErr("");
    try {
      for (const f of files) {
        if (f.size > MAX_PROGRAM_BYTES) { setErr(`${f.name} is too big to be a program file (over 2 MB).`); continue; }
        const text = await readText(f);
        if (!looksLikeProgram(text)) { setErr(`${f.name} isn't a program file. Upload the .nc file the Haas runs, not the Mastercam file.`); continue; }
        if (programs.some((p) => p.content === text)) { setErr(`${f.name} is already here: it's identical to a version that's been uploaded.`); continue; }
        await db.addCncProgram({ partId, name: f.name, content: text });
      }
      await changed();
    } catch (e2) {
      say(e2, "Couldn't save that program");
    } finally {
      setBusy(false);
    }
  }

  async function prove(id, proven, by) {
    setErr("");
    try { await db.setCncProgramProven(id, proven, by); setProving(null); await changed(); }
    catch (e) { say(e, "Couldn't save that"); }
  }
  async function remove(id) {
    setErr("");
    try { await db.deleteCncProgram(id); setConfirmDel(null); await changed(); }
    catch (e) { say(e, "Couldn't delete that"); }
  }

  // Reading, checking and comparing a program is real work on a big file, so it
  // runs when a program, the machine or a tool list changes, not on every
  // keystroke in the boxes above.
  const machineKey = part?.machine || "";
  // What the part's machine is, for a program that doesn't make it obvious.
  const machineKind = MACHINES.find((m) => m.key === splitMachines(machineKey)[0])?.kind || "";
  const derived = useMemo(() => programs.map((p, idx) => {
    const older = programs[idx + 1] || null; // newest first, so the next one is the version before
    const found = checkForPart(p.content, { machine: machineKey }, machineFacts);
    return { info: programInfo(p.content), found, n: checkCounts(found), older, diff: older ? diffPrograms(older.content, p.content) : null };
  }), [programs, machineKey, machineFacts]);

  const checks = readiness(part, programs, machineFacts);
  const done = readyCount(checks);
  const pack = () => buildPack(part, programs, machineFacts);

  async function copyPack() {
    const text = pack();
    try { await navigator.clipboard.writeText(text); }
    catch { /* clipboard blocked: fall back to the download */ downloadText(`${fileSafe(part?.name)}-pack.txt`, text); }
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  }

  return (
    <div className="cp">
      <div className="cp-head">
        <span className="cl-lab">Program &amp; setup</span>
        <span className="cp-sub">Everything a programmer needs to fix or rewrite this part's program.</span>
      </div>

      {/* ---- the facts that aren't in any file ---- */}
      <div className="cp-facts">
        {FACT_FIELDS.map((f) => (
          <label key={f.key} className={`cl-field${f.long ? " cp-long" : ""}`}>
            <span className="cl-lab">{f.label}</span>
            {f.long ? (
              <textarea rows={2} value={part?.facts?.[f.key] || ""} onChange={(e) => onFact(f.key, e.target.value)} placeholder={f.placeholder} />
            ) : (
              <input value={part?.facts?.[f.key] || ""} onChange={(e) => onFact(f.key, e.target.value)} placeholder={f.placeholder} />
            )}
          </label>
        ))}
      </div>

      {/* ---- program files ---- */}
      <span className="cl-lab" style={{ marginTop: 6 }}>Program files{programs.length ? ` · ${programs.length}` : ""}</span>
      {!partId && <div className="cp-note">Save the part first, then upload its program files.</div>}
      {partId && programs.length === 0 && !busy && (
        <div className="cp-note">No program yet. Copy it off the Haas to a USB stick and upload the file here.</div>
      )}
      {programs.map((p, idx) => {
        const { info, found, n, older, diff } = derived[idx];
        const proven = p.status === "proven";
        return (
          <div className={`cp-prog${proven ? " proven" : ""}`} key={p.id}>
            <div className="cp-progtop">
              <div className="cp-progname">
                <b>{p.name || "Program"}{idx === 0 && programs.length > 1 ? " · newest" : ""}</b>
                <span>{programLine(info)}{info.title ? ` · ${info.title}` : ""}</span>
              </div>
              <span className={`cp-stamp${proven ? " ok" : ""}`}>
                {proven ? <ShieldCheck size={14} /> : <ShieldAlert size={14} />}
                {proven ? `Proven${p.provenBy ? ` · ${p.provenBy}` : ""}${p.provenAt ? ` · ${new Date(p.provenAt).toLocaleDateString()}` : ""}` : "Not proven"}
              </span>
            </div>
            {info.tools.some((t) => t.note) && (
              <div className="cp-tools">{info.tools.filter((t) => t.note).map((t) => `T${t.t} ${t.note}`).join(" · ")}</div>
            )}

            {/* the automatic checker */}
            {found.length === 0 ? (
              <div className="cp-clean"><CheckCircle2 size={14} /> The automatic checks found nothing. It still has to be proven on the machine.</div>
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
                <li className="hint"><span>These are rules, not a simulation. They catch common mistakes and can't see the part or the fixture.</span></li>
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
                <button className="cl-btn" onClick={() => setProving({ id: p.id, by: "", done: PROVE_STEPS.map(() => false) })} title="It ran on the machine and the first part measured good"><ShieldCheck size={14} /> Mark proven</button>
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
              <div className="cp-provebox">
                <b>Prove it out at the machine, in this order:</b>
                {PROVE_STEPS.map((s, i) => (
                  <label key={i} className="cp-provestep">
                    <input type="checkbox" checked={proving.done[i]} onChange={(e) => setProving((v) => ({ ...v, done: v.done.map((d, j) => (j === i ? e.target.checked : d)) }))} />
                    <span>{s}</span>
                  </label>
                ))}
                {n.stop > 0 && <div className="cp-warn">The checker still lists {n.stop} thing{n.stop === 1 ? "" : "s"} to fix. Look at {n.stop === 1 ? "it" : "them"} before stamping this.</div>}
                <div className="cp-prove">
                  <input
                    value={proving.by} placeholder="Who proved it out?"
                    onChange={(e) => setProving((v) => ({ ...v, by: e.target.value }))}
                    aria-label="Who proved it out"
                  />
                  <button className="cl-btn" disabled={!proving.by.trim() || proving.done.some((d) => !d)} onClick={() => prove(p.id, true, proving.by.trim())}><Check size={14} /> Stamp it proven</button>
                  <button className="cl-btn ghost" onClick={() => setProving(null)}>Cancel</button>
                </div>
              </div>
            )}

            {previewOpen === p.id && (
              <CncPreview
                content={p.content}
                kind={machineKind}
                toolNames={Object.fromEntries(info.tools.filter((t) => t.note).map((t) => [t.t, t.note]))}
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
      </div>
      {err && <div className="cl-err">{err}</div>}
      {sheetFor && <CncRunSheet part={part} program={sheetFor} machineFacts={machineFacts} onClose={() => setSheetFor(null)} />}

      {/* ---- what's still missing, and the bundle ---- */}
      <div className="cp-ready">
        <div className="cp-readyhead">
          <b>{done === checks.length ? "Ready to hand off" : `${done} of ${checks.length} ready`}</b>
          <span className="cl-spacer" />
          <button className="cl-btn" onClick={copyPack} title="Copies the part, the machine's tool list and the program as one block of text">
            {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? "Copied" : "Copy everything"}
          </button>
          <button className="cl-btn" onClick={() => downloadText(`${fileSafe(part?.name)}-pack.txt`, pack())}><Download size={14} /> Download</button>
        </div>
        <ul className="cp-checks">
          {checks.map((c) => (
            <li key={c.key} className={c.ok ? "ok" : ""}>
              {c.ok ? <CheckCircle2 size={15} /> : <Circle size={15} />}
              <span>{c.label}</span>
              {!c.ok && <em>{c.how}</em>}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

// FileReader rather than file.text(): older Safari on the shop iPads lacks the latter.
export function readText(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result || ""));
    r.onerror = () => rej(r.error || new Error("Couldn't read that file"));
    r.readAsText(file);
  });
}

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
