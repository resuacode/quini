// deno test supabase/functions/_shared
import { assertEquals } from "jsr:@std/assert@1";
import { extraerResultados, plenoDe } from "./parsers.ts";
import { parecido } from "./teams.ts";

const quince = (f: (i: number) => Record<string, unknown>) => Array.from({ length: 15 }, (_, i) => f(i));

Deno.test("plenoDe", () => {
  assertEquals(plenoDe("2 - 1"), { local: "2", visitante: "1" });
  assertEquals(plenoDe("3-0"), { local: "M", visitante: "0" });
  assertEquals(plenoDe("nada"), null);
});

Deno.test("loteriasapi: formato de la documentación", () => {
  const body = {
    game: "QUINIELA",
    draw_date: "2026-04-12",
    matchday: 32,
    matches: quince((i) => ({ position: i + 1, home: "A" + i, away: "B" + i, sign: ["1", "X", "2"][i % 3] })),
    pleno_15: { home_goals: 2, away_goals: 4 },
  };
  const [r] = extraerResultados(body);
  assertEquals(r.fecha, "2026-04-12");
  assertEquals(r.numero, 32);
  assertEquals(r.signos.size, 14);
  assertEquals(r.signos.get(2), "X");
  assertEquals(r.pleno, { local: "2", visitante: "M" });
  assertEquals(r.equipos.get(1), { local: "A0", visitante: "B0" });
});

Deno.test("loteriasapi: envuelto en { success, data: [...] }", () => {
  const body = {
    success: true,
    data: [{
      draw_date: "2026-04-12T00:00:00Z",
      matchday: "32",
      matches: quince((i) => ({ position: i + 1, sign: i === 14 ? "M-0" : "1" })),
    }],
  };
  const [r] = extraerResultados(body);
  assertEquals(r.fecha, "2026-04-12");
  assertEquals(r.numero, 32);
  assertEquals(r.pleno, { local: "M", visitante: "0" });
});

Deno.test("SELAE real: resultado de una jornada jugada", () => {
  const partidos = quince((i) => ({
    local: i === 14 ? "Inglaterra (m)" : "Ceuta (m)",
    visitante: "Otro (f)",
    signo: i === 14 ? "2-M" : "X",
    marcador: "1 - 1",
  }));
  const [r] = extraerResultados([{ fecha_sorteo: "2026-09-27 00:00:00", jornada: "9", partidos }]);
  assertEquals(r.fecha, "2026-09-27");
  assertEquals(r.numero, 9);
  assertEquals(r.signos.get(1), "X");
  assertEquals(r.pleno, { local: "2", visitante: "M" });
  assertEquals(r.equipos.get(15), { local: "Inglaterra", visitante: "Otro" });
});

Deno.test("SELAE real: jornada a medias (partido 10 sin jugar y pleno pendiente)", () => {
  const partidos = quince((i) =>
    i === 9 || i === 14
      ? { local: "Leganés (m)", visitante: "Castellón (m)", fecha: "2026\\/09\\/28 20:30:00" }
      : { local: "A (m)", visitante: "B (m)", signo: "1", marcador: "1 - 0" }
  );
  const body = [{ fecha_sorteo: "2026-09-27 00:00:00", jornada: "9", partidos }];
  assertEquals(extraerResultados(body).length, 0, "no está completa");
  const [r] = extraerResultados(body, 0);
  assertEquals(r.signos.size, 13);
  assertEquals(r.signos.has(10), false);
  assertEquals(r.pleno, null);
});

Deno.test("respuesta sin partidos", () => {
  assertEquals(extraerResultados({ error: "x" }), []);
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
  assertEquals(parecido("Deportivo", "Deportivo La Coruna W"), 0.8);
});
