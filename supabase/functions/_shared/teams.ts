// Normalización de nombres de equipos para cruzar los de la quiniela (SELAE)
// con los de API-Football. Ej.: "At. Madrid" ↔ "Atletico Madrid".

const RELLENO = new Set(["cf", "fc", "cd", "ud", "sd", "rcd", "rc", "club", "de", "la", "el", "del", "ad", "sad", "cp"]);

const ABREVIATURAS: Record<string, string> = {
  r: "real",
  at: "atletico",
  atl: "atletico",
  dep: "deportivo",
  sp: "sporting",
  rac: "racing",
  rep: "republica",
};

// nombre normalizado -> clave canónica
const ALIAS: Record<string, string> = {
  "atletico": "atletico madrid",
  "atletico madrid": "atletico madrid",
  "athletic": "athletic",
  "athletic club": "athletic",
  "athletic bilbao": "athletic",
  "real madrid": "real madrid",
  "madrid": "real madrid",
  "real sociedad": "real sociedad",
  "sociedad": "real sociedad",
  "real betis": "betis",
  "betis": "betis",
  "celta": "celta",
  "celta vigo": "celta",
  "rayo": "rayo",
  "rayo vallecano": "rayo",
  "real mallorca": "mallorca",
  "real oviedo": "oviedo",
  "real zaragoza": "zaragoza",
  "real valladolid": "valladolid",
  "real racing": "racing",
  "racing santander": "racing",
  "real racing santander": "racing",
  "sporting gijon": "sporting",
  "real sporting": "sporting",
  "deportivo": "deportivo",
  "deportivo coruna": "deportivo",
  "coruna": "deportivo",
  "cultural": "cultural leonesa",
  "cultural leonesa": "cultural leonesa",
  "alaves": "alaves",
  "deportivo alaves": "alaves",
  "espanyol": "espanyol",
  "espanyol barcelona": "espanyol",
  "espanol": "espanyol",
  "granada": "granada",
  "leganes": "leganes",
  "andorra": "andorra",
  "castellon": "castellon",
  "mirandes": "mirandes",
  "cadiz": "cadiz",
  "malaga": "malaga",
  "almeria": "almeria",
  "cordoba": "cordoba",
  "las palmas": "las palmas",
  "ud las palmas": "las palmas",
  "burgos": "burgos",
  "ceuta": "ceuta",
  "real sociedad b": "real sociedad b",
  "sociedad b": "real sociedad b",

  // Selecciones: SELAE las nombra en español y API-Football en inglés
  "espana": "spain",
  "inglaterra": "england",
  "alemania": "germany",
  "francia": "france",
  "italia": "italy",
  "paises bajos": "netherlands",
  "holanda": "netherlands",
  "belgica": "belgium",
  "suiza": "switzerland",
  "republica checa": "czech republic",
  "chequia": "czech republic",
  "czechia": "czech republic",
  "eslovaquia": "slovakia",
  "eslovenia": "slovenia",
  "croacia": "croatia",
  "escocia": "scotland",
  "gales": "wales",
  "irlanda norte": "northern ireland",
  "republica irlanda": "ireland",
  "irlanda": "ireland",
  "republic of ireland": "ireland",
  "dinamarca": "denmark",
  "noruega": "norway",
  "suecia": "sweden",
  "finlandia": "finland",
  "islandia": "iceland",
  "polonia": "poland",
  "hungria": "hungary",
  "rumania": "romania",
  "grecia": "greece",
  "turquia": "turkey",
  "turkiye": "turkey",
  "ucrania": "ukraine",
  "rusia": "russia",
  "azerbaiyan": "azerbaijan",
  "kazajistan": "kazakhstan",
  "luxemburgo": "luxembourg",
  "chipre": "cyprus",
  "macedonia norte": "north macedonia",
  "bosnia": "bosnia",
  "bosnia herzegovina": "bosnia",
  "bosnia and herzegovina": "bosnia",
  "moldavia": "moldova",
  "bielorrusia": "belarus",
  "letonia": "latvia",
  "lituania": "lithuania",
  "islas feroe": "faroe islands",
  "feroe": "faroe islands",
  "brasil": "brazil",
  "marruecos": "morocco",
  "japon": "japan",
  "estados unidos": "usa",
  "mexico": "mexico",
};

export function normalizar(nombre: string): string {
  return nombre
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[.'`´\-]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => ABREVIATURAS[t] ?? t)
    .filter((t) => !RELLENO.has(t))
    .join(" ");
}

export function canonico(nombre: string): string {
  const n = normalizar(nombre);
  return ALIAS[n] ?? n;
}

/** Parecido entre dos nombres de equipo, de 0 a 1. */
export function parecido(a: string, b: string): number {
  const ca = canonico(a);
  const cb = canonico(b);
  if (ca === cb) return 1;
  const ta = new Set(ca.split(" "));
  const tb = new Set(cb.split(" "));
  const comunes = [...ta].filter((t) => tb.has(t)).length;
  // Uno contenido en el otro: "Deportivo" ⊂ "Deportivo La Coruna W"
  const [menor, mayor] = ta.size <= tb.size ? [ta, tb] : [tb, ta];
  if (comunes === menor.size && menor.size < mayor.size) return 0.8;
  if (comunes === 0) {
    // "Villarreal" vs "Villarreal CF" ya se resuelve arriba; aquí prefijos tipo "Valladol"
    return ca.startsWith(cb) || cb.startsWith(ca) ? 0.7 : 0;
  }
  return comunes / Math.max(ta.size, tb.size);
}
