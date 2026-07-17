-- ============================================================
-- WALY MOTORS OS — Migración 00007
-- Inventario de repuestos: stock, movimientos de entrada/salida
-- y consumo opcional vinculado a un registro de mantenimiento.
-- ============================================================

create table public.repuestos (
  id              uuid primary key default gen_random_uuid(),
  nombre          text not null,
  codigo          text unique,
  categoria       text,
  stock           integer not null default 0 check (stock >= 0),
  stock_minimo    integer not null default 0 check (stock_minimo >= 0),
  costo_unitario  numeric(10,2) check (costo_unitario >= 0),
  unidad          text not null default 'unidad',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index idx_repuestos_nombre_trgm on public.repuestos using gin (nombre gin_trgm_ops);

create trigger trg_repuestos_updated_at
  before update on public.repuestos
  for each row execute function public.fn_set_updated_at();

create table public.movimientos_repuestos (
  id               uuid primary key default gen_random_uuid(),
  repuesto_id      uuid not null references public.repuestos(id),
  tipo             text not null check (tipo in ('entrada', 'salida')),
  cantidad         integer not null check (cantidad > 0),
  motivo           text,
  mantenimiento_id uuid references public.mantenimientos(id),
  realizado_por    uuid not null references public.perfiles(id),
  created_at       timestamptz not null default now()
);

create index idx_movimientos_repuesto on public.movimientos_repuestos (repuesto_id, created_at desc);

alter table public.repuestos            enable row level security;
alter table public.movimientos_repuestos enable row level security;

do $$
declare t text;
begin
  foreach t in array array['repuestos','movimientos_repuestos'] loop
    execute format($p$
      create policy "%1$s_select_empleados" on public.%1$s
        for select to authenticated using (true);
    $p$, t);
    execute format($p$
      create policy "%1$s_insert_gestion" on public.%1$s
        for insert to authenticated
        with check (public.fn_rol_actual() in ('admin','asesor','mecanico'));
    $p$, t);
    execute format($p$
      create policy "%1$s_update_gestion" on public.%1$s
        for update to authenticated
        using (public.fn_rol_actual() in ('admin','asesor','mecanico'))
        with check (public.fn_rol_actual() in ('admin','asesor','mecanico'));
    $p$, t);
    execute format($p$
      create policy "%1$s_delete_admin" on public.%1$s
        for delete to authenticated
        using (public.fn_rol_actual() = 'admin');
    $p$, t);
  end loop;
end $$;

-- ------------------------------------------------------------
-- RPC ATÓMICA: registrar_movimiento_repuesto
-- Bloqueo pesimista sobre el repuesto para evitar que dos
-- movimientos concurrentes dejen el stock inconsistente.
-- ------------------------------------------------------------
create or replace function public.registrar_movimiento_repuesto(
  p_repuesto_id      uuid,
  p_tipo             text,
  p_cantidad         integer,
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
