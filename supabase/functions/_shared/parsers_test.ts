// deno test supabase/functions/_shared
import { assertEquals } from "jsr:@std/assert@1";
import { extraerJornada, extraerProximo, extraerResultados, horaMadridAIso, plenoDe } from "./parsers.ts";
import { parecido } from "./teams.ts";

const quince = (f: (i: number) => Record<string, unknown>) => Array.from({ length: 15 }, (_, i) => f(i));

Deno.test("plenoDe", () => {
  assertEquals(plenoDe("2 - 1"), { local: "2", visitante: "1" });
  assertEquals(plenoDe("3-0"), { local: "M", visitante: "0" });
  assertEquals(plenoDe("nada"), null);
});

Deno.test("SELAE: lista de partidos anidada", () => {
  const body = [{
    fecha_sorteo: "2026-10-04 00:00:00",
    jornada: "12",
    partidos: quince((i) => ({ local: ` L${i} `, visitante: `V${i}` })),
  }];
  const j = extraerJornada(body)!;
  assertEquals(j.numero, 12);
  assertEquals(j.fecha, "2026-10-04");
  assertEquals(j.partidos.length, 15);
  assertEquals(j.partidos[0], { local: "L0", visitante: "V0", inicio: null });
});

Deno.test("SELAE: partido en un único campo", () => {
  const j = extraerJornada({ match_list: quince((i) => ({ partido: `Local${i} - Visit${i}` })) })!;
  assertEquals(j.partidos[3], { local: "Local3", visitante: "Visit3", inicio: null });
  assertEquals(j.fecha, null);
});

Deno.test("SELAE real: próximo sorteo", () => {
  const body = JSON.parse(
    '[{"fecha":"2026-09-30 00:00:00","dia_semana":"mi\\u00e9rcoles","id_sorteo":"1324106055","game_id":"LAQU",' +
      '"cierre":"2026-09-29 20:45:00","estado":"abierto","jornada":10}]',
  );
  assertEquals(extraerProximo(body), { fecha: "2026-09-30", numero: 10, cierre: "2026-09-29T18:45:00.000Z" });
});

Deno.test("SELAE real: partidos de la próxima jornada (fechav3)", () => {
  const partido = '{"local":"Luxemburgo (m)","visitante":"Islandia (m)","fecha":"2026\\\\/09\\\\/29 20:45:00"}';
  const body = JSON.parse(`[{"fecha_sorteo":"2026-09-30 00:00:00","jornada":"10","partidos":[${Array(15).fill(partido)}]}]`);
  const j = extraerJornada(body)!;
  assertEquals(j.numero, 10);
  assertEquals(j.fecha, "2026-09-30");
  assertEquals(j.partidos[0], { local: "Luxemburgo", visitante: "Islandia", inicio: "2026-09-29T18:45:00.000Z" });
});

Deno.test("SELAE real: resultado de una jornada jugada", () => {
  const partidos = quince((i) => ({
    posicion: i + 1,
    local: i === 14 ? "Inglaterra (m)" : "Ceuta (m)",
    visitante: "Otro (f)",
    signo: i === 14 ? "2-M" : "X",
    marcador: "1 - 1",
    fecha_completa: "2026-09-26 14:00:00",
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

Deno.test("hora de Madrid a UTC (verano e invierno)", () => {
  assertEquals(horaMadridAIso("2026-09-26 14:00:00"), "2026-09-26T12:00:00.000Z");
  assertEquals(horaMadridAIso("2026/12/06 21:00"), "2026-12-06T20:00:00.000Z");
  assertEquals(horaMadridAIso("26-09-2026 18:30"), "2026-09-26T16:30:00.000Z");
  assertEquals(horaMadridAIso("2026-09-26"), null);
});

Deno.test("SELAE: respuesta sin partidos", () => {
  assertEquals(extraerJornada({ error: "x" }), null);
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
