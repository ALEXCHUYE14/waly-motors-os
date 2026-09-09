-- ============================================================
-- WALY MOTORS OS — Migración 00026
--
-- Bug real de cobro atrasado: `registrar_pago` ya soporta una fecha
-- explícita (`p_fecha_pago`, migración 00021), pero el frontend de
-- Registro Express solo la ofrecía para el método "Abono adicional"
-- (migración de cuaderno). Un cobro EN VIVO (Yape/Plin/Efectivo/
-- Transferencia) a un cliente con días de atraso seguía grabándose
-- siempre con `fecha_pago = now()` — como `obtener_clientes_en_mora` /
-- `resumen_contrato` calculan "próxima cuota vencida" a partir de
-- `max(fecha_pago)`, cualquier cobro fechado "hoy" limpia TODA la mora
-- de un salto, sin importar cuántos días atrasados cubre realmente el
-- monto recibido — la secuencia cronológica del cronograma se rompe.
--
-- Para que el cobrador pueda marcar explícitamente qué día del
-- cronograma está cancelando (en vez de asumir siempre "hoy"), la
-- pantalla necesita saber DESDE CUÁNDO está atrasado el contrato — no
-- solo cuántos días (`dias_retraso`, que ya devolvía). Se agrega
-- `proximo_vencimiento` a `buscar_contratos_activos`: la fecha exacta
-- de la cuota más antigua vencida (misma fórmula exacta que ya usan
-- `obtener_clientes_en_mora` y `resumen_contrato`, migración 00023 —
-- nunca se recalcula aparte, para que las tres jamás queden
-- desincronizadas), `null` cuando el contrato está al día.
--
-- No hay cambios de comportamiento en `registrar_pago` — ya aceptaba
-- `p_fecha_pago` para cualquier método, este era un límite solo del
-- frontend (ver registro-express.tsx).
-- ============================================================

drop function if exists public.buscar_contratos_activos(text);

create or replace function public.buscar_contratos_activos(p_termino text)
returns table (
  contrato_id         uuid,
  cliente_id          uuid,
  nombre_completo     text,
  numero_documento    text,
  foto_perfil         text,
  telefono            text,
  placa               text,
  modelo              text,
  monto_cuota         numeric,
  frecuencia_pago     text,
  dias_retraso        integer,
  proximo_vencimiento date
)
language sql
stable
security definer
set search_path = public
as $$
  with mora as (
    select m.contrato_id, m.dias_retraso, m.fecha_vencida
    from public.obtener_clientes_en_mora() m
  )
  select
    c.id,
    cl.id,
    cl.nombre_completo,
    cl.numero_documento,
    cl.foto_perfil,
    cl.telefono,
    v.placa,
    v.modelo,
    c.monto_cuota,
    c.frecuencia_pago,
    coalesce(mo.dias_retraso, 0),
    mo.fecha_vencida
  from public.contratos c
  join public.clientes  cl on cl.id = c.cliente_id
  join public.vehiculos v  on v.id  = c.vehiculo_id
  left join mora mo on mo.contrato_id = c.id
  where c.estado = 'activo'
    and cl.activo = true
    and (
      cl.nombre_completo   ilike '%' || p_termino || '%'
      or cl.numero_documento like p_termino || '%'
      or v.placa            ilike '%' || p_termino || '%'
      or similarity(cl.nombre_completo, p_termino) > 0.25
    )
  order by
    coalesce(mo.dias_retraso, 0) desc,          -- morosos primero
    similarity(cl.nombre_completo, p_termino) desc
  limit 8;
$$;
