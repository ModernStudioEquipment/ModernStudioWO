import React, { useEffect, useRef, useState } from "react";
import { X, Bug, Lightbulb, Send, Check, AlertTriangle } from "lucide-react";
import { C, fmtDate, groupFeedback } from "../../theme.js";
import { Btn } from "../ui.jsx";

// The bug button: "something's wrong" / "I have an idea", in as few taps as it
// can be done.
//
// One tap for which kind it is, one box for the words, and nothing else asked.
// Every question this could have asked — who are you, what page were you on,
// what were you holding — the app already knows, so it fills them in rather than
// making a man with dirty hands type them on a phone at the saw. A form people
// skip collects nothing.
export function FeedbackModal({ tabLabel = "", onSend, onList, onResolve, onClose }) {
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
  // What's already been reported, so nobody files the same thing twice and
  // everybody can see that reporting one leads somewhere.
  const [reports, setReports] = useState(null);
  const listRef = useRef(onList);
  listRef.current = onList;
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const rows = listRef.current ? await listRef.current() : [];
        if (alive) setReports(groupFeedback(rows || []));
      } catch {
        if (alive) setReports({ open: [], fixed: [], openTotal: 0 });
      }
    })();
    return () => { alive = false; };
  }, []);

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
              {/* No explaining where it went — everyone here knows. Just that it
                  arrived, and that an urgent one went as urgent. */}
              <span>
                {kind === "idea"
                  ? "Sent. Ideas get read — a few of them are why the board works the way it does now."
                  : urgent
                  ? "Sent, marked urgent."
                  : "Sent — thanks for flagging it."}
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

            <ReportList reports={reports} onResolve={onResolve} onDone={(id, note, by) => setReports((r) => closeLocally(r, id, note, by))} />
          </div>
        )}
      </div>
    </div>
  );
}

// Two short lists: what's still open, and what's been dealt with lately.
// Move a report from the open list to the fixed one without a round trip.
function closeLocally(reports, id, note, by) {
  if (!reports) return reports;
  const row = reports.open.find((r) => r.id === id);
  if (!row) return reports;
  return {
    ...reports,
    open: reports.open.filter((r) => r.id !== id),
    openTotal: Math.max(0, reports.openTotal - 1),
    fixed: [{ ...row, fixedAt: new Date().toISOString(), fixedNote: note, fixedBy: by || "you" }, ...reports.fixed],
  };
}

function ReportList({ reports, onResolve, onDone }) {
  // Which report is being closed, and what's being typed about it.
  const [closing, setClosing] = useState(null);
  const [fixNote, setFixNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState(null);

  const resolve = async (r) => {
    const note = fixNote.trim();
    if (!note || busy || !onResolve) return;
    setBusy(true);
    try {
      const out = await onResolve(r.id, note);
      if (out && out.ok === false) { setSaid(out.error || "It didn't send."); return; }
      setSaid(out && out.emailed === false ? (out.why || "Closed. Nobody was emailed.") : `Closed, and ${r.author || "they"} ${out && out.to ? `(${out.to}) ` : ""}told.`);
      setClosing(null);
      setFixNote("");
      onDone(r.id, note, (out && out.by) || null);
    } finally {
      setBusy(false);
    }
  };

  if (!reports) return null;                       // still loading
  const head = { fontSize: 10.5, fontWeight: 800, color: C.gray, textTransform: "uppercase", letterSpacing: 0.6, margin: "14px 0 6px" };
  const meta = { fontSize: 11, color: C.gray };

  // Say so rather than showing a blank space: "nothing reported" and "this
  // panel is broken" must not look the same.
  if (!reports.open.length && !reports.fixed.length) {
    return (
      <div style={{ borderTop: `1px solid ${C.line}`, marginTop: 18, paddingTop: 12, fontSize: 12, color: C.gray }}>
        Nothing reported yet. Anything sent from here shows up in this list.
      </div>
    );
  }

  return (
    <div style={{ borderTop: `1px solid ${C.line}`, marginTop: 18, paddingTop: 4, maxHeight: 240, overflowY: "auto" }}>
      {!!reports.open.length && (
        <>
          <div style={head}>Waiting on a fix · {reports.openTotal}</div>
          {reports.open.map((r) => (
            <div key={r.id} className="flex items-start gap-2" style={{ marginBottom: 8 }}>
              {r.kind === "idea"
                ? <Lightbulb size={13} style={{ color: C.gold, flexShrink: 0, marginTop: 2 }} />
                : <Bug size={13} style={{ color: r.urgent ? C.rush : C.inkSoft, flexShrink: 0, marginTop: 2 }} />}
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 12.5 }}>{r.body}</div>
                <div style={meta}>
                  {r.author || "someone"}{r.at ? ` · ${fmtDate(r.at)}` : ""}
                  {r.urgent ? " · urgent" : ""}
                  {onResolve && closing !== r.id && (
                    <button
                      onClick={() => { setClosing(r.id); setFixNote(""); setSaid(null); }}
                      style={{ marginLeft: 8, background: "none", border: "none", padding: 0, cursor: "pointer",
                        color: C.green, fontSize: 11, fontWeight: 700, textDecoration: "underline" }}
                    >
                      fixed it
                    </button>
                  )}
                </div>
                {closing === r.id && (
                  <div className="flex items-center gap-2" style={{ marginTop: 6 }}>
                    <input
                      autoFocus value={fixNote} onChange={(e) => setFixNote(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") resolve(r); if (e.key === "Escape") setClosing(null); }}
                      placeholder="What you did — they get sent this"
                      className="px-2 py-1 outline-none"
                      style={{ flex: 1, minWidth: 0, border: `1px solid ${C.line}`, borderRadius: 6, fontSize: 12.5, background: C.surface }}
                    />
                    <button onClick={() => resolve(r)} disabled={busy || !fixNote.trim()}
                      style={{ border: "none", borderRadius: 6, padding: "5px 10px", fontSize: 11.5, fontWeight: 800,
                        background: C.fill, color: "#fff", cursor: "pointer", opacity: busy || !fixNote.trim() ? 0.5 : 1 }}>
                      {busy ? "…" : "Send"}
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
          {said && <div style={{ fontSize: 11.5, color: C.gray, marginBottom: 8 }}>{said}</div>}
        </>
      )}

      {!!reports.fixed.length && (
        <>
          <div style={head}>Fixed</div>
          {reports.fixed.map((r) => (
            <div key={r.id} className="flex items-start gap-2" style={{ marginBottom: 8 }}>
              <Check size={13} style={{ color: C.green, flexShrink: 0, marginTop: 2 }} />
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 12.5, color: C.gray, textDecoration: "line-through" }}>{r.body}</div>
                {/* Set in from the report and ruled down the side, so the answer
                    reads as an answer rather than as more of the complaint. */}
                {r.fixedNote ? (
                  <div style={{ marginTop: 4, paddingLeft: 9, borderLeft: `2px solid ${C.green}` }}>
                    <div style={{ fontSize: 12.5 }}>{r.fixedNote}</div>
                    <div style={meta}>
                      {r.fixedBy || "someone"} replied{r.fixedAt ? ` · ${fmtDate(r.fixedAt)}` : ""}
                    </div>
                  </div>
                ) : (
                  <div style={meta}>
                    Closed by {r.fixedBy || "someone"}{r.fixedAt ? ` · ${fmtDate(r.fixedAt)}` : ""}
                  </div>
                )}
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  );
}

const overlay = {
  position: "fixed", inset: 0, background: "rgba(20,28,38,0.5)",
  display: "flex", alignItems: "flex-start", justifyContent: "center",
  overflowY: "auto", zIndex: 70, padding: "24px 12px",
};
