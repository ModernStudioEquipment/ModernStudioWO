// Single data-layer entry point. Picks the real Supabase backend when it's
// configured, otherwise the local/offline adapter. The rest of the app only
// ever imports `db` and never knows which one it's talking to.

import { isSupabaseConfigured } from "./supabase.js";
import { localAdapter } from "./adapters/localAdapter.js";
import { supabaseAdapter } from "./adapters/supabaseAdapter.js";

export const db = isSupabaseConfigured ? supabaseAdapter : localAdapter;
export const backendMode = isSupabaseConfigured ? "supabase" : "local";
