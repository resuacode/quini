// Servicios JSON que usa la web de Loterías y Apuestas del Estado (no documentados).
const BASE = "https://www.loteriasyapuestas.es/servicios/";

export async function selae(ruta: string): Promise<unknown> {
  const res = await fetch(BASE + ruta, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36",
      Accept: "application/json, text/plain, */*",
      "Accept-Language": "es-ES,es;q=0.9",
      Referer: "https://www.loteriasyapuestas.es/es/quiniela",
    },
  });
  if (!res.ok) throw new Error(`SELAE HTTP ${res.status}`);
  const texto = await res.text();
  try {
    return JSON.parse(texto);
  } catch {
    throw new Error("SELAE devolvió una respuesta no JSON (probablemente bloqueada)");
  }
}
