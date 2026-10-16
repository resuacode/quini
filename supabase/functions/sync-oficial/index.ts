// Trae los resultados de las jornadas (signos, marcadores y pleno) de la página
// de resultados de quinielafutbol.info y cierra la jornada cuando están los 15.
//
// - Cron (cada 10 min): solo consulta la página si hay partidos que ya deberían
//   haber acabado y aún no tienen resultado, como mucho una vez cada 10 minutos
//   por jornada. Así los resultados van entrando según acaban los partidos.
// - Desde la web con { "jornada_id": N } (botón "Actualizar resultados"): siempre.
//
// Además, si API-Football ya ha dado los 15 partidos por terminados, la jornada se
// cierra aunque la página todavía no tenga los resultados.
import { adminClient } from "../_shared/supabase.ts";
import { corsHeaders, json } from "../_shared/cors.ts";
import { extraerResultadosHtml, type ResultadosJornada, rutaResultados } from "../_shared/parsers.ts";
import { parecido } from "../_shared/teams.ts";

const WEB = "https://www.quinielafutbol.info";
const UA = "Quini/1.0 (app personal de quinielas)";
const DIAS_SEGUIMIENTO = 7;
const DURACION_PARTIDO_MS = 105 * 60 * 1000;
const INTERVALO_MS = 9 * 60 * 1000;

interface Partido {
  id: number;
  posicion: number;
  local: string;
  visitante: string;
  inicio: string | null;
  terminado: boolean;
  signo_oficial: string | null;
  pleno_oficial_local: string | null;
  pleno_oficial_visitante: string | null;
  goles_local: number | null;
  goles_visitante: number | null;
}

interface Jornada {
  id: number;
  numero: number;
  fecha: string;
  estado: string;
  oficial: boolean;
  ultimo_intento_oficial: string | null;
  partidos: Partido[];
}

// deno-lint-ignore no-explicit-any
type Db = any;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const db = adminClient();
    const body = await req.json().catch(() => ({}));
    const forzada: number | undefined = body?.jornada_id;

    const jornadas = await jornadasPendientes(db, forzada);
    if (jornadas.length === 0) return json({ ok: true, omitido: "no hay jornadas pendientes" });

    const informe: Record<number, string> = {};
    for (const j of jornadas) {
      try {
        informe[j.id] = await procesar(db, j, Boolean(forzada));
      } catch (e) {
        informe[j.id] = `error: ${msg(e)}`;
      }
    }
    return json({ ok: true, informe });
  } catch (e) {
    console.error(e);
    return json({ ok: false, error: msg(e) }, 500);
  }
});

async function jornadasPendientes(db: Db, forzada?: number): Promise<Jornada[]> {
  let q = db.from("jornadas").select(
    "id, numero, fecha, estado, oficial, ultimo_intento_oficial, " +
      "partidos(id, posicion, local, visitante, inicio, terminado, signo_oficial, pleno_oficial_local, pleno_oficial_visitante, goles_local, goles_visitante)",
  );
  if (forzada) {
    q = q.eq("id", forzada);
  } else {
    const desde = new Date(Date.now() - DIAS_SEGUIMIENTO * 864e5).toISOString().slice(0, 10);
    q = q.eq("oficial", false).lte("cierre", new Date().toISOString()).gte("fecha", desde);
  }
  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}

async function procesar(db: Db, j: Jornada, forzada: boolean): Promise<string> {
  const partes: string[] = [];
  const ahora = Date.now();

  // 1. Cierre con los datos de API-Football (si todos los partidos han terminado)
  if (j.partidos.length === 15 && j.partidos.every((p) => p.terminado) && j.estado !== "finalizada") {
    await actualizarJornada(db, j.id, { estado: "finalizada" });
    partes.push("finalizada (todos los partidos terminados)");
  }

  // 2. ¿Hay resultados que ya deberían estar y no están?
  const faltan = j.partidos.filter((p) => {
    const sinResultado = p.posicion === 15 ? !p.pleno_oficial_local : !p.signo_oficial;
    const acabado = p.inicio
      ? new Date(p.inicio).getTime() + DURACION_PARTIDO_MS < ahora
      : ahora > Date.parse(j.fecha + "T22:00:00Z");
    return sinResultado && acabado;
  });
  const ultimo = j.ultimo_intento_oficial ? new Date(j.ultimo_intento_oficial).getTime() : 0;
  if (!forzada && (faltan.length === 0 || ahora - ultimo < INTERVALO_MS)) {
    return partes.join(" · ") || "nada que actualizar";
  }
  await actualizarJornada(db, j.id, { ultimo_intento_oficial: new Date(ahora).toISOString() });

  // 3. Página de resultados de la jornada
  const r = await leerResultados(j.fecha);
  if (!r) {
    partes.push("quinielafutbol.info todavía no tiene los resultados de esta jornada");
    return partes.join(" · ");
  }

  // Seguridad: los resultados se aplican por posición, así que tienen que ser los mismos partidos
  const coinciden = j.partidos.filter((p) => {
    const e = r.equipos.get(p.posicion);
    return e && (parecido(p.local, e.local) >= 0.6 || parecido(p.visitante, e.visitante) >= 0.6);
  }).length;
  if (coinciden < 12) {
    partes.push(`los partidos de la página no coinciden con los de la jornada (${coinciden}/15); revisa la fecha del sorteo`);
    return partes.join(" · ");
  }

  const nuevos = await aplicar(db, j, r);
  const disponibles = r.signos.size + (r.pleno ? 1 : 0);
  if (r.signos.size >= 14 && r.pleno) {
    await actualizarJornada(db, j.id, { oficial: true, estado: "finalizada" });
    partes.push("resultados completos: jornada finalizada");
  } else {
    partes.push(`${disponibles}/15 resultados`);
  }
  if (nuevos) partes.push(`${nuevos} actualizado(s)`);
  return partes.join(" · ");
}

async function leerResultados(fecha: string): Promise<ResultadosJornada | null> {
  const pedir = (ruta: string) => fetch(WEB + ruta, { headers: { "User-Agent": UA, Accept: "text/html" } });

  let res = await pedir(rutaResultados(fecha));
  if (res.status === 404) {
    // Por si cambia el nombre de la página: se busca en el índice de jornadas
    await res.body?.cancel();
    const indice = await pedir("/resultados/jornadas-de-la-quiniela.html");
    if (!indice.ok) throw new Error(`índice de resultados: HTTP ${indice.status}`);
    const sufijo = rutaResultados(fecha).replace(/^.*jornada-quiniela-[a-z]+/, "");
    const enlace = (await indice.text()).match(new RegExp(`href="(/resultados/[^"]*${sufijo.replace(/[.]/g, "\\.")})"`))?.[1];
    if (!enlace) return null;
    res = await pedir(enlace);
  }
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`quinielafutbol.info: HTTP ${res.status}`);
  const r = extraerResultadosHtml(await res.text());
  return r && (!r.fecha || r.fecha === fecha) ? r : null;
}

/** Aplica signos, marcadores y pleno que hayan cambiado. Devuelve cuántos partidos se han tocado. */
async function aplicar(db: Db, j: Jornada, r: ResultadosJornada): Promise<number> {
  let nuevos = 0;
  for (const p of j.partidos) {
    const cambios: Record<string, unknown> = {};
    const m = r.marcadores.get(p.posicion);
    if (m && (m.local !== p.goles_local || m.visitante !== p.goles_visitante)) {
      Object.assign(cambios, { goles_local: m.local, goles_visitante: m.visitante, estado: "FT" });
    }
    const signo = r.signos.get(p.posicion);
    if (p.posicion <= 14 && signo && signo !== p.signo_oficial) cambios.signo_oficial = signo;
    if (
      p.posicion === 15 && r.pleno &&
      (r.pleno.local !== p.pleno_oficial_local || r.pleno.visitante !== p.pleno_oficial_visitante)
    ) {
      Object.assign(cambios, { pleno_oficial_local: r.pleno.local, pleno_oficial_visitante: r.pleno.visitante });
    }
    if (Object.keys(cambios).length === 0) continue;
    const { error } = await db.from("partidos").update(cambios).eq("id", p.id);
    if (error) throw error;
    nuevos++;
  }
  return nuevos;
}

async function actualizarJornada(db: Db, id: number, cambios: Record<string, unknown>) {
  const { error } = await db.from("jornadas").update(cambios).eq("id", id);
  if (error) throw error;
}

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
