-- =============================================================
-- Quini: duelo de aciertos en La Quiniela
-- =============================================================

-- Temporada a partir de una fecha: jul-dic -> 'AAAA-AA+1', ene-jun -> 'AAAA-1-AA'
create or replace function public.temporada_de(d date)
returns text
language sql
immutable
as $$
  select case
    when extract(month from d) >= 7
      then extract(year from d)::int || '-' || lpad(((extract(year from d)::int + 1) % 100)::text, 2, '0')
    else (extract(year from d)::int - 1) || '-' || lpad((extract(year from d)::int % 100)::text, 2, '0')
  end
$$;

-- -------------------------------------------------------------
-- Perfiles
-- -------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  nombre text not null,
  created_at timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, nombre)
  values (
    new.id,
    coalesce(nullif(trim(new.raw_user_meta_data ->> 'nombre'), ''), split_part(new.email, '@', 1))
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- -------------------------------------------------------------
-- Jornadas y partidos
-- -------------------------------------------------------------
create table public.jornadas (
  id bigint generated always as identity primary key,
  temporada text not null,
  numero int not null check (numero > 0),
  fecha date not null,
  -- Hora límite para apostar: inicio del primer partido (se recalcula sola)
  cierre timestamptz,
  estado text not null default 'abierta' check (estado in ('abierta', 'en_juego', 'finalizada')),
  -- true cuando la jornada tiene el resultado oficial completo de SELAE
  oficial boolean not null default false,
  created_at timestamptz not null default now(),
  unique (temporada, numero)
);

create table public.partidos (
  id bigint generated always as identity primary key,
  jornada_id bigint not null references public.jornadas (id) on delete cascade,
  posicion smallint not null check (posicion between 1 and 15),
  local text not null,
  visitante text not null,
  inicio timestamptz,
  -- id del partido en API-Football (para el directo)
  fixture_id bigint,
  goles_local smallint check (goles_local >= 0),
  goles_visitante smallint check (goles_visitante >= 0),
  -- estado corto de API-Football: NS, 1H, HT, 2H, FT, PST, ...
  estado text not null default 'NS',
  -- Resultado oficial publicado por SELAE (pisa al calculado con los goles)
  signo_oficial text check (signo_oficial in ('1', 'X', '2')),
  pleno_oficial_local text check (pleno_oficial_local in ('0', '1', '2', 'M')),
  pleno_oficial_visitante text check (pleno_oficial_visitante in ('0', '1', '2', 'M')),
  signo text generated always as (
    coalesce(
      signo_oficial,
      case
        when goles_local is null or goles_visitante is null then null
        when goles_local > goles_visitante then '1'
        when goles_local = goles_visitante then 'X'
        else '2'
      end
    )
  ) stored,
  pleno_local text generated always as (
    coalesce(
      pleno_oficial_local,
      case when goles_local is null then null when goles_local >= 3 then 'M' else goles_local::text end
    )
  ) stored,
  pleno_visitante text generated always as (
    coalesce(
      pleno_oficial_visitante,
      case when goles_visitante is null then null when goles_visitante >= 3 then 'M' else goles_visitante::text end
    )
  ) stored,
  terminado boolean generated always as (
    signo_oficial is not null or pleno_oficial_local is not null or estado in ('FT', 'AET', 'PEN')
  ) stored,
  updated_at timestamptz not null default now(),
  unique (jornada_id, posicion)
);

create index partidos_fixture_idx on public.partidos (fixture_id) where fixture_id is not null;

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger partidos_touch
  before update on public.partidos
  for each row execute function public.touch_updated_at();

-- El cierre de la jornada es el inicio del primer partido conocido
create or replace function public.recalcular_cierre()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  jid bigint := coalesce(new.jornada_id, old.jornada_id);
  primer timestamptz;
begin
  select min(inicio) into primer from public.partidos where jornada_id = jid;
  if primer is not null then
    update public.jornadas set cierre = primer where id = jid and cierre is distinct from primer;
  end if;
  return null;
end;
$$;

create trigger partidos_cierre
  after insert or delete or update of inicio on public.partidos
  for each row execute function public.recalcular_cierre();

-- -------------------------------------------------------------
-- Apuestas: una columna por usuario y jornada
-- -------------------------------------------------------------
create table public.apuestas (
  id bigint generated always as identity primary key,
  jornada_id bigint not null references public.jornadas (id) on delete cascade,
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  -- 14 signos, uno por partido: p.ej. '1X21X2111XX221'
  signos text not null check (signos ~ '^[1X2]{14}$'),
  pleno_local text not null check (pleno_local in ('0', '1', '2', 'M')),
  pleno_visitante text not null check (pleno_visitante in ('0', '1', '2', 'M')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (jornada_id, user_id)
);

create trigger apuestas_touch
  before update on public.apuestas
  for each row execute function public.touch_updated_at();

-- -------------------------------------------------------------
-- Control de cuota de APIs externas (solo service role)
-- -------------------------------------------------------------
create table public.api_usage (
  dia date not null default current_date,
  api text not null,
  peticiones int not null default 0,
  primary key (dia, api)
);

create or replace function public.consumir_cuota(p_api text, p_limite int)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  n int;
begin
  insert into public.api_usage (dia, api, peticiones)
  values (current_date, p_api, 1)
  on conflict (dia, api) do update set peticiones = public.api_usage.peticiones + 1
  returning peticiones into n;

  if n > p_limite then
    update public.api_usage set peticiones = peticiones - 1 where dia = current_date and api = p_api;
    return false;
  end if;
  return true;
end;
$$;

revoke execute on function public.consumir_cuota(text, int) from public, anon, authenticated;

-- -------------------------------------------------------------
-- Vistas de resultados
-- -------------------------------------------------------------

-- Aciertos de cada apuesta (14 signos + Pleno al 15 => máximo 15).
-- Durante el directo cuenta el resultado provisional.
create view public.v_aciertos_jornada
with (security_invoker = true) as
select
  a.id as apuesta_id,
  a.jornada_id,
  a.user_id,
  (
    count(*) filter (where p.posicion <= 14 and p.signo = substr(a.signos, p.posicion, 1))
    + count(*) filter (
        where p.posicion = 15
          and p.pleno_local = a.pleno_local
          and p.pleno_visitante = a.pleno_visitante
      )
  )::int as aciertos,
  count(*) filter (where p.terminado)::int as terminados,
  count(p.id)::int as partidos
from public.apuestas a
left join public.partidos p on p.jornada_id = a.jornada_id
group by a.id;

-- Resultado del duelo en cada jornada: ganada / empate / perdida
create view public.v_duelo_jornada
with (security_invoker = true) as
with base as (
  select
    j.id as jornada_id,
    j.temporada,
    j.numero,
    j.fecha,
    j.estado,
    j.oficial,
    v.user_id,
    v.aciertos,
    max(v.aciertos) over (partition by j.id) as max_aciertos,
    count(*) over (partition by j.id) as participantes
  from public.jornadas j
  join public.v_aciertos_jornada v on v.jornada_id = j.id
),
con_lideres as (
  select b.*, count(*) filter (where b.aciertos = b.max_aciertos) over (partition by b.jornada_id) as lideres
  from base b
)
select
  jornada_id,
  temporada,
  numero,
  fecha,
  estado,
  oficial,
  user_id,
  aciertos,
  participantes::int,
  case
    when participantes < 2 then null
    when aciertos < max_aciertos then 'perdida'
    when lideres > 1 then 'empate'
    else 'ganada'
  end as resultado
from con_lideres;

-- Clasificación de temporada (solo jornadas finalizadas)
create view public.v_clasificacion
with (security_invoker = true) as
select
  d.temporada,
  d.user_id,
  pr.nombre,
  count(*)::int as jornadas_jugadas,
  sum(d.aciertos)::int as aciertos_totales,
  round(avg(d.aciertos), 2) as media_aciertos,
  max(d.aciertos)::int as mejor_jornada,
  count(*) filter (where d.resultado = 'ganada')::int as ganadas,
  count(*) filter (where d.resultado = 'empate')::int as empates,
  count(*) filter (where d.resultado = 'perdida')::int as perdidas
from public.v_duelo_jornada d
join public.profiles pr on pr.id = d.user_id
where d.estado = 'finalizada'
group by d.temporada, d.user_id, pr.nombre;

-- -------------------------------------------------------------
-- RLS
-- -------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.jornadas enable row level security;
alter table public.partidos enable row level security;
alter table public.apuestas enable row level security;
alter table public.api_usage enable row level security;

create policy "profiles: leer" on public.profiles
  for select to authenticated using (true);
create policy "profiles: editar el propio" on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- Jornadas y partidos: cualquiera de los jugadores puede gestionarlos
-- (alta manual, corrección de resultados). Las Edge Functions usan service role.
create policy "jornadas: leer" on public.jornadas
  for select to authenticated using (true);
create policy "jornadas: crear" on public.jornadas
  for insert to authenticated with check (true);
create policy "jornadas: editar" on public.jornadas
  for update to authenticated using (true) with check (true);
create policy "jornadas: borrar" on public.jornadas
  for delete to authenticated using (true);

create policy "partidos: leer" on public.partidos
  for select to authenticated using (true);
create policy "partidos: crear" on public.partidos
  for insert to authenticated with check (true);
create policy "partidos: editar" on public.partidos
  for update to authenticated using (true) with check (true);
create policy "partidos: borrar" on public.partidos
  for delete to authenticated using (true);

create or replace function public.jornada_abierta(jid bigint)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.jornadas j
    where j.id = jid
      and j.estado = 'abierta'
      and (j.cierre is null or now() < j.cierre)
  )
$$;

create policy "apuestas: leer" on public.apuestas
  for select to authenticated using (true);
create policy "apuestas: crear la propia con la jornada abierta" on public.apuestas
  for insert to authenticated
  with check (user_id = auth.uid() and public.jornada_abierta(jornada_id));
create policy "apuestas: editar la propia con la jornada abierta" on public.apuestas
  for update to authenticated
  using (user_id = auth.uid() and public.jornada_abierta(jornada_id))
  with check (user_id = auth.uid() and public.jornada_abierta(jornada_id));
create policy "apuestas: borrar la propia con la jornada abierta" on public.apuestas
  for delete to authenticated
  using (user_id = auth.uid() and public.jornada_abierta(jornada_id));

-- -------------------------------------------------------------
-- Realtime
-- -------------------------------------------------------------
alter publication supabase_realtime add table public.jornadas, public.partidos, public.apuestas;
