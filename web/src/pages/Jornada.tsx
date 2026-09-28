import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Aviso, Cargando, colorJugador, EstadoBadge } from "../components/ui";
import { jornadaActualId, useJornada, usePerfiles } from "../hooks/useJornada";
import { useSession } from "../hooks/useSession";
import {
  contarAciertos,
  enJuego,
  evaluar,
  fecha,
  fechaHora,
  jornadaAbierta,
  pronostico,
  resultadoActual,
  textoEstadoPartido,
} from "../lib/quiniela";
import type { Apuesta, Partido, Perfil } from "../lib/types";

export default function JornadaPage() {
  const params = useParams();
  const [id, setId] = useState<number | null | undefined>(params.id ? Number(params.id) : undefined);

  useEffect(() => {
    if (params.id) setId(Number(params.id));
    else jornadaActualId().then(setId);
  }, [params.id]);

  if (id === undefined) return <Cargando />;
  if (id === null) {
    return (
      <div className="tarjeta p-8 text-center">
        <p className="mb-4 text-slate-600 dark:text-slate-400">Todavía no hay ninguna jornada.</p>
        <Link to="/gestion" className="boton">
          Crear la primera jornada
        </Link>
      </div>
    );
  }
  return <VistaJornada id={id} />;
}

function VistaJornada({ id }: { id: number }) {
  const { session } = useSession();
  const perfiles = usePerfiles();
  const { jornada, partidos, apuestas, cargando, error } = useJornada(id);

  if (cargando) return <Cargando />;
  if (error) return <Aviso tipo="error">{error}</Aviso>;
  if (!jornada) return <Aviso tipo="error">No existe esa jornada.</Aviso>;

  const abierta = jornadaAbierta(jornada);
  const miApuesta = apuestas.find((a) => a.user_id === session?.user.id);
  const jugadores = perfiles.map((p, i) => ({
    perfil: p,
    color: colorJugador(i),
    apuesta: apuestas.find((a) => a.user_id === p.id),
  }));
  const cuentas = jugadores.map((j) => contarAciertos(partidos, j.apuesta));
  const max = Math.max(0, ...cuentas.map((c) => c.aciertos));
  const lideres = cuentas.filter((c, i) => jugadores[i].apuesta && c.aciertos === max).length;
  const terminados = partidos.filter((p) => p.terminado).length;
  const vivos = partidos.filter(enJuego).length;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold tracking-wide text-slate-500 uppercase">
            Temporada {jornada.temporada} · {fecha(jornada.fecha)}
          </p>
          <h1 className="text-3xl font-black tracking-tight">Jornada {jornada.numero}</h1>
        </div>
        <EstadoBadge jornada={jornada} />
      </div>

      {abierta && (
        <div className="tarjeta flex flex-wrap items-center justify-between gap-3 p-4">
          <p className="text-sm text-slate-600 dark:text-slate-400">
            {jornada.cierre ? <>Se puede apostar hasta el <b>{fechaHora(jornada.cierre)}</b>.</> : "Apuestas abiertas."}
            {!miApuesta && " Aún no has hecho tu apuesta."}
          </p>
          <Link to={`/jornada/${id}/apuesta`} className="boton">
            {miApuesta ? "Editar mi apuesta" : "Hacer mi apuesta"}
          </Link>
        </div>
      )}

      {/* Marcador del duelo */}
      <div className="grid grid-cols-2 gap-3">
        {jugadores.map((j, i) => {
          const lider = j.apuesta && cuentas[i].aciertos === max && max > 0;
          return (
            <div
              key={j.perfil.id}
              className="tarjeta relative overflow-hidden p-4 sm:p-5"
              style={{ borderTop: `4px solid ${j.color}` }}
            >
              <p className="truncate font-semibold">{j.perfil.nombre}</p>
              {j.apuesta ? (
                <>
                  <p className="mt-1 text-5xl font-black tabular-nums" style={{ color: j.color }}>
                    {cuentas[i].aciertos}
                  </p>
                  <p className="text-xs text-slate-500">
                    aciertos
                    {cuentas[i].aciertos !== cuentas[i].seguros && ` · ${cuentas[i].seguros} seguros`}
                  </p>
                  {lider && (
                    <p className="mt-2 text-xs font-semibold" style={{ color: j.color }}>
                      {lideres > 1 ? "Empate" : jornada.estado === "finalizada" ? "🏆 Gana la jornada" : "Va ganando"}
                    </p>
                  )}
                </>
              ) : (
                <p className="mt-3 text-sm text-slate-500">Sin apuesta</p>
              )}
            </div>
          );
        })}
      </div>

      <p className="text-center text-xs text-slate-500">
        {terminados}/15 partidos terminados
        {vivos > 0 && (
          <span className="ml-2 font-semibold text-red-600">
            <span className="en-vivo">●</span> {vivos} en juego
          </span>
        )}
        {!jornada.oficial && terminados > 0 && " · resultado provisional hasta el escrutinio oficial"}
      </p>

      {/* Tabla de partidos */}
      <div className="tarjeta overflow-hidden">
        <table className="w-full table-fixed text-sm">
          <thead className="bg-slate-50 text-xs text-slate-500 dark:bg-slate-800/50">
            <tr>
              <th className="w-9 py-2 pl-3 text-left">#</th>
              <th className="py-2 text-left">Partido</th>
              <th className="w-10 py-2 text-center sm:w-14">Res.</th>
              {jugadores.map((j) => (
                <th key={j.perfil.id} className="w-11 py-2 text-center sm:w-16" style={{ color: j.color }}>
                  <span className="block truncate px-1">{inicial(j.perfil)}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {partidos.map((p) => (
              <FilaPartido key={p.id} partido={p} apuestas={jugadores.map((j) => j.apuesta)} />
            ))}
          </tbody>
        </table>
        {partidos.length === 0 && (
          <p className="p-6 text-center text-sm text-slate-500">
            Esta jornada no tiene partidos. <Link to={`/gestion/${id}`} className="text-marca underline">Añádelos</Link>.
          </p>
        )}
      </div>

      <div className="flex justify-end">
        <Link to={`/gestion/${id}`} className="text-xs text-slate-500 underline hover:text-slate-800">
          Gestionar esta jornada
        </Link>
      </div>
    </div>
  );
}

function FilaPartido({ partido: p, apuestas }: { partido: Partido; apuestas: (Apuesta | undefined)[] }) {
  const vivo = enJuego(p);
  const marcador = p.goles_local != null && p.goles_visitante != null ? `${p.goles_local}-${p.goles_visitante}` : null;
  const res = resultadoActual(p);

  return (
    <tr className={`border-t border-slate-100 dark:border-slate-800 ${p.posicion === 15 ? "bg-marca-claro/50 dark:bg-red-950/20" : ""}`}>
      <td className="py-2 pl-3 text-[11px] font-semibold text-slate-400">{p.posicion === 15 ? "P15" : p.posicion}</td>
      <td className="py-2 pr-2">
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium">{p.local}</p>
            <p className="truncate font-medium">{p.visitante}</p>
            <p className={`text-xs ${vivo ? "font-semibold text-red-600" : "text-slate-500"}`}>
              {vivo && <span className="en-vivo mr-1">●</span>}
              {textoEstadoPartido(p)}
            </p>
          </div>
          {marcador && (
            <span
              className={`rounded-md px-1.5 py-0.5 font-mono text-xs font-bold tabular-nums ${
                vivo ? "bg-red-600 text-white" : "bg-slate-100 dark:bg-slate-800"
              }`}
            >
              {marcador}
            </span>
          )}
        </div>
      </td>
      <td className="py-2 text-center text-xs font-bold sm:text-sm">{res}</td>
      {apuestas.map((a, i) => {
        const e = evaluar(p, a);
        const clase =
          e.estado === "acierto"
            ? e.provisional
              ? "bg-emerald-100 text-emerald-800 ring-1 ring-emerald-400 ring-inset dark:bg-emerald-900/40 dark:text-emerald-300"
              : "bg-emerald-500 text-white"
            : e.estado === "fallo"
              ? e.provisional
                ? "bg-red-50 text-red-700 ring-1 ring-red-300 ring-inset dark:bg-red-950/40 dark:text-red-300"
                : "bg-red-500/90 text-white"
              : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300";
        return (
          <td key={i} className="px-1 py-2 text-center">
            <span className={`inline-flex min-w-8 justify-center rounded-md px-0.5 py-1 text-xs font-bold sm:text-sm ${clase}`}>
              {pronostico(p, a)}
            </span>
          </td>
        );
      })}
    </tr>
  );
}

function inicial(p: Perfil) {
  return p.nombre.length <= 6 ? p.nombre : p.nombre.slice(0, 5) + ".";
}
