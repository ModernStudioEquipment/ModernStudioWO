import React, { useState } from "react";
import { C } from "../theme.js";
import { Logo } from "./Logo.jsx";

// Email/password login for the office. Internal tool — any authenticated user
// can see and act on the whole board. Finer-grained roles can layer on later.
export function Auth({ auth }) {
  const [mode, setMode] = useState("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      if (mode === "signin") {
        await auth.signIn(email, password);
      } else {
        await auth.signUp(email, password);
        setNotice("Account created. If email confirmation is on, check your inbox, then sign in.");
        setMode("signin");
      }
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setBusy(false);
    }
  };

  const inp = { border: `1px solid ${C.line}`, background: "#fff", fontSize: 14, borderRadius: 6 };

  return (
    <div style={{ background: C.ink, minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div style={{ width: 360, maxWidth: "94vw" }}>
        <div className="mb-6 text-center">
          <Logo height={42} variant="light" />
        </div>
        <form onSubmit={submit} style={{ background: C.concrete, borderRadius: 8, padding: 20 }}>
          <div className="font-bold mb-3" style={{ fontSize: 15 }}>
            {mode === "signin" ? "Sign in" : "Create account"}
          </div>
          <input
            type="email" required placeholder="you@modern.com" value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full px-3 py-2 mb-2 outline-none" style={inp}
          />
          <input
            type="password" required placeholder="Password" value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full px-3 py-2 mb-3 outline-none" style={inp}
          />
          {error && <div style={{ fontSize: 13, color: C.rush, marginBottom: 10 }}>{error}</div>}
          {notice && <div style={{ fontSize: 13, color: C.green, marginBottom: 10 }}>{notice}</div>}
          <button
            type="submit" disabled={busy}
            className="w-full py-2.5 rounded font-bold uppercase tracking-wide"
            style={{ background: C.ink, color: "#fff", opacity: busy ? 0.6 : 1 }}
          >
            {busy ? "…" : mode === "signin" ? "Sign in" : "Sign up"}
          </button>
          <button
            type="button"
            onClick={() => { setMode(mode === "signin" ? "signup" : "signin"); setError(null); setNotice(null); }}
            className="w-full mt-3"
            style={{ fontSize: 13, color: C.blue, background: "none", border: "none", cursor: "pointer" }}
          >
            {mode === "signin" ? "Need an account? Sign up" : "Have an account? Sign in"}
          </button>
        </form>
      </div>
    </div>
  );
}
