import React, { useState } from "react";
import { X, Bug, Lightbulb, Send, Check, AlertTriangle } from "lucide-react";
import { C } from "../../theme.js";
import { Btn } from "../ui.jsx";

// The bug button: "something's wrong" / "I have an idea", in as few taps as it
// can be done.
//
// One tap for which kind it is, one box for the words, and nothing else asked.
// Every question this could have asked — who are you, what page were you on,
// what were you holding — the app already knows, so it fills them in rather than
// making a man with dirty hands type them on a phone at the saw. A form people
// skip collects nothing.
export function FeedbackModal({ tabLabel = "", onSend, onClose }) {
  const [kind, setKind] = useState("problem");
  const [body, setBody] = useState("");
  // "Where in the app" used to be a box to fill in. It was the one question the
  // app could already answer — it knows the tab — so it asks this instead, which
  // it can't know: is this stopping you working? That's what decides whether the
  // subject line says URGENT, and it's a tap rather than typing.
  const [urgent, setUrgent] = useState(false);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState(null);

  const send = async () => {
    const text = body.trim();
    if (!text || saving) return;
    setSaving(true);
    setError(null);
    try {
      const out = await onSend({ kind, body: text, urgent });
      if (out && out.ok === false) setError(out.error || "It didn't send.");
      else setDone(true);
    } catch (e) {
      setError(String((e && e.message) || e));
    } finally {
      setSaving(false);
    }
  };

  const label = { fontSize: 11, fontWeight: 700, color: C.gray, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 };
  const inp = { border: `1px solid ${C.line}`, borderRadius: 6, fontSize: 14, background: C.surface };
  const pick = (k, Icon, text) => (
    <button
      onClick={() => setKind(k)}
      className="flex-1 flex items-center justify-center gap-2 py-3 rounded"
      style={{
        fontSize: 13, fontWeight: 800, cursor: "pointer",
        background: kind === k ? C.fill : C.surface,
        color: kind === k ? "#fff" : C.inkSoft,
        border: `1px solid ${kind === k ? C.fill : C.line}`,
      }}
    >
      <Icon size={16} />{text}
    </button>
  );

  return (
    <div style={overlay} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: 460, maxWidth: "94vw", background: C.concrete, borderRadius: 8, overflow: "hidden" }}>
        <div className="flex items-center gap-2 px-4 py-3 font-bold" style={{ background: C.fill, color: "#fff" }}>
          {done ? "Thanks — it's in" : "Report it"}
          <button onClick={onClose} className="ml-auto" style={{ color: "#fff" }}><X size={18} /></button>
        </div>

        {done ? (
          <div className="p-4">
            <div className="flex items-start gap-2" style={{ fontSize: 14 }}>
              <Check size={18} style={{ color: C.green, flexShrink: 0, marginTop: 1 }} />
              <span>
                Sent. {kind === "idea" ? "Ideas get read — the last few turned into how this board works now." : "If it's stopping you working, say so to the office too; this goes to whoever looks after the app, not to the floor."}
              </span>
            </div>
            <div className="mt-4"><Btn onClick={onClose}>Close</Btn></div>
          </div>
        ) : (
          <div className="p-4">
            <div className="flex gap-2 mb-4">
              {pick("problem", Bug, "Something's wrong")}
              {pick("idea", Lightbulb, "I have an idea")}
            </div>

            <div className="mb-3">
              <div style={label}>{kind === "idea" ? "What would help?" : "What happened?"}</div>
              <textarea
                autoFocus value={body} onChange={(e) => setBody(e.target.value)} rows={5}
                placeholder={kind === "idea"
                  ? "e.g. when I mark something done it should ask how many, we never do all of them at once"
                  : "e.g. tapped Mark ordered on the aluminium and it went back to un-ordered on its own"}
                className="w-full px-2 py-2 outline-none" style={{ ...inp, resize: "vertical" }}
              />
            </div>

            <div className="mb-4">
              <button
                onClick={() => setUrgent((v) => !v)}
                className="w-full flex items-center gap-2 px-3 py-3 rounded"
                style={{
                  fontSize: 13, fontWeight: 800, cursor: "pointer", textAlign: "left",
                  background: urgent ? C.rushBg : C.surface,
                  color: urgent ? C.rush : C.inkSoft,
                  border: `1px solid ${urgent ? C.rush : C.line}`,
                }}
              >
                <AlertTriangle size={16} style={{ flexShrink: 0 }} />
                This is stopping me working
                <span className="ml-auto" style={{ fontSize: 11, fontWeight: 700, opacity: 0.8 }}>
                  {urgent ? "URGENT" : "tap if it is"}
                </span>
              </button>
              {/* Said out loud, because a form that quietly collects things is
                  a form people stop trusting. */}
              <div style={{ fontSize: 11.5, color: C.gray, marginTop: 8 }}>
                Sent with your name, the tab you're on and your screen size — so you don't have to describe any of it.
              </div>
            </div>

            {error && (
              <div className="mb-3" style={{ fontSize: 12.5, color: C.rush, fontWeight: 700 }}>
                {error} Nothing was sent — try again in a minute.
              </div>
            )}

            <div className="flex items-center gap-2">
              <Btn kind="dark" onClick={send} disabled={saving || !body.trim()}>
                <Send size={14} />{saving ? "Sending…" : urgent ? "Send it — urgent" : "Send it"}
              </Btn>
              <Btn onClick={onClose}>Cancel</Btn>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

const overlay = {
  position: "fixed", inset: 0, background: "rgba(20,28,38,0.5)",
  display: "flex", alignItems: "flex-start", justifyContent: "center",
  overflowY: "auto", zIndex: 70, padding: "24px 12px",
};
