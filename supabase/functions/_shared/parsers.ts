// Parser de resultados oficiales de la quiniela. Acepta las respuestas de
// loteriasapi.com y de SELAE (loteriasyapuestas.es/servicios/fechav3). Ninguna
// está bien documentada, así que los campos se buscan por nombre con
// alternativas en vez de asumir una estructura fija:
//
//   loteriasapi: { draw_date, matchday, matches: [{ position, home, away, sign }],
//                  pleno_15: { home_goals, away_goals } }   (a veces dentro de { data })
//   SELAE:       [{ fecha_sorteo, jornada, partidos: [{ local, visitante, signo: "1" | "2-M" }] }]

// deno-lint-ignore no-explicit-any
type Obj = Record<string, any>;

export type Signo = "1" | "X" | "2";
export type Pleno = "0" | "1" | "2" | "M";

export interface ResultadoOficial {
  fecha: string | null;
  numero: number | null;
  signos: Map<number, Signo>;
  pleno: { local: Pleno; visitante: Pleno } | null;
  equipos: Map<number, { local: string; visitante: string }>;
}

/** Resultados encontrados con al menos `minSignos` signos (14 = jornada completa). */
export function extraerResultados(raiz: unknown, minSignos = 14): ResultadoOficial[] {
  const candidatos: Obj[] = [];
  const visitar = (n: unknown) => {
    if (Array.isArray(n)) return n.forEach(visitar);
    if (n && typeof n === "object") {
      const o = n as Obj;
      if (listaPartidos(o)) candidatos.push(o);
      else Object.values(o).forEach(visitar);
    }
  };
  visitar(raiz);
  return candidatos.map(aResultado).filter((r) => r.signos.size >= minSignos);
}

function listaPartidos(o: Obj): Obj[] | null {
  for (const k of ["partidos", "matches"]) {
    if (Array.isArray(o[k]) && o[k].length >= 14 && typeof o[k][0] === "object") return o[k];
  }
  return null;
}

function aResultado(o: Obj): ResultadoOficial {
  const partidos = listaPartidos(o)!;
  const signos = new Map<number, Signo>();
  const equipos = new Map<number, { local: string; visitante: string }>();
  let pleno: ResultadoOficial["pleno"] = null;

  partidos.forEach((p, i) => {
    const pos = Number(p.posicion ?? p.position ?? i + 1);
    const s = String(p.signo ?? p.sign ?? "").trim().toUpperCase();
    if (pos <= 14 && (s === "1" || s === "X" || s === "2")) signos.set(pos, s);
    if (pos === 15 && s) pleno = plenoDe(s);
    const local = p.local ?? p.home;
    const visitante = p.visitante ?? p.away;
    if (typeof local === "string" && typeof visitante === "string") {
      equipos.set(pos, { local: limpiarEquipo(local), visitante: limpiarEquipo(visitante) });
    }
  });

  // loteriasapi da el pleno aparte, con los goles de cada equipo
  const p15 = o.pleno_15 ?? o.pleno15;
  if (p15 && typeof p15 === "object") {
    const local = aPleno(p15.home_goals ?? p15.home ?? p15.local);
    const visitante = aPleno(p15.away_goals ?? p15.away ?? p15.visitante);
    if (local && visitante) pleno = { local, visitante };
  } else if (typeof p15 === "string") {
    pleno = plenoDe(p15) ?? pleno;
  }

  const fecha = fechaDe(o.fecha_sorteo ?? o.draw_date ?? o.drawDate ?? o.fecha ?? o.date);
  const numero = Number(o.jornada ?? o.matchday ?? o.numero_jornada ?? NaN);

  return { fecha, numero: Number.isFinite(numero) ? numero : null, signos, pleno, equipos };
}

function aPleno(v: unknown): Pleno | null {
  if (v == null) return null;
  const s = String(v).trim().toUpperCase();
  if (s === "M") return "M";
  const n = Number(s);
  if (s === "" || !Number.isInteger(n) || n < 0) return null;
  return n >= 3 ? "M" : (String(n) as Pleno);
}

/** "2-M", "1 - 0"… -> { local, visitante } (3 o más goles = M). */
export function plenoDe(v: string): ResultadoOficial["pleno"] {
  const m = v.toUpperCase().match(/([0-9]+|M)\s*[-:]\s*([0-9]+|M)/);
  if (!m) return null;
  const local = aPleno(m[1]), visitante = aPleno(m[2]);
  return local && visitante ? { local, visitante } : null;
}

/** Quita las marcas de SELAE: "Ceuta (m)" -> "Ceuta". */
export function limpiarEquipo(nombre: string): string {
  return nombre.replace(/\s*\((m|f)\)\s*$/i, "").trim();
}

export function fechaDe(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.replace(/\\/g, "");
  const iso = s.match(/(\d{4})[-/](\d{2})[-/](\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const es = s.match(/(\d{2})[-/](\d{2})[-/](\d{4})/);
  if (es) return `${es[3]}-${es[2]}-${es[1]}`;
  return null;
}
