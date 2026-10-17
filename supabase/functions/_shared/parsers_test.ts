// deno test supabase/functions/_shared
import { assertEquals } from "jsr:@std/assert@1";
import { extraerJornadaJsonLd, extraerResultadosHtml, plenoDe, rutaResultados } from "./parsers.ts";
import { esFemenino, parecido } from "./teams.ts";
import { fixtureFemenino } from "./enlazar.ts";

Deno.test("plenoDe", () => {
  assertEquals(plenoDe("2 - 1"), { local: "2", visitante: "1" });
  assertEquals(plenoDe("3-0"), { local: "M", visitante: "0" });
  assertEquals(plenoDe("nada"), null);
});

Deno.test("próxima jornada: JSON-LD de quinielafutbol.info", () => {
  const evento = (i: number) => ({
    "@type": "ListItem",
    position: 15 - i, // desordenados a propósito
    item: {
      "@type": "SportsEvent",
      name: `L${15 - i} vs V${15 - i}`,
      startDate: "2026-10-03T14:00:00+02:00",
      homeTeam: { "@type": "SportsTeam", name: i === 0 ? "España (m)" : i === 1 ? "Athletic Club (F)" : `L${15 - i}` },
      awayTeam: { "@type": "SportsTeam", name: i === 1 ? "Valencia (f)" : `V${15 - i}` },
    },
  });
  const ld = {
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "BreadcrumbList", itemListElement: [{ "@type": "ListItem", position: 1, name: "Inicio" }] },
      {
        "@type": "ItemList",
        name: "Próximos Partidos de La Quiniela - Jornada 11",
        description: "Calendario de partidos programados para la Jornada 11 de La Quiniela (Domingo, 4 de octubre de 2026)",
        itemListElement: Array.from({ length: 15 }, (_, i) => evento(i)),
      },
    ],
  };
  const html = `<html><head><script type="application/ld+json">{ roto </script>
    <script type="application/ld+json">${JSON.stringify(ld)}</script></head><body></body></html>`;
  const j = extraerJornadaJsonLd(html)!;
  assertEquals(j.numero, 11);
  assertEquals(j.fecha, "2026-10-04");
  assertEquals(j.partidos.length, 15);
  assertEquals(j.partidos[0], { local: "L1", visitante: "V1", inicio: "2026-10-03T12:00:00.000Z" });
  assertEquals(j.partidos[14].local, "España", "(M) se quita");
  assertEquals(j.partidos[13], { local: "Athletic Club (F)", visitante: "Valencia (F)", inicio: "2026-10-03T12:00:00.000Z" }, "(F) se conserva");
});

Deno.test("próxima jornada: página sin la lista", () => {
  assertEquals(extraerJornadaJsonLd("<html><body>Mantenimiento</body></html>"), null);
});

// Fila con la misma forma que la web real (incluido el atributo con JSON escapado)
const fila = (pos: number, equipos: string, resultado: string, signo: string) => `
  <tr>
    <td class="partido-numero">${pos}</td>
    <td class="equipos" data-partido-modal="{&quot;local&quot;:{&quot;nombre&quot;:&quot;x&quot;}}">
      <span class="local">${equipos.split(" - ")[0]}</span> - <span>${equipos.split(" - ")[1]}</span></td>
    <td class="resultado">${resultado}</td>
    <td class="signo">${signo}</td>
  </tr>`;
const pagina = (filas: string) => `<html><body>
  <h2 class="titulo"><img src="/img/la-quiniela.png" alt="Jornada nº12"> La Quiniela Jornada 12</h2>
  <p class="datedraw">Fecha jornada: <span>Domingo, 11 de octubre de 2026</span></p>
  <table class="quiniela-table"><thead><tr><th>P.</th><th>Equipos</th><th>Resultado</th><th>Signo</th></tr></thead>
  <tbody>${filas}</tbody></table></body></html>`;

Deno.test("resultados: jornada completa", () => {
  const filas = Array.from({ length: 14 }, (_, i) => fila(i + 1, `Local ${i + 1} - Visitante ${i + 1}`, "2-1", "1")).join("") +
    fila(15, "Real Madrid - Villarreal", "4-0", "M-0");
  const r = extraerResultadosHtml(pagina(filas))!;
  assertEquals(r.numero, 12);
  assertEquals(r.fecha, "2026-10-11");
  assertEquals(r.signos.size, 14);
  assertEquals(r.signos.get(3), "1");
  assertEquals(r.marcadores.get(3), { local: 2, visitante: 1 });
  assertEquals(r.pleno, { local: "M", visitante: "0" });
  assertEquals(r.equipos.get(15), { local: "Real Madrid", visitante: "Villarreal" });
});

Deno.test("resultados: jornada a medias", () => {
  const filas = fila(1, "Rayo Vallecano - Athletic Club", "0-0", "X") + fila(2, "Barcelona (F) - Real Madrid (F)", "", "") +
    fila(15, "Real Madrid - Villarreal", "", "");
  const r = extraerResultadosHtml(pagina(filas))!;
  assertEquals(r.signos.get(1), "X");
  assertEquals(r.signos.has(2), false);
  assertEquals(r.marcadores.has(2), false);
  assertEquals(r.pleno, null);
  assertEquals(r.equipos.size, 3);
  assertEquals(r.equipos.get(2), { local: "Barcelona (F)", visitante: "Real Madrid (F)" });
});

Deno.test("resultados: página sin tabla", () => {
  assertEquals(extraerResultadosHtml("<html><body>No encontrada</body></html>"), null);
});

Deno.test("dirección de la página de resultados", () => {
  assertEquals(rutaResultados("2026-10-11"), "/resultados/jornada-quiniela-domingo-11-de-octubre-de-2026.html");
  assertEquals(rutaResultados("2026-10-14"), "/resultados/jornada-quiniela-miercoles-14-de-octubre-de-2026.html");
  assertEquals(rutaResultados("2026-09-27"), "/resultados/jornada-quiniela-domingo-27-de-septiembre-de-2026.html");
});

Deno.test("nombres de equipos: quiniela vs API-Football", () => {
  assertEquals(parecido("At. Madrid", "Atletico Madrid"), 1);
  assertEquals(parecido("Atlético", "Atletico Madrid"), 1);
  assertEquals(parecido("R. Sociedad", "Real Sociedad"), 1);
  assertEquals(parecido("Athletic", "Athletic Club"), 1);
  assertEquals(parecido("Betis", "Real Betis"), 1);
  assertEquals(parecido("Celta", "Celta Vigo"), 1);
  assertEquals(parecido("Deportivo", "Deportivo La Coruna"), 1);
  assertEquals(parecido("Sporting", "Sporting Gijon"), 1);
  assertEquals(parecido("Alavés", "Alaves"), 1);
  assertEquals(parecido("Villarreal", "Villarreal"), 1);
  // "Real" en común no basta para cruzar equipos distintos
  assertEquals(parecido("R. Madrid", "Real Sociedad") < 0.6, true);
  assertEquals(parecido("Español", "Espanyol"), 1);
  assertEquals(parecido("República Checa", "Czech Republic"), 1);
  assertEquals(parecido("Rep. De Irlanda", "Republic of Ireland"), 1);
  // La "W" de los equipos femeninos no cuenta al comparar clubes (el género se mira aparte)
  assertEquals(parecido("Deportivo", "Deportivo La Coruna W"), 1);
});

Deno.test("Liga F: misma comparación de club, distinto género", () => {
  // Para comparar clubes la marca no cuenta…
  assertEquals(parecido("Barcelona (F)", "Barcelona"), 1);
  assertEquals(parecido("Real Madrid (F)", "Real Madrid W"), 1);
  assertEquals(parecido("At. Madrid (F)", "Atletico Madrid W"), 1);
  // …pero el género se detecta aparte
  assertEquals(esFemenino("Athletic Club (F)"), true);
  assertEquals(esFemenino("Athletic Club"), false);
  assertEquals(esFemenino("Barcelona W"), true);
  assertEquals(esFemenino("Wolves"), false);
});

Deno.test("Liga F: partido femenino en API-Football", () => {
  const fx = (home: string, away: string, liga: string) => ({
    fixture: { id: 1, date: "", status: { short: "NS" } },
    league: { name: liga },
    teams: { home: { name: home }, away: { name: away } },
    goals: { home: null, away: null },
    score: { fulltime: { home: null, away: null } },
  });
  assertEquals(fixtureFemenino(fx("Barcelona W", "Real Madrid W", "Liga F")), true);
  assertEquals(fixtureFemenino(fx("Barcelona", "Real Madrid", "Liga F")), true, "por la competición");
  assertEquals(fixtureFemenino(fx("Barcelona", "Real Madrid", "La Liga")), false);
});
