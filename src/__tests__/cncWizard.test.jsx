import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import React from "react";
import CncWizard from "../floor/CncWizard.jsx";
import CncPartOverview from "../floor/CncPartOverview.jsx";
import { wizardSteps, wizardAnswer, neededLeft, WIZARD_STEPS } from "../floor/cncPack.js";

// Setting a part up one question at a time, and the overview that sends you
// there. The rule under test throughout: one thing on screen, saved as you go.

const GOOD = "O00017 (PIN)\nG20\nG50 S3000\nT0101 (ROUGH)\nG96 S400 M03\nG54 G00 X1.35 Z0.1 M08\nG71 P10 Q20 U0.02 W0.005 D0.08 F0.012\nN10 G00 X0.625\nG01 Z-1. F0.006\nX1.125\nZ-3.\nN20 X1.3\nG70 P10 Q20\nG00 X2. Z1.\nM30\n";
const BAD = "O1\nG20\nT0101\nG96 S400 M03\nG54 G00 X1. Z0.1\nG01 Z-1. F0.01\nM30\n";   // G96 with no speed limit: a stop
const full = { id: "p1", name: "Pin", sku: "BP-3", machine: "st10", material: "1018 steel", blueprintUrl: "x", steps: [], photos: [], facts: { stock: '1.25" bar', holding: "3-jaw", byHand: "deburr", byHandMin: "2", perRun: "50", problems: "none seen" } };
const bare = { id: "p1", name: "Pin", machine: "", material: "", steps: [], photos: [], facts: {} };
const tools = { st10: { tools: [{ t: "1", what: "rougher" }] } };
const prog = (over = {}) => ({ id: "g1", name: "O00017.nc", content: GOOD, status: "unproven", ...over });

// a stand-in for the part's program data, shaped like usePartPrograms' result
const ppFor = (programs = [], over = {}) => ({
  partId: "p1", programs, newest: programs[0] || null,
  newestInfo: programs[0] ? { info: { number: "O00017", title: "PIN", tools: [{ t: 1, note: "ROUGH" }], offsets: ["G54"], stops: 0, lines: 14 }, found: [], n: { stop: 0, look: 0, note: 0 }, time: { seconds: 91, stops: 0, unknown: 0 } } : null,
  derived: [], loading: false, busy: false, err: "", stops: 0, machineKind: "lathe",
  step: { at: "Proven", tone: "todo", text: "Prove it out at the machine, then stamp it proven.", done: { Program: true, Checks: true, Setup: true, Proven: false } },
  addFiles: vi.fn(async () => 1), prove: vi.fn(async () => true), remove: vi.fn(async () => true),
  ...over,
});

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => null);
});

describe("which questions get asked", () => {
  it("only the needed ones still open, so the button's count is the count asked", () => {
    const part = { ...bare, machine: "st10" };
    expect(wizardSteps(part, [prog()])).toEqual(["material", "stock", "holding", "byHand"]);
    expect(neededLeft(part, [prog()])).toBe(4);
  });
  it("once the needed ones are done, the optional ones still open", () => {
    const part = { ...full, sku: "", blueprintUrl: null, facts: { stock: "x", holding: "y", byHand: "z" } };
    expect(wizardSteps(part, [prog()])).toEqual(["byHandMin", "perRun", "sku", "drawing", "problems"]);
    expect(neededLeft(part, [prog()])).toBe(0);
  });
  it("reviewing asks everything, and a new part starts with its name", () => {
    expect(wizardSteps(full, [prog()], { all: true })).toEqual(WIZARD_STEPS.map((s) => s.key));
    expect(wizardSteps({ facts: {} }, [], { all: true })[0]).toBe("name");
  });
  it("doesn't ask how long the hand work takes when there isn't any", () => {
    const part = { ...full, facts: { ...full.facts, byHand: "Nothing", byHandMin: "" } };
    expect(wizardSteps(part, [prog()], { all: true })).not.toContain("byHandMin");
  });
  it("nothing left to ask for a part that's complete", () => {
    expect(wizardSteps(full, [prog()])).toEqual([]);
    expect(wizardAnswer("machine", full, [])).toBe("st10");
    expect(wizardAnswer("program", full, [prog()])).toBe("yes");
  });
});

describe("answering one question at a time", () => {
  const open = (keys, part = bare, pp = ppFor([prog()]), extra = {}) => {
    const onCommit = vi.fn(async () => "p1");
    const onClose = vi.fn();
    render(<CncWizard keys={keys} part={part} pp={pp} machineFacts={tools} onCommit={onCommit} onUploadDrawing={vi.fn(async () => "https://x/d.png")} onClose={onClose} onOpenMachines={vi.fn()} {...extra} />);
    return { onCommit, onClose };
  };

  it("shows one question, with where you are", () => {
    open(["material", "stock"]);
    expect(screen.getByText("Question 1 of 2")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "What's it made of?" })).toBeTruthy();
    expect(screen.queryByText("What does it start from?")).toBeNull();
  });

  it("Next saves the answer and moves on; Enter does the same", async () => {
    const { onCommit } = open(["material", "stock"]);
    fireEvent.change(screen.getByLabelText("What's it made of?"), { target: { value: "1018 steel" } });
    fireEvent.click(screen.getByRole("button", { name: /Next/ }));
    await screen.findByRole("heading", { name: "What does it start from?" });
    expect(onCommit).toHaveBeenCalledWith({ field: { material: "1018 steel" } });
    fireEvent.change(screen.getByLabelText("What does it start from?"), { target: { value: '1.25" bar' } });
    fireEvent.submit(screen.getByLabelText("What does it start from?").closest("form"));
    await waitFor(() => expect(onCommit).toHaveBeenCalledWith({ fact: { stock: '1.25" bar' } }));
    expect(await screen.findByText("That's it for now")).toBeTruthy();
  });

  it("a quick pick fills the box", () => {
    open(["material"]);
    fireEvent.click(screen.getByRole("button", { name: "6061 aluminum" }));
    expect(screen.getByLabelText("What's it made of?").value).toBe("6061 aluminum");
  });

  it("Skip moves on without saving, and Back comes back", async () => {
    const { onCommit } = open(["material", "stock"]);
    fireEvent.change(screen.getByLabelText("What's it made of?"), { target: { value: "typed but skipped" } });
    fireEvent.click(screen.getByRole("button", { name: "Skip for now" }));
    await screen.findByRole("heading", { name: "What does it start from?" });
    expect(onCommit).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /Back/ }));
    expect(screen.getByRole("heading", { name: "What's it made of?" })).toBeTruthy();
  });

  it("an answer that hasn't changed isn't saved again", async () => {
    const { onCommit } = open(["material"], full);
    expect(screen.getByLabelText("What's it made of?").value).toBe("1018 steel");
    expect(screen.getByRole("button", { name: "Leave as it is" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Finish/ }));
    await screen.findByText("That's it for now");
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("the machine question is three buttons, and two can be picked", async () => {
    const { onCommit } = open(["machine"]);
    fireEvent.click(screen.getByRole("button", { name: /ST-10/ }));
    fireEvent.click(screen.getByRole("button", { name: /VF-4/ }));
    fireEvent.click(screen.getByRole("button", { name: /Finish/ }));
    await waitFor(() => expect(onCommit).toHaveBeenCalledWith({ machine: "vf4,st10" }));
  });

  it("a new part can't get past its name without one", async () => {
    const { onCommit } = open(["name", "machine"], { facts: {} }, ppFor([]));
    fireEvent.click(screen.getByRole("button", { name: /Next/ }));
    expect(await screen.findByText(/needs a name/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Skip for now" }));
    expect(screen.getByRole("heading", { name: "What's this part called?" })).toBeTruthy();   // still here
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("a save that fails says why and stays on the question", async () => {
    const onCommit = vi.fn(async () => { throw new Error("SKU BP-3 is already on another part. Use a different one."); });
    open(["sku", "problems"], bare, ppFor([prog()]), { onCommit });
    fireEvent.change(screen.getByLabelText("Does it have a SKU or part number?"), { target: { value: "BP-3" } });
    fireEvent.click(screen.getByRole("button", { name: /Next/ }));
    expect(await screen.findByText(/already on another part/)).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Does it have a SKU or part number?" })).toBeTruthy();
  });

  it("the program question takes the file and shows what was read from it", async () => {
    const pp = ppFor([]);
    open(["program"], bare, pp);
    expect(screen.getByRole("button", { name: /Finish/ }).disabled).toBe(true);   // nothing to finish with yet
    fireEvent.change(screen.getByLabelText("Program file"), { target: { files: [new File([GOOD], "O00017.nc", { type: "text/plain" })] } });
    await waitFor(() => expect(pp.addFiles).toHaveBeenCalled());
    expect(pp.addFiles.mock.calls[0][0][0].name).toBe("O00017.nc");
  });

  it("finishing points at the machine's tool list when that's what's missing", async () => {
    const onOpenMachines = vi.fn();
    open(["problems"], { ...full, machine: "vf4" }, ppFor([prog()]), { onOpenMachines });
    fireEvent.click(screen.getByRole("button", { name: /Finish/ }));
    expect(await screen.findByText(/the VF-4 has no tool list yet/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Open Machines/ }));
    expect(onOpenMachines).toHaveBeenCalled();
  });

  it("closing hands back to the part", () => {
    const { onClose } = open(["material"]);
    fireEvent.click(screen.getByRole("button", { name: "Close the questions" }));
    expect(onClose).toHaveBeenCalled();
  });
});

describe("the overview's one next step", () => {
  const show = (part, pp, extra = {}) => {
    const onAsk = vi.fn();
    const onOpenMachines = vi.fn();
    render(<CncPartOverview part={part} pp={pp} machineFacts={tools} onAsk={onAsk} onDetails={vi.fn()} onOpenMachines={onOpenMachines} {...extra} />);
    return { onAsk, onOpenMachines };
  };
  const step = (at, text, done, tone = "todo") => ({ at, tone, text, done: { Program: false, Checks: false, Setup: false, Proven: false, ...done } });

  it("no program: add it", () => {
    const { onAsk } = show(full, ppFor([], { step: step("Program", "Upload this part's program file (the one off the Haas).") }));
    expect(screen.getByText("No program yet")).toBeTruthy();
    fireEvent.click(screen.getAllByRole("button", { name: /Add the program/ })[0]);
    expect(onAsk).toHaveBeenCalledWith({ only: ["program"] });
  });

  it("the checker found something: show it", () => {
    const pp = ppFor([prog({ content: BAD })], { stops: 1, step: step("Checks", "Fix the problem the checker found, then upload the fixed program.", { Program: true }, "stop") });
    pp.newestInfo.found = [{ level: "stop", text: "Constant surface speed is on (G96) with no top speed set first (G50 S).", line: 4 }];
    pp.newestInfo.n = { stop: 1, look: 0, note: 0 };
    show(full, pp);
    expect(screen.getByText("1 to fix")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /See what to fix/ }));
    expect(screen.getByText(/Constant surface speed is on/)).toBeTruthy();
  });

  it("questions still open: the button says how many, and asks exactly those", () => {
    const part = { ...bare, machine: "st10" };
    const { onAsk } = show(part, ppFor([prog()], { step: step("Setup", "4 things about the setup still need filling in.", { Program: true, Checks: true }) }));
    fireEvent.click(screen.getByRole("button", { name: /Answer 4 questions/ }));
    expect(onAsk).toHaveBeenCalledWith({});
    expect(screen.getByText("4 needed questions left.")).toBeTruthy();
  });

  it("answers in, no tool list: go and list the machine's tools", () => {
    const { onOpenMachines } = show({ ...full, machine: "vf4" }, ppFor([prog()]));
    fireEvent.click(screen.getByRole("button", { name: /List the VF-4's tools/ }));
    expect(onOpenMachines).toHaveBeenCalled();
  });

  it("everything in: prove it out, three ticks and a name", async () => {
    const pp = ppFor([prog()]);
    show(full, pp);
    fireEvent.click(screen.getByRole("button", { name: /Prove it out/ }));
    const stamp = screen.getByRole("button", { name: /Stamp it proven/ });
    expect(stamp.disabled).toBe(true);
    screen.getAllByRole("checkbox").filter((c) => c.closest(".cp-provebox")).forEach((c) => fireEvent.click(c));
    fireEvent.change(screen.getByLabelText("Who proved it out"), { target: { value: "Jesse" } });
    fireEvent.click(stamp);
    await waitFor(() => expect(pp.prove).toHaveBeenCalledWith("g1", true, "Jesse"));
  });

  it("proven: print the run sheet", () => {
    const pp = ppFor([prog({ status: "proven", provenBy: "Jesse" })], { step: step("", "Ready to run. Proven by Jesse.", { Program: true, Checks: true, Setup: true, Proven: true }, "done") });
    show(full, pp);
    expect(screen.getByText("Ready to run. Proven by Jesse.")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Print the run sheet/ })).toBeTruthy();
    expect(screen.getByText(/Proven · Jesse/)).toBeTruthy();
  });

  it("says nothing about next steps while the programs are still loading", () => {
    show(full, ppFor([], { loading: true }));
    expect(screen.getByText("Loading…")).toBeTruthy();
    expect(screen.queryByText(/Upload this part's program/)).toBeNull();
    expect(document.querySelector(".ov-go")).toBeNull();
  });
});
