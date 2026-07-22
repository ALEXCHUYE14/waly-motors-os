-- ============================================================
-- WALY MOTORS OS — Migración 00017
--
-- Bug real reportado: al finalizar un contrato creado el mismo día
-- (por ejemplo, uno que el cliente pagó al 100% en el mismo día en que
-- se registró), `finalizar_contrato` falla con:
--   "new row for relation "contratos" violates check constraint
--    "contratos_check""
--
-- La causa: la migración 00001 definió `fecha_fin date check
-- (fecha_fin > fecha_inicio)` — ESTRICTAMENTE mayor. `finalizar_contrato`
-- pone `fecha_fin = current_date` la primera vez que se cierra el
-- contrato; si `fecha_inicio` también es hoy (contrato creado y
-- finalizado el mismo día — nada raro, pasa seguido con ventas al
-- contado o pruebas), `fecha_fin` queda IGUAL a `fecha_inicio`, no
-- mayor, y la restricción lo rechaza.
--
-- Se relaja a `>=` (mismo día permitido) — no debilita ninguna regla de
-- negocio real: no hay ningún caso en el que un contrato deba durar
-- estrictamente más de cero días.
-- ============================================================

-- El nombre real de la restricción en producción es "contratos_check"
-- (confirmado por el mensaje de error) — se dropea por si acaso también
-- con el nombre que generaría Postgres por convención, para que esta
-- migración sea segura de correr en cualquiera de los dos escenarios.
alter table public.contratos drop constraint if exists contratos_check;
alter table public.contratos drop constraint if exists contratos_fecha_fin_check;

alter table public.contratos
  add constraint contratos_fecha_fin_check
  check (fecha_fin is null or fecha_fin >= fecha_inicio);
