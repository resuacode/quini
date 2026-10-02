// Cliente de loteriasapi.com con control de cuota diaria (tabla api_usage).
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { consumirCuota } from "./supabase.ts";

// La documentación muestra las dos rutas base; se prueba la segunda si la primera da 404.
const BASES = Deno.env.get("LOTERIAS_API_BASE")
  ? [Deno.env.get("LOTERIAS_API_BASE")!]
  : ["https://api.loteriasapi.com/api/v1", "https://api.loteriasapi.com/v1"];
const LIMITE_DIARIO = Number(Deno.env.get("LOTERIAS_API_DAILY_LIMIT") ?? 4);

export function loteriasApiConfigurada(): boolean {
  return Boolean(Deno.env.get("LOTERIAS_API_KEY"));
}

export async function loteriasApi(db: SupabaseClient, ruta: string): Promise<unknown> {
  if (!loteriasApiConfigurada()) throw new Error("sin LOTERIAS_API_KEY configurada");
  let ultimoError = "";
  for (const base of BASES) {
    if (!(await consumirCuota(db, "loteriasapi", LIMITE_DIARIO))) throw new Error("cuota diaria agotada");
    const res = await fetch(base + ruta, {
      headers: { "X-API-Key": Deno.env.get("LOTERIAS_API_KEY")!, Accept: "application/json" },
    });
    if (res.ok) return await res.json();
    ultimoError = `HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`;
    if (res.status !== 404) break;
  }
  throw new Error(ultimoError);
}

/**
 * Próximo sorteo abierto de la quiniela: { fecha, numero }.
 * Respuesta real: { data: [{ drawDate: "2026-10-04", status: "OPEN", metadata: { jornada: 11 } }] }
 */
export async function proximoSorteo(db: SupabaseClient): Promise<{ fecha: string; numero: number | null } | null> {
  // deno-lint-ignore no-explicit-any
  const r = (await loteriasApi(db, "/draws/upcoming/quiniela")) as any;
  // deno-lint-ignore no-explicit-any
  const sorteos: any[] = Array.isArray(r?.data) ? r.data : [];
  const s = sorteos.find((x) => x?.status === "OPEN") ?? sorteos[0];
  if (!s?.drawDate) return null;
  const numero = Number(s.metadata?.jornada ?? NaN);
  return { fecha: String(s.drawDate).slice(0, 10), numero: Number.isFinite(numero) ? numero : null };
}
