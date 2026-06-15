import React from "react";
import { X, Camera, Check, ImagePlus } from "lucide-react";
import { C } from "../../theme.js";
import { Btn, Info } from "../ui.jsx";

// Picker confirmation view. Shows the item's product photo (auto-pulled from
// Shopify when available, or pasted manually here) and the "Item picked" action.
export function PickPhoto({ order, item, onPicked, onSetImage, onSetNote, onClose }) {
  const [saving, setSaving] = React.useState(false);
  const [url, setUrl] = React.useState(item.imageUrl || "");
  const [savingImg, setSavingImg] = React.useState(false);
  const [broken, setBroken] = React.useState(false);
  const [note, setNote] = React.useState(item.note || "");
  const [savingNote, setSavingNote] = React.useState(false);

  const pick = async () => {
    if (saving) return;
    setSaving(true);
    try { await onPicked(); } finally { setSaving(false); }
  };
  const saveImage = async () => {
    if (!onSetImage || savingImg) return;
    setSavingImg(true);
    try { await onSetImage(url.trim() || null); } finally { setSavingImg(false); }
  };
  const saveNote = async () => {
    if (!onSetNote || savingNote) return;
    setSavingNote(true);
    try { await onSetNote(note.trim() || null); } finally { setSavingNote(false); }
  };
  const noteDirty = (note.trim() || "") !== (item.note || "");

  const hasImg = url && !broken;
  return (
    <div style={overlay} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: 480, maxWidth: "94vw", background: C.concrete, borderRadius: 8, overflow: "hidden" }}>
        <div className="flex items-center gap-3 px-4 py-3" style={{ background: C.ink, color: "#fff" }}>
          <span className="font-bold" style={{ fontSize: 15 }}>{item.name}</span>
          <span style={{ fontFamily: "ui-monospace,monospace", color: "rgba(255,255,255,0.7)" }}>×{item.qty}</span>
          <button onClick={onClose} className="ml-auto" style={{ color: "#fff" }}><X size={18} /></button>
        </div>
        <div className="p-4">
          <div className="flex items-center justify-center" style={{ minHeight: 300, border: `1px ${hasImg ? "solid" : "dashed"} ${C.line}`, borderRadius: 6, background: "#fff", overflow: "hidden", color: C.gray }}>
            {hasImg ? (
              <img src={url} alt={item.name} onError={() => setBroken(true)} style={{ maxWidth: "100%", maxHeight: 300, objectFit: "contain" }} />
            ) : (
              <div className="flex items-center justify-center" style={{ flexDirection: "column", gap: 8, padding: 16, textAlign: "center" }}>
                <Camera size={44} />
                <div style={{ fontSize: 14, fontWeight: 700, color: C.ink }}>Photo of {item.name}</div>
                <div style={{ fontSize: 12 }}>{broken ? "Couldn't load that image URL." : "No photo yet — paste one below, or it auto-loads from Shopify for new orders."}</div>
              </div>
            )}
          </div>

          {onSetImage && (
            <div className="flex items-center gap-2 mt-3">
              <input
                value={url}
                onChange={(e) => { setUrl(e.target.value); setBroken(false); }}
                placeholder="Paste an image URL…"
                className="flex-1 px-2 py-2 outline-none"
                style={{ border: `1px solid ${C.line}`, borderRadius: 6, fontSize: 13, background: "#fff" }}
              />
              <Btn onClick={saveImage} disabled={savingImg}><ImagePlus size={14} />{savingImg ? "Saving…" : "Save photo"}</Btn>
            </div>
          )}

          {onSetNote && (
            <div className="mt-4">
              <div style={{ fontSize: 11, fontWeight: 700, color: C.gray, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 }}>Notes</div>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Leave a note for whoever picks this — e.g. 'grab the blue ones from the back shelf'"
                rows={3}
                className="w-full px-2 py-2 outline-none"
                style={{ border: `1px solid ${C.line}`, borderRadius: 6, fontSize: 13, background: "#fff", resize: "vertical" }}
              />
              <div className="flex justify-end mt-2">
                <Btn onClick={saveNote} disabled={savingNote || !noteDirty}>{savingNote ? "Saving…" : "Save note"}</Btn>
              </div>
            </div>
          )}

          <div className="grid mt-4 mb-4" style={{ gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
            <Info label="Pick qty" value={`×${item.qty}`} />
            <Info label="Dept" value={item.dept} />
            <Info label="For" value={`#${order.orderNo} · ${order.customer}`} />
          </div>
          <Btn kind="brass" onClick={pick} disabled={saving}>
            <Check size={15} />{saving ? "Saving…" : "Item picked"}
          </Btn>
        </div>
      </div>
    </div>
  );
}

const overlay = {
  position: "fixed", inset: 0, background: "rgba(20,20,20,0.5)",
  display: "flex", alignItems: "flex-start", justifyContent: "center",
  overflowY: "auto", zIndex: 60, padding: "24px 12px",
};
