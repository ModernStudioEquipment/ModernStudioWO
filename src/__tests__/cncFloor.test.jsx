import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import React from "react";
import CncProveOut, { proofLine } from "../floor/CncProveOut.jsx";
import { finishedSizes, addProblem } from "../floor/cncPack.js";
import { db } from "../lib/db.js";

// What the people at the machine add: what the first part measured, and what's
// wrong with a program.

const PIN = "%\nO00017 (PIN)\nG20 G40 G80 G99\nG50 S3000\nT0101 (CNMG ROUGH)\nG96 S400 M03\nG54 G00 X1.35 Z0.1 M08\nG71 P10 Q20 U0.02 W0.005 D0.08 F0.012\nN10 G00 X0.625\nG01 Z0. F0.006\nZ-1.\nX1.125\nZ-3.\nN20 X1.3\nG70 P10 Q20\nG00 X2. Z1.\nM30\n%\n";
const part = { id: "p1", name: "Pin", machine: "st10", facts: { stock: '1.25" bar' } };

describe("the sizes a program finishes at", () => {
  it("come from following the program, and only for a lathe part", () => {
    const s = finishedSizes(PIN, part, "lathe");
    expect(s.units).toBe("in");
    expect(s.steps.map((x) => Number(x.dia.toFixed(3)))).toEqual([0.625, 1.125]);
    expect(finishedSizes("O1\nT1 M06\nG54 G00 X0. Y0.\nG43 H01 Z1.\nG01 Z-0.1 F10.\nX1.\nM30\n", part, "mill")).toBeNull();
    expect(finishedSizes("", part, "lathe")).toBeNull();
  });
});

describe("proving out, with what the first part measured", () => {
  const sizes = finishedSizes(PIN, part, "lathe");
  const tick = () => screen.getAllByRole("checkbox").forEach((c) => fireEvent.click(c));

  it("lists each diameter with a box, and says how far off a measurement is", () => {
    render(<CncProveOut sizes={sizes} onStamp={() => {}} onCancel={() => {}} />);
    fireEvent.change(screen.getByLabelText("Measured Ø0.625"), { target: { value: "0.6248" } });
    expect(screen.getByText("−0.0002")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Measured Ø1.125"), { target: { value: "1.130" } });
    expect(screen.getByText("+0.005").className).toBe("off");        // more than two thou: shown as something to look at
    fireEvent.change(screen.getByLabelText("Measured Ø1.125"), { target: { value: "1.125" } });
    expect(screen.getByText("on size")).toBeTruthy();
  });

  it("keeps what was typed with the stamp, and stamps without it when nothing was", async () => {
    const onStamp = vi.fn();
    const { unmount } = render(<CncProveOut sizes={sizes} onStamp={onStamp} onCancel={() => {}} />);
    tick();
    fireEvent.change(screen.getByLabelText("Measured Ø0.625"), { target: { value: "0.6248" } });
    fireEvent.change(screen.getByLabelText("Measured Ø1.125"), { target: { value: "about right" } });   // not a number: left out
    fireEvent.change(screen.getByLabelText("Who proved it out"), { target: { value: "Jesse" } });
    fireEvent.click(screen.getByRole("button", { name: /Stamp it proven/ }));
    await waitFor(() => expect(onStamp).toHaveBeenCalled());
    const [by, record] = onStamp.mock.calls[0];
    expect(by).toBe("Jesse");
    expect(record.measured).toEqual([{ what: "Ø0.625", nominal: 0.625, got: 0.6248 }]);
    expect(record.units).toBe("in");
    unmount();

    const plain = vi.fn();
    render(<CncProveOut sizes={sizes} onStamp={plain} onCancel={() => {}} />);
    tick();
    fireEvent.change(screen.getByLabelText("Who proved it out"), { target: { value: "Moe" } });
    fireEvent.click(screen.getByRole("button", { name: /Stamp it proven/ }));
    await waitFor(() => expect(plain).toHaveBeenCalledWith("Moe", null));
  });

  it("a mill part, with no sizes to list, proves out the way it always did", () => {
    render(<CncProveOut sizes={null} onStamp={() => {}} onCancel={() => {}} />);
    expect(screen.queryByText(/What did the first part measure/)).toBeNull();
    expect(screen.getAllByRole("checkbox")).toHaveLength(3);
  });

  it("the record is saved with the program, read back, and cleared when the stamp is taken off", async () => {
    localStorage.clear();
    const id = await db.addCncProgram({ partId: "p1", name: "O00017.nc", content: PIN });
    const record = { measured: [{ what: "Ø0.625", nominal: 0.625, got: 0.6248 }, { what: "Ø1.125", nominal: 1.125, got: 1.125 }], units: "in", at: 1 };
    await db.setCncProgramProven(id, true, "Jesse", record);
    const saved = (await db.getCncPrograms("p1"))[0];
    expect(saved.status).toBe("proven");
    expect(saved.proof).toEqual(record);
    expect(proofLine(saved.proof)).toBe("First part: Ø0.625 measured 0.6248 (−0.0002), Ø1.125 measured 1.125.");
    expect(saved.info.tools[0].t).toBe(1);                 // what was read from the program is still there
    await db.setCncProgramProven(id, false);
    expect((await db.getCncPrograms("p1"))[0].proof).toBeNull();
    expect(proofLine(null)).toBe("");
  });
});

describe("a problem reported from the machine", () => {
  const when = new Date(2026, 10, 25);
  it("is added under what's already there, with the date and who said it", () => {
    expect(addProblem({ facts: {} }, "  Chatter on the\nlong turn ", "Moe", when).facts.problems).toBe("11/25 Moe: Chatter on the long turn");
    expect(addProblem({ facts: { problems: "Thread tight" } }, "Burr on the back", "", when).facts.problems).toBe("Thread tight\n11/25: Burr on the back");
  });
  it("leaves the part alone when nothing was said", () => {
    const p = { facts: { problems: "x" } };
    expect(addProblem(p, "   ", "Moe", when)).toBe(p);
  });
  it("keeps everything else on the part", () => {
    const p = { id: "p1", name: "Pin", facts: { stock: "1.25", byHand: "deburr" } };
    expect(addProblem(p, "Too slow", "J", when)).toMatchObject({ id: "p1", name: "Pin", facts: { stock: "1.25", byHand: "deburr", problems: "11/25 J: Too slow" } });
  });
});

describe("a machine's tool list on paper", () => {
  it("prints what's saved, pocket by pocket in order, with room to write a change", async () => {
    const { default: CncToolSheet } = await import("../floor/CncToolSheet.jsx");
    const machine = { key: "st10", short: "ST-10", label: "Haas ST-10" };
    render(<CncToolSheet machine={machine} facts={{ model: "2019", holding: "8 inch 3-jaw", tools: [{ t: "5", what: "Thread 60 deg" }, { t: "1", what: "CNMG rough turn" }, { t: "", what: "" }] }} onClose={() => {}} />);
    const sheet = document.getElementById("wo");
    expect(sheet.querySelector(".rs-title").textContent).toBe("Haas ST-10");
    expect([...sheet.querySelectorAll("tbody tr")].map((r) => r.children[0].textContent + " " + r.children[1].textContent)).toEqual(["T1 CNMG rough turn", "T5 Thread 60 deg"]);
    expect(sheet.textContent).toMatch(/2 tools listed/);
    expect(sheet.textContent).toMatch(/Holds work with8 inch 3-jaw/);
    expect(sheet.textContent).toMatch(/Programs are checked against this list/);
  });
});
