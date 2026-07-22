-- ============================================================
-- WALY MOTORS OS — Migración 00016
--
-- Bug real reportado: al eliminar un cliente (soft delete, migración
-- 00012 — la fila nunca se borra, solo se marca `activo = false`) y
-- luego intentar registrar de nuevo a esa misma persona con el mismo
-- documento, el INSERT chocaba con la restricción `unique` original de
-- `numero_documento`, que aplica sobre TODAS las filas sin importar
-- `activo`. La fila "eliminada" seguía ocupando ese número para
-- siempre, bloqueando el alta de la misma persona otra vez.
--
-- Se reemplaza esa restricción global por un índice único PARCIAL: solo
-- exige unicidad entre los clientes ACTIVOS. Un cliente desactivado ya
-- no bloquea su propio documento para una nueva alta.
-- ============================================================

alter table public.clientes
  drop constraint if exists clientes_numero_documento_key;

create unique index if not exists clientes_numero_documento_activo_key
  on public.clientes (numero_documento)
  where activo = true;
