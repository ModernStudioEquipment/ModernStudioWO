import React, { useState } from "react";
import { Plus, Phone, Mail, Check, RotateCcw, Trash2, Wrench, FileText, Clock } from "lucide-react";
import { C } from "../../theme.js";
import { Btn, Empty, Tabwrap, Pill } from "../ui.jsx";
import { clientName, filledLines, itemCount, isLate, searchText, statusLabel } from "./repairTicket.js";

// The Repairs tab: every repair ticket written at will call, so the office can
// see what's in the building for repair, whose it is, and when it's due back.
// Each card opens the ticket itself (the paper form, filled in).
export function RepairsTab({ rp, now, onOpen }) {
  const [view, setView] = useState("open"); // "open" (in shop + ready) | "done"
  const [q, setQ] = useState("");
  const [confirmDel, setConfirmDel] = useState(null);

  if (rp.missing) {
    return (
      <Tabwrap title="Repairs">
        <Empty>Repairs needs its database table first: run migration 0067 in Supabase, then refresh.</Empty>
      </Tabwrap>
    );
  }

  const open = rp.repairs.filter((r) => r.status !== "done");
  const done = rp.repairs.filter((r) => r.status === "done");
  const list = (view === "done" ? done : open)
    .filter((r) => !q.trim() || searchText(r).includes(q.trim().toLowerCase()))
    // Late ones first, then ready for pickup, then newest.
    .sort((a, b) => (isLate(b, now) - isLate(a, now)) || ((b.status === "ready") - (a.status === "ready")) || (b.createdAt - a.createdAt));

  const seg = (k, label, n) => (
    <button
      key={k}
      onClick={() => setView(k)}
      className="px-3 py-1.5 rounded text-xs font-bold uppercase tracking-wide"
      style={view === k ? { background: C.fill, color: "#fff" } : { background: C.surface, color: C.inkSoft, border: `1px solid ${C.line}` }}
    >
      {label} · {n}
    </button>
  );

  return (
    <Tabwrap
      title="Repairs"
      action={<Btn kind="dark" onClick={() => onOpen(null)}><Plus size={13} />New repair ticket</Btn>}
    >
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        {seg("open", "In the building", open.length)}
        {seg("done", "Picked up", done.length)}
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search name, phone, item…"
          aria-label="Search repairs"
          className="ml-auto px-3 py-1.5 rounded"
          style={{ background: C.surface, color: C.ink, border: `1px solid ${C.line}`, fontSize: 13, minWidth: 0, flex: "0 1 260px" }}
        />
      </div>

      {rp.error && <Empty>Couldn't load repairs: {rp.error}</Empty>}
      {!rp.error && rp.loaded && !list.length && (
        <Empty>
          {q.trim()
            ? "No repairs match that."
            : view === "done"
            ? "Nothing picked up yet."
            : "No repairs in the building. When a client drops something off, start a ticket with New repair ticket."}
        </Empty>
      )}

      {list.map((r) => {
        const f = r.fields || {};
        const lines = filledLines(f);
        const late = isLate(r, now);
        const n = itemCount(f);
        const edge = r.status === "ready" ? C.green : late ? C.rush : C.blue;
        return (
          <div key={r.id} className="rounded mb-3 card-pop" style={{ background: C.surface, border: `1px solid ${C.line}`, borderLeft: `4px solid ${edge}` }}>
            <div className="flex flex-wrap items-start gap-x-4 gap-y-2 px-4 py-3">
              <button onClick={() => onOpen(r)} className="min-w-0 text-left" style={{ background: "none", border: "none", padding: 0, cursor: "pointer", color: "inherit", flex: "1 1 260px" }}>
                <div className="flex items-center gap-2 flex-wrap">
                  <Wrench size={15} style={{ color: C.inkSoft }} />
                  <span className="font-bold" style={{ fontSize: 15 }}>{clientName(f)}</span>
                  {f.orderNo && <span style={{ fontFamily: "ui-monospace,monospace", fontSize: 12, color: C.inkSoft }}>#{f.orderNo}</span>}
                </div>
                {f.company && f.contact && <div style={{ fontSize: 13, color: C.inkSoft }}>{f.contact}</div>}
                <div style={{ fontSize: 12.5, color: C.gray, marginTop: 2 }}>
                  {n ? `${n} item${n === 1 ? "" : "s"}` : "No items listed yet"}
                  {lines.length ? `: ${lines.slice(0, 3).map((l) => l.description || l.notes).filter(Boolean).join(", ")}${lines.length > 3 ? ", …" : ""}` : ""}
                </div>
              </button>

              <div className="flex flex-col gap-1" style={{ fontSize: 12.5, color: C.inkSoft, minWidth: 150 }}>
                {f.phone && <a href={`tel:${f.phone.replace(/[^\d+]/g, "")}`} className="inline-flex items-center gap-1.5" style={{ color: C.inkSoft }}><Phone size={12} />{f.phone}</a>}
                {f.email && <a href={`mailto:${f.email}`} className="inline-flex items-center gap-1.5" style={{ color: C.inkSoft, overflowWrap: "anywhere" }}><Mail size={12} />{f.email}</a>}
              </div>

              <div className="flex flex-col gap-1 items-start" style={{ fontSize: 12.5, color: C.inkSoft, minWidth: 150 }}>
                {f.dateReceived && <span>In {f.dateReceived}{f.receivedBy ? ` · ${f.receivedBy}` : ""}</span>}
                {f.completionDate && (
                  late
                    ? <Pill c={C.rush} bg={C.rushBg} Icon={Clock}>Late · due {f.completionDate}</Pill>
                    : <span>Due back {f.completionDate}</span>
                )}
                {f.quote === "yes" && <Pill c={C.high} bg={C.highBg}>Quote first</Pill>}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 px-4 py-2" style={{ borderTop: `1px solid ${C.line}`, background: C.concrete }}>
              <span className="font-bold uppercase" style={{ fontSize: 11, letterSpacing: 0.5, color: r.status === "ready" ? C.green : C.inkSoft }}>
                {statusLabel(r.status)}
              </span>
              <span className="flex-1" />
              <Btn onClick={() => onOpen(r)}><FileText size={13} />Ticket</Btn>
              {r.status === "open" && <Btn kind="green" onClick={() => rp.updateRepair(r.id, { status: "ready" })}><Check size={13} />Ready for pickup</Btn>}
              {r.status === "ready" && (
                <>
                  <Btn onClick={() => rp.updateRepair(r.id, { status: "open" })}><RotateCcw size={13} />Back to shop</Btn>
                  <Btn kind="dark" onClick={() => rp.updateRepair(r.id, { status: "done" })}><Check size={13} />Picked up</Btn>
                </>
              )}
              {r.status === "done" && <Btn onClick={() => rp.updateRepair(r.id, { status: "open" })}><RotateCcw size={13} />Reopen</Btn>}
              {confirmDel === r.id ? (
                <>
                  <Btn kind="amber" onClick={async () => { setConfirmDel(null); await rp.deleteRepair(r.id); }}>Delete it</Btn>
                  <Btn onClick={() => setConfirmDel(null)}>Keep</Btn>
                </>
              ) : (
                <button onClick={() => setConfirmDel(r.id)} title="Delete this ticket" aria-label="Delete this ticket" style={{ color: C.gray, background: "none", border: "none", cursor: "pointer", padding: 4, display: "inline-flex" }}>
                  <Trash2 size={15} />
                </button>
              )}
            </div>
          </div>
        );
      })}
    </Tabwrap>
  );
}
