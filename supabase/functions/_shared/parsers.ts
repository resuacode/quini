// Parsers de quinielafutbol.info, la fuente de las jornadas de la quiniela:
//
//   - Próxima jornada: datos estructurados schema.org (JSON-LD) de
//     /proximas-jornadas-de-la-quiniela.html
//   - Resultados: tabla de /resultados/jornada-quiniela-<día>-<d>-de-<mes>-de-<año>.html

// deno-lint-ignore no-explicit-any
type Obj = Record<string, any>;

export type Signo = "1" | "X" | "2";
export type Pleno = "0" | "1" | "2" | "M";

const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const DIAS = ["domingo", "lunes", "martes", "miercoles", "jueves", "viernes", "sabado"];

function aPleno(v: unknown): Pleno | null {
  if (v == null) return null;
  const s = String(v).trim().toUpperCase();
  if (s === "M") return "M";
  const n = Number(s);
  if (s === "" || !Number.isInteger(n) || n < 0) return null;
  return n >= 3 ? "M" : (String(n) as Pleno);
}

/** "2-M", "1 - 0"… -> { local, visitante } (3 o más goles = M). */
export function plenoDe(v: string): { local: Pleno; visitante: Pleno } | null {
  const m = v.toUpperCase().match(/([0-9]+|M)\s*[-:]\s*([0-9]+|M)/);
  if (!m) return null;
  const local = aPleno(m[1]), visitante = aPleno(m[2]);
  return local && visitante ? { local, visitante } : null;
}

/** Quita las marcas de partido masculino/femenino: "Ceuta (m)" -> "Ceuta". */
export function limpiarEquipo(nombre: string): string {
  return nombre.replace(/\s*\((m|f)\)\s*$/i, "").trim();
}

function texto(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

// ------------------------------------------------------------------
// Próxima jornada (JSON-LD)
//   { "@type": "ItemList", "name": "Próximos Partidos de La Quiniela - Jornada 11",
//     "description": "… (Domingo, 4 de octubre de 2026)",
//     "itemListElement": [{ position, item: { "@type": "SportsEvent", startDate,
//        homeTeam: { name }, awayTeam: { name } } }] }
// ------------------------------------------------------------------

export interface PartidoProximo {
  local: string;
  visitante: string;
  inicio: string | null;
}

export interface JornadaProxima {
  numero: number | null;
  fecha: string | null;
  partidos: PartidoProximo[];
}

/** Busca en el HTML la lista JSON-LD con los partidos de la próxima jornada. */
export function extraerJornadaJsonLd(html: string): JornadaProxima | null {
  const bloques = [...html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  const listas: Obj[] = [];
  const visitar = (n: unknown) => {
    if (Array.isArray(n)) return n.forEach(visitar);
    if (n && typeof n === "object") {
      const o = n as Obj;
      if (o["@type"] === "ItemList" && Array.isArray(o.itemListElement)) listas.push(o);
      else Object.values(o).forEach(visitar);
    }
  };
  for (const [, contenido] of bloques) {
    try {
      visitar(JSON.parse(contenido));
    } catch {
      // bloque JSON-LD mal formado: se ignora
    }
  }

  for (const lista of listas) {
    const partidos = (lista.itemListElement as Obj[])
      .map((e) => ({ pos: Number(e.position), ev: e.item ?? e }))
      .filter(({ ev }) => ev?.["@type"] === "SportsEvent" && ev.homeTeam?.name && ev.awayTeam?.name)
      .sort((a, b) => a.pos - b.pos)
      .map(({ ev }) => {
        const t = Date.parse(ev.startDate);
        return {
          local: limpiarEquipo(String(ev.homeTeam.name)),
          visitante: limpiarEquipo(String(ev.awayTeam.name)),
          inicio: Number.isFinite(t) ? new Date(t).toISOString() : null,
        };
      });
    if (partidos.length < 15) continue;

    const nombre = `${lista.name ?? ""} ${lista.description ?? ""}`;
    const numero = Number(nombre.match(/jornada\s*(\d{1,2})\b/i)?.[1] ?? NaN);
    return {
      numero: Number.isFinite(numero) && numero > 0 ? numero : null,
      fecha: fechaEnTexto(String(lista.description ?? "")),
      partidos: partidos.slice(0, 15),
    };
  }
  return null;
}

/** "Domingo, 4 de octubre de 2026" -> "2026-10-04" */
function fechaEnTexto(t: string): string | null {
  const f = t.toLowerCase().match(/(\d{1,2}) de ([a-zé]+) de (\d{4})/);
  const mes = f ? MESES.indexOf(f[2]) + 1 : 0;
  return f && mes ? `${f[3]}-${String(mes).padStart(2, "0")}-${f[1].padStart(2, "0")}` : null;
}

// ------------------------------------------------------------------
// Resultados (tabla HTML)
//   <table class="quiniela-table"> … <tr>
//     <td class="partido-numero">1</td> <td class="equipos">Rayo Vallecano - Athletic Club</td>
//     <td>0-0</td> <td>X</td>            (el 15 trae el pleno: "1-0", "M-M"…)
// Los partidos aún sin jugar vienen sin resultado ni signo.
// ------------------------------------------------------------------

export interface ResultadosJornada {
  numero: number | null;
  fecha: string | null;
  signos: Map<number, Signo>;
  pleno: { local: Pleno; visitante: Pleno } | null;
  marcadores: Map<number, { local: number; visitante: number }>;
  equipos: Map<number, { local: string; visitante: string }>;
}

/** Dirección de la página de resultados de la jornada con fecha de sorteo `fecha` (YYYY-MM-DD). */
export function rutaResultados(fecha: string): string {
  const [y, m, d] = fecha.split("-").map(Number);
  const dia = DIAS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `/resultados/jornada-quiniela-${dia}-${d}-de-${MESES[m - 1]}-de-${y}.html`;
}

export function extraerResultadosHtml(html: string): ResultadosJornada | null {
  const tabla = html.match(/<table[^>]*class="[^"]*quiniela-table[^"]*"[^>]*>([\s\S]*?)<\/table>/i)?.[1];
  if (!tabla) return null;

  const r: ResultadosJornada = {
    numero: null,
    fecha: fechaEnTexto(texto(html.match(/Fecha jornada:([\s\S]*?)<\/p>/i)?.[1] ?? "")),
    signos: new Map(),
    pleno: null,
    marcadores: new Map(),
    equipos: new Map(),
  };
  const numero = Number(texto(html.match(/<h2[\s\S]*?<\/h2>/i)?.[0] ?? "").match(/jornada\s*(\d{1,2})\b/i)?.[1] ?? NaN);
  if (Number.isFinite(numero)) r.numero = numero;

  for (const [, fila] of tabla.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const celdas = [...fila.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map(([, c]) => texto(c));
    if (celdas.length < 2) continue;
    const pos = Number(celdas[0]);
    if (!Number.isInteger(pos) || pos < 1 || pos > 15) continue;

    const [local, visitante] = celdas[1].split(/\s+-\s+/);
    if (local && visitante) r.equipos.set(pos, { local: limpiarEquipo(local), visitante: limpiarEquipo(visitante) });

    const marcador = (celdas[2] ?? "").match(/^(\d+)\s*-\s*(\d+)$/);
    if (marcador) r.marcadores.set(pos, { local: Number(marcador[1]), visitante: Number(marcador[2]) });

    const signo = (celdas[3] ?? "").toUpperCase();
    if (pos <= 14 && (signo === "1" || signo === "X" || signo === "2")) r.signos.set(pos, signo);
    if (pos === 15) r.pleno = plenoDe(signo) ?? (marcador ? plenoDe(celdas[2]) : null);
  }
  return r.equipos.size ? r : null;
}
