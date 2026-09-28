// Importa la próxima jornada de la quiniela y enlaza sus partidos con API-Football.
//
//   { "action": "importar" }                 -> SELAE -> jornada + 15 partidos + enlazar
//   { "action": "enlazar", "jornada_id": N } -> solo enlaza partidos sin fixture_id
//
// SELAE no tiene API pública: se usan los mismos servicios JSON que su web.
// Si fallan, la web ofrece el alta manual de los 15 partidos.
import { adminClient, consumirCuota, usuarioDe } from "../_shared/supabase.ts";
import { corsHeaders, json } from "../_shared/cors.ts";
import { apiFootball, apiFootballConfigurada, type Fixture, temporadaApi } from "../_shared/apifootball.ts";
import { parecido } from "../_shared/teams.ts";
import { extraerJornada, extraerProximo } from "../_shared/parsers.ts";
import { selae } from "../_shared/selae.ts";

const LIMITE_DIARIO = Number(Deno.env.get("API_FOOTBALL_DAILY_LIMIT") ?? 90);
const TOLERANCIA_HORA_MS = 30 * 60 * 1000;

// deno-lint-ignore no-explicit-any
type Obj = Record<string, any>;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  if (!(await usuarioDe(req))) return json({ ok: false, error: "No autenticado" }, 401);

  try {
    const db = adminClient();
    const body = await req.json().catch(() => ({}));

    if (body?.action === "enlazar") {
      if (!body.jornada_id) return json({ ok: false, error: "Falta jornada_id" }, 400);
      return json({ ok: true, ...(await enlazar(db, Number(body.jornada_id))) });
    }

    // 1. Próximo sorteo (fecha y nº de jornada) y 2. sus partidos
    let jornada;
    let cierre: string | null = null;
    try {
      const proximo = extraerProximo(await selae("proximosv3?game_id=LAQU&num=1"));
      if (!proximo) throw new Error("no hay próximo sorteo");
      cierre = proximo.cierre;
      const detalle = await selae(`fechav3?game_id=LAQU&fecha_sorteo=${proximo.fecha.replaceAll("-", "")}`);
      jornada = extraerJornada(detalle);
      if (!jornada) {
        console.warn("Respuesta de SELAE no reconocida:", JSON.stringify(detalle).slice(0, 2000));
        throw new Error("no se encontraron los 15 partidos");
      }
      jornada.numero ??= proximo.numero;
      jornada.fecha ??= proximo.fecha;
    } catch (e) {
      return json({ ok: false, error: `No se pudo leer la jornada de SELAE (${msg(e)}). Da de alta la jornada a mano.` }, 502);
    }

    const fecha = jornada.fecha!;
    const temporada = temporadaDe(fecha);
    let numero = jornada.numero;
    if (!numero) {
      const { data } = await db.from("jornadas").select("numero").eq("temporada", temporada)
        .order("numero", { ascending: false }).limit(1);
      numero = (data?.[0]?.numero ?? 0) + 1;
    }

    const { data: existente } = await db.from("jornadas").select("id")
      .eq("temporada", temporada).eq("numero", numero).maybeSingle();
    if (existente) {
      return json({ ok: true, jornada_id: existente.id, aviso: "La jornada ya existía.", ...(await enlazar(db, existente.id)) });
    }

    const { data: nueva, error } = await db.from("jornadas")
      .insert({ temporada, numero, fecha, cierre }).select("id").single();
    if (error) throw error;

    const { error: e2 } = await db.from("partidos").insert(
      jornada.partidos.map((p, i) => ({
        jornada_id: nueva.id,
        posicion: i + 1,
        local: p.local,
        visitante: p.visitante,
        inicio: p.inicio,
      })),
    );
    if (e2) throw e2;

    let enlace = {};
    try {
      enlace = await enlazar(db, nueva.id);
    } catch (e) {
      enlace = { aviso: `Jornada creada, pero no se pudo enlazar con API-Football: ${msg(e)}` };
    }
    return json({ ok: true, jornada_id: nueva.id, ...enlace });
  } catch (e) {
    console.error(e);
    return json({ ok: false, error: msg(e) }, 500);
  }
});

function temporadaDe(fecha: string): string {
  const inicio = temporadaApi(new Date(fecha + "T12:00:00Z"));
  return `${inicio}-${String((inicio + 1) % 100).padStart(2, "0")}`;
}

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
