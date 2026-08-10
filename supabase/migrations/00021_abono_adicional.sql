-- ============================================================
-- WALY MOTORS OS — Migración 00021
--
-- Nuevo método de pago "Abono adicional": Waldir tiene meses de pagos
-- de clientes anotados en un cuaderno y quiere pasarlos al sistema.
-- No son cobros del día — son registros históricos — así que:
--
--   1) Se agrega 'abono_adicional' a los métodos válidos de `pagos`.
--   2) `registrar_pago` acepta una fecha opcional (`p_fecha_pago`): si
--      no se manda, se comporta exactamente igual que antes (fecha =
--      ahora). El frontend solo la usa para "Abono adicional", donde
--      el asesor elige la fecha real del cuaderno — SIN esto, migrar
--      pagos viejos los marcaría con la fecha de hoy y descuadraría
--      "Caja hoy" (KPI que filtra por `fecha_pago::date = current_date`)
--      y el cálculo de días de mora de cada contrato.
--   3) No se permite una fecha futura (protección server-side: el
--      límite `max` del campo de fecha en el frontend es solo UX, no
--      seguridad — cualquiera con el token podría llamar la RPC
--      directo).
--
-- El nombre real de la restricción CHECK sobre `metodo_pago` se busca
-- dinámicamente antes de reemplazarla — la migración 00017 ya encontró
-- en este mismo proyecto un caso real donde el nombre generado por
-- Postgres no coincidía con el esperado por convención.
-- ============================================================

do $$
declare
  v_nombre text;
begin
  select con.conname into v_nombre
  from pg_constraint con
  join pg_class rel on rel.oid = con.conrelid
  join pg_namespace nsp on nsp.oid = rel.relnamespace
  where nsp.nspname = 'public'
    and rel.relname = 'pagos'
    and con.contype = 'c'
    and pg_get_constraintdef(con.oid) ilike '%metodo_pago%';

  if v_nombre is not null then
    execute format('alter table public.pagos drop constraint %I', v_nombre);
  end if;
end $$;

alter table public.pagos
  add constraint pagos_metodo_pago_check
  check (metodo_pago in ('efectivo', 'yape', 'plin', 'transferencia', 'abono_adicional'));

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
begin
  if coalesce(public.fn_rol_actual(), '') not in ('admin', 'asesor') then
    raise exception 'No autorizado para registrar pagos';
  end if;

  if p_fecha_pago is not null and p_fecha_pago > now() then
    raise exception 'No se puede registrar un pago con fecha futura';
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

  insert into public.pagos (
    contrato_id, monto_recibido, metodo_pago,
    estado, recaudador_id, evidencia_url, observaciones, fecha_pago
  ) values (
    p_contrato_id,
    p_monto,
    p_metodo,
    case when p_monto >= v_contrato.monto_cuota then 'completado' else 'parcial' end,
    auth.uid(),
    p_evidencia_url,
    p_observaciones,
    coalesce(p_fecha_pago, now())
  )
  returning * into v_pago;

  return v_pago;
end;
$$;
