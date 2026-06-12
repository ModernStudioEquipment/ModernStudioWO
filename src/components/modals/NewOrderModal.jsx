import React, { useEffect, useState } from "react";
import { X, Plus, Trash2 } from "lucide-react";
import { C, PRIORITIES, DEPTS } from "../../theme.js";
import { DeptIcon } from "../ui.jsx";

// Manual order entry (phone orders today; Shopify auto-pull is a later phase).
// One row per product on the order — each becomes an item that gets triaged
// and routed independently.
const blankItem = () => ({ name: "", qty: 1, dept: "Shop", color: "" });

export function NewOrderModal({ getNextOrderNo, onCreate, onClose }) {
  const [orderNo, setOrderNo] = useState("");
  const [customer, setCustomer] = useState("");
  const [contact, setContact] = useState("");
  const [priority, setPriority] = useState("Normal");
  const [dueDate, setDueDate] = useState("");
  const [willCall, setWillCall] = useState(false);
  const [items, setItems] = useState([blankItem()]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    getNextOrderNo().then(setOrderNo).catch(() => setOrderNo(""));
  }, [getNextOrderNo]);

  const updItem = (i, k, v) => setItems((rows) => rows.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  const addItem = () => setItems((rows) => [...rows, blankItem()]);
  const removeItem = (i) => setItems((rows) => (rows.length > 1 ? rows.filter((_, j) => j !== i) : rows));

  const validItems = items.filter((it) => it.name.trim());
  const canSave = orderNo.trim() && customer.trim() && validItems.length && !saving;

  const submit = async () => {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      await onCreate({
        orderNo: orderNo.trim(),
        customer: customer.trim(),
        contact: contact.trim() || "—",
        priority,
        source: "phone",
        willCall,
        dueDate: dueDate || null,
        items: validItems.map((it) => ({
          name: it.name.trim(),
          qty: Number(it.qty) || 1,
          dept: it.dept,
          color: it.color.trim() || null,
        })),
      });
      onClose();
    } catch (e) {
      setError(e.message || String(e));
      setSaving(false);
    }
  };

  const inp = { border: `1px solid ${C.line}`, background: "#fff", fontSize: 13, borderRadius: 6 };
  const label = { fontSize: 10, fontWeight: 700, color: C.gray, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 };

  return (
    <div style={overlay} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: 620, maxWidth: "96vw", background: C.concrete, borderRadius: 8, overflow: "hidden" }}>
        <div className="flex items-center px-4 py-3 font-bold" style={{ background: C.ink, color: "#fff" }}>
          New order
          <button onClick={onClose} className="ml-auto" style={{ color: "#fff" }}><X size={18} /></button>
        </div>
        <div className="p-4" style={{ maxHeight: "78vh", overflowY: "auto" }}>
          <div className="grid mb-3" style={{ gridTemplateColumns: "120px 1fr 1fr", gap: 10 }}>
            <div>
              <div style={label}>Order #</div>
              <input value={orderNo} onChange={(e) => setOrderNo(e.target.value)} className="w-full px-2 py-2 outline-none" style={{ ...inp, fontFamily: "ui-monospace,monospace" }} />
            </div>
            <div>
              <div style={label}>Company *</div>
              <input value={customer} onChange={(e) => setCustomer(e.target.value)} placeholder="Apex Rentals" className="w-full px-2 py-2 outline-none" style={inp} />
            </div>
            <div>
              <div style={label}>Ordered by</div>
              <input value={contact} onChange={(e) => setContact(e.target.value)} placeholder="Dave R." className="w-full px-2 py-2 outline-none" style={inp} />
            </div>
          </div>

          <div className="flex items-center gap-4 mb-4">
            <div>
              <div style={label}>Priority</div>
              <div className="flex gap-1">
                {PRIORITIES.map((p) => (
                  <button
                    key={p}
                    onClick={() => setPriority(p)}
                    className="px-3 py-1.5 rounded text-xs font-bold uppercase tracking-wide"
                    style={priority === p
                      ? { background: C.ink, color: "#fff" }
                      : { background: "#fff", color: C.inkSoft, border: `1px solid ${C.line}` }}
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <div style={label}>Due date</div>
              <input
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="px-2 py-2 outline-none"
                style={{ ...inp, color: dueDate ? C.ink : C.gray }}
              />
            </div>
            <label className="flex items-center gap-2 mt-4" style={{ fontSize: 13, cursor: "pointer" }}>
              <input type="checkbox" checked={willCall} onChange={(e) => setWillCall(e.target.checked)} />
              Will call (customer picks up)
            </label>
          </div>

          <div style={{ ...label, marginBottom: 8 }}>Products</div>
          {items.map((it, i) => (
            <div key={i} className="flex gap-2 mb-2 items-center">
              <input
                value={it.name}
                onChange={(e) => updItem(i, "name", e.target.value)}
                placeholder="Product name"
                className="flex-1 px-2 py-2 outline-none"
                style={inp}
              />
              <input
                type="number" min="1"
                value={it.qty}
                onChange={(e) => updItem(i, "qty", e.target.value)}
                className="px-2 py-2 outline-none text-center"
                style={{ ...inp, width: 64 }}
                title="Quantity"
              />
              <div className="flex" style={{ border: `1px solid ${C.line}`, borderRadius: 6, overflow: "hidden" }}>
                {DEPTS.map((d) => (
                  <button
                    key={d}
                    onClick={() => updItem(i, "dept", d)}
                    title={d}
                    className="px-2 py-2"
                    style={it.dept === d ? { background: C.ink, color: "#fff" } : { background: "#fff", color: C.inkSoft }}
                  >
                    <DeptIcon d={d} size={14} />
                  </button>
                ))}
              </div>
              <input
                value={it.color}
                onChange={(e) => updItem(i, "color", e.target.value)}
                placeholder="Color"
                className="px-2 py-2 outline-none"
                style={{ ...inp, width: 90 }}
              />
              <button onClick={() => removeItem(i)} disabled={items.length === 1} style={{ color: items.length === 1 ? C.line : C.gray, padding: 6 }} title="Remove product">
                <Trash2 size={15} />
              </button>
            </div>
          ))}
          <button
            onClick={addItem}
            className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-bold uppercase tracking-wide mb-4"
            style={{ background: "#fff", color: C.inkSoft, border: `1px solid ${C.line}` }}
          >
            <Plus size={13} />Add product
          </button>

          {error && <div style={{ fontSize: 13, color: C.rush, marginBottom: 10 }}>{error}</div>}

          <button
            onClick={submit}
            disabled={!canSave}
            className="w-full py-2.5 rounded font-bold uppercase tracking-wide"
            style={{ background: C.ink, color: "#fff", opacity: canSave ? 1 : 0.5 }}
          >
            {saving ? "Saving…" : "Create order"}
          </button>
        </div>
      </div>
    </div>
  );
}

const overlay = {
  position: "fixed", inset: 0, background: "rgba(20,28,38,0.45)",
  display: "flex", alignItems: "flex-start", justifyContent: "center",
  overflowY: "auto", zIndex: 60, padding: "24px 12px",
};
