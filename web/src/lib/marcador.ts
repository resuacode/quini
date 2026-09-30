// Marcador del navegador ("bookmarklet") para importar la próxima jornada.
//
// Se pulsa estando en www.loteriasyapuestas.es: el navegador del usuario lee la
// jornada con los mismos servicios que usa esa web (desde allí sí funcionan;
// desde un servidor SELAE los bloquea) y abre Quini con los partidos en el
// formulario de nueva jornada, en el mismo formato que si se hubieran pegado.

export interface Importacion {
  fecha: string;
  texto: string;
}

function codigo(appUrl: string): string {
  return `(async () => {
  const app = ${JSON.stringify(appUrl)};
  if (!/(^|\\.)loteriasyapuestas\\.es$/.test(location.hostname)) {
    alert("Abre www.loteriasyapuestas.es y vuelve a pulsar este marcador.");
    return;
  }
  const leer = async (ruta) => {
    const r = await fetch("/servicios/" + ruta, { headers: { Accept: "application/json" } });
    if (!r.ok) throw new Error("HTTP " + r.status);
    return r.json();
  };
  try {
    const proximo = (await leer("proximosv3?game_id=LAQU&num=1"))[0];
    const fecha = String(proximo.fecha).slice(0, 10);
    const sorteo = (await leer("fechav3?game_id=LAQU&fecha_sorteo=" + fecha.replace(/-/g, "")))[0];
    const lineas = sorteo.partidos.map((p, i) => {
      const f = String(p.fecha_completa || p.fecha || "").replace(/\\\\/g, "");
      const m = f.match(/(\\d{4})\\D(\\d{2})\\D(\\d{2})\\D+(\\d{2}):(\\d{2})/);
      const cuando = m ? "   " + m[3] + "/" + m[2] + "/" + m[1] + " " + m[4] + ":" + m[5] : "";
      return (i + 1) + ". " + p.local + " - " + p.visitante + cuando;
    });
    const texto = ["Jornada " + (proximo.jornada || sorteo.jornada)].concat(lineas).join("\\n");
    location.href = app + "#/gestion?importar=" + encodeURIComponent(JSON.stringify({ fecha, texto }));
  } catch (e) {
    alert("No se pudo leer la jornada de la quiniela: " + e.message);
  }
})();`;
}

/** URL "javascript:" del marcador, apuntando a esta misma instalación de Quini. */
export function urlMarcador(): string {
  const appUrl = window.location.origin + window.location.pathname;
  const js = codigo(appUrl)
    .split("\n")
    .map((l) => l.trim())
    .join(" ");
  return "javascript:" + encodeURIComponent(js);
}

/** Lee la importación que llega en la URL (?importar=...), si la hay. */
export function leerImportacion(valor: string | null): Importacion | null {
  if (!valor) return null;
  try {
    const d = JSON.parse(valor);
    if (typeof d?.fecha === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d.fecha) && typeof d?.texto === "string") {
      return { fecha: d.fecha, texto: d.texto.slice(0, 5000) };
    }
  } catch {
    // URL manipulada o truncada: se ignora
  }
  return null;
}
