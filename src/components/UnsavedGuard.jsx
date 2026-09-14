import React, { useRef, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { C } from "./../theme.js";
import { Btn } from "./ui.jsx";

// Closing a sheet with typing in it used to throw the work away without a word.
// These two pieces put a question in the way.
//
// Kept deliberately small: a snapshot of the form as it opened, a comparison
// against it, and a panel offering the three answers a person actually has —
// save it, bin it, or go back to what they were doing.

// Has anything been typed since the sheet opened? The snapshot is taken ONCE,
// on first render, so later programmatic changes (a print stamping the W/O
// date, say) are judged the same way a person's typing would be.
export function useDirty(value) {
  const initial = useRef(null);
  const snapshot = JSON.stringify(value ?? null);
  if (initial.current === null) initial.current = snapshot;
  return initial.current !== snapshot;
}

// The three-way prompt. Rendered over the sheet rather than as a browser
// confirm() so it matches everything else and can say what "discard" costs.
export function UnsavedPrompt({ what = "changes", onSave, onDiscard, onCancel, saving }) {
  return (
    <div style={overlay} onClick={onCancel}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: 420, maxWidth: "94vw", background: C.concrete, borderRadius: 8, overflow: "hidden" }}>
        <div className="flex items-center gap-2 px-4 py-3 font-bold" style={{ background: C.fill, color: "#fff" }}>
          <AlertTriangle size={17} />Unsaved {what}
        </div>
        <div className="p-4">
          <div style={{ fontSize: 13, color: C.inkSoft, marginBottom: 16 }}>
            You've typed something here that hasn't been saved. Closing now loses it.
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {onSave && (
              <Btn kind="green" onClick={onSave} disabled={saving}>{saving ? "Saving…" : "Save and close"}</Btn>
            )}
            <Btn kind="ghost" onClick={onDiscard} disabled={saving}>Discard</Btn>
            <Btn onClick={onCancel} disabled={saving}>Keep editing</Btn>
          </div>
        </div>
      </div>
    </div>
  );
}

const overlay = {
  position: "fixed", inset: 0, background: "rgba(20,28,38,0.55)",
  display: "flex", alignItems: "center", justifyContent: "center",
  zIndex: 90, padding: "24px 12px",
};
