-- ============================================================
-- WALY MOTORS OS — Migración 00018
--
-- Bug real reportado: clientes ya eliminados (soft delete, migración
-- 00012 — `activo = false`) seguían apareciendo al buscar un cliente
-- para crear un contrato.
--
-- La causa principal era del lado del frontend: la búsqueda de
-- clientes del wizard de "Nuevo contrato" (`useBuscarClientes`) nunca
-- filtraba por `activo` — se corrige en el mismo commit que esta
-- migración.
--
-- Esta migración blinda el lado de la base de datos para el resto del
-- sistema:
--   · obtener_clientes_en_mora() y buscar_contratos_activos() ahora
--     excluyen explícitamente clientes inactivos. En la práctica un
--     cliente eliminado nunca debería tener un contrato ACTIVO (la RPC
--     eliminar_cliente ya lo bloquea si tiene alguno sin finalizar),
--     pero se agrega el filtro igual como segunda capa de seguridad,
--     no solo por lógica indirecta entre funciones distintas.
--   · crear_contrato() ahora rechaza explícitamente crear un contrato
--     nuevo para un cliente inactivo — antes solo lo impedía la UI (el
--     buscador ya no lo mostraba), pero una llamada directa a la RPC
--     igual lo hubiera permitido.
-- ============================================================

create or replace function public.obtener_clientes_en_mora()
returns table (
  contrato_id     uuid,
  cliente_id      uuid,
  nombre_completo text,
  telefono        text,
  foto_perfil     text,
  placa           text,
  monto_cuota     numeric,
  fecha_vencida   date,
  dias_retraso    integer
)
language sql
stable
security definer
set search_path = public
as $$
  with ultimo_pago as (
    select p.contrato_id, max(p.fecha_pago)::date as ultima_fecha
    from public.pagos p
    where p.estado = 'completado'
    group by p.contrato_id
  ),
  base as (
    select
      c.id as contrato_id,
      cl.id as cliente_id,
      cl.nombre_completo,
      cl.telefono,
      cl.foto_perfil,
      v.placa,
      c.monto_cuota,
      coalesce(up.ultima_fecha, c.fecha_inicio)
        + case c.frecuencia_pago
            when 'diario'    then interval '1 day'
            when 'semanal'   then interval '7 days'
            when 'quincenal' then interval '15 days'
            when 'mensual'   then interval '1 month'
          end as proximo_vencimiento
    from public.contratos c
    join public.clientes  cl on cl.id = c.cliente_id
    join public.vehiculos v  on v.id  = c.vehiculo_id
    left join ultimo_pago up on up.contrato_id = c.id
    where c.estado = 'activo'
      and cl.activo = true
  )
  select
    contrato_id,
    cliente_id,
    nombre_completo,
    telefono,
    foto_perfil,
    placa,
    monto_cuota,
    proximo_vencimiento::date as fecha_vencida,
    (current_date - proximo_vencimiento::date)::integer as dias_retraso
  from base
  where proximo_vencimiento::date < current_date
  order by dias_retraso desc;
$$;

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

create or replace function public.crear_contrato(
  p_cliente_id         uuid,
  p_vehiculo_id        uuid,
  p_tipo               text,
  p_monto_total        numeric,
  p_cuota_inicial      numeric,
  p_monto_cuota        numeric,
  p_frecuencia_pago    text,
  p_dia_pago_preferido integer default null,
  p_fecha_inicio       date default current_date,
  p_fecha_fin          date default null,
  p_firma_base64       text default null,
  p_documentos_garantia text[] default '{}'
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
  if coalesce(public.fn_rol_actual(), '') not in ('admin', 'asesor') then
    raise exception 'No autorizado para crear contratos';
  end if;

  if not exists (select 1 from public.clientes where id = p_cliente_id and activo = true) then
    raise exception 'Cliente no encontrado o eliminado';
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
    fecha_inicio, fecha_fin, estado,
    firma_base64, firma_fecha, documentos_garantia, creado_por
  ) values (
    p_cliente_id, p_vehiculo_id, p_tipo,
    p_monto_total, p_cuota_inicial, p_monto_cuota,
    p_frecuencia_pago, p_dia_pago_preferido,
    p_fecha_inicio, p_fecha_fin, 'activo',
    p_firma_base64,
    case when p_firma_base64 is not null then now() else null end,
    p_documentos_garantia,
    auth.uid()
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
