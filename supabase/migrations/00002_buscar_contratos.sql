-- ============================================================
-- WALY MOTORS OS — Migración 00002
-- Búsqueda inteligente para el Registro Express (paso 1)
-- Busca contratos ACTIVOS por nombre, documento o placa
-- usando trigram (pg_trgm) para tolerar errores de tipeo.
-- ============================================================

create index if not exists idx_vehiculos_placa_trgm
  on public.vehiculos using gin (placa gin_trgm_ops);

create or replace function public.buscar_contratos_activos(p_termino text)
returns table (
  contrato_id     uuid,
  cliente_id      uuid,
  nombre_completo text,
  numero_documento text,
  foto_perfil     text,
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
