// Aplica los resultados oficiales de la quiniela publicados por SELAE
// (loteriasyapuestas.es) y cierra la jornada como "finalizada".
//
// SELAE publica el signo de cada partido poco después de que acabe, sin esperar
// al escrutinio, así que durante la jornada se van aplicando uno a uno. La
// jornada se da por finalizada cuando están los 14 signos y el Pleno al 15.
//
// - Llamada por el cron (cada 10 min): solo consulta SELAE si hay alguna jornada
//   empezada y sin finalizar de la última semana.
// - Llamada desde la web con { "jornada_id": N }: fuerza esa jornada.
import { adminClient } from "../_shared/supabase.ts";
import { corsHeaders, json } from "../_shared/cors.ts";
import { extraerResultados, type ResultadoOficial } from "../_shared/parsers.ts";
import { selae } from "../_shared/selae.ts";
import { parecido } from "../_shared/teams.ts";

const DIAS_SEGUIMIENTO = 7;

interface Jornada {
  id: number;
  numero: number;
  fecha: string;
  partidos: { posicion: number; local: string; visitante: string; signo_oficial: string | null }[];
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const db = adminClient();
    const body = await req.json().catch(() => ({}));
    const forzada: number | undefined = body?.jornada_id;

    const pendientes = await jornadasPendientes(db, forzada);
    if (pendientes.length === 0) return json({ ok: true, omitido: "no hay jornadas en juego" });

    const informe: Record<number, string> = {};
    for (const j of pendientes) {
      try {
        informe[j.id] = await sincronizar(db, j);
      } catch (e) {
        informe[j.id] = `error: ${e instanceof Error ? e.message : e}`;
      }
    }
    return json({ ok: true, informe });
  } catch (e) {
    console.error(e);
    return json({ ok: false, error: String(e instanceof Error ? e.message : e) }, 500);
  }
});

// deno-lint-ignore no-explicit-any
async function jornadasPendientes(db: any, forzada?: number): Promise<Jornada[]> {
  let q = db.from("jornadas").select("id, numero, fecha, partidos(posicion, local, visitante, signo_oficial)");
  if (forzada) {
    q = q.eq("id", forzada);
  } else {
    const desde = new Date(Date.now() - DIAS_SEGUIMIENTO * 864e5).toISOString().slice(0, 10);
    q = q.neq("estado", "finalizada").lte("cierre", new Date().toISOString()).gte("fecha", desde);
  }
  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}

// deno-lint-ignore no-explicit-any
async function sincronizar(db: any, j: Jornada): Promise<string> {
  const detalle = await selae(`fechav3?game_id=LAQU&fecha_sorteo=${j.fecha.replaceAll("-", "")}`);
  const r = extraerResultados(detalle, 0).find((x) => x.fecha === j.fecha);
  if (!r) return "SELAE no tiene esta jornada (¿fecha del sorteo correcta?)";

  // Seguridad: los signos se aplican por posición, así que los partidos de
  // SELAE tienen que ser los mismos que los nuestros.
  const coinciden = j.partidos.filter((p) => {
    const e = r.equipos.get(p.posicion);
    return e && (parecido(p.local, e.local) >= 0.6 || parecido(p.visitante, e.visitante) >= 0.6);
  }).length;
  if (r.equipos.size && coinciden < 12) {
    return `los partidos de SELAE no coinciden con los de la jornada (${coinciden}/15); revisa la fecha del sorteo`;
  }

  const nuevos = await aplicar(db, j, r);
  const completo = r.signos.size >= 14 && r.pleno != null;
  if (completo) {
    const { error } = await db.from("jornadas").update({ oficial: true, estado: "finalizada" }).eq("id", j.id);
    if (error) throw error;
    return "finalizada con el resultado oficial";
  }
  return `${r.signos.size + (r.pleno ? 1 : 0)}/15 resultados oficiales publicados` +
    (nuevos ? ` (${nuevos} nuevos)` : "");
}

// deno-lint-ignore no-explicit-any
async function aplicar(db: any, j: Jornada, r: ResultadoOficial): Promise<number> {
  let nuevos = 0;
  for (const [posicion, signo] of r.signos) {
    if (j.partidos.find((p) => p.posicion === posicion)?.signo_oficial === signo) continue;
    const { error } = await db.from("partidos").update({ signo_oficial: signo })
      .eq("jornada_id", j.id).eq("posicion", posicion);
    if (error) throw error;
    nuevos++;
  }
  if (r.pleno) {
    const { error } = await db.from("partidos")
      .update({ pleno_oficial_local: r.pleno.local, pleno_oficial_visitante: r.pleno.visitante })
      .eq("jornada_id", j.id).eq("posicion", 15);
    if (error) throw error;
  }
  return nuevos;
}
