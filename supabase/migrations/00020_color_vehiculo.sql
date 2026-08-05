-- ============================================================
-- WALY MOTORS OS — Migración 00020
--
-- Nuevo campo pedido: Color, en el alta/edición de mototaxis
-- (sección Vehículos → Agregar / Nueva mototaxi).
--
-- Es texto libre (no un catálogo cerrado de colores) y opcional
-- (nullable) — las mototaxis ya registradas antes de esta migración
-- no tienen este dato y no hay forma de inferirlo retroactivamente;
-- forzar un valor por defecto real (ej. 'Sin especificar') ensuciaría
-- el reporte en vez de simplemente dejarlo en blanco hasta que se
-- edite el vehículo.
--
-- No hace falta tocar `vehiculos_disponibles()` (migración 00003):
-- devuelve `setof public.vehiculos` (equivalente a `select *`), así
-- que la columna nueva ya viaja sola en cualquier consulta existente.
-- ============================================================

alter table public.vehiculos
  add column color text;
