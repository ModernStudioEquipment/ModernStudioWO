import React from "react";
import ReactDOM from "react-dom/client";

const root = ReactDOM.createRoot(document.getElementById("root"));

// Route split. The shop-floor monitors load "#floor" / "#floor/<dept>". That
// path renders a fully separate module graph (FloorEntry -> anon-only client)
// and never imports the office App, its auth, or its Supabase client — so a
// monitor cannot become logged in or reach customer data. Everything else is
// the normal office app.
if (/^#\/?floor\b/i.test(window.location.hash || "")) {
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
