// Corrige los nombres de los partidos guardados con los de la fuente cuando son
// el mismo club escrito distinto. Sirve sobre todo para añadir la marca "(F)" a
// las jornadas creadas antes de que se conservara ("Barcelona" -> "Barcelona (F)").
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { parecido } from "./teams.ts";

interface PartidoGuardado {
  id: number;
  posicion: number;
  local: string;
  visitante: string;
}

/** Devuelve cuántos partidos se han renombrado. */
export async function corregirNombres(
  db: SupabaseClient,
  partidos: PartidoGuardado[],
  fuente: Map<number, { local: string; visitante: string }>,
): Promise<number> {
  let corregidos = 0;
  for (const p of partidos) {
    const f = fuente.get(p.posicion);
    if (!f || (f.local === p.local && f.visitante === p.visitante)) continue;
    // Solo si es el mismo partido (mismos clubes); si no, no se toca
    if (parecido(p.local, f.local) < 1 || parecido(p.visitante, f.visitante) < 1) continue;
    const { error } = await db.from("partidos").update({ local: f.local, visitante: f.visitante }).eq("id", p.id);
    if (error) throw error;
    p.local = f.local;
    p.visitante = f.visitante;
    corregidos++;
  }
  return corregidos;
}
