import type { Apuesta, Jornada, Partido, Pleno, Signo } from "./types";

export const SIGNOS: Signo[] = ["1", "X", "2"];
export const PLENOS: Pleno[] = ["0", "1", "2", "M"];

export const ESTADOS_EN_JUEGO = ["1H", "HT", "2H", "ET", "BT", "P", "LIVE", "INT", "SUSP"];

/** 'acierto' | 'fallo' | null (sin resultado). `provisional` = el partido no ha terminado. */
export type Evaluacion = { estado: "acierto" | "fallo" | null; provisional: boolean };

export function evaluar(p: Partido, a: Apuesta | undefined): Evaluacion {
  if (!a) return { estado: null, provisional: false };
  const provisional = !p.terminado;
  if (p.posicion === 15) {
    if (p.pleno_local == null || p.pleno_visitante == null) return { estado: null, provisional };
    const ok = p.pleno_local === a.pleno_local && p.pleno_visitante === a.pleno_visitante;
    return { estado: ok ? "acierto" : "fallo", provisional };
  }
  if (p.signo == null) return { estado: null, provisional };
  return { estado: p.signo === a.signos[p.posicion - 1] ? "acierto" : "fallo", provisional };
}

/** Misma cuenta que la vista v_aciertos_jornada, calculada en el cliente para el directo. */
export function contarAciertos(partidos: Partido[], a: Apuesta | undefined) {
  let aciertos = 0;
  let seguros = 0;
  for (const p of partidos) {
    const e = evaluar(p, a);
    if (e.estado === "acierto") {
      aciertos++;
      if (!e.provisional) seguros++;
    }
  }
  return { aciertos, seguros };
}

export function pronostico(p: Partido, a: Apuesta | undefined): string {
  if (!a) return "·";
  return p.posicion === 15 ? `${a.pleno_local}-${a.pleno_visitante}` : a.signos[p.posicion - 1];
}

export function resultadoActual(p: Partido): string {
  if (p.posicion === 15) return p.pleno_local && p.pleno_visitante ? `${p.pleno_local}-${p.pleno_visitante}` : "";
  return p.signo ?? "";
}

export function jornadaAbierta(j: Jornada): boolean {
  return j.estado === "abierta" && (!j.cierre || new Date(j.cierre).getTime() > Date.now());
}

const fmtFecha = new Intl.DateTimeFormat("es-ES", { weekday: "short", day: "numeric", month: "short" });
const fmtHora = new Intl.DateTimeFormat("es-ES", { weekday: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

export function fecha(d: string): string {
  return fmtFecha.format(new Date(d.length === 10 ? d + "T12:00:00" : d));
}

export function fechaHora(d: string): string {
  return fmtHora.format(new Date(d));
}

export function textoEstadoPartido(p: Partido): string {
  if (p.signo_oficial || p.pleno_oficial_local) return "Oficial";
  switch (p.estado) {
    case "NS":
    case "TBD":
      return p.inicio ? fechaHora(p.inicio) : "Por jugar";
    case "1H":
      return "1ª parte";
    case "HT":
      return "Descanso";
    case "2H":
      return "2ª parte";
    case "FT":
    case "AET":
    case "PEN":
      return "Final";
    case "PST":
      return "Aplazado";
    case "CANC":
      return "Cancelado";
    case "SUSP":
    case "INT":
      return "Interrumpido";
    default:
      return p.estado;
  }
}

export function enJuego(p: Partido): boolean {
  return !p.terminado && ESTADOS_EN_JUEGO.includes(p.estado);
}

/** Convierte "Local - Visitante" por línea en pares. Admite "-", "–", " vs ". */
export interface PartidoPegado {
  local: string;
  visitante: string;
  /** ISO UTC, o null si no venía hora */
  inicio: string | null;
}

export interface JornadaPegada {
  numero: number | null;
  partidos: PartidoPegado[];
  /** Líneas con texto que no parecen un partido */
  ignoradas: string[];
}

const DIAS_SEMANA =
  /\b(lun(es)?|mar(tes)?|mi[eé](rcoles)?|jue(ves)?|vie(rnes)?|s[aá]b(ado)?|dom(ingo)?)\b\.?,?/gi;
// "29/09", "29/09/2026" o "29-09-2026" (sin año con guion sería un marcador)
const RE_FECHA = /\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b|\b(\d{1,2})-(\d{1,2})-(\d{4})\b/;
const RE_HORA = /\b(\d{1,2})[:.h](\d{2})\s*h?\b/;
const RUIDO = /^(pleno( al)? 15|partidos?|jornada.*|1\s*x\s*2|[1x2 ]+|p15|local|visitante|fecha|hora)$/i;

/**
 * Reconoce los 15 partidos pegados desde cualquier sitio (p. ej. la web de
 * loteriasyapuestas.es). Admite "1. Local - Visitante 29/09 20:45", fechas u
 * horas en una línea aparte que valen para los partidos siguientes, marcas
 * "(m)"/"(f)" y, como último recurso, un equipo por línea.
 * `fechaSorteo` (YYYY-MM-DD) sirve para deducir el año de fechas sin año.
 */
export function parsearJornada(texto: string, fechaSorteo: string): JornadaPegada {
  const numero = Number(texto.match(/jornada\s*(?:n[ºo.]?\s*)?(\d{1,2})\b/i)?.[1] ?? NaN);
  const partidos: PartidoPegado[] = [];
  const sueltos: string[] = [];
  let dia: { d: number; m: number; y: number | null } | null = null;
  let hora: { h: number; min: number } | null = null;

  for (const bruta of texto.split(/\r?\n/)) {
    let l = bruta.replace(/\t+/g, " - ").trim();
    if (!l) continue;

    const f = l.match(RE_FECHA);
    if (f) {
      const [d, m, y] = f[1] ? [f[1], f[2], f[3]] : [f[4], f[5], f[6]];
      dia = { d: Number(d), m: Number(m), y: y ? Number(y.length === 2 ? "20" + y : y) : null };
      l = l.replace(f[0], " ");
    }
    const h = l.match(RE_HORA);
    if (h) {
      hora = { h: Number(h[1]), min: Number(h[2]) };
      l = l.replace(h[0], " ");
    }
    l = l
      .replace(DIAS_SEMANA, " ")
      .replace(/\((m|f)\)/gi, " ")
      .replace(/^\s*(p?\d{1,2})\s*[.)ºª:-]?\s+/i, "") // nº de partido
      .replace(/\s+/g, " ")
      .replace(/^[\s-–]+|[\s-–]+$/g, "")
      .trim();
    if (!l || RUIDO.test(l)) continue;

    let [local, visitante] = l.split(/\s+(?:-|–|vs\.?)\s+|\s*[–]\s*|\s+-|-\s+/i);
    // "Local-Visitante" sin espacios, solo si hay un único guion
    if (!visitante && (l.match(/-/g) ?? []).length === 1) [local, visitante] = l.split("-");
    const inicio = dia && hora ? madridAIso(dia, hora, fechaSorteo) : null;
    if (local?.trim() && visitante?.trim()) {
      partidos.push({ local: local.trim(), visitante: visitante.trim(), inicio });
    } else {
      sueltos.push(l);
    }
  }

  // Último recurso: un equipo por línea (30 líneas sin separador)
  if (partidos.length === 0 && sueltos.length === 30) {
    for (let i = 0; i < 30; i += 2) partidos.push({ local: sueltos[i], visitante: sueltos[i + 1], inicio: null });
    sueltos.length = 0;
  }

  return { numero: Number.isFinite(numero) && numero > 0 ? numero : null, partidos, ignoradas: sueltos };
}

/** Día y hora de Madrid -> ISO UTC. Sin año, elige el más cercano a la fecha del sorteo. */
function madridAIso(
  dia: { d: number; m: number; y: number | null },
  hora: { h: number; min: number },
  fechaSorteo: string,
): string | null {
  if (dia.m < 1 || dia.m > 12 || dia.d < 1 || dia.d > 31 || hora.h > 23 || hora.min > 59) return null;
  const ref = new Date(fechaSorteo + "T12:00:00Z");
  let y = dia.y ?? ref.getUTCFullYear();
  if (dia.y == null) {
    const candidato = Date.UTC(y, dia.m - 1, dia.d);
    if (candidato - ref.getTime() > 180 * 864e5) y--;
    else if (ref.getTime() - candidato > 180 * 864e5) y++;
  }
  const supuesto = Date.UTC(y, dia.m - 1, dia.d, hora.h, hora.min);
  const partes = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Madrid",
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(new Date(supuesto));
  const n = (t: string) => Number(partes.find((p) => p.type === t)!.value);
  const offset = Date.UTC(n("year"), n("month") - 1, n("day"), n("hour"), n("minute")) - supuesto;
  return new Date(supuesto - offset).toISOString();
}
