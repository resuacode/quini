import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Aviso, Cargando, colorJugador, EstadoBadge } from "../components/ui";
import { usePerfiles } from "../hooks/useJornada";
import { fecha } from "../lib/quiniela";
import { supabase } from "../lib/supabase";
import type { Clasificacion, DueloJornada, Jornada } from "../lib/types";

export default function Temporada() {
  const perfiles = usePerfiles();
  const [temporadas, setTemporadas] = useState<string[]>([]);
  const [temporada, setTemporada] = useState<string | null>(null);
  const [clasif, setClasif] = useState<Clasificacion[]>([]);
  const [duelos, setDuelos] = useState<DueloJornada[]>([]);
  const [jornadas, setJornadas] = useState<Jornada[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    supabase
      .from("jornadas")
      .select("temporada")
      .order("temporada", { ascending: false })
      .then(({ data, error }) => {
        if (error) setError(error.message);
        const lista = [...new Set((data ?? []).map((d) => d.temporada as string))];
        setTemporadas(lista);
        setTemporada(lista[0] ?? null);
        if (!lista.length) setCargando(false);
      });
  }, []);

  useEffect(() => {
    if (!temporada) return;
    setCargando(true);
    Promise.all([
      supabase.from("v_clasificacion").select("*").eq("temporada", temporada),
      supabase.from("v_duelo_jornada").select("*").eq("temporada", temporada),
      supabase.from("jornadas").select("*").eq("temporada", temporada).order("numero", { ascending: false }),
    ]).then(([c, d, j]) => {
      setError(c.error?.message ?? d.error?.message ?? j.error?.message ?? null);
      setClasif(c.data ?? []);
      setDuelos(d.data ?? []);
      setJornadas(j.data ?? []);
      setCargando(false);
    });
  }, [temporada]);

  const jugadores = perfiles.map((p, i) => ({
    perfil: p,
    color: colorJugador(i),
    stats: clasif.find((c) => c.user_id === p.id),
  }));

  const porJornada = useMemo(() => {
    const m = new Map<number, Map<string, DueloJornada>>();
    for (const d of duelos) {
      if (!m.has(d.jornada_id)) m.set(d.jornada_id, new Map());
      m.get(d.jornada_id)!.set(d.user_id, d);
    }
    return m;
  }, [duelos]);

  if (error) return <Aviso tipo="error">{error}</Aviso>;
  if (!cargando && temporadas.length === 0) return <Aviso>Todavía no hay jornadas registradas.</Aviso>;

  const [a, b] = jugadores;
  const empates = a?.stats?.empates ?? 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-3xl font-black tracking-tight">Temporada</h1>
        {temporadas.length > 0 && (
          <select className="campo w-auto" value={temporada ?? ""} onChange={(e) => setTemporada(e.target.value)}>
            {temporadas.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        )}
      </div>

      {cargando ? (
        <Cargando />
      ) : (
        <>
          {/* Duelo: jornadas ganadas */}
          {a && b && (
            <div className="tarjeta p-5">
              <p className="mb-3 text-center text-xs font-semibold tracking-wide text-slate-500 uppercase">
                Quinielas ganadas
              </p>
              <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 text-center">
                <Contrincante nombre={a.perfil.nombre} valor={a.stats?.ganadas ?? 0} color={a.color} />
                <div className="text-sm text-slate-500">
                  <p className="text-2xl font-bold text-slate-400 tabular-nums">{empates}</p>
                  empates
                </div>
                <Contrincante nombre={b.perfil.nombre} valor={b.stats?.ganadas ?? 0} color={b.color} />
              </div>
              <BarraDuelo a={a.stats?.ganadas ?? 0} e={empates} b={b.stats?.ganadas ?? 0} ca={a.color} cb={b.color} />
            </div>
          )}

          {/* Estadísticas de aciertos */}
          <div className="grid grid-cols-2 gap-3">
            {jugadores.map((j) => (
              <div key={j.perfil.id} className="tarjeta p-4" style={{ borderTop: `4px solid ${j.color}` }}>
                <p className="font-semibold">{j.perfil.nombre}</p>
                <p className="mt-1 text-4xl font-black tabular-nums" style={{ color: j.color }}>
                  {j.stats?.aciertos_totales ?? 0}
                </p>
                <p className="text-xs text-slate-500">aciertos totales</p>
                <dl className="mt-3 grid grid-cols-2 gap-y-1 text-xs">
                  <dt className="text-slate-500">Media</dt>
                  <dd className="text-right font-semibold tabular-nums">{j.stats?.media_aciertos ?? "–"}</dd>
                  <dt className="text-slate-500">Mejor jornada</dt>
                  <dd className="text-right font-semibold tabular-nums">{j.stats?.mejor_jornada ?? "–"}</dd>
                  <dt className="text-slate-500">Jugadas</dt>
                  <dd className="text-right font-semibold tabular-nums">{j.stats?.jornadas_jugadas ?? 0}</dd>
                </dl>
              </div>
            ))}
          </div>

          {/* Jornada a jornada */}
          <div className="tarjeta overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500 dark:bg-slate-800/50">
                <tr>
                  <th className="py-2 pl-4 text-left">Jornada</th>
                  {jugadores.map((j) => (
                    <th key={j.perfil.id} className="w-20 py-2 text-center" style={{ color: j.color }}>
                      <span className="block truncate px-1">{j.perfil.nombre}</span>
                    </th>
                  ))}
                  <th className="hidden w-32 py-2 pr-4 text-right sm:table-cell">Estado</th>
                </tr>
              </thead>
              <tbody>
                {jornadas.map((jn) => {
                  const fila = porJornada.get(jn.id);
                  return (
                    <tr key={jn.id} className="border-t border-slate-100 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/40">
                      <td className="py-2.5 pl-4">
                        <Link to={`/jornada/${jn.id}`} className="font-semibold hover:underline">
                          J{jn.numero}
                        </Link>
                        <span className="ml-2 text-xs text-slate-500">{fecha(jn.fecha)}</span>
                      </td>
                      {jugadores.map((j) => {
                        const d = fila?.get(j.perfil.id);
                        const gana = jn.estado === "finalizada" && d?.resultado === "ganada";
                        return (
                          <td key={j.perfil.id} className="py-2.5 text-center">
                            {d ? (
                              <span
                                className={`inline-flex min-w-9 justify-center rounded-lg px-2 py-0.5 font-bold tabular-nums ${
                                  gana ? "text-white" : "text-slate-700 dark:text-slate-300"
                                }`}
                                style={gana ? { background: j.color } : undefined}
                              >
                                {d.aciertos}
                              </span>
                            ) : (
                              <span className="text-slate-300">–</span>
                            )}
                          </td>
                        );
                      })}
                      <td className="hidden py-2.5 pr-4 text-right sm:table-cell">
                        <EstadoBadge jornada={jn} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="text-center text-xs text-slate-500">
            La clasificación solo incluye jornadas finalizadas; las victorias, solo si habéis apostado los dos.
          </p>
        </>
      )}
    </div>
  );
}

function Contrincante({ nombre, valor, color }: { nombre: string; valor: number; color: string }) {
  return (
    <div className="min-w-0">
      <p className="text-5xl font-black tabular-nums" style={{ color }}>
        {valor}
      </p>
      <p className="truncate text-sm font-semibold">{nombre}</p>
    </div>
  );
}

function BarraDuelo({ a, e, b, ca, cb }: { a: number; e: number; b: number; ca: string; cb: string }) {
  const total = a + e + b;
  if (!total) return null;
  return (
    <div className="mt-4 flex h-2.5 gap-0.5 overflow-hidden rounded-full">
      {a > 0 && <div style={{ flex: a, background: ca }} />}
      {e > 0 && <div className="bg-slate-300 dark:bg-slate-600" style={{ flex: e }} />}
      {b > 0 && <div style={{ flex: b, background: cb }} />}
    </div>
  );
}
