import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import React from "react";
import CncPrograms from "../floor/CncPrograms.jsx";
import CncMachines from "../floor/CncMachines.jsx";
import { db } from "../lib/db.js";

// Program files on a catalogue part, against the localStorage demo adapter.

const PROGRAM = "%\nO00017 (3IN BABY PIN)\nT0101 (CNMG ROUGH)\nG54 G00 X1.3 Z0.1\nM30\n%\n";
const part = { id: "p1", name: "3in Baby Pin", machine: "st10", material: "1018", blueprintUrl: "x", steps: [], photos: [], facts: {} };

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

const upload = (name, content) =>
  fireEvent.change(screen.getByLabelText("Program file"), { target: { files: [new File([content], name, { type: "text/plain" })] } });

describe("program files on a part", () => {
  it("asks for the part to be saved before taking a file", () => {
    render(<CncPrograms part={{ ...part, id: null }} onFact={() => {}} />);
    expect(screen.getByText(/Save the part first/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Upload program file/ }).disabled).toBe(true);
  });

  it("uploads a program, reads what's in it, and starts it unproven", async () => {
    render(<CncPrograms part={part} onFact={() => {}} />);
    upload("O00017.nc", PROGRAM);
    expect(await screen.findByText("O00017.nc")).toBeTruthy();
    expect(screen.getByText(/O00017 · T1 · G54 · 4 lines · 3IN BABY PIN/)).toBeTruthy();
    expect(screen.getByText("Not proven")).toBeTruthy();
    expect((await db.getCncPrograms("p1"))[0].content).toBe(PROGRAM);
  });

  it("refuses a file that isn't a program", async () => {
    render(<CncPrograms part={part} onFact={() => {}} />);
    upload("part.mcam", "MCAM\u0000\u0001binary");
    expect(await screen.findByText(/isn't a program file/)).toBeTruthy();
    expect(await db.getCncPrograms("p1")).toHaveLength(0);
  });

  it("stamps a program proven with a name, and can take it back", async () => {
    render(<CncPrograms part={part} onFact={() => {}} />);
    upload("O00017.nc", PROGRAM);
    fireEvent.click(await screen.findByRole("button", { name: /Mark proven/ }));
    expect(screen.getByRole("button", { name: /Stamp it/ }).disabled).toBe(true); // a name is required
    fireEvent.change(screen.getByLabelText("Who proved it out"), { target: { value: "Jesse" } });
    fireEvent.click(screen.getByRole("button", { name: /Stamp it/ }));
    expect(await screen.findByText(/Proven · Jesse/)).toBeTruthy();
    expect((await db.getCncPrograms("p1"))[0].status).toBe("proven");
    fireEvent.click(screen.getByRole("button", { name: /Not proven after all/ }));
    expect(await screen.findByText("Not proven")).toBeTruthy();
  });

  it("warns when the program calls a tool the machine doesn't list", async () => {
    render(<CncPrograms part={part} onFact={() => {}} machineFacts={{ st10: { tools: [{ t: "2", what: "drill" }] } }} />);
    upload("O00017.nc", PROGRAM);
    expect(await screen.findByText(/T1 isn't on the ST-10 tool list/)).toBeTruthy();
  });

  it("the checklist counts what's there and says how to fix what isn't", async () => {
    render(<CncPrograms part={part} onFact={() => {}} />);
    expect(screen.getByText("2 of 7 ready")).toBeTruthy(); // drawing + machine
    expect(screen.getByText(/Upload the file the Haas runs/)).toBeTruthy();
  });

  it("typing in a facts box reports the change to the part", () => {
    const onFact = vi.fn();
    render(<CncPrograms part={part} onFact={onFact} />);
    fireEvent.change(screen.getByPlaceholderText(/deburr both ends/), { target: { value: "deburr" } });
    expect(onFact).toHaveBeenCalledWith("byHand", "deburr");
  });
});

describe("the Machines page", () => {
  it("saves a machine's tool list and reads it back", async () => {
    render(<CncMachines />);
    const num = await screen.findByLabelText("ST-10 tool 1 number");
    fireEvent.change(num, { target: { value: "T1" } });
    fireEvent.change(screen.getByLabelText("ST-10 tool 1 description"), { target: { value: "CNMG rougher" } });
    expect(screen.getByLabelText("ST-10 tool 2 number")).toBeTruthy(); // a fresh row opened
    fireEvent.click(screen.getByRole("button", { name: "Save Haas ST-10" }));
    await waitFor(async () => expect((await db.getMachineFacts()).st10.tools).toEqual([{ t: "1", what: "CNMG rougher" }]));
  });
});
