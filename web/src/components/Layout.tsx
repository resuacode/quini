import { NavLink, Outlet } from "react-router-dom";
import { supabase } from "../lib/supabase";

const enlaces = [
  { to: "/", texto: "Jornada", end: true },
  { to: "/temporada", texto: "Temporada" },
  { to: "/gestion", texto: "Gestión" },
];

export default function Layout() {
  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-10 bg-marca text-white shadow-sm dark:bg-marca-oscuro">
        <div className="mx-auto flex max-w-4xl items-center gap-1 px-3 py-3 sm:gap-2 sm:px-4">
          <span className="mr-1 flex items-center gap-2 text-lg font-black tracking-tight sm:mr-2">
            <span className="rounded-lg bg-white px-1.5 py-0.5 text-xs text-marca">1X2</span>
            <span className="hidden sm:inline">Quini</span>
          </span>
          <nav className="flex min-w-0 flex-1 gap-0.5 overflow-x-auto sm:gap-1">
            {enlaces.map((e) => (
              <NavLink
                key={e.to}
                to={e.to}
                end={e.end}
                className={({ isActive }) =>
                  `rounded-lg px-2.5 py-1.5 text-sm sm:px-3 font-medium whitespace-nowrap transition ${
                    isActive ? "bg-white/20 text-white" : "text-white/80 hover:bg-white/10 hover:text-white"
                  }`
                }
              >
                {e.texto}
              </NavLink>
            ))}
          </nav>
          <button
            onClick={() => supabase.auth.signOut()}
            className="shrink-0 pl-1 text-sm text-white/80 hover:text-white"
          >
            Salir
          </button>
        </div>
      </header>
      <main className="mx-auto max-w-4xl px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}
