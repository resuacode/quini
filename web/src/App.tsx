import { HashRouter, Navigate, Route, Routes } from "react-router-dom";
import Layout from "./components/Layout";
import { Aviso, Cargando } from "./components/ui";
import { SessionProvider, useSession } from "./hooks/useSession";
import { configurado } from "./lib/supabase";
import Apostar from "./pages/Apostar";
import Gestion from "./pages/Gestion";
import JornadaPage from "./pages/Jornada";
import Login from "./pages/Login";
import Temporada from "./pages/Temporada";

function Rutas() {
  const { session, cargando } = useSession();
  if (cargando) return <Cargando />;
  if (!session) return <Login />;

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<JornadaPage />} />
        <Route path="jornada/:id" element={<JornadaPage />} />
        <Route path="jornada/:id/apuesta" element={<Apostar />} />
        <Route path="temporada" element={<Temporada />} />
        <Route path="gestion" element={<Gestion />} />
        <Route path="gestion/:id" element={<Gestion />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

export default function App() {
  if (!configurado) {
    return (
      <div className="mx-auto max-w-md p-6">
        <Aviso tipo="error">
          Falta configurar <code>VITE_SUPABASE_URL</code> y <code>VITE_SUPABASE_ANON_KEY</code> (ver{" "}
          <code>web/.env.example</code>).
        </Aviso>
      </div>
    );
  }
  return (
    <SessionProvider>
      <HashRouter>
        <Rutas />
      </HashRouter>
    </SessionProvider>
  );
}
