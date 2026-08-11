import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// THIS TEST EXISTS BECAUSE OF A REAL OUTAGE (2026-08-07).
//
// A useMemo was added to App() BELOW its early returns (the loading / auth /
// CNC-only `return` statements). Signed out, an early return fired and the hook
// never ran; signed in, it did. React saw the hook count change between renders
// (minified error #310), tore down the whole tree, and every employee got a
// blank screen the moment they logged in.
//
// It's checked at the SOURCE level rather than by rendering, because the bug
// only appears once authenticated — which local/demo mode can't reproduce, and
// which is exactly why it reached production.

const HOOKS = /\b(useState|useEffect|useMemo|useCallback|useRef|useLayoutEffect|useReducer|useContext)\s*\(/;

function appSource() {
  return readFileSync(resolve(process.cwd(), "src/App.jsx"), "utf8").split("\n");
}

// Where App()'s body ends: the next top-level `function`/`const X = (` at column
// 0 after it starts. Good enough — App is the first component in the file and
// the helper components below it start at column 0.
function appBodyRange(lines) {
  const start = lines.findIndex((l) => /export default function App\s*\(/.test(l));
  expect(start, "App() should exist in src/App.jsx").toBeGreaterThan(-1);
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^(function|const)\s+[A-Za-z]/.test(lines[i])) { end = i; break; }
  }
  return [start, end];
}

describe("App() hook ordering", () => {
  it("calls no React hooks after an early return", () => {
    const lines = appSource();
    const [start, end] = appBodyRange(lines);

    // First early return inside App's body — indented `return` before the JSX
    // one, i.e. a guard clause like `if (!ready) return <Splash/>;`
    let firstReturn = -1;
    for (let i = start + 1; i < end; i++) {
      if (/^\s{2,6}return\s+</.test(lines[i])) { firstReturn = i; break; }
    }
    if (firstReturn === -1) return; // no early returns: nothing to guard

    const offenders = [];
    for (let i = firstReturn + 1; i < end; i++) {
      // Skip the component's own JSX return block — hooks can't live there
      // anyway, and prop names like onLoadEvents would false-positive.
      if (HOOKS.test(lines[i]) && !/^\s*[/*]/.test(lines[i]) && !/<[A-Z]/.test(lines[i])) {
        offenders.push(`line ${i + 1}: ${lines[i].trim().slice(0, 90)}`);
      }
    }

    expect(
      offenders,
      `Hooks must be called before App()'s early returns (first at line ${firstReturn + 1}).\n` +
        `A hook below an early return changes the hook count between the signed-out and\n` +
        `signed-in renders, which React rejects — the whole app unmounts to a blank screen.\n` +
        `Move these up with the other hooks:\n  ${offenders.join("\n  ")}`
    ).toEqual([]);
  });
});
