import { useState, type FormEvent } from "react";
import { Aviso } from "../components/ui";
import { supabase } from "../lib/supabase";

export default function Login() {
  const [modo, setModo] = useState<"entrar" | "registro">("entrar");
  const [nombre, setNombre] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mensaje, setMensaje] = useState<string | null>(null);

  async function enviar(e: FormEvent) {
    e.preventDefault();
    setEnviando(true);
    setError(null);
    setMensaje(null);
    try {
      if (modo === "entrar") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      } else {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: { nombre: nombre.trim() },
            emailRedirectTo: window.location.origin + window.location.pathname,
          },
        });
        if (error) throw error;
        if (!data.session) setMensaje("Cuenta creada. Revisa tu correo para confirmarla y después entra.");
      }
    } catch (err) {
      setError(traducir(err instanceof Error ? err.message : String(err)));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="flex min-h-dvh items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-3 inline-flex rounded-2xl bg-marca px-3 py-2 text-xl font-black text-white shadow-md">1X2</div>
          <h1 className="text-2xl font-black tracking-tight">Quini</h1>
          <p className="text-sm text-slate-500">El duelo de aciertos de la quiniela</p>
        </div>

        <form onSubmit={enviar} className="tarjeta space-y-4 p-6">
          <div className="grid grid-cols-2 rounded-xl bg-slate-100 p-1 text-sm font-semibold dark:bg-slate-800">
            {(["entrar", "registro"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setModo(m)}
                className={`rounded-lg py-1.5 ${modo === m ? "bg-white shadow-sm dark:bg-slate-950" : "text-slate-500"}`}
              >
                {m === "entrar" ? "Entrar" : "Registrarse"}
              </button>
            ))}
          </div>

          {modo === "registro" && (
            <label className="block">
              <span className="etiqueta">Nombre</span>
              <input className="campo" value={nombre} onChange={(e) => setNombre(e.target.value)} required maxLength={30} />
            </label>
          )}
          <label className="block">
            <span className="etiqueta">Email</span>
            <input className="campo" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </label>
          <label className="block">
            <span className="etiqueta">Contraseña</span>
            <input
              className="campo"
              type="password"
              autoComplete={modo === "entrar" ? "current-password" : "new-password"}
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </label>

          {error && <Aviso tipo="error">{error}</Aviso>}
          {mensaje && <Aviso tipo="ok">{mensaje}</Aviso>}

          <button className="boton w-full" disabled={enviando}>
            {enviando ? "…" : modo === "entrar" ? "Entrar" : "Crear cuenta"}
          </button>
        </form>
      </div>
    </div>
  );
}

function traducir(m: string): string {
  if (/invalid login credentials/i.test(m)) return "Email o contraseña incorrectos.";
  if (/email not confirmed/i.test(m)) return "Tienes que confirmar el email antes de entrar.";
  if (/already registered/i.test(m)) return "Ese email ya está registrado.";
  if (/signups not allowed/i.test(m)) return "El registro de nuevos usuarios está cerrado.";
  if (/password should be at least/i.test(m)) return "La contraseña debe tener al menos 6 caracteres.";
  return m;
}
