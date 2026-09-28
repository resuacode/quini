const BASE = "https://v3.football.api-sports.io";

export const ESTADOS_FINALES = ["FT", "AET", "PEN"];
export const ESTADOS_EN_JUEGO = ["1H", "HT", "2H", "ET", "BT", "P", "LIVE", "INT", "SUSP"];

export interface Fixture {
  fixture: { id: number; date: string; status: { short: string } };
  teams: { home: { name: string }; away: { name: string } };
  goals: { home: number | null; away: number | null };
  score: { fulltime: { home: number | null; away: number | null } };
}

export function apiFootballConfigurada(): boolean {
  return Boolean(Deno.env.get("API_FOOTBALL_KEY"));
}

export async function apiFootball(path: string, params: Record<string, string | number>): Promise<Fixture[]> {
  const key = Deno.env.get("API_FOOTBALL_KEY");
  if (!key) throw new Error("Falta el secreto API_FOOTBALL_KEY");
  const url = new URL(BASE + path);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  const res = await fetch(url, { headers: { "x-apisports-key": key } });
  if (!res.ok) throw new Error(`API-Football ${res.status}: ${await res.text()}`);
  const body = await res.json();
  const errores = body.errors && (Array.isArray(body.errors) ? body.errors : Object.values(body.errors));
  if (errores && errores.length) throw new Error(`API-Football: ${JSON.stringify(body.errors)}`);
  return body.response ?? [];
}

/** Temporada de API-Football (año de inicio) para una fecha. */
export function temporadaApi(fecha: Date): number {
  return fecha.getUTCMonth() >= 6 ? fecha.getUTCFullYear() : fecha.getUTCFullYear() - 1;
}

/**
 * Goles que valen para la quiniela: los del tiempo reglamentario si el partido
 * acabó, o el marcador actual si se está jugando.
 */
export function golesQuiniela(f: Fixture): { local: number | null; visitante: number | null } {
  const ft = f.score?.fulltime;
  if (ESTADOS_FINALES.includes(f.fixture.status.short) && ft?.home != null && ft?.away != null) {
    return { local: ft.home, visitante: ft.away };
  }
  return { local: f.goals.home, visitante: f.goals.away };
}
