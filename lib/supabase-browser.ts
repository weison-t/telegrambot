"use client";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";

// Browser client using the public anon key. Read-only via RLS policies.
let browserClient: SupabaseClient<Database> | null = null;

export const getBrowserClient = (): SupabaseClient<Database> => {
  if (browserClient) return browserClient;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY must be set."
    );
  }

  browserClient = createClient<Database>(url, anonKey, {
    auth: { persistSession: false },
  });
  return browserClient;
};
