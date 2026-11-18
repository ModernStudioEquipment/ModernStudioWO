// The three CNC machines, in one place. Floor Control, the wall monitor and
// the CNC Catalog all read this list, so a machine reads the same everywhere
// and adding one can't leave a screen behind.
export const MACHINES = [
  { key: "vf4", short: "VF-4", label: "Haas VF-4", color: "#FFB224" },
  { key: "st10", short: "ST-10", label: "Haas ST-10", color: "#FF8A5C" },
  { key: "ds30ssy", short: "DS-30SSY", label: "Haas DS-30SSY", color: "#F5CE3A" },
];
