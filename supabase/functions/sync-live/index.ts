// Actualiza los marcadores en directo desde API-Football. La llama el cron cada
// 5 minutos y hace dos cosas:
//
// 1. Enlaza los partidos que aún no tienen fixture_id cuando su día entra en la
//    ventana del plan gratuito (ayer, hoy y mañana). Como mucho un intento por
//    jornada cada INTERVALO_ENLACE.
// 2. Refresca los partidos en juego o a punto de empezar, todos en una sola
//    petición (ids=a-b-c). Para que la cuota diaria llegue hasta el último
//    partido del día, el intervalo entre peticiones se alarga si hace falta.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { adminClient, consumirCuota } from "../_shared/supabase.ts";
import { corsHeaders, json } from "../_shared/cors.ts";
import { apiFootball, apiFootballConfigurada, ESTADOS_EN_JUEGO, golesQuiniela } from "../_shared/apifootball.ts";
import { enlazar } from "../_shared/enlazar.ts";

const LIMITE_DIARIO = Number(Deno.env.get("API_FOOTBALL_DAILY_LIMIT") ?? 90);
const RESERVA_ENLACES = 10; // peticiones que se guardan para enlazar partidos
const MARGEN_ANTES_MS = 5 * 60 * 1000;
const DURACION_MAX_MS = 3 * 60 * 60 * 1000;
const INTERVALO_MIN_MS = 5 * 60 * 1000;
const INTERVALO_ENLACE_MS = 3 * 36e5;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const db = adminClient();
    const ahora = Date.now();

    // Las jornadas cuyo primer partido ya ha empezado pasan a "en_juego"
    const { error: eJ } = await db
      .from("jornadas")
      .update({ estado: "en_juego" })
      .eq("estado", "abierta")
      .lte("cierre", new Date(ahora).toISOString());
    if (eJ) throw eJ;

    if (!apiFootballConfigurada()) return json({ ok: true, omitido: "falta configurar API_FOOTBALL_KEY" });

    const enlaces = await enlazarProximos(db, ahora);
    const directo = await actualizarDirecto(db, ahora);
    return json({ ok: true, ...enlaces, ...directo });
  } catch (e) {
    console.error(e);
    return json({ ok: false, error: String(e instanceof Error ? e.message : e) }, 500);
  }
});

/** Enlaza los partidos sin fixture_id que se juegan entre ahora y mañana. */
async function enlazarProximos(db: SupabaseClient, ahora: number) {
  const { data, error } = await db
    .from("partidos")
    .select("jornada_id, inicio, jornadas!inner(estado, fecha, ultimo_enlace)")
    .is("fixture_id", null)
    .eq("terminado", false)
    .neq("jornadas.estado", "finalizada");
  if (error) throw error;

  const jornadas = new Set<number>();
  // deno-lint-ignore no-explicit-any
  for (const p of (data ?? []) as any[]) {
    const ultimo = p.jornadas.ultimo_enlace ? new Date(p.jornadas.ultimo_enlace).getTime() : 0;
    if (ahora - ultimo < INTERVALO_ENLACE_MS) continue;
    const momento = p.inicio
      ? new Date(p.inicio).getTime()
      : new Date(p.jornadas.fecha + "T12:00:00Z").getTime();
    // Desde unas horas antes de empezar hasta mañana (lo que deja el plan gratuito)
    if (momento > ahora - DURACION_MAX_MS && momento < ahora + 36 * 36e5) jornadas.add(p.jornada_id);
  }

  const enlazados: Record<number, unknown> = {};
  for (const id of jornadas) {
    try {
      enlazados[id] = await enlazar(db, id);
    } catch (e) {
      enlazados[id] = String(e instanceof Error ? e.message : e);
    }
  }
  return jornadas.size ? { enlazados } : {};
}

async function actualizarDirecto(db: SupabaseClient, ahora: number) {
  const { data: partidos, error } = await db
    .from("partidos")
    .select("id, jornada_id, fixture_id, inicio, estado, jornadas!inner(estado)")
    .not("fixture_id", "is", null)
    .eq("terminado", false)
    .neq("jornadas.estado", "finalizada");
  if (error) throw error;

  // Partidos que están en juego o empiezan en breve
  const activos = (partidos ?? []).filter((p) => {
    if (ESTADOS_EN_JUEGO.includes(p.estado)) return true;
    if (!p.inicio) return false;
    const inicio = new Date(p.inicio).getTime();
    return inicio - MARGEN_ANTES_MS <= ahora && ahora <= inicio + DURACION_MAX_MS;
  });
  if (activos.length === 0) return { directo: "no hay partidos en juego" };

  // Reparto de la cuota (el día de API-Football va en UTC):
  // peticiones que quedan hoy / tiempo que queda hasta el final del último partido de hoy
  const hoy = new Date(ahora).toISOString().slice(0, 10);
  const finDia = Date.parse(hoy + "T23:59:59Z");
  const { data: usos } = await db.from("api_usage").select("api, peticiones, ultima")
    .eq("dia", hoy).in("api", ["api-football", "directo"]);
  const cuota = usos?.find((u) => u.api === "api-football");
  const directo = usos?.find((u) => u.api === "directo");

  const finesHoy = (partidos ?? [])
    .filter((p) => p.inicio && new Date(p.inicio).getTime() <= finDia)
    .map((p) => new Date(p.inicio!).getTime() + 2 * 36e5);
  const finActividad = Math.min(finDia, Math.max(ahora, ...finesHoy));
  const restantes = Math.max(1, LIMITE_DIARIO - RESERVA_ENLACES - (cuota?.peticiones ?? 0));
  const intervalo = Math.max(INTERVALO_MIN_MS, (finActividad - ahora) / restantes);
  const ultima = directo?.ultima ? new Date(directo.ultima).getTime() : 0;
  if (ahora - ultima < intervalo - 30_000) {
    return { directo: `espaciando peticiones (una cada ${Math.round(intervalo / 60000)} min)` };
  }
  // Marca de la última consulta del directo (no cuenta para la cuota)
  await consumirCuota(db, "directo", 1_000_000);

  const ids = [...new Set(activos.map((p) => p.fixture_id as number))];
  const actualizados: number[] = [];
  for (let i = 0; i < ids.length; i += 20) {
    if (!(await consumirCuota(db, "api-football", LIMITE_DIARIO))) {
      return { directo: "cuota diaria de API-Football agotada", actualizados };
    }
    const fixtures = await apiFootball("/fixtures", { ids: ids.slice(i, i + 20).join("-") });

    for (const f of fixtures) {
      const goles = golesQuiniela(f);
      const { error: e } = await db
        .from("partidos")
        .update({
          estado: f.fixture.status.short,
          goles_local: goles.local,
          goles_visitante: goles.visitante,
          inicio: f.fixture.date,
        })
        .eq("fixture_id", f.fixture.id)
        .is("signo_oficial", null);
      if (e) throw e;
      actualizados.push(f.fixture.id);
    }
  }
  return { actualizados };
}
