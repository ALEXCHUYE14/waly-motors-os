-- ============================================================
-- WALY MOTORS OS — Migración 00032
--
-- Auditoría del cálculo de mora y cobertura. Problemas encontrados:
--
--   1) La cobertura dependía de la FECHA de cada pago, no de su MONTO:
--      un pago de S/ 178 (cubre ~7 días) solo empujaba la "próxima
--      cuota" un intervalo desde su fecha. Por eso el contrato aparecía
--      "cancelado hasta el 15" en la captura y la mora arrancaba en el
--      día equivocado.
--   2) Los días sin pago entre dos pagos nunca se marcaban en rojo: la
--      mora era un único tramo desde `proximo_vencimiento` a hoy. Un
--      cliente con días 22–26 sin pagar mostraba solo 28–30 en rojo.
--   3) El calendario pintaba solo las FECHAS donde hubo un cobro, no los
--      DÍAS que ese cobro cubre.
--   4) La tarifa de domingo (`monto_domingo`) no entraba en la mora: se
--      esperaba `monto_cuota` todos los días.
--   5) `current_date` de Postgres es UTC: después de las 7 pm en Lima ya
--      es el día siguiente y la mora salía un día de más.
--   6) Un contrato finalizado podía seguir mostrando mora.
--
-- Modelo corregido (FIFO por monto):
--   • El cronograma es una lista de vencimientos desde `fecha_inicio`
--     (cada día si la frecuencia es diaria, o cada semana/quincena/mes),
--     cada uno con su monto esperado: `monto_domingo` si es diario y el
--     vencimiento cae domingo, si no `monto_cuota`.
--   • Todos los pagos (completados/parcial, sin la cuota inicial, que va
--     aparte) se aplican en orden a esos vencimientos, acumulando monto.
--     Un día está "al día" cuando el total pagado alcanza su monto
--     esperado. Así un pago grande cubre varios días a la vez, y un
--     cobro atrasado cubre los días más antiguos primero.
--   • En mora = vencimiento ya pasado (antes de hoy, hora de Lima), no
--     cubierto, y contrato activo. La mora deja de ser un tramo: son
--     exactamente los días impagos.
--   • `proximo_vencimiento` = primer vencimiento impago (o el próximo
--     pendiente si no hay mora). `dias_retraso` = cantidad de días en
--     mora. Ambos siguen existiendo con el mismo nombre para no romper
--     el frontend ni las RPC que los consumen.
--   • La cuota inicial sigue fuera del cronograma (ver 00025): no cubre
--     días ni genera mora.
--
-- Horizonte: el cronograma se genera hasta 400 días desde hoy (o hasta
-- `fecha_fin`), para que pagos adelantados se vean cubriendo días
-- futuros. Un pago que excede el horizonte no pierde nada: solo no se
-- dibuja más allá.
--
-- No cambia: montos cobrados, saldo, total pagado, % de avance, estados
-- de pago, ni la firma de `obtener_clientes_en_mora` (mismas columnas).
-- ============================================================

create or replace function public.cronograma_contrato(p_contrato_id uuid)
returns table (
  fecha    date,
  esperado numeric,
  cubierto numeric,
  al_dia   boolean,
  en_mora  boolean
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
  c as (
    select
      ct.id,
      ct.fecha_inicio,
      ct.fecha_fin,
      ct.frecuencia_pago,
      ct.monto_cuota,
      ct.monto_domingo,
      ct.estado
    from public.contratos ct
    where ct.id = p_contrato_id
  ),
  total as (
    select coalesce(sum(p.monto_recibido), 0) as monto
    from public.pagos p
    where p.contrato_id = p_contrato_id
      and p.estado in ('completado', 'parcial')
      and not p.es_cuota_inicial
  ),
  sched as (
    select
      s::date as fecha,
      case
        when c.frecuencia_pago = 'diario'
         and c.monto_domingo is not null
         and extract(dow from s) = 0
        then c.monto_domingo
        else c.monto_cuota
      end as esperado
    from c
    cross join hoy
    cross join lateral generate_series(
      c.fecha_inicio::timestamp,
      least(
        coalesce(c.fecha_fin, date '9999-12-31'),
        hoy.d + 400
      )::timestamp,
      case c.frecuencia_pago
        when 'semanal'   then interval '7 days'
        when 'quincenal' then interval '15 days'
        when 'mensual'   then interval '1 month'
        else interval '1 day'
      end
    ) as s
  ),
  acumulado as (
    select
      sched.fecha,
      sched.esperado,
      sum(sched.esperado) over (
        order by sched.fecha
        rows between unbounded preceding and current row
      ) as acum
    from sched
  ),
  aplicado as (
    select
      a.fecha,
      a.esperado,
      greatest(least(t.monto - (a.acum - a.esperado), a.esperado), 0) as cubierto
    from acumulado a
    cross join total t
  )
  select
    ap.fecha,
    ap.esperado,
    ap.cubierto,
    ap.cubierto >= ap.esperado as al_dia,
    (
      ap.cubierto < ap.esperado
      and ap.fecha < (select d from hoy)
      and (select estado from c) = 'activo'
    ) as en_mora
  from aplicado ap
  order by ap.fecha;
$$;

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
  select
    c.id,
    cl.id,
    cl.nombre_completo,
    cl.telefono,
    cl.foto_perfil,
    v.placa,
    c.monto_cuota,
    m.fecha_vencida,
    m.dias_retraso
  from public.contratos c
  join public.clientes  cl on cl.id = c.cliente_id
  join public.vehiculos v  on v.id  = c.vehiculo_id
  cross join lateral (
    select
      min(cr.fecha)::date as fecha_vencida,
      count(*)::integer   as dias_retraso
    from public.cronograma_contrato(c.id) cr
    where cr.en_mora
  ) m
  where c.estado = 'activo'
    and cl.activo = true
    and m.dias_retraso > 0
  order by m.dias_retraso desc;
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
    -- Primer vencimiento impago (o el próximo pendiente si está al día),
    -- calculado día a día con el cronograma (ver cronograma_contrato).
    'proximo_vencimiento', (
      select min(cr.fecha) from public.cronograma_contrato(c.id) cr where not cr.al_dia
    ),
    'dias_retraso', (
      select count(*)::integer from public.cronograma_contrato(c.id) cr where cr.en_mora
    ),
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
      max(fecha_pago)     as ultimo
    from public.pagos
    where contrato_id = c.id
      and estado in ('completado', 'parcial')
  ) p on true
  where c.id = p_contrato_id;
$$;
