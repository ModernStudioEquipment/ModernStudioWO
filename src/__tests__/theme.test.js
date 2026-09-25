import { describe, it, expect } from "vitest";
import { fmtDate, materialKey, totalAmounts, elapsed, stamp, quoteNoteFor, numQty, pickedUpLabel, whereIsItem, noteAuthorName, noteStamp, noteTrailOf, amountShort, addAmounts, materialShort, shortLabel, groupFeedback } from "../theme.js";

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

// A received material drops off Purchasing, and the person who runs purchasing
// then can't tell where the product went. This is the answer that gets shown.
describe("whereIsItem — where a product actually is now", () => {
  const item = (stage) => ({ stage });

  it("names the tab a live product is sitting in", () => {
    expect(whereIsItem(item("picklist"), {})).toBe("Pick List");
    expect(whereIsItem(item("workorder"), {})).toBe("Work Order");
    expect(whereIsItem(item("awaiting"), {})).toBe("Purchasing");
    expect(whereIsItem(item("done"), {})).toBe("Done");
  });

  // Once the order has left, the item's stage is stale — "Work Order" would be
  // a lie about a box that is already on a truck.
  it("prefers the order's fate over a stale item stage", () => {
    expect(whereIsItem(item("workorder"), { fulfillment: "willcall" })).toBe("Will Call");
    expect(whereIsItem(item("workorder"), { fulfillment: "shipping" })).toBe("Shipping");
    expect(whereIsItem(item("workorder"), { fulfillment: "shipping", trackingNumber: "1Z999" })).toBe("Shipped");
    expect(whereIsItem(item("workorder"), { fulfillment: "willcall", pickedUpAt: "2026-08-01" })).toBe("Picked up");
  });

  it("says cancelled above everything else", () => {
    expect(whereIsItem(item("done"), { cancelledAt: "2026-08-01", trackingNumber: "1Z999" })).toBe("Cancelled");
  });

  it("never renders blank", () => {
    expect(whereIsItem({}, {})).toBe("—");
    expect(whereIsItem(undefined, undefined)).toBe("—");
  });
});

// On a board 30 people share, an anonymous note is only half useful — you can't
// tell who to ask about it, and a note someone quietly rewrote read exactly like
// the original.
describe("noteAuthorName — who gets recorded", () => {
  it("reads a name out of the work email", () => {
    expect(noteAuthorName({ email: "anoush@modernstudio.com" })).toBe("Anoush");
    expect(noteAuthorName({ email: "rosy@modernstudio.com" })).toBe("Rosy");
  });
  it("handles first.last style addresses", () => {
    expect(noteAuthorName({ email: "maddox.leach@modernstudio.com" })).toBe("Maddox Leach");
    expect(noteAuthorName({ email: "jean-luc@modernstudio.com" })).toBe("Jean Luc");
  });
  it("prefers a real name when the account has one", () => {
    expect(noteAuthorName({ email: "a@b.com", user_metadata: { name: "Anoush K." } })).toBe("Anoush K.");
  });
  it("returns null rather than a blank byline", () => {
    expect(noteAuthorName(null)).toBe(null);
    expect(noteAuthorName({})).toBe(null);
  });
});

describe("noteStamp — first author kept, later edits recorded separately", () => {
  const AT = "2026-08-26T21:00:00.000Z";

  it("records the author when a note is first written", () => {
    expect(noteStamp(null, "call vendor back", "Rosy", AT))
      .toEqual({ by: "Rosy", at: AT, editedBy: null, editedAt: null });
  });

  it("records an EDIT without losing who wrote it originally", () => {
    // no `by`/`at` in the patch, so the original author column is left alone
    expect(noteStamp("call vendor back", "vendor called back", "Anoush", AT))
      .toEqual({ editedBy: "Anoush", editedAt: AT });
  });

  it("does nothing when the text hasn't actually changed", () => {
    // opening a note and saving without typing must not fake an edit
    expect(noteStamp("same words", "same words", "Rosy", AT)).toBe(null);
    expect(noteStamp("same words", "  same words  ", "Rosy", AT)).toBe(null);
    expect(noteStamp(null, "", "Rosy", AT)).toBe(null);
  });

  it("clears the byline when the note is deleted, so the next one starts fresh", () => {
    expect(noteStamp("old note", "", "Rosy", AT))
      .toEqual({ by: null, at: null, editedBy: null, editedAt: null });
  });

  it("still stamps when nobody is identified", () => {
    expect(noteStamp(null, "written by an unknown login", null, AT))
      .toEqual({ by: null, at: AT, editedBy: null, editedAt: null });
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

describe("noteTrailOf — every note a material has, never just the newest", () => {
  // Reported: "the original note for the product should stay there". It always
  // did in the data; the row only ever rendered ONE note, so adding a second
  // looked like it had replaced the first.
  const log = [
    { id: "a", body: "back-ordered until 10/2", author: "Jiro", at: "2026-09-11T19:34:00Z" },
    { id: "b", body: "IMS called — shipping 10/6", author: "Jiro", at: "2026-09-14T18:55:00Z" },
  ];

  it("keeps every logged note, oldest first", () => {
    const out = noteTrailOf({ noteLog: log, note: "IMS called — shipping 10/6" });
    expect(out.map((n) => n.body)).toEqual([
      "back-ordered until 10/2",
      "IMS called — shipping 10/6",
    ]);
  });

  it("doesn't repeat the newest note just because the mirrored column also has it", () => {
    const out = noteTrailOf({ noteLog: log, note: "IMS called — shipping 10/6" });
    expect(out).toHaveLength(2);
  });

  // The quote and mark-ordered popups write the material's own note column.
  // Showing only the log would hide anything typed in either of them.
  it("shows a note written straight to the column, with its byline", () => {
    const out = noteTrailOf({ noteLog: log, note: "picked it up at the counter", noteBy: "Anoush", noteAt: "2026-09-14T19:58:00Z" });
    expect(out).toHaveLength(3);
    expect(out[2]).toMatchObject({ body: "picked it up at the counter", author: "Anoush" });
  });

  it("falls back to the column alone for notes older than the log", () => {
    expect(noteTrailOf({ note: "asked Tube Service for 20ft", noteBy: "Jiro" })).toHaveLength(1);
  });

  it("puts an older note folded in later back in its place", () => {
    // A note that only lived in the mirrored column gets appended to the log the
    // next time somebody adds one — but it was written first, so it reads first.
    const out = noteTrailOf({
      noteLog: [...log, { id: "c", body: "old flow note", author: "Jiro", at: "2026-09-10T12:00:00Z" }],
      note: "old flow note",
    });
    expect(out.map((n) => n.body)[0]).toBe("old flow note");
  });

  it("is empty when there is nothing to show", () => {
    expect(noteTrailOf({})).toEqual([]);
    expect(noteTrailOf()).toEqual([]);
    expect(noteTrailOf({ note: "   " })).toEqual([]);
  });
});

describe("short deliveries — what's still owed on a material", () => {
  // Reported: a partly-received line vanished from Purchasing as though it were
  // settled. This arithmetic decides whether it stays, so a wrong answer either
  // strands a finished line on the list or loses the missing 8 ft again.

  it("reports what's left when less arrived than was ordered", () => {
    expect(amountShort("20 ft", "12 ft")).toMatchObject({ left: 8, unit: "ft" });
    expect(shortLabel(amountShort("20 ft", "12 ft"))).toBe("8 ft");
  });

  it("says nothing when it's all in — or more than all", () => {
    expect(amountShort("20 ft", "20 ft")).toBeNull();
    expect(amountShort("20 ft", "24 ft")).toBeNull();
  });

  it("treats a missing unit on one side as the same unit", () => {
    expect(amountShort("20 ft", "12")).toMatchObject({ left: 8, unit: "ft" });
    expect(amountShort("20", "12 ft")).toMatchObject({ left: 8 });
  });

  // Free text is free text. Claiming a shortfall out of amounts it can't read
  // would put a red "still waiting" on every odd line in the shop.
  it("refuses to guess across different units or unreadable amounts", () => {
    expect(amountShort("20 ft", "12 in")).toBeNull();
    expect(amountShort("a skid", "most of it")).toBeNull();
    expect(amountShort("20 ft", "")).toBeNull();
    expect(amountShort(null, "12 ft")).toBeNull();
  });

  it("adds a second delivery to the first", () => {
    expect(addAmounts("12 ft", "8 ft")).toBe("20 ft");
    expect(addAmounts(null, "12 ft")).toBe("12 ft");
    expect(addAmounts("", "12 ft")).toBe("12 ft");
    expect(addAmounts("12", "8")).toBe("20");
  });

  it("won't add what it can't add", () => {
    expect(addAmounts("12 ft", "8 in")).toBeNull();
    expect(addAmounts("a skid", "8 ft")).toBeNull();
    expect(addAmounts("12 ft", "")).toBeNull();
  });

  // 12 of 20 arrives, then 8 more: the line must close, not stay red forever.
  it("closes the line once the deliveries add up", () => {
    const first = addAmounts(null, "12 ft");
    expect(amountShort("20 ft", first)).toMatchObject({ left: 8 });
    const second = addAmounts(first, "8 ft");
    expect(amountShort("20 ft", second)).toBeNull();
  });

  it("measures against what was ORDERED, not what was asked for", () => {
    // Asked for 20, deliberately ordered 12, all 12 came: nothing is owed.
    expect(materialShort({ amount: "20 ft", orderedQty: "12 ft", receivedQty: "12 ft" })).toBeNull();
    // Ordered 12, only 5 came.
    expect(materialShort({ amount: "20 ft", orderedQty: "12 ft", receivedQty: "5 ft" })).toMatchObject({ left: 7 });
  });

  it("is silent until something has actually been received", () => {
    expect(materialShort({ amount: "20 ft" })).toBeNull();
    expect(materialShort({ amount: "20 ft", receivedQty: null })).toBeNull();
  });
});

describe("groupFeedback — the list under the bug button", () => {
  const r = (over) => ({ id: over.id, body: over.id, at: over.at || "2026-09-20T12:00:00Z", ...over });

  it("puts urgent reports at the top of the open ones", () => {
    const { open } = groupFeedback([
      r({ id: "old", at: "2026-09-01T12:00:00Z" }),
      r({ id: "new", at: "2026-09-24T12:00:00Z" }),
      r({ id: "urgent-old", at: "2026-09-02T12:00:00Z", urgent: true }),
    ]);
    expect(open.map((x) => x.id)).toEqual(["urgent-old", "new", "old"]);
  });

  it("separates what's been fixed, newest fix first", () => {
    const { open, fixed } = groupFeedback([
      r({ id: "still-open" }),
      r({ id: "fixed-first", fixedAt: "2026-09-10T12:00:00Z" }),
      r({ id: "fixed-last", fixedAt: "2026-09-22T12:00:00Z" }),
    ]);
    expect(open.map((x) => x.id)).toEqual(["still-open"]);
    expect(fixed.map((x) => x.id)).toEqual(["fixed-last", "fixed-first"]);
  });

  // The panel is a glance, not an archive: it caps, but the count doesn't lie.
  it("caps each list and still reports how many are open", () => {
    const many = Array.from({ length: 12 }, (_, i) => r({ id: `o${i}`, at: `2026-09-${String(i + 1).padStart(2, "0")}T12:00:00Z` }));
    const { open, openTotal } = groupFeedback(many, { openMax: 8 });
    expect(open).toHaveLength(8);
    expect(openTotal).toBe(12);
  });

  it("copes with nothing, or rubbish", () => {
    expect(groupFeedback()).toMatchObject({ open: [], fixed: [], openTotal: 0 });
    expect(groupFeedback(null)).toMatchObject({ open: [], fixed: [] });
  });
});
