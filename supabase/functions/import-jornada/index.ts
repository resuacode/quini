// Enlaza los partidos de una jornada con API-Football para tener el directo.
//
//   { "action": "enlazar", "jornada_id": N } -> enlaza los partidos sin fixture_id
//
// La jornada y sus 15 partidos se dan de alta desde la web (pegando la lista):
// SELAE bloquea las peticiones que salen de los servidores de Supabase.
import { adminClient, consumirCuota, usuarioDe } from "../_shared/supabase.ts";
import { corsHeaders, json } from "../_shared/cors.ts";
import { apiFootball, apiFootballConfigurada, type Fixture } from "../_shared/apifootball.ts";
import { parecido } from "../_shared/teams.ts";

const LIMITE_DIARIO = Number(Deno.env.get("API_FOOTBALL_DAILY_LIMIT") ?? 90);
const TOLERANCIA_HORA_MS = 30 * 60 * 1000;

// deno-lint-ignore no-explicit-any
type Obj = Record<string, any>;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  if (!(await usuarioDe(req))) return json({ ok: false, error: "No autenticado" }, 401);

  try {
    const body = await req.json().catch(() => ({}));
    if (body?.action !== "enlazar" || !body.jornada_id) {
      return json({ ok: false, error: 'Uso: { "action": "enlazar", "jornada_id": N }' }, 400);
    }
    return json({ ok: true, ...(await enlazar(adminClient(), Number(body.jornada_id))) });
  } catch (e) {
    console.error(e);
    return json({ ok: false, error: msg(e) }, 500);
  }
});

/** Día (hora de Madrid) de un instante, en formato YYYY-MM-DD. */
function diaMadrid(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid" }).format(new Date(iso));
}

/**
 * Enlaza los partidos sin fixture_id con API-Football. Se piden todos los
 * partidos de cada día de la jornada (una petición por día) y se cruzan por
 * hora de inicio y nombre de los equipos. Así valen también partidos de
 * selecciones, Segunda, Liga F, etc.
 */
// deno-lint-ignore no-explicit-any
async function enlazar(db: any, jornadaId: number) {
  const { data: jornada, error } = await db.from("jornadas").select("fecha").eq("id", jornadaId).single();
  if (error) throw error;
  const { data: partidos, error: e2 } = await db.from("partidos")
    .select("id, posicion, local, visitante, inicio, fixture_id").eq("jornada_id", jornadaId).order("posicion");
  if (e2) throw e2;

  const pendientes: Obj[] = (partidos ?? []).filter((p: Obj) => !p.fixture_id);
  if (pendientes.length === 0) return { enlazados: 0, sin_enlazar: [] };
  if (!apiFootballConfigurada()) throw new Error("falta configurar el secreto API_FOOTBALL_KEY");

  let dias = [...new Set(pendientes.filter((p) => p.inicio).map((p) => diaMadrid(p.inicio)))];
  if (dias.length < pendientes.length && pendientes.some((p) => !p.inicio)) {
    // Sin hora conocida: viernes a domingo alrededor de la fecha del sorteo
    const f = new Date(jornada.fecha + "T12:00:00Z").getTime();
    dias = [...new Set([...dias, ...[-2, -1, 0].map((d) => new Date(f + d * 864e5).toISOString().slice(0, 10))])];
  }

  const fixtures: Fixture[] = [];
  for (const date of dias.sort()) {
    if (!(await consumirCuota(db, "api-football", LIMITE_DIARIO))) throw new Error("Cuota diaria de API-Football agotada");
    fixtures.push(...(await apiFootball("/fixtures", { date, timezone: "Europe/Madrid" })));
  }

  const usados = new Set<number>((partidos ?? []).map((p: Obj) => p.fixture_id).filter(Boolean));
  const sinEnlazar: number[] = [];
  let enlazados = 0;

  for (const p of pendientes) {
    const inicio = p.inicio ? new Date(p.inicio).getTime() : null;
    let mejor: Fixture | null = null;
    let mejorPuntos = 0;
    for (const fx of fixtures) {
      if (usados.has(fx.fixture.id)) continue;
      const aLaHora = inicio != null && Math.abs(new Date(fx.fixture.date).getTime() - inicio) <= TOLERANCIA_HORA_MS;
      if (inicio != null && !aLaHora) continue;
      const a = parecido(p.local, fx.teams.home.name);
      const b = parecido(p.visitante, fx.teams.away.name);
      if (a < 0.6 || b < 0.6) continue;
      if (a + b > mejorPuntos) {
        mejor = fx;
        mejorPuntos = a + b;
      }
    }
    if (!mejor) {
      sinEnlazar.push(p.posicion);
      continue;
    }
    usados.add(mejor.fixture.id);
    const { error: e3 } = await db.from("partidos")
      .update({ fixture_id: mejor.fixture.id, inicio: mejor.fixture.date, estado: mejor.fixture.status.short })
      .eq("id", p.id);
    if (e3) throw e3;
    enlazados++;
  }

  return { enlazados, sin_enlazar: sinEnlazar };
}

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
