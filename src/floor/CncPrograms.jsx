import { useEffect, useRef, useState } from "react";
import { Upload, Trash2, Check, CheckCircle2, Circle, Copy, Download, Eye, EyeOff, ShieldCheck, ShieldAlert } from "lucide-react";
import { db } from "../lib/db.js";
import { FACT_FIELDS, programInfo, programLine, missingTools, readiness, readyCount, buildPack, looksLikeText, MAX_PROGRAM_BYTES } from "./cncPack.js";
import { splitMachines } from "./cncParts.js";
import { MACHINES } from "./machines.js";

// "Program & setup" on a catalogue part: the program files the Haas runs, the
// facts that aren't in any file, a checklist of what's still missing, and one
// button that bundles all of it for whoever fixes the program.
//
// The facts are part of the part (saved with Save part). Program files save the
// moment they're uploaded, so they need the part to exist first.
export default function CncPrograms({ part, onFact, machineFacts = {} }) {
  const [programs, setPrograms] = useState([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [open, setOpen] = useState(null);       // program id whose text is showing
  const [proving, setProving] = useState(null); // { id, by }
  const [confirmDel, setConfirmDel] = useState(null);
  const [copied, setCopied] = useState(false);
  const fileRef = useRef(null);

  const partId = part?.id || null;
  async function reload() {
    if (!partId) { setPrograms([]); return; }
    try { setPrograms(await db.getCncPrograms(partId)); }
    catch (e) { setErr(e?.message || "Couldn't load the programs."); }
  }
  useEffect(() => { setOpen(null); setProving(null); setConfirmDel(null); setErr(""); reload(); }, [partId]);

  const say = (e, what) => setErr(
    /cnc_programs|schema cache|does not exist/i.test(e?.message || "")
      ? "Program files need migration 0068 run first."
      : `${what}${e?.message ? `: ${e.message}` : "."}`
  );

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
        if (!looksLikeText(text)) { setErr(`${f.name} isn't a program file. Upload the .nc file the Haas runs, not the Mastercam file.`); continue; }
        await db.addCncProgram({ partId, name: f.name, content: text });
      }
      await reload();
    } catch (e2) {
      say(e2, "Couldn't save that program");
    } finally {
      setBusy(false);
    }
  }

  async function prove(id, proven, by) {
    setErr("");
    try { await db.setCncProgramProven(id, proven, by); setProving(null); await reload(); }
    catch (e) { say(e, "Couldn't save that"); }
  }
  async function remove(id) {
    setErr("");
    try { await db.deleteCncProgram(id); setConfirmDel(null); await reload(); }
    catch (e) { say(e, "Couldn't delete that"); }
  }

  const checks = readiness(part, programs, machineFacts);
  const done = readyCount(checks);
  const pack = () => buildPack(part, programs, machineFacts);
  const partMachines = splitMachines(part?.machine);

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
      {programs.map((p) => {
        const info = programInfo(p.content);
        const missing = partMachines.flatMap((k) => missingTools(info, machineFacts[k]).map((t) => `T${t} isn't on the ${MACHINES.find((m) => m.key === k)?.short} tool list`));
        const proven = p.status === "proven";
        return (
          <div className={`cp-prog${proven ? " proven" : ""}`} key={p.id}>
            <div className="cp-progtop">
              <div className="cp-progname">
                <b>{p.name || "Program"}</b>
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
            {missing.length > 0 && <div className="cp-warn">{missing.join(". ")}.</div>}
            <div className="cp-progbtns">
              <button className="cl-btn" onClick={() => setOpen(open === p.id ? null : p.id)}>
                {open === p.id ? <EyeOff size={14} /> : <Eye size={14} />} {open === p.id ? "Hide" : "View"}
              </button>
              <button className="cl-btn" onClick={() => downloadText(p.name || "program.nc", p.content)}><Download size={14} /> Download</button>
              {proven ? (
                <button className="cl-btn ghost" onClick={() => prove(p.id, false)}>Not proven after all</button>
              ) : proving?.id === p.id ? (
                <span className="cp-prove">
                  <input
                    autoFocus value={proving.by} placeholder="Who proved it out?"
                    onChange={(e) => setProving({ id: p.id, by: e.target.value })}
                    onKeyDown={(e) => { if (e.key === "Enter" && proving.by.trim()) prove(p.id, true, proving.by.trim()); if (e.key === "Escape") setProving(null); }}
                    aria-label="Who proved it out"
                  />
                  <button className="cl-btn" disabled={!proving.by.trim()} onClick={() => prove(p.id, true, proving.by.trim())}><Check size={14} /> Stamp it</button>
                  <button className="cl-btn ghost" onClick={() => setProving(null)}>Cancel</button>
                </span>
              ) : (
                <button className="cl-btn" onClick={() => setProving({ id: p.id, by: "" })} title="It ran on the machine and the first part measured good"><ShieldCheck size={14} /> Mark proven</button>
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
            {open === p.id && <pre className="cp-code">{p.content}</pre>}
          </div>
        );
      })}
      <div className="cl-bpbtns">
        <button className="cl-btn" onClick={() => fileRef.current?.click()} disabled={!partId || busy}>
          <Upload size={15} /> {busy ? "Uploading…" : "Upload program file"}
        </button>
        <input ref={fileRef} type="file" multiple hidden onChange={onFiles} aria-label="Program file" />
      </div>
      {err && <div className="cl-err">{err}</div>}

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
function readText(file) {
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
