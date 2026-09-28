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
export function parsearPartidos(texto: string): { local: string; visitante: string }[] {
  return texto
    .split("\n")
    .map((l) => l.replace(/^\s*\d+\s*[.)-]?\s+/, "").trim())
    .filter(Boolean)
    .map((l) => {
      const [local, visitante] = l.split(/\s+(?:-|–|vs\.?)\s+|\s*[-–]\s*/i);
      return { local: (local ?? "").trim(), visitante: (visitante ?? "").trim() };
    });
}
