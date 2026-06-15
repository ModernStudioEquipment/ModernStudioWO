import React, { useState, useRef, useEffect } from "react";
import { Clock, Wrench, Scissors, Cpu, Hammer, Flag, Check, ChevronDown, Bell } from "lucide-react";
import { C, PRI, PRIORITIES, DEPTS, elapsed } from "../theme.js";

const DEPT_ICONS = { Shop: Hammer, CNC: Cpu, Sewing: Scissors, Saw: Wrench };
export const DeptIcon = ({ d, size = 12 }) => {
  const I = DEPT_ICONS[d] || Wrench;
  return <I size={size} />;
};

// Small inline dropdown — click the trigger, pick from `options`.
export function InlineMenu({ children, options, onSelect, align = "left" }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);
  return (
    <span ref={ref} style={{ position: "relative", display: "inline-flex" }} onClick={(e) => e.stopPropagation()}>
      <span onClick={() => setOpen((v) => !v)}>{children}</span>
      {open && (
        <div style={{ position: "absolute", top: "100%", [align]: 0, marginTop: 4, zIndex: 90, background: "#fff", border: `1px solid ${C.line}`, borderRadius: 6, boxShadow: "0 6px 22px rgba(0,0,0,0.13)", minWidth: 132, overflow: "hidden" }}>
          {options.map((opt) => (
            <button
              key={opt.value}
              onClick={() => { onSelect(opt.value); setOpen(false); }}
              className="flex items-center gap-2 w-full"
              style={{ padding: "7px 11px", fontSize: 13, fontWeight: 600, textAlign: "left", background: "#fff", border: "none", cursor: "pointer", whiteSpace: "nowrap", color: C.ink }}
              onMouseEnter={(e) => (e.currentTarget.style.background = C.concrete)}
              onMouseLeave={(e) => (e.currentTarget.style.background = "#fff")}
            >
              {opt.icon}{opt.label}
            </button>
          ))}
        </div>
      )}
    </span>
  );
}

export function Pill({ children, c, bg, Icon }) {
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-bold uppercase tracking-wide"
      style={{ color: c, background: bg }}
    >
      {Icon && <Icon size={12} />}
      {children}
    </span>
  );
}

export function Btn({ children, onClick, kind = "ghost", disabled, type = "button" }) {
  const styles = {
    ghost: { background: "#fff", color: C.inkSoft, border: `1px solid ${C.line}` },
    dark: { background: C.ink, color: "#fff" },
    brass: { background: C.ink, color: "#fff" },
    green: { background: C.greenBg, color: C.green, border: `1px solid ${C.green}` },
    gold: { background: C.goldBg, color: C.gold, border: `1px solid ${C.gold}` },
    amber: { background: C.highBg, color: C.high, border: `1px solid ${C.high}` },
  }[kind];
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded text-xs font-bold uppercase tracking-wide"
      style={{ ...styles, opacity: disabled ? 0.5 : 1, cursor: disabled ? "not-allowed" : "pointer" }}
    >
      {children}
    </button>
  );
}

export function DeptBadge({ d, onChange }) {
  const badge = (
    <span
      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-bold"
      style={{ background: C.grayBg, color: C.inkSoft, cursor: onChange ? "pointer" : "default" }}
    >
      <DeptIcon d={d} />
      {d}
      {onChange && <ChevronDown size={11} style={{ opacity: 0.55 }} />}
    </span>
  );
  if (!onChange) return badge;
  return (
    <InlineMenu options={DEPTS.map((x) => ({ value: x, label: x, icon: <DeptIcon d={x} /> }))} onSelect={onChange}>
      {badge}
    </InlineMenu>
  );
}

// Priority pill — static, or a dropdown (Standard / High / Urgent) when onChange
// is set. Stored values are Normal/High/RUSH; the shown text is PRI[x].label.
export function PriorityPill({ priority, onChange }) {
  const p = PRI[priority] || PRI.Normal;
  const pill = (
    <span
      className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-bold uppercase tracking-wide"
      style={{ color: p.c, background: p.bg, cursor: onChange ? "pointer" : "default" }}
    >
      <Flag size={12} />
      {p.label}
      {onChange && <ChevronDown size={11} style={{ opacity: 0.6 }} />}
    </span>
  );
  if (!onChange) return pill;
  return (
    <InlineMenu align="right" options={PRIORITIES.map((x) => ({ value: x, label: PRI[x].label }))} onSelect={onChange}>
      {pill}
    </InlineMenu>
  );
}

const MOVE_TARGETS = [
  { stage: "new", label: "New Orders" },
  { stage: "picklist", label: "Pick List" },
  { stage: "workorder", label: "Work Order" },
  { stage: "awaiting", label: "Purchasing" },
  { stage: "done", label: "Done" },
];
// "Move to ▾" — re-route an item to a different stage/tab (excludes its current one).
export function MoveMenu({ stage, onMove }) {
  const options = MOVE_TARGETS.filter((t) => t.stage !== stage).map((t) => ({ value: t.stage, label: t.label }));
  return (
    <InlineMenu align="right" options={options} onSelect={onMove}>
      <span
        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded font-bold uppercase tracking-wide"
        style={{ fontSize: 12, background: "#fff", color: C.inkSoft, border: `1px solid ${C.line}`, cursor: "pointer", whiteSpace: "nowrap" }}
      >
        Move to<ChevronDown size={12} style={{ opacity: 0.6 }} />
      </span>
    </InlineMenu>
  );
}

export function OrderHeader({ o, now, onPriority }) {
  return (
    <div
      className="flex items-center gap-3 px-4 py-3"
      style={{ borderBottom: `1px solid ${C.line}`, background: "#fff", borderTopLeftRadius: 6, borderTopRightRadius: 6 }}
    >
      <span className="font-bold" style={{ fontFamily: "ui-monospace,monospace", fontSize: 16 }}>
        #{o.orderNo}
      </span>
      <div>
        <div className="font-bold" style={{ fontSize: 14 }}>{o.customer}</div>
        <div style={{ fontSize: 12, color: C.gray }}>Ordered by {o.contact}</div>
      </div>
      <span className="ml-auto flex items-center gap-2">
        <Pill c={C.inkSoft} bg={C.grayBg} Icon={Clock}>{elapsed(now - o.receivedAt)} ago</Pill>
        <PriorityPill priority={o.priority} onChange={onPriority ? (p) => onPriority(o.id, p) : undefined} />
      </span>
    </div>
  );
}

export function Group({ o, now, children, onPriority }) {
  const p = PRI[o.priority] || PRI.Normal;
  return (
    <div id={`order-${o.id}`} className="rounded mb-3" style={{ background: "#fff", border: `1px solid ${C.line}`, borderLeft: `4px solid ${p.c}` }}>
      <OrderHeader o={o} now={now} onPriority={onPriority} />
      {children}
    </div>
  );
}

export function ItemLine({ it, right, onOpen, flash, onDept }) {
  return (
    <div
      ref={flash ? (el) => el && el.scrollIntoView({ behavior: "smooth", block: "center" }) : undefined}
      onClick={onOpen}
      className="flex items-center gap-3 px-4 py-3"
      style={{
        borderBottom: `1px solid ${C.line}`,
        cursor: onOpen ? "pointer" : "default",
        animation: flash ? "flashRow 0.85s ease-in-out 5" : undefined,
        boxShadow: flash ? `inset 4px 0 0 ${C.high}` : undefined,
      }}
    >
      <DeptBadge d={it.dept} onChange={onDept} />
      <span className="font-bold" style={{ fontSize: 14 }}>{it.name}</span>
      {it.note && (
        <Bell size={15} color={C.high} fill={C.high} title={`Note: ${it.note}`} style={{ flexShrink: 0 }} />
      )}
      <span style={{ fontFamily: "ui-monospace,monospace", color: C.inkSoft }}>×{it.qty}</span>
      <span className="ml-auto" onClick={(e) => e.stopPropagation()}>{right}</span>
    </div>
  );
}

export function Empty({ children }) {
  return (
    <div className="rounded px-4 py-10 text-center" style={{ background: "#fff", border: `1px solid ${C.line}`, color: C.gray, fontSize: 14 }}>
      {children}
    </div>
  );
}

export function Tabwrap({ title, sub, action, children }) {
  return (
    <div>
      <div className="mb-3 flex items-start gap-3">
        <div>
          <div className="font-bold" style={{ fontSize: 16 }}>{title}</div>
          {sub && <div style={{ fontSize: 13, color: C.gray }}>{sub}</div>}
        </div>
        {action && <div className="ml-auto">{action}</div>}
      </div>
      {children}
    </div>
  );
}

export function Info({ label, value }) {
  return (
    <div>
      <div style={{ fontSize: 10, fontWeight: 700, color: C.gray, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 2 }}>
        {label}
      </div>
      <div className="font-bold" style={{ fontSize: 13 }}>{value}</div>
    </div>
  );
}

// Per-product progress tracker: Received -> Triaged -> In production -> Done
export function Stepper({ it }) {
  const labels = ["Received", "Triaged", "In production", "Done"];
  const doneCount = it.stage === "new" ? 1 : it.stage === "done" ? 4 : 2;
  const currentIdx = it.stage === "done" ? -1 : doneCount;
  return (
    <div className="flex items-start" style={{ marginTop: 10 }}>
      {labels.map((lab, i) => {
        const done = i < doneCount,
          cur = i === currentIdx;
        return (
          <React.Fragment key={i}>
            <div className="flex flex-col items-center" style={{ width: 78 }}>
              <div
                className="flex items-center justify-center"
                style={{
                  width: 22, height: 22, borderRadius: 11,
                  background: done ? C.ink : "#fff",
                  border: done ? "none" : `2px solid ${cur ? C.high : C.line}`,
                  color: "#fff",
                }}
              >
                {done ? <Check size={13} /> : cur ? <span style={{ width: 7, height: 7, borderRadius: 4, background: C.high }} /> : null}
              </div>
              <div style={{ fontSize: 10, marginTop: 5, textAlign: "center", lineHeight: 1.2, color: done || cur ? C.ink : C.gray, fontWeight: done || cur ? 700 : 400 }}>
                {lab}
              </div>
            </div>
            {i < labels.length - 1 && <div style={{ flex: 1, height: 2, marginTop: 10, background: i < doneCount ? C.ink : C.line }} />}
          </React.Fragment>
        );
      })}
    </div>
  );
}
