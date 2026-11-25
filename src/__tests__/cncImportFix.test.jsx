import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import React from "react";
import { cleanProgramText } from "../floor/cncGcode.js";
import { planImport } from "../floor/cncPack.js";
import { matchesSearch } from "../floor/CncLibrary.jsx";
import CncImport from "../floor/CncImport.jsx";
import { db } from "../lib/db.js";

// What the first real import (a zip of the shop's programs, 2026-11-25) ran
// into: a file with hidden null characters stopped the whole import, the
// probe's macros were called "not a program", and parts couldn't be found by
// the CNC number in their file names.

const PIN = "%\nO00636 (006-1596)\nG20\nT0505 (TURN)\nG96 S400 M03\nG54 G00 X1.35 Z0.1\nG01 X0.625 F0.006\nM30\n%\n";

beforeEach(() => { localStorage.clear(); vi.restoreAllMocks(); });

describe("hidden characters", () => {
  it("are taken out of a program, and tabs and line ends stay", () => {
    const dirty = `﻿${PIN.replace("G20", "G20\u0000").replace("M30", "M30\u0007")}\u0000\u0000\u0000`;
    const c = cleanProgramText(dirty);
    expect(c.text).toBe(PIN);
    expect(c.removed).toBe(6);
    expect(cleanProgramText("G01\tX1.\r\nM30").text).toBe("G01\tX1.\r\nM30");
  });
  it("a file that's mostly nulls is a binary file, not a program to clean up", () => {
    const binary = "\u0000".repeat(500) + "G01 X1.";
    expect(cleanProgramText(binary).binary).toBe(true);
    expect(planImport([{ name: "part.mcam", text: binary }])[0]).toMatchObject({ action: "skip", why: "Not a program file." });
  });
  it("a program with nulls after the first few thousand characters is imported clean", () => {
    const long = PIN.replace("M30", `${"G01 X1.\n".repeat(900)}M30`) + "\u0000\u0000";
    const [r] = planImport([{ name: "CNC-0240 - STACK 6.nc", text: long }]);
    expect(r.action).toBe("new");
    expect(r.text.includes("\u0000")).toBe(false);
    expect(r.cleaned).toBe(2);
  });
  it("and is never handed to the database with one in it, however it arrives", async () => {
    const id = await db.addCncProgram({ partId: "p", name: "x.nc", content: `${PIN}\u0000` });
    expect((await db.getCncPrograms("p")).find((p) => p.id === id).content).toBe(PIN);
  });
});

describe("the probe's own programs", () => {
  const macro = "%\nO09804 (RENISHAW STORM)\n#100=#5021\nIF[#100GT0]GOTO1\n#101=[#100*2]\nN1\nM99\n%\n";
  it("are named for what they are", () => {
    expect(planImport([{ name: "CNC-0504 - O09804_RENISHAW_Storm.nc", text: macro }])[0].why).toBe("Renishaw probe macro: part of the machine's probing software, not a part program.");
    const other = Array.from({ length: 12 }, (_, i) => `#${100 + i}=[#${200 + i}+1.]`).join("\n");
    expect(planImport([{ name: "O9100.nc", text: `%\nO09100 (MACRO)\nG65 P9101\n${other}\nG01 X1.\nG00 Z1.\nM99\n%\n` }])[0].why).toMatch(/9000-series macro/);
  });
});

describe("an import that meets a file it can't save", () => {
  it("leaves that one out, names it, and saves the rest", async () => {
    const real = db.addCncProgram.bind(db);
    vi.spyOn(db, "addCncProgram").mockImplementation(async (args) => { if (/BAD/.test(args.name)) throw new Error("unsupported Unicode escape sequence"); return real(args); });
    const done = vi.fn();
    render(<CncImport parts={[]} onDone={done} onClose={() => {}} />);
    const files = ["CNC-0240 - STACK 6.nc", "CNC-0241 - BAD.nc", "CNC-0242 - TRAY.nc"].map((n, i) => new File([PIN.replace("O00636", `O0063${i}`).replace("006-1596", `PART ${i}`)], n, { type: "text/plain" }));
    fireEvent.change(screen.getByLabelText("Program files to import"), { target: { files } });
    fireEvent.click(await screen.findByRole("button", { name: /Import 3 programs/ }));
    expect(await screen.findByText(/Imported 2 programs/)).toBeTruthy();
    expect(screen.getByText(/1 file couldn't be saved and was left out: CNC-0241 - BAD\.nc \(unsupported Unicode escape sequence\)/)).toBeTruthy();
    expect(done).toHaveBeenCalled();
  });
});

describe("searching", () => {
  const fields = ["006-1596", "", "", "O00636", "CNC-0240 - STACK 6.nc", "O00636", "006-1596"];
  it("finds a part by the CNC number in its program file's name, however it's typed", () => {
    for (const q of ["0240", "240", "CNC-0240", "cnc 240", "stack", "STACK 6", "636", "O636", "006-1596", "1596"]) expect(matchesSearch(q, fields), q).toBe(true);
  });
  it("and doesn't find it by a number that isn't there", () => {
    for (const q of ["0241", "24", "stacks", "CNC-0240 tray"]) expect(matchesSearch(q, fields), q).toBe(false);
  });
  it("an empty search finds everything", () => expect(matchesSearch("  ", [])).toBe(true));
});

describe("changing a part's machine from under its name", () => {
  it("tapping the machine opens the three, and a tap saves the change", async () => {
    const { default: CncPartOverview } = await import("../floor/CncPartOverview.jsx");
    const onCommit = vi.fn(async () => "p1");
    const pp = { loading: false, programs: [], newest: null, stops: [], machineKind: "lathe", step: { at: "Program", tone: "todo", text: "Add the program.", done: {} } };
    render(<CncPartOverview part={{ id: "p1", name: "Pin", machine: "st10", facts: {}, steps: [] }} pp={pp} machineFacts={{}} onAsk={() => {}} onDetails={() => {}} onCommit={onCommit} />);
    fireEvent.click(screen.getByRole("button", { name: /Haas ST-10Y/ }));
    fireEvent.click(screen.getByRole("button", { name: /Haas DS-30SSY/ }));
    await waitFor(() => expect(onCommit).toHaveBeenCalledWith({ machine: "st10,ds30ssy" }));
    fireEvent.click(screen.getAllByRole("button", { name: /Haas ST-10Y/ }).find((b) => b.getAttribute("aria-pressed") === "true"));
    await waitFor(() => expect(onCommit).toHaveBeenLastCalledWith({ machine: "" }));
  });
});

describe("operator steps, under the part", () => {
  const pp = { loading: false, programs: [], newest: null, stops: [], machineKind: "lathe", step: { at: "Program", tone: "todo", text: "Add the program.", done: {} } };
  it("are added, put in order and saved from the part, blank ones dropped", async () => {
    const { default: CncPartOverview } = await import("../floor/CncPartOverview.jsx");
    const onCommit = vi.fn(async () => "p1");
    render(<CncPartOverview part={{ id: "p1", name: "Pin", machine: "st10", facts: {}, steps: [] }} pp={pp} machineFacts={{}} onAsk={() => {}} onDetails={() => {}} onCommit={onCommit} />);
    expect(screen.getByText(/None yet/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Add steps/ }));
    fireEvent.change(screen.getByLabelText("Step 1"), { target: { value: "Touch off T1" } });
    fireEvent.click(screen.getByRole("button", { name: /Add a step/ }));
    fireEvent.change(screen.getByLabelText("Step 2"), { target: { value: "Load the bar, 3.25 out" } });
    fireEvent.click(screen.getByRole("button", { name: /Add a step/ }));                 // left blank
    fireEvent.click(screen.getByRole("button", { name: "Move step 2 up" }));
    fireEvent.click(screen.getByRole("button", { name: /Save steps/ }));
    await waitFor(() => expect(onCommit).toHaveBeenCalledWith({ field: { steps: ["Load the bar, 3.25 out", "Touch off T1"] } }));
  });
  it("show as a numbered list when there are some", async () => {
    const { default: CncPartOverview } = await import("../floor/CncPartOverview.jsx");
    render(<CncPartOverview part={{ id: "p1", name: "Pin", machine: "st10", facts: {}, steps: ["Load the bar", "", "Deburr"] }} pp={pp} machineFacts={{}} onAsk={() => {}} onDetails={() => {}} onCommit={vi.fn()} />);
    expect([...document.querySelectorAll(".ov-opslist li")].map((l) => l.textContent)).toEqual(["Load the bar", "Deburr"]);
    expect(screen.getByRole("button", { name: "Edit steps" })).toBeTruthy();
  });
});
