import React, { useState } from "react";
import { createPortal } from "react-dom";
import { Printer } from "lucide-react";
import { C, dueLabel, fmtDate } from "../../theme.js";
import { Btn } from "../ui.jsx";
import { WO_FORMS, initFields, emptyLine } from "../workorders/forms.js";
import { bodyFor } from "../workorders/bodies.jsx";

const DEPT_TO_TYPE = { Shop: "shop", CNC: "cnc", Sewing: "sewing", Saw: "saw" };

// Printable work order for a customer order's items in ONE department — all of
// that department's items go on a single sheet. Sewing/Saw list them as rows;
// Shop/CNC use one product (or a combined line for several). "Completed by"
// saves to every item on the sheet.
export function WorkOrderDoc({ order, items, onSave, onPrinted, onUploadPhoto, onClose }) {
  const type = DEPT_TO_TYPE[items[0]?.dept] || "shop";
  const form = WO_FORMS[type];
  const isLines = form.layout === "lineItems";
  const orderedOn = fmtDate(order.receivedAt);
  // The official work-order date for this order. Once a sheet has been printed
  // it's fixed, so a reprint — or another department's sheet, or one product
  // printed on its own — all carry that same first date. Before the first print
  // there's nothing to show yet, so the sheet previews today.
  const [woDate, setWoDate] = useState(() => fmtDate(order.woPrintedAt || Date.now()));

  const [fields, setFields] = useState(() => {
    const base = initFields(form);
    if ("orderedOn" in base) base.orderedOn = orderedOn;
    if ("woDate" in base) base.woDate = fmtDate(order.woPrintedAt || Date.now());
    if ("orderDate" in base) base.orderDate = orderedOn;   // the customer's order date, not today
    if ("dueDate" in base && order.dueDate) base.dueDate = dueLabel(order.dueDate);
    base.completedBy = items[0]?.completedBy || "";
    if (isLines) {
      base.lines = items.map((it) => {
        const ln = emptyLine(form);
        if ("product" in ln) ln.product = it.name;
        if ("item" in ln) ln.item = it.name;
        if ("qty" in ln) ln.qty = String(it.qty);
        return ln;
      });
    } else if (items.length === 1) {
      base.product = items[0].name;
      base.order = String(items[0].qty); // how many this order needs
      base.total = String(items[0].qty); // default make-qty; the shop can bump it
      base.color = items[0].color || "";
    } else {
      // Multiple items on a single-product template: never cram them into the top
      // line (it truncates on paper). CNC → list them on the step lines; Shop →
      // BasicBody renders them as stacked product rows (from `items`).
      base.order = String(items.reduce((n, it) => n + (parseFloat(it.qty) || 1), 0));
      base.total = base.order; // default make-qty to the ordered total; shop can bump it
      if (type === "cnc") {
        items.slice(0, 6).forEach((it, i) => { base["step" + (i + 1)] = `${it.name} ×${it.qty}`; });
      }
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
      if (onSave) await onSave({ completedBy: fields.completedBy || null });
      if (thenPrint) {
        // Stamp the official date BEFORE the paper comes out, so what's printed
        // is what's recorded. The stamp only takes on the very first print; after
        // that this returns the original date and the sheet is unchanged.
        if (onPrinted) {
          const at = await onPrinted();
          if (at) {
            const shown = fmtDate(at);
            setWoDate(shown);
            setFields((f) => ("woDate" in f ? { ...f, woDate: shown } : f));
          }
        }
        setTimeout(() => window.print(), 50);
      }
    } finally {
      setSaving(false);
    }
  };

  const Body = bodyFor(type);
  const bodyProps = {
    fields, set, setLineCell, addLine, form, items,
    orderNo: order.orderNo, numLabel: "Order #",
    // Combined sheets carry a per-order breakdown so the shop can see how many
    // of the batch belong to each order (see makeCombinedDoc).
    orderLines: order.orderLines,
    imageUrl: items.length === 1 ? items[0].imageUrl : null,
    onUploadPhoto,
  };

  return createPortal(
    <div className="print-doc-overlay" style={overlay} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: 680, maxWidth: "96vw" }}>
        <div className="flex gap-2 mb-2 justify-end no-print">
          {onSave && <Btn kind="green" onClick={() => save(false)} disabled={saving}>{saving ? "Saving…" : "Save"}</Btn>}
          <Btn kind="brass" onClick={() => save(true)} disabled={saving}><Printer size={15} />Save &amp; Print</Btn>
          <Btn onClick={onClose}>Close</Btn>
        </div>
        <div id="wo" style={{ background: C.surface, border: `1px solid ${C.line}`, padding: "30px 34px" }}>
          <Body {...bodyProps} />
        </div>
      </div>
    </div>,
    document.body,
  );
}

const overlay = {
  position: "fixed", inset: 0, background: "rgba(20,28,38,0.55)",
  display: "flex", alignItems: "flex-start", justifyContent: "center",
  overflowY: "auto", zIndex: 60, padding: "24px 12px",
};
