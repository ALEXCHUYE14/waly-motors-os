-- ============================================================
-- WALY MOTORS OS — Migración 00033
--
-- Bug real reportado: un cliente que pagó solo hasta el día 4 aparecía
-- con el día 5 en verde. Causa: 00032 cubría los días del cronograma
-- por MONTO ACUMULADO (FIFO) — si la suma histórica de todos los pagos
-- superaba el monto esperado hasta el día 5, ese día se pintaba
-- "cubierto" aunque nadie hubiera cobrado nada ese día en particular.
-- Esa misma razón es la que dejaba huecos en blanco en los pagos
-- semanales (ej. Juan Manuel Chero Chero, S/ 182 cada 7 días): un pago
-- fechado el domingo 20 solo coloreaba el 20, nunca el 14 al 19, porque
-- el monto no alcanzaba a "desbordar" sobre esos días en el reparto.
--
-- Corrección: se reemplaza el cálculo por MONTO con cobertura EXPLÍCITA.
-- Cada pago ahora puede declarar el rango de días que cubre
-- (`cobertura_desde`, `cobertura_hasta`) — el cobrador lo elige al
-- registrar un pago semanal/quincenal/mensual, o al adelantar/atrasar un
-- cobro diario (ver registro-express.tsx). Si no se declara (caso de
-- siempre: un cobro diario puntual), cubre únicamente su propio
-- `fecha_pago` — CERO cambio de comportamiento para ese caso, que sigue
-- siendo la enorme mayoría de los cobros.
--
-- El calendario y la mora ya NO suman dinero: un día del cronograma
-- está "al día" si y solo si cae dentro del rango declarado de ALGÚN
-- pago real (completado/parcial, sin contar la cuota inicial). En mora
-- = lo contrario, y ya pasó. Determinista y auditable: ya no puede
-- pintarse en verde ningún día que nadie registró explícitamente.
--
-- Retrocompatibilidad (sin perder datos): los pagos YA registrados en
-- contratos semanales/quincenales/mensuales se completan con un rango
-- que termina en su `fecha_pago` y empieza un período atrás (6 días
-- antes en semanal, 14 en quincenal, 1 mes menos un día en mensual) —
-- el supuesto más razonable dado que esos montos ya corresponden
-- exactamente a un período completo (`monto_cuota`). Los contratos
-- diarios NO se tocan: sus pagos ya cubrían exactamente su propio día,
-- que sigue siendo el comportamiento por defecto.
--
-- No cambia: monto_recibido, fecha_pago, saldo, total pagado — ningún
-- dato de dinero se recalcula ni se pierde. Solo se agregan dos columnas
-- nuevas (nullable) y se completan donde corresponde.
-- ============================================================

alter table public.pagos
  add column cobertura_desde date,
  add column cobertura_hasta date,
  add constraint pagos_cobertura_rango_check check (
    (cobertura_desde is null and cobertura_hasta is null)
    or (cobertura_desde is not null and cobertura_hasta is not null and cobertura_hasta >= cobertura_desde)
  );

-- Backfill: solo contratos con periodo propio (no diario) — ver nota arriba.
update public.pagos p
set cobertura_hasta = p.fecha_pago::date,
    cobertura_desde = (
      p.fecha_pago::date - case c.frecuencia_pago
        when 'semanal'   then interval '6 days'
        when 'quincenal' then interval '14 days'
        when 'mensual'   then (interval '1 month' - interval '1 day')
      end
    )::date
from public.contratos c
where p.contrato_id = c.id
  and c.frecuencia_pago in ('semanal', 'quincenal', 'mensual')
  and not p.es_cuota_inicial
  and p.cobertura_desde is null;

-- Monto esperado para un RANGO de cobertura (no un solo día): en
-- contratos diarios sigue siendo la suma día a día (con tarifa de
-- domingo donde aplique, ver `monto_cuota_del_dia`, migración 00030);
-- en semanal/quincenal/mensual el rango representa un único período, así
-- que el monto esperado sigue siendo `monto_cuota` tal cual.
create or replace function public.monto_cuota_rango(
  p_monto_cuota   numeric,
  p_monto_domingo numeric,
  p_frecuencia    text,
  p_desde         date,
  p_hasta         date
)
returns numeric
language sql
immutable
set search_path = public
as $$
  select case
    when p_frecuencia = 'diario' then (
      select coalesce(sum(public.monto_cuota_del_dia(p_monto_cuota, p_monto_domingo, d::timestamp)), 0)
      from generate_series(p_desde, p_hasta, interval '1 day') d
    )
    else p_monto_cuota
  end;
$$;

-- Cronograma: ya no acumula dinero — un día está cubierto si cae dentro
-- del rango declarado de algún pago real. Postgres no deja cambiar las
-- columnas de salida de una función con `create or replace` (la versión
-- de 00032 devolvía también `cubierto numeric`, que ya no existe) — hay
-- que borrarla primero.
drop function if exists public.cronograma_contrato(uuid);

create function public.cronograma_contrato(p_contrato_id uuid)
returns table (
  fecha    date,
  esperado numeric,
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
  rangos as (
    select
      coalesce(p.cobertura_desde, p.fecha_pago::date) as desde,
      coalesce(p.cobertura_hasta, p.fecha_pago::date) as hasta
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
  )
  select
    sch.fecha,
    sch.esperado,
    exists(select 1 from rangos r where sch.fecha between r.desde and r.hasta) as al_dia,
    (
      not exists(select 1 from rangos r where sch.fecha between r.desde and r.hasta)
      and sch.fecha < (select d from hoy)
      and (select estado from c) = 'activo'
    ) as en_mora
  from sched sch
  order by sch.fecha;
$$;

create or replace function public.registrar_pago(
  p_contrato_id       uuid,
  p_monto             numeric,
  p_metodo            text,
  p_evidencia_url     text default null,
  p_observaciones     text default null,
  p_fecha_pago        timestamptz default null,
  p_cobertura_desde   date default null,
  p_cobertura_hasta   date default null
)
returns public.pagos
language plpgsql
security definer
set search_path = public
as $$
declare
  v_contrato public.contratos%rowtype;
  v_pago     public.pagos%rowtype;
  v_fecha    timestamptz;
  v_hoy_lima date;
begin
  if coalesce(public.fn_rol_actual(), '') not in ('admin', 'asesor') then
    raise exception 'No autorizado para registrar pagos';
  end if;

  v_hoy_lima := (now() at time zone 'America/Lima')::date;

  if p_fecha_pago is not null then
    if p_metodo = 'abono_adicional' and p_fecha_pago > now() then
      raise exception 'Un abono adicional (pago del cuaderno) no puede tener fecha futura — ya ocurrió';
    end if;

    if p_fecha_pago > now() + interval '1 year' then
      raise exception 'La fecha del pago no puede ser más de un año en el futuro';
    end if;
  end if;

  -- El rango de cobertura, si se manda, se valida igual de estricto que
  -- `fecha_pago`: ambos extremos juntos, "hasta" no antes de "desde", un
  -- techo de 45 días (cubre hasta un mes completo con margen) para que
  -- un error de tipeo no cubra meses enteros de un salto, y las mismas
  -- reglas de fecha futura que ya aplican a `fecha_pago`.
  if (p_cobertura_desde is null) <> (p_cobertura_hasta is null) then
    raise exception 'Debes indicar ambas fechas del rango de cobertura (desde y hasta), o ninguna';
  end if;

  if p_cobertura_desde is not null then
    if p_cobertura_hasta < p_cobertura_desde then
      raise exception 'La fecha "hasta" del rango no puede ser anterior a "desde"';
    end if;
    if p_cobertura_hasta - p_cobertura_desde > 45 then
      raise exception 'El rango de cobertura no puede superar 45 días';
    end if;
    if p_metodo = 'abono_adicional' and p_cobertura_hasta > v_hoy_lima then
      raise exception 'Un abono adicional no puede cubrir una fecha futura — ya ocurrió';
    end if;
    if p_cobertura_hasta > v_hoy_lima + 366 then
      raise exception 'El rango de cobertura no puede llegar a más de un año en el futuro';
    end if;
  end if;

  select * into v_contrato
  from public.contratos
  where id = p_contrato_id
  for update;                      -- 🔒 bloqueo pesimista

  if not found then
    raise exception 'Contrato no encontrado';
  end if;

  if v_contrato.estado <> 'activo' then
    raise exception 'El contrato no está activo (estado: %)', v_contrato.estado;
  end if;

  v_fecha := coalesce(p_fecha_pago, now());

  insert into public.pagos (
    contrato_id, monto_recibido, metodo_pago,
    estado, recaudador_id, evidencia_url, observaciones, fecha_pago,
    cobertura_desde, cobertura_hasta
  ) values (
    p_contrato_id,
    p_monto,
    p_metodo,
    case
      when p_monto >= public.monto_cuota_rango(
             v_contrato.monto_cuota, v_contrato.monto_domingo, v_contrato.frecuencia_pago,
             coalesce(p_cobertura_desde, v_fecha::date), coalesce(p_cobertura_hasta, v_fecha::date)
           )
      then 'completado'
      else 'parcial'
    end,
    auth.uid(),
    p_evidencia_url,
    p_observaciones,
    v_fecha,
    p_cobertura_desde,
    p_cobertura_hasta
  )
  returning * into v_pago;

  return v_pago;
end;
$$;

create or replace function public.editar_monto_pago(
  p_pago_id uuid,
  p_monto   numeric,
  p_motivo  text default null
)
returns public.pagos
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pago     public.pagos%rowtype;
  v_contrato public.contratos%rowtype;
begin
  if coalesce(public.fn_rol_actual(), '') not in ('admin', 'asesor') then
    raise exception 'No autorizado para editar pagos';
  end if;

  if p_monto is null or p_monto <= 0 then
    raise exception 'El monto debe ser mayor a cero';
  end if;

  select * into v_pago
  from public.pagos
  where id = p_pago_id
  for update;                      -- 🔒 bloqueo pesimista del pago

  if not found then
    raise exception 'Pago no encontrado';
  end if;

  select * into v_contrato
  from public.contratos
  where id = v_pago.contrato_id
  for update;                      -- 🔒 mismo bloqueo que registrar_pago/editar_contrato

  if not found then
    raise exception 'Contrato no encontrado';
  end if;

  update public.pagos
  set monto_recibido = p_monto,
      monto_original  = coalesce(v_pago.monto_original, v_pago.monto_recibido),
      motivo_edicion  = nullif(trim(coalesce(p_motivo, '')), ''),
      estado = case
                 when v_pago.es_cuota_inicial then 'completado'
                 when v_pago.estado = 'rechazado' then v_pago.estado
                 when p_monto >= public.monto_cuota_rango(
                        v_contrato.monto_cuota, v_contrato.monto_domingo, v_contrato.frecuencia_pago,
                        coalesce(v_pago.cobertura_desde, v_pago.fecha_pago::date),
                        coalesce(v_pago.cobertura_hasta, v_pago.fecha_pago::date)
                      ) then 'completado'
                 else 'parcial'
               end
  where id = p_pago_id
  returning * into v_pago;

  return v_pago;
end;
$$;
