-- Último intento de obtener el resultado oficial de una jornada (loteriasapi / SELAE).
-- Sirve para espaciar las consultas y no gastar la cuota de loteriasapi.
alter table public.jornadas add column ultimo_intento_oficial timestamptz;
