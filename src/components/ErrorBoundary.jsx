import React from "react";
import { C } from "../theme.js";

// Last line of defence. A render error anywhere below this used to unmount the
// whole tree and leave a BLANK SCREEN — which is what 30 people saw during a
// production outage caused by one misplaced hook. A blank page tells you
// nothing and looks like the site is down; this at least says what happened and
// offers a reload.
//
// Deliberately plain: no hooks, no data access, no dependencies. It has to be
// able to render when everything else is broken.
export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // Keep it in the console so a dev/console screenshot still shows the stack.
    console.error("App crashed:", error, info?.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;

    const msg = String(this.state.error?.message || this.state.error || "Unknown error");
    return (
      <div style={wrap}>
        <div style={card}>
          <div style={{ fontSize: 15, fontWeight: 800, marginBottom: 6 }}>Something went wrong</div>
          <div style={{ fontSize: 13.5, color: C.inkSoft, lineHeight: 1.5, marginBottom: 14 }}>
            The board hit an error and stopped. Your work is saved — nothing was lost.
            Reloading usually fixes it. If it keeps happening, send this message to whoever looks after the app.
          </div>
          <div style={detail}>{msg}</div>
          <button onClick={() => window.location.reload()} style={button}>Reload the board</button>
        </div>
      </div>
    );
  }
}

const wrap = {
  minHeight: "100vh", background: C.concrete, display: "flex",
  alignItems: "flex-start", justifyContent: "center", padding: "10vh 16px",
  fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif", color: C.ink,
};
const card = {
  width: 480, maxWidth: "100%", background: C.surface,
  border: `1px solid ${C.line}`, borderLeft: `4px solid ${C.rush}`,
  borderRadius: 8, padding: "18px 20px",
};
const detail = {
  fontFamily: "ui-monospace, monospace", fontSize: 12, color: C.gray,
  background: C.concrete, border: `1px solid ${C.line}`, borderRadius: 6,
  padding: "8px 10px", marginBottom: 14, wordBreak: "break-word",
};
const button = {
  background: C.fill, color: "#fff", border: "none", borderRadius: 6,
  padding: "9px 16px", fontSize: 12, fontWeight: 800,
  textTransform: "uppercase", letterSpacing: 0.5, cursor: "pointer",
};
