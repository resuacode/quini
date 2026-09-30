import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { Aviso, Cargando, EstadoBadge } from "../components/ui";
import { useJornada } from "../hooks/useJornada";
import { fecha, fechaHora, parsearJornada, PLENOS, SIGNOS } from "../lib/quiniela";
import { invocar, supabase } from "../lib/supabase";
import type { EstadoJornada, Jornada, Partido } from "../lib/types";

type Msg = { tipo: "ok" | "error" | "info"; texto: string } | null;

export default function Gestion() {
  const { id } = useParams();
  return id ? <EditorJornada id={Number(id)} /> : <ListaJornadas />;
}

// ---------------------------------------------------------------------------
// Lista + nueva jornada
// ---------------------------------------------------------------------------

function ListaJornadas() {
  const [jornadas, setJornadas] = useState<Jornada[] | null>(null);

  useEffect(() => {
    supabase
      .from("jornadas")
      .select("*")
      .order("fecha", { ascending: false })
      .limit(40)
      .then(({ data }) => setJornadas(data ?? []));
  }, []);

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-black tracking-tight">Gestión</h1>

      <div className="tarjeta space-y-3 p-5">
        <h2 className="font-bold">Nueva jornada</h2>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Copia los 15 partidos de la quiniela (por ejemplo, desde{" "}
          <a
            href="https://www.loteriasyapuestas.es/es/la-quiniela"
            target="_blank"
            rel="noreferrer"
            className="text-marca underline"
          >
            loteriasyapuestas.es
          </a>
          ) y pégalos aquí. Si traen fecha y hora, se usan para el cierre de apuestas y para enlazar el directo.
        </p>
        <AltaJornada />
      </div>

      <div className="tarjeta overflow-hidden">
        <h2 className="px-5 pt-4 pb-2 font-bold">Jornadas</h2>
        {jornadas === null ? (
          <Cargando />
        ) : jornadas.length === 0 ? (
          <p className="px-5 pb-5 text-sm text-slate-500">Aún no hay jornadas.</p>
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {jornadas.map((j) => (
              <li key={j.id}>
                <Link
                  to={`/gestion/${j.id}`}
                  className="flex items-center justify-between gap-3 px-5 py-3 hover:bg-slate-50 dark:hover:bg-slate-800/40"
                >
                  <span>
                    <b>J{j.numero}</b> <span className="text-sm text-slate-500">· {j.temporada} · {fecha(j.fecha)}</span>
                  </span>
                  <EstadoBadge jornada={j} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function AltaJornada() {
  const navigate = useNavigate();
  const [numero, setNumero] = useState("");
  const [dia, setDia] = useState(proximoDomingo());
  const [texto, setTexto] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  const { numero: numeroPegado, partidos, ignoradas } = parsearJornada(texto, dia);
  const numeroFinal = numero || (numeroPegado ? String(numeroPegado) : "");
  const validos = partidos.length === 15;
  const conHora = partidos.filter((p) => p.inicio).length;

  async function crear() {
    setGuardando(true);
    setError(null);
    const { data: temporada } = await supabase.rpc("temporada_de", { d: dia });
    const { data: j, error } = await supabase
      .from("jornadas")
      .insert({ temporada, numero: Number(numeroFinal), fecha: dia })
      .select("id")
      .single();
    if (error) {
      setGuardando(false);
      setError(error.code === "23505" ? "Ya existe esa jornada en la temporada." : error.message);
      return;
    }
    const { error: e2 } = await supabase.from("partidos").insert(
      partidos.map((p, i) => ({
        jornada_id: j.id,
        posicion: i + 1,
        local: p.local,
        visitante: p.visitante,
        inicio: p.inicio,
      })),
    );
    if (e2) {
      setGuardando(false);
      setError(e2.message);
      return;
    }
    // Intentamos enlazar con API-Football para tener el directo
    let resumen = "Jornada creada.";
    try {
      const r = await invocar<{ enlazados: number; sin_enlazar: number[] }>("import-jornada", {
        action: "enlazar",
        jornada_id: j.id,
      });
      resumen = resumenEnlace(r);
    } catch (e) {
      resumen = `Jornada creada, pero no se pudo enlazar con API-Football: ${(e as Error).message}`;
    }
    navigate(`/gestion/${j.id}`, { state: { resumen } });
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <label>
          <span className="etiqueta">Nº de jornada</span>
          <input
            className="campo"
            type="number"
            min={1}
            value={numeroFinal}
            onChange={(e) => setNumero(e.target.value)}
          />
        </label>
        <label>
          <span className="etiqueta">Fecha del sorteo</span>
          <input className="campo" type="date" value={dia} onChange={(e) => setDia(e.target.value)} />
        </label>
      </div>
      <label className="block">
        <span className="etiqueta">Los 15 partidos (el 15º es el pleno)</span>
        <textarea
          className="campo h-60 font-mono text-xs"
          placeholder={"1. Real Madrid - Villarreal   sáb 04/10 21:00\n2. Barcelona - Sevilla   dom 05/10 16:15\n…"}
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
        />
      </label>

      {texto.trim() && (
        <div className="space-y-2">
          <p className={`text-xs font-semibold ${validos ? "text-emerald-600" : "text-marca"}`}>
            {partidos.length}/15 partidos reconocidos
            {partidos.length > 0 && ` · ${conHora} con fecha y hora`}
            {partidos.length > 15 && " · sobran partidos: deja solo los 15 de la quiniela"}
          </p>
          {partidos.length > 0 && (
            <ol className="divide-y divide-slate-100 rounded-xl border border-slate-200 text-sm dark:divide-slate-800 dark:border-slate-800">
              {partidos.map((p, i) => (
                <li key={i} className="flex items-center gap-3 px-3 py-1.5">
                  <span className="w-6 text-xs font-semibold text-slate-400">{i === 14 ? "P15" : i + 1}</span>
                  <span className="min-w-0 flex-1 truncate">
                    {p.local} <span className="text-slate-400">-</span> {p.visitante}
                  </span>
                  <span className="shrink-0 text-xs text-slate-500">{p.inicio ? fechaHora(p.inicio) : "sin hora"}</span>
                </li>
              ))}
            </ol>
          )}
          {ignoradas.length > 0 && (
            <p className="text-xs text-slate-500">
              Líneas ignoradas: {ignoradas.slice(0, 5).map((l) => `«${l}»`).join(", ")}
              {ignoradas.length > 5 && ` y ${ignoradas.length - 5} más`}
            </p>
          )}
        </div>
      )}

      {error && <Aviso tipo="error">{error}</Aviso>}
      <button className="boton" disabled={!validos || !numeroFinal || guardando} onClick={crear}>
        {guardando ? "Creando…" : "Crear jornada"}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Editor de una jornada
// ---------------------------------------------------------------------------

type Edicion = Partial<Pick<Partido,
  "local" | "visitante" | "inicio" | "fixture_id" | "goles_local" | "goles_visitante" | "estado" |
  "signo_oficial" | "pleno_oficial_local" | "pleno_oficial_visitante">>;

function EditorJornada({ id }: { id: number }) {
  const navigate = useNavigate();
  const { jornada, partidos, cargando, recargar } = useJornada(id);
  const [cambios, setCambios] = useState<Record<number, Edicion>>({});
  const [ocupado, setOcupado] = useState<string | null>(null);
  const resumen = (useLocation().state as { resumen?: string } | null)?.resumen;
  const [msg, setMsg] = useState<Msg>(resumen ? { tipo: "info", texto: resumen } : null);

  if (cargando) return <Cargando />;
  if (!jornada) return <Aviso tipo="error">No existe esa jornada.</Aviso>;

  const valor = <K extends keyof Edicion>(p: Partido, k: K): Partido[K] =>
    (k in (cambios[p.id] ?? {}) ? cambios[p.id][k] : p[k]) as Partido[K];
  const editar = (p: Partido, k: keyof Edicion, v: unknown) =>
    setCambios((c) => ({ ...c, [p.id]: { ...c[p.id], [k]: v } }));

  async function accion(nombre: string, fn: () => Promise<string>) {
    setOcupado(nombre);
    setMsg(null);
    try {
      setMsg({ tipo: "ok", texto: await fn() });
      await recargar();
    } catch (e) {
      setMsg({ tipo: "error", texto: (e as Error).message });
    } finally {
      setOcupado(null);
    }
  }

  const guardar = () =>
    accion("guardar", async () => {
      for (const [pid, c] of Object.entries(cambios)) {
        const { error } = await supabase.from("partidos").update(c).eq("id", Number(pid));
        if (error) throw error;
      }
      const n = Object.keys(cambios).length;
      setCambios({});
      return `${n} partido(s) guardado(s).`;
    });

  const cambiarJornada = (c: Partial<Jornada>) =>
    accion("jornada", async () => {
      const { error } = await supabase.from("jornadas").update(c).eq("id", id);
      if (error) throw error;
      return "Jornada actualizada.";
    });

  const borrar = async () => {
    if (!confirm(`¿Borrar la jornada ${jornada.numero} con sus partidos y apuestas?`)) return;
    const { error } = await supabase.from("jornadas").delete().eq("id", id);
    if (error) setMsg({ tipo: "error", texto: error.message });
    else navigate("/gestion");
  };

  const pendientes = Object.keys(cambios).length;

  return (
    <div className="space-y-5 pb-20">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link to="/gestion" className="text-sm text-slate-500 hover:underline">
            ← Gestión
          </Link>
          <h1 className="text-2xl font-black tracking-tight">
            Jornada {jornada.numero} <span className="text-base font-medium text-slate-500">· {jornada.temporada}</span>
          </h1>
        </div>
        <div className="flex items-center gap-3">
          <EstadoBadge jornada={jornada} />
          <Link to={`/jornada/${id}`} className="boton-sec">
            Ver jornada
          </Link>
        </div>
      </div>

      {msg && <Aviso tipo={msg.tipo}>{msg.texto}</Aviso>}

      <div className="tarjeta grid gap-4 p-5 sm:grid-cols-3">
        <label>
          <span className="etiqueta">Fecha del sorteo</span>
          <input
            className="campo"
            type="date"
            defaultValue={jornada.fecha}
            onBlur={(e) => e.target.value !== jornada.fecha && cambiarJornada({ fecha: e.target.value })}
          />
        </label>
        <label>
          <span className="etiqueta">Cierre de apuestas</span>
          <input
            className="campo"
            type="datetime-local"
            defaultValue={aLocal(jornada.cierre)}
            onBlur={(e) => {
              const v = deLocal(e.target.value);
              if (v !== jornada.cierre) cambiarJornada({ cierre: v });
            }}
          />
        </label>
        <label>
          <span className="etiqueta">Estado</span>
          <select
            className="campo"
            value={jornada.estado}
            onChange={(e) => cambiarJornada({ estado: e.target.value as EstadoJornada })}
          >
            <option value="abierta">Abierta</option>
            <option value="en_juego">En juego</option>
            <option value="finalizada">Finalizada</option>
          </select>
        </label>
        <div className="flex flex-wrap gap-2 sm:col-span-3">
          <button
            className="boton-sec"
            disabled={!!ocupado}
            onClick={() =>
              accion("enlazar", async () =>
                resumenEnlace(await invocar("import-jornada", { action: "enlazar", jornada_id: id })),
              )
            }
          >
            {ocupado === "enlazar" ? "Enlazando…" : "Enlazar con API-Football"}
          </button>
          <button
            className="boton-sec"
            disabled={!!ocupado}
            onClick={() =>
              accion("live", async () => {
                const r = await invocar<{ omitido?: string; actualizados?: number[] }>("sync-live");
                return r.omitido ? `Sin cambios: ${r.omitido}.` : `${r.actualizados?.length ?? 0} partido(s) actualizados.`;
              })
            }
          >
            {ocupado === "live" ? "Actualizando…" : "Actualizar directo"}
          </button>
          <button
            className="boton-sec"
            disabled={!!ocupado}
            onClick={() =>
              accion("oficial", async () => {
                const r = await invocar<{ informe?: Record<string, string>; omitido?: string }>("sync-oficial", {
                  jornada_id: id,
                });
                return r.informe?.[id] ?? r.omitido ?? "Hecho.";
              })
            }
          >
            {ocupado === "oficial" ? "Consultando…" : "Traer resultado oficial"}
          </button>
          <button className="ml-auto text-sm text-red-600 hover:underline" onClick={borrar}>
            Borrar jornada
          </button>
        </div>
      </div>

      <div className="tarjeta overflow-x-auto">
        <table className="w-full min-w-[900px] table-fixed text-sm">
          <thead className="bg-slate-50 text-xs text-slate-500 dark:bg-slate-800/50">
            <tr>
              <th className="w-9 py-2 pl-3 text-left">#</th>
              <th className="py-2 text-left">Local</th>
              <th className="py-2 text-left">Visitante</th>
              <th className="w-48 py-2 text-left">Inicio</th>
              <th className="w-24 py-2 text-left">Fixture</th>
              <th className="w-28 py-2 text-center">Goles</th>
              <th className="w-24 py-2 text-left">Estado</th>
              <th className="w-32 py-2 pr-3 text-left">Oficial</th>
            </tr>
          </thead>
          <tbody>
            {partidos.map((p) => (
              <tr
                key={p.id}
                className={`border-t border-slate-100 dark:border-slate-800 ${cambios[p.id] ? "bg-amber-50 dark:bg-amber-950/20" : ""}`}
              >
                <td className="py-1.5 pl-3 text-xs font-semibold text-slate-400">{p.posicion}</td>
                <td className="py-1.5 pr-1">
                  <input className="campo py-1" value={valor(p, "local")} onChange={(e) => editar(p, "local", e.target.value)} />
                </td>
                <td className="py-1.5 pr-1">
                  <input className="campo py-1" value={valor(p, "visitante")} onChange={(e) => editar(p, "visitante", e.target.value)} />
                </td>
                <td className="py-1.5 pr-1">
                  <input
                    className="campo py-1"
                    type="datetime-local"
                    value={aLocal(valor(p, "inicio"))}
                    onChange={(e) => editar(p, "inicio", deLocal(e.target.value))}
                  />
                </td>
                <td className="py-1.5 pr-1">
                  <input
                    className="campo py-1"
                    inputMode="numeric"
                    value={valor(p, "fixture_id") ?? ""}
                    onChange={(e) => editar(p, "fixture_id", e.target.value ? Number(e.target.value) : null)}
                  />
                </td>
                <td className="py-1.5 pr-1">
                  <div className="flex items-center gap-1">
                    <InputGoles valor={valor(p, "goles_local")} onChange={(v) => editar(p, "goles_local", v)} />
                    <span className="text-slate-400">-</span>
                    <InputGoles valor={valor(p, "goles_visitante")} onChange={(v) => editar(p, "goles_visitante", v)} />
                  </div>
                </td>
                <td className="py-1.5 pr-1">
                  <select className="campo py-1" value={valor(p, "estado")} onChange={(e) => editar(p, "estado", e.target.value)}>
                    {["NS", "1H", "HT", "2H", "FT", "PST", "CANC", "SUSP"].map((s) => (
                      <option key={s}>{s}</option>
                    ))}
                  </select>
                </td>
                <td className="py-1.5 pr-3">
                  {p.posicion < 15 ? (
                    <select
                      className="campo w-16 py-1"
                      value={valor(p, "signo_oficial") ?? ""}
                      onChange={(e) => editar(p, "signo_oficial", e.target.value || null)}
                    >
                      <option value="">–</option>
                      {SIGNOS.map((s) => (
                        <option key={s}>{s}</option>
                      ))}
                    </select>
                  ) : (
                    <div className="flex gap-1">
                      {(["pleno_oficial_local", "pleno_oficial_visitante"] as const).map((k) => (
                        <select
                          key={k}
                          className="campo w-14 py-1"
                          value={valor(p, k) ?? ""}
                          onChange={(e) => editar(p, k, e.target.value || null)}
                        >
                          <option value="">–</option>
                          {PLENOS.map((s) => (
                            <option key={s}>{s}</option>
                          ))}
                        </select>
                      ))}
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-slate-500">
        «Fixture» es el id del partido en API-Football (para el directo). «Oficial» pisa al resultado calculado con los
        goles; se rellena solo con lo que publica SELAE al acabar cada partido, pero puedes corregirlo a mano.
      </p>

      {pendientes > 0 && (
        <div className="fixed inset-x-0 bottom-0 border-t border-slate-200 bg-white/90 backdrop-blur dark:border-slate-800 dark:bg-slate-950/90">
          <div className="mx-auto flex max-w-4xl items-center justify-between gap-3 px-4 py-3">
            <span className="text-sm text-slate-500">{pendientes} partido(s) con cambios</span>
            <div className="flex gap-2">
              <button className="boton-sec" onClick={() => setCambios({})}>
                Descartar
              </button>
              <button className="boton" disabled={!!ocupado} onClick={guardar}>
                Guardar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function InputGoles({ valor, onChange }: { valor: number | null | undefined; onChange: (v: number | null) => void }) {
  return (
    <input
      className="campo w-11 px-1 py-1 text-center"
      inputMode="numeric"
      value={valor ?? ""}
      onChange={(e) => {
        const v = e.target.value.replace(/\D/g, "");
        onChange(v === "" ? null : Number(v));
      }}
    />
  );
}

function resumenEnlace(r: { enlazados?: number; sin_enlazar?: number[]; aviso?: string }): string {
  const partes: string[] = [];
  if (r.aviso) partes.push(r.aviso);
  if (r.enlazados != null) partes.push(`${r.enlazados} partido(s) enlazados con API-Football.`);
  if (r.sin_enlazar?.length) {
    partes.push(`Sin enlazar: ${r.sin_enlazar.join(", ")} (puedes poner el fixture a mano o meter el resultado).`);
  }
  return partes.join(" ") || "Hecho.";
}

function aLocal(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  const off = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - off).toISOString().slice(0, 16);
}

function deLocal(v: string): string | null {
  return v ? new Date(v).toISOString() : null;
}

function proximoDomingo(): string {
  const d = new Date();
  d.setDate(d.getDate() + ((7 - d.getDay()) % 7));
  return aLocal(d.toISOString()).slice(0, 10);
}
