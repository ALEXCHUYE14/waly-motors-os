-- ============================================================
-- WALY MOTORS OS — Migración 00023
--
-- 1) Bug real de mora: `obtener_clientes_en_mora()` solo consideraba
--    pagos con estado = 'completado' para calcular la fecha del último
--    pago. Con la tarifa diaria diferenciada (migración 00019-00022),
--    CUALQUIER pago de domingo (tarifa más baja que `monto_cuota`, que
--    se toma de la tarifa Lunes-Sábado) queda registrado como 'parcial'
--    — así que todos los domingos pagados eran invisibles para la mora,
--    aunque fueran pagos completos y correctos según su propia tarifa.
--    Se amplía a `estado in ('completado', 'parcial')`, igual criterio
--    que ya usa `resumen_contrato` para sumar `total_pagado`.
--
-- 2) `resumen_contrato` ahora también devuelve `proximo_vencimiento` y
--    `dias_retraso` por contrato individual (misma fórmula exacta que
--    `obtener_clientes_en_mora`, para que nunca queden desincronizadas)
--    — las usa el calendario de pagos del detalle de contrato para
--    marcar en rojo los días en mora.
--
-- 3) Nueva RPC `editar_contrato`: permite corregir un contrato con
--    errores (monto, cuota, frecuencia, fechas, duración/tarifas) SIN
--    finalizarlo ni eliminarlo. Deliberadamente NO permite cambiar
--    cliente, vehículo ni tipo (son estructurales: cambiar cualquiera
--    de los tres implicaría rehacer el bloqueo de disponibilidad del
--    vehículo, exactamente lo que `crear_contrato` ya hace con cuidado
--    — si el error es "cliente o vehículo equivocado", ese contrato debe
--    finalizarse/eliminarse y crearse de nuevo). Tampoco permite editar
--    contratos ya finalizados (el registro histórico no se reescribe) ni
--    la cuota inicial o los pagos previos migrados (ya son filas reales
--    en `pagos`; corregirlos es un caso aparte). Al guardar, limpia
--    `contrato_pdf_url` — el PDF viejo queda con datos incorrectos, y al
--    ponerlo en null el mecanismo "on-demand" que ya existe (ver
--    `asegurarRutaContratoPdf` en detalle-contrato.tsx) lo regenera solo
--    la próxima vez que se pida descargar o enviar, ya con los datos
--    corregidos.
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
    where p.estado in ('completado', 'parcial')
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
    'duracion_meses',    c.duracion_meses,
    'monto_lunes_sabado', c.monto_lunes_sabado,
    'monto_domingo',     c.monto_domingo,
    'pagos_previos_acumulados', c.pagos_previos_acumulados,
    'total_pagado',      coalesce(p.total, 0),
    'saldo',             greatest(c.monto_total - coalesce(p.total, 0), 0),
    'pct_avance',        least(round(100.0 * coalesce(p.total, 0) / nullif(c.monto_total, 0)), 100),
    'num_pagos',         coalesce(p.cantidad, 0),
    'ultimo_pago',       p.ultimo,
    -- Misma fórmula exacta que obtener_clientes_en_mora — nunca se
    -- calcula por separado, para que las dos nunca se desincronicen.
    'proximo_vencimiento', (
      coalesce(p.ultimo::date, c.fecha_inicio)
        + case c.frecuencia_pago
            when 'diario'    then interval '1 day'
            when 'semanal'   then interval '7 days'
            when 'quincenal' then interval '15 days'
            when 'mensual'   then interval '1 month'
          end
    )::date,
    'dias_retraso', greatest((
      current_date - (
        coalesce(p.ultimo::date, c.fecha_inicio)
          + case c.frecuencia_pago
              when 'diario'    then interval '1 day'
              when 'semanal'   then interval '7 days'
              when 'quincenal' then interval '15 days'
              when 'mensual'   then interval '1 month'
            end
      )::date
    )::integer, 0),
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

create or replace function public.editar_contrato(
  p_contrato_id         uuid,
  p_monto_total         numeric,
  p_monto_cuota         numeric,
  p_frecuencia_pago     text,
  p_dia_pago_preferido  integer default null,
  p_fecha_inicio        date default null,
  p_fecha_fin           date default null,
  p_duracion_meses      integer default null,
  p_monto_lunes_sabado  numeric default null,
  p_monto_domingo       numeric default null
)
returns public.contratos
language plpgsql
security definer
set search_path = public
as $$
declare
  v_contrato              public.contratos%rowtype;
  v_fecha_inicio_efectiva date;
begin
  if coalesce(public.fn_rol_actual(), '') not in ('admin', 'asesor') then
    raise exception 'No autorizado para editar contratos';
  end if;

  select * into v_contrato
  from public.contratos
  where id = p_contrato_id
  for update;

  if not found then
    raise exception 'Contrato no encontrado';
  end if;

  if v_contrato.estado = 'finalizado' then
    raise exception 'No se puede editar un contrato ya finalizado — el registro histórico no se modifica';
  end if;

  if p_monto_total is null or p_monto_total <= 0 then
    raise exception 'El monto total debe ser mayor a cero';
  end if;
  if p_monto_cuota is null or p_monto_cuota <= 0 then
    raise exception 'El monto por cuota debe ser mayor a cero';
  end if;
  if p_frecuencia_pago is null or p_frecuencia_pago not in ('diario', 'semanal', 'quincenal', 'mensual') then
    raise exception 'Frecuencia de pago inválida: %', p_frecuencia_pago;
  end if;
  if p_dia_pago_preferido is not null and (p_dia_pago_preferido < 1 or p_dia_pago_preferido > 31) then
    raise exception 'Día de pago preferido inválido: debe estar entre 1 y 31';
  end if;
  if p_duracion_meses is not null and p_duracion_meses <= 0 then
    raise exception 'La duración en meses debe ser mayor a cero';
  end if;
  if p_monto_lunes_sabado is not null and p_monto_lunes_sabado <= 0 then
    raise exception 'La tarifa de Lunes a Sábado debe ser mayor a cero';
  end if;
  if p_monto_domingo is not null and p_monto_domingo <= 0 then
    raise exception 'La tarifa de Domingo debe ser mayor a cero';
  end if;

  v_fecha_inicio_efectiva := coalesce(p_fecha_inicio, v_contrato.fecha_inicio);
  if p_fecha_fin is not null and p_fecha_fin < v_fecha_inicio_efectiva then
    raise exception 'La fecha de fin no puede ser anterior a la fecha de inicio';
  end if;

  update public.contratos
  set monto_total        = p_monto_total,
      monto_cuota        = p_monto_cuota,
      frecuencia_pago    = p_frecuencia_pago,
      dia_pago_preferido = p_dia_pago_preferido,
      fecha_inicio       = v_fecha_inicio_efectiva,
      fecha_fin          = p_fecha_fin,
      duracion_meses     = p_duracion_meses,
      monto_lunes_sabado = p_monto_lunes_sabado,
      monto_domingo      = p_monto_domingo,
      contrato_pdf_url   = null
  where id = p_contrato_id
  returning * into v_contrato;

  return v_contrato;
end;
$$;
