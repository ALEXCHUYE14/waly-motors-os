-- ============================================================
-- WALY MOTORS OS — Migración 00003
-- Ciclo de vida de contratos (crear / finalizar / resumen)
-- ============================================================

-- ------------------------------------------------------------
-- 1. RPC ATÓMICA: crear_contrato
-- Bloquea el vehículo (FOR UPDATE), valida disponibilidad,
-- crea el contrato y actualiza el estado del vehículo en una
-- sola transacción. Evita que dos asesores alquilen la misma
-- mototaxi al mismo tiempo.
-- ------------------------------------------------------------
create or replace function public.crear_contrato(
  p_cliente_id         uuid,
  p_vehiculo_id        uuid,
  p_tipo               text,      -- 'alquiler' | 'venta_credito'
  p_monto_total        numeric,
  p_cuota_inicial      numeric,
  p_monto_cuota        numeric,
  p_frecuencia_pago    text,      -- diario | semanal | quincenal | mensual
  p_dia_pago_preferido integer default null,
  p_fecha_inicio       date default current_date,
  p_fecha_fin          date default null
)
returns public.contratos
language plpgsql
security definer
set search_path = public
as $$
declare
  v_vehiculo public.vehiculos%rowtype;
  v_contrato public.contratos%rowtype;
begin
  if public.fn_rol_actual() not in ('admin', 'asesor') then
    raise exception 'No autorizado para crear contratos';
  end if;

  -- 🔒 Bloqueo pesimista del vehículo
  select * into v_vehiculo
  from public.vehiculos
  where id = p_vehiculo_id
  for update;

  if not found then
    raise exception 'Vehículo no encontrado';
  end if;

  if v_vehiculo.estado <> 'disponible' then
    raise exception 'El vehículo % no está disponible (estado: %)',
      v_vehiculo.placa, v_vehiculo.estado;
  end if;

  -- Un cliente no puede tener dos contratos activos sobre el mismo vehículo
  if exists (
    select 1 from public.contratos
    where vehiculo_id = p_vehiculo_id and estado = 'activo'
  ) then
    raise exception 'El vehículo % ya tiene un contrato activo', v_vehiculo.placa;
  end if;

  insert into public.contratos (
    cliente_id, vehiculo_id, tipo,
    monto_total, cuota_inicial, monto_cuota,
    frecuencia_pago, dia_pago_preferido,
    fecha_inicio, fecha_fin, estado
  ) values (
    p_cliente_id, p_vehiculo_id, p_tipo,
    p_monto_total, p_cuota_inicial, p_monto_cuota,
    p_frecuencia_pago, p_dia_pago_preferido,
    p_fecha_inicio, p_fecha_fin, 'activo'
  )
  returning * into v_contrato;

  -- Estado del vehículo según tipo de contrato
  update public.vehiculos
  set estado = case p_tipo
                 when 'alquiler'      then 'alquilado'
                 when 'venta_credito' then 'vendido'
               end
  where id = p_vehiculo_id;

  -- La cuota inicial se registra como primer pago (si existe)
  if p_cuota_inicial > 0 then
    insert into public.pagos (
      contrato_id, monto_recibido, metodo_pago,
      estado, recaudador_id, observaciones
    ) values (
      v_contrato.id, p_cuota_inicial, 'efectivo',
      'completado', auth.uid(), 'Cuota inicial del contrato'
    );
  end if;

  return v_contrato;
end;
$$;

-- ------------------------------------------------------------
-- 2. RPC ATÓMICA: finalizar_contrato
-- Cierra el contrato y libera el vehículo (solo alquiler;
-- una venta a crédito finalizada deja el vehículo 'vendido').
-- ------------------------------------------------------------
create or replace function public.finalizar_contrato(
  p_contrato_id uuid,
  p_motivo      text default null   -- 'finalizado' normal o anotación
)
returns public.contratos
language plpgsql
security definer
set search_path = public
as $$
declare
  v_contrato public.contratos%rowtype;
begin
  if public.fn_rol_actual() not in ('admin', 'asesor') then
    raise exception 'No autorizado para finalizar contratos';
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
  set estado = 'finalizado', fecha_fin = coalesce(fecha_fin, current_date)
  where id = p_contrato_id
  returning * into v_contrato;

  -- Liberar la mototaxi solo si era alquiler
  if v_contrato.tipo = 'alquiler' then
    update public.vehiculos
    set estado = 'disponible'
    where id = v_contrato.vehiculo_id
      and estado = 'alquilado';
  end if;

  return v_contrato;
end;
$$;

-- ------------------------------------------------------------
-- 3. RPC: resumen_contrato — progreso financiero
-- Total pagado, saldo pendiente, % de avance y último pago.
-- ------------------------------------------------------------
create or replace function public.resumen_contrato(p_contrato_id uuid)
returns json
language sql
stable
security definer
set search_path = public
as $$
  select json_build_object(
    'contrato_id',   c.id,
    'tipo',          c.tipo,
    'estado',        c.estado,
    'monto_total',   c.monto_total,
    'total_pagado',  coalesce(p.total, 0),
    'saldo',         greatest(c.monto_total - coalesce(p.total, 0), 0),
    'pct_avance',    least(round(100.0 * coalesce(p.total, 0) / nullif(c.monto_total, 0)), 100),
    'num_pagos',     coalesce(p.cantidad, 0),
    'ultimo_pago',   p.ultimo
  )
  from public.contratos c
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

-- ------------------------------------------------------------
-- 4. Vehículos disponibles (para el selector del wizard)
-- ------------------------------------------------------------
create or replace function public.vehiculos_disponibles()
returns setof public.vehiculos
language sql
stable
security definer
set search_path = public
as $$
  select * from public.vehiculos
  where estado = 'disponible'
  order by placa;
$$;
