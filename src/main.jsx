import React from "react";
import ReactDOM from "react-dom/client";

const root = ReactDOM.createRoot(document.getElementById("root"));

// Route split. The shop-floor monitors load "#floor" / "#floor/<dept>". That
// path renders a fully separate module graph (FloorEntry -> anon-only client)
// and never imports the office App, its auth, or its Supabase client — so a
// monitor cannot become logged in or reach customer data. Everything else is
// the normal office app.
const isFloorHash = /^#\/?floor\b/i.test(window.location.hash || "");
let stickyFloor = null;
try {
  stickyFloor = sessionStorage.getItem("mse_floor");
} catch {
  /* ignore */
}

if (isFloorHash || stickyFloor) {
  // A refresh can drop the URL fragment (e.g. through a domain redirect). This
  // tab remembers it's a floor monitor, so restore the floor screen instead of
  // bouncing to the office. sessionStorage is per-tab, so an office computer
  // that only previews a monitor is never affected.
  if (!isFloorHash && stickyFloor) {
    window.location.hash = `#floor/${stickyFloor}`;
  }
  import("./floor/FloorEntry.jsx").then(({ default: FloorEntry }) => {
    root.render(
      <React.StrictMode>
        <FloorEntry />
      </React.StrictMode>
    );
  });
} else {
  Promise.all([import("./App.jsx"), import("./index.css")]).then(([{ default: App }]) => {
    root.render(
      <React.StrictMode>
        <App />
      </React.StrictMode>
    );
  });
}
