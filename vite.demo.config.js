import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// The build behind the demo URL.
//
// It is the same app, built with the Supabase address and key HARD-BLANKED at
// compile time. Not left unset — replaced, so nothing can put them back: set
// them on the demo host and the bundle still has empty strings baked in. With
// nowhere to connect, the app falls back to its localStorage adapter and the
// seed data in src/lib/seed.js, and shows the "Local demo mode" banner.
//
// That matters because the demo is for showing the board to people outside the
// shop. Real orders, real customers and real prices stay on the real site.
//
//   npm run build:demo     → dist/ , safe to deploy anywhere
// Keep the demo out of search results. Emitted here only, so the real site's
// robots.txt is untouched.
const noIndex = {
  name: "demo-robots",
  generateBundle() {
    this.emitFile({ type: "asset", fileName: "robots.txt", source: "User-agent: *\nDisallow: /\n" });
  },
};

export default defineConfig({
  plugins: [react(), tailwindcss(), noIndex],
  define: {
    "import.meta.env.VITE_SUPABASE_URL": '""',
    "import.meta.env.VITE_SUPABASE_ANON_KEY": '""',
  },
});
