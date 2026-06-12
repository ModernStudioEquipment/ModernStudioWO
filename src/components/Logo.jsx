import React from "react";
import { C } from "../theme.js";
import logoUrl from "../assets/modern-logo.png";
import wordmarkUrl from "../assets/modern-wordmark.png";

// The real Modern Studio Equipment artwork — one source of truth for every logo.
// The black logo is inverted to white (CSS filter) on dark backgrounds.
const LOGO_RATIO = 1185 / 310; // full logo (MODERN + STUDIO EQUIPMENT bar)
const WORDMARK_RATIO = 1185 / 215; // MODERN wordmark only

// Full company logo — header, login.
//   variant "light" -> inverted to white for dark backgrounds
//   variant "dark"  -> black, for light backgrounds
export function Logo({ height = 30, variant = "light", style }) {
  const invert = variant === "light";
  return (
    <img
      src={logoUrl}
      alt="Modern Studio Equipment"
      style={{ height, width: height * LOGO_RATIO, display: "block", filter: invert ? "invert(1)" : "none", ...style }}
    />
  );
}

// MODERN wordmark + a label bar (e.g. "WORK ORDER") — the printed sheet letterheads,
// where the bar is the document type rather than "STUDIO EQUIPMENT".
export function Wordmark({ height = 36, variant = "dark", subText = "WORK ORDER", showSub = true, subAlign = "left" }) {
  const invert = variant === "light";
  const right = subAlign === "right";
  const subSize = Math.max(Math.round(height * 0.34), 10);
  const barBg = invert ? "#EDEBE6" : C.ink;
  const barColor = invert ? C.ink : "#FFFFFF";
  return (
    <div style={{ display: "inline-flex", flexDirection: "column", alignItems: right ? "flex-end" : "flex-start" }}>
      <img
        src={wordmarkUrl}
        alt="Modern"
        style={{ height, width: height * WORDMARK_RATIO, display: "block", filter: invert ? "invert(1)" : "none" }}
      />
      {showSub && (
        <span
          style={{
            marginTop: Math.round(height * 0.07),
            background: barBg,
            color: barColor,
            fontSize: subSize,
            fontWeight: 700,
            letterSpacing: Math.max(Math.round(subSize * 0.22), 2),
            padding: `2px ${Math.round(subSize * 0.6)}px`,
            whiteSpace: "nowrap",
          }}
        >
          {subText}
        </span>
      )}
    </div>
  );
}
