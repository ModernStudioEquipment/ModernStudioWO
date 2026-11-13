// @vitest-environment node
import { describe, it, expect } from "vitest";
import { duplicatePart, isSkuTaken, moveStep, splitPrograms, joinPrograms } from "../floor/cncParts.js";

// Duplicating a catalogue part. SKU is unique in cnc_parts, so a copy that kept
// it could never be saved — the DUP- prefix (QuickBooks' own convention) is
// what makes the copy saveable at all.
const part = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Junior Receiver 1-1/8in Bore",
  sku: "012-345",
  productNo: "P-77",
  programNo: "O1234",
  material: "6061 bar",
  notes: "deburr the bore",
  blueprintUrl: "https://x/bp.png",
  steps: ["face it", "bore it"],
};

describe("duplicating a CNC part", () => {
  it("prefixes the identifiers the way QuickBooks does", () => {
    const c = duplicatePart(part);
    expect(c.sku).toBe("DUP-012-345");
    expect(c.productNo).toBe("DUP-P-77");
    expect(c.programNo).toBe("DUP-O1234");
  });

  it("copies everything else exactly, and comes back unsaved", () => {
    const c = duplicatePart(part);
    expect(c.id).toBeNull();
    expect(c.name).toBe(part.name);
    expect(c.material).toBe("6061 bar");
    expect(c.notes).toBe("deburr the bore");
    expect(c.blueprintUrl).toBe("https://x/bp.png");
    expect(c.steps).toEqual(["face it", "bore it"]);
  });

  it("doesn't share the steps array with the original", () => {
    const c = duplicatePart(part);
    c.steps[0] = "changed";
    expect(part.steps[0]).toBe("face it");
  });

  it("leaves a blank identifier blank instead of writing a bare DUP-", () => {
    const c = duplicatePart({ ...part, sku: "", productNo: "  ", programNo: undefined });
    expect(c.sku).toBe("");
    expect(c.productNo).toBe("");
    expect(c.programNo).toBe("");
  });

  it("can copy a copy", () => {
    expect(duplicatePart(duplicatePart(part)).sku).toBe("DUP-DUP-012-345");
  });

  it("recognises a taken SKU when the save is refused", () => {
    expect(isSkuTaken({ code: "23505", message: 'duplicate key value violates unique constraint "cnc_parts_sku_key"' })).toBe(true);
    expect(isSkuTaken({ message: "network down" })).toBe(false);
  });
});

// Extra photos (0065). The one that matters most here is shouldWritePhotos:
// naming a column the database doesn't have yet fails the whole save, so before
// the migration a part with no photos must save exactly as it always did.
import { cleanPhotos, shouldWritePhotos, MAX_PHOTOS } from "../floor/cncParts.js";

describe("a part's extra photos", () => {
  it("keeps real URLs in order, once each", () => {
    expect(cleanPhotos(["a", " b ", "a", "", null, 3, "c"])).toEqual(["a", "b", "c"]);
    expect(cleanPhotos(undefined)).toEqual([]);
  });

  it(`stops at ${MAX_PHOTOS}`, () => {
    expect(cleanPhotos(Array.from({ length: 20 }, (_, i) => `u${i}`))).toHaveLength(MAX_PHOTOS);
  });

  it("doesn't mention the column on a database that hasn't got it, when there's nothing to keep", () => {
    expect(shouldWritePhotos({ photos: [] })).toBe(false);
    expect(shouldWritePhotos({})).toBe(false);
  });

  it("writes it once the column exists, so removing the last photo sticks", () => {
    expect(shouldWritePhotos({ photosColumn: true, photos: [] })).toBe(true);
  });

  it("writes it whenever there are photos to keep", () => {
    expect(shouldWritePhotos({ photos: ["u"] })).toBe(true);
  });

  it("carries the photos onto a duplicate", () => {
    expect(duplicatePart({ name: "x", sku: "1", steps: [], photos: ["u1", "u2"] }).photos).toEqual(["u1", "u2"]);
  });
});

describe("moveStep", () => {
  const steps = ["Saw", "Face", "Drill", "Deburr"];
  it("moves a step down", () => {
    expect(moveStep(steps, 0, 2)).toEqual(["Face", "Drill", "Saw", "Deburr"]);
  });
  it("moves a step up", () => {
    expect(moveStep(steps, 3, 0)).toEqual(["Deburr", "Saw", "Face", "Drill"]);
  });
  it("never mutates the original or loses a step", () => {
    const out = moveStep(steps, 1, 3);
    expect(steps).toEqual(["Saw", "Face", "Drill", "Deburr"]);
    expect([...out].sort()).toEqual([...steps].sort());
  });
  it("ignores out-of-range moves", () => {
    expect(moveStep(steps, 0, 9)).toEqual(steps);
    expect(moveStep(steps, -1, 2)).toEqual(steps);
    expect(moveStep(undefined, 0, 1)).toEqual([]);
  });
});

describe("more than one CNC program", () => {
  it("an old single program reads as one", () => {
    expect(splitPrograms("O41207")).toEqual(["O41207"]);
    expect(splitPrograms("")).toEqual([""]);
    expect(splitPrograms(null)).toEqual([""]);
  });
  it("round trips through the one column", () => {
    const saved = joinPrograms(["O41207", " O41208 ", ""]);
    expect(saved).toBe("O41207, O41208");
    expect(splitPrograms(saved)).toEqual(["O41207", "O41208"]);
  });
  it("blank program boxes save as nothing", () => {
    expect(joinPrograms(["", "  "])).toBe("");
  });
  it("a duplicate marks every program, not just the first", () => {
    expect(duplicatePart({ name: "X", programNo: "O1, O2" }).programNo).toBe("DUP-O1, DUP-O2");
    expect(duplicatePart({ name: "X", programNo: "" }).programNo).toBe("");
  });
});
