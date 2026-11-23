import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Printer } from "lucide-react";
import { C } from "../../theme.js";
import { Btn } from "../ui.jsx";
import { Wordmark } from "../Logo.jsx";
import { UnsavedPrompt } from "../UnsavedGuard.jsx";
import { REPAIR_ROWS, REPAIR_STATUSES, REPAIR_DEPTS, sheetFields, cleanForSave, emptyLine, isBlank } from "./repairTicket.js";
import "./repairTicket.css";

// The repair ticket, drawn as the paper form ("MODERN Repairs & Recovers") and
// filled in right on it: every blank, box and table cell is something you can
// click and type into. Save keeps it on the Repairs tab; Save & Print prints
// the same sheet, filled in. Printing reuses the work-order print path (#wo is
// the only thing on the page that prints), see repairTicket.css for the paper
// sizing.
export function RepairTicketDoc({ repair, onSave, onClose }) {
  const [id, setId] = useState(repair?.id || null);
  const [status, setStatus] = useState(repair?.status || "open");
  const [fields, setFields] = useState(() => sheetFields(repair?.fields));
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const [askClose, setAskClose] = useState(false);

  // Dirty = differs from what was last saved (or opened). Re-snapshotted on
  // every save, so closing a just-saved ticket doesn't ask about it.
  const snap = (f, s) => JSON.stringify({ f: cleanForSave(f), s });
  const [savedSnap, setSavedSnap] = useState(() => snap(sheetFields(repair?.fields), repair?.status || "open"));
  const dirty = snap(fields, status) !== savedSnap;

  const set = (k, v) => setFields((f) => ({ ...f, [k]: v }));
  const setCell = (i, k, v) =>
    setFields((f) => {
      const lines = f.lines.slice();
      lines[i] = { ...lines[i], [k]: v };
      // Typing on the last line opens another, so the table never runs out.
      if (i === lines.length - 1 && String(v).trim()) lines.push(emptyLine());
      return { ...f, lines };
    });

  const save = async (thenPrint) => {
    if (saving) return false;
    setErr("");
    const clean = cleanForSave(fields);
    if (!id && isBlank(clean)) {
      if (thenPrint) { window.print(); return true; } // a blank ticket can still be printed
      setErr("Nothing typed on the ticket yet.");
      return false;
    }
    setSaving(true);
    try {
      const newId = await onSave({ id, fields: clean, status });
      if (newId && !id) setId(newId);
      setSavedSnap(snap(fields, status));
      if (thenPrint) setTimeout(() => window.print(), 60);
      return true;
    } catch (e) {
      setErr(e?.message ? `Couldn't save: ${e.message}` : "Couldn't save.");
      return false;
    } finally {
      setSaving(false);
    }
  };

  const tryClose = () => (dirty ? setAskClose(true) : onClose());

  // Escape closes (asking first if there's unsaved typing).
  const closeRef = useRef(tryClose);
  closeRef.current = tryClose;
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape" && !askClose) closeRef.current(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [askClose]);

  // One page, like the pad: a description that wraps onto extra lines uses up
  // that many of the empty rows at the bottom of the printout.
  useEffect(() => {
    const before = () => fitToPage(document.getElementById("wo"));
    const after = () => unfit(document.getElementById("wo"));
    window.addEventListener("beforeprint", before);
    window.addEventListener("afterprint", after);
    return () => { window.removeEventListener("beforeprint", before); window.removeEventListener("afterprint", after); };
  }, []);

  return createPortal(
    <div className="print-doc-overlay" style={overlay} onClick={tryClose}>
      <div className="wo-sheetwrap" onClick={(e) => e.stopPropagation()} style={{ width: 760, maxWidth: "96vw" }}>
        <div className="wo-toolbar flex gap-2 mb-2 items-center no-print">
          <label className="flex items-center gap-2" style={{ fontSize: 12, color: "#fff" }}>
            <span style={{ fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5 }}>Status</span>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              style={{ background: C.surface, color: C.ink, border: `1px solid ${C.line}`, borderRadius: 6, padding: "5px 9px", fontWeight: 700 }}
            >
              {REPAIR_STATUSES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
          </label>
          <span className="flex-1" />
          <Btn kind="green" onClick={() => save(false)} disabled={saving}>{saving ? "Saving…" : "Save"}</Btn>
          <Btn kind="brass" onClick={() => save(true)} disabled={saving}><Printer size={15} />Save &amp; Print</Btn>
          <Btn onClick={tryClose}>Close</Btn>
        </div>
        {err && (
          <div className="no-print mb-2 rounded px-3 py-2" style={{ background: C.rushBg, color: C.rush, fontSize: 13, fontWeight: 700 }}>{err}</div>
        )}

        <div id="wo" className="rt-sheet">
          <TicketBody fields={fields} set={set} setCell={setCell} />
        </div>
      </div>
      {askClose && (
        <UnsavedPrompt
          what="repair ticket"
          saving={saving}
          onSave={async () => { if (await save(false)) { setAskClose(false); onClose(); } else setAskClose(false); }}
          onDiscard={() => { setAskClose(false); onClose(); }}
          onCancel={() => setAskClose(false)}
        />
      )}
    </div>,
    document.body,
  );
}

// ---- the paper form ----------------------------------------------------------

export function TicketBody({ fields, set, setCell }) {
  return (
    <>
      <div className="rt-top">
        <div className="rt-topleft">
          <Line label="Received By:" value={fields.receivedBy} onChange={(v) => set("receivedBy", v)} />
          <Line label="Date Received:" value={fields.dateReceived} onChange={(v) => set("dateReceived", v)} />
          <Line label="Completion Date:" value={fields.completionDate} onChange={(v) => set("completionDate", v)} />
          <div className="rt-est">(Estimated and Subject to Change)</div>
        </div>
        <div className="rt-logo">
          <Wordmark height={52} variant="dark" subText="REPAIRS & RECOVERS" subAlign="right" />
        </div>
        <div className="rt-orderno">
          <label className="rt-orderbox">
            <input className="rt-in rt-ordin" value={fields.orderNo} onChange={(e) => set("orderNo", e.target.value)} aria-label="Order number" />
          </label>
          <div className="rt-orderlab">ORDER NUMBER</div>
        </div>
      </div>

      <div className="rt-quote">
        <span>Quote Requested Prior to Beginning Work:</span>
        <Check label="Yes" on={fields.quote === "yes"} onClick={() => set("quote", fields.quote === "yes" ? "" : "yes")} />
        <Check label="No" on={fields.quote === "no"} onClick={() => set("quote", fields.quote === "no" ? "" : "no")} />
      </div>

      <Band>CLIENT INFORMATION</Band>
      <div className="rt-client">
        <Line label="Company" value={fields.company} onChange={(v) => set("company", v)} />
        <Line label="Address" value={fields.address} onChange={(v) => set("address", v)} />
        <div className="rt-two">
          <Line label="Contact:" value={fields.contact} onChange={(v) => set("contact", v)} />
          <Line label="Phone #:" value={fields.phone} onChange={(v) => set("phone", v)} type="tel" />
        </div>
        <Line label="Email:" value={fields.email} onChange={(v) => set("email", v)} type="email" />
      </div>

      <Band>SERVICES ORDERED</Band>
      <div className="rt-services">
        <span className="rt-svclab">Number of Items:</span>
        <Count label="1. Repairs" value={fields.repairs} onChange={(v) => set("repairs", v)} />
        <Count label="2. Recovers" value={fields.recovers} onChange={(v) => set("recovers", v)} />
        <Count label="3. Refurbish" value={fields.refurbish} onChange={(v) => set("refurbish", v)} />
        <Count label="4. Other" value={fields.other} onChange={(v) => set("other", v)} />
      </div>

      <Band>ITEMS TO BE SERVICED</Band>
      <table className="rt-table">
        <colgroup>
          <col style={{ width: "11%" }} />
          <col style={{ width: "6%" }} />
          <col style={{ width: "40%" }} />
          <col style={{ width: "43%" }} />
        </colgroup>
        <thead>
          <tr>
            <th>DEPT</th>
            <th>QTY</th>
            <th>DESCRIPTION</th>
            <th>NOTES</th>
          </tr>
        </thead>
        <tbody>
          {fields.lines.map((l, i) => (
            <tr key={i}>
              <td>
                <input className="rt-in rt-cell" list="rt-depts" value={l.dept} onChange={(e) => setCell(i, "dept", e.target.value)} aria-label={`Line ${i + 1} department`} />
              </td>
              <td>
                <input className="rt-in rt-cell rt-qty" value={l.qty} onChange={(e) => setCell(i, "qty", e.target.value)} inputMode="numeric" aria-label={`Line ${i + 1} quantity`} />
              </td>
              <td><Grow value={l.description} onChange={(v) => setCell(i, "description", v)} label={`Line ${i + 1} description`} /></td>
              <td><Grow value={l.notes} onChange={(v) => setCell(i, "notes", v)} label={`Line ${i + 1} notes`} /></td>
            </tr>
          ))}
        </tbody>
      </table>
      <datalist id="rt-depts">
        {REPAIR_DEPTS.map((d) => <option key={d} value={d} />)}
      </datalist>

      <div className="rt-foot">
        Modern Studio Equipment <span>|</span> 16200 Stagg St., Van Nuys, CA 91406 <span>|</span> (818) 764-8574 <span>|</span> www.modernstudio.com
      </div>
    </>
  );
}

// A label sitting on a ruled line, like the paper. The whole line is the click
// target: a <label> focuses its input wherever on it you press.
function Line({ label, value, onChange, type = "text" }) {
  return (
    <label className="rt-line">
      <span className="rt-lab">{label}</span>
      <input className="rt-in" type={type} value={value || ""} onChange={(e) => onChange(e.target.value)} aria-label={label.replace(/:$/, "")} />
    </label>
  );
}

// "____ 1. Repairs": the count goes in the blank before the label.
function Count({ label, value, onChange }) {
  return (
    <label className="rt-count">
      <input className="rt-in rt-blank" value={value || ""} onChange={(e) => onChange(e.target.value)} inputMode="numeric" aria-label={`${label.replace(/^\d\.\s*/, "")} count`} />
      <span>{label}</span>
    </label>
  );
}

function Check({ label, on, onClick }) {
  return (
    <button type="button" className="rt-check" onClick={onClick} aria-pressed={on}>
      <span className={`rt-box${on ? " on" : ""}`}>{on ? "✓" : ""}</span>
      {label}
    </button>
  );
}

function Band({ children }) {
  return <div className="rt-band">{children}</div>;
}

// A table cell that grows to fit what's written, so a long description isn't
// cut off on screen or on paper.
function Grow({ value, onChange, label }) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    // One line keeps the form's own row height (so print can size rows); only
    // text that wraps pins a taller height.
    el.style.height = wrapLines(el) > 1 ? `${el.scrollHeight}px` : "";
  }, [value]);
  return (
    <textarea
      ref={ref}
      rows={1}
      className="rt-in rt-cell rt-grow"
      value={value || ""}
      onChange={(e) => onChange(e.target.value)}
      aria-label={label}
    />
  );
}

// How many lines a cell's text takes up.
export function wrapLines(el) {
  const cs = getComputedStyle(el);
  const lh = parseFloat(cs.lineHeight) || 16;
  const pad = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
  return Math.max(1, Math.round((el.scrollHeight - pad) / lh));
}

// Before printing: count the extra lines wrapped text takes, plus one spare for
// the narrower paper, and leave that many empty rows off the bottom (and any
// empty row past the paper's 28). Filled rows are never hidden.
export function fitToPage(sheet, rows = REPAIR_ROWS) {
  if (!sheet) return 0;
  unfit(sheet);
  const trs = [...sheet.querySelectorAll(".rt-table tbody tr")];
  const blank = (tr) => [...tr.querySelectorAll("input,textarea")].every((el) => !el.value.trim());
  let used = 0;
  let wrapped = false;
  for (const tr of trs) {
    const n = Math.max(1, ...[...tr.querySelectorAll("textarea")].map(wrapLines));
    if (n > 1) wrapped = true;
    used += n;
  }
  let over = used - rows + (wrapped ? 1 : 0);
  let hidden = 0;
  for (let i = trs.length - 1; i >= 0 && over > 0 && blank(trs[i]); i--) {
    trs[i].classList.add("rt-spare");
    over -= 1;
    hidden += 1;
  }
  return hidden;
}
export function unfit(sheet) {
  sheet?.querySelectorAll(".rt-spare").forEach((tr) => tr.classList.remove("rt-spare"));
}

const overlay = {
  position: "fixed", inset: 0, background: "rgba(20,28,38,0.55)",
  display: "flex", alignItems: "flex-start", justifyContent: "center",
  overflowY: "auto", zIndex: 60, padding: "24px 12px",
};
