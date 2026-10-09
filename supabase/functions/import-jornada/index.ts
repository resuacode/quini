// Importa la próxima jornada de la quiniela y enlaza sus partidos con API-Football.
//
//   { "action": "importar" }                 -> jornada + 15 partidos + enlazar
//   { "action": "enlazar", "jornada_id": N } -> solo enlaza partidos sin fixture_id
//
// SELAE no tiene API pública y bloquea las peticiones desde servidores, así que
// los partidos se leen de los datos estructurados schema.org (JSON-LD) que
// publica quinielafutbol.info. Si falta el nº de jornada o la fecha del sorteo,
// se completan con loteriasapi. Una sola petición por importación.
import { adminClient, usuarioDe } from "../_shared/supabase.ts";
import { corsHeaders, json } from "../_shared/cors.ts";
import { temporadaApi } from "../_shared/apifootball.ts";
import { diaMadrid, enlazar, type ResultadoEnlace } from "../_shared/enlazar.ts";
import { loteriasApiConfigurada, proximoSorteo } from "../_shared/loteriasapi.ts";
import { extraerJornadaJsonLd } from "../_shared/parsers.ts";

const FUENTE_PROXIMA = "https://www.quinielafutbol.info/proximas-jornadas-de-la-quiniela.html";
// deno-lint-ignore no-explicit-any
type Db = any;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  if (!(await usuarioDe(req))) return json({ ok: false, error: "No autenticado" }, 401);

  try {
    const db = adminClient();
    const body = await req.json().catch(() => ({}));

    if (body?.action === "enlazar" && body.jornada_id) {
      return json({ ok: true, ...(await enlazar(db, Number(body.jornada_id))) });
    }
    if (body?.action === "importar") return json({ ok: true, ...(await importar(db)) });
    return json({ ok: false, error: 'Uso: { "action": "importar" } o { "action": "enlazar", "jornada_id": N }' }, 400);
  } catch (e) {
    console.error(e);
    return json({ ok: false, error: msg(e) }, 500);
  }
});

async function importar(db: Db) {
  // 1. Partidos de la próxima jornada
  let jornada;
  try {
    const res = await fetch(FUENTE_PROXIMA, {
      headers: {
        "User-Agent": "Quini/1.0 (app personal de quinielas; una consulta por jornada)",
        Accept: "text/html",
        "Accept-Language": "es-ES,es;q=0.9",
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    jornada = extraerJornadaJsonLd(await res.text());
  } catch (e) {
    throw new Error(`No se pudo leer la próxima jornada de quinielafutbol.info (${msg(e)}). Pega los partidos a mano.`);
  }
  if (!jornada) {
    throw new Error("quinielafutbol.info no tiene ahora mismo los 15 partidos de la próxima jornada. Pega los partidos a mano.");
  }

  // 2. Nº de jornada y fecha del sorteo (si faltan, de loteriasapi)
  let { numero, fecha } = jornada;
  if ((!numero || !fecha) && loteriasApiConfigurada()) {
    try {
      const s = await proximoSorteo(db);
      if (s && (!numero || s.numero === numero)) {
        numero ??= s.numero;
        fecha ??= s.fecha;
      }
    } catch (e) {
      console.warn("loteriasapi:", msg(e));
    }
  }
  fecha ??= domingoDe(jornada.partidos.find((p) => p.inicio)?.inicio ?? new Date().toISOString());
  const temporada = temporadaDe(fecha);
  if (!numero) {
    const { data } = await db.from("jornadas").select("numero").eq("temporada", temporada)
      .order("numero", { ascending: false }).limit(1);
    numero = (data?.[0]?.numero ?? 0) + 1;
  }

  // 3. Alta (o, si ya existía, solo enlazar)
  const { data: existente } = await db.from("jornadas").select("id")
    .eq("temporada", temporada).eq("numero", numero).maybeSingle();
  if (existente) {
    const enlace = await enlazarSinFallar(db, existente.id);
    return { jornada_id: existente.id, numero, ...enlace, aviso: [`La jornada ${numero} ya existía.`, enlace.aviso].filter(Boolean).join(" ") };
  }

  const { data: nueva, error } = await db.from("jornadas").insert({ temporada, numero, fecha }).select("id").single();
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
  if (e2) {
    await db.from("jornadas").delete().eq("id", nueva.id);
    throw e2;
  }

  return { jornada_id: nueva.id, numero, ...(await enlazarSinFallar(db, nueva.id)) };
}

/** Enlaza con API-Football; si falla, la jornada sigue valiendo y se devuelve un aviso. */
async function enlazarSinFallar(db: Db, jornadaId: number): Promise<Partial<ResultadoEnlace> & { aviso?: string }> {
  try {
    return await enlazar(db, jornadaId);
  } catch (e) {
    return { aviso: `No se pudo enlazar con API-Football: ${msg(e)}` };
  }
}

function temporadaDe(fecha: string): string {
  const inicio = temporadaApi(new Date(fecha + "T12:00:00Z"));
  return `${inicio}-${String((inicio + 1) % 100).padStart(2, "0")}`;
}

/** Domingo de la semana de un instante (el sorteo habitual), YYYY-MM-DD. */
function domingoDe(iso: string): string {
  const d = new Date(diaMadrid(iso) + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + ((7 - d.getUTCDay()) % 7));
  return d.toISOString().slice(0, 10);
}

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
