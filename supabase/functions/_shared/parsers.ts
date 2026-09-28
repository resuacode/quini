// Parsers para las respuestas JSON de SELAE (loteriasyapuestas.es/servicios).
// No es una API documentada, así que los campos se buscan por nombre con
// alternativas en vez de asumir una estructura fija.

// deno-lint-ignore no-explicit-any
type Obj = Record<string, any>;

export type Signo = "1" | "X" | "2";
export type Pleno = "0" | "1" | "2" | "M";

// ------------------------------------------------------------------
// Resultados: fechav3?game_id=LAQU&fecha_sorteo=AAAAMMDD
//   -> [{ fecha_sorteo, jornada: "9", partidos: [{ local, visitante, signo: "1" | "2-M", marcador }] }]
// Los partidos aún sin jugar vienen sin signo.
// ------------------------------------------------------------------

export interface ResultadoOficial {
  fecha: string | null;
  numero: number | null;
  signos: Map<number, Signo>;
  pleno: { local: Pleno; visitante: Pleno } | null;
  equipos: Map<number, { local: string; visitante: string }>;
}

/** Resultados encontrados con al menos `minSignos` signos (14 = jornada completa). */
export function extraerResultados(raiz: unknown, minSignos = 14): ResultadoOficial[] {
  const candidatos: Obj[] = [];
  const visitar = (n: unknown) => {
    if (Array.isArray(n)) return n.forEach(visitar);
    if (n && typeof n === "object") {
      const o = n as Obj;
      if (listaPartidos(o)) candidatos.push(o);
      else Object.values(o).forEach(visitar);
    }
  };
  visitar(raiz);
  return candidatos.map(aResultado).filter((r) => r.signos.size >= minSignos);
}

function listaPartidos(o: Obj): Obj[] | null {
  for (const k of ["partidos", "matches"]) {
    if (Array.isArray(o[k]) && o[k].length >= 14 && typeof o[k][0] === "object") return o[k];
  }
  return null;
}

function aResultado(o: Obj): ResultadoOficial {
  const partidos = listaPartidos(o)!;
  const signos = new Map<number, Signo>();
  const equipos = new Map<number, { local: string; visitante: string }>();
  let pleno: ResultadoOficial["pleno"] = null;

  partidos.forEach((p, i) => {
    const pos = Number(p.posicion ?? p.position ?? i + 1);
    const s = String(p.signo ?? p.sign ?? "").trim().toUpperCase();
    if (pos <= 14 && (s === "1" || s === "X" || s === "2")) signos.set(pos, s);
    if (pos === 15 && s) pleno = plenoDe(s);
    if (typeof p.local === "string" && typeof p.visitante === "string") {
      equipos.set(pos, { local: limpiarEquipo(p.local), visitante: limpiarEquipo(p.visitante) });
    }
  });

  const fecha = fechaDe(o.fecha_sorteo ?? o.fecha);
  const numero = Number(o.jornada ?? o.numero_jornada ?? NaN);

  return { fecha, numero: Number.isFinite(numero) ? numero : null, signos, pleno, equipos };
}

function aPleno(v: unknown): Pleno | null {
  if (v == null) return null;
  const s = String(v).trim().toUpperCase();
  if (s === "M") return "M";
  const n = Number(s);
  if (s === "" || !Number.isInteger(n) || n < 0) return null;
  return n >= 3 ? "M" : (String(n) as Pleno);
}

/** "2-M", "1 - 0"… -> { local, visitante } (3 o más goles = M). */
export function plenoDe(v: string): ResultadoOficial["pleno"] {
  const m = v.toUpperCase().match(/([0-9]+|M)\s*[-:]\s*([0-9]+|M)/);
  if (!m) return null;
  const local = aPleno(m[1]), visitante = aPleno(m[2]);
  return local && visitante ? { local, visitante } : null;
}

// ------------------------------------------------------------------
// SELAE (loteriasyapuestas.es/servicios)
//   proximosv3?game_id=LAQU&num=1
//     -> [{ fecha: "2026-09-30 00:00:00", cierre: "2026-09-29 20:45:00", jornada: 10, ... }]
//   fechav3?game_id=LAQU&fecha_sorteo=20260930
//     -> [{ fecha_sorteo, jornada: "10", partidos: [{ local: "Ceuta (m)", visitante,
//           fecha: "2026/09/29 20:45:00" | fecha_completa, signo?: "1" | "2-M", marcador? }] }]
// ------------------------------------------------------------------

export interface ProximoSorteo {
  fecha: string;
  numero: number | null;
  cierre: string | null;
}

export function extraerProximo(raiz: unknown): ProximoSorteo | null {
  const lista = Array.isArray(raiz) ? raiz : [raiz];
  for (const o of lista as Obj[]) {
    const fecha = fechaDe(o?.fecha ?? o?.fecha_sorteo);
    if (!fecha) continue;
    const numero = Number(o.jornada ?? o.numero_jornada ?? NaN);
    return {
      fecha,
      numero: Number.isFinite(numero) && numero > 0 ? numero : null,
      cierre: typeof o.cierre === "string" ? horaMadridAIso(o.cierre) : null,
    };
  }
  return null;
}

export interface PartidoSelae {
  local: string;
  visitante: string;
  inicio: string | null;
}

export interface JornadaSelae {
  numero: number | null;
  fecha: string | null;
  partidos: PartidoSelae[];
}

/** Busca un objeto con una lista de ≥15 partidos (local/visitante). */
export function extraerJornada(raiz: unknown): JornadaSelae | null {
  let encontrada: JornadaSelae | null = null;
  const visitar = (n: unknown) => {
    if (encontrada || !n || typeof n !== "object") return;
    if (Array.isArray(n)) return n.forEach(visitar);
    const o = n as Obj;
    for (const v of Object.values(o)) {
      if (!Array.isArray(v) || v.length < 15) continue;
      const partidos = v.map(partidoSelae).filter((p): p is PartidoSelae => p !== null);
      if (partidos.length >= 15) {
        const numero = Number(o.jornada ?? o.num_jornada ?? o.numero_jornada ?? o.numJornada ?? NaN);
        encontrada = {
          numero: Number.isFinite(numero) && numero > 0 ? numero : null,
          fecha: fechaDe(o.fecha_sorteo ?? o.fecha ?? o.dia_sorteo ?? o.date),
          partidos: partidos.slice(0, 15),
        };
        return;
      }
    }
    Object.values(o).forEach(visitar);
  };
  visitar(raiz);
  return encontrada;
}

/** Quita las marcas de SELAE: "Ceuta (m)" -> "Ceuta". */
export function limpiarEquipo(nombre: string): string {
  return nombre.replace(/\s*\((m|f)\)\s*$/i, "").trim();
}

function partidoSelae(p: unknown): PartidoSelae | null {
  if (!p || typeof p !== "object") return null;
  const o = p as Obj;
  let local = o.local ?? o.equipo_local ?? o.home ?? o.nombre_local ?? o.equipoLocal;
  let visitante = o.visitante ?? o.equipo_visitante ?? o.away ?? o.nombre_visitante ?? o.equipoVisitante;
  if (typeof local !== "string" || typeof visitante !== "string") {
    // Algunos formatos traen "Local - Visitante" en un único campo
    const partido = o.partido ?? o.nombre ?? o.match;
    if (typeof partido !== "string") return null;
    [local, visitante] = partido.split(/\s+-\s+|-/);
    if (!local?.trim() || !visitante?.trim()) return null;
  }
  let inicio: string | null = null;
  if (typeof o.fecha_completa === "string") inicio = horaMadridAIso(o.fecha_completa);
  else if (typeof o.fecha === "string") {
    inicio = horaMadridAIso(typeof o.hora === "string" ? `${o.fecha} ${o.hora}` : o.fecha);
  }
  return { local: limpiarEquipo(local), visitante: limpiarEquipo(visitante), inicio };
}

export function fechaDe(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.replace(/\\/g, "");
  const iso = s.match(/(\d{4})[-/](\d{2})[-/](\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const es = s.match(/(\d{2})[-/](\d{2})[-/](\d{4})/);
  if (es) return `${es[3]}-${es[2]}-${es[1]}`;
  return null;
}

/** "2026/09/29 20:45:00" (hora de Madrid) -> ISO UTC. Null si no trae hora. */
export function horaMadridAIso(v: string): string | null {
  const fecha = fechaDe(v);
  const hora = v.match(/(\d{1,2}):(\d{2})/);
  if (!fecha || !hora) return null;
  const [y, m, d] = fecha.split("-").map(Number);
  const supuesto = Date.UTC(y, m - 1, d, Number(hora[1]), Number(hora[2]));
  return new Date(supuesto - offsetMadridMin(new Date(supuesto)) * 60000).toISOString();
}

function offsetMadridMin(d: Date): number {
  const partes = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Madrid",
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(d);
  const n = (t: string) => Number(partes.find((p) => p.type === t)!.value);
  return (Date.UTC(n("year"), n("month") - 1, n("day"), n("hour"), n("minute")) - d.getTime()) / 60000;
}
