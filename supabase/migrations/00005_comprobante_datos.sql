-- ============================================================
-- WALY MOTORS OS — Migración 00005
-- Datos adicionales para el comprobante de pago en PDF:
--   · buscar_contratos_activos ahora también devuelve el teléfono
--     del cliente (se necesita para poder compartir el comprobante
--     por WhatsApp directamente desde Registro Express).
--   · resumen_contrato ahora también devuelve los datos de cliente
--     y vehículo (nombre, documento, teléfono, placa, modelo) para
--     poder armar el comprobante desde el historial de pagos del
--     detalle de contrato sin llamadas adicionales.
-- ============================================================

-- `buscar_contratos_activos` devuelve una tabla con columnas fijas:
-- para agregar una columna hay que dropear y recrear la función.
drop function if exists public.buscar_contratos_activos(text);

create or replace function public.buscar_contratos_activos(p_termino text)
returns table (
  contrato_id     uuid,
  cliente_id      uuid,
  nombre_completo text,
  numero_documento text,
  foto_perfil     text,
  telefono        text,
  placa           text,
  modelo          text,
  monto_cuota     numeric,
  frecuencia_pago text,
  dias_retraso    integer
)
language sql
stable
security definer
set search_path = public
as $$
  with mora as (
    select m.contrato_id, m.dias_retraso
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
    coalesce(mo.dias_retraso, 0)
  from public.contratos c
  join public.clientes  cl on cl.id = c.cliente_id
  join public.vehiculos v  on v.id  = c.vehiculo_id
  left join mora mo on mo.contrato_id = c.id
  where c.estado = 'activo'
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

-- `resumen_contrato` devuelve json: se puede recrear en el lugar
-- sin dropear (agregar campos al json_build_object es compatible).
create or replace function public.resumen_contrato(p_contrato_id uuid)
returns json
language sql
stable
security definer
set search_path = public
as $$
  select json_build_object(
    'contrato_id',      c.id,
    'tipo',             c.tipo,
    'estado',           c.estado,
    'monto_total',      c.monto_total,
    'total_pagado',     coalesce(p.total, 0),
    'saldo',            greatest(c.monto_total - coalesce(p.total, 0), 0),
    'pct_avance',       least(round(100.0 * coalesce(p.total, 0) / nullif(c.monto_total, 0)), 100),
    'num_pagos',        coalesce(p.cantidad, 0),
    'ultimo_pago',      p.ultimo,
    'cliente_nombre',    cl.nombre_completo,
    'cliente_documento', cl.numero_documento,
    'cliente_telefono',  cl.telefono,
    'vehiculo_placa',    v.placa,
    'vehiculo_modelo',   v.modelo
  )
  from public.contratos c
  join public.clientes  cl on cl.id = c.cliente_id
  join public.vehiculos v  on v.id  = c.vehiculo_id
  left join lateral (
    select
      sum(monto_recibido) as total,
      count(*)            as cantidad,
      max(fecha_pago)     as ultimo
    from public.pagos
    where contrato_id = c.id
      and estado in ('completado', 'parcial')
  ) p on true
  where c.id = p_contrato_id;
$$;
