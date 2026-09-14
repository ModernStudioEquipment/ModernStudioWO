import React, { useState, useRef, useEffect } from "react";
import { Camera, Plus } from "lucide-react";
import { C, priLabel } from "../../theme.js";
import { Wordmark } from "../Logo.jsx";

// The four printable work-order sheet bodies, one per department. Shared by the
// QuickBooks sheet (CustomWorkOrderDoc) and the Shopify sheet (WorkOrderDoc) so
// both look identical per department. `numLabel` lets each caller label the
// number line — "WO #" for work orders, "Order #" for Shopify orders.

// ---- editable input styled to look like the sheet ----
export function EI({ value, onChange, size = 16, bold, mono, width, align = "left", placeholder, full }) {
  return (
    <input
      className="wo-edit"
      value={value || ""}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      style={{
        fontSize: size,
        fontWeight: bold ? 700 : 400,
        fontFamily: mono ? "ui-monospace,monospace" : "inherit",
        textAlign: align,
        width: full ? "100%" : width || "auto",
        minWidth: 36,
      }}
    />
  );
}

// Is the sheet being filled in on a phone? The work order is a paper document
// that also gets filled in on the floor, and the two want different date
// controls — paper wants plain typed text, a phone wants the OS calendar.
function useIsPhone() {
  const mq = () =>
    typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia("(max-width: 640px)")
      : null;
  const [phone, setPhone] = useState(() => !!mq()?.matches);
  useEffect(() => {
    const m = mq();
    if (!m) return;
    const on = (e) => setPhone(e.matches);
    setPhone(m.matches);
    if (m.addEventListener) { m.addEventListener("change", on); return () => m.removeEventListener("change", on); }
    m.addListener(on);                       // older Safari
    return () => m.removeListener(on);
  }, []);
  return phone;
}

// The sheet writes and prints dates as 09/16/2026; <input type="date"> only
// speaks yyyy-mm-dd. Anything that isn't a plain date — "ASAP", or a due date
// carrying a time ("09/16/2026, 3:00 PM") — converts to "" and keeps its text
// box, so the calendar can never quietly blank what someone wrote.
const US_DATE = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;
export function toISODate(v) {
  const m = US_DATE.exec(String(v ?? "").trim());
  if (!m) return "";
  const [, mo, d, y] = m;
  return `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
}
export function fromISODate(v) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(v ?? "").trim());
  return m ? `${m[2]}/${m[3]}/${m[1]}` : "";
}

// A date on the sheet. Unchanged on a desktop — the same typed box it has always
// been, printing exactly what was typed. On a phone it becomes a real date input
// so tapping it opens the calendar instead of the keyboard.
export function DateEI({ value, onChange, size = 16, bold, width, align = "left", placeholder, full }) {
  const phone = useIsPhone();
  const iso = toISODate(value);
  const text = <EI value={value} onChange={onChange} size={size} bold={bold} width={width} align={align} placeholder={placeholder} full={full} />;
  if (!phone) return text;
  if (value && !iso) return text;            // not a plain date: leave it alone
  return (
    <input
      className="wo-edit wo-date"
      type="date"
      value={iso}
      onChange={(e) => onChange(fromISODate(e.target.value))}
      style={{
        fontSize: size,
        fontWeight: bold ? 700 : 400,
        textAlign: align,
        width: full ? "100%" : width || "auto",
        minWidth: 36,
      }}
    />
  );
}

function FieldEdit({ label, children }) {
  return (
    <div className="wo-fieldrow flex items-center gap-3 mb-2">
      <span className="wo-fieldlabel inline-block px-2 py-1 font-bold uppercase tracking-wide" style={{ fontSize: 12, color: C.inkSoft, background: C.grayBg, width: 130, flexShrink: 0 }}>{label}</span>
      <div style={{ flex: 1 }}>{children}</div>
    </div>
  );
}

// One letterhead line: a right-aligned label and a value cell of a fixed width.
// The cell forces its own alignment rather than inheriting the letterhead's
// `textAlign: right` — otherwise plain text (the order number) sat flush right
// while every input sat flush left, and the column read as scattered on screen
// and on paper both.
function RowEdit({ label, children }) {
  return (
    <div className="wo-rowedit flex items-center justify-end gap-2 mb-1">
      <span className="font-bold uppercase tracking-wide" style={{ color: C.inkSoft, whiteSpace: "nowrap" }}>{label}:</span>
      <div className="wo-rowvalue" style={{ width: 120, textAlign: "left" }}>{children}</div>
    </div>
  );
}

// Read-only number shown on the letterhead (work-order # or order #).
function ONo({ value }) {
  return <span className="font-bold" style={{ fontFamily: "ui-monospace,monospace", fontSize: 14 }}>{value || "—"}</span>;
}

// The order number(s) on the letterhead.
//
// A combined sheet batches the same product from several orders, and the sheet
// used to print only the list of order numbers — so once the batch was made
// there was no way to tell how many belonged to which order, and no way to
// split the finished pile back up. With more than one order it prints a line
// each, with that order's quantity.
export function OrderNos({ label, orderNo, orderLines }) {
  if (!orderLines || orderLines.length < 2) {
    return <RowEdit label={label}><ONo value={orderNo} /></RowEdit>;
  }
  const total = orderLines.reduce((n, l) => n + (Number(l.qty) || 0), 0);
  return (
    <div className="wo-rowedit flex items-start justify-end gap-2 mb-1">
      <span className="font-bold uppercase tracking-wide" style={{ color: C.inkSoft, whiteSpace: "nowrap" }}>{label}:</span>
      <div className="wo-rowvalue" style={{ minWidth: 120 }}>
        {orderLines.map((l) => (
          <div key={l.no} className="flex items-baseline justify-end gap-2" style={{ lineHeight: 1.35 }}>
            <span className="font-bold" style={{ fontFamily: "ui-monospace,monospace", fontSize: 14 }}>#{l.no}</span>
            <span className="font-bold" style={{ fontFamily: "ui-monospace,monospace", fontSize: 14, minWidth: 30, textAlign: "right" }}>×{l.qty}</span>
          </div>
        ))}
        <div className="flex items-baseline justify-end gap-2"
          style={{ borderTop: `1px solid ${C.line}`, marginTop: 2, paddingTop: 2 }}>
          <span className="font-bold uppercase tracking-wide" style={{ fontSize: 10, color: C.inkSoft }}>Total</span>
          <span className="font-bold" style={{ fontFamily: "ui-monospace,monospace", fontSize: 14, minWidth: 30, textAlign: "right" }}>×{total}</span>
        </div>
      </div>
    </div>
  );
}

function PhotoBox({ minHeight = 220, imageUrl, onUpload, onRevert, onHistory }) {
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  // What to show right now. The sheet is handed a snapshot of the product taken
  // when it opened, so an upload used to change the database and leave the
  // picture on screen stale — you had to close the work order and open it again
  // to see what you'd just put there.
  const [justUploaded, setJustUploaded] = useState(null);
  // Every photo this subject has ever had, newest first, read from storage.
  // Session memory wasn't enough: Revert disappeared as soon as it was used and
  // never appeared at all on a sheet opened fresh, even though an earlier photo
  // was sitting right there. Uploads are never overwritten, so the history is
  // durable and the button can always be offered when there's something to
  // go back to.
  const [history, setHistory] = useState([]);
  // Fallback for backends with no durable photo store (local/demo mode): what
  // the picture was before the replace made in this sheet. Storage history is
  // preferred when it exists because it survives closing the sheet.
  const [sessionPrev, setSessionPrev] = useState(null);
  const fileRef = useRef(null);
  const shown = justUploaded ?? imageUrl;

  const loadHistory = async () => {
    if (!onHistory) return;
    const urls = await onHistory();
    setHistory(Array.isArray(urls) ? urls : []);
  };
  useEffect(() => { loadHistory(); }, [onHistory]);

  // The most recent photo that ISN'T the one on screen. After a revert this
  // points back at the newer one, so the button keeps working in both
  // directions rather than stranding you on whichever you picked.
  const revertTo = history.find((u) => u !== shown) || (sessionPrev !== shown ? sessionPrev : null) || null;

  const handle = async (file) => {
    if (!file || !onUpload || uploading) return;
    setUploading(true);
    try {
      const url = await onUpload(file);
      if (url) { setSessionPrev(shown || null); setJustUploaded(url); await loadHistory(); }
    } finally {
      setUploading(false);
    }
  };

  // Put an earlier photo back. Replacing is the one photo action that destroys
  // what was there, and a stray drag does it.
  const revert = async () => {
    if (!revertTo || uploading) return;
    setUploading(true);
    try {
      if (onRevert) await onRevert(revertTo);
      setSessionPrev(shown || null);   // so it can swap back again
      setJustUploaded(revertTo);
    } finally {
      setUploading(false);
    }
  };

  const drop = onUpload ? {
    onDragOver: (e) => { e.preventDefault(); setDragOver(true); },
    onDragLeave: () => setDragOver(false),
    onDrop: (e) => { e.preventDefault(); setDragOver(false); handle(e.dataTransfer.files && e.dataTransfer.files[0]); },
  } : {};
  const hiddenInput = onUpload && <input ref={fileRef} type="file" accept="image/*" className="no-print" style={{ display: "none" }} onChange={(e) => handle(e.target.files && e.target.files[0])} />;
  const pill = { fontSize: 11, fontWeight: 700, background: "rgba(255,255,255,0.92)", border: `1px solid ${C.line}`, borderRadius: 6, padding: "3px 8px", cursor: "pointer" };

  if (shown) {
    return (
      <div {...drop} className="flex items-center justify-center" style={{ position: "relative", margin: "20px 0", minHeight, border: `${dragOver ? 2 : 1}px ${dragOver ? "dashed" : "solid"} ${dragOver ? C.blue : C.line}`, borderRadius: 4, background: C.surface, overflow: "hidden" }}>
        <img src={shown} alt="Product" style={{ maxWidth: "100%", maxHeight: minHeight + 80, objectFit: "contain" }} />
        <div className="no-print" style={{ position: "absolute", top: 6, right: 6, display: "flex", gap: 6 }}>
          {revertTo && (
            <button type="button" onClick={revert} title="Go back to the previous photo" style={{ ...pill, color: C.rush }}>
              {uploading ? "…" : "Revert"}
            </button>
          )}
          {onUpload && (
            <button type="button" onClick={() => fileRef.current && fileRef.current.click()} style={pill}>
              {uploading ? "…" : "Replace"}
            </button>
          )}
        </div>
        {hiddenInput}
      </div>
    );
  }
  return (
    <div {...drop} onClick={onUpload ? () => fileRef.current && fileRef.current.click() : undefined} className="flex items-center justify-center" style={{ margin: "20px 0", minHeight, border: `${dragOver ? 2 : 1}px dashed ${dragOver ? C.blue : C.line}`, borderRadius: 4, background: dragOver ? C.blueBg : "#FAFBFC", flexDirection: "column", gap: 8, color: C.gray, cursor: onUpload ? "pointer" : "default" }}>
      <Camera size={40} />
      <div style={{ fontSize: 13, fontWeight: 700 }}>Product photo</div>
      <div style={{ fontSize: 12 }}>{uploading ? "Uploading…" : onUpload ? "Drag a photo here or click to upload" : "No photo yet"}</div>
      {hiddenInput}
    </div>
  );
}

function CompletedBy({ value, onChange }) {
  return (
    <div className="wo-signrow flex items-center gap-3" style={{ borderTop: `1px solid ${C.line}`, paddingTop: 16 }}>
      <span className="font-bold uppercase tracking-wide" style={{ fontSize: 13, color: C.inkSoft, whiteSpace: "nowrap" }}>Completed by:</span>
      <input className="wo-sign" value={value || ""} onChange={(e) => onChange(e.target.value)} style={{ flex: 1, minWidth: 0, fontWeight: 700, fontSize: 16 }} />
      <span className="wo-signmark" style={{ fontSize: 11, letterSpacing: 1.5, color: C.gray, fontWeight: 700 }}>MODERN STUDIO EQUIPMENT</span>
    </div>
  );
}

function AddRow({ onClick }) {
  return (
    <button onClick={onClick} className="no-print inline-flex items-center gap-1 px-2 py-1 mt-2 rounded text-xs font-bold uppercase tracking-wide" style={{ background: C.surface, color: C.inkSoft, border: `1px solid ${C.line}` }}>
      <Plus size={13} />Add row
    </button>
  );
}

const tag = { fontSize: 11, fontWeight: 700, color: C.inkSoft, background: C.grayBg, padding: "2px 6px", letterSpacing: 0.5 };

// ---- Shop (basic) ----
export function BasicBody({ fields, set, orderNo, orderLines, numLabel = "WO #", imageUrl, items, onUploadPhoto, onRevertPhoto, onPhotoHistory }) {
  const multi = items && items.length > 1;
  return (
    <>
      <div className="wo-head flex items-start justify-between" style={{ marginBottom: 18 }}>
        <Wordmark height={36} variant="dark" subText="WORK ORDER" subAlign="left" />
        <div style={{ textAlign: "right", minWidth: 200 }}>
          <OrderNos label={numLabel} orderNo={orderNo} orderLines={orderLines} />
          <RowEdit label="Due date"><DateEI value={fields.dueDate} onChange={(v) => set("dueDate", v)} size={13} bold full /></RowEdit>
          <RowEdit label="Order"><EI value={fields.order} onChange={(v) => set("order", v)} size={13} bold mono full /></RowEdit>
          <RowEdit label="Total"><EI value={fields.total} onChange={(v) => set("total", v)} size={13} bold mono full /></RowEdit>
        </div>
      </div>

      <div className="no-print mb-3 flex items-center gap-2">
        <span style={{ fontSize: 11, fontWeight: 700, color: C.gray, textTransform: "uppercase", letterSpacing: 0.5 }}>Priority</span>
        <select className="wo-edit" value={fields.priority || "Normal"} onChange={(e) => set("priority", e.target.value)} style={{ fontSize: 13, fontWeight: 700 }}>
          <option value="Normal">Standard</option><option value="High">High</option><option value="RUSH">Urgent</option>
        </select>
      </div>
      {fields.priority && fields.priority !== "Normal" && (
        <div className="inline-block px-3 py-1 mb-4" style={{ background: fields.priority === "RUSH" ? C.rush : C.high, color: "#fff", fontSize: 16, fontWeight: 900, letterSpacing: 2, textTransform: "uppercase" }}>{priLabel(fields.priority)} — prioritize</div>
      )}

      <div style={{ marginBottom: 18 }}>
        {multi ? (
          <div className="mb-3">
            <span className="inline-block px-2 py-1 font-bold uppercase tracking-wide" style={{ fontSize: 12, color: C.inkSoft, background: C.grayBg }}>Products</span>
            <div style={{ marginTop: 6, border: `1px solid ${C.line}` }}>
              {items.map((it, i) => (
                <div key={i} className="flex items-center justify-between" style={{ borderTop: i === 0 ? "none" : `1px solid ${C.line}`, padding: "5px 10px" }}>
                  <span style={{ fontSize: 14, fontWeight: 700 }}>{it.name}</span>
                  <span style={{ fontFamily: "ui-monospace,monospace", fontWeight: 700 }}>×{it.qty}</span>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <FieldEdit label="Product"><EI value={fields.product} onChange={(v) => set("product", v)} bold full /></FieldEdit>
        )}
        <FieldEdit label="Ordered on"><DateEI value={fields.orderedOn} onChange={(v) => set("orderedOn", v)} bold full /></FieldEdit>
        {/* Fixed the first time this order is printed — every sheet after that
            carries the same date, so two printouts can never disagree. */}
        <FieldEdit label="W/O date"><DateEI value={fields.woDate} onChange={(v) => set("woDate", v)} bold full /></FieldEdit>
        <FieldEdit label="Color"><EI value={fields.color} onChange={(v) => set("color", v)} bold full /></FieldEdit>
        <FieldEdit label="Notes"><EI value={fields.notes} onChange={(v) => set("notes", v)} size={15} full /></FieldEdit>
      </div>

      <PhotoBox minHeight={440} imageUrl={imageUrl} onUpload={onUploadPhoto} onRevert={onRevertPhoto} onHistory={onPhotoHistory} />
      <CompletedBy value={fields.completedBy} onChange={(v) => set("completedBy", v)} />
    </>
  );
}

// ---- CNC: MODERN sheet + part # + 6 step lines ----
export function CncBody({ fields, set, orderNo, orderLines, numLabel = "WO #", imageUrl, onUploadPhoto, onRevertPhoto, onPhotoHistory }) {
  const steps = ["step1", "step2", "step3", "step4", "step5", "step6"];
  return (
    <>
      <div className="wo-head flex items-start justify-between" style={{ marginBottom: 16 }}>
        <Wordmark height={36} variant="dark" subText="WORK ORDER" subAlign="left" />
        <div style={{ textAlign: "right", minWidth: 200 }}>
          <OrderNos label={numLabel} orderNo={orderNo} orderLines={orderLines} />
          <RowEdit label="Due date"><DateEI value={fields.dueDate} onChange={(v) => set("dueDate", v)} size={13} bold full /></RowEdit>
          <RowEdit label="Order"><EI value={fields.order} onChange={(v) => set("order", v)} size={13} bold mono full /></RowEdit>
          <RowEdit label="Total"><EI value={fields.total} onChange={(v) => set("total", v)} size={13} bold mono full /></RowEdit>
        </div>
      </div>

      <div className="wo-head flex items-start justify-between" style={{ marginBottom: 6 }}>
        <div style={{ flex: 1 }}>
          <FieldEdit label="Product"><EI value={fields.product} onChange={(v) => set("product", v)} bold full /></FieldEdit>
          <FieldEdit label="Ordered on"><DateEI value={fields.orderedOn} onChange={(v) => set("orderedOn", v)} bold full /></FieldEdit>
          {/* Fixed on the first print of this order — see BasicBody. */}
          <FieldEdit label="W/O date"><DateEI value={fields.woDate} onChange={(v) => set("woDate", v)} bold full /></FieldEdit>
        </div>
        <div style={{ width: 170, textAlign: "right" }}>
          <div className="font-bold uppercase tracking-wide" style={{ fontSize: 11, color: C.inkSoft }}>Part #</div>
          <EI value={fields.partNo} onChange={(v) => set("partNo", v)} size={18} bold mono align="right" full />
        </div>
      </div>

      <div style={{ margin: "14px 0" }}>
        {steps.map((s, i) => (
          <div key={s} className="flex items-center gap-3" style={{ marginBottom: 8 }}>
            <span className="font-bold uppercase tracking-wide" style={{ fontSize: 12, color: C.inkSoft, background: C.grayBg, padding: "3px 7px", width: 64, flexShrink: 0 }}>Step {i + 1}:</span>
            <EI value={fields[s]} onChange={(v) => set(s, v)} size={14} bold full />
          </div>
        ))}
      </div>

      <PhotoBox minHeight={320} imageUrl={imageUrl} onUpload={onUploadPhoto} onRevert={onRevertPhoto} onHistory={onPhotoHistory} />
      <CompletedBy value={fields.completedBy} onChange={(v) => set("completedBy", v)} />
    </>
  );
}

// ---- Sewing: header + PRODUCT/QTY list ----
export function SewingBody({ fields, set, setLineCell, addLine, form, orderNo, orderLines, numLabel = "WO #" }) {
  const minRows = form.minRows || 18;
  const rows = Math.max(fields.lines.length, minRows);
  return (
    <>
      <div className="wo-head flex items-start justify-between" style={{ marginBottom: 14 }}>
        <Wordmark height={34} variant="dark" subText="WORK ORDER" subAlign="left" />
        <div style={{ textAlign: "right", minWidth: 240 }}>
          <div className="font-bold uppercase tracking-wide" style={{ fontSize: 14, marginBottom: 6 }}>Work order:</div>
          <OrderNos label={numLabel} orderNo={orderNo} orderLines={orderLines} />
          <RowEdit label="Order date"><DateEI value={fields.orderDate} onChange={(v) => set("orderDate", v)} size={13} bold full /></RowEdit>
          {/* Fixed on the first print of this order — see BasicBody. */}
          <RowEdit label="W/O date"><DateEI value={fields.woDate} onChange={(v) => set("woDate", v)} size={13} bold full /></RowEdit>
          <RowEdit label="Due date"><DateEI value={fields.dueDate} onChange={(v) => set("dueDate", v)} size={13} bold full /></RowEdit>
          <RowEdit label="Time"><EI value={fields.time} onChange={(v) => set("time", v)} size={13} bold full /></RowEdit>
        </div>
      </div>

      <div className="flex items-center gap-2" style={{ margin: "8px 0 16px" }}>
        <span className="font-bold uppercase tracking-wide" style={{ fontSize: 12, color: C.inkSoft }}>Invoice(s):</span>
        <EI value={fields.invoices} onChange={(v) => set("invoices", v)} size={15} bold full />
      </div>

      <div style={{ border: `1px solid ${C.line}` }}>
        {Array.from({ length: rows }).map((_, i) => {
          const ln = fields.lines[i] || { product: "", qty: "" };
          return (
            <div key={i} className="flex items-stretch" style={{ borderTop: i === 0 ? "none" : `1px solid ${C.line}`, minHeight: 30 }}>
              <div className="flex items-center" style={{ flex: 1, padding: "2px 10px", gap: 8, minWidth: 0 }}>
                <span style={tag}>PRODUCT:</span>
                <EI value={ln.product} onChange={(v) => setLineCell(i, "product", v)} size={14} bold full />
              </div>
              <div className="flex items-center" style={{ borderLeft: `1px solid ${C.line}`, padding: "2px 10px", gap: 8, width: 150 }}>
                <span style={tag}>QTY:</span>
                <EI value={ln.qty} onChange={(v) => setLineCell(i, "qty", v)} size={14} bold mono align="center" width={50} />
              </div>
            </div>
          );
        })}
      </div>
      <AddRow onClick={addLine} />
    </>
  );
}

// ---- Saw: plain Order # + cut list ----
export function SawBody({ fields, set, setLineCell, addLine, form, orderNo, orderLines, numLabel = "WO #" }) {
  const minRows = form.minRows || 12;
  const rows = Math.max(fields.lines.length, minRows);
  return (
    <>
      <div className="wo-head flex items-end justify-between" style={{ marginBottom: 16 }}>
        <Wordmark height={26} variant="dark" showSub={false} subAlign="left" />
        <span className="flex items-baseline gap-4">
          {/* Fixed on the first print of this order — see BasicBody. */}
          <span style={{ fontSize: 12, color: C.inkSoft }}>
            W/O date <DateEI value={fields.woDate} onChange={(v) => set("woDate", v)} size={13} bold />
          </span>
          <span className="font-bold" style={{ fontFamily: "ui-monospace,monospace", fontSize: 16 }}>{numLabel} {orderNo}</span>
        </span>
      </div>
      {Array.from({ length: rows }).map((_, i) => {
        const ln = fields.lines[i] || { item: "", size: "", qty: "" };
        return (
          <div key={i} style={{ marginBottom: 12 }}>
            <EI value={ln.item} onChange={(v) => setLineCell(i, "item", v)} size={15} bold full placeholder="Material / item" />
            <div className="flex items-end gap-3" style={{ marginTop: 4 }}>
              <EI value={ln.size} onChange={(v) => setLineCell(i, "size", v)} size={14} bold full placeholder="Size" />
              <EI value={ln.qty} onChange={(v) => setLineCell(i, "qty", v)} size={14} bold mono align="right" width={60} placeholder="Qty" />
            </div>
          </div>
        );
      })}
      <AddRow onClick={addLine} />
    </>
  );
}

// Pick the body component for a department/type key.
export function bodyFor(type) {
  return type === "sewing" ? SewingBody : type === "saw" ? SawBody : type === "cnc" ? CncBody : BasicBody;
}
