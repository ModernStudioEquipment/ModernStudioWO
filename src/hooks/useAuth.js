import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase.js";
import { db } from "../lib/db.js";

// In local mode there is no login — everyone is the same demo user.
const LOCAL_USER = { id: "local", email: "demo (local mode)" };

export function useAuth() {
  const needsAuth = db.needsAuth;
  const [user, setUser] = useState(needsAuth ? null : LOCAL_USER);
  const [ready, setReady] = useState(!needsAuth);

  useEffect(() => {
    if (!needsAuth) return;
    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setUser(data.session?.user ?? null);
      setReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      setUser(session?.user ?? null);
    });
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, [needsAuth]);

  // Role for scoped logins (e.g. a CNC lead who should only see CNC). Prefer
  // app_metadata (admin-set, the user can't change it) over user_metadata.
  const role = user?.app_metadata?.role || user?.user_metadata?.role || null;

  return {
    user,
    role,
    ready,
    needsAuth,
    async signIn(email, password) {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
    },
    async signUp(email, password) {
      const { error } = await supabase.auth.signUp({ email, password });
      if (error) throw error;
    },
    async signOut() {
      await supabase.auth.signOut();
    },
  };
}
