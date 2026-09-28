// Actualiza los marcadores en directo desde API-Football.
// La llama el cron cada 5 minutos; solo gasta cuota si hay partidos en juego
// o a punto de empezar. Todos los partidos van en una sola petición (ids=a-b-c).
import { adminClient, consumirCuota } from "../_shared/supabase.ts";
import { corsHeaders, json } from "../_shared/cors.ts";
import { apiFootball, apiFootballConfigurada, ESTADOS_EN_JUEGO, golesQuiniela } from "../_shared/apifootball.ts";

const LIMITE_DIARIO = Number(Deno.env.get("API_FOOTBALL_DAILY_LIMIT") ?? 90);
const MARGEN_ANTES_MS = 5 * 60 * 1000;
const DURACION_MAX_MS = 3 * 60 * 60 * 1000;

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

    if (activos.length === 0) return json({ ok: true, omitido: "no hay partidos en juego" });
    if (!apiFootballConfigurada()) return json({ ok: true, omitido: "falta configurar API_FOOTBALL_KEY" });

    const ids = [...new Set(activos.map((p) => p.fixture_id as number))];
    const actualizados: number[] = [];

    for (let i = 0; i < ids.length; i += 20) {
      if (!(await consumirCuota(db, "api-football", LIMITE_DIARIO))) {
        return json({ ok: true, omitido: "cuota diaria de API-Football agotada", actualizados });
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

    return json({ ok: true, actualizados });
  } catch (e) {
    console.error(e);
    return json({ ok: false, error: String(e instanceof Error ? e.message : e) }, 500);
  }
});
