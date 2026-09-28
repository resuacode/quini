import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const configurado = Boolean(url && key);

export const supabase = createClient(url ?? "http://localhost", key ?? "sin-clave", {
  auth: { persistSession: true, autoRefreshToken: true },
});

/** Invoca una Edge Function y devuelve su JSON, lanzando un Error legible si falla. */
export async function invocar<T = Record<string, unknown>>(nombre: string, body: object = {}): Promise<T> {
  const { data, error } = await supabase.functions.invoke(nombre, { body });
  if (error) {
    // En errores HTTP la función devuelve { ok:false, error } en el cuerpo
    const ctx = (error as { context?: Response }).context;
    if (ctx && typeof ctx.json === "function") {
      const cuerpo = await ctx.json().catch(() => null);
      if (cuerpo?.error) throw new Error(cuerpo.error);
    }
    throw error;
  }
  if (data && data.ok === false) throw new Error(data.error ?? "Error desconocido");
  return data as T;
}
