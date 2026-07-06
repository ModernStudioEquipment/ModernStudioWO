import { useEffect, useRef, useState } from "react";
import { ArrowLeft, GripVertical, ExternalLink, Flame, ChevronsUp } from "lucide-react";
import Sortable from "sortablejs";
import { db } from "../lib/db.js";
import CncLibrary from "./CncLibrary.jsx";
import { BookOpen } from "lucide-react";
import "./floorControl.css";

// The four departments in the dark floor world. Colors match the wall monitors
// so the office associates a column with its screen.
const DEPTS = [
  { key: "shop", label: "Shop", db: "Shop", accent: "#4EA3FF" },
  { key: "cnc", label: "CNC", db: "CNC", accent: "#FFB224" },
  { key: "sewing", label: "Sewing", db: "Sewing", accent: "#F472B6" },
  { key: "saw", label: "Saw", db: "Saw", accent: "#7DD35B" },
];

// Same ordering rule the monitor uses: arranged items first (in dragged order),
// then anything new falls in behind, rush-first, then oldest.
function applyOrder(items, arrangement) {
  const rank = new Map(arrangement.map((id, i) => [id, i]));
  return items.slice().sort((a, b) => {
    const ai = rank.has(a.id) ? rank.get(a.id) : Infinity;
    const bi = rank.has(b.id) ? rank.get(b.id) : Infinity;
    if (ai !== bi) return ai - bi;
    return Number(b.rush) - Number(a.rush) || a.receivedAt - b.receivedAt;
  });
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

export default function FloorControl({ orders, onClose }) {
  const [active, setActive] = useState("cnc");
  const [order, setOrder] = useState({}); // { deptKey: [ids] }
  const [libOpen, setLibOpen] = useState(false);
  const dept = DEPTS.find((d) => d.key === active);

  // Load every department's saved order once.
  useEffect(() => {
    let alive = true;
    Promise.all(DEPTS.map((d) => db.getArrangement(`floor_${d.key}`))).then((res) => {
      if (!alive) return;
      const o = {};
      DEPTS.forEach((d, i) => (o[d.key] = res[i] || []));
      setOrder(o);
    });
    return () => {
      alive = false;
    };
  }, []);

  const counts = {};
  DEPTS.forEach((d) => (counts[d.key] = collect(orders, d.db).length));

  const items = applyOrder(collect(orders, dept.db), order[active] || []);
  const ids = items.map((i) => i.id);

  function persist(deptKey, nextIds) {
    setOrder((p) => ({ ...p, [deptKey]: nextIds }));
    db.setArrangement(nextIds, `floor_${deptKey}`);
  }

  function moveToTop(id) {
    persist(active, [id, ...ids.filter((x) => x !== id)]);
  }

  // Keep the latest ids / active / persist reachable from the one Sortable
  // instance below without re-initializing it on every render.
  const idsRef = useRef(ids);
  idsRef.current = ids;
  const activeRef = useRef(active);
  activeRef.current = active;
  const persistRef = useRef(persist);
  persistRef.current = persist;
  const listRef = useRef(null);

  // Seamless drag: SortableJS animates the other cards sliding aside as you
  // drag. On drop we undo Sortable's DOM change (so React stays the source of
  // truth) and commit the new order to state + the database.
  useEffect(() => {
    if (!listRef.current) return;
    const s = Sortable.create(listRef.current, {
      animation: 170,
      easing: "cubic-bezier(0.22, 1, 0.36, 1)",
      filter: ".fc-totop",
      preventOnFilter: false,
      ghostClass: "fc-ghost",
      chosenClass: "fc-chosen",
      dragClass: "fc-dragging",
      onEnd: (evt) => {
        const { oldIndex, newIndex, item, from } = evt;
        if (oldIndex == null || newIndex == null || oldIndex === newIndex) return;
        from.removeChild(item);
        from.insertBefore(item, from.children[oldIndex] || null);
        const next = idsRef.current.slice();
        next.splice(newIndex, 0, next.splice(oldIndex, 1)[0]);
        persistRef.current(activeRef.current, next);
      },
    });
    return () => s.destroy();
  }, []);

  return (
    <div className="fc-overlay" style={{ "--accent": dept.accent }}>
      <div className="fc-wrap">
        <header className="fc-top">
          <div className="fc-brand">
            <b>MODERN</b>
            <span>FLOOR&nbsp;CONTROL</span>
          </div>
          <nav className="fc-tabs" style={{ marginLeft: 8 }}>
            {DEPTS.map((d) => (
              <button
                key={d.key}
                className={`fc-tab${d.key === active ? " on" : ""}`}
                style={{ "--c": d.accent }}
                onClick={() => setActive(d.key)}
              >
                <i className="dot" />
                <b>{d.label}</b>
                <span className="ct">{counts[d.key]}</span>
              </button>
            ))}
          </nav>
          <div className="fc-spacer" />
          {active === "cnc" && (
            <button className="fc-open" style={{ "--accent": dept.accent }} onClick={() => setLibOpen(true)}>
              <BookOpen size={15} /> CNC library
            </button>
          )}
          <a
            className="fc-open"
            style={{ "--accent": dept.accent }}
            href={`#floor/${active}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            <ExternalLink size={15} /> Open live monitor
          </a>
          <button className="fc-back" onClick={onClose}>
            <ArrowLeft size={16} /> Back to office
          </button>
        </header>

        <div className="fc-head">
          <h1>
            <em>{dept.label}</em> queue
          </h1>
          <span className="fc-hint">Drag to set the order — the top card is what shows big on the {dept.label} monitor.</span>
        </div>

        {items.length === 0 ? (
          <div className="fc-empty">
            <div className="big">Nothing in the {dept.label} queue</div>
            <div>Items appear here once they're routed to {dept.label} in the Work stage.</div>
          </div>
        ) : (
          <>
            <div className="fc-list" ref={listRef}>
              {items.map((it, idx) => (
                <div key={it.id} className={`fc-row${idx === 0 ? " now" : ""}`} data-id={it.id}>
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
                    {idx === 0 && <span className="fc-nowtag">On the monitor now</span>}
                  </span>
                  <span className="fc-right">
                    {idx > 0 && (
                      <button
                        className="fc-totop"
                        title="Make this next up"
                        onClick={() => moveToTop(it.id)}
                        onDragStart={(e) => e.preventDefault()}
                      >
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
                      <span className="ql">{active === "saw" ? "cuts" : "pcs"}</span>
                    </span>
                  </span>
                </div>
              ))}
            </div>
            <div className="fc-savebar">
              <span>Order saves automatically and updates the {dept.label} monitor within seconds.</span>
              {(order[active] || []).length > 0 && (
                <button className="reset" onClick={() => persist(active, [])}>
                  Reset to rush-first
                </button>
              )}
            </div>
          </>
        )}
      </div>
      {libOpen && <CncLibrary onClose={() => setLibOpen(false)} />}
    </div>
  );
}
