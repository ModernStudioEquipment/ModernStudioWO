import { describe, it, expect } from "vitest";
import { fmtDate, materialKey, totalAmounts, elapsed, stamp } from "../theme.js";

// Pure helpers that quietly drive real decisions on the board — a wrong answer
// here shows up as a wrong date on a work order or two materials that should
// have been bought together being ordered twice.

describe("fmtDate — one format everywhere (MM/DD/YYYY)", () => {
  it("zero-pads month and day", () => {
    expect(fmtDate("2026-01-05")).toBe("01/05/2026");
  });
  it("reads a due-date string at LOCAL midnight so the day never shifts", () => {
    expect(fmtDate("2026-06-20")).toBe("06/20/2026");
  });
  it("accepts timestamps and Date objects", () => {
    expect(fmtDate(new Date(2026, 7, 5, 14, 34).getTime())).toBe("08/05/2026");
    expect(fmtDate(new Date(2026, 11, 31))).toBe("12/31/2026");
  });
  it("returns empty for empty input rather than 'Invalid Date'", () => {
    expect(fmtDate("")).toBe("");
    expect(fmtDate(null)).toBe("");
    expect(fmtDate(undefined)).toBe("");
  });
});

describe("materialKey — group the same material typed differently", () => {
  const same = (a, b) => expect(materialKey(a)).toBe(materialKey(b));
  const diff = (a, b) => expect(materialKey(a)).not.toBe(materialKey(b));

  it('treats 1in / 1" / 1 inch as the same material', () => {
    same("1in aluminum bar", '1" aluminum bar');
    same("1in aluminum bar", "1 in aluminum bar");
    same("1in aluminum bar", "1inch aluminum bar");
    same("1in aluminum bar", "1 inch aluminum bar");
  });
  it("ignores case and extra spacing", () => {
    same("1in aluminum bar", "1IN  Aluminum   Bar");
  });
  it("handles feet the same way", () => {
    same("6ft rail", "6' rail");
    same("6ft rail", "6 feet rail");
  });
  // The dangerous case: fractions must NOT collapse into whole numbers, or a
  // half-inch bar would be treated as a 12-inch bar and bought wrong.
  it('never confuses 1/2" with 12"', () => {
    diff('1/2" bar', '12" bar');
  });
  it("keeps genuinely different materials apart", () => {
    diff("1in bar", "2in bar");
    diff("aluminum bar", "aluminum tube");
    diff("winch cable", "win cable");
  });
});

describe("totalAmounts — add up free-text quantities", () => {
  it("sums matching units", () => {
    expect(totalAmounts(["20 ft", "12 ft"])).toBe("32 ft");
  });
  it("keeps different units apart instead of adding nonsense", () => {
    expect(totalAmounts(["20 ft", "2 sheets"])).toContain("20 ft");
    expect(totalAmounts(["20 ft", "2 sheets"])).toContain("2 sheets");
  });
  it("handles bare numbers", () => {
    expect(totalAmounts(["12", "8"])).toBe("20");
  });
  it("carries unparseable text through rather than silently dropping it", () => {
    expect(totalAmounts(["a box"])).toContain("a box");
  });
});

describe("elapsed / stamp — never show a negative age", () => {
  // The `now` tick only refreshes every 30s, so a just-happened event can
  // compute a negative age. It used to render as "-1m ago".
  it("clamps negative durations", () => {
    expect(elapsed(-60000)).toBe("0m");
  });
  it("says 'just now' under a minute", () => {
    const t = Date.now();
    expect(stamp(t, t)).toContain("just now");
  });
  it("includes both the date and the age", () => {
    const t = new Date(2026, 7, 5, 14, 34).getTime();
    const out = stamp(t, t + 2 * 60 * 60 * 1000);
    expect(out).toContain("08/05/2026");
    expect(out).toContain("ago");
  });
});
