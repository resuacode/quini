import type { ReactNode } from "react";
import type { EstadoJornada, Jornada } from "../lib/types";

export const COLOR_JUGADOR = ["var(--color-j1)", "var(--color-j2)", "#059669", "#7c3aed"];

export function colorJugador(i: number) {
  return COLOR_JUGADOR[i % COLOR_JUGADOR.length];
}

export function Aviso({ tipo = "info", children }: { tipo?: "info" | "error" | "ok"; children: ReactNode }) {
  const estilos = {
    info: "border-sky-200 bg-sky-50 text-sky-900 dark:border-sky-900 dark:bg-sky-950 dark:text-sky-200",
    error: "border-red-200 bg-red-50 text-red-900 dark:border-red-900 dark:bg-red-950 dark:text-red-200",
    ok: "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200",
  };
  return <div className={`rounded-xl border px-4 py-3 text-sm ${estilos[tipo]}`}>{children}</div>;
}

const TEXTO_ESTADO: Record<EstadoJornada, string> = {
  abierta: "Abierta",
  en_juego: "En juego",
  finalizada: "Finalizada",
};

export function EstadoBadge({ jornada }: { jornada: Jornada }) {
  const estilos: Record<EstadoJornada, string> = {
    abierta: "bg-sky-100 text-sky-800 dark:bg-sky-900/50 dark:text-sky-300",
    en_juego: "bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300",
    finalizada: "bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
  };
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${estilos[jornada.estado]}`}>
        {jornada.estado === "en_juego" && <span className="en-vivo mr-1">●</span>}
        {TEXTO_ESTADO[jornada.estado]}
      </span>
      {jornada.oficial && (
        <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-semibold text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-300">
          ✓ Oficial
        </span>
      )}
    </span>
  );
}

export function Cargando() {
  return <p className="py-10 text-center text-sm text-slate-500">Cargando…</p>;
}
