-- Último intento de enlazar los partidos de la jornada con API-Football.
-- El plan gratuito solo deja consultar ayer, hoy y mañana, así que sync-live va
-- enlazando los partidos según se acercan; esto espacia esos intentos.
alter table public.jornadas add column ultimo_enlace timestamptz;

-- Hora de la última petición a cada API, para repartir la cuota diaria del
-- directo entre todos los partidos del día.
alter table public.api_usage add column ultima timestamptz;

create or replace function public.consumir_cuota(p_api text, p_limite int)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  n int;
begin
  insert into public.api_usage (dia, api, peticiones, ultima)
  values (current_date, p_api, 1, now())
  on conflict (dia, api) do update
    set peticiones = public.api_usage.peticiones + 1, ultima = now()
  returning peticiones into n;

  if n > p_limite then
    update public.api_usage set peticiones = peticiones - 1 where dia = current_date and api = p_api;
    return false;
  end if;
  return true;
end;
$$;

revoke execute on function public.consumir_cuota(text, int) from public, anon, authenticated;
