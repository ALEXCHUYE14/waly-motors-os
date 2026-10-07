-- ============================================================
-- WALY MOTORS OS — Migración 00036
--
-- Bug real reportado: en el contrato de Juan Gabriel Raymundo Quezada
-- (diario), el historial muestra pagos reales el 21, 22 y 23 de
-- setiembre — pero el calendario los marcaba en ROJO (en mora), no
-- verde.
--
-- Causa: la reconstrucción automática de 00034 (pensada para contratos
-- diarios con pagos grandes que cubrían varios días) recorría los pagos
-- en orden de fecha y les asignaba cobertura empezando SIEMPRE desde el
-- primer día sin cubrir de TODA la historia del contrato — no desde la
-- fecha real en que se registró cada pago. Si el contrato arrastraba
-- CUALQUIER atraso viejo, el dinero de un pago reciente (ej. el del
-- 21-set) terminaba "cubriendo" días de meses atrás, y el día real en
-- que se cobró (21-set) se quedaba sin cobertura — exactamente al revés
-- de lo pedido: el calendario debe marcar el día TAL COMO lo registra el
-- dueño del sistema, nunca reasignarlo a otro día por un cálculo de
-- arrastre.
--
-- Corrección: se deshace esa reconstrucción. Todo pago de un contrato
-- diario vuelve a su comportamiento simple y predecible — cubre
-- ÚNICAMENTE el día de su propio `fecha_pago` (igual que ya funciona
-- para cualquier pago nuevo desde que existe la cobertura explícita,
-- migración 00033). Si un pago realmente cubrió varios días (un
-- adelanto o un atraso grande cobrado de un salto), el asesor puede
-- declararlo explícitamente con el campo "Hasta" al registrar un pago
-- nuevo — ya disponible también en contratos diarios — o, para un pago
-- YA registrado que necesite ese rango, se recomienda eliminarlo (ver
-- `eliminar_pago`, migración 00031) y volver a registrarlo con el rango
-- correcto, en vez de que el sistema lo adivine solo.
--
-- No se toca ningún contrato semanal/quincenal/mensual: el backfill de
-- 00033 para esos SÍ ancla cada pago a su propia fecha (nunca reasigna
-- a otro pago), así que nunca tuvo este problema.
--
-- No cambia ningún monto, estado ni fecha de pago — solo se limpian las
-- dos columnas de cobertura en contratos diarios, que vuelven a su
-- valor por defecto (null = cubre su propio día).
-- ============================================================

update public.pagos p
set cobertura_desde = null,
    cobertura_hasta = null
from public.contratos c
where p.contrato_id = c.id
  and c.frecuencia_pago = 'diario'
  and (p.cobertura_desde is not null or p.cobertura_hasta is not null);
