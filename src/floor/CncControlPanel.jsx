import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Pencil, Check, Plus, Trash2, X, ShieldCheck, ShieldAlert, MousePointerClick } from "lucide-react";
import { panelFor, guidesFor, keyName, KEY_HELP, BIG, allKeys } from "./cncKeypad.js";
import "./cncControlPanel.css";

// A Haas control panel drawn key for key (cncKeypad.js has the layouts), with
// guides that light up the keys to press, in order, with an arrow on each.
// Tapping any key says what it does. A lead can change a guide's steps (and
// which keys each one lights) and mark it checked on the real machine; those
// changes are kept with the machine.
//
// machine: an entry from MACHINES; control: "ngc" | "classic";
// saved: the machine's guides as the shop changed them; onSave(guides).
export default function CncControlPanel({ machine, control, saved = {}, onSave = null }) {
  const panel = panelFor(control);
  const guides = useMemo(() => guidesFor(control, saved), [control, saved]);
  const [gid, setGid] = useState(guides[0]?.id || "");
  const guide = guides.find((g) => g.id === gid) || null;
  const [at, setAt] = useState(0);
  const [info, setInfo] = useState(null);    // the key tapped, to say what it does
  const [editing, setEditing] = useState(null);   // a copy of the guide being changed
  const [picking, setPicking] = useState(false);  // tapping keys adds them to the step
  const [by, setBy] = useState(() => { try { return localStorage.getItem("mse_cnc_name") || ""; } catch { return ""; } });
  useEffect(() => { setAt(0); setInfo(null); setEditing(null); setPicking(false); }, [gid, control]);

  const shown = editing || guide;
  const step = shown?.steps?.[at] || null;
  const lit = new Map((step?.keys || []).map((id, i) => [id, i + 1]));

  function press(id) {
    if (editing && picking) {
      setEditing((g) => ({ ...g, steps: g.steps.map((s, i) => (i !== at ? s : { ...s, keys: s.keys.includes(id) ? s.keys.filter((x) => x !== id) : [...s.keys, id] })) }));
      return;
    }
    setInfo(id);
  }
  async function save(patch = {}) {
    const g = { ...(editing || guide), ...patch };
    const next = { ...(saved || {}), [g.id]: { title: g.title, steps: g.steps, ...(g.checked ? { checked: true, by: g.by, at: g.at } : {}) } };
    await onSave?.(next);
    setEditing(null); setPicking(false);
  }
  async function markChecked() {
    const name = by.trim();
    if (!name) return;
    try { localStorage.setItem("mse_cnc_name", name); } catch { /* fine */ }
    await save({ checked: true, by: name, at: Date.now() });
  }
  if (!panel) return null;

  return (
    <div className="kp-wrap">
      {/* ---- the guides ---- */}
      <div className="kp-guides" role="tablist" aria-label="How to">
        {guides.map((g) => (
          <button key={g.id} role="tab" aria-selected={g.id === gid} className={g.id === gid ? "on" : ""} onClick={() => setGid(g.id)}>
            {g.checked ? <ShieldCheck size={13} /> : null}{g.title}
          </button>
        ))}
      </div>

      {shown && (
        <div className="kp-step">
          <div className="kp-stephead">
            <b>{shown.title}</b>
            <span className={`kp-checked${shown.checked ? " ok" : ""}`}>
              {shown.checked ? <><ShieldCheck size={13} /> Checked on our {machine?.short || "machine"}{shown.by ? ` by ${shown.by}` : ""}</> : <><ShieldAlert size={13} /> Not checked on our machine yet</>}
            </span>
          </div>
          {step ? (
            <div className="kp-say">
              <span className="kp-num">{at + 1}<i>of {shown.steps.length}</i></span>
              {editing
                ? <textarea value={step.say} onChange={(e) => setEditing((g) => ({ ...g, steps: g.steps.map((s, i) => (i === at ? { ...s, say: e.target.value } : s)) }))} aria-label="What this step says" rows={2} />
                : <p>{step.say}</p>}
            </div>
          ) : <p className="kp-sub">No steps yet.</p>}
          {step?.keys?.length > 0 && (
            <div className="kp-keysline">
              {step.keys.map((id, i) => <span key={`${id}${i}`}><b>{i + 1}</b>{keyName(panel, id)}</span>)}
            </div>
          )}
          <div className="kp-nav">
            <button className="cl-btn" onClick={() => setAt((n) => Math.max(0, n - 1))} disabled={at === 0} aria-label="Previous step"><ChevronLeft size={16} /> Back</button>
            <button className="cl-btn kp-next" onClick={() => setAt((n) => Math.min((shown.steps?.length || 1) - 1, n + 1))} disabled={!shown.steps || at >= shown.steps.length - 1} aria-label="Next step">Next <ChevronRight size={16} /></button>
            <span className="cl-spacer" />
            {onSave && !editing && <button className="cl-btn" onClick={() => setEditing(JSON.parse(JSON.stringify({ ...guide, checked: false, by: "", at: 0 })))}><Pencil size={14} /> Change this guide</button>}
          </div>
          {editing && (
            <div className="kp-edit">
              <label className="cl-field"><span className="cl-lab">Title</span><input value={editing.title} onChange={(e) => setEditing((g) => ({ ...g, title: e.target.value }))} /></label>
              <div className="kp-editrow">
                <button className={`cl-btn${picking ? " on" : ""}`} onClick={() => setPicking((v) => !v)} aria-pressed={picking}><MousePointerClick size={14} /> {picking ? "Done picking keys" : "Pick this step's keys"}</button>
                <button className="cl-btn" onClick={() => { setEditing((g) => ({ ...g, steps: [...g.steps.slice(0, at + 1), { keys: [], say: "" }, ...g.steps.slice(at + 1)] })); setAt((n) => n + 1); }}><Plus size={14} /> Add a step after this</button>
                <button className="cl-btn" disabled={editing.steps.length <= 1} onClick={() => { setEditing((g) => ({ ...g, steps: g.steps.filter((_, i) => i !== at) })); setAt((n) => Math.max(0, n - 1)); }}><Trash2 size={14} /> Remove this step</button>
              </div>
              {picking && <p className="kp-sub">Tap keys on the panel to add them to this step, in the order they're pressed. Tap a lit key to take it off.</p>}
              <div className="kp-editrow">
                <button className="cl-btn ghost" onClick={() => { setEditing(null); setPicking(false); }}><X size={14} /> Cancel</button>
                <button className="cl-btn kp-save" onClick={() => save()}><Check size={14} /> Save the guide</button>
              </div>
              <p className="kp-sub">A changed guide goes back to "not checked" until it's tried on the machine.</p>
            </div>
          )}
          {!editing && !shown.checked && onSave && (
            <div className="kp-check">
              <span>Tried every step on the {machine?.short || "machine"} and it's right?</span>
              <input value={by} onChange={(e) => setBy(e.target.value)} placeholder="Your name" aria-label="Your name" />
              <button className="cl-btn" disabled={!by.trim()} onClick={markChecked}><ShieldCheck size={14} /> Mark it checked</button>
            </div>
          )}
        </div>
      )}

      {/* ---- the panel ---- */}
      <Scaled focus={step?.keys?.[0] || ""} at={`${gid}:${at}`}>
        <div className={`kp ${control}`} aria-label={`${panel.name} keypad`}>
          <div className="kp-col kp-side">
            <div className="kp-logo" aria-hidden="true">H</div>
            <div className="kp-powers">
              <Big id="poweron" label="POWER ON" cls="kp-pon" lit={lit} onPress={press} />
              <Big id="poweroff" label="POWER OFF" cls="kp-poff" lit={lit} onPress={press} />
            </div>
            <Big id="estop" label="EMERGENCY STOP" cls="kp-estop" lit={lit} onPress={press} />
            <Big id="handle" label="HANDLE JOG" cls="kp-handle" lit={lit} onPress={press} />
            <div className="kp-powers">
              <Big id="cyclestart" label="CYCLE START" cls="kp-cs" lit={lit} onPress={press} />
              <Big id="feedhold" label="FEED HOLD" cls="kp-fh" lit={lit} onPress={press} />
            </div>
          </div>
          <div className="kp-col">
            <div className="kp-screen">
              <span>OPERATION: MEM</span>
              <b>{step ? step.say : panel.name}</b>
            </div>
            <div className="kp-body">
              <div className="kp-col">
                <Rows rows={panel.top} lit={lit} onPress={press} info={info} />
                <Rows rows={panel.fkeys} lit={lit} onPress={press} info={info} />
                <Rows rows={panel.functions} lit={lit} onPress={press} info={info} />
                <Rows rows={panel.jog} lit={lit} onPress={press} info={info} gap />
                <div className="kp-title">OVERRIDES</div>
                <Rows rows={panel.overrides} lit={lit} onPress={press} info={info} />
              </div>
              <div className="kp-col">
                <div className="kp-right">
                  <div className="kp-col">
                    <div className="kp-title">DISPLAY</div>
                    <Rows rows={panel.display} lit={lit} onPress={press} info={info} />
                    <Rows rows={panel.cursor} lit={lit} onPress={press} info={info} gap />
                  </div>
                  <Rows rows={panel.modes} lit={lit} onPress={press} info={info} />
                </div>
                <div className="kp-right">
                  <div className="kp-col">
                    <Rows rows={panel.letters} lit={lit} onPress={press} info={info} />
                  </div>
                  <div className="kp-col">
                    <Rows rows={panel.numbers} lit={lit} onPress={press} info={info} />
                    <Rows rows={panel.entry} lit={lit} onPress={press} info={info} />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </Scaled>

      {/* ---- what a tapped key does ---- */}
      {info && !picking && (
        <div className="kp-info" role="status">
          <b>{keyName(panel, info)}</b>
          <span>{KEY_HELP[info] || "No note for this key yet."}</span>
          <button className="cl-x" onClick={() => setInfo(null)} aria-label="Close"><X size={14} /></button>
        </div>
      )}
      {!info && <p className="kp-sub kp-tip">Tap any key to see what it does. On a phone, slide the panel sideways to see all of it.</p>}
    </div>
  );
}

function Rows({ rows, lit, onPress, info, gap = false }) {
  return (
    <div className={`kp-rows${gap ? " gap" : ""}`}>
      {rows.map((row, r) => (
        <div className="kp-row" key={r}>
          {row.map((x, i) => {
            if (!x) return <span key={i} className="kp-gap" />;
            if (x.text) return <span key={i} className="kp-text">{x.label}</span>;
            return <Key key={x.id} k={x} n={lit.get(x.id)} on={info === x.id} onPress={onPress} />;
          })}
        </div>
      ))}
    </div>
  );
}

const ARROWS = { "arrow-up": 0, "arrow-upright": 45, "arrow-right": 90, "arrow-downright": 135, "arrow-down": 180, "arrow-downleft": 225, "arrow-left": 270, "arrow-upleft": 315 };
function Key({ k, n, on, onPress }) {
  const rot = ARROWS[k.shape];
  return (
    <button
      className={`kp-key ${k.tone}${k.shape === "mode" ? " mode" : ""}${n ? " lit" : ""}${on ? " info" : ""}`}
      style={k.w ? { "--w": k.w } : undefined}
      onClick={() => onPress(k.id)}
      aria-label={(k.label || k.id).replace(/\n/g, " ")}
      data-key={k.id}
    >
      {k.shift && <i className="kp-shift">{k.shift}</i>}
      {rot != null && (
        <svg viewBox="0 0 24 24" className="kp-arrowicon" style={{ transform: `rotate(${rot}deg)` }} aria-hidden="true"><path d="M12 3 L20 13 H15 V21 H9 V13 H4 Z" /></svg>
      )}
      {k.label && <span>{k.label}</span>}
      {n ? <><b className="kp-badge">{n}</b><span className="kp-point" aria-hidden="true">▼</span></> : null}
    </button>
  );
}

function Big({ id, label, cls, lit, onPress }) {
  const n = lit.get(id);
  return (
    <div className={`kp-big ${cls}${n ? " lit" : ""}`}>
      <span className="kp-biglab">{label}</span>
      <button onClick={() => onPress(id)} aria-label={label} data-key={id}>
        {n ? <><b className="kp-badge">{n}</b><span className="kp-point" aria-hidden="true">▼</span></> : null}
      </button>
    </div>
  );
}

// The panel is drawn at its real proportions and scaled to fit. On a phone
// that would make the keys too small to read, so it stays readable instead
// (never below MIN of its size), slides sideways in its own box, and brings
// the step's first key into view by itself.
const WIDTH = 1240;
const MIN = 0.56;
function Scaled({ children, focus = "", at = "" }) {
  const outer = useRef(null);
  const inner = useRef(null);
  const [s, setS] = useState(1);
  const [h, setH] = useState(0);
  useLayoutEffect(() => {
    const fit = () => {
      if (!outer.current || !inner.current) return;
      const scale = Math.max(MIN, Math.min(1, outer.current.clientWidth / WIDTH));
      setS(scale);
      setH(inner.current.offsetHeight * scale);
    };
    fit();
    const ro = typeof ResizeObserver === "function" ? new ResizeObserver(fit) : null;
    ro?.observe(outer.current);
    return () => ro?.disconnect();
  }, []);
  // bring the key to press into view when the panel is wider than its box
  useEffect(() => {
    const box = outer.current;
    if (!box || !focus || box.scrollWidth <= box.clientWidth + 1) return;
    const el = inner.current?.querySelector(`[data-key="${CSS?.escape ? CSS.escape(focus) : focus}"]`);
    if (!el) return;
    const left = (el.getBoundingClientRect().left - inner.current.getBoundingClientRect().left) + el.offsetWidth * s / 2;
    box.scrollTo?.({ left: Math.max(0, left - box.clientWidth / 2), behavior: "smooth" });
  }, [focus, at, s]);
  const sideways = s * WIDTH > (outer.current?.clientWidth || Infinity) + 1;
  return (
    <div className={`kp-scale${sideways ? " slide" : ""}`} ref={outer} style={{ height: h ? h + (sideways ? 12 : 0) : undefined }}>
      <div style={{ width: WIDTH * s, height: h || undefined }}>
        <div ref={inner} style={{ width: WIDTH, transform: `scale(${s})`, transformOrigin: "top left" }}>{children}</div>
      </div>
    </div>
  );
}

export { allKeys, BIG };
