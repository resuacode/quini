// Enlace de los partidos de una jornada con API-Football (para el directo).
//
// Se piden todos los partidos de cada día de la jornada (una petición por día)
// y se cruzan por hora de inicio y nombre de los equipos, así que valen también
// selecciones, Segunda, Liga F, etc.
//
// El plan gratuito de API-Football solo deja consultar ayer, hoy y mañana. Los
// partidos de otros días quedan "pendientes" y sync-live los enlaza solo cuando
// su día entra en esa ventana. Con un plan de pago se puede quitar el límite con
// el secreto API_FOOTBALL_SIN_LIMITE_FECHAS=true.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { apiFootball, apiFootballConfigurada, type Fixture } from "./apifootball.ts";
import { consumirCuota } from "./supabase.ts";
import { parecido } from "./teams.ts";

const LIMITE_DIARIO = Number(Deno.env.get("API_FOOTBALL_DAILY_LIMIT") ?? 90);
const SIN_LIMITE_FECHAS = Deno.env.get("API_FOOTBALL_SIN_LIMITE_FECHAS") === "true";
const TOLERANCIA_HORA_MS = 30 * 60 * 1000;

export interface ResultadoEnlace {
  enlazados: number;
  /** Posiciones consultadas sin encontrar su partido en API-Football */
  sin_enlazar: number[];
  /** Posiciones de días fuera de la ventana del plan gratuito (se enlazarán solas) */
  pendientes: number[];
}

interface PartidoBd {
  id: number;
  posicion: number;
  local: string;
  visitante: string;
  inicio: string | null;
  fixture_id: number | null;
}

/** Día (hora de Madrid) de un instante, en formato YYYY-MM-DD. */
export function diaMadrid(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid" }).format(new Date(iso));
}

/** Días que permite consultar el plan gratuito: ayer, hoy y mañana. */
function ventana(): Set<string> | null {
  if (SIN_LIMITE_FECHAS) return null;
  const hoy = Date.now();
  return new Set([-1, 0, 1].map((d) => new Date(hoy + d * 864e5).toISOString().slice(0, 10)));
}

export async function enlazar(db: SupabaseClient, jornadaId: number): Promise<ResultadoEnlace> {
  const { data: jornada, error } = await db.from("jornadas").select("fecha").eq("id", jornadaId).single();
  if (error) throw error;
  const { data, error: e2 } = await db.from("partidos")
    .select("id, posicion, local, visitante, inicio, fixture_id").eq("jornada_id", jornadaId).order("posicion");
  if (e2) throw e2;
  const partidos = (data ?? []) as PartidoBd[];

  const sinFixture = partidos.filter((p) => !p.fixture_id);
  if (sinFixture.length === 0) return { enlazados: 0, sin_enlazar: [], pendientes: [] };
  if (!apiFootballConfigurada()) throw new Error("falta configurar el secreto API_FOOTBALL_KEY");

  await db.from("jornadas").update({ ultimo_enlace: new Date().toISOString() }).eq("id", jornadaId);

  // Días en los que buscar cada partido (sin hora: viernes a domingo del sorteo)
  const f = new Date(jornada.fecha + "T12:00:00Z").getTime();
  const diasSinHora = [-2, -1, 0].map((d) => new Date(f + d * 864e5).toISOString().slice(0, 10));
  const diasDe = (p: PartidoBd) => (p.inicio ? [diaMadrid(p.inicio)] : diasSinHora);

  const permitidos = ventana();
  const consultables = [...new Set(sinFixture.flatMap(diasDe))].filter((d) => !permitidos || permitidos.has(d)).sort();

  const fixtures: Fixture[] = [];
  const consultados = new Set<string>();
  for (const date of consultables) {
    if (!(await consumirCuota(db, "api-football", LIMITE_DIARIO))) throw new Error("cuota diaria de API-Football agotada");
    try {
      fixtures.push(...(await apiFootball("/fixtures", { date, timezone: "Europe/Madrid" })));
      consultados.add(date);
    } catch (e) {
      // Fuera de la ventana del plan (p. ej. cerca de medianoche): se reintentará
      if (!/access to this date/i.test(String(e))) throw e;
    }
  }

  const usados = new Set<number>(partidos.map((p) => p.fixture_id).filter((x): x is number => Boolean(x)));
  const resultado: ResultadoEnlace = { enlazados: 0, sin_enlazar: [], pendientes: [] };

  for (const p of sinFixture) {
    if (!diasDe(p).some((d) => consultados.has(d))) {
      resultado.pendientes.push(p.posicion);
      continue;
    }
    const inicio = p.inicio ? new Date(p.inicio).getTime() : null;
    let mejor: Fixture | null = null;
    let mejorPuntos = 0;
    for (const fx of fixtures) {
      if (usados.has(fx.fixture.id)) continue;
      if (inicio != null && Math.abs(new Date(fx.fixture.date).getTime() - inicio) > TOLERANCIA_HORA_MS) continue;
      const a = parecido(p.local, fx.teams.home.name);
      const b = parecido(p.visitante, fx.teams.away.name);
      if (a < 0.6 || b < 0.6) continue;
      if (a + b > mejorPuntos) {
        mejor = fx;
        mejorPuntos = a + b;
      }
    }
    if (!mejor) {
      resultado.sin_enlazar.push(p.posicion);
      continue;
    }
    usados.add(mejor.fixture.id);
    const { error: e3 } = await db.from("partidos")
      .update({ fixture_id: mejor.fixture.id, inicio: mejor.fixture.date, estado: mejor.fixture.status.short })
      .eq("id", p.id);
    if (e3) throw e3;
    resultado.enlazados++;
  }

  return resultado;
}
