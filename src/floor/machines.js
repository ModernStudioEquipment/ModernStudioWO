// The three CNC machines, in one place. Floor Control, the wall monitor and
// the CNC Catalog all read this list, so a machine reads the same everywhere
// and adding one can't leave a screen behind. `kind` is what the program
// checker goes by: a mill and a lathe make different mistakes. `about` is what
// the AI is told the machine is (the shop's own notes come from the Machines
// page on top of this).
//
// (The ST-10Y's key stays "st10": that's what parts and work orders already
// store. Its name was corrected from a photo of the machine, 2026-11-25.)
// The two Haas controls, and Haas's own operator's manual for each, with the
// pictures of the control panel and keypad. Haas's site turns away automated
// downloads, so these are links for a person (and names for the AI to search
// by), not copies.
export const CONTROLS = {
  classic: {
    label: "Classic Haas Control",
    looks: "Older. Blue and grey screen, mostly text, keys only.",
    manual: {
      lathe: { name: "Haas Lathe Operator's Manual 96-8700, Rev U (2008)", url: "https://service.haascnc.com/sites/default/files/Locked/Manuals/Operator/2008/Lathe/Lathe_Operators_Manual_96-8700U_9_Rev_U_English_June_2008.pdf" },
      mill: { name: "Haas Mill Operator's Manual (2016)", url: "https://haascnc.com/content/dam/haascnc/en/service/manual/operator/english---mill-operator's-manual---2016.pdf" },
    },
  },
  ngc: {
    label: "Next Generation Control (NGC)",
    looks: "Newer (about 2017 on). Black screen with colour graphics and tabs.",
    manual: {
      lathe: { name: "Haas Lathe Operator's Manual, NGC: Control Pendant", url: "https://haascnc.com/service/online-operator-s-manuals/lathe-operator-s-manual/lathe---control-pendant.html" },
      mill: { name: "Haas Mill Operator's Manual, NGC: Control Pendant", url: "https://haascnc.com/service/online-operator-s-manuals/mill-operator-s-manual/mill---control-pendant.html" },
    },
  },
};
export const controlOf = (machine, facts) => {
  const c = CONTROLS[facts?.control];
  return c ? { key: facts.control, ...c, manual: c.manual[machine?.kind === "mill" ? "mill" : "lathe"] } : null;
};

export const MACHINES = [
  { key: "vf4", short: "VF-4", label: "Haas VF-4", color: "#FFB224", kind: "mill",
    about: "Vertical machining center: a 3-axis mill (X, Y, Z) with a tool changer. Work is held in a vise or a fixture on the table." },
  { key: "st10", short: "ST-10Y", label: "Haas ST-10Y", color: "#FF8A5C", kind: "lathe",
    about: "Turning center with one spindle and a turret with live tooling and a Y axis: it can drill, tap and mill off the centre line as well as turn. From a photo it appears to run the older Haas control (the blue screen)." },
  { key: "ds30ssy", short: "DS-30SSY", label: "Haas DS-30SSY", color: "#F5CE3A", kind: "lathe",
    about: "Dual-spindle turning center: a main spindle and a sub-spindle that can take the part over to work its back end, plus live tooling and a Y axis." },
];
