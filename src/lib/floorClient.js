import { createClient } from "@supabase/supabase-js";

// Isolated, ANON-ONLY database connection for the shop-floor monitors.
//
// This is deliberately a SECOND Supabase client, separate from the office one
// in ./supabase.js. It never persists or reuses an auth session, so even on a
// machine where someone has logged into the office app, this client stays
// anonymous. As `anon` it is walled off from all customer data by the database
// itself (migrations 0038 floor views + 0039 hard-deny) — it can only read the
// client-free `floor_queue` / `floor_item_photos` views.
//
// RULE: floor code must use ONLY this client. Never import the office
// `supabase` client into anything under src/floor/. Keeping the two apart is
// what makes an accidental customer-data leak impossible rather than merely
// hidden.
const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const floorConfigured = Boolean(url && anonKey);

export const floorClient = floorConfigured
  ? createClient(url, anonKey, {
      auth: {
        persistSession: false, // never write a session to storage
        autoRefreshToken: false, // never try to upgrade to a logged-in token
        storageKey: "mse-floor-anon", // never collide with the office session key
      },
    })
  : null;
