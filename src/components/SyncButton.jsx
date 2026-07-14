import React from "react";
import { C } from "../theme.js";

// The QuickBooks "qb" mark: a green circle with the white monogram. The qb path
// (drawn with even-odd fill so the letters punch through to the white backing)
// comes from the open-source QuickBooks brand icon.
const QB_PATH =
  "M12 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0zm.642 4.1335c.9554 0 1.7296.776 1.7296 1.7332v9.0667h1.6c1.614 0 2.9275-1.3156 2.9275-2.933 0-1.6173-1.3136-2.9333-2.9276-2.9333h-.6654V7.3334h.6654c2.5722 0 4.6577 2.0897 4.6577 4.667 0 2.5774-2.0855 4.6666-4.6577 4.6666H12.642zM7.9837 7.333h3.3291v12.533c-.9555 0-1.73-.7759-1.73-1.7332V9.0662H7.9837c-1.6146 0-2.9277 1.316-2.9277 2.9334 0 1.6175 1.3131 2.9333 2.9277 2.9333h.6654v1.7332h-.6654c-2.5725 0-4.6577-2.0892-4.6577-4.6665 0-2.5771 2.0852-4.6666 4.6577-4.6666Z";

const QB_GREEN = "#2CA01C";

export function QuickBooksLogo({ size = 22 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" style={{ display: "block" }}>
      <circle cx="12" cy="12" r="11.5" fill="#fff" />
      <path d={QB_PATH} fill={QB_GREEN} fillRule="evenodd" clipRule="evenodd" />
    </svg>
  );
}

// Sync button: the QuickBooks logo with a ring of sync arrows around it. The
// arrows spin while a sync is running (driven by `syncing`).
export function SyncButton({ syncing, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={syncing}
      title={syncing ? "Syncing QuickBooks…" : "Sync QuickBooks"}
      aria-label={syncing ? "Syncing QuickBooks" : "Sync QuickBooks"}
      className="relative inline-flex items-center justify-center shrink-0"
      style={{ width: 44, height: 44, borderRadius: 22, border: `1px solid ${C.line}`, background: C.surface, cursor: syncing ? "default" : "pointer", padding: 0 }}
    >
      {/* the arrows ring around the logo — a custom two-arc sync ring (lucide
          RefreshCw with smaller arrowhead ends, 3-unit legs vs 5); spins on sync */}
      <svg
        width={40}
        height={40}
        viewBox="0 0 24 24"
        fill="none"
        stroke={QB_GREEN}
        strokeWidth={1.7}
        strokeLinecap="round"
        strokeLinejoin="round"
        className={syncing ? "animate-spin" : ""}
        style={{ position: "absolute", opacity: 0.9 }}
        aria-hidden="true"
      >
        <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
        <path d="M21 5v3h-3" />
        <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
        <path d="M3 19v-3h3" />
      </svg>
      <QuickBooksLogo size={21} />
    </button>
  );
}
