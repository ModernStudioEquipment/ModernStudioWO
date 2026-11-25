import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import React from "react";
import CncGuide from "../floor/CncGuide.jsx";
import CncRunSheet from "../floor/CncRunSheet.jsx";
import { nextStep, catalogProgress, rapidCheck, checkForPart } from "../floor/cncPack.js";
import { drawingFor } from "../floor/CncDrawing.jsx";

// Knowing where you are: the catalogue's four-step tracker, and the one line on
// each part that says what to do next.

const GOOD = "O00017 (PIN)\nG20\nG50 S3000\nT0101 (ROUGH)\nG96 S400 M03\nG54 G00 X1.35 Z0.1 M08\nG71 P10 Q20 U0.02 W0.005 D0.08 F0.012\nN10 G00 X0.625\nG01 Z-1. F0.006\nX1.125\nZ-3.\nN20 X1.3\nG70 P10 Q20\nG00 X2. Z1.\nM30\n";
const CRASH = "O00099 (BAD)\nG20\nG50 S3000\nT0101\nG96 S400 M03\nG54 G00 X1.35 Z0.1 M08\nG00 X0.75\nG01 Z-1. F0.008\nG00 X0.9 Z-2.2\nG01 Z-2.8 F0.008\nG00 X1.4\nM30\n";
const part = {
  id: "p1", name: "Pin", machine: "st10", material: "1018 steel", blueprintUrl: "x", steps: [], photos: [],
  facts: { stock: '1.25" round bar', holding: "3-jaw chuck", byHand: "deburr" },
};
const tools = { st10: { tools: [{ t: "1", what: "CNMG rougher" }] } };

beforeEach(() => { localStorage.clear(); vi.restoreAllMocks(); });

describe("what a part needs next", () => {
  it("walks the real order: program, checks, setup, proven", () => {
    expect(nextStep({ ...part, id: null }, [], tools).text).toMatch(/Give the part a name and save it/);
    expect(nextStep(part, [], tools)).toMatchObject({ at: "Program", tone: "todo" });
    const unproven = [{ content: GOOD, status: "unproven" }];
    expect(nextStep(part, unproven, tools, 2)).toMatchObject({ at: "Checks", tone: "stop", text: "Fix the 2 problems the checker found, then upload the fixed program." });
    expect(nextStep({ ...part, facts: { stock: "1.25 bar" } }, unproven, tools, 0)).toMatchObject({ at: "Setup", text: "2 things about the setup still need filling in." });
    expect(nextStep({ ...part, facts: { ...part.facts, holding: "" } }, unproven, tools, 0).text).toBe("One thing left to fill in: how it's held.");
    // no drawing never holds a part up
    expect(nextStep({ ...part, blueprintUrl: null }, unproven, tools, 0).at).toBe("Proven");
    expect(nextStep(part, unproven, tools, 0)).toMatchObject({ at: "Proven", text: "Last step: test it at the machine. If the first part comes out right, mark it as good." });
    expect(nextStep(part, [{ content: GOOD, status: "proven", provenBy: "Jesse" }], tools, 0)).toMatchObject({ tone: "done", text: "Ready to run. Proven by Jesse." });
  });
  it("a new unproven version over a proven one says so", () => {
    const s = nextStep(part, [{ content: GOOD, status: "unproven" }, { content: GOOD, status: "proven" }], tools, 0);
    expect(s.text).toMatch(/newer version hasn't been tested at the machine yet/);
    expect(s.done.Proven).toBe(false);
  });
  it("ticks off what's done so far", () => {
    expect(nextStep(part, [{ content: GOOD, status: "unproven" }], tools, 0).done).toEqual({ Program: true, Checks: true, Setup: true, Proven: false });
  });
});

describe("the catalogue's progress", () => {
  const parts = [part, { id: "p2", name: "Receiver", machine: "vf4", facts: {} }, { id: "p3", name: "Loose", machine: "", facts: {} }];
  const index = [{ partId: "p1", status: "proven", createdAt: 2 }, { partId: "p2", status: "unproven", createdAt: 1 }];
  it("counts each step and points at the first one not finished", () => {
    const p = catalogProgress(parts, index, tools);
    const by = Object.fromEntries(p.steps.map((s) => [s.key, [s.done, s.of]]));
    expect(by.import).toEqual([2, 3]);      // two of three parts have a program
    expect(by.machines).toEqual([1, 2]);    // ST-10 has a list, VF-4 doesn't; the DS-30SSY isn't used
    expect(by.setup).toEqual([1, 3]);
    expect(by.prove).toEqual([1, 3]);
    expect(p.current).toBe("import");
    expect(p.percent).toBe(Math.round((5 / 11) * 100));
  });
  it("an empty catalogue is 0% and starts at importing", () => {
    expect(catalogProgress([], [], {})).toMatchObject({ percent: 0, empty: true });
  });

  it("starts as one line that says what's next", () => {
    render(<CncGuide parts={parts} programIndex={index} machineFacts={tools} onGo={() => {}} />);
    expect(screen.getByText("Next: bring in the programs (2 of 3).")).toBeTruthy();
    expect(screen.queryByText("Bring in the programs")).toBeNull();
  });
  it("opens to the four steps with counts, and sends you to the right place", () => {
    const onGo = vi.fn();
    render(<CncGuide parts={parts} programIndex={index} machineFacts={tools} onGo={onGo} />);
    fireEvent.click(screen.getByRole("button", { name: /Getting the CNC programs set up/ }));
    expect(screen.getByText("Bring in the programs")).toBeTruthy();
    expect(screen.getByText("2 of 3")).toBeTruthy();
    expect(screen.getByText("1 of 2")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Open Machines/ }));
    expect(onGo).toHaveBeenCalledWith("machines");
  });
  it("remembers being left open", () => {
    const { unmount } = render(<CncGuide parts={parts} programIndex={index} machineFacts={tools} onGo={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /Getting the CNC programs set up/ }));
    unmount();
    render(<CncGuide parts={parts} programIndex={index} machineFacts={tools} onGo={() => {}} />);
    expect(screen.getByText("Bring in the programs")).toBeTruthy();   // still open
  });
});

describe("a rapid through the bar, in the checker", () => {
  it("is a stop, with the line, once the part has a stock size", () => {
    const found = rapidCheck(CRASH, part, "lathe");
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ level: "stop", line: 9 });
    expect(found[0].text).toMatch(/A rapid move goes through the bar: 0\.25″ into the metal/);
    expect(checkForPart(CRASH, part, tools)[0].level).toBe("stop");
  });
  it("asks for the stock size instead of guessing when there isn't one", () => {
    const found = rapidCheck(CRASH, { ...part, facts: {} }, "lathe");
    expect(found).toEqual([{ level: "note", text: "Put the stock size on the part and rapid moves get checked against the bar.", line: null }]);
  });
  it("only says \"check\", with the reason, when it can't follow the program", () => {
    // the same crash, but the program also drills on centre: the move might be inside the hole
    const drilled = CRASH.replace("G00 X0.9 Z-2.2", "G00 X0. Z0.1\nG01 Z-0.5 F0.004\nG00 Z0.1\nG00 X0.9 Z-2.2");
    const found = rapidCheck(drilled, part, "lathe");
    expect(found.length).toBeGreaterThan(0);
    expect(found.every((f) => f.level === "look")).toBe(true);
    expect(found[0].text).toMatch(/may go through the bar .* Check it: the program drills or bores/);
    // two work offsets: two zeros, one bar
    const two = rapidCheck(CRASH.replace("G01 Z-2.8 F0.008", "G55 G01 Z-2.8 F0.008"), part, "lathe");
    expect(two[0]).toMatchObject({ level: "look" });
    expect(two[0].text).toMatch(/more than one work offset/);
    // a sub-spindle program
    const sub = rapidCheck(CRASH.replace("M30", "G14\nM30"), part, "lathe");
    expect(sub[0].text).toMatch(/live tools or the sub-spindle/);
  });
  it("says nothing about a good program, or a mill program", () => {
    expect(rapidCheck(GOOD, part, "lathe")).toEqual([]);
    expect(rapidCheck("O1\nT1 M06\nG00 X0. Y0. Z1.\nG01 Z-.1 F5.\nM30\n", part, "mill")).toEqual([]);
  });
});

describe("the drawing on the run sheet", () => {
  it("draws a lathe part from the side with its real sizes", () => {
    const d = drawingFor(GOOD, { kind: "lathe", stockText: part.facts.stock });
    expect(d.kind).toBe("lathe");
    expect(d.caption).toBe("Cut length 3″ · largest diameter 1.125″ · smallest 0.625″");
    expect(d.pts[0][0]).toBeCloseTo(-3, 3);              // from where cutting stops…
    expect(d.pts.at(-1)).toEqual([0, 0]);                  // …to the face
  });
  it("draws a mill program from above", () => {
    const d = drawingFor("O1\nG20\nT1 M06\nG00 X0. Y0. Z1.\nG01 Z-0.25 F10.\nX3.\nY2.\nM30\n", { kind: "mill" });
    expect(d.kind).toBe("mill");
    expect(d.caption).toMatch(/X 0 to 3″ · Y 0 to 2″ · deepest Z-0\.25″/);
  });
  it("draws nothing for a program with no moves", () => {
    expect(drawingFor("O1\nM30\n")).toBeNull();
  });
  it("is on the run sheet, with the run time for one and for the whole run", () => {
    render(<CncRunSheet part={{ ...part, facts: { ...part.facts, perRun: "50" } }} program={{ name: "O00017.nc", content: GOOD, status: "unproven" }} machineFacts={tools} onClose={() => {}} />);
    const sheet = document.getElementById("wo");
    expect(sheet.querySelector("svg polygon")).toBeTruthy();
    expect(sheet.textContent).toContain("What the program makes");
    expect(sheet.textContent).toMatch(/Run time.*About .* a part, .* for 50 \(estimate\)/);
  });
});
