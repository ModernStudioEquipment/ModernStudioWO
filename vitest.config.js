import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// Test config is deliberately SEPARATE from vite.config.js: the app build pulls
// in the Tailwind plugin, which tests don't need and which only slows them down.
// Tests have to stay fast enough that people actually run them before pushing.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
  },
  // HARD-BLANK the Supabase env vars. Vite loads .env automatically, so on any
  // machine that has real credentials (i.e. every dev machine) the tests would
  // otherwise select the LIVE backend — a test run could then read or write
  // production data. Blanking these forces src/lib/db.js to pick the
  // localStorage demo adapter, so tests are hermetic by construction.
  define: {
    "import.meta.env.VITE_SUPABASE_URL": '""',
    "import.meta.env.VITE_SUPABASE_ANON_KEY": '""',
  },
});
