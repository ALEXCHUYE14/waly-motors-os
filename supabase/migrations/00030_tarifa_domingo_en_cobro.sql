-- ============================================================
-- WALY MOTORS OS — Migración 00030
--
-- Pedido real: en Registro Express, si el día que cubre el pago cae
-- DOMINGO y el contrato tiene tarifa diferenciada (ej. Lunes–Sábado
-- S/ 28, Domingo S/ 10 — migración 00022), el monto sugerido debe ser
-- la tarifa de domingo, no siempre `monto_cuota` (que es la de
-- Lunes–Sábado).
--
-- 1) `buscar_contratos_activos` ahora devuelve también
--    `monto_lunes_sabado` y `monto_domingo` (null en contratos sin
--    tarifa diferenciada — ahí el monto sugerido sigue siendo
--    `monto_cuota` todos los días, exactamente como antes). El frontend
--    decide el monto según el día de la semana de la fecha del pago.
--
-- 2) `estado` del pago (completado/parcial): `registrar_pago` comparaba
--    SIEMPRE contra `monto_cuota` (tarifa L–S), así que un domingo
--    pagado completo (S/ 10 de S/ 10) quedaba marcado 'parcial'. Ahora
--    se compara contra la tarifa DEL DÍA (`monto_cuota_del_dia`). No
--    cambia saldo, total pagado ni mora (esas usan ambos estados igual,
--    ver 00023) — solo la etiqueta correcta en el historial. Lo mismo
--    en `editar_monto_pago` (00027) para que corregir el monto de un
--    domingo no lo vuelva a marcar parcial.
--
-- 3) Retrocompatibilidad: los pagos de domingo YA registrados en
--    contratos con tarifa de domingo, marcados 'parcial' aunque
--    cubrían esa tarifa completa, se corrigen a 'completado'. Nunca se
--    toca `monto_recibido`, `fecha_pago` ni la cuota inicial.
--
-- El día de la semana se toma en hora de Perú ('America/Lima'), no en
-- UTC: un cobro hecho el domingo a las 8 pm es lunes 01:00 en UTC.
--
-- Incluye también los topes de fecha de la migración 00029 (pago
-- adelantado), así que aplicar esta migración deja `registrar_pago`
-- completo aunque 00029 no se haya corrido antes.
-- ============================================================

create or replace function public.monto_cuota_del_dia(
  p_monto_cuota  numeric,
  p_monto_domingo numeric,
  p_fecha        timestamptz
)
returns numeric
language sql
immutable
set search_path = public
as $$
  select case
    when p_monto_domingo is not null
     and extract(dow from (p_fecha at time zone 'America/Lima')) = 0
    then p_monto_domingo
    else p_monto_cuota
  end;
$$;

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
  proximo_vencimiento date,
  monto_lunes_sabado  numeric,
  monto_domingo       numeric
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
    mo.fecha_vencida,
    c.monto_lunes_sabado,
    c.monto_domingo
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

create or replace function public.registrar_pago(
  p_contrato_id   uuid,
  p_monto         numeric,
  p_metodo        text,
  p_evidencia_url text default null,
  p_observaciones text default null,
  p_fecha_pago    timestamptz default null
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
begin
  if coalesce(public.fn_rol_actual(), '') not in ('admin', 'asesor') then
    raise exception 'No autorizado para registrar pagos';
  end if;

  if p_fecha_pago is not null then
    if p_metodo = 'abono_adicional' and p_fecha_pago > now() then
      raise exception 'Un abono adicional (pago del cuaderno) no puede tener fecha futura — ya ocurrió';
    end if;

    if p_fecha_pago > now() + interval '1 year' then
      raise exception 'La fecha del pago no puede ser más de un año en el futuro';
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
    estado, recaudador_id, evidencia_url, observaciones, fecha_pago
  ) values (
    p_contrato_id,
    p_monto,
    p_metodo,
    case
      when p_monto >= public.monto_cuota_del_dia(v_contrato.monto_cuota, v_contrato.monto_domingo, v_fecha)
      then 'completado'
      else 'parcial'
    end,
    auth.uid(),
    p_evidencia_url,
    p_observaciones,
    v_fecha
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
                 when p_monto >= public.monto_cuota_del_dia(
                        v_contrato.monto_cuota, v_contrato.monto_domingo, v_pago.fecha_pago
                      ) then 'completado'
                 else 'parcial'
               end
  where id = p_pago_id
  returning * into v_pago;

  return v_pago;
end;
$$;

-- Backfill: pagos de domingo ya registrados que cubrían la tarifa de
-- domingo completa pero quedaron 'parcial' (se comparaban con la de L–S).
update public.pagos p
set estado = 'completado'
from public.contratos c
where p.contrato_id = c.id
  and c.monto_domingo is not null
  and p.estado = 'parcial'
  and not p.es_cuota_inicial
  and extract(dow from (p.fecha_pago at time zone 'America/Lima')) = 0
  and p.monto_recibido >= c.monto_domingo;
