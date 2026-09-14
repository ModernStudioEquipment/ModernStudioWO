import React, { useState } from "react";
import { createPortal } from "react-dom";
import { Printer } from "lucide-react";
import { C, fmtDate } from "../../theme.js";
import { Btn } from "../ui.jsx";
import { useDirty, UnsavedPrompt } from "../UnsavedGuard.jsx";
import { WO_FORMS, initFields, emptyLine, fieldsLostSwitching, remapFields } from "../workorders/forms.js";
import { bodyFor } from "../workorders/bodies.jsx";

// The work-order SHEET — editable in place. Fields and line rows are inputs you
// type into directly on the form (no separate prompt modal). Save persists,
// Save & Print persists then prints (inputs print clean via the print CSS).
// Handles both new (no wo.id) and existing work orders. The per-department
// sheet bodies are shared with the Shopify sheet (see workorders/bodies.jsx).
export function CustomWorkOrderDoc({ wo, onSave, onUploadPhoto, onPhotoHistory, onClose }) {
  // THE DEPARTMENT IS A CHOICE, NOT A BRAND.
  //
  // It used to be decided entirely by which button you pressed to create the sheet, and nothing
  // afterwards could change it — a saw order raised on the shop button stayed a shop order for
  // good, or had to be retyped from scratch under the right one.
  //
  // It is editable here instead. The catch is that the four departments do not share a form: shop
  // and cnc are field sheets, sewing and saw are line-item sheets, and only some keys overlap. So
  // a switch says what it will drop before it does it, rather than quietly emptying the sheet.
  const [t, setT] = useState(wo.type);
  const [pendingType, setPendingType] = useState(null);
  const form = WO_FORMS[t];
  const isLines = form.layout === "lineItems";

  const [woId, setWoId] = useState(wo.id);
  const [fields, setFields] = useState(() => {
    const base = { ...initFields(form), ...(wo.fields || {}) };
    // Reprints must show the ORIGINAL creation date, never the reprint day. Once
    // the sheet has been saved (it has a createdAt), pin the date field to that
    // immutable stamp instead of the today() default.
    if (wo.createdAt) {
      if ("orderedOn" in base) base.orderedOn = fmtDate(wo.createdAt);
      if ("orderDate" in base) base.orderDate = fmtDate(wo.createdAt);
    }
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

  // Closing with typing in the form used to bin it silently.
  const dirty = useDirty({ fields, title });
  const [askClose, setAskClose] = useState(false);
  const tryClose = () => (dirty ? setAskClose(true) : onClose());

  const Body = bodyFor(t);
  // A custom sheet has no order item to hang a photo on, so the URL lives in the
  // work order's own `fields` JSON — same place as everything else typed here,
  // and saved by the same Save button. Without this the shared body rendered a
  // dead photo box: no drop target, no file picker, just "No photo yet".
  const bodyProps = {
    fields, set, setLineCell, addLine, form, orderNo: wo.orderNo,
    imageUrl: fields.imageUrl || null,
    onUploadPhoto: onUploadPhoto
      ? async (file) => { const url = await onUploadPhoto(wo.id, file); if (url) set("imageUrl", url); return url; }
      : undefined,
    onRevertPhoto: (url) => set("imageUrl", url),
    onPhotoHistory: onPhotoHistory ? () => onPhotoHistory(wo.id) : undefined,
  };

  return createPortal(
    <div className="print-doc-overlay" style={overlay} onClick={tryClose}>
      <div className="wo-sheetwrap" onClick={(e) => e.stopPropagation()} style={{ width: 680, maxWidth: "96vw" }}>
        <div className="wo-toolbar flex gap-2 mb-2 items-center no-print">
          <label className="flex items-center gap-2" style={{ fontSize: 12, color: C.gray }}>
            <span style={{ fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5 }}>Department</span>
            <select
              value={t}
              onChange={(e) => {
                const next = e.target.value;
                if (next === t) return;
                const lost = fieldsLostSwitching(t, next, fields);
                // Nothing to lose, nothing to ask about.
                if (!lost.length) { setFields((f) => remapFields(t, next, f)); setT(next); return; }
                setPendingType({ next, lost });
              }}
              // C.ink / C.surface, not invented keys — an undefined colour leaves the
              // select with no explicit foreground, which goes unreadable in dark mode.
              style={{ background: C.surface, color: C.ink, border: `1px solid ${C.line}`,
                       borderRadius: 6, padding: "5px 9px", fontWeight: 700 }}
            >
              {Object.keys(WO_FORMS).map((k) => (
                <option key={k} value={k}>{WO_FORMS[k].label || k}</option>
              ))}
            </select>
          </label>
          <span className="flex-1" />
          <Btn kind="green" onClick={() => save(false)} disabled={saving}>{saving ? "Saving…" : "Save"}</Btn>
          <Btn kind="brass" onClick={() => save(true)} disabled={saving}><Printer size={15} />Save &amp; Print</Btn>
          <Btn onClick={tryClose}>Close</Btn>
        </div>
        {/* Asked in the sheet rather than through window.confirm: a browser dialog can be
            suppressed, and a suppressed confirm returns false, which would look like the switch
            silently refusing to happen. */}
        {pendingType && (
          <div className="no-print mb-2 rounded p-3"
               style={{ background: C.surface, border: `1px solid ${C.line}` }}>
            <div style={{ fontWeight: 700, marginBottom: 4 }}>
              Move this to {WO_FORMS[pendingType.next].label || pendingType.next}?
            </div>
            <div style={{ fontSize: 13, color: C.gray, marginBottom: 8 }}>
              {WO_FORMS[pendingType.next].layout !== form.layout
                ? <>These are different kinds of sheet, so nothing carries across. </>
                : <>Everything both sheets have in common is kept. </>}
              This will clear: <b>{pendingType.lost.join(", ")}</b>.
            </div>
            <div className="flex gap-2">
              <Btn kind="green" onClick={() => {
                setFields((f) => remapFields(t, pendingType.next, f));
                setT(pendingType.next);
                setPendingType(null);
              }}>
                Move it
              </Btn>
              <Btn onClick={() => setPendingType(null)}>Cancel</Btn>
            </div>
          </div>
        )}
        <div id="wo" style={{ background: C.surface, border: `1px solid ${C.line}`, padding: "30px 34px" }}>
          <Body {...bodyProps} />
        </div>
      </div>
      {askClose && (
        <UnsavedPrompt
          what="work order"
          saving={saving}
          onSave={async () => { await save(false); setAskClose(false); onClose(); }}
          onDiscard={() => { setAskClose(false); onClose(); }}
          onCancel={() => setAskClose(false)}
        />
      )}
    </div>,
    document.body,
  );
}

const overlay = {
  position: "fixed", inset: 0, background: "rgba(20,28,38,0.55)",
  display: "flex", alignItems: "flex-start", justifyContent: "center",
  overflowY: "auto", zIndex: 60, padding: "24px 12px",
};
