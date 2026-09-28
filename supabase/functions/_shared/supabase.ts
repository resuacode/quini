import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

/** Cliente con service role: salta RLS. Solo para uso interno de las funciones. */
export function adminClient(): SupabaseClient {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );
}

/** Devuelve el usuario autenticado de la petición, o null. */
export async function usuarioDe(req: Request) {
  const auth = req.headers.get("Authorization");
  if (!auth?.startsWith("Bearer ")) return null;
  const { data, error } = await adminClient().auth.getUser(auth.slice(7));
  if (error) return null;
  return data.user;
}

/** Reserva una petición de la cuota diaria de una API externa. */
export async function consumirCuota(db: SupabaseClient, api: string, limite: number): Promise<boolean> {
  const { data, error } = await db.rpc("consumir_cuota", { p_api: api, p_limite: limite });
  if (error) throw error;
  return data === true;
}
