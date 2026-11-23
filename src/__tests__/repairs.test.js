// @vitest-environment node
import { describe, it, expect } from "vitest";
import {
  REPAIR_ROWS, blankTicket, sheetFields, cleanForSave, itemCount, clientName,
  isBlank, searchText, isLate, parseSheetDate, today, filledLines,
} from "../components/repairs/repairTicket.js";

// The repair ticket is the paper form the will call counter writes by hand.
// These pin down what gets saved, what the Repairs tab reads off it, and that
// the sheet always has the paper's 28 lines to write on.

describe("the sheet", () => {
  it("always shows at least the paper's 28 item lines", () => {
    expect(sheetFields({}).lines).toHaveLength(REPAIR_ROWS);
    const many = Array.from({ length: 31 }, (_, i) => ({ description: `item ${i}` }));
    expect(sheetFields({ lines: many }).lines).toHaveLength(31);
  });
  it("a new ticket is dated today and nothing else is filled", () => {
    const f = blankTicket(new Date(2026, 10, 23));
    expect(f.dateReceived).toBe("11/23/2026");
    expect(f.company).toBe("");
    expect(f.quote).toBe("");
  });
  it("today() writes MM/DD/YYYY", () => {
    expect(today(new Date(2026, 0, 5))).toBe("01/05/2026");
  });
});

describe("what gets saved", () => {
  it("drops the blank padding lines but keeps a gap between filled ones", () => {
    const f = sheetFields({ lines: [{ description: "Chair" }, {}, { description: "Dolly", qty: "2" }] });
    const out = cleanForSave(f);
    expect(out.lines).toHaveLength(3);
    expect(out.lines[1]).toEqual({ dept: "", qty: "", description: "", notes: "" });
    expect(out.lines[2].qty).toBe("2");
  });
  it("trims what was typed", () => {
    expect(cleanForSave({ company: "  Acme  ", lines: [] }).company).toBe("Acme");
  });
  it("a ticket with only today's date on it counts as blank", () => {
    expect(isBlank(sheetFields({}))).toBe(true);
    expect(isBlank(sheetFields({ phone: "818" }))).toBe(false);
    expect(isBlank(sheetFields({ lines: [{ notes: "torn" }] }))).toBe(false);
  });
});

describe("what the Repairs tab reads off a ticket", () => {
  it("names the company, else the contact", () => {
    expect(clientName({ company: "Acme Studios", contact: "Dana" })).toBe("Acme Studios");
    expect(clientName({ company: " ", contact: "Dana" })).toBe("Dana");
    expect(clientName({})).toBe("No name yet");
  });
  it("adds up quantities, a line with none counting as one", () => {
    expect(itemCount({ lines: [{ description: "a", qty: "3" }, { description: "b" }, {}] })).toBe(4);
    expect(itemCount({ lines: [{ description: "a", qty: "2 pcs" }] })).toBe(2);
    expect(filledLines({ lines: [{}, { notes: "x" }] })).toHaveLength(1);
  });
  it("search finds a ticket by name, phone or item", () => {
    const r = { fields: { company: "Acme", phone: "818-555-0101", lines: [{ description: "C-stand knuckle" }] } };
    expect(searchText(r)).toContain("acme");
    expect(searchText(r)).toContain("818-555-0101");
    expect(searchText(r)).toContain("c-stand knuckle");
  });
});

describe("late", () => {
  const now = new Date(2026, 10, 23, 15, 0).getTime();
  it("is late only when past the completion date and still in the shop", () => {
    expect(isLate({ status: "open", fields: { completionDate: "11/22/2026" } }, now)).toBe(true);
    expect(isLate({ status: "open", fields: { completionDate: "11/23/2026" } }, now)).toBe(false); // due today isn't late
    expect(isLate({ status: "ready", fields: { completionDate: "11/01/2026" } }, now)).toBe(false);
    expect(isLate({ status: "open", fields: { completionDate: "ASAP" } }, now)).toBe(false);
  });
  it("reads M/D/YYYY too", () => {
    expect(parseSheetDate("1/5/2026")).toBe(new Date(2026, 0, 5).getTime());
    expect(parseSheetDate("")).toBeNull();
  });
});
