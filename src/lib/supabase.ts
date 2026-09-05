import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url =
  (import.meta.env["VITE_SUPABASE_URL"] as string | undefined) ??
  (import.meta.env["VITE_SUPABASE_PROJECT_URL"] as string | undefined);

const anonKey =
  (import.meta.env["VITE_SUPABASE_PUBLISHABLE_KEY"] as string | undefined) ??
  (import.meta.env["VITE_SUPABASE_ANON_KEY"] as string | undefined);

/**
 * Browser-only Supabase client for the user's existing project.
 * Publishable/anon key only — never a service-role key.
 * Null until the Supabase connector is linked in Project Settings.
 */
export const supabase: SupabaseClient | null =
  url && anonKey
    ? createClient(url, anonKey, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
        },
      })
    : null;

export const isSupabaseConfigured = supabase !== null;
