import { useEffect, useRef, useState } from "react";
import { Plus, Trash2, Check, Upload } from "lucide-react";
import { db } from "../lib/db.js";
import { MACHINES } from "./machines.js";
import { cleanMachineFacts, suggestTools } from "./cncPack.js";

// The Machines page of the CNC Catalog: what each Haas actually has in it.
// A program is only as good as the tool list it was written against, so this
// is where "T3 is the 1/2 inch drill" gets written down once, per machine,
// instead of being guessed every time a program is touched.
export default function CncMachines({ onSaved, parts = [], programIndex = [], focus = "" }) {
  const [facts, setFacts] = useState({});      // machine key -> facts being edited
  const [saved, setSaved] = useState({});      // machine key -> JSON of last save
  const [busy, setBusy] = useState("");
  const [savedAt, setSavedAt] = useState({});
  const [err, setErr] = useState("");
  // One machine on screen at a time. Starts on the first one that has parts.
  const used = MACHINES.filter((m) => parts.some((p) => String(p.machine || "").split(",").includes(m.key)));
  const [sel, setSel] = useState("");
  const current = sel || used[0]?.key || MACHINES[0].key;
  const [more, setMore] = useState(false); // the rest of a machine's details, folded away

  useEffect(() => {
    (async () => {
      try {
        const all = await db.getMachineFacts();
        const next = {};
        const snap = {};
        for (const m of MACHINES) {
          next[m.key] = withBlankRow(cleanMachineFacts(all[m.key]));
          snap[m.key] = JSON.stringify(cleanMachineFacts(all[m.key]));
        }
        setFacts(next);
        setSaved(snap);
      } catch (e) {
        setErr(e?.message || "Couldn't load the machines.");
      }
    })();
  }, []);

  // Sent here from a part ("fill in that machine's tool list"): show that
  // machine and put the cursor in its first empty tool row.
  const rootRef = useRef(null);
  useEffect(() => {
    const key = String(focus).split(":")[0];
    if (!key) return;
    setSel(key);
    const t = setTimeout(() => {
      const card = rootRef.current?.querySelector(`[data-machine="${key}"]`);
      if (!card) return;
      card.scrollIntoView({ behavior: "smooth", block: "start" });
      const rows = [...card.querySelectorAll(".cm-tnum")];
      (rows.find((r) => !r.value) || rows[rows.length - 1])?.focus({ preventScroll: true });
      card.classList.add("cl-flash");
      setTimeout(() => card.classList.remove("cl-flash"), 1800);
    }, 120);
    return () => clearTimeout(t);
  }, [focus]);

  const set = (k, field, v) => setFacts((f) => ({ ...f, [k]: { ...f[k], [field]: v } }));
  const setTool = (k, i, field, v) => setFacts((f) => {
    const tools = f[k].tools.slice();
    tools[i] = { ...tools[i], [field]: v };
    // Typing on the last row opens another, so the list never runs out.
    if (i === tools.length - 1 && String(v).trim()) tools.push({ t: "", what: "" });
    return { ...f, [k]: { ...f[k], tools } };
  });
  // Take a tool the programs call and put it on the list (or name one that's
  // listed with no description). Lands in the first blank row.
  const useTool = (k, t, what) => setFacts((f) => {
    const tools = f[k].tools.slice();
    const at = tools.findIndex((r) => Number(String(r.t).replace(/\D/g, "")) === t && String(r.t).trim());
    if (at >= 0) tools[at] = { ...tools[at], what: tools[at].what || what };
    else {
      const blank = tools.findIndex((r) => !String(r.t).trim() && !String(r.what).trim());
      const row = { t: String(t), what };
      if (blank >= 0) tools[blank] = row; else tools.push(row);
    }
    if (tools.every((r) => String(r.t).trim() || String(r.what).trim())) tools.push({ t: "", what: "" });
    return { ...f, [k]: { ...f[k], tools } };
  });
  const dropTool = (k, i) => setFacts((f) => {
    const tools = f[k].tools.filter((_, j) => j !== i);
    return { ...f, [k]: { ...f[k], tools: tools.length ? tools : [{ t: "", what: "" }] } };
  });

  async function save(k) {
    setBusy(k);
    setErr("");
    try {
      const clean = cleanMachineFacts(facts[k]);
      await db.saveMachineFacts(k, clean);
      setSaved((s) => ({ ...s, [k]: JSON.stringify(clean) }));
      setSavedAt((s) => ({ ...s, [k]: Date.now() }));
      onSaved?.();
    } catch (e) {
      setErr(/cnc_machine_facts|schema cache|does not exist/i.test(e?.message || "")
        ? "Machine details need migration 0068 run first."
        : `Couldn't save${e?.message ? `: ${e.message}` : "."}`);
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="cm" ref={rootRef}>
      <div className="cp-sub" style={{ marginBottom: 4 }}>
        List what's really in each machine. Every program is checked against these.
      </div>
      <div className="cm-pick" role="tablist" aria-label="Machine">
        {MACHINES.map((m) => {
          const f = facts[m.key];
          const count = f ? cleanMachineFacts(f).tools.length : 0;
          const unsaved = f && JSON.stringify(cleanMachineFacts(f)) !== saved[m.key];
          return (
            <button key={m.key} role="tab" aria-selected={current === m.key} className={current === m.key ? "on" : ""} style={{ "--m": m.color }} onClick={() => setSel(m.key)}>
              <b>{m.short}</b>
              <span>{unsaved ? "Not saved yet" : count ? `${count} tool${count === 1 ? "" : "s"}` : "No tools listed"}</span>
            </button>
          );
        })}
      </div>
      {err && <div className="cl-err">{err}</div>}
      {MACHINES.filter((m) => m.key === current).map((m) => {
        const f = facts[m.key];
        if (!f) return null;
        const dirty = JSON.stringify(cleanMachineFacts(f)) !== saved[m.key];
        return (
          <section className="cm-card" key={m.key} data-machine={m.key} style={{ "--m": m.color }}>
            <div className="cm-head">
              <b>{m.label}</b>
              <span className="cl-spacer" />
              {!dirty && savedAt[m.key] && <span className="cl-saved"><Check size={14} /> Saved</span>}
              <button className="cl-save" onClick={() => save(m.key)} disabled={busy === m.key || !dirty} aria-label={`Save ${m.label}`}>
                {busy === m.key ? "Saving…" : "Save"}
              </button>
            </div>

            <ToolSuggestions machine={m} found={suggestTools(m.key, parts, programIndex, f.tools)} onUse={(t, what) => useTool(m.key, t, what)} />

            <div className="cp-h2">What's in each pocket <span>From the tool offset page on the Haas.</span></div>
            <div className="cm-tools">
              {f.tools.map((r, i) => (
                <div className="cm-tool" key={i}>
                  <span className="cm-t">T</span>
                  <input className="cm-tnum" value={r.t} onChange={(e) => setTool(m.key, i, "t", e.target.value)} inputMode="numeric" placeholder="#" aria-label={`${m.short} tool ${i + 1} number`} />
                  <input value={r.what} onChange={(e) => setTool(m.key, i, "what", e.target.value)} placeholder="What it is, e.g. 1/2″ drill, CNMG 432 turning insert" aria-label={`${m.short} tool ${i + 1} description`} />
                  <button className="cl-x" onClick={() => dropTool(m.key, i)} title="Remove this tool" aria-label={`Remove ${m.short} tool ${i + 1}`}><Trash2 size={15} /></button>
                </div>
              ))}
            </div>
            <button className="cl-addstep" onClick={() => setFacts((x) => ({ ...x, [m.key]: { ...x[m.key], tools: [...x[m.key].tools, { t: "", what: "" }] } }))}>
              <Plus size={15} /> Add tool
            </button>

            <button className="cm-more" onClick={() => setMore((v) => !v)} aria-expanded={more}>{more ? "Hide" : "More about this machine"}</button>
            {more && (<>
            <div className="cm-grid">
              <label className="cl-field">
                <span className="cl-lab">Model and year</span>
                <input value={f.model} onChange={(e) => set(m.key, "model", e.target.value)} placeholder="From the nameplate, e.g. ST-10, 2019" />
              </label>
              <label className="cl-field">
                <span className="cl-lab">Largest bar / part size</span>
                <input value={f.maxBar} onChange={(e) => set(m.key, "maxBar", e.target.value)} placeholder="e.g. 1.75″ through the spindle" />
              </label>
              <label className="cl-field cp-long">
                <span className="cl-lab">How it holds parts</span>
                <textarea rows={2} value={f.holding} onChange={(e) => set(m.key, "holding", e.target.value)} placeholder="e.g. 8″ 3-jaw chuck with soft jaws, 5C collets, bar feeder" />
              </label>
              <label className="cl-field cp-long">
                <span className="cl-lab">Live tools / extras</span>
                <textarea rows={2} value={f.liveTools} onChange={(e) => set(m.key, "liveTools", e.target.value)} placeholder="e.g. 2 radial live holders, 1 axial, sub-spindle with 5C collet" />
              </label>
              <label className="cl-field cp-long">
                <span className="cl-lab">Notes</span>
                <textarea rows={2} value={f.notes} onChange={(e) => set(m.key, "notes", e.target.value)} placeholder="Anything a programmer should know about this machine" />
              </label>
            </div>

            <span className="cl-lab" style={{ marginTop: 10 }}>Photos (nameplate, tool offset page, the setup)</span>
            <MachinePhotos photos={f.photos} onChange={(photos) => set(m.key, "photos", photos)} machine={m} onErr={setErr} />
            </>)}
          </section>
        );
      })}
    </div>
  );
}

// Tools the uploaded programs call that the list doesn't have yet, with the
// names the programs give them. One click puts a tool on the list.
function ToolSuggestions({ machine, found, onUse }) {
  if (!found.length) return null;
  return (
    <div className="cm-suggest">
      <div className="cm-sughead">
        <span className="cl-lab">Found in this machine's programs</span>
        <span className="cl-spacer" />
        {found.filter((s) => !s.listed).length > 1 && (
          <button className="cl-btn" onClick={() => found.filter((s) => !s.listed).forEach((s) => onUse(s.t, s.names[0]?.name || ""))}>
            <Plus size={14} /> Add all {found.filter((s) => !s.listed).length}
          </button>
        )}
      </div>
      {found.map((s) => (
        <div className="cm-sug" key={s.t}>
          <b>T{s.t}</b>
          <span className="cm-sugnames">
            {s.names.length
              ? s.names.map((n) => `${n.name}${s.names.length > 1 ? ` (${n.count})` : ""}`).join(" / ")
              : "no description in the programs"}
            {s.listed && s.listedAs && s.disagree ? ` · listed as ${s.listedAs}` : ""}
            <em> · {s.programs} program{s.programs === 1 ? "" : "s"}</em>
          </span>
          {s.disagree && <span className="cm-sugflag">programs disagree</span>}
          {(!s.listed || !s.listedAs) && (
            <button className="cl-btn" onClick={() => onUse(s.t, s.names[0]?.name || "")} aria-label={`Add T${s.t} to the ${machine.short} tool list`}>
              <Plus size={14} /> {s.listed ? "Use this name" : "Add"}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

const withBlankRow = (f) => ({ ...f, tools: [...f.tools, { t: "", what: "" }] });

function MachinePhotos({ photos, onChange, machine, onErr }) {
  const ref = useRef(null);
  const [busy, setBusy] = useState(false);
  async function onFiles(e) {
    const files = [...(e.target.files || [])].slice(0, 12 - photos.length);
    e.target.value = "";
    if (!files.length) return;
    setBusy(true);
    try {
      const urls = [];
      for (const f of files) urls.push(await db.uploadBlueprint(`machine-${machine.key}`, f));
      onChange([...photos, ...urls.filter(Boolean)]);
    } catch (e2) {
      onErr(`Couldn't upload that picture${e2?.message ? `: ${e2.message}` : "."}`);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      {photos.length > 0 && (
        <div className="cl-photos">
          {photos.map((u, i) => (
            <div className="cl-photo" key={u}>
              <a href={u} target="_blank" rel="noopener noreferrer" title="Open full size"><img src={u} alt={`${machine.short} photo ${i + 1}`} /></a>
              <div className="cl-photobtns">
                <button onClick={() => onChange(photos.filter((x) => x !== u))} title="Remove this photo" aria-label="Remove this photo"><Trash2 size={13} /></button>
              </div>
            </div>
          ))}
        </div>
      )}
      <div className="cl-bpbtns">
        <button className="cl-btn" onClick={() => ref.current?.click()} disabled={busy || photos.length >= 12}>
          <Upload size={15} /> {busy ? "Uploading…" : "Add photos"}
        </button>
        <input ref={ref} type="file" accept="image/*" multiple hidden onChange={onFiles} />
      </div>
    </>
  );
}
