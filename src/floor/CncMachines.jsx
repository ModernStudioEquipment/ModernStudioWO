import { useEffect, useRef, useState } from "react";
import { Plus, Trash2, Check, Upload, Printer, BookOpen } from "lucide-react";
import CncToolSheet from "./CncToolSheet.jsx";
import { db } from "../lib/db.js";
import { MACHINES, CONTROLS, controlOf } from "./machines.js";
import { cleanMachineFacts, suggestTools } from "./cncPack.js";
import { shrinkPhoto } from "./cncChat.js";

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
  const [sheet, setSheet] = useState("");  // which machine's tool list is up to print

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

  // Changes save by themselves, a moment after typing stops (and anything
  // still waiting is saved on leaving the page). No Save button to forget.
  useEffect(() => {
    const timers = [];
    for (const m of MACHINES) {
      const f = facts[m.key];
      if (!f || saved[m.key] === undefined) continue;
      if (JSON.stringify(cleanMachineFacts(f)) === saved[m.key]) continue;
      timers.push(setTimeout(() => save(m.key), 900));
    }
    return () => timers.forEach(clearTimeout);
  }, [facts, saved]); // eslint-disable-line react-hooks/exhaustive-deps
  const latest = useRef({ facts, saved });
  latest.current = { facts, saved };
  useEffect(() => () => {
    const { facts: F, saved: S } = latest.current;
    for (const m of MACHINES) {
      if (!F[m.key] || S[m.key] === undefined) continue;
      const clean = cleanMachineFacts(F[m.key]);
      if (JSON.stringify(clean) !== S[m.key]) db.saveMachineFacts(m.key, clean).catch(() => {});
    }
  }, []);

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
              {/* prints what's saved, so the paper matches what programs are checked against */}
              <button className="cl-btn" onClick={() => setSheet(m.key)} disabled={dirty || !(f.tools || []).some((t) => String(t.t || "").trim())} title={dirty ? "Save first, then print" : "One page to tape up beside the machine"} aria-label={`Print the ${m.short} tool list`}><Printer size={14} /> Print</button>
              {(dirty || busy === m.key) && <span className="cl-saved cm-saving">Saving…</span>}
            </div>

            <div className="cm-control">
              <span className="cl-lab">Which control does it have?</span>
              <div className="cm-ctlpick">
                {Object.entries(CONTROLS).map(([k, c]) => (
                  <button key={k} className={f.control === k ? "on" : ""} aria-pressed={f.control === k} onClick={() => set(m.key, "control", f.control === k ? "" : k)}>
                    <b>{c.label}</b><span>{c.looks}</span>
                  </button>
                ))}
              </div>
              {controlOf(m, f) && (
                <a className="cm-manual" href={controlOf(m, f).manual.url} target="_blank" rel="noreferrer noopener">
                  <BookOpen size={14} /> Haas's manual for this control, with pictures of the control panel and keypad
                </a>
              )}
            </div>

            {(() => {
              // Every tool the machine's programs call, with what they call it.
              const found = suggestTools(m.key, parts, programIndex, []);
              const byNum = new Map(found.map((x) => [x.t, x]));
              const num = (r) => Number(String(r.t).replace(/\D/g, ""));
              const listedNums = new Set(f.tools.filter((r) => String(r.t).trim()).map(num));
              const missing = found.filter((x) => !listedNums.has(x.t));
              const empty = !f.tools.some((r) => String(r.t).trim() || String(r.what).trim());
              const addAll = (list) => list.forEach((x) => useTool(m.key, x.t, x.names[0]?.name || ""));
              return (<>
                <div className="cp-h2">Tools in this machine <span>The pocket number and what's in it. Changes save by themselves.</span></div>
                {empty && found.length > 0 && (
                  <div className="cm-start">
                    <b>The {m.short}'s programs call {found.length} tool{found.length === 1 ? "" : "s"}.</b>
                    <span>Start from those, then fix anything that's not what's really in the pocket.</span>
                    <button className="cl-btn cm-fill" onClick={() => addAll(found)}><Plus size={15} /> Fill in {found.length} tool{found.length === 1 ? "" : "s"} from the programs</button>
                  </div>
                )}
                <div className="cm-tools">
                  {f.tools.map((r, i) => {
                    const alts = (byNum.get(num(r))?.names || []).map((x) => x.name).filter((n) => n.toLowerCase() !== String(r.what).trim().toLowerCase()).slice(0, 3);
                    return (
                      <div className="cm-toolwrap" key={i}>
                        <div className="cm-tool">
                          <span className="cm-t">T</span>
                          <input className="cm-tnum" value={r.t} onChange={(e) => setTool(m.key, i, "t", e.target.value)} inputMode="numeric" placeholder="#" aria-label={`${m.short} tool ${i + 1} number`} />
                          <input value={r.what} onChange={(e) => setTool(m.key, i, "what", e.target.value)} placeholder="What it is, e.g. 1/2″ drill, CNMG 432 turning insert" aria-label={`${m.short} tool ${i + 1} description`} />
                          <button className="cl-x" onClick={() => dropTool(m.key, i)} title="Remove this tool" aria-label={`Remove ${m.short} tool ${i + 1}`}><Trash2 size={15} /></button>
                        </div>
                        {String(r.t).trim() && alts.length > 0 && (
                          <div className="cm-alt">
                            <span>{r.what ? "Programs also call it" : "Programs call it"}:</span>
                            {alts.map((n) => <button key={n} onClick={() => setTool(m.key, i, "what", n)} title="Use this name">{n}</button>)}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
                <button className="cl-addstep" onClick={() => setFacts((x) => ({ ...x, [m.key]: { ...x[m.key], tools: [...x[m.key].tools, { t: "", what: "" }] } }))}>
                  <Plus size={15} /> Add a tool
                </button>
                {missing.length > 0 && (
                  <div className="cm-missing">
                    <span>In the programs, not on the list:</span>
                    {missing.map((x) => (
                      <button key={x.t} onClick={() => useTool(m.key, x.t, x.names[0]?.name || "")} aria-label={`Add T${x.t} to the ${m.short} tool list`} title={x.names[0]?.name || "no name in the programs"}>
                        <Plus size={12} /> T{x.t}
                      </button>
                    ))}
                    {missing.length > 1 && <button className="all" onClick={() => addAll(missing)}>Add all {missing.length}</button>}
                  </div>
                )}
              </>);
            })()}

            <button className="cm-more" onClick={() => setMore((v) => !v)} aria-expanded={more}>{more ? "Hide" : "More about this machine"}</button>
            {more && (<>
            <div className="cm-grid">
              <label className="cl-field">
                <span className="cl-lab">Model and year</span>
                <input value={f.model} onChange={(e) => set(m.key, "model", e.target.value)} placeholder="From the nameplate, e.g. ST-10Y, 2019" />
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

            <span className="cl-lab" style={{ marginTop: 10 }}>Photos (the control panel, the keypad, the tool offset page, the nameplate)</span>
            <span className="cp-sub">{f.photos.length ? `The AI looks at ${f.photos.length > 6 ? "the first 6" : f.photos.length === 1 ? "this photo" : `these ${f.photos.length} photos`} with every question about the ${m.short}.` : `The AI will look at these with every question about the ${m.short}.`}</span>
            <MachinePhotos photos={f.photos} onChange={(photos) => set(m.key, "photos", photos)} machine={m} onErr={setErr} />
            </>)}
          </section>
        );
      })}
      {sheet && <CncToolSheet machine={MACHINES.find((m) => m.key === sheet)} facts={facts[sheet]} onClose={() => setSheet("")} />}
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
      for (const f of files) urls.push(await db.uploadBlueprint(`machine-${machine.key}`, await shrinkPhoto(f)));   // (the AI looks at these: phone photos are shrunk first)
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
