import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";

interface Estado {
  session: Session | null;
  cargando: boolean;
}

const Ctx = createContext<Estado>({ session: null, cargando: true });

export function SessionProvider({ children }: { children: ReactNode }) {
  const [estado, setEstado] = useState<Estado>({ session: null, cargando: true });

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setEstado({ session: data.session, cargando: false }));
    const { data } = supabase.auth.onAuthStateChange((_e, session) => setEstado({ session, cargando: false }));
    return () => data.subscription.unsubscribe();
  }, []);

  return <Ctx.Provider value={estado}>{children}</Ctx.Provider>;
}

export function useSession() {
  return useContext(Ctx);
}
