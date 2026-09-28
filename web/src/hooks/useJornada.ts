import { useCallback, useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import type { Apuesta, Jornada, Partido, Perfil } from "../lib/types";

export function usePerfiles() {
  const [perfiles, setPerfiles] = useState<Perfil[]>([]);
  useEffect(() => {
    supabase
      .from("profiles")
      .select("*")
      .order("created_at")
      .then(({ data }) => setPerfiles(data ?? []));
  }, []);
  return perfiles;
}

/** Id de la jornada "actual": la más reciente sin finalizar o, si no hay, la última. */
export async function jornadaActualId(): Promise<number | null> {
  const { data: abiertas } = await supabase
    .from("jornadas")
    .select("id")
    .neq("estado", "finalizada")
    .order("fecha", { ascending: true })
    .limit(1);
  if (abiertas?.length) return abiertas[0].id;
  const { data } = await supabase.from("jornadas").select("id").order("fecha", { ascending: false }).limit(1);
  return data?.[0]?.id ?? null;
}

export interface DatosJornada {
  jornada: Jornada | null;
  partidos: Partido[];
  apuestas: Apuesta[];
  cargando: boolean;
  error: string | null;
  recargar: () => Promise<void>;
}

/** Carga una jornada con sus partidos y apuestas, y se mantiene al día por realtime. */
export function useJornada(id: number | null): DatosJornada {
  const [jornada, setJornada] = useState<Jornada | null>(null);
  const [partidos, setPartidos] = useState<Partido[]>([]);
  const [apuestas, setApuestas] = useState<Apuesta[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const recargar = useCallback(async () => {
    if (id == null) {
      setCargando(false);
      return;
    }
    const [j, p, a] = await Promise.all([
      supabase.from("jornadas").select("*").eq("id", id).maybeSingle(),
      supabase.from("partidos").select("*").eq("jornada_id", id).order("posicion"),
      supabase.from("apuestas").select("*").eq("jornada_id", id),
    ]);
    const e = j.error ?? p.error ?? a.error;
    setError(e ? e.message : null);
    setJornada(j.data);
    setPartidos(p.data ?? []);
    setApuestas(a.data ?? []);
    setCargando(false);
  }, [id]);

  useEffect(() => {
    setCargando(true);
    recargar();
    if (id == null) return;

    const canal = supabase
      .channel(`jornada-${id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "partidos", filter: `jornada_id=eq.${id}` }, (msg) => {
        if (msg.eventType === "UPDATE") {
          const nuevo = msg.new as Partido;
          setPartidos((ps) => ps.map((p) => (p.id === nuevo.id ? nuevo : p)));
        } else {
          recargar();
        }
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "apuestas", filter: `jornada_id=eq.${id}` }, () =>
        recargar(),
      )
      .on("postgres_changes", { event: "*", schema: "public", table: "jornadas", filter: `id=eq.${id}` }, () => recargar())
      .subscribe();

    // Por si se pierde algún evento (móvil en segundo plano, etc.)
    const alVolver = () => document.visibilityState === "visible" && recargar();
    document.addEventListener("visibilitychange", alVolver);

    return () => {
      supabase.removeChannel(canal);
      document.removeEventListener("visibilitychange", alVolver);
    };
  }, [id, recargar]);

  return { jornada, partidos, apuestas, cargando, error, recargar };
}
