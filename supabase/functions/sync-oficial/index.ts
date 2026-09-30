// Cierra las jornadas y aplica su resultado oficial.
//
// 1. Cierre automático: cuando API-Football da los 15 partidos por terminados,
//    la jornada pasa a "finalizada" y ya cuenta para la temporada.
// 2. Confirmación oficial: cuando la jornada ha acabado, se consulta
//    loteriasapi.com (y, como intento extra, SELAE) para aplicar los signos
//    oficiales (aplazados, partidos sin enlazar...) y marcarla como oficial.
//    Las consultas se espacian (INTERVALO_INTENTOS) para no gastar cuota.
//
// - Llamada por el cron (cada 10 min).
// - Llamada desde la web con { "jornada_id": N }: fuerza la consulta oficial.
import { adminClient, consumirCuota } from "../_shared/supabase.ts";
import { corsHeaders, json } from "../_shared/cors.ts";
import { extraerResultados, type ResultadoOficial } from "../_shared/parsers.ts";
import { selae } from "../_shared/selae.ts";
import { parecido } from "../_shared/teams.ts";

const BASES_LOTERIAS = Deno.env.get("LOTERIAS_API_BASE")
  ? [Deno.env.get("LOTERIAS_API_BASE")!]
  : ["https://api.loteriasapi.com/api/v1", "https://api.loteriasapi.com/v1"];
const LIMITE_DIARIO = Number(Deno.env.get("LOTERIAS_API_DAILY_LIMIT") ?? 4);
const INTERVALO_INTENTOS_MS = 3 * 36e5;
const DIAS_SEGUIMIENTO = 7;

interface Partido {
  posicion: number;
  local: string;
  visitante: string;
  inicio: string | null;
  terminado: boolean;
  signo_oficial: string | null;
}

interface Jornada {
  id: number;
  numero: number;
  fecha: string;
  estado: string;
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
    "id, numero, fecha, estado, ultimo_intento_oficial, partidos(posicion, local, visitante, inicio, terminado, signo_oficial)",
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
  const todosTerminados = j.partidos.length === 15 && j.partidos.every((p) => p.terminado);

  // 1. Cierre automático con los resultados de API-Football
  if (todosTerminados && j.estado !== "finalizada") {
    await actualizarJornada(db, j.id, { estado: "finalizada" });
    j.estado = "finalizada";
    partes.push("finalizada con los resultados de API-Football");
  }

  // 2. Confirmación oficial, solo cuando la jornada ha acabado y espaciando intentos
  const finEstimado = Math.max(
    new Date(j.fecha + "T22:00:00Z").getTime(),
    ...j.partidos.filter((p) => p.inicio).map((p) => new Date(p.inicio!).getTime() + 2 * 36e5),
  );
  const acabada = todosTerminados || Date.now() > finEstimado;
  const ultimo = j.ultimo_intento_oficial ? new Date(j.ultimo_intento_oficial).getTime() : 0;
  if (!forzada && !acabada) return partes.join(" · ") || "esperando a que acabe la jornada";
  if (!forzada && Date.now() - ultimo < INTERVALO_INTENTOS_MS) {
    const min = Math.ceil((ultimo + INTERVALO_INTENTOS_MS - Date.now()) / 60000);
    partes.push(`próximo intento de resultado oficial en ${min} min`);
    return partes.join(" · ");
  }

  await actualizarJornada(db, j.id, { ultimo_intento_oficial: new Date().toISOString() });
  const avisos: string[] = [];
  let r: ResultadoOficial | undefined;
  let fuente = "";

  try {
    r = await desdeLoteriasApi(db, j);
    fuente = "loteriasapi";
  } catch (e) {
    avisos.push(`loteriasapi: ${msg(e)}`);
  }
  if (!r) {
    try {
      r = await desdeSelae(j);
      fuente = "SELAE";
    } catch (e) {
      avisos.push(`SELAE: ${msg(e)}`);
    }
  }

  if (!r) {
    partes.push(["resultado oficial aún no disponible", ...avisos].join(" · "));
    return partes.join(" · ");
  }

  const coinciden = j.partidos.filter((p) => {
    const e = r!.equipos.get(p.posicion);
    return e && (parecido(p.local, e.local) >= 0.6 || parecido(p.visitante, e.visitante) >= 0.6);
  }).length;
  if (r.equipos.size && coinciden < 12) {
    partes.push(`los partidos de ${fuente} no coinciden con los de la jornada (${coinciden}/15); revisa la fecha del sorteo`);
    return partes.join(" · ");
  }

  await aplicar(db, j, r);
  if (r.signos.size >= 14 && r.pleno) {
    await actualizarJornada(db, j.id, { oficial: true, estado: "finalizada" });
    partes.push(`resultado oficial aplicado (${fuente})`);
  } else {
    partes.push(`${r.signos.size + (r.pleno ? 1 : 0)}/15 resultados oficiales aplicados (${fuente})`);
  }
  return partes.join(" · ");
}

// ------------------------------------------------------------------
// Fuentes
// ------------------------------------------------------------------

/** Resultado completo de loteriasapi: primero la última jornada y, si no es esta, por fecha. */
async function desdeLoteriasApi(db: Db, j: Jornada): Promise<ResultadoOficial | undefined> {
  if (!Deno.env.get("LOTERIAS_API_KEY")) throw new Error("sin LOTERIAS_API_KEY configurada");
  for (const ruta of ["/results/quiniela/latest", `/results/quiniela/date/${j.fecha}`]) {
    const r = buscar(extraerResultados(await loteriasApi(db, ruta)), j);
    if (r) return r;
  }
  return undefined;
}

async function loteriasApi(db: Db, ruta: string): Promise<unknown> {
  let ultimoError = "";
  for (const base of BASES_LOTERIAS) {
    if (!(await consumirCuota(db, "loteriasapi", LIMITE_DIARIO))) throw new Error("cuota diaria agotada");
    const res = await fetch(base + ruta, {
      headers: { "X-API-Key": Deno.env.get("LOTERIAS_API_KEY")!, Accept: "application/json" },
    });
    if (res.ok) return await res.json();
    ultimoError = `HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`;
    if (res.status !== 404) break; // solo probamos la otra URL base si esta no existe
  }
  throw new Error(ultimoError);
}

/** SELAE da también resultados parciales (los partidos ya jugados). */
async function desdeSelae(j: Jornada): Promise<ResultadoOficial | undefined> {
  const detalle = await selae(`fechav3?game_id=LAQU&fecha_sorteo=${j.fecha.replaceAll("-", "")}`);
  return extraerResultados(detalle, 0).find((x) => x.fecha === j.fecha);
}

/** Resultado completo (14 signos + pleno) de la jornada: misma fecha, o mismo nº con ±1 día. */
function buscar(resultados: ResultadoOficial[], j: Jornada): ResultadoOficial | undefined {
  const completos = resultados.filter((r) => r.signos.size >= 14 && r.pleno);
  const fechaJ = new Date(j.fecha + "T12:00:00Z").getTime();
  const cerca = (r: ResultadoOficial) =>
    r.fecha != null && Math.abs(new Date(r.fecha + "T12:00:00Z").getTime() - fechaJ) <= 864e5;
  return completos.find((r) => r.fecha === j.fecha) ??
    completos.find((r) => r.numero === j.numero && (r.fecha == null || cerca(r)));
}

// ------------------------------------------------------------------
// Escritura
// ------------------------------------------------------------------

async function aplicar(db: Db, j: Jornada, r: ResultadoOficial) {
  for (const [posicion, signo] of r.signos) {
    if (j.partidos.find((p) => p.posicion === posicion)?.signo_oficial === signo) continue;
    const { error } = await db.from("partidos").update({ signo_oficial: signo })
      .eq("jornada_id", j.id).eq("posicion", posicion);
    if (error) throw error;
  }
  if (r.pleno) {
    const { error } = await db.from("partidos")
      .update({ pleno_oficial_local: r.pleno.local, pleno_oficial_visitante: r.pleno.visitante })
      .eq("jornada_id", j.id).eq("posicion", 15);
    if (error) throw error;
  }
}

async function actualizarJornada(db: Db, id: number, cambios: Record<string, unknown>) {
  const { error } = await db.from("jornadas").update(cambios).eq("id", id);
  if (error) throw error;
}

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
