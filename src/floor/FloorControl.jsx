import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, GripVertical, ExternalLink, Flame, ChevronsUp, StickyNote, BookOpen } from "lucide-react";
import Sortable from "sortablejs";
import { db } from "../lib/db.js";
import CncLibrary from "./CncLibrary.jsx";
import "./floorControl.css";

// The four departments in the dark floor world. Colors match the wall monitors
// so the office associates a column with its screen.
const DEPTS = [
  { key: "shop", label: "Shop", db: "Shop", accent: "#4EA3FF" },
  { key: "cnc", label: "CNC", db: "CNC", accent: "#FFB224" },
  { key: "sewing", label: "Sewing", db: "Sewing", accent: "#F472B6" },
  { key: "saw", label: "Saw", db: "Saw", accent: "#7DD35B" },
];

// CNC splits into three machines. Each has its own drag-ordered queue and its
// own tint (warm, so the CNC identity holds) so the lanes read as distinct.
const MACHINES = [
  { key: "vf4", short: "VF-4", label: "Haas VF-4", color: "#FFB224" },
  { key: "st10", short: "ST-10", label: "Haas ST-10", color: "#FF8A5C" },
  { key: "ds30ssy", short: "DS-30SSY", label: "Haas DS-30SSY", color: "#F5CE3A" },
];

// Arrangement keys we load up front (dept queues + the three CNC machines).
const ARR_KEYS = [...DEPTS.map((d) => d.key), ...MACHINES.map((m) => `cnc_${m.key}`)];

// Arranged items first (in dragged order), then anything new falls in behind,
// rush-first, then oldest.
function applyOrder(items, arrangement) {
  const rank = new Map(arrangement.map((id, i) => [id, i]));
  return items.slice().sort((a, b) => {
    const ai = rank.has(a.id) ? rank.get(a.id) : Infinity;
    const bi = rank.has(b.id) ? rank.get(b.id) : Infinity;
    if (ai !== bi) return ai - bi;
    return Number(b.rush) - Number(a.rush) || a.receivedAt - b.receivedAt;
  });
}

function byRush(items) {
  return items.slice().sort((a, b) => Number(b.rush) - Number(a.rush) || a.receivedAt - b.receivedAt);
}

function collect(orders, dbDept) {
  const out = [];
  orders.forEach((o) =>
    o.items.forEach((it) => {
      if (it.stage === "workorder" && it.dept === dbDept) {
        out.push({
          id: it.id,
          name: it.name,
          qty: it.qty,
          color: it.color,
          inProgress: it.inProgress,
          orderNo: o.orderNo,
          rush: o.priority === "RUSH",
          receivedAt: o.receivedAt,
          image: it.imageUrl || null,
        });
      }
    })
  );
  return out;
}

function initials(name = "") {
  const w = name.replace(/[^A-Za-z0-9 ]/g, " ").trim().split(/\s+/);
  return (w[0]?.[0] || "?").toUpperCase() + (w[1]?.[0] || "").toUpperCase();
}

export default function FloorControl({ orders, onClose, cncOnly = false, onSignOut }) {
  const navDepts = cncOnly ? DEPTS.filter((d) => d.key === "cnc") : DEPTS;
  const [active, setActive] = useState("cnc");
  const [cncView, setCncView] = useState("unassigned"); // "unassigned" | machine key
  const [order, setOrder] = useState({}); // queueKey -> [ids]
  const [machines, setMachines] = useState({}); // itemId -> machine key
  const [notes, setNotes] = useState({});
  const [editingId, setEditingId] = useState(null);
  const [noteDraft, setNoteDraft] = useState("");
  const isBook = active === "book";
  const dept = DEPTS.find((d) => d.key === active) || DEPTS[1]; // fallback CNC (amber) for the Book tab

  useEffect(() => {
    db.getFloorNotes().then(setNotes);
    db.getCncMachines().then(setMachines);
  }, []);

  useEffect(() => {
    let alive = true;
    Promise.all(ARR_KEYS.map((k) => db.getArrangement(`floor_${k}`))).then((res) => {
      if (!alive) return;
      const o = {};
      ARR_KEYS.forEach((k, i) => (o[k] = res[i] || []));
      setOrder(o);
    });
    return () => {
      alive = false;
    };
  }, []);

  function startEditNote(id) {
    setNoteDraft(notes[id] || "");
    setEditingId(id);
  }
  async function saveNote(id) {
    const t = noteDraft;
    setNotes((m) => {
      const n = { ...m };
      if (t.trim()) n[id] = t.trim();
      else delete n[id];
      return n;
    });
    setEditingId(null);
    await db.setFloorNote(id, t);
  }

  async function assignMachine(id, machine) {
    setMachines((m) => {
      const n = { ...m };
      if (machine) n[id] = machine;
      else delete n[id];
      return n;
    });
    await db.setCncMachine(id, machine);
  }

  // ---- work out what this view is showing ----
  const isCnc = active === "cnc";
  const cncItems = isCnc ? collect(orders, "CNC") : [];
  const unassigned = cncItems.filter((it) => !machines[it.id]);
  const byMachine = {};
  MACHINES.forEach((m) => (byMachine[m.key] = cncItems.filter((it) => machines[it.id] === m.key)));

  let baseItems, queueKey, canOrder, viewLabel;
  if (isCnc) {
    if (cncView === "unassigned") {
      baseItems = unassigned;
      queueKey = null;
      canOrder = false;
      viewLabel = "Unassigned";
    } else {
      baseItems = byMachine[cncView] || [];
      queueKey = `cnc_${cncView}`;
      canOrder = true;
      viewLabel = MACHINES.find((m) => m.key === cncView)?.short || cncView;
    }
  } else {
    baseItems = collect(orders, dept.db);
    queueKey = active;
    canOrder = true;
    viewLabel = dept.label;
  }

  const items = canOrder ? applyOrder(baseItems, order[queueKey] || []) : byRush(baseItems);
  const ids = items.map((i) => i.id);
  const qtyUnit = active === "saw" ? "cuts" : "pcs";
  // Per-lane tint: each CNC machine gets its own accent for the queue area; the
  // department (amber) identity stays on the header/logo.
  const laneColor = isCnc && cncView !== "unassigned" ? MACHINES.find((m) => m.key === cncView)?.color || dept.accent : dept.accent;

  const deptCount = (d) => collect(orders, d.db).length;

  function persist(key, nextIds) {
    if (!key) return;
    setOrder((p) => ({ ...p, [key]: nextIds }));
    db.setArrangement(nextIds, `floor_${key}`);
  }
  function moveToTop(id) {
    if (!queueKey) return;
    persist(queueKey, [id, ...ids.filter((x) => x !== id)]);
  }

  // Refs so the single Sortable instance reads fresh values without re-init.
  const idsRef = useRef(ids);
  idsRef.current = ids;
  const queueKeyRef = useRef(queueKey);
  queueKeyRef.current = queueKey;
  const persistRef = useRef(persist);
  persistRef.current = persist;
  const sortableRef = useRef(null);

  // Attach/detach Sortable as the list mounts/unmounts (e.g. switching to the
  // CNC Book tab removes the list entirely, then it comes back). Options read
  // live values via refs, so this callback stays stable.
  const attachList = useCallback((el) => {
    if (sortableRef.current) {
      sortableRef.current.destroy();
      sortableRef.current = null;
    }
    if (!el) return;
    sortableRef.current = Sortable.create(el, {
      animation: 170,
      easing: "cubic-bezier(0.22, 1, 0.36, 1)",
      filter: ".fc-totop, .fc-notebtn, .fc-noteedit, .fc-noteinput, .fc-notesave, .fc-notecancel, .fc-assign, .fc-mchip",
      preventOnFilter: false,
      ghostClass: "fc-ghost",
      chosenClass: "fc-chosen",
      dragClass: "fc-dragging",
      onEnd: (evt) => {
        const key = queueKeyRef.current;
        const { oldIndex, newIndex, item, from } = evt;
        if (!key || oldIndex == null || newIndex == null || oldIndex === newIndex) return;
        from.removeChild(item);
        from.insertBefore(item, from.children[oldIndex] || null);
        const next = idsRef.current.slice();
        next.splice(newIndex, 0, next.splice(oldIndex, 1)[0]);
        persistRef.current(key, next);
      },
    });
  }, []);

  // Ordering only makes sense in a real queue (not the Unassigned staging list).
  useEffect(() => {
    sortableRef.current?.option("disabled", !queueKey);
  }, [queueKey]);

  const headHint = isCnc
    ? cncView === "unassigned"
      ? "Assign each order to a machine — it moves into that machine's queue."
      : `Drag to set the order — the top card runs first on the ${viewLabel}.`
    : `Drag to set the order — the top card is what shows big on the ${dept.label} monitor.`;

  const emptyMsg = isCnc
    ? cncView === "unassigned"
      ? "No unassigned CNC orders — everything's on a machine."
      : `Nothing assigned to ${viewLabel} yet — assign orders from Unassigned.`
    : `Items appear here once they're routed to ${dept.label} in the Work stage.`;

  return (
    <div className="fc-overlay" style={{ "--accent": dept.accent, "--lane": laneColor }}>
      <div className="fc-wrap">
        <header className="fc-top">
          <div className="fc-brand">
            <div className="fc-logo" role="img" aria-label="Modern Studio Equipment" />
            <span className="fc-brandtag">FLOOR&nbsp;CONTROL</span>
          </div>
          <nav className="fc-tabs" style={{ marginLeft: 8 }}>
            {navDepts.map((d) => (
              <button
                key={d.key}
                className={`fc-tab${d.key === active ? " on" : ""}`}
                style={{ "--c": d.accent }}
                onClick={() => setActive(d.key)}
              >
                <i className="dot" />
                <b>{d.label}</b>
                <span className="ct">{deptCount(d)}</span>
              </button>
            ))}
            {(active === "cnc" || isBook) && (
              <button className={`fc-booktab${isBook ? " on" : ""}`} onClick={() => setActive("book")}>
                <BookOpen size={15} /> CNC Catalog
              </button>
            )}
          </nav>
          <div className="fc-spacer" />
          {!isBook && (
            <a className="fc-open" style={{ "--accent": dept.accent }} href={`#floor/${active}`} target="_blank" rel="noopener noreferrer">
              <ExternalLink size={15} /> Open live monitor
            </a>
          )}
          {cncOnly ? (
            <button className="fc-back" onClick={onSignOut}>
              <ArrowLeft size={16} /> Sign out
            </button>
          ) : (
            <button className="fc-back" onClick={onClose}>
              <ArrowLeft size={16} /> Back to office
            </button>
          )}
        </header>

        {isBook ? (
          <CncLibrary embedded />
        ) : (
        <>
        <div className="fc-head">
          <h1>
            <em>{isCnc ? "CNC" : dept.label}</em>
            {isCnc ? ` · ${viewLabel}` : " queue"}
          </h1>
          <span className="fc-hint">{headHint}</span>
        </div>

        {isCnc && (
          <div className="fc-subnav">
            <button className={`fc-subtab${cncView === "unassigned" ? " on" : ""}`} style={{ "--seg": dept.accent }} onClick={() => setCncView("unassigned")}>
              <span className="lbl">Unassigned</span>
              <span className="n">{unassigned.length}</span>
            </button>
            <span className="fc-subdiv" />
            {MACHINES.map((m) => (
              <button key={m.key} className={`fc-subtab${cncView === m.key ? " on" : ""}`} style={{ "--seg": m.color }} onClick={() => setCncView(m.key)}>
                <i className="mdot" />
                <span className="lbl">{m.short}</span>
                <span className="n">{byMachine[m.key].length}</span>
              </button>
            ))}
          </div>
        )}

        <div className="fc-list" ref={attachList}>
          {items.map((it, idx) => (
            <div key={it.id} className={`fc-row${idx === 0 && canOrder ? " now" : ""}`} data-id={it.id}>
              <div className="fc-rowmain">
                <span className="fc-grip">
                  <GripVertical size={18} />
                </span>
                <span className="fc-rank">{idx + 1}</span>
                <span className="fc-thumb">
                  {it.image ? <img src={it.image} alt="" /> : <span className="mono">{initials(it.name)}</span>}
                </span>
                <span className="fc-meta">
                  <span className="no">WO&nbsp;#{it.orderNo}</span>
                  <span className="nm">{it.name}</span>
                  {it.color && <span className="mt">{it.color}</span>}
                  {notes[it.id] && editingId !== it.id && <span className="fc-jobnote-row">Note: {notes[it.id]}</span>}
                  {idx === 0 && canOrder && <span className="fc-nowtag">On the monitor now</span>}
                </span>
                <span className="fc-right">
                  <button className="fc-notebtn" title={notes[it.id] ? "Edit note" : "Add note"} onClick={() => startEditNote(it.id)}>
                    <StickyNote size={16} />
                  </button>
                  {canOrder && idx > 0 && (
                    <button className="fc-totop" title="Make this next up" onClick={() => moveToTop(it.id)}>
                      <ChevronsUp size={16} />
                    </button>
                  )}
                  {it.inProgress && <span className="fc-chip prog">On floor</span>}
                  {it.rush && (
                    <span className="fc-chip rush">
                      <Flame size={11} style={{ verticalAlign: -1, marginRight: 3 }} />
                      Rush
                    </span>
                  )}
                  <span className="fc-qty">
                    <span className="q">{it.qty}</span>
                    <span className="ql">{qtyUnit}</span>
                  </span>
                </span>
              </div>

              {isCnc && (
                <div className="fc-assign">
                  <span className="fc-assign-lab">Machine</span>
                  {MACHINES.map((m) => (
                    <button
                      key={m.key}
                      className={`fc-mchip${machines[it.id] === m.key ? " on" : ""}`}
                      style={{ "--mc": m.color }}
                      title={machines[it.id] === m.key ? `Remove from ${m.label}` : `Assign to ${m.label}`}
                      onClick={() => assignMachine(it.id, machines[it.id] === m.key ? null : m.key)}
                    >
                      {m.short}
                    </button>
                  ))}
                </div>
              )}

              {editingId === it.id && (
                <div className="fc-noteedit">
                  <input
                    className="fc-noteinput"
                    autoFocus
                    value={noteDraft}
                    placeholder="Note for the floor — shows on the monitor next to the photo"
                    onChange={(e) => setNoteDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") saveNote(it.id);
                      if (e.key === "Escape") setEditingId(null);
                    }}
                  />
                  <button className="fc-notesave" onClick={() => saveNote(it.id)}>
                    Save
                  </button>
                  <button className="fc-notecancel" onClick={() => setEditingId(null)}>
                    Cancel
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>

        {items.length === 0 && (
          <div className="fc-empty">
            <div className="big">{isCnc ? (cncView === "unassigned" ? "Nothing to assign" : `${viewLabel} queue is empty`) : `Nothing in the ${dept.label} queue`}</div>
            <div>{emptyMsg}</div>
          </div>
        )}

        {canOrder && items.length > 0 && (
          <div className="fc-savebar">
            <span>Order saves automatically and updates the {viewLabel} monitor within seconds.</span>
            {(order[queueKey] || []).length > 0 && (
              <button className="reset" onClick={() => persist(queueKey, [])}>
                Reset to rush-first
              </button>
            )}
          </div>
        )}
        </>
        )}
      </div>
    </div>
  );
}
