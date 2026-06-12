import React from "react";
import { Camera, Plus } from "lucide-react";
import { C } from "../../theme.js";
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

function FieldEdit({ label, children }) {
  return (
    <div className="flex items-center gap-3 mb-2">
      <span className="inline-block px-2 py-1 font-bold uppercase tracking-wide" style={{ fontSize: 12, color: C.inkSoft, background: C.grayBg, width: 130, flexShrink: 0 }}>{label}</span>
      <div style={{ flex: 1 }}>{children}</div>
    </div>
  );
}

function RowEdit({ label, children }) {
  return (
    <div className="flex items-center justify-end gap-2 mb-1">
      <span className="font-bold uppercase tracking-wide" style={{ color: C.inkSoft }}>{label}:</span>
      <div style={{ width: 120 }}>{children}</div>
    </div>
  );
}

// Read-only number shown on the letterhead (work-order # or order #).
function ONo({ value }) {
  return <span className="font-bold" style={{ fontFamily: "ui-monospace,monospace", fontSize: 14 }}>{value || "—"}</span>;
}

function PhotoBox({ minHeight = 220 }) {
  return (
    <div className="flex items-center justify-center" style={{ margin: "20px 0", minHeight, border: `1px dashed ${C.line}`, borderRadius: 4, background: "#FAFBFC", flexDirection: "column", gap: 8, color: C.gray }}>
      <Camera size={40} />
      <div style={{ fontSize: 13, fontWeight: 700 }}>Product photo</div>
      <div style={{ fontSize: 12 }}>Parts photo library — later phase</div>
    </div>
  );
}

function CompletedBy({ value, onChange }) {
  return (
    <div className="flex items-center gap-3" style={{ borderTop: `1px solid ${C.line}`, paddingTop: 16 }}>
      <span className="font-bold uppercase tracking-wide" style={{ fontSize: 13, color: C.inkSoft }}>Completed by:</span>
      <input className="wo-sign" value={value || ""} onChange={(e) => onChange(e.target.value)} style={{ flex: 1, fontWeight: 700, fontSize: 16 }} />
      <span style={{ fontSize: 11, letterSpacing: 1.5, color: C.gray, fontWeight: 700 }}>MODERN STUDIO EQUIPMENT</span>
    </div>
  );
}

function AddRow({ onClick }) {
  return (
    <button onClick={onClick} className="no-print inline-flex items-center gap-1 px-2 py-1 mt-2 rounded text-xs font-bold uppercase tracking-wide" style={{ background: "#fff", color: C.inkSoft, border: `1px solid ${C.line}` }}>
      <Plus size={13} />Add row
    </button>
  );
}

const tag = { fontSize: 11, fontWeight: 700, color: C.inkSoft, background: C.grayBg, padding: "2px 6px", letterSpacing: 0.5 };

// ---- Shop (basic) ----
export function BasicBody({ fields, set, orderNo, numLabel = "WO #" }) {
  return (
    <>
      <div className="flex items-start justify-between" style={{ marginBottom: 18 }}>
        <Wordmark height={36} variant="dark" subText="WORK ORDER" subAlign="left" />
        <div style={{ textAlign: "right", minWidth: 200 }}>
          <RowEdit label={numLabel}><ONo value={orderNo} /></RowEdit>
          <RowEdit label="Due date"><EI value={fields.dueDate} onChange={(v) => set("dueDate", v)} size={13} bold full /></RowEdit>
          <RowEdit label="Total"><EI value={fields.total} onChange={(v) => set("total", v)} size={13} bold mono full /></RowEdit>
        </div>
      </div>

      <div className="no-print mb-3 flex items-center gap-2">
        <span style={{ fontSize: 11, fontWeight: 700, color: C.gray, textTransform: "uppercase", letterSpacing: 0.5 }}>Priority</span>
        <select className="wo-edit" value={fields.priority || "Normal"} onChange={(e) => set("priority", e.target.value)} style={{ fontSize: 13, fontWeight: 700 }}>
          <option>Normal</option><option>High</option><option>RUSH</option>
        </select>
      </div>
      {fields.priority && fields.priority !== "Normal" && (
        <div className="inline-block px-3 py-1 mb-4" style={{ background: fields.priority === "RUSH" ? C.rush : C.high, color: "#fff", fontSize: 16, fontWeight: 900, letterSpacing: 2, textTransform: "uppercase" }}>{fields.priority} — prioritize</div>
      )}

      <div style={{ marginBottom: 18 }}>
        <FieldEdit label="Product"><EI value={fields.product} onChange={(v) => set("product", v)} bold full /></FieldEdit>
        <FieldEdit label="Ordered by"><EI value={fields.orderedBy} onChange={(v) => set("orderedBy", v)} bold full /></FieldEdit>
        <FieldEdit label="Ordered on"><EI value={fields.orderedOn} onChange={(v) => set("orderedOn", v)} bold full /></FieldEdit>
        <FieldEdit label="Color"><EI value={fields.color} onChange={(v) => set("color", v)} bold full /></FieldEdit>
        <FieldEdit label="Notes"><EI value={fields.notes} onChange={(v) => set("notes", v)} size={15} full /></FieldEdit>
      </div>

      <PhotoBox />
      <CompletedBy value={fields.completedBy} onChange={(v) => set("completedBy", v)} />
    </>
  );
}

// ---- CNC: MODERN sheet + part # + 6 step lines ----
export function CncBody({ fields, set, orderNo, numLabel = "WO #" }) {
  const steps = ["step1", "step2", "step3", "step4", "step5", "step6"];
  return (
    <>
      <div className="flex items-start justify-between" style={{ marginBottom: 16 }}>
        <Wordmark height={36} variant="dark" subText="WORK ORDER" subAlign="left" />
        <div style={{ textAlign: "right", minWidth: 200 }}>
          <RowEdit label={numLabel}><ONo value={orderNo} /></RowEdit>
          <RowEdit label="Due date"><EI value={fields.dueDate} onChange={(v) => set("dueDate", v)} size={13} bold full /></RowEdit>
          <RowEdit label="Total"><EI value={fields.total} onChange={(v) => set("total", v)} size={13} bold mono full /></RowEdit>
        </div>
      </div>

      <div className="flex items-start justify-between" style={{ marginBottom: 6 }}>
        <div style={{ flex: 1 }}>
          <FieldEdit label="Product"><EI value={fields.product} onChange={(v) => set("product", v)} bold full /></FieldEdit>
          <FieldEdit label="Ordered by"><EI value={fields.orderedBy} onChange={(v) => set("orderedBy", v)} bold full /></FieldEdit>
          <FieldEdit label="Ordered on"><EI value={fields.orderedOn} onChange={(v) => set("orderedOn", v)} bold full /></FieldEdit>
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

      <PhotoBox minHeight={180} />
      <CompletedBy value={fields.completedBy} onChange={(v) => set("completedBy", v)} />
    </>
  );
}

// ---- Sewing: header + PRODUCT/QTY list ----
export function SewingBody({ fields, set, setLineCell, addLine, form, orderNo, numLabel = "WO #" }) {
  const minRows = form.minRows || 18;
  const rows = Math.max(fields.lines.length, minRows);
  return (
    <>
      <div className="flex items-start justify-between" style={{ marginBottom: 14 }}>
        <Wordmark height={34} variant="dark" subText="WORK ORDER" subAlign="left" />
        <div style={{ textAlign: "right", minWidth: 240 }}>
          <div className="font-bold uppercase tracking-wide" style={{ fontSize: 14, marginBottom: 6 }}>Work order:</div>
          <RowEdit label={numLabel}><ONo value={orderNo} /></RowEdit>
          <RowEdit label="Order date"><EI value={fields.orderDate} onChange={(v) => set("orderDate", v)} size={13} bold full /></RowEdit>
          <RowEdit label="Due date"><EI value={fields.dueDate} onChange={(v) => set("dueDate", v)} size={13} bold full /></RowEdit>
          <RowEdit label="Time"><EI value={fields.time} onChange={(v) => set("time", v)} size={13} bold full /></RowEdit>
          <RowEdit label="Ordered by"><EI value={fields.orderedBy} onChange={(v) => set("orderedBy", v)} size={13} bold full /></RowEdit>
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
export function SawBody({ fields, set, setLineCell, addLine, form, orderNo, numLabel = "WO #" }) {
  const minRows = form.minRows || 12;
  const rows = Math.max(fields.lines.length, minRows);
  return (
    <>
      <div className="flex items-end justify-between" style={{ marginBottom: 16 }}>
        <Wordmark height={26} variant="dark" showSub={false} subAlign="left" />
        <span className="font-bold" style={{ fontFamily: "ui-monospace,monospace", fontSize: 16 }}>{numLabel} {orderNo}</span>
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
