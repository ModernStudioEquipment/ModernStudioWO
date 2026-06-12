import React, { useState } from "react";
import { Printer } from "lucide-react";
import { C, dueLabel } from "../../theme.js";
import { Btn } from "../ui.jsx";
import { WO_FORMS, initFields, emptyLine } from "../workorders/forms.js";
import { bodyFor } from "../workorders/bodies.jsx";

const DEPT_TO_TYPE = { Shop: "shop", CNC: "cnc", Sewing: "sewing", Saw: "saw" };

// Printable work order for a Shopify (customer-order) item. The sheet now
// matches the item's DEPARTMENT (Shop/CNC/Sewing/Saw) — same templates as the
// QuickBooks sheets — pre-filled from the order item. Core fields (product /
// qty / color / completed-by) save back to the item; the department-specific
// scratch fields (CNC steps, extra sewing/saw rows, notes) are for printing.
export function WorkOrderDoc({ order, item, onSave, onClose }) {
  const type = DEPT_TO_TYPE[item.dept] || "shop";
  const form = WO_FORMS[type];
  const isLines = form.layout === "lineItems";

  const orderedOn = new Date(order.receivedAt).toLocaleDateString("en-US", {
    month: "long", day: "numeric", year: "numeric",
  });

  const [fields, setFields] = useState(() => {
    const base = initFields(form);
    if ("product" in base) base.product = item.name;
    if ("total" in base) base.total = String(item.qty);
    if ("color" in base) base.color = item.color || "";
    if ("orderedBy" in base) base.orderedBy = order.contact || "";
    if ("orderedOn" in base) base.orderedOn = orderedOn;
    if ("priority" in base) base.priority = order.priority || "Normal";
    if ("dueDate" in base && order.dueDate) base.dueDate = dueLabel(order.dueDate);
    base.completedBy = item.completedBy || "";
    if (isLines) {
      const first = emptyLine(form);
      if ("product" in first) first.product = item.name;
      if ("item" in first) first.item = item.name;
      if ("qty" in first) first.qty = String(item.qty);
      base.lines = [first];
    }
    return base;
  });
  const [saving, setSaving] = useState(false);

  const set = (k, v) => setFields((f) => ({ ...f, [k]: v }));
  const setLineCell = (i, key, val) =>
    setFields((f) => {
      const lines = [...(f.lines || [])];
      while (lines.length <= i) lines.push(emptyLine(form));
      lines[i] = { ...lines[i], [key]: val };
      return { ...f, lines };
    });
  const addLine = () => setFields((f) => ({ ...f, lines: [...(f.lines || []), emptyLine(form)] }));

  const save = async (thenPrint) => {
    if (saving) return;
    setSaving(true);
    try {
      if (onSave) {
        const first = (fields.lines || [])[0] || {};
        const name = isLines ? (first.product || first.item || item.name) : (fields.product || item.name);
        const qty = isLines ? first.qty : fields.total;
        await onSave({ name, qty, color: fields.color || null, completedBy: fields.completedBy || null });
      }
      if (thenPrint) setTimeout(() => window.print(), 50);
    } finally {
      setSaving(false);
    }
  };

  const Body = bodyFor(type);
  const bodyProps = { fields, set, setLineCell, addLine, form, orderNo: order.orderNo, numLabel: "Order #" };

  return (
    <div style={overlay} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: 680, maxWidth: "96vw" }}>
        <div className="flex gap-2 mb-2 justify-end no-print">
          {onSave && <Btn kind="green" onClick={() => save(false)} disabled={saving}>{saving ? "Saving…" : "Save"}</Btn>}
          <Btn kind="brass" onClick={() => save(true)} disabled={saving}><Printer size={15} />Save &amp; Print</Btn>
          <Btn onClick={onClose}>Close</Btn>
        </div>
        <div id="wo" style={{ background: "#fff", border: `1px solid ${C.line}`, padding: "30px 34px" }}>
          <Body {...bodyProps} />
        </div>
      </div>
    </div>
  );
}

const overlay = {
  position: "fixed", inset: 0, background: "rgba(20,28,38,0.55)",
  display: "flex", alignItems: "flex-start", justifyContent: "center",
  overflowY: "auto", zIndex: 60, padding: "24px 12px",
};
