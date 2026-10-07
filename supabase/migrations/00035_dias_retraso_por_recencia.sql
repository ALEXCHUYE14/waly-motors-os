-- ============================================================
-- WALY MOTORS OS — Migración 00035
--
-- Bug real reportado: clientes que pagan con normalidad (ej. Juan Manuel
-- Chero Chero, con pagos semanales registrados el 13, 20 y 27 de
-- setiembre) aparecían con "175 días de retraso" en el Dashboard.
--
-- Causa: desde 00032, `dias_retraso`/`proximo_vencimiento` (en
-- `resumen_contrato` y `obtener_clientes_en_mora`) se calculaban
-- CONTANDO TODOS los días/períodos sin cobertura en TODA la vida del
-- contrato (vía `cronograma_contrato`) — así que un contrato con huecos
-- viejos (meses atrás) pero que paga con normalidad AHORA sumaba esos
-- huecos antiguos al número, aunque ya no reflejen ningún atraso actual.
-- Eso es útil para pintar el calendario completo (sí hay que mostrar que
-- marzo quedó sin pagar, por ejemplo), pero NUNCA debió ser la fuente
-- del número agregado que usan el Dashboard, el mensaje de WhatsApp y el
-- orden de "clientes en mora" — ese número necesita responder "¿cuántos
-- días lleva SIN PAGAR DESDE SU ÚLTIMO PAGO REAL?", no "¿cuántos días
-- sin pagar tiene acumulados en toda su historia?".
--
-- Corrección: `dias_retraso` / `proximo_vencimiento` vuelven a calcularse
-- por RECENCIA — igual que el sistema ya hacía antes de 00032, antes de
-- que existiera el cronograma — pero ahora usando `cobertura_hasta`
-- (migración 00033) en vez de `fecha_pago`, así que un pago semanal con
-- rango explícito cuenta su día final real, no solo la fecha en que se
-- registró:
--
--   proximo_vencimiento = (el último día con cobertura real) + 1 día
--   dias_retraso        = hoy − proximo_vencimiento (nunca negativo)
--
-- Un hueco viejo YA SUPERADO por pagos más recientes deja de sumar al
-- número — exactamente el comportamiento de siempre. El saldo pendiente
-- (`monto_total - total_pagado`) NUNCA escondió esos huecos: ese cálculo
-- no cambia en nada, así que ningún sol pagado o adeudado se pierde o se
-- inventa.
--
-- El calendario del contrato (`cronograma_contrato`, 00034) NO se toca:
-- sigue mostrando en rojo cualquier día viejo sin cobertura, aunque el
-- cliente ya esté al día ahora — es información histórica real y útil,
-- separada a propósito del número agregado de arriba.
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
  with
  hoy as (
    select (now() at time zone 'America/Lima')::date as d
  ),
  ultimo_cubierto as (
    select
      p.contrato_id,
      max(coalesce(p.cobertura_hasta, p.fecha_pago::date)) as hasta
    from public.pagos p
    where p.estado in ('completado', 'parcial')
      and not p.es_cuota_inicial
    group by p.contrato_id
  ),
  base as (
    select
      c.id             as contrato_id,
      cl.id            as cliente_id,
      cl.nombre_completo,
      cl.telefono,
      cl.foto_perfil,
      v.placa,
      c.monto_cuota,
      (coalesce(u.hasta, c.fecha_inicio - 1) + 1) as proximo_vencimiento
    from public.contratos c
    join public.clientes  cl on cl.id = c.cliente_id
    join public.vehiculos v  on v.id  = c.vehiculo_id
    left join ultimo_cubierto u on u.contrato_id = c.id
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
    proximo_vencimiento as fecha_vencida,
    ((select d from hoy) - proximo_vencimiento)::integer as dias_retraso
  from base
  where proximo_vencimiento < (select d from hoy)
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
    'pct_avance', coalesce(least(round(
      100.0 * coalesce(p.total_periodico, 0)
      / nullif(c.monto_total - c.cuota_inicial, 0)
    ), 100), 0),
    'num_pagos',         coalesce(p.cantidad, 0),
    'ultimo_pago',       p.ultimo,
    -- Por recencia: el día después del último que tiene cobertura real
    -- (rango explícito o, si no tiene, su propio fecha_pago) — ver nota
    -- arriba. Nunca cuenta huecos viejos ya superados por pagos
    -- posteriores.
    'proximo_vencimiento', coalesce(p.ultimo_cubierto, c.fecha_inicio - 1) + 1,
    'dias_retraso', greatest((
      (now() at time zone 'America/Lima')::date
      - (coalesce(p.ultimo_cubierto, c.fecha_inicio - 1) + 1)
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
      sum(monto_recibido) filter (where not es_cuota_inicial) as total_periodico,
      count(*)            as cantidad,
      max(fecha_pago)     as ultimo,
      max(coalesce(cobertura_hasta, fecha_pago::date))
        filter (where not es_cuota_inicial) as ultimo_cubierto
    from public.pagos
    where contrato_id = c.id
      and estado in ('completado', 'parcial')
  ) p on true
  where c.id = p_contrato_id;
$$;
