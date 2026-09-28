begin;
create extension if not exists pgtap with schema extensions;

select plan(16);

-- Usuarios -----------------------------------------------------------
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-00000000000a', 'ana@test.dev', '{"nombre":"Ana"}'),
  ('00000000-0000-0000-0000-00000000000b', 'beto@test.dev', '{}');

select is((select nombre from profiles where id = '00000000-0000-0000-0000-00000000000a'), 'Ana', 'perfil con nombre de metadatos');
select is((select nombre from profiles where id = '00000000-0000-0000-0000-00000000000b'), 'beto', 'perfil con nombre del email');

select is(temporada_de('2026-09-28'), '2026-27', 'temporada en otoño');
select is(temporada_de('2027-03-01'), '2026-27', 'temporada en primavera');

-- Jornada con 15 partidos --------------------------------------------
insert into jornadas (temporada, numero, fecha) values ('2099-00', 10, '2099-10-04');

insert into partidos (jornada_id, posicion, local, visitante, inicio)
select (select id from jornadas where temporada = '2099-00'), g, 'L' || g, 'V' || g, now() + interval '1 day' + g * interval '1 hour'
from generate_series(1, 15) g;

select is((select cierre from jornadas where id = (select id from jornadas where temporada = '2099-00')), now() + interval '1 day' + interval '1 hour', 'cierre = primer partido');

-- Apuestas como cada usuario (RLS) ------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}', true);

select lives_ok(
  $$ insert into apuestas (jornada_id, signos, pleno_local, pleno_visitante) values ((select id from jornadas where temporada = '2099-00'), '11111111111111', '2', '1') $$,
  'Ana apuesta antes del cierre'
);

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000b","role":"authenticated"}', true);
select lives_ok(
  $$ insert into apuestas (jornada_id, signos, pleno_local, pleno_visitante) values ((select id from jornadas where temporada = '2099-00'), 'XXXXXXX1111111', '0', '0') $$,
  'Beto apuesta antes del cierre'
);

-- Beto no puede tocar la apuesta de Ana
update apuestas set signos = '22222222222222' where user_id = '00000000-0000-0000-0000-00000000000a';
select is(
  (select signos from apuestas where user_id = '00000000-0000-0000-0000-00000000000a'),
  '11111111111111', 'no se puede editar la apuesta del otro'
);

select throws_ok(
  $$ insert into apuestas (jornada_id, user_id, signos, pleno_local, pleno_visitante)
     values ((select id from jornadas where temporada = '2099-00'), '00000000-0000-0000-0000-00000000000a', '22222222222222', '0', '0') $$,
  '42501', null, 'no se puede apostar en nombre del otro'
);

reset role;

-- Resultados: 1-0 en todos (signo 1) salvo los 3 primeros 1-1 (X); pleno 2-1
update partidos set goles_local = 1, goles_visitante = 0, estado = 'FT' where jornada_id = (select id from jornadas where temporada = '2099-00') and posicion between 4 and 14;
update partidos set goles_local = 1, goles_visitante = 1, estado = 'FT' where jornada_id = (select id from jornadas where temporada = '2099-00') and posicion between 1 and 3;
update partidos set goles_local = 2, goles_visitante = 1, estado = 'FT' where jornada_id = (select id from jornadas where temporada = '2099-00') and posicion = 15;

-- Ana: 11 signos (4-14) + pleno = 12. Beto: 3 X + 7 unos (8-14) = 10, pleno falla.
select is(
  (select aciertos from v_aciertos_jornada where jornada_id = (select id from jornadas where temporada = '2099-00') and user_id = '00000000-0000-0000-0000-00000000000a'),
  12, 'aciertos de Ana con pleno'
);
select is(
  (select aciertos from v_aciertos_jornada where jornada_id = (select id from jornadas where temporada = '2099-00') and user_id = '00000000-0000-0000-0000-00000000000b'),
  10, 'aciertos de Beto'
);

-- El resultado oficial pisa al de los goles, y M = 3 o más
update partidos set signo_oficial = 'X' where jornada_id = (select id from jornadas where temporada = '2099-00') and posicion = 4;
update partidos set goles_local = 4 where jornada_id = (select id from jornadas where temporada = '2099-00') and posicion = 15;
select is((select pleno_local from partidos where jornada_id = (select id from jornadas where temporada = '2099-00') and posicion = 15), 'M', '4 goles = M');
select is(
  (select aciertos from v_aciertos_jornada where jornada_id = (select id from jornadas where temporada = '2099-00') and user_id = '00000000-0000-0000-0000-00000000000a'),
  10, 'Ana pierde el 4 (oficial X) y el pleno (M-1)'
);

-- Una vez empezada la jornada ya no se puede cambiar la apuesta
update jornadas set cierre = now() - interval '1 minute' where id = (select id from jornadas where temporada = '2099-00');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}', true);
update apuestas set signos = '22222222222222' where user_id = '00000000-0000-0000-0000-00000000000a';
reset role;
select is(
  (select signos from apuestas where user_id = '00000000-0000-0000-0000-00000000000a'),
  '11111111111111', 'no se puede editar tras el cierre'
);

-- Clasificación: solo cuenta al finalizar. Beto 11 (gana la X del 4) vs Ana 10
select is((select count(*)::int from v_clasificacion where temporada = '2099-00'), 0, 'sin jornadas finalizadas no hay clasificación');
update jornadas set estado = 'finalizada' where id = (select id from jornadas where temporada = '2099-00');
select results_eq(
  $$ select nombre, aciertos_totales, ganadas, empates, perdidas from v_clasificacion where temporada = '2099-00' order by nombre $$,
  $$ values ('Ana'::text, 10, 0, 0, 1), ('beto'::text, 11, 1, 0, 0) $$,
  'clasificación de la temporada'
);

select * from finish();
rollback;
