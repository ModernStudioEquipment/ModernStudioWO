import React, { useState } from "react";
import { createPortal } from "react-dom";
import { Printer } from "lucide-react";
import { C } from "../../theme.js";
import { Btn } from "../ui.jsx";
import { WO_FORMS, initFields, emptyLine } from "../workorders/forms.js";
import { bodyFor } from "../workorders/bodies.jsx";

// The work-order SHEET — editable in place. Fields and line rows are inputs you
// type into directly on the form (no separate prompt modal). Save persists,
// Save & Print persists then prints (inputs print clean via the print CSS).
// Handles both new (no wo.id) and existing work orders. The per-department
// sheet bodies are shared with the Shopify sheet (see workorders/bodies.jsx).
export function CustomWorkOrderDoc({ wo, onSave, onClose }) {
  const t = wo.type;
  const form = WO_FORMS[t];
  const isLines = form.layout === "lineItems";

  const [woId, setWoId] = useState(wo.id);
  const [fields, setFields] = useState(() => {
    const base = { ...initFields(form), ...(wo.fields || {}) };
    if (isLines && (!Array.isArray(base.lines) || base.lines.length === 0)) base.lines = [emptyLine(form)];
    return base;
  });
  const [saving, setSaving] = useState(false);

  const set = (k, v) => setFields((f) => ({ ...f, [k]: v }));
  const setLineCell = (i, key, val) =>
    setFields((f) => {
      const lines = [...f.lines];
      while (lines.length <= i) lines.push(emptyLine(form));
      lines[i] = { ...lines[i], [key]: val };
      return { ...f, lines };
    });
  const addLine = () => setFields((f) => ({ ...f, lines: [...f.lines, emptyLine(form)] }));

  const title = isLines
    ? ((fields.lines.find((l) => (l.product || l.item || "").trim()) || {}).product
        || (fields.lines.find((l) => (l.item || "").trim()) || {}).item
        || form.label)
    : ((fields.product || "").trim() || form.label);

  const save = async (thenPrint) => {
    if (saving) return;
    setSaving(true);
    try {
      const cleanFields = isLines
        ? (() => {
            const kept = fields.lines.filter((l) => Object.values(l).some((v) => (v || "").trim()));
            return { ...fields, lines: kept.length ? kept : [emptyLine(form)] };
          })()
        : fields;
      const id = await onSave({ id: woId, type: t, title, fields: cleanFields, orderNo: wo.orderNo });
      if (id && !woId) setWoId(id);
      if (thenPrint) setTimeout(() => window.print(), 50);
    } finally {
      setSaving(false);
    }
  };

  const Body = bodyFor(t);
  const bodyProps = { fields, set, setLineCell, addLine, form, orderNo: wo.orderNo };

  return createPortal(
    <div className="print-doc-overlay" style={overlay} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: 680, maxWidth: "96vw" }}>
        <div className="flex gap-2 mb-2 justify-end no-print">
          <Btn kind="green" onClick={() => save(false)} disabled={saving}>{saving ? "Saving…" : "Save"}</Btn>
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
