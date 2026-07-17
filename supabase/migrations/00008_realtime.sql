-- ============================================================
-- WALY MOTORS OS — Migración 00008
-- Habilita Supabase Realtime (postgres_changes) sobre las tablas
-- que varios cobradores/asesores pueden modificar a la vez desde
-- distintos dispositivos: vehículos (estado), contratos (alta/
-- finalización) y pagos (cobros en calle). Sin esto, el canal de
-- app-shell.tsx solo mide conectividad — ningún dato fluye.
-- ============================================================

alter publication supabase_realtime add table public.vehiculos;
alter publication supabase_realtime add table public.contratos;
alter publication supabase_realtime add table public.pagos;
