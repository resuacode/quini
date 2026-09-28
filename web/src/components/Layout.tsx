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
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/85 backdrop-blur dark:border-slate-800 dark:bg-slate-950/85">
        <div className="mx-auto flex max-w-4xl items-center gap-1 px-3 py-3 sm:gap-2 sm:px-4">
          <span className="mr-1 flex items-center gap-2 text-lg font-black tracking-tight sm:mr-2">
            <span className="rounded-lg bg-marca px-1.5 py-0.5 text-xs text-white">1X2</span>
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
                    isActive
                      ? "bg-marca-claro text-marca dark:bg-teal-900/50 dark:text-teal-300"
                      : "text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
                  }`
                }
              >
                {e.texto}
              </NavLink>
            ))}
          </nav>
          <button
            onClick={() => supabase.auth.signOut()}
            className="shrink-0 pl-1 text-sm text-slate-500 hover:text-slate-900 dark:hover:text-white"
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
