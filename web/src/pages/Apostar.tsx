import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Aviso, Cargando } from "../components/ui";
import { useJornada } from "../hooks/useJornada";
import { useSession } from "../hooks/useSession";
import { fechaHora, jornadaAbierta, PLENOS, SIGNOS } from "../lib/quiniela";
import { supabase } from "../lib/supabase";
import type { Pleno, Signo } from "../lib/types";

export default function Apostar() {
  const id = Number(useParams().id);
  const navigate = useNavigate();
  const { session } = useSession();
  const { jornada, partidos, apuestas, cargando } = useJornada(id);
  const mia = apuestas.find((a) => a.user_id === session?.user.id);

  const [signos, setSignos] = useState<(Signo | null)[]>(Array(14).fill(null));
  const [plenoL, setPlenoL] = useState<Pleno | null>(null);
  const [plenoV, setPlenoV] = useState<Pleno | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [inicializado, setInicializado] = useState(false);

  useEffect(() => {
    if (cargando || inicializado) return;
    if (mia) {
      setSignos(mia.signos.split("") as Signo[]);
      setPlenoL(mia.pleno_local);
      setPlenoV(mia.pleno_visitante);
    }
    setInicializado(true);
  }, [cargando, mia, inicializado]);

  if (cargando || !inicializado) return <Cargando />;
  if (!jornada) return <Aviso tipo="error">No existe esa jornada.</Aviso>;
  if (!jornadaAbierta(jornada)) {
    return (
      <div className="space-y-4">
        <Aviso>La jornada ya está cerrada: no se pueden hacer ni cambiar apuestas.</Aviso>
        <Link to={`/jornada/${id}`} className="boton-sec">
          Volver a la jornada
        </Link>
      </div>
    );
  }
  if (partidos.length < 15) {
    return <Aviso tipo="error">La jornada todavía no tiene sus 15 partidos. Complétala en Gestión.</Aviso>;
  }

  const completa = signos.every(Boolean) && plenoL && plenoV;
  const rellenados = signos.filter(Boolean).length + (plenoL && plenoV ? 1 : 0);

  async function guardar() {
    if (!completa || !session) return;
    setGuardando(true);
    setError(null);
    const { error } = await supabase.from("apuestas").upsert(
      {
        jornada_id: id,
        user_id: session.user.id,
        signos: signos.join(""),
        pleno_local: plenoL,
        pleno_visitante: plenoV,
      },
      { onConflict: "jornada_id,user_id" },
    );
    setGuardando(false);
    if (error) setError(error.message);
    else navigate(`/jornada/${id}`);
  }

  const p15 = partidos[14];

  return (
    <div className="space-y-5 pb-24">
      <div>
        <Link to={`/jornada/${id}`} className="text-sm text-slate-500 hover:underline">
          ← Jornada {jornada.numero}
        </Link>
        <h1 className="text-2xl font-black tracking-tight">{mia ? "Editar mi apuesta" : "Mi apuesta"}</h1>
        {jornada.cierre && (
          <p className="text-sm text-slate-500">Puedes cambiarla hasta el {fechaHora(jornada.cierre)}.</p>
        )}
      </div>

      <div className="tarjeta divide-y divide-slate-100 dark:divide-slate-800">
        {partidos.slice(0, 14).map((p, i) => (
          <div key={p.id} className="flex items-center gap-3 px-3 py-2.5">
            <span className="w-5 text-xs font-semibold text-slate-400">{p.posicion}</span>
            <p className="min-w-0 flex-1 truncate text-sm font-medium">
              {p.local} <span className="text-slate-400">-</span> {p.visitante}
            </p>
            <div className="flex gap-1">
              {SIGNOS.map((s) => (
                <BotonOpcion
                  key={s}
                  activo={signos[i] === s}
                  onClick={() => setSignos((prev) => prev.map((v, j) => (j === i ? s : v)))}
                >
                  {s}
                </BotonOpcion>
              ))}
            </div>
          </div>
        ))}
      </div>

      {p15 && (
        <div className="tarjeta space-y-3 p-4">
          <p className="text-xs font-semibold tracking-wide text-marca uppercase">Pleno al 15</p>
          {[
            { equipo: p15.local, valor: plenoL, set: setPlenoL },
            { equipo: p15.visitante, valor: plenoV, set: setPlenoV },
          ].map((f) => (
            <div key={f.equipo} className="flex items-center gap-3">
              <p className="min-w-0 flex-1 truncate text-sm font-medium">{f.equipo}</p>
              <div className="flex gap-1">
                {PLENOS.map((v) => (
                  <BotonOpcion key={v} activo={f.valor === v} onClick={() => f.set(v)}>
                    {v}
                  </BotonOpcion>
                ))}
              </div>
            </div>
          ))}
          <p className="text-xs text-slate-500">Goles de cada equipo: 0, 1, 2 o M (3 o más).</p>
        </div>
      )}

      {error && <Aviso tipo="error">{error}</Aviso>}

      <div className="fixed inset-x-0 bottom-0 border-t border-slate-200 bg-white/90 backdrop-blur dark:border-slate-800 dark:bg-slate-950/90">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-3 px-4 py-3">
          <span className="text-sm text-slate-500">{rellenados}/15 pronósticos</span>
          <button className="boton" disabled={!completa || guardando} onClick={guardar}>
            {guardando ? "Guardando…" : "Guardar apuesta"}
          </button>
        </div>
      </div>
    </div>
  );
}

function BotonOpcion({ activo, onClick, children }: { activo: boolean; onClick: () => void; children: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`h-10 w-10 rounded-xl text-sm font-bold transition ${
        activo
          ? "bg-marca text-white shadow-sm"
          : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
      }`}
    >
      {children}
    </button>
  );
}
