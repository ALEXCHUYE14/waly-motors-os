-- ============================================================
-- WALY MOTORS OS — Migración 00010
-- Corrige un desajuste de la migración 00007: `stock`, `stock_minimo`
-- y `cantidad` eran `integer`, pero el campo `unidad` de un repuesto
-- admite texto libre como "litro" o "metro" — con eso, registrar un
-- movimiento fraccionario (ej. 2.5 litros de aceite) fallaba. Se
-- pasan a `numeric(10,2)`, que sigue guardando enteros sin problema
-- para repuestos por unidad (filtros, llantas, etc.).
-- ============================================================

alter table public.repuestos
  alter column stock         type numeric(10,2),
  alter column stock_minimo  type numeric(10,2);

alter table public.movimientos_repuestos
  alter column cantidad type numeric(10,2);

-- Cambiar el tipo de un parámetro requiere dropear la función anterior
-- (create or replace no permite cambiar la firma de argumentos).
drop function if exists public.registrar_movimiento_repuesto(uuid, text, integer, text, uuid);

create or replace function public.registrar_movimiento_repuesto(
  p_repuesto_id      uuid,
  p_tipo             text,
  p_cantidad         numeric,
  p_motivo           text default null,
  p_mantenimiento_id uuid default null
)
returns public.movimientos_repuestos
language plpgsql
security definer
set search_path = public
as $$
declare
  v_repuesto  public.repuestos%rowtype;
  v_movimiento public.movimientos_repuestos%rowtype;
begin
  if public.fn_rol_actual() not in ('admin', 'asesor', 'mecanico') then
    raise exception 'No autorizado para registrar movimientos de repuestos';
  end if;

  if p_cantidad <= 0 then
    raise exception 'La cantidad debe ser mayor a cero';
  end if;

  if p_tipo not in ('entrada', 'salida') then
    raise exception 'Tipo de movimiento inválido: % (debe ser entrada o salida)', p_tipo;
  end if;

  select * into v_repuesto
  from public.repuestos
  where id = p_repuesto_id
  for update;                        -- 🔒 bloqueo pesimista

  if not found then
    raise exception 'Repuesto no encontrado';
  end if;

  if p_tipo = 'salida' and v_repuesto.stock < p_cantidad then
    raise exception 'Stock insuficiente de % (disponible: %, solicitado: %)',
      v_repuesto.nombre, v_repuesto.stock, p_cantidad;
  end if;

  update public.repuestos
  set stock = stock + case when p_tipo = 'entrada' then p_cantidad else -p_cantidad end
  where id = p_repuesto_id;

  insert into public.movimientos_repuestos (
    repuesto_id, tipo, cantidad, motivo, mantenimiento_id, realizado_por
  ) values (
    p_repuesto_id, p_tipo, p_cantidad, p_motivo, p_mantenimiento_id, auth.uid()
  )
  returning * into v_movimiento;

  return v_movimiento;
end;
$$;
