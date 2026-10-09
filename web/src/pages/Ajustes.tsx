import { useEffect, useRef, useState, type FormEvent } from "react";
import { Aviso, Cargando } from "../components/ui";
import { useSession } from "../hooks/useSession";
import { invocar, supabase } from "../lib/supabase";

const PALABRA = "BORRAR";
export const AVISO_CUENTA_BORRADA = "quini:cuenta-borrada";

export default function Ajustes() {
  const { session } = useSession();
  const usuario = session?.user;
  const [nombre, setNombre] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [msg, setMsg] = useState<{ tipo: "ok" | "error"; texto: string } | null>(null);
  const [confirmando, setConfirmando] = useState(false);

  useEffect(() => {
    if (!usuario) return;
    supabase
      .from("profiles")
      .select("nombre")
      .eq("id", usuario.id)
      .single()
      .then(({ data }) => setNombre(data?.nombre ?? ""));
  }, [usuario]);

  async function guardarNombre(e: FormEvent) {
    e.preventDefault();
    if (!usuario || !nombre?.trim()) return;
    setGuardando(true);
    setMsg(null);
    const { error } = await supabase.from("profiles").update({ nombre: nombre.trim() }).eq("id", usuario.id);
    setGuardando(false);
    setMsg(error ? { tipo: "error", texto: error.message } : { tipo: "ok", texto: "Nombre guardado." });
  }

  if (!usuario || nombre === null) return <Cargando />;

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-black tracking-tight">Ajustes</h1>

      <form onSubmit={guardarNombre} className="tarjeta space-y-4 p-5">
        <h2 className="font-bold">Tu cuenta</h2>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Has entrado como <b>{usuario.email}</b>.
        </p>
        <label className="block">
          <span className="etiqueta">Nombre que ven los demás</span>
          <div className="flex gap-2">
            <input
              className="campo"
              value={nombre}
              maxLength={30}
              required
              onChange={(e) => setNombre(e.target.value)}
            />
            <button className="boton shrink-0" disabled={guardando}>
              Guardar
            </button>
          </div>
        </label>
        {msg && <Aviso tipo={msg.tipo}>{msg.texto}</Aviso>}
        <button type="button" className="boton-sec" onClick={() => supabase.auth.signOut()}>
          Cerrar sesión
        </button>
      </form>

      <div className="tarjeta space-y-3 border-red-200 p-5 dark:border-red-900">
        <h2 className="font-bold text-red-700 dark:text-red-400">Zona peligrosa</h2>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Borra tu cuenta, tu perfil y todas tus apuestas. Las jornadas en las que jugaste dejarán de contar para el
          duelo de la temporada. No se puede deshacer.
        </p>
        <button
          className="inline-flex items-center justify-center rounded-xl border border-red-300 bg-white px-4 py-2 text-sm font-semibold text-red-700 transition hover:bg-red-50 dark:border-red-800 dark:bg-slate-900 dark:text-red-400 dark:hover:bg-red-950"
          onClick={() => setConfirmando(true)}
        >
          Borrar mi cuenta…
        </button>
      </div>

      {confirmando && <ConfirmarBorrado onCancelar={() => setConfirmando(false)} />}
    </div>
  );
}

function ConfirmarBorrado({ onCancelar }: { onCancelar: () => void }) {
  const [texto, setTexto] = useState("");
  const [borrando, setBorrando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const confirmado = texto.trim().toUpperCase() === PALABRA;

  useEffect(() => {
    input.current?.focus();
    const alPulsar = (e: KeyboardEvent) => e.key === "Escape" && !borrando && onCancelar();
    window.addEventListener("keydown", alPulsar);
    return () => window.removeEventListener("keydown", alPulsar);
  }, [onCancelar, borrando]);

  async function borrar(e: FormEvent) {
    e.preventDefault();
    if (!confirmado) return;
    setBorrando(true);
    setError(null);
    try {
      await invocar("borrar-cuenta", { confirmacion: PALABRA });
      try {
        sessionStorage.setItem(AVISO_CUENTA_BORRADA, "1");
      } catch {
        // sin almacenamiento: no pasa nada, solo no se verá el aviso
      }
      // La sesión ya no es válida: limpiamos la local y volvemos al inicio
      await supabase.auth.signOut({ scope: "local" });
    } catch (e) {
      setError((e as Error).message);
      setBorrando(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-20 flex items-center justify-center bg-slate-950/50 p-4"
      onClick={() => !borrando && onCancelar()}
    >
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby="titulo-borrar"
        onSubmit={borrar}
        onClick={(e) => e.stopPropagation()}
        className="tarjeta w-full max-w-md space-y-4 p-6 shadow-xl"
      >
        <h2 id="titulo-borrar" className="text-lg font-black">
          ¿Borrar tu cuenta?
        </h2>
        <ul className="list-disc space-y-1 pl-5 text-sm text-slate-600 dark:text-slate-400">
          <li>Se borrarán tu perfil y todas tus apuestas.</li>
          <li>Las jornadas en las que jugaste dejarán de contar para el duelo.</li>
          <li>Si el registro está cerrado, no podrás volver a crear la cuenta tú solo.</li>
        </ul>
        <label className="block">
          <span className="text-sm">
            Para confirmarlo, escribe <b className="font-mono">{PALABRA}</b>:
          </span>
          <input
            ref={input}
            className="campo mt-1 font-mono"
            value={texto}
            autoComplete="off"
            onChange={(e) => setTexto(e.target.value)}
          />
        </label>
        {error && <Aviso tipo="error">{error}</Aviso>}
        <div className="flex justify-end gap-2">
          <button type="button" className="boton-sec" onClick={onCancelar} disabled={borrando}>
            Cancelar
          </button>
          <button
            className="inline-flex items-center justify-center rounded-xl bg-red-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-red-700 disabled:opacity-40"
            disabled={!confirmado || borrando}
          >
            {borrando ? "Borrando…" : "Borrar definitivamente"}
          </button>
        </div>
      </form>
    </div>
  );
}
