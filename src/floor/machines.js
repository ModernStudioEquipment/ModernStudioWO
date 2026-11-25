// The three CNC machines, in one place. Floor Control, the wall monitor and
// the CNC Catalog all read this list, so a machine reads the same everywhere
// and adding one can't leave a screen behind. `kind` is what the program
// checker goes by: a mill and a lathe make different mistakes. `about` is what
// the AI is told the machine is (the shop's own notes come from the Machines
// page on top of this).
//
// (The ST-10Y's key stays "st10": that's what parts and work orders already
// store. Its name was corrected from a photo of the machine, 2026-11-25.)
export const MACHINES = [
  { key: "vf4", short: "VF-4", label: "Haas VF-4", color: "#FFB224", kind: "mill",
    about: "Vertical machining center: a 3-axis mill (X, Y, Z) with a tool changer. Work is held in a vise or a fixture on the table." },
  { key: "st10", short: "ST-10Y", label: "Haas ST-10Y", color: "#FF8A5C", kind: "lathe",
    about: "Turning center with one spindle and a turret with live tooling and a Y axis: it can drill, tap and mill off the centre line as well as turn. From a photo it appears to run the older Haas control (the blue screen)." },
  { key: "ds30ssy", short: "DS-30SSY", label: "Haas DS-30SSY", color: "#F5CE3A", kind: "lathe",
    about: "Dual-spindle turning center: a main spindle and a sub-spindle that can take the part over to work its back end, plus live tooling and a Y axis." },
];
