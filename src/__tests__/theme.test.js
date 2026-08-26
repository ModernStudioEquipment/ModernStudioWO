import { describe, it, expect } from "vitest";
import { fmtDate, materialKey, totalAmounts, elapsed, stamp, quoteNoteFor, numQty, pickedUpLabel } from "../theme.js";

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

// A purchasing note describes ONE material. Quote-requesting a whole order used
// to write the same note onto every material on it, and confirming with an empty
// box wrote null over all of them. Both destroyed what people had typed — on the
// live board a note reading "Claycoat is for an order that is awaiting approval"
// ended up sitting on 13 unrelated materials.
describe("quoteNoteFor — a note stays on its own material", () => {
  const withNote = { note: "asked Tube Service for 20ft" };
  const blank = { note: null };

  describe("one material at a time — it's that material's own note", () => {
    it("writes what was typed", () => {
      expect(quoteNoteFor("new note", withNote, true)).toBe("new note");
    });
    it("allows clearing it", () => {
      expect(quoteNoteFor(null, withNote, true)).toBe(null);
    });
  });

  describe("whole order at once — never disturb what's already written", () => {
    it("fills in a material that has no note", () => {
      expect(quoteNoteFor("chasing all of these", blank, false)).toBe("chasing all of these");
    });
    it("LEAVES an existing note alone instead of overwriting it", () => {
      expect(quoteNoteFor("chasing all of these", withNote, false)).toBeUndefined();
    });
    it("never erases notes when the box is left empty", () => {
      expect(quoteNoteFor(null, withNote, false)).toBeUndefined();
      expect(quoteNoteFor("", withNote, false)).toBeUndefined();
      expect(quoteNoteFor(null, blank, false)).toBeUndefined();
    });
    it("treats a missing material safely", () => {
      expect(quoteNoteFor("x", undefined, false)).toBe("x");
    });
  });
});

// A partly-collected order used to look untouched: the products still showed
// their full ordered quantity, and only the fulfillment card's order-level badge
// knew anything had gone out.
describe("pickedUpLabel — how much of a line has actually left", () => {
  const item = (qty, out) => ({ qty, fulfilledQty: out });

  it("says nothing when nothing has gone out", () => {
    expect(pickedUpLabel(item("20", 0), "willcall")).toBe(null);
    expect(pickedUpLabel(item("20", undefined), "willcall")).toBe(null);
  });

  it("counts a partial collection against what was ordered", () => {
    expect(pickedUpLabel(item("20", 8), "willcall")).toBe("8 of 20 picked up");
  });

  it("says so plainly once the whole line is out", () => {
    expect(pickedUpLabel(item("20", 20), "willcall")).toBe("all 20 picked up");
    expect(pickedUpLabel(item("20", 25), "willcall")).toBe("all 20 picked up"); // over-collected still reads done
  });

  it("uses the right word for a shipment", () => {
    expect(pickedUpLabel(item("10", 4), "shipping")).toBe("4 of 10 shipped");
    expect(pickedUpLabel(item("10", 10), "shipping")).toBe("all 10 shipped");
  });

  it("treats an unparseable quantity as one rather than zero", () => {
    // "12 ea" parses to 12; a bare word can't, and 0 would make every line
    // instantly read as fully out.
    expect(numQty("12 ea")).toBe(12);
    expect(numQty("a box")).toBe(1);
    expect(numQty(null)).toBe(1);
    expect(pickedUpLabel(item("a box", 1), "willcall")).toBe("all 1 picked up");
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
