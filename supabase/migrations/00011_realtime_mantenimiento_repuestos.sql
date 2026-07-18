-- ============================================================
-- WALY MOTORS OS — Migración 00011
-- La migración 00008 habilitó Realtime solo sobre vehiculos,
-- contratos y pagos — mantenimientos y repuestos se agregaron
-- después y quedaron fuera, así que dos pantallas abiertas no se
-- enteraban solas de un mantenimiento o movimiento de stock nuevo.
-- Los `if not exists` hacen esto seguro de correr aunque alguna de
-- estas tablas ya estuviera agregada a la publicación.
-- ============================================================

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'mantenimientos'
  ) then
    alter publication supabase_realtime add table public.mantenimientos;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'repuestos'
  ) then
    alter publication supabase_realtime add table public.repuestos;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'movimientos_repuestos'
  ) then
    alter publication supabase_realtime add table public.movimientos_repuestos;
  end if;
end $$;
