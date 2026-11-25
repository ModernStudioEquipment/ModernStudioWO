// @vitest-environment node
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

// THIS TEST EXISTS BECAUSE OF A REAL BUG (live 2026-11-17 to 11-24).
//
// Floor Control tags <body> with a class while it's open, so sheets that portal
// to <body> can be lifted above it. The class was named "fc-open", which was
// already the Open live monitor button's class. So the whole page took on that
// button's rules, and at phone width the button's `display:none` hid the entire
// app the moment Floor Control opened.
//
// The rule: a class put on <body> may only ever appear in CSS as `body.<class>`.

const SRC = resolve(process.cwd(), "src");
const walk = (dir) => readdirSync(dir).flatMap((f) => {
  const p = join(dir, f);
  return statSync(p).isDirectory() ? walk(p) : [p];
});
const files = walk(SRC);
const read = (p) => readFileSync(p, "utf8");

describe("classes put on <body>", () => {
  const added = files
    .filter((p) => /\.(jsx?|tsx?)$/.test(p) && !p.includes("__tests__"))
    .flatMap((p) => [...read(p).matchAll(/document\.body\.classList\.add\(\s*["'`]([\w-]+)["'`]/g)].map((m) => m[1]));
  const css = files.filter((p) => p.endsWith(".css")).map((p) => ({ p, text: read(p).replace(/\/\*[\s\S]*?\*\//g, "") }));

  it("there is at least one, or this test is checking nothing", () => {
    expect(added.length).toBeGreaterThan(0);
  });

  it.each(added.map((c) => [c]))("“%s” is styled nowhere except as body.%s", (cls) => {
    const bare = new RegExp(`(^|[^\\w-])\\.${cls}(?![\\w-])`, "g");
    for (const { p, text } of css) {
      for (const m of text.matchAll(bare)) {
        const before = text.slice(Math.max(0, m.index - 4), m.index + m[1].length);
        expect(/body$/.test(before), `${p.replace(SRC, "src")} styles .${cls} as something other than <body>`).toBe(true);
      }
    }
  });
});
