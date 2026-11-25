import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import React from "react";
import CncPrograms from "../floor/CncPrograms.jsx";
import CncMachines from "../floor/CncMachines.jsx";
import CncImport from "../floor/CncImport.jsx";
import CncPriorities from "../floor/CncPriorities.jsx";
import CncRunSheet from "../floor/CncRunSheet.jsx";
import FloorSheetView from "../floor/FloorSheetView.jsx";
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
    const stamp = () => screen.getByRole("button", { name: /Stamp it proven/ });
    fireEvent.change(screen.getByLabelText("Who proved it out"), { target: { value: "Jesse" } });
    expect(stamp().disabled).toBe(true);                    // a name alone isn't enough
    const steps = screen.getAllByRole("checkbox");
    expect(steps).toHaveLength(3);
    fireEvent.click(steps[0]); fireEvent.click(steps[1]);
    expect(stamp().disabled).toBe(true);                    // nor two of the three steps
    fireEvent.click(steps[2]);
    fireEvent.click(stamp());
    expect(await screen.findByText(/Proven · Jesse/)).toBeTruthy();
    expect((await db.getCncPrograms("p1"))[0].status).toBe("proven");
    fireEvent.click(screen.getByRole("button", { name: /Not proven after all/ }));
    expect(await screen.findByText("Not proven")).toBeTruthy();
  });

  it("warns when the program calls a tool the machine doesn't list", async () => {
    render(<CncPrograms part={part} onFact={() => {}} machineFacts={{ st10: { tools: [{ t: "2", what: "drill" }] } }} />);
    upload("O00017.nc", PROGRAM);
    fireEvent.click(await screen.findByRole("button", { name: /to check/ }));
    expect(screen.getByText(/T1 isn't on the ST-10Y tool list/)).toBeTruthy();
  });

  it("won't take the same file twice, and shows what changed in a new version", async () => {
    render(<CncPrograms part={part} onFact={() => {}} />);
    upload("O00017.nc", PROGRAM);
    await screen.findByText("O00017.nc");
    upload("copy.nc", PROGRAM);
    expect(await screen.findByText(/identical to a version that's been uploaded/)).toBeTruthy();
    expect(await db.getCncPrograms("p1")).toHaveLength(1);
    upload("O00017-v2.nc", PROGRAM.replace("G54 G00 X1.3 Z0.1", "G54 G00 X1.4 Z0.1\nG50 S3000"));
    fireEvent.click(await screen.findByRole("button", { name: /What changed \(\+2 −1\)/ }));
    const diff = screen.getByLabelText("Changes from the previous version").textContent;
    expect(diff).toContain("G50 S3000");
    expect(diff).toContain("G54 G00 X1.3 Z0.1");
  });

  it("the checklist counts what's there and says how to fix what isn't", async () => {
    render(<CncPrograms part={part} onFact={() => {}} />);
    expect(screen.getByText("2 of 7 filled in")).toBeTruthy(); // drawing + machine
    expect(screen.getByText(/Upload the file the Haas runs/)).toBeTruthy();
  });

  it("typing in a facts box reports the change to the part", () => {
    const onFact = vi.fn();
    render(<CncPrograms part={part} onFact={onFact} />);
    fireEvent.change(screen.getByPlaceholderText(/deburr both ends/), { target: { value: "deburr" } });
    expect(onFact).toHaveBeenCalledWith("byHand", "deburr");
  });
});

describe("importing a USB stick", () => {
  const files = (list) => list.map(([name, text]) => new File([text], name, { type: "text/plain" }));
  it("shows the plan first, then files programs onto existing and new parts", async () => {
    await db.saveCncPart({ name: "3in Baby Pin", programNo: "O00017", steps: [], photos: [] });
    const parts = await db.getCncParts();
    const onDone = vi.fn();
    render(<CncImport parts={parts} onDone={onDone} onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText("Program files to import"), { target: { files: files([
      ["O00017.nc", PROGRAM],
      ["O04120.nc", "O04120 (JUNIOR RECEIVER)\nT1 M06\nG43 H01 Z1.\nM30\n"],
      ["notes.txt", "remember to order inserts"],
    ]) } });
    expect(await screen.findByText(/1 onto parts you already have · 1 new part · 1 skipped/)).toBeTruthy();
    expect((await db.getCncProgramIndex())).toHaveLength(0);   // nothing saved yet
    fireEvent.change(screen.getByLabelText("Machine these programs are from"), { target: { value: "vf4" } });
    fireEvent.click(screen.getByRole("button", { name: "Import 2 programs" }));
    expect(await screen.findByText(/Imported 2 programs, made 1 new part/)).toBeTruthy();
    const after = await db.getCncParts();
    const made = after.find((p) => p.name === "JUNIOR RECEIVER");
    expect(made).toMatchObject({ programNo: "O04120", machine: "vf4" });
    expect(await db.getCncPrograms(parts[0].id)).toHaveLength(1);
    expect(onDone).toHaveBeenCalled();
  });

  it("several new parts in one import each get made (none overwrites another)", async () => {
    render(<CncImport parts={[]} onDone={() => {}} onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText("Program files to import"), { target: { files: files([
      ["a.nc", "O00001 (PART A)\nT1 M06\nG43 H01 Z1.\nM30\n"],
      ["b.nc", "O00002 (PART B)\nT1 M06\nG43 H01 Z1.\nM30\n"],
      ["c.nc", "O00003 (PART C)\nT1 M06\nG43 H01 Z1.\nM30\n"],
    ]) } });
    fireEvent.click(await screen.findByRole("button", { name: "Import 3 programs" }));
    expect(await screen.findByText(/Imported 3 programs, made 3 new parts/)).toBeTruthy();
    expect((await db.getCncParts()).map((p) => p.name).sort()).toEqual(["PART A", "PART B", "PART C"]);
    expect(await db.getCncProgramIndex()).toHaveLength(3);
  });

  it("importing the same stick twice adds nothing the second time", async () => {
    await db.saveCncPart({ name: "3in Baby Pin", programNo: "O00017", steps: [], photos: [] });
    const parts = await db.getCncParts();
    const go = async () => {
      const { unmount } = render(<CncImport parts={parts} onDone={() => {}} onClose={() => {}} />);
      fireEvent.change(screen.getByLabelText("Program files to import"), { target: { files: files([["O00017.nc", PROGRAM]]) } });
      fireEvent.click(await screen.findByRole("button", { name: "Import 1 program" }));
      await screen.findByText(/Imported/);
      const text = screen.getByText(/Imported/).textContent;
      unmount();
      return text;
    };
    expect(await go()).toMatch(/Imported 1 program\./);
    expect(await go()).toMatch(/Imported 0 programs, skipped 1 already in the catalogue/);
    expect(await db.getCncPrograms(parts[0].id)).toHaveLength(1);
  });
});

describe("the run sheet", () => {
  const full = { ...part, material: "1018 steel", steps: ["Saw to length", "Turn"], facts: { stock: "1.25 bar", holding: "3-jaw chuck", byHand: "deburr" } };
  it("opens from a program and shows the setup, the tools and the warning for an unproven program", async () => {
    render(<CncPrograms part={full} onFact={() => {}} machineFacts={{ st10: { tools: [{ t: "1", what: "CNMG 432 rougher" }] } }} />);
    upload("O00017.nc", PROGRAM);
    fireEvent.click(await screen.findByRole("button", { name: /Run sheet/ }));
    const sheet = document.getElementById("wo");
    expect(sheet.textContent).toContain("CNC RUN SHEET");
    expect(sheet.textContent).toContain("3in Baby Pin");
    expect(sheet.textContent).toContain("Not proven");
    expect(sheet.textContent).toContain("1.25 bar");
    expect(sheet.textContent).toContain("3-jaw chuck");
    expect(sheet.textContent).toContain("CNMG 432 rougher");   // what the tool list says is in T1
    expect(sheet.textContent).toContain("CNMG ROUGH");         // what the program expects
    expect(sheet.textContent).toContain("Not proven. Before a full run");
    expect(sheet.textContent).toContain("Saw to length");
  });

  it("loads the part's own program when opened from the floor, preferring a proven version", async () => {
    await db.addCncProgram({ partId: "p1", name: "old-proven.nc", content: PROGRAM });
    const [old] = await db.getCncPrograms("p1");
    await db.setCncProgramProven(old.id, true, "Jesse");
    await db.addCncProgram({ partId: "p1", name: "new-untested.nc", content: PROGRAM.replace("X1.3", "X1.4") });
    render(<CncRunSheet part={full} onClose={() => {}} />);
    await waitFor(() => expect(document.getElementById("wo").textContent).toContain("old-proven.nc"));
    expect(document.getElementById("wo").textContent).toContain("Proven");
    expect(document.getElementById("wo").textContent).toContain("Jesse");
  });

  it("says so when the part has no program at all", async () => {
    render(<CncRunSheet part={full} onClose={() => {}} />);
    await waitFor(() => expect(document.getElementById("wo").textContent).toContain("No program"));
  });
});

describe("a CNC work order opened on the floor", () => {
  const sheet = { orderNo: "100001", dept: "CNC", product: "3in Baby Pin", qty: "20", partNo: "BP-3", steps: [], lines: [], rush: false };
  it("shows whether the part's program is proven and offers the run sheet", async () => {
    const onRunSheet = vi.fn();
    // nothing on file yet
    const first = render(<FloorSheetView sheet={sheet} part={part} onRunSheet={onRunSheet} onClose={() => {}} />);
    expect(await screen.findByText(/No program on file/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Download/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Run sheet/ }));
    expect(onRunSheet).toHaveBeenCalled();
    first.unmount();
    // a program, not proven
    const id = await db.addCncProgram({ partId: "p1", name: "O00017.nc", content: PROGRAM });
    const second = render(<FloorSheetView sheet={sheet} part={part} onRunSheet={onRunSheet} onClose={() => {}} />);
    expect(await screen.findByText(/Program not proven. Get a lead before running/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Download/ })).toBeTruthy();
    second.unmount();
    // proven
    await db.setCncProgramProven(id, true, "Jesse");
    render(<FloorSheetView sheet={sheet} part={part} onRunSheet={onRunSheet} onClose={() => {}} />);
    expect(await screen.findByText("Program proven by Jesse")).toBeTruthy();
  });

  it("shows the proven version even when a newer, unproven one is on file", async () => {
    const old = await db.addCncProgram({ partId: "p1", name: "good.nc", content: PROGRAM });
    await db.setCncProgramProven(old, true, "Jesse");
    await new Promise((r) => setTimeout(r, 5));
    await db.addCncProgram({ partId: "p1", name: "new-try.nc", content: PROGRAM.replace("X1.3", "X1.4") });
    const made = [];
    vi.spyOn(URL, "createObjectURL").mockImplementation((blob) => { made.push(blob); return "blob:x"; });
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function () { made.push(this.download); });
    render(<FloorSheetView sheet={sheet} part={part} onRunSheet={() => {}} onClose={() => {}} />);
    expect(await screen.findByText("Program proven by Jesse")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Download/ }));
    expect(click).toHaveBeenCalled();
    expect(made).toContain("good.nc");            // the file that goes to the machine is the proven one
  });

  it("a problem reported from the machine lands on the part, dated and named, without touching the work order", async () => {
    localStorage.setItem("mse_cnc_parts_v1", JSON.stringify([{ ...part, facts: { problems: "Thread comes out tight" } }]));
    await db.addCncProgram({ partId: "p1", name: "O00017.nc", content: PROGRAM });
    const changed = vi.fn();
    render(<FloorSheetView sheet={sheet} part={part} onRunSheet={() => {}} onPartChanged={changed} onClose={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: /Something wrong with this program/ }));
    expect(screen.getByRole("button", { name: /Put it on the part/ }).disabled).toBe(true);     // nothing typed yet
    fireEvent.change(screen.getByLabelText("What's wrong with the program"), { target: { value: "Chatter on the long turn" } });
    fireEvent.change(screen.getByLabelText("Your name"), { target: { value: "Moe" } });
    fireEvent.click(screen.getByRole("button", { name: /Put it on the part/ }));
    expect(await screen.findByText(/Noted on the part/)).toBeTruthy();
    const saved = (await db.getCncParts()).find((p) => p.id === "p1");
    expect(saved.facts.problems).toMatch(/^Thread comes out tight\n\d+\/\d+ Moe: Chatter on the long turn$/);
    expect(changed).toHaveBeenCalled();
    expect(screen.getByText(/View only. Changes to this work order are made in the office/)).toBeTruthy();
  });

  it("shows nothing about programs for a job that isn't in the catalogue", () => {
    render(<FloorSheetView sheet={sheet} part={null} onClose={() => {}} />);
    expect(screen.queryByText(/Run sheet/)).toBeNull();
    expect(screen.queryByText(/program/i)).toBeNull();
  });
});

describe("fix first", () => {
  it("lists the worst hand-work part first and opens it on click", () => {
    const onOpen = vi.fn();
    const parts = [
      { id: "a", name: "Small Pin", machine: "st10", facts: { byHand: "deburr", byHandMin: "1", perRun: "20" } },
      { id: "b", name: "Big Receiver", machine: "vf4", facts: { byHand: "drill cross hole", byHandMin: "6", perRun: "40" } },
    ];
    render(<CncPriorities parts={parts} programIndex={[{ partId: "b", status: "unproven", createdAt: 1 }]} onOpen={onOpen} />);
    const rows = screen.getAllByTitle("Open this part");
    expect(rows[0].textContent).toContain("Big Receiver");
    expect(rows[0].textContent).toContain("4.0 hours");
    expect(rows[0].textContent).toContain("Not proven");
    expect(rows[1].textContent).toContain("No program");
    fireEvent.click(rows[0]);
    expect(onOpen).toHaveBeenCalledWith(parts[1]);
  });
});

describe("the Machines page", () => {
  it("an empty list fills from the programs in one press, and other names the programs use are one tap away", async () => {
    const parts = [{ id: "a", machine: "st10" }, { id: "b", machine: "st10" }, { id: "c", machine: "st10" }];
    const index = [
      { partId: "a", createdAt: 1, info: { tools: [{ t: 5, note: "TURN" }, { t: 11, note: "DRILL 1/4" }] } },
      { partId: "b", createdAt: 1, info: { tools: [{ t: 5, note: "TURN" }] } },
      { partId: "c", createdAt: 1, info: { tools: [{ t: 5, note: "VNMG FINISH" }] } },
    ];
    render(<CncMachines parts={parts} programIndex={index} />);
    fireEvent.click(await screen.findByRole("button", { name: /Fill in 2 tools from the programs/ }));
    expect(screen.getByLabelText("ST-10Y tool 1 number").value).toBe("5");
    expect(screen.getByLabelText("ST-10Y tool 1 description").value).toBe("TURN");
    expect(screen.getByLabelText("ST-10Y tool 2 description").value).toBe("DRILL 1/4");
    expect(screen.queryByRole("button", { name: /Fill in/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "VNMG FINISH" }));
    expect(screen.getByLabelText("ST-10Y tool 1 description").value).toBe("VNMG FINISH");
    await waitFor(async () => expect((await db.getMachineFacts()).st10.tools).toEqual([{ t: "5", what: "VNMG FINISH" }, { t: "11", what: "DRILL 1/4" }]), { timeout: 4000 });
  });

  it("offers the tools the programs call, and one click lists them", async () => {
    const parts = [{ id: "a", machine: "st10" }];
    const index = [{ partId: "a", createdAt: 1, info: { tools: [{ t: 3, note: "CNMG ROUGH" }] } }];
    render(<CncMachines parts={parts} programIndex={index} />);
    fireEvent.click(await screen.findByRole("button", { name: "Add T3 to the ST-10Y tool list" }));
    expect(screen.getByLabelText("ST-10Y tool 1 number").value).toBe("3");
    expect(screen.getByLabelText("ST-10Y tool 1 description").value).toBe("CNMG ROUGH");
    expect(screen.queryByRole("button", { name: "Add T3 to the ST-10Y tool list" })).toBeNull(); // it's listed now
  });

  it("saves a machine's tool list and reads it back", async () => {
    render(<CncMachines />);
    // one machine on screen at a time: pick the ST-10
    fireEvent.click(await screen.findByRole("tab", { name: /ST-10/ }));
    expect(screen.queryByLabelText("VF-4 tool 1 number")).toBeNull();
    const num = await screen.findByLabelText("ST-10Y tool 1 number");
    fireEvent.change(num, { target: { value: "T1" } });
    fireEvent.change(screen.getByLabelText("ST-10Y tool 1 description"), { target: { value: "CNMG rougher" } });
    expect(screen.getByLabelText("ST-10Y tool 2 number")).toBeTruthy(); // a fresh row opened
    // saved by itself, a moment after typing stops
    await waitFor(async () => expect((await db.getMachineFacts()).st10.tools).toEqual([{ t: "1", what: "CNMG rougher" }]), { timeout: 4000 });
  });
});
