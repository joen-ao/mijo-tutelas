/**
 * Cliente Supabase (server-side).
 *
 * Prefiere una key secreta (server) si existe; si no, usa la publishable
 * (el modelo nuevo de Supabase: sb_publishable_ / sb_secret_ reemplazan
 * anon / service_role). Con RLS desactivado (migración 0001), la publishable
 * puede leer y escribir en la demo.
 *
 * Si no hay URL+key configuradas, devuelve null → el store cae a modo local.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Nota: se usa || (no ??) para que una variable presente-pero-vacía ("")
// no gane sobre las siguientes de la cadena.
const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const key =
  process.env.SUPABASE_SECRET_KEY ||
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  "";

export const supabaseEnabled = Boolean(url && key);

let _client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient | null {
  if (!supabaseEnabled) return null;
  if (!_client) {
    _client = createClient(url, key, { auth: { persistSession: false } });
  }
  return _client;
}
