-- ============================================================
-- WALY MOTORS OS — Migración 00014
--
-- Bug real reportado: al finalizar un contrato de VENTA A CRÉDITO, la
-- mototaxi quedaba marcada como `vendido` sin importar el motivo del
-- cierre. Si el cliente incumplía y había que recuperar el vehículo,
-- el sistema lo seguía mostrando como "vendida" para siempre — aunque
-- nunca se terminó de pagar y ya no está en poder del cliente.
--
-- `finalizar_contrato` ya recibía un parámetro `p_motivo` (texto libre)
-- que nunca se usaba en el cuerpo de la función. Se reutiliza ese mismo
-- parámetro (sin romper firma ni llamadas existentes: mismo nombre,
-- tipo y posición) con dos valores posibles:
--   · 'completado'    (default — igual que el comportamiento actual):
--       alquiler → libera la mototaxi; venta_credito → queda vendida.
--   · 'incumplimiento': el cliente no cumplió y se recuperó la
--       mototaxi — se libera SIEMPRE, sin importar el tipo de contrato.
--
-- Como el default es 'completado', cualquier llamada existente que no
-- pase este parámetro se comporta exactamente igual que antes — el fix
-- solo entra en juego cuando el asesor marca explícitamente el cierre
-- como incumplimiento.
-- ============================================================

alter table public.contratos
  add column motivo_finalizacion text
    check (motivo_finalizacion is null or motivo_finalizacion in ('completado', 'incumplimiento'));

create or replace function public.finalizar_contrato(
  p_contrato_id uuid,
  p_motivo      text default 'completado'   -- 'completado' | 'incumplimiento'
)
returns public.contratos
language plpgsql
security definer
set search_path = public
as $$
declare
  v_contrato public.contratos%rowtype;
begin
  if coalesce(public.fn_rol_actual(), '') not in ('admin', 'asesor') then
    raise exception 'No autorizado para finalizar contratos';
  end if;

  if p_motivo not in ('completado', 'incumplimiento') then
    raise exception 'Motivo de finalización inválido: % (debe ser completado o incumplimiento)', p_motivo;
  end if;

  select * into v_contrato
  from public.contratos
  where id = p_contrato_id
  for update;

  if not found then
    raise exception 'Contrato no encontrado';
  end if;

  if v_contrato.estado = 'finalizado' then
    raise exception 'El contrato ya está finalizado';
  end if;

  update public.contratos
  set estado = 'finalizado',
      fecha_fin = coalesce(fecha_fin, current_date),
      motivo_finalizacion = p_motivo
  where id = p_contrato_id
  returning * into v_contrato;

  -- Libera la mototaxi (vuelve a 'disponible') cuando:
  --  · era alquiler: nunca se vendió, siempre se libera al terminar
  --    (comportamiento sin cambios), o
  --  · era venta a crédito pero el cliente incumplió y la mototaxi se
  --    recuperó: este es el fix — antes quedaba "vendido" para
  --    siempre así el cliente nunca hubiera terminado de pagarla.
  if v_contrato.tipo = 'alquiler' or p_motivo = 'incumplimiento' then
    update public.vehiculos
    set estado = 'disponible'
    where id = v_contrato.vehiculo_id
      and estado in ('alquilado', 'vendido');
  end if;

  return v_contrato;
end;
$$;

-- resumen_contrato: agrega `motivo_finalizacion` para que el detalle del
-- contrato pueda mostrar por qué se cerró (completado / incumplimiento).
create or replace function public.resumen_contrato(p_contrato_id uuid)
returns json
language sql
stable
security definer
set search_path = public
as $$
  select json_build_object(
    'contrato_id',       c.id,
    'tipo',              c.tipo,
    'estado',            c.estado,
    'motivo_finalizacion', c.motivo_finalizacion,
    'monto_total',       c.monto_total,
    'cuota_inicial',     c.cuota_inicial,
    'monto_cuota',       c.monto_cuota,
    'frecuencia_pago',   c.frecuencia_pago,
    'fecha_inicio',      c.fecha_inicio,
    'fecha_fin',         c.fecha_fin,
    'total_pagado',      coalesce(p.total, 0),
    'saldo',             greatest(c.monto_total - coalesce(p.total, 0), 0),
    'pct_avance',        least(round(100.0 * coalesce(p.total, 0) / nullif(c.monto_total, 0)), 100),
    'num_pagos',         coalesce(p.cantidad, 0),
    'ultimo_pago',       p.ultimo,
    'cliente_nombre',    cl.nombre_completo,
    'cliente_documento', cl.numero_documento,
    'cliente_tipo_documento', cl.tipo_documento,
    'cliente_direccion', cl.direccion,
    'cliente_telefono',  cl.telefono,
    'vehiculo_placa',    v.placa,
    'vehiculo_modelo',   v.modelo,
    'vehiculo_anio',     v.anio,
    'vehiculo_chasis',   v.numero_chasis,
    'vehiculo_km',       v.kilometraje,
    'firma_base64',      c.firma_base64,
    'firma_fecha',       c.firma_fecha,
    'documentos_garantia', c.documentos_garantia,
    'contrato_pdf_url',  c.contrato_pdf_url,
    'creado_en',         c.created_at
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
