-- =============================================================
-- Tareas programadas: llaman a las Edge Functions vía pg_net.
--
-- Requiere dos secretos en Vault (ver README):
--   select vault.create_secret('https://<ref>.supabase.co', 'project_url');
--   select vault.create_secret('<anon o publishable key>', 'functions_key');
-- Si no existen, las tareas no hacen nada.
-- =============================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

create or replace function public.invocar_funcion(nombre text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  base text;
  clave text;
begin
  select decrypted_secret into base from vault.decrypted_secrets where name = 'project_url';
  select decrypted_secret into clave from vault.decrypted_secrets where name = 'functions_key';
  if base is null or clave is null then
    return;
  end if;

  perform net.http_post(
    url := rtrim(base, '/') || '/functions/v1/' || nombre,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || clave,
      'apikey', clave
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 20000
  );
end;
$$;

revoke execute on function public.invocar_funcion(text) from public, anon, authenticated;

-- Directo: cada 5 minutos. La función no gasta cuota si no hay partidos en juego.
select cron.schedule('quini-sync-live', '*/5 * * * *', $$ select public.invocar_funcion('sync-live') $$);

-- Resultados oficiales de SELAE: cada 10 minutos. Solo consulta SELAE si hay una
-- jornada empezada y sin finalizar; va aplicando cada signo según se publica.
select cron.schedule('quini-sync-oficial', '2-59/10 * * * *', $$ select public.invocar_funcion('sync-oficial') $$);
