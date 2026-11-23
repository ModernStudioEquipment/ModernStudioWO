import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import React from "react";
import { RepairTicketDoc, fitToPage, unfit } from "../components/repairs/RepairTicketDoc.jsx";

// The ticket is filled in on the paper form itself: every blank is something
// you can click and type into, and Save keeps exactly what was typed.

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

const open = (props = {}) => {
  const onSave = props.onSave || vi.fn(async () => "new-id");
  const onClose = props.onClose || vi.fn();
  render(<RepairTicketDoc repair={props.repair ?? null} onSave={onSave} onClose={onClose} />);
  return { onSave, onClose };
};
const type = (label, value) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

describe("filling in the ticket", () => {
  it("has every box from the paper form", () => {
    open();
    for (const l of ["Received By", "Date Received", "Completion Date", "Order number", "Company", "Address", "Contact", "Phone #", "Email",
      "Repairs count", "Recovers count", "Refurbish count", "Other count", "Line 1 department", "Line 1 quantity", "Line 1 description", "Line 1 notes", "Line 28 notes"]) {
      expect(screen.getByLabelText(l)).toBeTruthy();
    }
    for (const t of ["CLIENT INFORMATION", "SERVICES ORDERED", "ITEMS TO BE SERVICED", "ORDER NUMBER", "(Estimated and Subject to Change)"]) {
      expect(screen.getByText(t)).toBeTruthy();
    }
  });

  it("each ruled line is one click target (a label around its input)", () => {
    open();
    const input = screen.getByLabelText("Company");
    expect(input.closest("label")).toBeTruthy();
    expect(input.closest("label").textContent).toContain("Company");
  });

  it("saves exactly what was typed, without the blank lines", async () => {
    const { onSave } = open();
    type("Company", "Acme Studios");
    type("Contact", "Dana");
    type("Phone #", "818-555-0101");
    type("Line 1 description", "C-stand, bent riser");
    type("Line 1 quantity", "2");
    type("Line 2 description", "Apple box set");
    type("Recovers count", "1");
    fireEvent.click(screen.getByRole("button", { name: "Yes" }));
    fireEvent.click(screen.getByRole("button", { name: /^Save$/ }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    const { id, fields, status } = onSave.mock.calls[0][0];
    expect(id).toBeNull();
    expect(status).toBe("open");
    expect(fields.company).toBe("Acme Studios");
    expect(fields.phone).toBe("818-555-0101");
    expect(fields.recovers).toBe("1");
    expect(fields.quote).toBe("yes");
    expect(fields.lines).toHaveLength(2);
    expect(fields.lines[0]).toEqual({ dept: "", qty: "2", description: "C-stand, bent riser", notes: "" });
  });

  it("Yes and No are one choice, and a second click clears it", () => {
    open();
    const yes = screen.getByRole("button", { name: "Yes" });
    const no = screen.getByRole("button", { name: "No" });
    fireEvent.click(yes);
    expect(yes.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(no);
    expect(yes.getAttribute("aria-pressed")).toBe("false");
    expect(no.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(no);
    expect(no.getAttribute("aria-pressed")).toBe("false");
  });

  it("the table never runs out: typing on the last line adds another", () => {
    open();
    expect(screen.queryByLabelText("Line 29 description")).toBeNull();
    type("Line 28 description", "one more");
    expect(screen.getByLabelText("Line 29 description")).toBeTruthy();
  });

  it("won't save a ticket with nothing on it", async () => {
    const { onSave } = open();
    fireEvent.click(screen.getByRole("button", { name: /^Save$/ }));
    expect(await screen.findByText(/Nothing typed on the ticket yet/)).toBeTruthy();
    expect(onSave).not.toHaveBeenCalled();
  });

  it("a saved ticket saves again as an update, with the status picked", async () => {
    const onSave = vi.fn(async ({ id }) => id);
    open({ onSave, repair: { id: "r1", status: "open", fields: { company: "Acme", lines: [{ description: "Chair" }] } } });
    expect(screen.getByLabelText("Company").value).toBe("Acme");
    fireEvent.change(screen.getByDisplayValue("In the shop"), { target: { value: "ready" } });
    fireEvent.click(screen.getByRole("button", { name: /^Save$/ }));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0][0]).toMatchObject({ id: "r1", status: "ready" });
  });

  it("asks before closing with unsaved typing, and not after a save", async () => {
    const { onClose } = open();
    type("Company", "Acme");
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText(/Unsaved repair ticket/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Save and close/ }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it("Save & Print saves first, then prints", async () => {
    const print = vi.spyOn(window, "print").mockImplementation(() => {});
    const { onSave } = open();
    type("Company", "Acme");
    fireEvent.click(screen.getByRole("button", { name: /Save & Print/ }));
    await waitFor(() => expect(print).toHaveBeenCalled());
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it("the printable sheet is the #wo element the print rules keep", () => {
    open();
    const sheet = document.getElementById("wo");
    expect(sheet).toBeTruthy();
    expect(within(sheet).getByText("ITEMS TO BE SERVICED")).toBeTruthy();
    // The toolbar and status picker are screen only.
    expect(sheet.querySelector("select")).toBeNull();
    expect(sheet.textContent).not.toMatch(/Save/);
  });
});

describe("printing on one page", () => {
  it("leaves the spare empty row past the paper's 28 off the printout, never a filled one", () => {
    open();
    type("Line 28 description", "the 28th item"); // opens a 29th line
    const sheet = document.getElementById("wo");
    expect(sheet.querySelectorAll(".rt-table tbody tr")).toHaveLength(29);
    expect(fitToPage(sheet)).toBe(1);
    const hidden = [...sheet.querySelectorAll(".rt-spare")];
    expect(hidden).toHaveLength(1);
    expect(hidden[0].querySelector("textarea").value).toBe("");
    unfit(sheet);
    expect(sheet.querySelectorAll(".rt-spare")).toHaveLength(0);
  });
  it("hides nothing on a ticket that already fits", () => {
    open();
    type("Line 1 description", "one item");
    expect(fitToPage(document.getElementById("wo"))).toBe(0);
  });
});

describe("the Repairs tab on the board", () => {
  it("is in the nav, opens, and keeps a new ticket", async () => {
    window.scrollTo = vi.fn(); // the tab click scrolls to the top; jsdom has no scrolling
    const { default: App } = await import("../App.jsx");
    render(<App />);
    const tab = (await screen.findAllByText(/^Repairs/)).find((el) => el.closest("button"));
    fireEvent.click(tab.closest("button"));
    expect(await screen.findByText(/No repairs in the building/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /New repair ticket/ }));
    fireEvent.change(screen.getByLabelText("Company"), { target: { value: "Acme Studios" } });
    fireEvent.change(screen.getByLabelText("Line 1 description"), { target: { value: "Bent C-stand" } });
    fireEvent.click(screen.getByRole("button", { name: /^Save$/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Close" }));
    expect(await screen.findByText("Acme Studios")).toBeTruthy();
    expect(screen.getByText(/1 item: Bent C-stand/)).toBeTruthy();
    // and it's really stored
    expect(JSON.parse(localStorage.getItem("mse_repairs_v1"))[0].fields.company).toBe("Acme Studios");
  }, 30000);
});
