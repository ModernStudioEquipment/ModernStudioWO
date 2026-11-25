// The Haas control panels in the CNC room, key for key, from photos of them
// (2026-11-25): the Next Generation Control on the VF-4, and the Classic Haas
// Control on the ST-10Y and the DS-30SSY. CncControlPanel.jsx draws them; the
// guides below step through everyday jobs with an arrow on each key to press.
//
// A key: { id, label, tone, w?, shift?, shape? }
//   tone   grey (most keys), red (RESET), teal (power up, chip, coolant, cursor
//          ends), cream (jog arrows and cursor arrows), alpha (letters and numbers)
//   w      width in key units (1 by default)
//   shift  the small yellow character printed in the corner (numbers)
//   shape  "mode" for the arrow-shaped mode keys; "arrow-up" and so on for jog
//          and cursor keys, drawn as an arrow with the label beside it
// A row is an array of keys; null is a gap one key wide.

const k = (id, label, tone = "grey", more = {}) => ({ id, label, tone, ...more });

// ---- the parts both controls share ------------------------------------------------
const CURSOR = [
  [k("home", "HOME", "teal"), k("up", "", "cream", { shape: "arrow-up" }), k("pageup", "PAGE\nUP", "teal")],
  [k("left", "", "cream", { shape: "arrow-left" }), { label: "CURSOR", text: true }, k("right", "", "cream", { shape: "arrow-right" })],
  [k("end", "END", "teal"), k("down", "", "cream", { shape: "arrow-down" }), k("pagedown", "PAGE\nDOWN", "teal")],
];
const LETTERS = [
  [k("shift", "SHIFT", "shift"), ..."ABCDE".split("").map((c) => k(c, c, "alpha"))],
  "FGHIJK".split("").map((c) => k(c, c, "alpha")),
  "LMNOPQ".split("").map((c) => k(c, c, "alpha")),
  "RSTUVW".split("").map((c) => k(c, c, "alpha")),
  [k("X", "X", "alpha"), k("Y", "Y", "alpha"), k("Z", "Z", "alpha"), k("semi", ";", "alpha"), k("lparen", "(", "alpha"), k("rparen", ")", "alpha")],
];
const NUMBERS = [
  [k("7", "7", "alpha", { shift: "&" }), k("8", "8", "alpha", { shift: "@" }), k("9", "9", "alpha", { shift: ":" })],
  [k("4", "4", "alpha", { shift: "%" }), k("5", "5", "alpha", { shift: "$" }), k("6", "6", "alpha", { shift: "!" })],
  [k("1", "1", "alpha", { shift: "*" }), k("2", "2", "alpha", { shift: "'" }), k("3", "3", "alpha", { shift: "?" })],
  [k("minus", "-", "alpha", { shift: "+" }), k("0", "0", "alpha", { shift: "=" }), k("dot", ".", "alpha", { shift: "#" })],
];
const ENTRY = [[k("cancel", "CANCEL", "alpha"), k("space", "SPACE", "alpha"), k("enter", "ENTER", "alpha")]];
const OVERRIDES = [
  [k("feed-10", "-10%\nFEEDRATE"), k("feed100", "100%\nFEEDRATE"), k("feed+10", "+10%\nFEEDRATE"), k("handlefeed", "HANDLE\nFEED")],
  [k("spin-10", "-10%\nSPINDLE"), k("spin100", "100%\nSPINDLE"), k("spin+10", "+10%\nSPINDLE"), k("handlespin", "HANDLE\nSPINDLE")],
  [k("fwd", "FWD"), k("stop", "STOP"), k("rev", "REV"), { label: "SPINDLE", text: true }],
  [k("rapid5", "5%\nRAPID"), k("rapid25", "25%\nRAPID"), k("rapid50", "50%\nRAPID"), k("rapid100", "100%\nRAPID")],
];

// ---- the two controls ------------------------------------------------------------------
export const PANELS = {
  // VF-4: Next Generation Control
  ngc: {
    name: "Next Generation Control",
    top: [[k("reset", "RESET", "red", { w: 2 }), k("powerup", "POWER UP", "teal"), k("recover", "RECOVER", "teal")]],
    fkeys: [[k("f1", "F1"), k("f2", "F2"), k("f3", "F3"), k("f4", "F4")]],
    functions: [[k("toolmeasure", "TOOL\nOFFSET\nMEASURE"), k("nexttool", "NEXT\nTOOL"), k("toolrelease", "TOOL\nRELEASE"), k("partzero", "PART\nZERO\nSET")]],
    jog: [
      [k("chipfwd", "CHIP\nFWD", "teal"), k("+a", "+B\n+A/C", "cream", { shape: "arrow-upleft" }), k("+z", "+Z", "cream", { shape: "arrow-up" }), k("-y", "-Y", "cream", { shape: "arrow-upright" }), k("clntup", "CLNT\nUP", "teal")],
      [k("chipstop", "CHIP\nSTOP", "teal"), k("+x", "+X", "cream", { shape: "arrow-left" }), k("joglock", "JOG\nLOCK", "cream"), k("-x", "-X", "cream", { shape: "arrow-right" }), k("clntdown", "CLNT\nDOWN", "teal")],
      [k("chiprev", "CHIP\nREV", "teal"), k("+y", "+Y", "cream", { shape: "arrow-downleft" }), k("-z", "-Z", "cream", { shape: "arrow-down" }), k("-a", "-A/C\n-B", "cream", { shape: "arrow-downright" }), k("auxclnt", "AUX\nCLNT", "teal")],
    ],
    overrides: OVERRIDES,
    display: [
      [k("program", "PROGRAM"), k("position", "POSITION"), k("offset", "OFFSET"), k("curcmds", "CURRENT\nCOMMANDS")],
      [k("alarms", "ALARMS"), k("diagnostic", "DIAGNOSTIC"), k("setting", "SETTING"), k("help", "HELP")],
    ],
    cursor: CURSOR,
    modes: [
      [k("edit", "EDIT", "grey", { shape: "mode" }), k("insert", "INSERT"), k("alter", "ALTER"), k("delete", "DELETE"), k("undo", "UNDO")],
      [k("memory", "MEMORY", "grey", { shape: "mode" }), k("singleblock", "SINGLE\nBLOCK"), k("graphics", "GRAPHICS"), k("optstop", "OPTION\nSTOP"), k("blockdelete", "BLOCK\nDELETE")],
      [k("mdi", "MDI", "grey", { shape: "mode" }), k("coolant", "COOLANT"), k("handlescroll", "HANDLE\nSCROLL"), k("atcfwd", "ATC\nFWD"), k("atcrev", "ATC\nREV")],
      [k("handlejog", "HANDLE\nJOG", "grey", { shape: "mode" }), k("inc1", ".0001\n.1"), k("inc2", ".001\n1."), k("inc3", ".01\n10."), k("inc4", ".1\n100.")],
      [k("zeroreturn", "ZERO\nRETURN", "grey", { shape: "mode" }), k("all", "ALL"), k("origin", "ORIGIN"), k("single", "SINGLE"), k("homeg28", "HOME\nG28")],
      [k("listprogram", "LIST\nPROGRAM", "grey", { shape: "mode" }), k("selectprogram", "SELECT\nPROGRAM"), k("back", "", "grey", { shape: "arrow-left" }), k("forward", "", "grey", { shape: "arrow-right" }), k("eraseprogram", "ERASE\nPROGRAM")],
    ],
    letters: LETTERS, numbers: NUMBERS, entry: ENTRY,
  },
  // ST-10Y and DS-30SSY: Classic Haas Control
  classic: {
    name: "Classic Haas Control",
    top: [[k("reset", "RESET", "red", { w: 2 }), k("powerup", "POWER UP\nRESTART", "teal"), k("autooff", "AUTO\nOFF", "teal")]],
    fkeys: [[k("f1", "F1"), k("f2", "F2"), k("f3", "F3"), k("f4", "F4")]],
    functions: [[k("xdia", "X\nDIAMETER\nMEASURE"), k("nexttool", "NEXT\nTOOL"), k("xz", "X / Z"), k("zface", "Z\nFACE\nMEASURE")]],
    jog: [
      [k("tsleft", "TS\n←", "teal"), k("-c", "-C", "cream", { shape: "arrow-upleft" }), k("+x", "+X", "cream", { shape: "arrow-up" }), k("+y", "+Y", "cream", { shape: "arrow-upright" }), k("chipfwd", "CHIP\nFWD", "teal")],
      [k("tsrapid", "TS\nRAPID", "teal"), k("-z", "-Z", "cream", { shape: "arrow-left" }), k("rapid", "RAPID", "cream"), k("+z", "+Z", "cream", { shape: "arrow-right" }), k("chipstop", "CHIP\nSTOP", "teal")],
      [k("tsright", "TS\n→", "teal"), k("-y", "-Y", "cream", { shape: "arrow-downleft" }), k("-x", "-X", "cream", { shape: "arrow-down" }), k("+c", "+C", "cream", { shape: "arrow-downright" }), k("chiprev", "CHIP\nREV", "teal")],
    ],
    overrides: OVERRIDES.map((row) => row.map((x) => (x?.id === "handlefeed" ? k("handlefeed", "HANDLE\nCONTROL\nFEED") : x?.id === "handlespin" ? k("handlespin", "HANDLE\nCONTROL\nSPINDLE") : x))),
    display: [
      [k("program", "PROGRAM"), k("position", "POSITION"), k("offset", "OFFSET"), k("curcmds", "CURRENT\nCOMMANDS")],
      [k("alarms", "ALARMS"), k("paramdgnos", "PARAMETER\nDIAGNOSTIC"), k("setgraph", "SETTING\nGRAPHIC"), k("help", "HELP")],
    ],
    cursor: CURSOR,
    modes: [
      [k("edit", "EDIT", "grey", { shape: "mode" }), k("insert", "INSERT"), k("alter", "ALTER"), k("delete", "DELETE"), k("undo", "UNDO")],
      [k("memory", "MEMORY", "grey", { shape: "mode" }), k("singleblock", "SINGLE\nBLOCK"), k("dryrun", "DRY\nRUN"), k("optstop", "OPTION\nSTOP"), k("blockdelete", "BLOCK\nDELETE")],
      [k("mdi", "MDI\nDNC", "grey", { shape: "mode" }), k("coolant", "COOLANT"), k("spindlejog", "SPINDLE\nJOG"), k("turretfwd", "TURRET\nFWD"), k("turretrev", "TURRET\nREV")],
      [k("handlejog", "HANDLE\nJOG", "grey", { shape: "mode" }), k("inc1", ".0001\n.1"), k("inc2", ".001\n1."), k("inc3", ".01\n10."), k("inc4", ".1\n100.")],
      [k("zeroreturn", "ZERO\nRETURN", "grey", { shape: "mode" }), k("all", "ALL"), k("origin", "ORIGIN"), k("single", "SINGLE"), k("homeg28", "HOME\nG28")],
      [k("listprogram", "LIST\nPROGRAM", "grey", { shape: "mode" }), k("selectprogram", "SELECT\nPROGRAM"), k("send", "SEND"), k("receive", "RECEIVE"), k("eraseprogram", "ERASE\nPROGRAM")],
    ],
    letters: LETTERS, numbers: NUMBERS, entry: ENTRY,
  },
};
// The round buttons and the handle, beside the keys on both.
export const BIG = { cyclestart: "CYCLE START", feedhold: "FEED HOLD", estop: "EMERGENCY STOP", handle: "HANDLE JOG", poweron: "POWER ON", poweroff: "POWER OFF" };

export const panelFor = (control) => PANELS[control] || null;
export function allKeys(panel) {
  const out = new Map();
  for (const block of ["top", "fkeys", "functions", "jog", "overrides", "display", "cursor", "modes", "letters", "numbers", "entry"]) {
    for (const row of panel[block] || []) for (const x of row) if (x?.id) out.set(x.id, x);
  }
  for (const [id, label] of Object.entries(BIG)) out.set(id, { id, label, tone: "big" });
  return out;
}
export const keyName = (panel, id) => {
  const x = allKeys(panel).get(id);
  if (!x) return id;
  return (x.label || "").replace(/\n/g, " ").trim() || ({ up: "up arrow", down: "down arrow", left: "left arrow", right: "right arrow", back: "back arrow", forward: "forward arrow" })[id] || id;
};

// What a key does, for tapping one to find out. Only the keys people ask about.
export const KEY_HELP = {
  reset: "Stops the program and clears alarms. The machine stops where it is.",
  powerup: "After switching the machine on: homes every axis. Keep clear of the machine.",
  recover: "Gets the tool changer going again after it stopped part way.",
  autooff: "Turns the machine off when the program ends.",
  cyclestart: "Starts the program, or the next line in single block.",
  feedhold: "Pauses the moves. Press CYCLE START to carry on.",
  estop: "Stops everything at once. Twist to release, then RESET.",
  handle: "Moves the chosen axis by the chosen step when you turn it, in HANDLE JOG.",
  memory: "Run mode: runs the selected program.",
  mdi: "Type one or more lines and run them without a program.",
  edit: "Edit the program.",
  handlejog: "Move an axis by hand with the handle.",
  zeroreturn: "Send axes home.",
  listprogram: "The list of programs in memory and on a USB stick.",
  selectprogram: "Makes the highlighted program the one that runs.",
  singleblock: "Runs one line each time CYCLE START is pressed.",
  optstop: "Stops at each M01 in the program.",
  blockdelete: "Skips lines that start with a slash (/).",
  graphics: "Draws the program's path on the screen without moving the machine.",
  setgraph: "Settings, and (pressed again) the graphics page that draws the program without moving.",
  dryrun: "Runs the program at a set speed with no cutting speeds, to check the moves.",
  offset: "The tool and work offset pages.",
  program: "The program screen.",
  position: "Where each axis is, and how far it has to go.",
  alarms: "What alarm is showing, and what it means.",
  toolmeasure: "Records the tool's length (on the tool offset page) with the tool touched off.",
  partzero: "Sets the work offset for the highlighted axis to where the machine is now.",
  nexttool: "Goes to the next tool when setting offsets.",
  toolrelease: "Lets go of the tool in the spindle (hold the tool first).",
  xdia: "Sets a tool's X offset from a diameter you measured.",
  zface: "Sets a tool's Z offset with the tool touched on the part's face.",
  all: "In ZERO RETURN: homes every axis.",
  homeg28: "Sends the axes to the home position.",
  rapid25: "Rapids at a quarter speed. Use it when running something new.",
  rapid5: "Rapids at 5%: the slowest.",
  rapid100: "Full speed rapids.",
  coolant: "Coolant on and off.",
  turretfwd: "Turns the turret to the next tool.",
  turretrev: "Turns the turret to the previous tool.",
  atcfwd: "Turns the tool changer to the next tool.",
  atcrev: "Turns the tool changer to the previous tool.",
  inc1: "Handle step: .0001 per click.",
  inc2: "Handle step: .001 per click.",
  inc3: "Handle step: .01 per click.",
  inc4: "Handle step: .1 per click.",
  insert: "Adds what's typed after the highlighted line.",
  alter: "Replaces the highlighted word with what's typed.",
  delete: "Deletes the highlighted word.",
  undo: "Undoes the last edit.",
  cancel: "Clears what's been typed.",
  enter: "Puts in what's been typed.",
};

// ---- the guides -------------------------------------------------------------------------
//
// Each step: the keys to press (in order, numbered on the panel) and what to
// say. "Written from Haas's general instructions" until a lead tries it on the
// machine and marks it checked: what a step says can be changed on the page,
// and the change is kept with the machine (see cleanGuides).
const step = (keys, say) => ({ keys, say });
const COMMON = (p) => [
  {
    id: "start", title: "Turn it on and home it",
    steps: [
      step(["poweron"], "Switch the main power on at the back, then press POWER ON."),
      step(["estop"], "If EMERGENCY STOP is pushed in, twist it to release it."),
      step(["reset"], "Press RESET to clear the start-up alarms."),
      step(["powerup"], `Press ${p === "ngc" ? "POWER UP" : "POWER UP / RESTART"}. Every axis goes home. Stay clear of the machine.`),
    ],
  },
  {
    id: "firstrun", title: "Run a new program safely the first time",
    steps: [
      step(["listprogram", "down", "selectprogram"], "Press LIST PROGRAM, move to the program with the arrows, and press SELECT PROGRAM."),
      step([p === "ngc" ? "graphics" : "setgraph", "cyclestart"], p === "ngc" ? "Press GRAPHICS, then CYCLE START. It draws the path without moving. Check it looks right." : "Press SETTING / GRAPHIC until the graphics page shows, then CYCLE START. It draws the path without moving. Check it looks right."),
      step(["memory"], "Press MEMORY to go back to running the program."),
      step(["singleblock", "rapid25", "optstop"], "Turn on SINGLE BLOCK, press 25% RAPID, and turn on OPTION STOP."),
      step(["position"], "Press POSITION so DIST TO GO shows how far each move has left."),
      step(["cyclestart"], "Press CYCLE START. Each press runs one line. Before each press, check where it's about to go."),
      step(["feedhold"], "If anything looks wrong, press FEED HOLD. In an emergency, EMERGENCY STOP."),
    ],
  },
  {
    id: "alarm", title: "Stop it and clear an alarm",
    steps: [
      step(["feedhold"], "FEED HOLD pauses the moves. CYCLE START carries on."),
      step(["alarms"], "Press ALARMS to read what the alarm says."),
      step(["reset"], "Fix the cause, then press RESET to clear it."),
    ],
  },
  {
    id: "jog", title: "Move an axis by hand",
    steps: [
      step(["handlejog"], "Press HANDLE JOG."),
      step(["inc2"], "Pick how far one click moves: .001 is a good start."),
      step([p === "ngc" ? "+z" : "+x"], `Press the axis to move (${p === "ngc" ? "+Z here" : "+X here"}).`),
      step(["handle"], "Turn the handle. Clockwise is plus, anticlockwise is minus. Go slowly near the part."),
    ],
  },
  {
    id: "mdi", title: "Run one line by hand (MDI)",
    steps: [
      step(["mdi"], `Press ${p === "ngc" ? "MDI" : "MDI / DNC"}.`),
      step(["G", "2", "8", "enter"], "Type the line, for example G28, and press ENTER (INSERT on some screens)."),
      step(["rapid25", "cyclestart"], "Turn the rapids down, then press CYCLE START."),
    ],
  },
];
export const GUIDES = {
  ngc: [
    ...COMMON("ngc"),
    {
      id: "toollength", title: "Set a tool's length offset",
      steps: [
        step(["mdi", "T", "4", "M", "6", "enter", "cyclestart"], "Load the tool: in MDI type T4 M6 (with your tool number), ENTER, then CYCLE START."),
        step(["offset"], "Press OFFSET and go to the tool offset page."),
        step(["handlejog", "inc2", "-z", "handle"], "In HANDLE JOG, bring the tool down onto the setter or the part (a piece of paper should just drag)."),
        step(["toolmeasure"], "Press TOOL OFFSET MEASURE. The length is recorded for that tool."),
        step(["nexttool"], "Press NEXT TOOL to do the next one."),
      ],
    },
    {
      id: "partzero", title: "Set the part zero (work offset)",
      steps: [
        step(["offset"], "Press OFFSET and go to the work offset page (G54)."),
        step(["handlejog", "+x", "handle"], "In HANDLE JOG, put the spindle on the zero point with the edge finder or probe."),
        step(["right"], "Move the cursor to the axis to set (X, Y or Z)."),
        step(["partzero"], "Press PART ZERO SET. That axis's zero is set to where the machine is now."),
      ],
    },
  ],
  classic: [
    ...COMMON("classic"),
    {
      id: "xoffset", title: "Set a tool's X offset",
      steps: [
        step(["handlejog", "-z", "handle"], "Take a light skim cut along the diameter with the tool, then move away in Z only (don't move X)."),
        step(["offset"], "Stop the spindle, measure the diameter, and press OFFSET to show the tool geometry page."),
        step(["down"], "Move the cursor to that tool's row."),
        step(["xdia", "1", "dot", "2", "5", "0", "enter"], "Press X DIAMETER MEASURE, type the diameter you measured, and press ENTER (WRITE on some screens)."),
      ],
    },
    {
      id: "zoffset", title: "Set a tool's Z offset (touch the face)",
      steps: [
        step(["offset"], "Press OFFSET and show the tool geometry page."),
        step(["handlejog", "-z", "handle"], "In HANDLE JOG, bring the tool onto the finished face of the part."),
        step(["down"], "Move the cursor to that tool's row."),
        step(["zface"], "Press Z FACE MEASURE. The tool's Z offset is set from where it is."),
        step(["nexttool"], "Press NEXT TOOL to do the next one."),
      ],
    },
  ],
};

// The guides as the shop has them: the built-in ones, with any changes a lead
// made (kept on the machine), and any the shop added.
export function guidesFor(control, saved = {}) {
  const base = GUIDES[control] || [];
  const out = base.map((g) => ({ ...g, ...(saved[g.id] || {}), id: g.id, builtIn: true }));
  for (const [id, g] of Object.entries(saved)) if (!base.some((b) => b.id === id) && g && !g.removed) out.push({ ...g, id });
  return out.filter((g) => !g.removed);
}
export function cleanGuides(raw) {
  const out = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [id, g] of Object.entries(raw)) {
    if (!/^[a-z0-9-]{1,40}$/i.test(id) || !g || typeof g !== "object") continue;
    const steps = (Array.isArray(g.steps) ? g.steps : []).slice(0, 40).map((s) => ({
      keys: (Array.isArray(s?.keys) ? s.keys : []).filter((x) => typeof x === "string" && /^[\w+\-.]{1,20}$/.test(x)).slice(0, 12),
      say: String(s?.say || "").slice(0, 400),
    })).filter((s) => s.say || s.keys.length);
    out[id] = {
      ...(g.title ? { title: String(g.title).slice(0, 80) } : {}),
      ...(steps.length ? { steps } : {}),
      ...(g.checked ? { checked: true, by: String(g.by || "").slice(0, 40), at: Number(g.at) || 0 } : {}),
      ...(g.removed ? { removed: true } : {}),
    };
  }
  return out;
}
