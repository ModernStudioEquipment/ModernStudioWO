// The three CNC machines, in one place. Floor Control, the wall monitor and
// the CNC Catalog all read this list, so a machine reads the same everywhere
// and adding one can't leave a screen behind. `kind` is what the program
// checker goes by: a mill and a lathe make different mistakes.
export const MACHINES = [
  { key: "vf4", short: "VF-4", label: "Haas VF-4", color: "#FFB224", kind: "mill" },
  { key: "st10", short: "ST-10", label: "Haas ST-10", color: "#FF8A5C", kind: "lathe" },
  { key: "ds30ssy", short: "DS-30SSY", label: "Haas DS-30SSY", color: "#F5CE3A", kind: "lathe" },
];
